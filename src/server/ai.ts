import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { ThinkingLevel } from "@google/genai";
import { db, TranscriptSegment, MindMapNode } from "./db";
import { getDataDir } from "./storage";
import {
  executeWithRetryAndFallback,
  getGeminiConfig,
  GeminiPipelineError,
  isRetryableGeminiError,
  isBillingExhaustionError,
  extractHttpStatus,
  logGeminiStructured,
  extractGeminiTranscriptText,
  getGeminiClient,
  suspendCloudGeminiTemporarily,
} from "./gemini";
import {
  answerBuiltInChat,
  buildBuiltInSummary,
  buildBuiltInLectureAnalysis,
  buildBuiltInFlashcards,
  buildBuiltInMindMap,
  buildBuiltInQuiz,
  detectIsArabic,
  normalizeText,
  retrieveRelevantSegmentsBM25,
  selectHighSignalSegments,
  tryAnswerIdentityQuery,
  trySolveMathQuery,
} from "./builtin-ai";
import { generateLocalLlmJson, generateLocalLlmText, getLocalLlmModelId } from "./local-llm";

const execFileAsync = promisify(execFile);
const geminiConfig = getGeminiConfig();
const TEXT_MODEL = geminiConfig.textModel;
const FALLBACK_TEXT_MODEL = geminiConfig.fallbackTextModel;
const ASR_MODEL = geminiConfig.asrModel;
const FALLBACK_ASR_MODEL = geminiConfig.fallbackAsrModel;

const PROMPT_VERSION = 4;

function suspendGeminiIfUnavailableError(err: unknown): void {
  const status = extractHttpStatus(err);
  const msg = err instanceof Error ? err.message : String(err || "");
  if (
    isBillingExhaustionError(err) ||
    status === 401 ||
    status === 402 ||
    status === 403 ||
    /fetch failed|enotfound|econnrefused|econnreset|etimedout|network|api key/i.test(msg)
  ) {
    suspendCloudGeminiTemporarily(10 * 60 * 1000);
  }
}
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface CacheEntry<T> {
  hash: string;
  type: string;
  model: string;
  version: number;
  data: T;
  createdAt: number;
}

let inMemoryAiCache: Map<string, CacheEntry<unknown>> | null = null;

function getAiCacheFilePath(): string {
  try {
    return path.join(getDataDir(), "ai_analysis_cache.json");
  } catch {
    return path.join(os.tmpdir(), "meetmind_ai_cache.json");
  }
}

function loadAiCache(): Map<string, CacheEntry<unknown>> {
  if (inMemoryAiCache) return inMemoryAiCache;
  inMemoryAiCache = new Map();
  try {
    const file = getAiCacheFilePath();
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
      if (Array.isArray(parsed)) {
        const now = Date.now();
        for (const entry of parsed) {
          if (entry && entry.hash && now - entry.createdAt < CACHE_TTL_MS) {
            inMemoryAiCache.set(entry.hash, entry);
          }
        }
      }
    }
  } catch {
    // Non-fatal cache load
  }
  return inMemoryAiCache;
}

function saveAiCache(): void {
  if (!inMemoryAiCache) return;
  try {
    const file = getAiCacheFilePath();
    const array = Array.from(inMemoryAiCache.values()).slice(-300);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(array), "utf-8");
  } catch {
    // Non-fatal cache save
  }
}

export function computeTranscriptHash(
  analysisType: string,
  title: string,
  segments: { text: string }[],
  extra?: string,
): string {
  const content = segments
    .map((s) => s.text.trim())
    .filter(Boolean)
    .join(" ");
  return crypto
    .createHash("sha256")
    .update(`${analysisType}|v${PROMPT_VERSION}|${title.trim()}|${extra || ""}|${content}`)
    .digest("hex");
}

export function getCachedAiAnalysis<T>(hash: string): T | null {
  const cache = loadAiCache();
  const entry = cache.get(hash);
  if (!entry) return null;
  if (Date.now() - entry.createdAt > CACHE_TTL_MS) {
    cache.delete(hash);
    return null;
  }
  logGeminiStructured({
    level: "info",
    event: "ai_cache_hit",
    operation: entry.type,
    model: entry.model,
    detail: `Cached analysis retrieved for hash: ${hash.slice(0, 12)}`,
  });
  return entry.data as T;
}

export function setCachedAiAnalysis<T>(hash: string, type: string, model: string, data: T): void {
  const cache = loadAiCache();
  cache.set(hash, {
    hash,
    type,
    model,
    version: PROMPT_VERSION,
    data,
    createdAt: Date.now(),
  });
  saveAiCache();
}

export interface AIAnalysisResult {
  summary: string;
  executiveSummary?: string;
  detailedSummary?: string;
  keyPoints: string[];
  decisions: string[];
  topics: string[];
  actionItems: {
    title: string;
    ownerName?: string;
    dueDate?: string;
    sourceTimestamp?: string;
    priority: "high" | "medium" | "low";
  }[];
  lectureNotes?: string;
  keyConcepts?: { term: string; definition: string }[];
  examHighlights?: string[];
  quiz?: {
    title: string;
    questions: {
      question: string;
      options: string[];
      correctOptionIndex: number;
      explanation: string;
    }[];
  };
  flashcards?: {
    front: string;
    back: string;
  }[];
}

const AI_SERVICE_URL = process.env.AI_SERVICE_URL?.replace(/\/$/, "");

