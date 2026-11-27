import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { SpeakerBreakdownItem, TranscriptSegment } from "./db";
import type { N8nWorkflowResult } from "./n8n-integration";
import type { UnifiedRecordingAnalysisResult } from "./ai";
import { getDataDir } from "./storage";
import { logObservabilityEvent } from "./pipeline-logger";

const CACHE_VERSION = 3;
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_TRANSCRIPT_CACHE_ENTRIES = 200;

export interface CachedTranscriptEntry {
  cacheKey: string;
  audioSha256: string;
  transcriptHash?: string;
  analysisHash?: string;
  language: string;
  version: number;
  transcriptId?: string;
  provider: "n8n" | "assemblyai" | "gemini" | "whisper-local";
  asrModel?: string;
  languageConfig?: string;
  diarizationEnabled?: boolean;
  averageConfidence?: number;
  detectedLanguage: string;
  durationSeconds: number;
  rawTranscript?: string;
  processedTranscript?: string;
  fullText: string;
  rawSegments?: TranscriptSegment[];
  segments: TranscriptSegment[];
  speakerBreakdown: SpeakerBreakdownItem[];
  cachedN8nAnalysis?: N8nWorkflowResult["analysis"];
  cachedUnifiedAnalysis?: UnifiedRecordingAnalysisResult;
  cachedHtmlReport?: string;
  createdAt: number;
}

let transcriptCacheMap: Map<string, CachedTranscriptEntry> | null = null;

function getTranscriptCacheFile(): string {
  return path.join(getDataDir(), "audio_transcript_cache.json");
}

function loadTranscriptCache(): Map<string, CachedTranscriptEntry> {
  if (transcriptCacheMap) return transcriptCacheMap;
  transcriptCacheMap = new Map();
  try {
    const file = getTranscriptCacheFile();
    if (fs.existsSync(file)) {
      const raw = JSON.parse(fs.readFileSync(file, "utf8"));
      if (Array.isArray(raw)) {
        const now = Date.now();
        for (const item of raw) {
          if (
            item &&
            typeof item.cacheKey === "string" &&
            item.version === CACHE_VERSION &&
            Array.isArray(item.segments) &&
            item.segments.length > 0 &&
            now - Number(item.createdAt || 0) < CACHE_TTL_MS
          ) {
            transcriptCacheMap.set(item.cacheKey, item as CachedTranscriptEntry);
          }
        }
      }
    }
  } catch {
    // Non-fatal cache load failure
  }
  return transcriptCacheMap;
}

function persistTranscriptCache(): void {
  if (!transcriptCacheMap) return;
  try {
    const file = getTranscriptCacheFile();
    const list = Array.from(transcriptCacheMap.values())
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, MAX_TRANSCRIPT_CACHE_ENTRIES);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(list), "utf8");
  } catch {
    // Non-fatal cache write failure
  }
}

export function buildAudioTranscriptCacheKey(
  audioSha256: string,
  language = "auto",
  providerScope?: string,
): string {
  const normLang =
    String(language || "auto")
      .trim()
      .toLowerCase() || "auto";
  const scope = (providerScope || "").trim().toLowerCase();
  return scope
    ? `${audioSha256}:${normLang}:${scope}:v${CACHE_VERSION}`
    : `${audioSha256}:${normLang}:v${CACHE_VERSION}`;
}

export function computeFileSha256(filePath: string): string {
  try {
    const hash = crypto.createHash("sha256");
    const fd = fs.openSync(filePath, "r");
    const chunk = Buffer.allocUnsafe(1024 * 1024);
    try {
      let bytesRead = 0;
      while ((bytesRead = fs.readSync(fd, chunk, 0, chunk.length, null)) > 0) {
        hash.update(chunk.subarray(0, bytesRead));
      }
    } finally {
      fs.closeSync(fd);
    }
    return hash.digest("hex");
  } catch {
    return "";
  }
}