function normalizeArabicAndLatin(input: string): string {
  return (input || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "") // strip Arabic diacritics
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\u0600-\u06FFa-z0-9._\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatMmSs(sec: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const mins = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export function extractKeywordsWithFrequency(
  segments: TranscriptSegment[],
  limit = 12,
): Array<{
  term: string;
  frequency: number;
  importance: number;
  segmentIds: string[];
  context: string;
  timestamp: string;
}> {
  const stopWords = new Set([
    "في",
    "من",
    "على",
    "الي",
    "إلى",
    "عن",
    "مع",
    "هذا",
    "هذه",
    "ذلك",
    "تلك",
    "تم",
    "كان",
    "كانت",
    "يكون",
    "تكون",
    "كل",
    "هو",
    "هي",
    "نحن",
    "احنا",
    "انت",
    "ان",
    "أن",
    "إن",
    "هل",
    "ما",
    "التي",
    "الذي",
    "اللي",
    "بين",
    "عند",
    "بعد",
    "قبل",
    "عشان",
    "علشان",
    "يعني",
    "جدا",
    "جداً",
    "كده",
    "ده",
    "دي",
    "النهارده",
    "النهاردة",
    "اليوم",
    "the",
    "and",
    "for",
    "with",
    "that",
    "this",
    "from",
    "are",
    "was",
    "were",
    "have",
    "has",
    "will",
    "about",
    "into",
    "your",
    "they",
    "their",
    "what",
    "when",
    "then",
    "than",
    "also",
    "just",
    "very",
    "some",
    "more",
    "been",
    "being",
    "here",
    "there",
  ]);
  const counts = new Map<
    string,
    { display: string; freq: number; segIds: Set<string>; context: string; timestamp: string }
  >();
  for (const seg of segments) {
    const tokens = (seg.text || "").split(/\s+/);
    const ts = formatMmSs(seg.startTime || 0);
    for (const raw of tokens) {
      const clean = raw.replace(/^[^ء-يa-zA-Z0-9.#+-]+|[^ء-يa-zA-Z0-9.#+-]+$/g, "");
      const norm = normalizeArabicAndLatin(clean);
      const isShortTech = /^(ai|ml|ui|ux|db|os|ip|ci|cd|c#|js|ts|\.net|api|sql|jwt|sse|rag)$/i.test(
        clean,
      );
      if ((clean.length >= 3 || isShortTech) && norm && !stopWords.has(norm)) {
        const entry = counts.get(norm) || {
          display: clean,
          freq: 0,
          segIds: new Set<string>(),
          context: seg.text.length > 140 ? `${seg.text.slice(0, 140)}...` : seg.text,
          timestamp: ts,
        };
        entry.freq += 1;
        entry.segIds.add(seg.id);
        counts.set(norm, entry);
      }
    }
  }
  const sorted = Array.from(counts.values())
    .sort((a, b) => b.freq - a.freq)
    .slice(0, limit);
  const maxFreq = Math.max(1, sorted[0]?.freq || 1);
  return sorted.map((info) => ({
    term: info.display,
    frequency: info.freq,
    importance: Math.round((info.freq / maxFreq) * 100) / 100,
    segmentIds: Array.from(info.segIds),
    context: info.context,
    timestamp: info.timestamp,
  }));
}

export function extractHighlightsFromSegments(segments: TranscriptSegment[]): Array<{
  quote: string;
  context?: string;
  speaker?: string;
  timestamp: string;
  category: string;
  priority: string;
}> {
  const cues: Array<{ regex: RegExp; category: string; priority: string }> = [
    {
      regex:
        /(important|critical|exam|remember|key takeaway|focus here|مهم|مهمة|دي مهمة|ركزوا|ركز هنا|امتحان|ممكن تيجي|الخلاصة|انتبه|أساسي|تذكر|نقطة جوهرية)/i,
      category: "ExamTip",
      priority: "high",
    },
    {
      regex: /(decide|decision|agreed|approved|finalized|قرر|قررنا|اتفق|اتفقنا|اعتماد|تم الاتفاق)/i,
      category: "Decision",
      priority: "high",
    },
    {
      regex: /(warning|risk|danger|careful|blocker|issue|تحذير|خطر|مشكلة|عائق|انتباه)/i,
      category: "Warning",
      priority: "high",
    },
    {
      regex: /(defined as|means|definition|refers to|يعني|تعريف|المقصود|عبارة عن)/i,
      category: "Definition",
      priority: "medium",
    },
    {
      regex:
        /(action item|todo|deadline|deliver|submit|responsible|assign|مهمة|تسليم|مطلوب|مسؤول|لازم نخلص|موعد)/i,
      category: "ActionItem",
      priority: "high",
    },
  ];
  const results: Array<{
    quote: string;
    context?: string;
    speaker?: string;
    timestamp: string;
    category: string;
    priority: string;
  }> = [];

  for (const seg of segments) {
    const ts = formatMmSs(seg.startTime || 0);
    for (const cue of cues) {
      if (cue.regex.test(seg.text || "")) {
        results.push({
          quote: seg.text,
          context: `Spoken by ${seg.speaker} at [${ts}]`,
          speaker: seg.speaker,
          timestamp: ts,
          category: cue.category,
          priority: cue.priority,
        });
        break;
      }
    }
    if (results.length >= 10) break;
  }
  return results;
}

function detectTranscriptLanguage(
  title: string,
  segments: TranscriptSegment[],
): "ar" | "en" | "mixed" {
  const combined = `${title} ${segments.map((s) => s.text || "").join(" ")}`;
  const arabicChars = (combined.match(/[\u0600-\u06FF]/g) || []).length;
  const latinChars = (combined.match(/[a-zA-Z]/g) || []).length;
  if (arabicChars > 10 && latinChars > 20 && latinChars > arabicChars * 0.4) return "mixed";
  if (arabicChars > 0 && arabicChars >= latinChars * 0.25) return "ar";
  return latinChars > 0 ? "en" : "ar";
}

function chunkTranscriptSegments(
  segments: TranscriptSegment[],
  maxCharsPerChunk = 22000,
  overlapSegments = 2,
): string[] {
  const formatSeg = (s: TranscriptSegment) =>
    `[${Math.floor(s.startTime / 60)}:${Math.floor(s.startTime % 60)
      .toString()
      .padStart(2, "0")}] ${s.speaker}: ${s.text}`;

  const chunks: string[] = [];
  let i = 0;
  while (i < segments.length) {
    let current = "";
    const startIdx = i;
    while (i < segments.length) {
      const line = formatSeg(segments[i]) + "\n";
      if (current.length > 0 && current.length + line.length > maxCharsPerChunk) {
        break;
      }
      current += line;
      i++;
    }
    if (current.trim()) chunks.push(current.trim());
    if (i < segments.length && i > startIdx + overlapSegments) {
      i -= overlapSegments;
    }
  }
  return chunks;
}

async function prepareTranscriptForLlm(
  ai: ReturnType<typeof getGeminiClient>,
  title: string,
  segments: TranscriptSegment[],
  maxDirectChars = 24000,
): Promise<string> {
  const fullText = segments
    .map(
      (s) =>
        `[${Math.floor(s.startTime / 60)}:${Math.floor(s.startTime % 60)
          .toString()
          .padStart(2, "0")}] ${s.speaker}: ${s.text}`,
    )
    .join("\n");

  if (fullText.length <= maxDirectChars || !ai) {
    return fullText.slice(0, maxDirectChars);
  }

  // Long recording: hierarchically synthesize each overlapping chunk before global analysis
  const chunks = chunkTranscriptSegments(segments, 20000, 2);
  const chunkSummaries: string[] = [];
  for (let idx = 0; idx < chunks.length; idx++) {
    try {
      const { result: resp } = await executeWithRetryAndFallback(
        "prepareTranscriptChunk",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: `Extract all key facts, definitions, technical terms, decisions, tasks, speakers, and timestamps from part ${idx + 1}/${chunks.length} of "${title}". Be faithful to the transcript and omit nothing important:\n\n${chunks[idx]}`,
            config: { thinkingConfig: { thinkingLevel: ThinkingLevel.LOW } },
          });
        },
        { primaryModel: TEXT_MODEL, fallbackModel: FALLBACK_TEXT_MODEL },
      );
      const text = (resp.text || "").trim();
      if (text) {
        chunkSummaries.push(`--- Section ${idx + 1}/${chunks.length} ---\n${text}`);
      }
    } catch {
      chunkSummaries.push(chunks[idx].slice(0, Math.floor(maxDirectChars / chunks.length)));
    }
  }
  return chunkSummaries.join("\n\n").slice(0, maxDirectChars);
}

/**
 * Normalizes non-WAV live audio chunks (e.g. browser WebM/Opus, OGG, MP4/M4A)
 * into clean 16kHz mono PCM WAV via ffmpeg when available so Gemini ASR receives
 * an unambiguous, container-valid audio clip.
 */
async function normalizeLiveAudioChunkToWav(
  audioBytes: Buffer,
  mimeType: string,
): Promise<{ bytes: Buffer; mimeType: string }> {
  const safeMime = (mimeType || "audio/webm").split(";")[0].trim().toLowerCase();
  // Already clean WAV or MP3 — pass straight through with zero overhead
  if (
    (safeMime === "audio/wav" || safeMime === "audio/x-wav" || safeMime === "audio/wave") &&
    audioBytes.length > 44 &&
    audioBytes.subarray(0, 4).toString("ascii") === "RIFF"
  ) {
    return { bytes: audioBytes, mimeType: "audio/wav" };
  }
  if (safeMime === "audio/mp3" || safeMime === "audio/mpeg") {
    return { bytes: audioBytes, mimeType: "audio/mp3" };
  }

  const ext = safeMime.includes("ogg")
    ? ".ogg"
    : safeMime.includes("mp4") || safeMime.includes("m4a") || safeMime.includes("aac")
      ? ".m4a"
      : safeMime.includes("flac")
        ? ".flac"
        : ".webm";

  const id = `${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  const inPath = path.join(os.tmpdir(), `mm_live_in_${id}${ext}`);
  const outPath = path.join(os.tmpdir(), `mm_live_out_${id}.wav`);

  try {
    fs.writeFileSync(inPath, audioBytes);
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-err_detect",
        "ignore_err",
        "-fflags",
        "+genpts+igndts+discardcorrupt",
        "-i",
        inPath,
        "-vn",
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        outPath,
      ],
      { timeout: 20000, maxBuffer: 4 * 1024 * 1024 },
    );

    if (fs.existsSync(outPath) && fs.statSync(outPath).size > 1024) {
      return { bytes: fs.readFileSync(outPath), mimeType: "audio/wav" };
    }
  } catch {
    // If ffmpeg is unavailable or chunk is already raw-readable by Gemini, pass original bytes
  } finally {
    try {
      if (fs.existsSync(inPath)) fs.unlinkSync(inPath);
    } catch {
      /* ignore */
    }
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch {
      /* ignore */
    }
  }

  return { bytes: audioBytes, mimeType: safeMime || "audio/webm" };
}

function detectLanguageLabelFromText(text: string, hint: string): string {
  const ar = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const en = (text.match(/[a-zA-Z]/g) || []).length;
  if (ar > 4 && en > 4) return "Mixed (AR/EN)";
  if (ar > 0) return hint === "ar-SA" ? "العربية الفصحى" : "العربية (Arabic)";
  if (en > 0) return "English";
  return hint === "auto" ? "Auto-Detect" : hint;
}

export async function transcribeAndTranslateAudioChunk(params: {
  audioBase64?: string;
  mimeType?: string;
  interimText?: string;
  recentContext?: string;
  language?: string;
  offsetSeconds?: number;
  isMeeting?: boolean;
}): Promise<{
  arabicText: string;
  text: string;
  detectedLanguage: string;
  isSilence?: boolean;
  error?: string;
  retryable?: boolean;
}> {
  const {
    audioBase64,
    mimeType = "audio/webm",
    recentContext,
    language = "auto",
    offsetSeconds = 0,
    isMeeting = false,
  } = params;

  const rawAudioBytes =
    audioBase64 && audioBase64.length > 64 ? Buffer.from(audioBase64, "base64") : null;

  // 1. Prefer Python FastAPI whisper/audio service when configured and audio bytes exist
  if (AI_SERVICE_URL && rawAudioBytes && rawAudioBytes.length > 100) {
    try {
      const safeMime = mimeType.split(";")[0].trim() || "audio/webm";
      const ext = safeMime.includes("wav")
        ? ".wav"
        : safeMime.includes("mp4") || safeMime.includes("m4a")
          ? ".m4a"
          : safeMime.includes("ogg")
            ? ".ogg"
            : ".webm";
      const form = new FormData();
      form.append("file", new Blob([rawAudioBytes], { type: safeMime }), `live_chunk${ext}`);
      form.append("language", language || "auto");
      form.append("is_meeting", isMeeting ? "true" : "false");
      form.append("offset_seconds", String(offsetSeconds || 0));
      form.append("is_partial", "true");

      const resp = await fetch(`${AI_SERVICE_URL}/api/v1/transcribe-chunk`, {
        method: "POST",
        body: form,
        signal: AbortSignal.timeout(25000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          detected_language?: string;
          full_text?: string;
          segments?: Array<{ text?: string }>;
        };
        const segmentText = (data.segments || [])
          .map((s) => (s.text || "").trim())
          .filter(Boolean)
          .join(" ")
          .trim();
        const finalTxt = segmentText || (data.full_text || "").trim();
        if (finalTxt) {
          return {
            arabicText: finalTxt,
            text: finalTxt,
            detectedLanguage:
              data.detected_language || detectLanguageLabelFromText(finalTxt, language),
          };
        }
      }
    } catch {
      // Fall through cleanly to Gemini real ASR
    }
  }

  const ai = getGeminiClient();
  if (!ai) {
    return {
      arabicText: "",
      text: "",
      detectedLanguage: language || "auto",
      isSilence: true,
    };
  }

  if (!rawAudioBytes || rawAudioBytes.length < 100) {
    return {
      arabicText: "",
      text: "",
      detectedLanguage: language || "auto",
      isSilence: true,
    };
  }

  try {
    const normalized = await normalizeLiveAudioChunkToWav(rawAudioBytes, mimeType);
    const normalizedBase64 = normalized.bytes.toString("base64");

    const langInstruction =
      language === "ar-forced"
        ? "Transcribe in Modern Standard Arabic while preserving exact English technical terms (API, Backend, .NET, React, Python, FastAPI, SignalR, SQL Server)."
        : language.startsWith("en")
          ? "Transcribe faithfully verbatim in English without translating to another language."
          : language === "ar-EG"
            ? "Transcribe faithfully verbatim in Arabic (Egyptian Arabic or MSA as spoken) and preserve any embedded English technical terms (API, Backend, .NET, React, Python, FastAPI, SignalR, SQL Server) exactly in English."
            : "Auto-detect the spoken language (Arabic dialects including Egyptian/MSA/Gulf/Levantine, English, or mixed Arabic+English) and transcribe faithfully verbatim. Preserve embedded English technical terms without translating them.";

    const contextHint = recentContext
      ? `Previous spoken context (do NOT repeat this context, transcribe ONLY new speech in this clip): "${recentContext.slice(-220)}"`
      : "Start of live recording session.";

    const promptText = `Transcribe this real live microphone audio clip verbatim.
${langInstruction}
${contextHint}
Strict rules:
1. Return ONLY the exact words spoken in THIS audio clip with proper punctuation. No speaker labels, no timestamps, no explanations.
2. NEVER invent, guess, or hallucinate words not actually present in the audio.
3. If this audio clip contains only silence, breathing, or background noise with no intelligible human speech, reply with exact token: [SILENCE]
4. For mixed Arabic/English speech: preserve BOTH languages exactly as spoken — do NOT translate Arabic to English or English to Arabic.
5. Preserve proper nouns (people names, company names, product names, place names) exactly as spoken — do NOT translate or transliterate them.
6. Preserve numbers, dates, percentages, and monetary values EXACTLY as spoken (e.g. "50%", "2024", "$500", "١٥٪").
7. If a word is genuinely inaudible or unclear, write [unclear] in its place — do NOT guess or invent a word.
8. Never add words, fillers, or explanations that were not spoken in the audio.`;

    const audioPart = {
      inlineData: {
        mimeType: normalized.mimeType,
        data: normalizedBase64,
      },
    };

    const config = getGeminiConfig();
    const { result: response } = await executeWithRetryAndFallback(
      "transcribeAndTranslateAudioChunk",
      async (model) => {
        return ai.models.generateContent({
          model,
          contents: {
            parts: [audioPart, { text: promptText }],
          },
          ...(model === config.textModel || model === config.fallbackTextModel
            ? { config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } } }
            : {}),
        });
      },
      {
        primaryModel: config.asrModel,
        fallbackModel: config.fallbackAsrModel,
      },
    );

    const rawOutput = extractGeminiTranscriptText(response);

    const trimmed = (rawOutput || "").trim();
    const isSilenceToken =
      !trimmed ||
      trimmed === "[صمت]" ||
      trimmed === "[]" ||
      trimmed.toLowerCase() === "[silence]" ||
      trimmed.toLowerCase() === "silence";

    if (isSilenceToken) {
      return {
        arabicText: "",
        text: "",
        detectedLanguage: language === "auto" ? "Auto-Detect" : language,
        isSilence: true,
      };
    }

    const cleaned = trimmed
      .replace(/^```(?:text|txt)?\s*/i, "")
      .replace(/\s*```$/i, "")
      .replace(/^(English|Translation|Speaker|Arabic|Transcript):\s*/i, "")
      .trim();

    if (!cleaned || cleaned.toLowerCase().includes("[silence]") || cleaned === "[صمت]") {
      return {
        arabicText: "",
        text: "",
        detectedLanguage: language === "auto" ? "Auto-Detect" : language,
        isSilence: true,
      };
    }

    return {
      arabicText: cleaned,
      text: cleaned,
      detectedLanguage: detectLanguageLabelFromText(cleaned, language),
      isSilence: false,
    };
  } catch (geminiError) {
    const msg = geminiError instanceof Error ? geminiError.message : String(geminiError);
    const status = extractHttpStatus(geminiError);
    const retryable = isRetryableGeminiError(geminiError);
    const isAuthOrConfig =
      /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|403|401/i.test(msg) ||
      status === 401 ||
      status === 403;
    const isBillingDepleted = isBillingExhaustionError(geminiError);

    logGeminiStructured({
      level: "warn",
      event: "transcription_chunk_error",
      operation: "transcribeAndTranslateAudioChunk",
      model: getGeminiConfig().asrModel,
      status,
      finalFailureReason: msg,
    });

    // Gracefully yield to client built-in Web Speech API when cloud ASR key is missing/depleted
    if (isBillingDepleted || isAuthOrConfig) {
      return {
        arabicText: "",
        text: "",
        detectedLanguage: language || "auto",
        isSilence: true,
      };
    }

    return {
      arabicText: "",
      text: "",
      detectedLanguage: language || "auto",
      isSilence: true,
      retryable: retryable && !isAuthOrConfig && !isBillingDepleted,
    };
  }
}

// ============================================================================
// LOCAL EMBEDDED LLM SHARED HELPERS (COMPACT RAG + GROUNDING + NORMALIZATION)
// ============================================================================
function formatCompactTranscriptForLocalLlm(
  segments: TranscriptSegment[],
  maxChars = 2200,
): string {
  const picked = selectHighSignalSegments(segments, maxChars);
  return picked
    .map((s) => `[${formatMmSs(s.startTime)}] ${s.speaker}: ${s.text.trim()}`)
    .join("\n")
    .slice(0, maxChars);
}

function hasTranscriptOverlap(candidateText: string, segments: TranscriptSegment[]): boolean {
  const candTokens = normalizeText(candidateText)
    .split(" ")
    .filter((t) => t.length >= 3 || /\d/.test(t));
  if (candTokens.length === 0) return false;
  const transcriptNorm = normalizeText(segments.map((s) => s.text).join(" "));
  const transcriptSet = new Set(transcriptNorm.split(" ").filter(Boolean));
  let hits = 0;
  for (const tok of Array.from(new Set(candTokens))) {
    if (transcriptSet.has(tok) || (tok.length >= 4 && transcriptNorm.includes(tok))) {
      hits++;
    }
  }
  return hits >= 2 || (candTokens.length <= 4 && hits >= 1);
}

function normalizeMindMapTree(
  raw: unknown,
  fallbackTitle: string,
  depth = 0,
  prefix = "node",
): MindMapNode | null {
  if (!raw || typeof raw !== "object") return null;
  const obj = raw as Record<string, unknown>;
  const label = String(obj.label || obj.title || obj.name || "").trim();
  if (!label && depth > 0) return null;

  const rawChildren = Array.isArray(obj.children) ? obj.children : [];
  const children: MindMapNode[] = [];
  if (depth < 3) {
    rawChildren.slice(0, 5).forEach((child, idx) => {
      const normalized = normalizeMindMapTree(child, "", depth + 1, `${prefix}_${idx + 1}`);
      if (normalized) children.push(normalized);
    });
  }

  return {
    id: typeof obj.id === "string" && obj.id.trim() ? obj.id.trim() : depth === 0 ? "root" : prefix,
    label: (label || fallbackTitle).slice(0, 70),
    description: typeof obj.description === "string" ? obj.description.trim().slice(0, 180) : "",
    ...(children.length > 0 ? { children } : {}),
  };
}

// Generate Structured Summary + Decisions + Action Items strictly grounded in the transcript
export async function generateAiSummary(
  title: string,
  segments: TranscriptSegment[],
  type: "meeting" | "lecture" = "lecture",
  courseCode?: string,
  appLanguage?: "en" | "ar",
): Promise<{
  summary: string;
  executiveSummary?: string;
  detailedSummary?: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: Array<{
    title: string;
    ownerName?: string;
    dueDate?: string;
    sourceTimestamp?: string;
    priority: "high" | "medium" | "low";
  }>;
}> {
  const detectedLang = detectTranscriptLanguage(title, segments);
  const targetLang = appLanguage || detectedLang || "en";
  const isEnglish = targetLang === "en";

  if (!segments || segments.length === 0) {
    return {
      summary: isEnglish
        ? "Not enough transcript available yet to generate summary. Please record or upload a session first."
        : "لا يوجد نص مفرغ كافٍ لإنشاء التلخيص بعد. يرجى تسجيل الجلسة أولاً.",
      keyPoints: [],
      decisions: [],
      actionItems: [],
    };
  }

  const cacheHash = computeTranscriptHash(
    "summary",
    title,
    segments,
    `${type}:${courseCode || ""}:${appLanguage || ""}`,
  );
  const cached = getCachedAiAnalysis<{
    summary: string;
    executiveSummary?: string;
    detailedSummary?: string;
    keyPoints: string[];
    decisions: string[];
    actionItems: Array<{
      title: string;
      ownerName?: string;
      dueDate?: string;
      sourceTimestamp?: string;
      priority: "high" | "medium" | "low";
    }>;
  }>(cacheHash);
  if (cached) return cached;

  const ai = getGeminiClient();
  if (ai) {
    try {
      const preparedTranscript = await prepareTranscriptForLlm(ai, title, segments, 24000);
      const prompt = isEnglish
        ? `You are the MeetMind AI ${type === "lecture" ? "Academic Study" : "Meeting Intelligence"} analyst.
The application interface is set to English. Analyze "${title}" ${courseCode ? `(Course: ${courseCode})` : ""} strictly based ONLY on the transcript below.
Generate ALL user-facing generated content (executive summary, detailed summary, key points, decisions, and action items) in fluent, natural English.
STRICT GROUNDING RULES — ZERO HALLUCINATION POLICY:
1. You MUST only use information from the provided transcript. Do NOT invent, hallucinate, or add information not present in the transcript.
2. NEVER invent names, numbers, dates, tasks, decisions, or facts not explicitly stated in the transcript.
3. For actionItems, if no responsible person is explicitly named in the transcript, set "ownerName" to "Not specified". If no deadline is stated, set "dueDate" to "Not specified".
4. Preserve all English technical terms verbatim exactly as they appear in the transcript.
5. If the transcript is too short to generate meaningful content in a section, omit that section rather than generating placeholder text.
6. If a section has no relevant content in the transcript, omit it rather than generating placeholder text.
7. If the transcript is too short to generate N keyPoints, generate only as many as the transcript supports.
6. If a section has no relevant content in the transcript, omit it rather than generating placeholder text.
7. If the transcript is too short to generate N keyPoints, generate only as many as the transcript supports.

Transcript:
"""
${preparedTranscript}
"""

Return ONLY a valid JSON object matching this exact schema:
{
  "executiveSummary": "Concise 2-4 sentence executive overview grounded strictly in the transcript",
  "detailedSummary": "Well-structured Markdown summary with headings (# Executive Summary, ## Key Points, ## Detailed Topics, ## Definitions & Terms, ## Decisions & Action Items, ## Highlighted Takeaways) — omit any heading where no relevant content exists in the transcript",
  "keyPoints": ["Grounded key point 1", "Grounded key point 2"],
  "decisions": ["Explicit decision stated in transcript (empty array if none)"],
  "actionItems": [
    {
      "title": "Exact task or commitment from transcript",
      "ownerName": "Named person or Not specified",
      "dueDate": "Stated deadline or Not specified",
      "sourceTimestamp": "MM:SS",
      "priority": "high"
    }
  ]
}`
        : `أنت المحلل الذكي المتخصص في منصة MeetMind AI.
حلل ولخّص جلسة "${title}" ${courseCode ? `(مقرر: ${courseCode})` : ""} بناءً حصراً على النص المفرغ الفعلي التالي.
سياسة صفر اختلاق — القواعد الصارمة:
1. يجب أن تستخدم فقط المعلومات الواردة في النص المفرغ المُقدَّم. لا تخترع أو تهلوس أو تضيف أي معلومات غير موجودة في النص.
2. لا تختلق أو تخمّن أي أسماء أو أرقام أو قرارات أو مهام أو حقائق لم تُذكر صراحة في النص المفرغ.
3. في قائمة المهام (actionItems): إذا لم يُذكر اسم المسؤول صراحة اكتب "Not specified"، وإذا لم يُذكر موعد تسليم اكتب "Not specified".
4. حافظ على المصطلحات التقنية الإنجليزية (مثل API و .NET و React و Python و FastAPI و SignalR و SQL Server) كما وردت بالضبط.
5. إذا كان النص المفرغ قصيراً جداً بحيث لا يمكن توليد محتوى ذي معنى في قسم ما، احذف ذلك القسم بدلاً من توليد نص عشوائي.
6. إذا لم يكن هناك محتوى ذو صلة في النص المفرغ لأحد الأقسام، احذف ذلك القسم بدلاً من توليد نص بديل.

النص المفرغ:
"""
${preparedTranscript}
"""

أرجع كائن JSON صالحاً فقط بهذا الهيكل الدقيق:
{
  "executiveSummary": "ملخص تنفيذي مكثف من 2 إلى 4 جمل مستند حصراً للنص المفرغ",
  "detailedSummary": "ملخص منسق بصيغة Markdown يحتوي على العناوين: # الفكرة العامة، ## أهم النقاط، ## شرح مختصر للموضوعات، ## التعريفات والمصطلحات المهمة، ## القرارات والمهام إن وجدت، ## النقاط التي أكد المتحدث على أهميتها — احذف أي عنوان ليس له محتوى في النص",
  "keyPoints": ["أهم نقطة مستخلصة من النص 1", "نقطة 2"],
  "decisions": ["قرار صريح تم الاتفاق عليه في النص (أو مصفوفة فارغة إن لم يوجد)"],
  "actionItems": [
    {
      "title": "المهمة أو المطلوب تنفيذه كما ورد في النص",
      "ownerName": "اسم الشخص المذكور أو Not specified",
      "dueDate": "الموعد المذكور أو Not specified",
      "sourceTimestamp": "MM:SS",
      "priority": "high"
    }
  ]
}`;

      const config = getGeminiConfig();
      const { result: response } = await executeWithRetryAndFallback(
        "generateAiSummary",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        },
        {
          primaryModel: config.textModel,
          fallbackModel: config.fallbackTextModel,
          maxRetries: 0,
          baseDelayMs: 100,
          maxDelayMs: 150,
        },
      );

      const rawText = (response.text || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      if (!rawText) {
        throw new GeminiPipelineError("AI summary model returned empty text.", {
          model: config.textModel,
          retryable: true,
          operation: "generateAiSummary",
        });
      }

      const parsed = JSON.parse(rawText) as {
        executiveSummary?: string;
        detailedSummary?: string;
        keyPoints?: unknown[];
        decisions?: unknown[];
        actionItems?: Array<{
          title?: string;
          ownerName?: string;
          dueDate?: string;
          sourceTimestamp?: string;
          priority?: string;
        }>;
      };

      const detailed = String(parsed.detailedSummary || parsed.executiveSummary || "").trim();
      const executive = String(parsed.executiveSummary || detailed).trim();
      const keyPoints = Array.isArray(parsed.keyPoints)
        ? parsed.keyPoints.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const decisions = Array.isArray(parsed.decisions)
        ? parsed.decisions.map((x) => String(x || "").trim()).filter(Boolean)
        : [];
      const actionItems = Array.isArray(parsed.actionItems)
        ? parsed.actionItems
            .filter((a) => a && typeof a.title === "string" && a.title.trim())
            .map((a) => ({
              title: a.title!.trim(),
              ownerName:
                a.ownerName && String(a.ownerName).trim() && String(a.ownerName).trim() !== "null"
                  ? String(a.ownerName).trim()
                  : "Not specified",
              dueDate:
                a.dueDate && String(a.dueDate).trim() && String(a.dueDate).trim() !== "null"
                  ? String(a.dueDate).trim()
                  : "Not specified",
              sourceTimestamp: a.sourceTimestamp ? String(a.sourceTimestamp).trim() : undefined,
              priority: (["high", "medium", "low"].includes(String(a.priority || "").toLowerCase())
                ? String(a.priority).toLowerCase()
                : "medium") as "high" | "medium" | "low",
            }))
        : [];

      if (!detailed && keyPoints.length === 0) {
        throw new GeminiPipelineError("AI summary model returned incomplete structure.", {
          model: config.textModel,
          retryable: true,
          operation: "generateAiSummary",
        });
      }

      const finalResult = {
        summary: detailed || executive,
        executiveSummary: executive || detailed,
        detailedSummary: detailed || executive,
        keyPoints:
          keyPoints.length > 0 ? keyPoints.slice(0, 8) : segments.slice(0, 4).map((s) => s.text),
        decisions,
        actionItems,
      };
      setCachedAiAnalysis(cacheHash, "summary", config.textModel, finalResult);
      return finalResult;
    } catch (err) {
      suspendGeminiIfUnavailableError(err);
      logGeminiStructured({
        level: "warn",
        event: "gemini_summary_fallback_builtin",
        operation: "generateAiSummary",
        model: getGeminiConfig().textModel,
        status: extractHttpStatus(err),
        finalFailureReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Tier 2: Hybrid Fast Local LLM Summary — crisp plain-text abstractive executive overview
  // from Gemma 3 1B (~7-10s, zero JSON syntax overhead) combined with instant grounded facts/actions.
  const builtInRef = buildBuiltInSummary(title, segments, type, courseCode, appLanguage);
  const localTranscript = formatCompactTranscriptForLocalLlm(segments, 1800);
  if (localTranscript) {
    const factsHint =
      builtInRef.keyPoints.length > 0
        ? `\n[Extracted Facts]\n${builtInRef.keyPoints
            .slice(0, 6)
            .map((p) => `- ${p}`)
            .join("\n")}`
        : "";
    const localSummarySystem = isEnglish
      ? "You are MeetMind AI. Write a sharp 2-sentence executive summary grounded strictly in the transcript. Preserve exact names, locations, and figures. No headings, no intro filler."
      : "أنت مساعد MeetMind AI. اكتب ملخصاً تنفيذياً دقيقاً من جملتين فقط باللغة العربية الفصحى مستنداً حصراً إلى النص المفرغ مع الحفاظ على الأسماء والأماكن والأرقام بدقة، بدون مقدمات أو عناوين.";
    const localSummaryUser = isEnglish
      ? `Summarize "${title}"${courseCode ? ` (${courseCode})` : ""} in 2 concise sentences:\n"""\n${localTranscript}${factsHint}\n"""`
      : `لخّص تسجيل «${title}»${courseCode ? ` (${courseCode})` : ""} في جملتين واضحتين ودقيقتين:\n"""\n${localTranscript}${factsHint}\n"""`;

    const abstractiveExec = await generateLocalLlmText({
      systemPrompt: localSummarySystem,
      userPrompt: localSummaryUser,
      maxNewTokens: 95,
      temperature: 0,
      timeoutMs: 25000,
    });

    const cleanedExec = (abstractiveExec || "")
      .replace(/^#+\s*/gm, "")
      .replace(/\s+/g, " ")
      .trim();

    if (cleanedExec.length >= 20 && hasTranscriptOverlap(cleanedExec, segments)) {
      const keyPoints = builtInRef.keyPoints;
      const decisions = builtInRef.decisions;
      const actionItems = builtInRef.actionItems;

      const markdownBlocks: string[] = [];
      if (isEnglish) {
        markdownBlocks.push(`# Executive Summary\n${cleanedExec}`);
        if (keyPoints.length > 0) {
          markdownBlocks.push(`## Key Points\n${keyPoints.map((p) => `- ${p}`).join("\n")}`);
        }
        if (decisions.length > 0) {
          markdownBlocks.push(`## Decisions\n${decisions.map((d) => `- ${d}`).join("\n")}`);
        }
        if (actionItems.length > 0) {
          markdownBlocks.push(
            `## Action Items\n${actionItems.map((a) => `- ${a.title}${a.ownerName ? ` (${a.ownerName})` : ""}`).join("\n")}`,
          );
        }
      } else {
        markdownBlocks.push(`# الملخص التنفيذي\n${cleanedExec}`);
        if (keyPoints.length > 0) {
          markdownBlocks.push(
            `## أبرز النقاط المستخلصة\n${keyPoints.map((p) => `- ${p}`).join("\n")}`,
          );
        }
        if (decisions.length > 0) {
          markdownBlocks.push(`## القرارات\n${decisions.map((d) => `- ${d}`).join("\n")}`);
        }
        if (actionItems.length > 0) {
          markdownBlocks.push(
            `## المهام والتوصيات\n${actionItems.map((a) => `- ${a.title}${a.ownerName ? ` (${a.ownerName})` : ""}`).join("\n")}`,
          );
        }
      }

      const detailed = markdownBlocks.join("\n\n");
      const localResult = {
        summary: detailed,
        executiveSummary: cleanedExec,
        detailedSummary: detailed,
        keyPoints,
        decisions,
        actionItems,
      };
      setCachedAiAnalysis(cacheHash, "summary", getLocalLlmModelId(), localResult);
      return localResult;
    }
  }

  // Tier 3: Upgraded Deep Bilingual Analytical Engine (returned without poisoning 7-day LLM cache)
  return builtInRef;
}

/**
 * Verifies that a generated quiz question is genuinely grounded in the actual
 * transcript text. Rejects hallucinated questions whose evidence/answer terms
 * do not appear in the canonical transcript.
 */
export function verifyQuizQuestionGrounding(
  question: {
    question: string;
    type?: string;
    options?: string[];
    correctOptionIndex?: number;
    correctAnswerText?: string;
    explanation?: string;
    sourceTranscriptSegment?: string;
  },
  segments: TranscriptSegment[],
): { grounded: boolean; matchedSegmentText?: string; matchedTimestamp?: string } {
  if (!segments || segments.length === 0) return { grounded: false };

  const normalizedSegments = segments.map((s) => ({
    raw: s,
    norm: normalizeArabicAndLatin(s.text),
    tokens: new Set(
      normalizeArabicAndLatin(s.text)
        .split(" ")
        .filter((t) => t.length >= 2),
    ),
  }));
  const fullNormTranscript = normalizedSegments.map((s) => s.norm).join(" ");
  const fullTokenSet = new Set<string>();
  for (const s of normalizedSegments) {
    for (const t of s.tokens) fullTokenSet.add(t);
  }

  // 1. Check direct evidence quote (`sourceTranscriptSegment`) if provided
  if (question.sourceTranscriptSegment && question.sourceTranscriptSegment.trim().length >= 6) {
    const quoteNorm = normalizeArabicAndLatin(question.sourceTranscriptSegment);
    if (
      quoteNorm &&
      fullNormTranscript.includes(quoteNorm.slice(0, Math.min(28, quoteNorm.length)))
    ) {
      const hit = normalizedSegments.find(
        (s) => s.norm.includes(quoteNorm.slice(0, 20)) || quoteNorm.includes(s.norm.slice(0, 20)),
      );
      return {
        grounded: true,
        matchedSegmentText: hit?.raw.text || question.sourceTranscriptSegment,
        matchedTimestamp: hit ? formatMmSs(hit.raw.startTime) : undefined,
      };
    }

    const quoteTokens = quoteNorm.split(" ").filter((t) => t.length >= 3);
    if (quoteTokens.length >= 2) {
      const matched = quoteTokens.filter((t) => fullTokenSet.has(t));
      if (matched.length / quoteTokens.length >= 0.45) {
        const bestSeg = normalizedSegments
          .map((s) => ({
            s,
            score: quoteTokens.filter((t) => s.tokens.has(t)).length,
          }))
          .sort((a, b) => b.score - a.score)[0];
        return {
          grounded: true,
          matchedSegmentText: bestSeg?.s.raw.text || question.sourceTranscriptSegment,
          matchedTimestamp: bestSeg ? formatMmSs(bestSeg.s.raw.startTime) : undefined,
        };
      }
    }
  }

  // 2. Fallback verification: verify factual tokens in answer + question + explanation against transcript
  const selectedOption =
    Array.isArray(question.options) &&
    typeof question.correctOptionIndex === "number" &&
    question.options[question.correctOptionIndex]
      ? question.options[question.correctOptionIndex]
      : "";
  const probeText = `${question.correctAnswerText || ""} ${selectedOption} ${question.question || ""} ${question.explanation || ""}`;
  const probeTokens = normalizeArabicAndLatin(probeText)
    .split(" ")
    .filter((t) => t.length >= 3);

  if (probeTokens.length === 0) return { grounded: false };

  let bestSeg = normalizedSegments[0];
  let bestScore = 0;
  let totalMatched = 0;
  const uniqueProbe = Array.from(new Set(probeTokens));
  for (const t of uniqueProbe) {
    if (fullTokenSet.has(t)) totalMatched++;
  }
  for (const seg of normalizedSegments) {
    const score = uniqueProbe.filter((t) => seg.tokens.has(t)).length;
    if (score > bestScore) {
      bestScore = score;
      bestSeg = seg;
    }
  }

  const grounded =
    bestScore >= 2 || (totalMatched >= 2 && totalMatched / uniqueProbe.length >= 0.2);
  return {
    grounded,
    matchedSegmentText: grounded ? bestSeg?.raw.text : undefined,
    matchedTimestamp: grounded && bestSeg ? formatMmSs(bestSeg.raw.startTime) : undefined,
  };
}