export function computeTranscriptSha256(segments: Array<{ text: string }>): string {
  const joined = (segments || [])
    .map((s) => String(s.text || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!joined) return "";
  return crypto.createHash("sha256").update(joined).digest("hex");
}

/**
 * Retrieves a verified real transcript previously produced for the exact same audio SHA-256.
 * Never returns empty or placeholder transcripts.
 */
export function getCachedTranscriptByAudioHash(
  audioSha256: string,
  language = "auto",
  correlationId?: string,
  preferredProvider?: "n8n" | "assemblyai" | "whisper-local",
): CachedTranscriptEntry | null {
  if (!audioSha256) return null;
  const cache = loadTranscriptCache();
  const exactKey = buildAudioTranscriptCacheKey(audioSha256, language, preferredProvider);
  const exactLegacyKey = buildAudioTranscriptCacheKey(audioSha256, language);
  const autoKey = buildAudioTranscriptCacheKey(audioSha256, "auto", preferredProvider);
  const autoLegacyKey = buildAudioTranscriptCacheKey(audioSha256, "auto");
  const hit =
    cache.get(exactKey) ||
    cache.get(exactLegacyKey) ||
    (language === "auto" ? cache.get(autoKey) || cache.get(autoLegacyKey) : undefined);
  if (!hit) return null;
  // Never serve a lower-accuracy local fallback cache entry when cloud AssemblyAI/n8n is active
  if (
    (preferredProvider === "assemblyai" || preferredProvider === "n8n") &&
    hit.provider === "whisper-local"
  ) {
    return null;
  }
  if (Date.now() - hit.createdAt > CACHE_TTL_MS || !hit.segments?.length) {
    cache.delete(hit.cacheKey);
    return null;
  }
  logObservabilityEvent("info", "transcript_cache_hit", {
    correlationId,
    audioSha256: audioSha256.slice(0, 12),
    provider: hit.provider,
    asrModel: hit.asrModel,
    segmentsCount: hit.segments.length,
  });
  return hit;
}

/**
 * Stores a verified real audio -> transcript mapping persistently.
 * Refuses to cache empty transcripts.
 */
export function setCachedTranscriptByAudioHash(params: {
  audioSha256: string;
  language?: string;
  transcriptId?: string;
  provider: "n8n" | "assemblyai" | "gemini" | "whisper-local";
  asrModel?: string;
  languageConfig?: string;
  diarizationEnabled?: boolean;
  averageConfidence?: number;
  detectedLanguage: string;
  durationSeconds: number;
  rawTranscript?: string;
  processedTranscript?: string;
  rawSegments?: TranscriptSegment[];
  segments: TranscriptSegment[];
  speakerBreakdown: SpeakerBreakdownItem[];
  cachedN8nAnalysis?: N8nWorkflowResult["analysis"];
  cachedUnifiedAnalysis?: UnifiedRecordingAnalysisResult;
  cachedHtmlReport?: string;
}): void {
  if (!params.audioSha256 || !Array.isArray(params.segments) || params.segments.length === 0) {
    return;
  }
  const fullText = params.segments
    .map((s) => String(s.text || "").trim())
    .filter(Boolean)
    .join(" ");
  if (!fullText) return;

  const cache = loadTranscriptCache();
  const lang = params.language || "auto";
  const cacheKey = buildAudioTranscriptCacheKey(params.audioSha256, lang, params.provider);
  const existing = cache.get(cacheKey);
  const transcriptHash = computeTranscriptSha256(params.segments);
  cache.set(cacheKey, {
    cacheKey,
    audioSha256: params.audioSha256,
    transcriptHash,
    analysisHash: params.cachedUnifiedAnalysis?.analysisHash || existing?.analysisHash,
    language: lang,
    version: CACHE_VERSION,
    transcriptId: params.transcriptId,
    provider: params.provider,
    asrModel: params.asrModel,
    languageConfig: params.languageConfig,
    diarizationEnabled: params.diarizationEnabled,
    averageConfidence: params.averageConfidence,
    detectedLanguage: params.detectedLanguage,
    durationSeconds: params.durationSeconds,
    rawTranscript: params.rawTranscript || fullText,
    processedTranscript: params.processedTranscript || fullText,
    fullText,
    rawSegments: params.rawSegments || params.segments,
    segments: params.segments,
    speakerBreakdown: params.speakerBreakdown,
    cachedN8nAnalysis: params.cachedN8nAnalysis || existing?.cachedN8nAnalysis,
    cachedUnifiedAnalysis: params.cachedUnifiedAnalysis || existing?.cachedUnifiedAnalysis,
    cachedHtmlReport: params.cachedHtmlReport || existing?.cachedHtmlReport,
    createdAt: Date.now(),
  });
  persistTranscriptCache();
}

export function attachCachedAnalysisToAudioHash(params: {
  audioSha256: string;
  language?: string;
  provider?: string;
  analysis: UnifiedRecordingAnalysisResult;
}): void {
  if (!params.audioSha256) return;
  const cache = loadTranscriptCache();
  const lang = params.language || "auto";
  const target =
    cache.get(buildAudioTranscriptCacheKey(params.audioSha256, lang, params.provider)) ||
    cache.get(buildAudioTranscriptCacheKey(params.audioSha256, lang)) ||
    cache.get(buildAudioTranscriptCacheKey(params.audioSha256, "auto", params.provider)) ||
    cache.get(buildAudioTranscriptCacheKey(params.audioSha256, "auto"));
  if (!target) return;
  target.cachedUnifiedAnalysis = params.analysis;
  target.analysisHash = params.analysis.analysisHash;
  target.transcriptHash = target.transcriptHash || params.analysis.transcriptHash;
  persistTranscriptCache();
}