// Generate Quiz directly grounded in the transcript and summary (with automated grounding validation)
export async function generateAiQuiz(
  title: string,
  segments: TranscriptSegment[],
  summaryText?: string,
  courseCode?: string,
  options?: {
    avoidQuestionTitles?: string[];
    variant?: number;
    difficulty?: "all" | "easy" | "medium" | "hard";
    appLanguage?: "en" | "ar";
    numQuestions?: number;
  },
): Promise<{
  title: string;
  courseCode?: string;
  questions: Array<{
    id: string;
    question: string;
    type: "multiple_choice" | "true_false" | "short_answer" | "fill_in_the_blank";
    options: string[];
    correctOptionIndex: number;
    correctAnswerText?: string;
    acceptableAnswers?: string[];
    explanation: string;
    difficulty: "easy" | "medium" | "hard";
    sectionRef: string;
    timestampRef?: string;
    sourceReference?: string;
    sourceTranscriptSegment?: string;
    groundingVerified?: boolean;
  }>;
}> {
  const detectedLang = detectTranscriptLanguage(title, segments);
  const targetLang = options?.appLanguage || detectedLang || "en";
  const isEnglish = targetLang === "en";
  const ai = getGeminiClient();
  const variant = options?.variant || 1;
  const totalWords = segments
    .map((s) => s.text)
    .join(" ")
    .trim()
    .split(/\s+/)
    .filter(Boolean).length;
  const defaultQuestionCount =
    totalWords < 50 ? 4 : totalWords < 150 ? 6 : totalWords < 300 ? 8 : 10;
  const requestedCount =
    typeof options?.numQuestions === "number" && Number.isFinite(options.numQuestions)
      ? Math.min(20, Math.max(1, Math.round(options.numQuestions)))
      : defaultQuestionCount;

  const cacheHash = computeTranscriptHash(
    "quiz",
    title,
    segments,
    `${courseCode || ""}:${options?.appLanguage || ""}:${requestedCount}:${options?.difficulty || "all"}`,
  );
  const canUseCache =
    (!options?.avoidQuestionTitles || options.avoidQuestionTitles.length === 0) && variant === 1;
  if (canUseCache) {
    const cached = getCachedAiAnalysis<{
      title: string;
      courseCode?: string;
      questions: Array<{
        id: string;
        question: string;
        type: "multiple_choice" | "true_false" | "short_answer" | "fill_in_the_blank";
        options: string[];
        correctOptionIndex: number;
        correctAnswerText?: string;
        acceptableAnswers?: string[];
        explanation: string;
        difficulty: "easy" | "medium" | "hard";
        sectionRef: string;
        timestampRef?: string;
        sourceReference?: string;
        sourceTranscriptSegment?: string;
        groundingVerified?: boolean;
      }>;
    }>(cacheHash);
    if (cached) return cached;
  }

  if (ai && segments.length > 0) {
    try {
      const preparedTranscript = await prepareTranscriptForLlm(ai, title, segments, 24000);
      const avoidList = (options?.avoidQuestionTitles || []).slice(0, 15).join(" | ");
      const langDirective =
        detectedLang === "en"
          ? "Generate ALL questions, options, and explanations in clear English matching the transcript."
          : "أنشئ الأسئلة والخيارات والشروحات باللغة العربية مع الحفاظ على المصطلحات التقنية كما وردت.";
      const targetQuestionRange = options?.numQuestions
        ? `exactly ${requestedCount}`
        : totalWords < 50
          ? "3 to 5"
          : totalWords < 150
            ? "6 to 10"
            : totalWords < 300
              ? "10 to 15"
              : `up to ${Math.min(20, Math.max(3, Math.floor(totalWords / 20)))}`;

      const prompt = isEnglish
        ? `You are an elite academic assessment designer and test examiner at MeetMind AI.
Strict Mission: Generate a grounded practice quiz of ${targetQuestionRange} questions (up to 20 maximum) strictly covering ONLY the transcript for session: "${title}" ${courseCode ? `(Course: ${courseCode})` : ""}.
Generate ALL questions, options, and explanations in fluent, clear English.
ZERO HALLUCINATION & TRANSCRIPT GROUNDING RULES:
1. Every question and its correct answer MUST be 100% grounded in facts explicitly stated in the transcript below.
2. If the transcript is brief, do NOT invent questions. Produce only as many questions as the transcript legitimately supports.
3. Include the "sourceTranscriptSegment" field with an exact verbatim quote from the transcript proving the answer.
4. Accepted types:
   - "multiple_choice": question with 4 distinct options (1 correct, 3 plausible but incorrect distractors from context).
   - "true_false": unambiguous declarative statement, options: ["True", "False"].
5. Include sectionRef and timestampRef.
6. ${avoidList ? `Avoid repeating these questions: ${avoidList}` : `This is variant ${variant} of the quiz.`}

Transcript:
"""
${preparedTranscript}
"""

Summary Context:
"""
${summaryText || ""}
"""

Return ONLY a JSON array matching:
[
  {
    "question": "Question in English...",
    "type": "multiple_choice",
    "options": ["Option 1", "Option 2", "Option 3", "Option 4"],
    "correctOptionIndex": 0,
    "correctAnswerText": "Option 1",
    "acceptableAnswers": [],
    "explanation": "Clear explanation in English...",
    "difficulty": "medium",
    "sectionRef": "Section 1",
    "timestampRef": "00:15",
    "sourceTranscriptSegment": "exact verbatim quote from transcript"
  }
]`
        : `أنت بروفيسور وخبير تقييم أكاديمي في منصة MeetMind AI.
المهمة الصارمة: أنشئ اختباراً موثقاً من ${targetQuestionRange} أسئلة (بحد أقصى 20 سؤالاً) يغطي المحتوى الفعلي فقط لجلسة: "${title}".
${langDirective}

القواعد الصارمة لمنع الاختلاق وتثبيت التوثيق (ZERO HALLUCINATION & TRANSCRIPT GROUNDING):
1. كل سؤال وإجابته الصحيحة يجب أن يستندا بنسبة 100% إلى حقيقة مذكورة صراحةً في النص المفرغ أدناه.
2. إذا كان النص المفرغ قصيراً فلا تخترع أسئلة إضافية من خارج النص إطلاقاً — اكتفِ بعدد الأسئلة التي يدعمها النص فعلياً فقط (مثلاً 14 أو 10 أسئلة ولا تملأ بفراغ وهمي).
3. أدرج لكل سؤال الحقل "sourceTranscriptSegment" بنص حرفي مقتبس مباشرة من النص المفرغ يثبت الإجابة الصحيحة.
4. الأنواع المعتمدة حصراً:
   - "multiple_choice": سؤال مع 4 خيارات دقيقة ومتباينة (خيار واحد صحيح و3 مشتتات منطقية من سياق المحتوى ولكنها خاطئة بدقة).
   - "true_false": عبارة قاطعة لا لبس فيها، والخيارات ["صح (صواب)", "خطأ"].
5. حدد القسم والزمن الفعلي (sectionRef، timestampRef).
6. ${avoidList ? `تجنب تكرار هذه الأسئلة التي طُرحت سابقاً: ${avoidList}` : `هذا الإصدار ${variant} من الاختبار.`}

النص المفرغ:
"""
${preparedTranscript}
"""

الملخص التوجيهي:
"""
${summaryText || ""}
"""

أرجع مصفوفة JSON فقط بالشكل التالي:
[
  {
    "question": "...",
    "type": "multiple_choice",
    "options": ["...", "...", "...", "..."],
    "correctOptionIndex": 0,
    "correctAnswerText": "...",
    "acceptableAnswers": [],
    "explanation": "...",
    "difficulty": "medium",
    "sectionRef": "...",
    "timestampRef": "00:15",
    "sourceTranscriptSegment": "exact verbatim quote from transcript"
  }
]`;

      const config = getGeminiConfig();
      const { result: response } = await executeWithRetryAndFallback(
        "generateAiQuiz",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        },
        {
          primaryModel: config.textModel,
          fallbackModel: config.fallbackTextModel,
          maxRetries: 0,
          baseDelayMs: 100,
          maxDelayMs: 150,
        },
      );

      const jsonStr = (response.text || "")
        .replace(/^```(?:json)?\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
      const parsed = JSON.parse(jsonStr);
      if (Array.isArray(parsed) && parsed.length > 0) {
        const seenQuestions = new Set<string>();
        const verifiedQuestions = parsed
          .map((q, idx) => {
            const rawQ = String(q.question || "").trim();
            if (!rawQ) return null;
            const normQ = normalizeArabicAndLatin(rawQ);
            if (seenQuestions.has(normQ)) return null;
            seenQuestions.add(normQ);

            const qType: "multiple_choice" | "true_false" =
              q.type === "true_false" ? "true_false" : "multiple_choice";

            let options: string[] = [];
            let correctOptionIndex =
              typeof q.correctOptionIndex === "number" ? q.correctOptionIndex : 0;

            if (qType === "multiple_choice") {
              const rawOpts = Array.isArray(q.options)
                ? q.options.map((o: unknown) => String(o).trim())
                : [];
              const uniqueOpts: string[] = Array.from(new Set(rawOpts)).filter((x): x is string =>
                Boolean(x),
              );
              if (uniqueOpts.length < 4) return null; // Reject incomplete or duplicate options
              options = uniqueOpts.slice(0, 4);
              if (correctOptionIndex < 0 || correctOptionIndex >= 4) correctOptionIndex = 0;
            } else {
              options = isEnglish ? ["True", "False"] : ["صح (صواب)", "خطأ"];
              if (correctOptionIndex !== 0 && correctOptionIndex !== 1) correctOptionIndex = 0;
            }

            const verification = verifyQuizQuestionGrounding(
              { ...q, question: rawQ, options, correctOptionIndex },
              segments,
            );
            if (!verification.grounded) return null;

            const resolvedTs = q.timestampRef || verification.matchedTimestamp || "00:00";
            const resolvedQuote =
              q.sourceTranscriptSegment || verification.matchedSegmentText || "";

            return {
              id: `q_${Date.now()}_${idx + 1}`,
              question: rawQ,
              type: qType,
              options,
              correctOptionIndex,
              correctAnswerText: q.correctAnswerText || options[correctOptionIndex],
              acceptableAnswers: [options[correctOptionIndex]],
              explanation:
                q.explanation ||
                (detectedLang === "en"
                  ? `Directly verified at [${resolvedTs}] from the transcript.`
                  : `موثق ومستخرج مباشرة من نص الجلسة عند [${resolvedTs}].`),
              difficulty: (["easy", "medium", "hard"].includes(q.difficulty)
                ? q.difficulty
                : "medium") as "easy" | "medium" | "hard",
              sectionRef:
                q.sectionRef || (detectedLang === "en" ? "Transcript Section" : "محاور الجلسة"),
              timestampRef: resolvedTs,
              sourceReference: `${q.sectionRef || "Transcript"} [${resolvedTs}]`,
              sourceTranscriptSegment: resolvedQuote,
              groundingVerified: true,
            };
          })
          .filter((item): item is NonNullable<typeof item> => Boolean(item && item.question));

        if (verifiedQuestions.length > 0) {
          const finalResult = {
            title:
              detectedLang === "en"
                ? `Comprehension Quiz (${variant > 1 ? `Variant ${variant}` : "Main"}): ${title}`
                : `اختبار الفهم الشامل (${variant > 1 ? `النموذج ${variant}` : "النموذج الرئيسي"}): ${title}`,
            courseCode,
            questions: verifiedQuestions,
          };
          if (canUseCache) {
            setCachedAiAnalysis(cacheHash, "quiz", config.textModel, finalResult);
          }
          return finalResult;
        }
      }
    } catch (e) {
      suspendGeminiIfUnavailableError(e);
      console.warn("Gemini quiz generation error, using grounded generator:", e);
    }
  }

  // Hybrid Fast-Path: when the transcript has dense structured specs/entities/definitions/cloze
  // facts that already satisfy requestedCount with zero raw-clause fallbacks, return instantaneously (<10ms).
  const builtInQuizCandidate = buildBuiltInQuiz(title, segments, {
    courseCode,
    appLanguage: isEnglish ? "en" : "ar",
    numQuestions: requestedCount,
    variant,
    avoidQuestionTitles: options?.avoidQuestionTitles,
    difficulty: options?.difficulty,
  });
  const highSignalBuiltInCount = builtInQuizCandidate.questions.filter(
    (q) => !q.id.startsWith("q_tf_cl_"),
  ).length;
  if (
    highSignalBuiltInCount >= requestedCount &&
    builtInQuizCandidate.questions.length >= requestedCount
  ) {
    if (canUseCache) {
      setCachedAiAnalysis(cacheHash, "quiz", "meetmind-grounded-hybrid", builtInQuizCandidate);
    }
    return builtInQuizCandidate;
  }

  // Tier 2: Real Embedded Local LLM Quiz Generator (for prose/conceptual transcripts lacking structured specs)
  const localTranscript = formatCompactTranscriptForLocalLlm(segments, 1500);
  if (localTranscript && segments.length > 0) {
    const llmQuestionCount = Math.min(requestedCount, 2);
    const localQuizSystem = isEnglish
      ? "You are an exam designer for MeetMind AI. Write concise factual MCQ questions strictly from the transcript. Copy exact figures and terms from the transcript for correctAnswer."
      : "أنت مصمم اختبارات في MeetMind AI. اكتب أسئلة اختيار من متعدد دقيقة مبنية حصراً على النص المفرغ. انسخ القيمة أو المصطلح الحقيقي من النص تماماً في حقل correctAnswer بدون أي تغيير أو اختلاق.";

    const localQuizUser = isEnglish
      ? `Create ${llmQuestionCount} MCQ questions strictly from "${title}":\n"""\n${localTranscript}\n"""\n\nReturn ONLY a JSON array where each object has: question (string), correctAnswer (exact short fact/value from transcript), distractors (array of 3 plausible WRONG strings distinct from correctAnswer), explanation (1 short sentence).`
      : `أنشئ ${llmQuestionCount} أسئلة اختيار من متعدد باللغة العربية مبنية حصراً على الحقائق والأرقام في النص التالي لتسجيل «${title}»:\n"""\n${localTranscript}\n"""\n\nأخرج مصفوفة JSON فقط، كل عنصر به الحقول: question (سؤال واضح)، correctAnswer (الإجابة الصحيحة القصيرة والمطابقة تماماً للنص)، distractors (مصفوفة من 3 خيارات خاطئة ومختلفة تماماً)، explanation (جملة قصيرة).`;

    const parsedLocalQuiz = await generateLocalLlmJson<unknown>({
      systemPrompt: localQuizSystem,
      userPrompt: localQuizUser,
      maxNewTokens: 165,
      timeoutMs: 30000,
    });

    const rawList = Array.isArray(parsedLocalQuiz)
      ? parsedLocalQuiz
      : parsedLocalQuiz &&
          typeof parsedLocalQuiz === "object" &&
          Array.isArray((parsedLocalQuiz as { questions?: unknown[] }).questions)
        ? (parsedLocalQuiz as { questions: unknown[] }).questions
        : [];

    if (rawList.length > 0) {
      const seenQuestions = new Set<string>(
        (options?.avoidQuestionTitles || []).map((q) => normalizeArabicAndLatin(q)),
      );
      const transcriptNorm = normalizeText(segments.map((s) => s.text).join(" "));
      const transcriptTokenSet = new Set(transcriptNorm.split(" ").filter(Boolean));

      const isAnswerGroundedInTranscript = (ans: string): boolean => {
        const normAns = normalizeText(ans);
        if (!normAns) return false;
        if (transcriptNorm.includes(normAns)) return true;
        const toks = normAns.split(" ").filter((t) => t.length >= 2 || /\d/.test(t));
        if (toks.length === 0) return false;
        // Every numeric token in the correct answer MUST appear in the transcript (blocks hallucinated 800000 vs 7)
        const numToks = toks.filter((t) => /\d/.test(t));
        if (numToks.some((nt) => !transcriptTokenSet.has(nt) && !transcriptNorm.includes(nt))) {
          return false;
        }
        const matched = toks.filter(
          (t) => transcriptTokenSet.has(t) || (t.length >= 4 && transcriptNorm.includes(t)),
        );
        return matched.length / toks.length >= 0.5;
      };

      const verifiedLocal = rawList
        .map((item, idx) => {
          if (!item || typeof item !== "object") return null;
          const q = item as Record<string, unknown>;
          const rawQ = String(q.question || "").trim();
          if (rawQ.length < 10) return null;
          const normQ = normalizeArabicAndLatin(rawQ);
          if (seenQuestions.has(normQ)) return null;
          seenQuestions.add(normQ);

          const qType: "multiple_choice" | "true_false" =
            q.type === "true_false" ? "true_false" : "multiple_choice";

          let qOptions: string[] = [];
          let correctOptionIndex = 0;

          if (qType === "multiple_choice") {
            const explicitCorrect =
              typeof q.correctAnswer === "string" ? q.correctAnswer.trim() : "";
            const explicitDistractors = Array.isArray(q.distractors)
              ? q.distractors.map((d: unknown) => String(d || "").trim()).filter(Boolean)
              : [];

            if (explicitCorrect && explicitDistractors.length >= 3) {
              if (!isAnswerGroundedInTranscript(explicitCorrect)) return null;
              const seenOptNorms = new Set<string>([normalizeArabicAndLatin(explicitCorrect)]);
              const cleanDistractors: string[] = [];
              for (const d of explicitDistractors) {
                const dn = normalizeArabicAndLatin(d);
                if (dn && !seenOptNorms.has(dn)) {
                  seenOptNorms.add(dn);
                  cleanDistractors.push(d);
                }
              }
              if (cleanDistractors.length < 3) return null;
              // Deterministically rotate correct option slot so correct answer isn't always index 0
              const slot = (idx + variant) % 4;
              const ordered = [explicitCorrect, ...cleanDistractors.slice(0, 3)];
              const tmp = ordered[0];
              ordered[0] = ordered[slot];
              ordered[slot] = tmp;
              qOptions = ordered;
              correctOptionIndex = slot;
            } else {
              const rawOpts = Array.isArray(q.options)
                ? q.options.map((o: unknown) => String(o || "").trim()).filter(Boolean)
                : [];
              const seenOptNorms = new Set<string>();
              const uniqueOpts: string[] = [];
              for (const o of rawOpts) {
                const on = normalizeArabicAndLatin(o);
                if (on && !seenOptNorms.has(on)) {
                  seenOptNorms.add(on);
                  uniqueOpts.push(o);
                }
              }
              if (uniqueOpts.length < 4) return null;
              qOptions = uniqueOpts.slice(0, 4);
              correctOptionIndex =
                typeof q.correctOptionIndex === "number" &&
                Number.isInteger(q.correctOptionIndex) &&
                q.correctOptionIndex >= 0 &&
                q.correctOptionIndex < 4
                  ? q.correctOptionIndex
                  : 0;
              // If the chosen index isn't grounded but another option IS grounded (off-by-one LLM bug), reject or fix only when unambiguous
              if (!isAnswerGroundedInTranscript(qOptions[correctOptionIndex])) {
                const groundedIdx = qOptions.findIndex((opt) => isAnswerGroundedInTranscript(opt));
                if (groundedIdx === -1) return null;
                correctOptionIndex = groundedIdx;
              }
            }
          } else {
            qOptions = isEnglish ? ["True", "False"] : ["صح (صواب)", "خطأ"];
            correctOptionIndex = q.correctOptionIndex === 1 ? 1 : 0;
          }

          const verification = verifyQuizQuestionGrounding(
            {
              question: rawQ,
              type: qType,
              options: qOptions,
              correctOptionIndex,
              correctAnswerText: qOptions[correctOptionIndex],
              explanation: typeof q.explanation === "string" ? q.explanation : undefined,
              sourceTranscriptSegment:
                typeof q.sourceTranscriptSegment === "string"
                  ? q.sourceTranscriptSegment
                  : undefined,
            },
            segments,
          );
          if (!verification.grounded) return null;

          const resolvedTs =
            (typeof q.timestampRef === "string" && q.timestampRef.trim()) ||
            verification.matchedTimestamp ||
            "00:00";
          const resolvedQuote =
            (typeof q.sourceTranscriptSegment === "string" && q.sourceTranscriptSegment.trim()) ||
            verification.matchedSegmentText ||
            "";

          return {
            id: `q_llm_${Date.now()}_${idx + 1}`,
            question: rawQ,
            type: qType,
            options: qOptions,
            correctOptionIndex,
            correctAnswerText: qOptions[correctOptionIndex],
            acceptableAnswers: [qOptions[correctOptionIndex]],
            explanation:
              (typeof q.explanation === "string" && q.explanation.trim()) ||
              (isEnglish
                ? `Verified directly in transcript at [${resolvedTs}].`
                : `موثق مباشرةً في النص المفرغ عند [${resolvedTs}].`),
            difficulty: (["easy", "medium", "hard"].includes(String(q.difficulty || ""))
              ? String(q.difficulty)
              : "medium") as "easy" | "medium" | "hard",
            sectionRef:
              (typeof q.sectionRef === "string" && q.sectionRef.trim()) ||
              (isEnglish ? "Transcript Concept" : "محاور الجلسة"),
            timestampRef: resolvedTs,
            sourceReference: `${isEnglish ? "Transcript" : "النص المفرغ"} [${resolvedTs}]`,
            sourceTranscriptSegment: resolvedQuote,
            groundingVerified: true,
          };
        })
        .filter((item): item is NonNullable<typeof item> => Boolean(item));

      if (verifiedLocal.length > 0) {
        let finalQuestions: Array<{
          id: string;
          question: string;
          type: "multiple_choice" | "true_false" | "short_answer" | "fill_in_the_blank";
          options: string[];
          correctOptionIndex: number;
          correctAnswerText?: string;
          acceptableAnswers?: string[];
          explanation: string;
          difficulty: "easy" | "medium" | "hard";
          sectionRef: string;
          timestampRef?: string;
          sourceReference?: string;
          sourceTranscriptSegment?: string;
          groundingVerified?: boolean;
        }> = verifiedLocal.slice(0, requestedCount);
        if (finalQuestions.length < requestedCount) {
          const topUp = buildBuiltInQuiz(title, segments, {
            courseCode,
            appLanguage: isEnglish ? "en" : "ar",
            numQuestions: requestedCount - finalQuestions.length,
            variant,
            avoidQuestionTitles: [
              ...(options?.avoidQuestionTitles || []),
              ...finalQuestions.map((q) => q.question),
            ],
            difficulty: options?.difficulty,
          });
          finalQuestions = [...finalQuestions, ...topUp.questions].slice(0, requestedCount);
        }

        const localQuizResult = {
          title: isEnglish
            ? `Comprehension Quiz (${variant > 1 ? `Variant ${variant}` : "Main"}): ${title}`
            : `اختبار الفهم الشامل (${variant > 1 ? `النموذج ${variant}` : "النموذج الرئيسي"}): ${title}`,
          courseCode,
          questions: finalQuestions,
        };
        if (canUseCache) {
          setCachedAiAnalysis(cacheHash, "quiz", getLocalLlmModelId(), localQuizResult);
        }
        return localQuizResult;
      }
    }
  }

  // Tier 3: Upgraded Grounded Concept & Specification Quiz Engine (no cache poison)
  return buildBuiltInQuiz(title, segments, {
    courseCode,
    appLanguage: isEnglish ? "en" : "ar",
    numQuestions: requestedCount,
    variant,
    avoidQuestionTitles: options?.avoidQuestionTitles,
    difficulty: options?.difficulty,
  });
}

// Generate Detailed Lecture/Meeting Analysis in Arabic
export async function generateAiLectureAnalysis(
  title: string,
  segments: TranscriptSegment[],
  type: "meeting" | "lecture" = "lecture",
  courseCode?: string,
  appLanguage?: "en" | "ar",
): Promise<{
  overview: string;
  topics: string[];
  keywords: string[];
  definitions: Array<{ term: string; definition: string; timestamp?: string }>;
  questionsAsked: Array<{ question: string; answer?: string; timestamp?: string }>;
  actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
  emphasizedPoints: string[];
  importantSentences: string[];
  reviewAreas: string[];
}> {
  const detectedLang = detectTranscriptLanguage(title, segments);
  const targetLang = appLanguage || detectedLang || "en";
  const isEnglish = targetLang === "en";
  const ai = getGeminiClient();

  const cacheHash = computeTranscriptHash(
    "deep_analysis",
    title,
    segments,
    `${type}:${courseCode || ""}:${appLanguage || ""}`,
  );
  const cached = getCachedAiAnalysis<{
    overview: string;
    topics: string[];
    keywords: string[];
    definitions: Array<{ term: string; definition: string; timestamp?: string }>;
    questionsAsked: Array<{ question: string; answer?: string; timestamp?: string }>;
    actionItems: Array<{ task: string; owner?: string; deadline?: string }>;
    emphasizedPoints: string[];
    importantSentences: string[];
    reviewAreas: string[];
  }>(cacheHash);
  if (cached) return cached;

  if (ai && segments.length > 0) {
    try {
      const preparedTranscript = await prepareTranscriptForLlm(ai, title, segments, 24000);
      const prompt = isEnglish
        ? `You are the MeetMind AI intelligent study and meeting analyst.
The application interface is set to English. Analyze the following transcript for "${title}" (${type}${courseCode ? ` - ${courseCode}` : ""}) with extreme precision and ZERO hallucination.
Output all topics, keywords, definitions, questions, action items, emphasized points, and review areas in clear, fluent English.
Transcript:
"""
${preparedTranscript}
"""

Return ONLY a valid JSON object matching this schema:
{
  "topics": ["Topic 1", "Topic 2"],
  "keywords": ["Keyword 1", "Keyword 2"],
  "definitions": [
    {"term": "Term", "definition": "Grounded definition stated in session", "timestamp": "00:30"}
  ],
  "questionsAsked": [
    {"question": "Question asked", "answer": "Answer if stated in session", "timestamp": "01:15"}
  ],
  "actionItems": [
    {"task": "Task or deliverable", "owner": "Owner if named else null", "deadline": "Deadline if named else null"}
  ],
  "emphasizedPoints": ["Important points emphasized by speaker"],
  "importantSentences": ["Key statements from the transcript"],
  "reviewAreas": ["Areas to review"]
}`
        : `أنت محلل المحاضرات والاجتماعات الذكي في MeetMind AI.
واجهة التطبيق الحالية محددة باللغة العربية. حلل النص المفرغ التالي لجلسة "${title}" (${type}${courseCode ? ` - ${courseCode}` : ""}) بدقة فائقة دون أي اختلاق باللغة العربية الفصحى السليمة مع الحفاظ على المصطلحات التقنية كما وردت:
النص المفرغ:
"""
${preparedTranscript}
"""

المطلوب إخراج كائن JSON فقط بالهيكل التالي:
{
  "topics": ["الموضوع 1", "الموضوع 2"],
  "keywords": ["كلمة مفتاحية 1", "كلمة مفتاحية 2"],
  "definitions": [
    {"term": "المصطلح", "definition": "التعريف المذكور في الجلسة", "timestamp": "00:30"}
  ],
  "questionsAsked": [
    {"question": "السؤال المطروح", "answer": "الإجابة إن ذكرت في الجلسة", "timestamp": "01:15"}
  ],
  "actionItems": [
    {"task": "المهمة أو التكليف", "owner": "اسم المسؤول إن ذكر وإلا null", "deadline": "الموعد إن ذكر وإلا null"}
  ],
  "emphasizedPoints": ["نقاط أكد عليها المتحدث"],
  "importantSentences": ["عبارات هامة من النص المفرغ"],
  "reviewAreas": ["محاور يوصى بمراجعتها"]
}`;

      const config = getGeminiConfig();
      const { result: response } = await executeWithRetryAndFallback(
        "generateAiLectureAnalysis",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        },
        {
          primaryModel: config.textModel,
          fallbackModel: config.fallbackTextModel,
          maxRetries: 0,
          baseDelayMs: 100,
          maxDelayMs: 150,
        },
      );

      const parsed = JSON.parse(response.text || "{}");
      const refOverview = buildBuiltInSummary(
        title,
        segments,
        type,
        courseCode,
        appLanguage,
      ).executiveSummary;
      const finalResult = {
        overview:
          typeof parsed.overview === "string" && parsed.overview.trim().length >= 12
            ? parsed.overview.trim()
            : refOverview,
        topics: parsed.topics || [title],
        keywords: parsed.keywords || [],
        definitions: parsed.definitions || [],
        questionsAsked: parsed.questionsAsked || [],
        actionItems: parsed.actionItems || [],
        emphasizedPoints: parsed.emphasizedPoints || [],
        importantSentences: parsed.importantSentences || [],
        reviewAreas: parsed.reviewAreas || [],
      };
      setCachedAiAnalysis(cacheHash, "deep_analysis", config.textModel, finalResult);
      return finalResult;
    } catch (e) {
      suspendGeminiIfUnavailableError(e);
      logGeminiStructured({
        level: "warn",
        event: "gemini_lecture_analysis_fallback_builtin",
        operation: "generateAiLectureAnalysis",
        model: getGeminiConfig().textModel,
        status: extractHttpStatus(e),
        finalFailureReason: e instanceof Error ? e.message : String(e),
      });
    }
  }

  // Hybrid Fast-Path: sub-second structured analytical engine (accurate timestamps, rich overview,
  // definitions, keywords, entities, highlights, and review areas with zero hallucination).
  const builtInAnalysis = buildBuiltInLectureAnalysis(
    title,
    segments,
    type,
    courseCode,
    appLanguage,
  );
  setCachedAiAnalysis(cacheHash, "deep_analysis", "meetmind-analytical-hybrid", builtInAnalysis);
  return builtInAnalysis;
}

export function generateAnalysisFromTranscript(
  title: string,
  segments: TranscriptSegment[],
  _type: "meeting" | "lecture",
  _courseCode?: string,
): AIAnalysisResult {
  if (!segments || segments.length === 0) {
    return {
      summary: "",
      keyPoints: [],
      decisions: [],
      topics: [],
      actionItems: [],
      lectureNotes: "",
    };
  }

  const kwItems = extractKeywordsWithFrequency(segments, 6);
  const hlItems = extractHighlightsFromSegments(segments);
  const keyPoints = segments.slice(0, 4).map((s) => s.text);
  const summary = segments
    .slice(0, 3)
    .map((s) => `${s.speaker}: ${s.text}`)
    .join(" ");

  const actionItems = segments
    .filter((s) => /(action|task|todo|must |need to|deliver|يجب|مهمة|تكليف|تسليم)/i.test(s.text))
    .slice(0, 5)
    .map((s) => ({
      title: s.text.length > 110 ? `${s.text.slice(0, 110)}...` : s.text,
      dueDate: "Deadline not specified.",
      priority: /(urgent|high|critical|عاجل|فوري)/i.test(s.text)
        ? ("high" as const)
        : ("medium" as const),
    }));

  return {
    summary,
    keyPoints,
    decisions: hlItems.filter((h) => h.category === "Decision").map((h) => h.quote),
    topics: kwItems.map((k) => k.term),
    actionItems,
    lectureNotes: summary,
  };
}

export function answerGroundedQuestion(
  question: string,
  segments: TranscriptSegment[],
  title: string,
): {
  answer: string;
  evidenceFound: boolean;
  citations: { speaker: string; timestamp: string; quote: string }[];
} {
  const topMatches = retrieveRelevantSegmentsBM25(
    question,
    segments.map((seg) => ({ seg })),
    { topK: 3, minScore: 0.4 },
  );

  if (topMatches.length === 0) {
    return {
      answer: "Not mentioned in this recording.",
      evidenceFound: false,
      citations: [],
    };
  }

  const citations = topMatches.map((m) => ({
    speaker: m.seg.speaker,
    timestamp: formatMmSs(m.seg.startTime),
    quote: m.seg.text,
  }));

  const quotesText = topMatches.map((m) => `"${m.seg.text}"`).join(" | ");

  return {
    answer: `Based on "${title}", ${topMatches[0].seg.speaker} [${citations[0].timestamp}] stated: ${quotesText}`,
    evidenceFound: true,
    citations,
  };
}

export async function askMeetMindAI({
  question,
  resourceId,
  history = [],
  userId = "usr_admin",
  isAdmin = true,
  appLanguage,
}: {
  question: string;
  resourceId?: string;
  history?: Array<{ role: "user" | "model"; text: string }>;
  userId?: string;
  isAdmin?: boolean;
  appLanguage?: "en" | "ar";
}): Promise<{
  answer: string;
  evidenceFound: boolean;
  citations: { speaker: string; timestamp: string; quote: string }[];
  suggestedFollowUps?: string[];
  forbidden?: boolean;
}> {
  const allMeetings = db.get("meetings");
  const allLectures = db.get("lectures");
  const allTasks = db.get("actionItems");
  const allQuizzes = db.get("quizzes");
  const allFlashcards = db.get("flashcards");

  const meetings = isAdmin ? allMeetings : allMeetings.filter((m) => m.hostId === userId);
  const lectures = isAdmin ? allLectures : allLectures.filter((l) => l.instructorId === userId);
  const allowedIds = new Set([...meetings.map((m) => m.id), ...lectures.map((l) => l.id)]);
  const tasks = isAdmin
    ? allTasks
    : allTasks.filter(
        (t) => t.userId === userId || allowedIds.has(t.meetingId || t.lectureId || ""),
      );
  const quizzes = isAdmin
    ? allQuizzes
    : allQuizzes.filter((q) => allowedIds.has(q.lectureId || q.meetingId || ""));
  const flashcards = isAdmin
    ? allFlashcards
    : allFlashcards.filter((f) =>
        allowedIds.has(f.lectureId || f.meetingId || f.deckId.replace("deck_", "")),
      );

  const persistChatTurn = (res: {
    answer: string;
    evidenceFound: boolean;
    citations: { speaker: string; timestamp: string; quote: string }[];
  }) => {
    const now = new Date().toISOString();
    db.update("chatMessages", (msgs = []) => [
      ...msgs.slice(-198),
      {
        id: `msg_u_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId,
        resourceId,
        role: "user" as const,
        content: question,
        createdAt: now,
      },
      {
        id: `msg_a_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        userId,
        resourceId,
        role: "assistant" as const,
        content: res.answer,
        evidenceFound: res.evidenceFound,
        citations: res.citations,
        createdAt: now,
      },
    ]);
  };

  if (resourceId) {
    const existsAnywhere =
      allMeetings.some((m) => m.id === resourceId) || allLectures.some((l) => l.id === resourceId);
    if (existsAnywhere && !allowedIds.has(resourceId)) {
      return {
        answer: "Access denied to this recording.",
        evidenceFound: false,
        citations: [],
        forbidden: true,
      };
    }
  }

  // Mandatory AI Identity fast-path (<5ms, consistent across Arabic & English, never bypassed)
  const identityHit = tryAnswerIdentityQuery(question, appLanguage);
  if (identityHit) {
    const identityRes = {
      answer: identityHit.answer,
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: identityHit.isAr
        ? [
            "لخص لي آخر تسجيل أو محاضرة",
            "اشرح لي الفرق بين TCP و UDP باختصار",
            "اعمل لي 5 أسئلة اختبار مع الإجابات",
          ]
        : [
            "Summarize my latest recording or lecture",
            "Explain how RAG works in 3 bullet points",
            "Create 5 quiz questions with answers",
          ],
    };
    persistChatTurn(identityRes);
    return identityRes;
  }

  const targetMeeting = resourceId ? meetings.find((m) => m.id === resourceId) : undefined;
  const targetLecture = resourceId ? lectures.find((l) => l.id === resourceId) : undefined;

  if (resourceId && !targetMeeting && !targetLecture) {
    const missing = {
      answer: "Not mentioned in this recording.",
      evidenceFound: false,
      citations: [],
    };
    persistChatTurn(missing);
    return missing;
  }

  const targetItem = targetLecture || targetMeeting;
  const targetSegments = targetItem?.segments || [];

  // Optional delegation to Python AI service when configured
  if (AI_SERVICE_URL && targetItem) {
    try {
      const resp = await fetch(`${AI_SERVICE_URL}/api/v1/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: targetItem.title,
          question,
          segments: targetSegments,
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (resp.ok) {
        const data = (await resp.json()) as {
          answer: string;
          evidenceFound: boolean;
          citations: { speaker: string; timestamp: string; quote: string }[];
        };
        const out = {
          answer: data.evidenceFound ? data.answer : "Not mentioned in this recording.",
          evidenceFound: data.evidenceFound,
          citations: data.citations || [],
        };
        persistChatTurn(out);
        return out;
      }
    } catch {
      // Fallback seamlessly to Gemini or deterministic transcript search
    }
  }

  const latestLecture = lectures[0];
  const latestMeeting = meetings[0];

  if (targetItem && targetSegments.length === 0) {
    const emptyRes = {
      answer: "Not mentioned in this recording.",
      evidenceFound: false,
      citations: [],
    };
    persistChatTurn(emptyRes);
    return emptyRes;
  }

  // Helper: select all segments for short recordings, or top relevance-scored + boundary segments for long recordings
  const selectTranscriptSegmentsForChat = (segs: TranscriptSegment[], limit = 80) => {
    if (segs.length <= limit) return segs;
    const qTokens = normalizeArabicAndLatin(question)
      .split(" ")
      .filter((t) => t.length >= 2);
    const chosen = new Set<number>();
    // Always include opening and closing context
    for (let i = 0; i < Math.min(10, segs.length); i++) chosen.add(i);
    for (let i = Math.max(0, segs.length - 10); i < segs.length; i++) chosen.add(i);

    const scored = segs
      .map((s, idx) => {
        const norm = normalizeArabicAndLatin(s.text);
        let score = 0;
        for (const t of qTokens) {
          if (norm.includes(t)) score += t.length >= 4 ? 3 : 1;
        }
        return { idx, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score);

    for (const item of scored) {
      if (chosen.size >= limit) break;
      chosen.add(item.idx);
      if (item.idx > 0 && chosen.size < limit) chosen.add(item.idx - 1);
      if (item.idx + 1 < segs.length && chosen.size < limit) chosen.add(item.idx + 1);
    }

    return Array.from(chosen)
      .sort((a, b) => a - b)
      .map((i) => segs[i]);
  };

  // Build grounded transcript + metadata context (strictly scoped to authorized user recordings)
  let contextDetails = "";
  const lecturesToInclude = targetLecture
    ? [targetLecture]
    : targetMeeting
      ? []
      : lectures.slice(0, 4);
  for (const l of lecturesToInclude) {
    contextDetails += `[Lecture: "${l.title}" (${l.courseCode || "General"}, ${l.date})]:\n`;
    if (l.summary || l.studyNotes) contextDetails += `Summary: ${l.summary || l.studyNotes}\n`;
    if (l.topics && l.topics.length > 0) contextDetails += `Topics: ${l.topics.join(", ")}\n`;
    if (l.keywords && l.keywords.length > 0) {
      contextDetails += `Keywords: ${l.keywords.map((k) => k.term).join(", ")}\n`;
    }
    if (l.segments && l.segments.length > 0) {
      const picked = selectTranscriptSegmentsForChat(l.segments, targetLecture ? 120 : 40);
      contextDetails += `Transcript (${picked.length}/${l.segments.length} segments):\n`;
      picked.forEach((s) => {
        contextDetails += `[${formatMmSs(s.startTime)}] ${s.speaker}: ${s.text}\n`;
      });
    }
    const relQuiz = quizzes.find((q) => q.lectureId === l.id);
    if (relQuiz && relQuiz.questions.length > 0) {
      contextDetails += `Generated Quiz Questions: ${relQuiz.questions
        .slice(0, 6)
        .map((q) => q.question)
        .join(" | ")}\n`;
    }
    const relCards = flashcards.filter((f) => f.lectureId === l.id).slice(0, 6);
    if (relCards.length > 0) {
      contextDetails += `Flashcards: ${relCards.map((c) => `${c.front} -> ${c.back}`).join(" | ")}\n`;
    }
    contextDetails += `\n`;
  }

  const meetingsToInclude = targetMeeting
    ? [targetMeeting]
    : targetLecture
      ? []
      : meetings.slice(0, 4);
  for (const m of meetingsToInclude) {
    contextDetails += `[Meeting: "${m.title}" (${m.date})]:\n`;
    if (m.summary) contextDetails += `Summary: ${m.summary}\n`;
    if (m.topics && m.topics.length > 0) contextDetails += `Topics: ${m.topics.join(", ")}\n`;
    if (m.keywords && m.keywords.length > 0) {
      contextDetails += `Keywords: ${m.keywords.map((k) => k.term).join(", ")}\n`;
    }
    if (m.decisions && m.decisions.length > 0) {
      contextDetails += `Decisions: ${m.decisions.join("; ")}\n`;
    }
    if (m.segments && m.segments.length > 0) {
      const picked = selectTranscriptSegmentsForChat(m.segments, targetMeeting ? 120 : 40);
      contextDetails += `Transcript (${picked.length}/${m.segments.length} segments):\n`;
      picked.forEach((s) => {
        contextDetails += `[${formatMmSs(s.startTime)}] ${s.speaker}: ${s.text}\n`;
      });
    }
    const relQuiz = quizzes.find((q) => q.meetingId === m.id);
    if (relQuiz && relQuiz.questions.length > 0) {
      contextDetails += `Generated Quiz Questions: ${relQuiz.questions
        .slice(0, 6)
        .map((q) => q.question)
        .join(" | ")}\n`;
    }
    contextDetails += `\n`;
  }

  const relevantTasks = targetItem
    ? tasks.filter((t) => t.meetingId === targetItem.id || t.lectureId === targetItem.id)
    : tasks;
  if (relevantTasks.length > 0) {
    contextDetails += `[Extracted Tasks]:\n`;
    relevantTasks.slice(0, 15).forEach((t) => {
      contextDetails += `- ${t.title} (Owner: ${t.ownerName || "Unassigned"}, Deadline: ${t.deadlineText || t.dueDate || "Deadline not specified."})\n`;
    });
  }

  const isArabicQuestion =
    appLanguage === "ar" || (appLanguage !== "en" && /[\u0600-\u06FF]/.test(question));
  const ai = getGeminiClient();

  if (ai) {
    try {
      const hasWorkspaceContext = contextDetails.trim().length > 0;
      const identityRule =
        'Mandatory Identity Rule: You are MeetMind AI, programmed by a team of Software Engineers from the Computer Science Department at Modern Academy. In Arabic ALWAYS say "مبرمجني مجموعة من مهندسين برمجة قسم علوم حاسب مودرن أكاديمي". NEVER claim Google, Gemma, Gemini, or OpenAI created or trained you.';
      const systemInstruction = targetItem
        ? `You are MeetMind AI, a helpful intelligent assistant for meetings, lectures, and learning.
${identityRule}
The user currently has a specific recording selected: "${targetItem.title}".
Rules:
1. If the user asks what was said, decided, assigned, or covered in this recording, answer accurately using ONLY the provided transcript and extracted records, citing speaker names and timestamps [MM:SS]. If that specific detail was NOT mentioned in the recording, state clearly: "Not mentioned in this recording." (or in Arabic: "غير مذكور في هذا التسجيل.").
2. If the user asks a general, conceptual, academic, coding, or study question (e.g., explaining a concept, giving examples, solving a problem, writing code, or preparing for an exam), answer it thoroughly and helpfully in the user's language (Arabic, Egyptian Arabic, or English).
3. Never fabricate quotes or claim something was spoken in the recording if it is not in the transcript.`
        : `You are MeetMind AI, a super-intelligent, helpful AI assistant capable of answering ANY question across all subjects (science, programming, math, engineering, languages, study tips, exam prep, writing, everyday questions, and more), in addition to analyzing the user's uploaded meetings and lectures.
${identityRule}
Rules:
1. Answer ANY question the user asks clearly, accurately, and naturally in the same language/dialect they used (Standard Arabic, Egyptian Arabic, English, etc.).
2. If the user asks about their meetings, lectures, recordings, summaries, tasks, quizzes, or flashcards, ground your answer strictly in the provided workspace context below and cite speaker names and timestamps [MM:SS]. Never invent recording content.
3. If the user asks a general question unrelated to their recordings, answer it directly and completely — NEVER refuse with "Not mentioned in this recording.".`;

      const recentHistory = history
        .slice(-10)
        .filter((h) => h.text && h.text.trim())
        .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text}`)
        .join("\n\n");

      const promptParts: string[] = [];
      if (hasWorkspaceContext) {
        promptParts.push(`[User's Authorized Workspace Recordings & Notes]:\n${contextDetails}`);
      } else {
        promptParts.push(
          `[Workspace Status]: The user currently has no transcribed recordings uploaded.`,
        );
      }
      if (recentHistory) {
        promptParts.push(`[Conversation History]:\n${recentHistory}`);
      }
      promptParts.push(`[User Question]:\n${question}`);

      const config = getGeminiConfig();
      const { result: response } = await executeWithRetryAndFallback(
        "askMeetMindAI",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: promptParts.join("\n\n"),
            config: {
              systemInstruction,
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        },
        {
          primaryModel: config.textModel,
          fallbackModel: config.fallbackTextModel,
          maxRetries: 0,
          baseDelayMs: 100,
          maxDelayMs: 150,
        },
      );

      const replyText = (response.text || "").trim();
      if (replyText) {
        const activeSegments =
          targetSegments.length > 0
            ? targetSegments
            : [...(latestLecture?.segments || []), ...(latestMeeting?.segments || [])];

        const grounded =
          activeSegments.length > 0
            ? answerGroundedQuestion(question, activeSegments, targetItem?.title || "Recordings")
            : { citations: [], evidenceFound: false };

        const notMentioned =
          Boolean(targetItem) &&
          (replyText === "Not mentioned in this recording." ||
            replyText === "غير مذكور في هذا التسجيل.");

        const finalAnswer = {
          answer: replyText,
          evidenceFound: !notMentioned && (grounded.evidenceFound || !targetItem),
          citations: grounded.evidenceFound ? grounded.citations : [],
          suggestedFollowUps: isArabicQuestion
            ? [
                "اشرح هذه النقطة بأمثلة عملية أكثر",
                "لخص الإجابة في نقاط سريعة للمذاكرة",
                "اعمل لي 5 أسئلة اختبار على الموضوع ده",
              ]
            : [
                "Explain this with practical examples",
                "Summarize into concise study bullets",
                "Create 5 practice quiz questions on this topic",
              ],
        };
        persistChatTurn(finalAnswer);
        return finalAnswer;
      }
    } catch (err) {
      suspendGeminiIfUnavailableError(err);
      const errMsg = err instanceof Error ? err.message : String(err);
      const errStatus = extractHttpStatus(err);
      logGeminiStructured({
        level: "warn",
        event: "gemini_query_fallback_builtin",
        operation: "askMeetMindAI",
        model: getGeminiConfig().textModel,
        status: errStatus,
        finalFailureReason: errMsg,
      });
    }
  }

  // Tier 2: Real Embedded Local LLM with BM25 RAG (Arabic + Egyptian Arabic + English)
  const questionIsAr = detectIsArabic(question, appLanguage);
  const directMath = trySolveMathQuery(question, questionIsAr);
  if (directMath) {
    const mathRes = {
      answer: directMath,
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: questionIsAr
        ? ["احسب 25% من 840", "اشرح لي الفرق بين TCP و UDP باختصار", "لخص لي آخر تسجيل"]
        : [
            "Calculate 25% of 840",
            "Explain how RAG works in 3 bullet points",
            "Summarize my latest recording",
          ],
    };
    persistChatTurn(mathRes);
    return mathRes;
  }

  // Build crisp BM25-retrieved transcript evidence ONLY when relevant to the question or scoped recording
  const workspaceIntent =
    /(التسجيل|تسجيلات|المحاضر[ةه]|محاضرات|الاجتماع|اجتماعات|ملخص|لخص|المهام|تكليف|قرارات|التفريغ|my recording|this recording|the recording|transcript|my lecture|this lecture|my meeting|this meeting|summarize my|action items|what did .* say)/i.test(
      question,
    );

  const bm25Pool: Array<{ seg: TranscriptSegment; title: string }> = [];
  if (targetItem) {
    for (const seg of targetSegments) bm25Pool.push({ seg, title: targetItem.title });
  } else {
    for (const l of lectures.slice(0, 5)) {
      for (const seg of l.segments || []) bm25Pool.push({ seg, title: l.title });
    }
    for (const m of meetings.slice(0, 5)) {
      for (const seg of m.segments || []) bm25Pool.push({ seg, title: m.title });
    }
  }

  // Require high-confidence domain-token coverage for unscoped workspace search so general questions stay clean
  const rawBm25Matches =
    bm25Pool.length > 0
      ? retrieveRelevantSegmentsBM25(question, bm25Pool, {
          topK: targetItem ? 6 : 4,
          minScore: targetItem ? 0.35 : workspaceIntent ? 1.5 : 3.5,
        })
      : [];

  const framingStopWords = new Set([
    "الفرق",
    "فرق",
    "باختصار",
    "مختصر",
    "اشرح",
    "اشرحلي",
    "شرح",
    "قارن",
    "مقارنه",
    "مثال",
    "امثله",
    "نقاط",
    "نقطه",
    "ببساطه",
    "وضوح",
    "توضيح",
    "ماهو",
    "ماهي",
    "كيف",
    "يعمل",
    "تعمل",
    "بين",
    "عن",
    "علي",
    "الي",
    "difference",
    "compare",
    "comparison",
    "brief",
    "briefly",
    "short",
    "points",
    "bullet",
    "bullets",
    "explain",
    "works",
    "work",
    "example",
    "examples",
    "simply",
    "simple",
    "summary",
    "summarize",
  ]);
  const stripArAl = (w: string) => (w.startsWith("ال") && w.length >= 5 ? w.slice(2) : w);
  const contentTokens = normalizeText(question)
    .split(" ")
    .filter((w) => (w.length >= 3 || /\d/.test(w)) && !framingStopWords.has(w))
    .map(stripArAl);

  const bm25Matches = targetItem
    ? rawBm25Matches
    : rawBm25Matches.filter((m) => {
        if (workspaceIntent) return true;
        if (contentTokens.length === 0) return false;
        const segNorm = normalizeText(`${m.title} ${m.seg.text}`);
        const segWordSet = new Set(segNorm.split(" ").filter(Boolean).map(stripArAl));
        const matchedCount = contentTokens.filter(
          (t) => segWordSet.has(t) || (t.length >= 4 && segNorm.includes(t)),
        ).length;
        const requiredMatches =
          contentTokens.length <= 2
            ? contentTokens.length
            : Math.min(3, Math.max(2, Math.ceil(contentTokens.length * 0.45)));
        return matchedCount >= requiredMatches;
      });

  let localRagBlock = "";
  let ragCitations: { speaker: string; timestamp: string; quote: string }[] = [];

  if (targetItem && targetSegments.length > 0) {
    const totalTargetChars = targetSegments.reduce((acc, s) => acc + (s.text?.length || 0) + 22, 0);
    let pickedForTarget: TranscriptSegment[];

    if (targetSegments.length <= 14 || totalTargetChars <= 2500) {
      // Compact scoped recording: pass ALL chronological segments so multi-segment facts never split apart
      pickedForTarget = targetSegments;
    } else if (bm25Matches.length > 0) {
      // Long scoped recording: expand each BM25 hit with +-1 chronological neighbors
      const idToIndex = new Map<string, number>();
      targetSegments.forEach((s, i) => idToIndex.set(s.id, i));
      const expanded = new Set<number>();
      for (const m of bm25Matches) {
        const idx = idToIndex.get(m.seg.id);
        if (typeof idx === "number") {
          if (idx > 0) expanded.add(idx - 1);
          expanded.add(idx);
          if (idx + 1 < targetSegments.length) expanded.add(idx + 1);
        }
      }
      pickedForTarget = Array.from(expanded)
        .sort((a, b) => a - b)
        .map((i) => targetSegments[i]);
    } else {
      pickedForTarget = selectHighSignalSegments(targetSegments, 2200);
    }

    ragCitations = (
      bm25Matches.length >= 2
        ? bm25Matches.slice(0, 3)
        : pickedForTarget.slice(0, 3).map((seg) => ({ seg }))
    ).map((entry) => ({
      speaker: entry.seg.speaker,
      timestamp: formatMmSs(entry.seg.startTime),
      quote: entry.seg.text,
    }));

    const structuredHints =
      targetSegments.length <= 14 || totalTargetChars <= 2500
        ? buildBuiltInSummary(
            targetItem.title,
            targetSegments,
            "courseCode" in targetItem ? "lecture" : "meeting",
            "courseCode" in targetItem ? targetItem.courseCode : undefined,
            questionIsAr ? "ar" : "en",
          ).keyPoints.slice(0, 9)
        : [];

    const chronologicalText = pickedForTarget
      .map((s) => `[${formatMmSs(s.startTime)}] ${s.speaker}: ${s.text.trim()}`)
      .join("\n")
      .slice(0, 2100);
    const factsHeader =
      structuredHints.length > 0
        ? `[Verified Extracted Facts]\n${structuredHints
            .map((pt) => `- ${pt.replace(/\s*\[\d{2}:\d{2}\]\s*$/, "").trim()}`)
            .join("\n")}\n\n`
        : "";
    localRagBlock =
      `[Recording: "${targetItem.title}"]\n${factsHeader}[Transcript]\n${chronologicalText}`.slice(
        0,
        2800,
      );
  } else if (bm25Matches.length > 0 || (workspaceIntent && bm25Pool.length > 0)) {
    const chosenHits =
      bm25Matches.length > 0
        ? bm25Matches
        : selectHighSignalSegments((latestLecture || latestMeeting)?.segments || [], 1600).map(
            (seg) => ({
              seg,
              title: (latestLecture || latestMeeting)?.title || "Recording",
              score: 1,
            }),
          );

    ragCitations = chosenHits.slice(0, 3).map((m) => ({
      speaker: m.seg.speaker,
      timestamp: formatMmSs(m.seg.startTime),
      quote: m.seg.text,
    }));
    localRagBlock = chosenHits
      .map(
        (m) =>
          `[${m.title} | ${formatMmSs(m.seg.startTime)}] ${m.seg.speaker}: ${m.seg.text.trim()}`,
      )
      .join("\n")
      .slice(0, 1900);
  }

  const localHistoryBlock = history
    .slice(-4)
    .filter((h) => h.text && h.text.trim())
    .map((h) => `${h.role === "user" ? "User" : "Assistant"}: ${h.text.trim().slice(0, 220)}`)
    .join("\n");

  const localSystemPrompt = localRagBlock
    ? questionIsAr
      ? `أنت مساعد MeetMind AI الذكي. أجب مباشرة وبإيجاز بالعربية الفصحى الواضحة دون مقدمات مطولة أو أسئلة ختامية. اعتمد أولاً على قسم [Verified Extracted Facts] ثم [Transcript] المرفق؛ انقل كل حقل بقيمته الدقيقة كما هي (المنطقة/الموقع، المساحة بالمتر، الميزانية/السعر بالجنيه، عدد الغرف، عدد الحمامات، الإطلالة، والتشطيب) ولا تخلط رقم الهاتف مع المساحة ولا تبدّل بين الحقول إطلاقاً.`
      : `You are MeetMind AI. Answer directly and concisely without filler intros or closing questions. Rely first on [Verified Extracted Facts] and then [Transcript]; copy each field's exact value (location/zone, area in meters, budget/price, room/bath counts, view, finishing) and never mix phone digits with area or swap fields.`
    : questionIsAr
      ? `أنت مساعد MeetMind AI الذكي. أجب مباشرة وبإيجاز باللغة العربية الفصحى السليمة وبمعلومات علمية وتقنية دقيقة ومنظمة في نقاط عند الحاجة، بدون مقدمات مطولة أو أسئلة ختامية.`
      : `You are MeetMind AI, an accurate and concise technical assistant. Answer directly in clear English using structured markdown bullets when helpful, without filler intros or closing follow-up questions.`;

  const localUserParts: string[] = [];
  if (localRagBlock) {
    localUserParts.push(`Transcript Context:\n"""\n${localRagBlock}\n"""`);
  }
  if (localHistoryBlock) {
    localUserParts.push(`Recent Conversation:\n${localHistoryBlock}`);
  }
  localUserParts.push(localRagBlock || localHistoryBlock ? `Question: ${question}` : question);

  const localReply = await generateLocalLlmText({
    systemPrompt: localSystemPrompt,
    userPrompt: localUserParts.join("\n\n"),
    maxNewTokens: 265,
    temperature: 0,
    timeoutMs: 40000,
  });

  if (localReply && localReply.length >= 4) {
    const notMentioned =
      Boolean(targetItem) &&
      /(not mentioned in this recording|غير مذكور في هذا التسجيل)/i.test(localReply);

    const localChatResult = {
      answer: localReply,
      evidenceFound: !notMentioned && (ragCitations.length > 0 || !targetItem),
      citations: notMentioned ? [] : ragCitations,
      suggestedFollowUps: questionIsAr
        ? [
            "اشرح هذه النقطة بمثال عملي",
            "لخص الإجابة في 3 نقاط سريعة",
            "اعمل لي أسئلة اختبار على الموضوع ده",
          ]
        : [
            "Explain this with a practical example",
            "Summarize this into 3 quick bullets",
            "Create practice quiz questions on this topic",
          ],
    };
    persistChatTurn(localChatResult);
    return localChatResult;
  }

  // Tier 3: Always-On Built-In Bilingual Analytical Assistant Fallback
  const builtInAnswer = answerBuiltInChat({
    question,
    appLanguage,
    targetItem,
    meetings,
    lectures,
    tasks,
    quizzes,
    flashcards,
  });
  persistChatTurn(builtInAnswer);
  return builtInAnswer;
}

// Generate Spaced Repetition Flashcards Grounded in Transcript
export async function generateAiFlashcards(
  title: string,
  segments: TranscriptSegment[],
  summaryText?: string,
  courseCode?: string,
  appLanguage?: "en" | "ar",
): Promise<
  Array<{
    front: string;
    back: string;
    sourceReference?: string;
    topic?: string;
    difficulty?: "easy" | "medium" | "hard";
  }>
> {
  const detectedLang = detectTranscriptLanguage(title, segments);
  const targetLang = appLanguage || detectedLang || "en";
  const isEnglish = targetLang === "en";
  const ai = getGeminiClient();

  const cacheHash = computeTranscriptHash(
    "flashcards",
    title,
    segments,
    `${courseCode || ""}:${appLanguage || ""}`,
  );
  const cached = getCachedAiAnalysis<
    Array<{
      front: string;
      back: string;
      sourceReference?: string;
      topic?: string;
      difficulty?: "easy" | "medium" | "hard";
    }>
  >(cacheHash);
  if (cached) return cached;

  if (ai && segments.length > 0) {
    try {
      const preparedTranscript = await prepareTranscriptForLlm(ai, title, segments, 24000);
      const prompt = isEnglish
        ? `You are an expert in spaced repetition and retention flashcards at MeetMind AI.
The user interface is set to English. Create 6 to 10 flashcards strictly grounded in: "${title}" ${courseCode ? `(${courseCode})` : ""}.
Generate all fronts, backs, and topics in fluent, clear English.
Rules:
1. Front: clear concept, question, or term from the transcript.
2. Back: concise, accurate grounded answer or definition based strictly on the transcript.
3. Zero hallucination.
4. Include sourceReference, topic, difficulty ("easy" | "medium" | "hard").

Transcript:
"""
${preparedTranscript}
"""

Summary Context:
"""
${summaryText || ""}
"""

Return ONLY a JSON array matching:
[
  {
    "front": "Front question in English...",
    "back": "Back explanation in English...",
    "sourceReference": "01:20",
    "topic": "Topic",
    "difficulty": "medium"
  }
]`
        : `أنت خبير في تقنيات الاستذكار والتعلم المتباعد (Spaced Repetition) في منصة MeetMind AI.
المهمة الصارمة: أنشئ ما بين 6 إلى 10 بطاقات تعليمية (Flashcards) مستخلصة وموثقة بنسبة 100% من محتوى الجلسة التالية: "${title}".
أنشئ البطاقات باللغة العربية مع الحفاظ على المصطلحات التقنية كما وردت.
القواعد:
1. الوجه الأمامي (front): سؤال واضح أو مصطلح محوري ورد في الجلسة.
2. الوجه الخلفي (back): إجابة دقيقة وموجزة مستندة للنص المفرغ فقط.
3. لا تختلق أي معلومة لم تذكر في النص المفرغ.
4. أرفق sourceReference (التوقيت أو القسم)، topic (الموضوع)، difficulty ("easy" | "medium" | "hard").

النص المفرغ:
"""
${preparedTranscript}
"""

الملخص التوجيهي:
"""
${summaryText || ""}
"""

المطلوب إرجاع مصفوفة JSON فقط بالشكل التالي:
[
  {
    "front": "...",
    "back": "...",
    "sourceReference": "01:20",
    "topic": "...",
    "difficulty": "medium"
  }
]`;

      const config = getGeminiConfig();
      const { result: response } = await executeWithRetryAndFallback(
        "generateAiFlashcards",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        },
        {
          primaryModel: config.textModel,
          fallbackModel: config.fallbackTextModel,
          maxRetries: 0,
          baseDelayMs: 100,
          maxDelayMs: 150,
        },
      );

      const parsed = JSON.parse(response.text || "[]");
      if (Array.isArray(parsed) && parsed.length >= 1) {
        const finalResult = parsed
          .map((item) => ({
            front: String(item.front || "").trim(),
            back: String(item.back || "").trim(),
            sourceReference: item.sourceReference ? String(item.sourceReference).trim() : "00:00",
            topic: item.topic ? String(item.topic).trim() : courseCode || title,
            difficulty: (["easy", "medium", "hard"].includes(item.difficulty)
              ? item.difficulty
              : "medium") as "easy" | "medium" | "hard",
          }))
          .filter((c) => c.front && c.back);
        if (finalResult.length > 0) {
          setCachedAiAnalysis(cacheHash, "flashcards", config.textModel, finalResult);
        }
        return finalResult;
      }
      return [];
    } catch (err) {
      suspendGeminiIfUnavailableError(err);
      logGeminiStructured({
        level: "warn",
        event: "gemini_flashcards_fallback_builtin",
        operation: "generateAiFlashcards",
        model: getGeminiConfig().textModel,
        status: extractHttpStatus(err),
        finalFailureReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Hybrid Fast-Path: sub-second grounded concept flashcards engine (definitions, specs, key clauses)
  const builtInCards = buildBuiltInFlashcards(title, segments, courseCode, appLanguage);
  if (builtInCards.length > 0) {
    setCachedAiAnalysis(cacheHash, "flashcards", "meetmind-analytical-hybrid", builtInCards);
  }
  return builtInCards;
}

// Generate Hierarchical Knowledge Graph (Mind Map) Grounded in Transcript
export async function generateAiMindMap(
  title: string,
  segments: TranscriptSegment[],
  summaryText?: string,
  courseCode?: string,
  appLanguage?: "en" | "ar",
): Promise<MindMapNode> {
  const detectedLang = detectTranscriptLanguage(title, segments);
  const targetLang = appLanguage || detectedLang || "en";
  const isEnglish = targetLang === "en";
  const ai = getGeminiClient();

  const cacheHash = computeTranscriptHash(
    "mindmap",
    title,
    segments,
    `${courseCode || ""}:${appLanguage || ""}`,
  );
  const cached = getCachedAiAnalysis<MindMapNode>(cacheHash);
  if (cached) return cached;

  if (ai && segments.length > 0) {
    try {
      const preparedTranscript = await prepareTranscriptForLlm(ai, title, segments, 24000);
      const prompt = isEnglish
        ? `You are a cognitive knowledge graph and mind map expert at MeetMind AI.
The user interface is set to English. Generate a hierarchical mind map summarizing: "${title}" ${courseCode ? `(${courseCode})` : ""} strictly based on the transcript.
Output all labels and descriptions in fluent, clear English.
Rules:
1. Root: session title with brief description.
2. Main branches: 3 to 5 key themes covered in transcript.
3. Sub-nodes: 2 to 4 grounded sub-points per branch.
4. Schema: "id", "label", "description", "children".

Transcript:
"""
${preparedTranscript}
"""

Summary:
"""
${summaryText || ""}
"""

Return ONLY a JSON object representing the root node.`
        : `أنت خبير الخرائط الذهنية ورسم العلاقات المعرفية في منصة MeetMind AI.
واجهة التطبيق الحالية محددة باللغة العربية. أنشئ خريطة ذهنية هرمية شاملة ودقيقة تلخص الجلسة: "${title}" ${courseCode ? `(${courseCode})` : ""} بناءً على النص المفرغ فقط باللغة العربية مع الحفاظ على المصطلحات التقنية.
القواعد:
1. العقدة الجذرية (Root): عنوان الجلسة مع وصف موجز.
2. الفروع الرئيسية (Main Branches): من 3 إلى 5 فروع تغطي المحاور الفعلية في النص.
3. الفروع الفرعية (Sub-nodes): كل فرع رئيسي يتفرع منه من 2 إلى 4 عقد فرعية مستفادة من النص المفرغ.
4. كل عقدة تتضمن: "id", "label", "description", "children".

النص المفرغ:
"""
${preparedTranscript}
"""

الملخص:
"""
${summaryText || ""}
"""

المطلوب إرجاع كائن JSON يمثل العقدة الجذرية بالهيكل الموضح.`;

      const config = getGeminiConfig();
      const { result: response } = await executeWithRetryAndFallback(
        "generateAiMindMap",
        async (model) => {
          return ai.models.generateContent({
            model,
            contents: prompt,
            config: {
              responseMimeType: "application/json",
              thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
            },
          });
        },
        {
          primaryModel: config.textModel,
          fallbackModel: config.fallbackTextModel,
          maxRetries: 0,
          baseDelayMs: 100,
          maxDelayMs: 150,
        },
      );

      const parsed = JSON.parse(response.text || "{}");
      const normalizedCloud = normalizeMindMapTree(parsed, title);
      if (
        normalizedCloud &&
        Array.isArray(normalizedCloud.children) &&
        normalizedCloud.children.length > 0
      ) {
        setCachedAiAnalysis(cacheHash, "mindmap", config.textModel, normalizedCloud);
        return normalizedCloud;
      }
      throw new GeminiPipelineError("AI mind map did not return a valid tree structure.", {
        model: config.textModel,
        retryable: false,
        operation: "generateAiMindMap",
      });
    } catch (err) {
      suspendGeminiIfUnavailableError(err);
      logGeminiStructured({
        level: "warn",
        event: "gemini_mind_map_fallback_builtin",
        operation: "generateAiMindMap",
        model: getGeminiConfig().textModel,
        status: extractHttpStatus(err),
        finalFailureReason: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Hybrid Fast-Path: sub-second hierarchical mind map engine grounded in extracted facts & themes
  const builtInMap = buildBuiltInMindMap(title, segments, courseCode, appLanguage);
  setCachedAiAnalysis(cacheHash, "mindmap", "meetmind-analytical-hybrid", builtInMap);
  return builtInMap;
}
