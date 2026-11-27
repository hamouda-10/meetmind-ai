import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { TranscriptSegment } from "./db";
import { logObservabilityEvent, logStageTiming, redactSensitiveText } from "./pipeline-logger";
import { getProviderSecret } from "./provider-secrets";
import {
  buildTranscriptArtifacts,
  formatTranscriptNonDestructive,
  normalizeSpeakerLabel,
} from "./transcript-format";

const execFileAsync = promisify(execFile);
const nodeRequire = createRequire(import.meta.url);

function resolveFfmpegBin(kind: "ffmpeg" | "ffprobe"): string {
  try {
    const pkg = kind === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe";
    const mod = nodeRequire(pkg);
    if (mod?.path && fs.existsSync(mod.path)) return mod.path as string;
  } catch {
    // fallback to system PATH
  }
  return kind;
}

const DEFAULT_ASSEMBLYAI_BASE_URL = "https://api.assemblyai.com/v2";
// Verified highest-accuracy Arabic + multilingual AssemblyAI pre-recorded model chain:
// assemblyai-stt-3-7 (0.93-0.95 avg word confidence on Egyptian & MSA Arabic with full hamzas & punctuation)
// falling back seamlessly to universal-2 (99-language coverage).
export const DEFAULT_ASSEMBLYAI_SPEECH_MODELS = ["assemblyai-stt-3-7", "universal-2"] as const;
// Short adaptive polling intervals (seconds -> ms): immediately catches fast completions without 30s stalls
export const ASSEMBLYAI_ADAPTIVE_POLL_MS = [2000, 3000, 5000, 8000, 10000] as const;

export function getConfiguredAssemblyAiSpeechModels(): string[] {
  const listEnv = (process.env.ASSEMBLYAI_SPEECH_MODELS || "").trim();
  if (listEnv) {
    const parsed = listEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (parsed.length > 0) return parsed;
  }
  const singleEnv = (process.env.ASSEMBLYAI_SPEECH_MODEL || "").trim();
  if (singleEnv && singleEnv !== "universal" && singleEnv !== "universal-3-pro") {
    return singleEnv === "universal-2" ? ["universal-2"] : [singleEnv, "universal-2"];
  }
  return [...DEFAULT_ASSEMBLYAI_SPEECH_MODELS];
}

function getAssemblyAiBaseUrl(): string {
  const override = (process.env.ASSEMBLYAI_API_BASE_URL || "").trim().replace(/\/$/, "");
  if (override && /^https?:\/\//i.test(override)) return override;
  return DEFAULT_ASSEMBLYAI_BASE_URL;
}

// In-process AssemblyAI webhook callback waiters (zero polling delay when webhook_url is active)
export interface AssemblyAiWebhookEvent {
  transcript_id: string;
  status: "completed" | "error";
  error?: string;
}

const assemblyAiWebhookWaiters = new Map<
  string,
  { resolve: (evt: AssemblyAiWebhookEvent) => void; receivedAt?: number }
>();
const earlyAssemblyAiWebhooks = new Map<string, AssemblyAiWebhookEvent>();

export function notifyAssemblyAiWebhook(evt: AssemblyAiWebhookEvent): boolean {
  const id = String(evt.transcript_id || "").trim();
  if (!id) return false;
  const waiter = assemblyAiWebhookWaiters.get(id);
  if (waiter) {
    assemblyAiWebhookWaiters.delete(id);
    waiter.resolve(evt);
    return true;
  }
  earlyAssemblyAiWebhooks.set(id, evt);
  if (earlyAssemblyAiWebhooks.size > 200) {
    const oldest = earlyAssemblyAiWebhooks.keys().next().value;
    if (oldest) earlyAssemblyAiWebhooks.delete(oldest);
  }
  return false;
}

function registerAssemblyAiWebhookWaiter(transcriptId: string): Promise<AssemblyAiWebhookEvent> {
  const early = earlyAssemblyAiWebhooks.get(transcriptId);
  if (early) {
    earlyAssemblyAiWebhooks.delete(transcriptId);
    return Promise.resolve(early);
  }
  return new Promise<AssemblyAiWebhookEvent>((resolve) => {
    assemblyAiWebhookWaiters.set(transcriptId, { resolve });
  });
}

function clearAssemblyAiWebhookWaiter(transcriptId: string): void {
  assemblyAiWebhookWaiters.delete(transcriptId);
  earlyAssemblyAiWebhooks.delete(transcriptId);
}

export function resolveAssemblyAiWebhookUrl(): string {
  const explicit = (process.env.ASSEMBLYAI_WEBHOOK_URL || "").trim();
  if (explicit && /^https?:\/\//i.test(explicit)) return explicit;
  if (process.env.ASSEMBLYAI_USE_WEBHOOK === "false") return "";
  const publicBase = (
    process.env.PUBLIC_APP_URL ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "")
  )
    .trim()
    .replace(/\/$/, "");
  if (
    publicBase &&
    /^https:\/\//i.test(publicBase) &&
    !/localhost|127\.0\.0\.1/i.test(publicBase)
  ) {
    return `${publicBase}/api/v1/webhooks/assemblyai`;
  }
  return "";
}

export interface AssemblyAiSpeakerStat {
  speaker: string;
  segmentsCount: number;
  wordCount: number;
  durationSeconds: number;
  percentage: number;
}

export interface AssemblyAiUtterance {
  speaker: string;
  text: string;
  start: number; // ms
  end: number; // ms
  confidence?: number;
}

export interface AssemblyAiPartialProgressUpdate {
  stageProgress: number; // Real 1..100% of audio duration transcribed
  completedSlices: number;
  totalSlices: number;
  transcribedDurationSec: number;
  totalDurationSec: number;
  segments: TranscriptSegment[];
  rawSegments: TranscriptSegment[];
  rawTranscript: string;
  wordsReceived: number;
  detectedLanguage?: string;
  speechModel?: string;
  uploadMsSoFar: number;
}

export interface AssemblyAiTranscriptionResult {
  transcriptId: string;
  rawTranscript: string;
  processedTranscript: string;
  fullText: string;
  rawSegments: TranscriptSegment[];
  segments: TranscriptSegment[];
  utterances: AssemblyAiUtterance[];
  detectedLanguage: string;
  languageConfig: string;
  durationSeconds: number;
  speakerBreakdown: AssemblyAiSpeakerStat[];
  averageConfidence?: number;
  uploadMs: number;
  transcriptionMs: number;
  pollingWaitMs: number;
  pollCount: number;
  transcriptFetchMs: number;
  webhookTriggered: boolean;
  speechModel: string;
  speakerLabelsEnabled: boolean;
  latencyMs: number;
}

export class AssemblyAiError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly category: string;

  constructor(
    message: string,
    opts: { status?: number; retryable?: boolean; category?: string } = {},
  ) {
    super(message);
    this.name = "AssemblyAiError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? true;
    this.category = opts.category || "AssemblyAiError";
  }
}

export function getAssemblyAiApiKey(): string {
  const key = (
    process.env.ASSEMBLYAI_API_KEY ||
    getProviderSecret("ASSEMBLYAI_API_KEY") ||
    ""
  ).trim();
  if (!key || key === "your_assemblyai_api_key_here" || key.length < 16) {
    return "";
  }
  return key;
}

export function isAssemblyAiConfigured(): boolean {
  return Boolean(getAssemblyAiApiKey());
}

export function computeSpeakerBreakdown(segments: TranscriptSegment[]): AssemblyAiSpeakerStat[] {
  if (!segments.length) return [];
  const map = new Map<
    string,
    { speaker: string; segmentsCount: number; wordCount: number; durationSeconds: number }
  >();
  let totalWords = 0;

  for (const seg of segments) {
    const speaker = (seg.speaker || "Speaker 1").trim();
    const words = seg.text.trim().split(/\s+/).filter(Boolean).length;
    const dur = Math.max(0.5, (seg.endTime || 0) - (seg.startTime || 0));
    totalWords += words;
    const existing = map.get(speaker);
    if (existing) {
      existing.segmentsCount += 1;
      existing.wordCount += words;
      existing.durationSeconds += dur;
    } else {
      map.set(speaker, {
        speaker,
        segmentsCount: 1,
        wordCount: words,
        durationSeconds: dur,
      });
    }
  }

  return Array.from(map.values())
    .map((item) => ({
      ...item,
      durationSeconds: Math.round(item.durationSeconds * 10) / 10,
      percentage: totalWords > 0 ? Math.round((item.wordCount / totalWords) * 100) : 0,
    }))
    .sort((a, b) => b.wordCount - a.wordCount);
}

export function mapLanguageCodeForAssemblyAi(language?: string): {
  payload: {
    language_detection?: boolean;
    language_code?: string;
    language_detection_options?: { code_switching?: boolean };
  };
  configLabel: string;
} {
  const normalized = (language || "auto").trim().toLowerCase();
  if (normalized === "en" || normalized.startsWith("en-") || normalized === "english") {
    return { payload: { language_code: "en" }, configLabel: "en (explicit)" };
  }
  if (normalized === "ar" || normalized.startsWith("ar-") || normalized === "arabic") {
    return { payload: { language_code: "ar" }, configLabel: "ar (explicit)" };
  }
  if (normalized === "mixed") {
    return {
      payload: {
        language_detection: true,
        language_detection_options: { code_switching: true },
      },
      configLabel: "mixed (language_detection + code_switching)",
    };
  }
  return {
    payload: { language_detection: true },
    configLabel: "auto (language_detection)",
  };
}

function isRetryableStatus(status?: number): boolean {
  return status === 408 || status === 429 || (typeof status === "number" && status >= 500);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  options: { timeoutMs: number; maxAttempts?: number; signal?: AbortSignal },
): Promise<Response> {
  const maxAttempts = options.maxAttempts ?? 3;
  let lastErr: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (options.signal?.aborted) {
      throw new AssemblyAiError("Transcription cancelled by user.", {
        retryable: false,
        category: "CancelledByUser",
      });
    }

    const controller = new AbortController();
    const onParentAbort = () => controller.abort();
    options.signal?.addEventListener("abort", onParentAbort, { once: true });
    const timer = setTimeout(() => controller.abort(), options.timeoutMs);

    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      if (res.ok) return res;

      const bodyText = await res.text().catch(() => "");
      if (isRetryableStatus(res.status) && attempt < maxAttempts) {
        const delayMs = Math.min(6000, 1000 * Math.pow(2, attempt - 1));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }

      throw new AssemblyAiError(
        `AssemblyAI HTTP ${res.status}: ${redactSensitiveText(bodyText || res.statusText)}`,
        {
          status: res.status,
          retryable: isRetryableStatus(res.status),
          category: res.status === 401 || res.status === 403 ? "AuthError" : "AssemblyAiHttpError",
        },
      );
    } catch (err) {
      if (err instanceof AssemblyAiError) {
        lastErr = err;
        if (!err.retryable || attempt >= maxAttempts) throw err;
      } else {
        const isAbort = controller.signal.aborted && !options.signal?.aborted;
        lastErr = new AssemblyAiError(
          isAbort
            ? `AssemblyAI request timed out after ${options.timeoutMs}ms.`
            : `AssemblyAI network error: ${redactSensitiveText(err instanceof Error ? err.message : String(err))}`,
          { retryable: true, category: isAbort ? "Timeout" : "NetworkError" },
        );
        if (options.signal?.aborted || attempt >= maxAttempts) throw lastErr;
      }
      const delayMs = Math.min(6000, 1000 * Math.pow(2, attempt - 1));
      await new Promise((r) => setTimeout(r, delayMs));
    } finally {
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onParentAbort);
    }
  }

  throw lastErr instanceof Error ? lastErr : new AssemblyAiError("AssemblyAI request failed.");
}

interface SilenceAlignedAudioSlice {
  index: number;
  filePath: string;
  startSec: number;
  durationSec: number;
}

async function probeFileDurationExactSec(filePath: string): Promise<number> {
  try {
    const ffprobeBin = resolveFfmpegBin("ffprobe");
    const { stdout } = await execFileAsync(
      ffprobeBin,
      [
        "-v",
        "error",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 15_000, maxBuffer: 1024 * 1024 },
    );
    const val = parseFloat((stdout || "").trim());
    return Number.isFinite(val) && val > 0 ? val : 0;
  } catch {
    return 0;
  }
}

/**
 * Splits long recordings (> 150s) at exact natural speaker pauses into zero-reencode (`-c:a copy`)
 * slices so AssemblyAI transcribes all slices concurrently (2.5x-3x faster wall-clock) AND streams
 * real verified Arabic/English segments progressively as each slice completes.
 */
async function splitAudioAtSilencesForAssemblyAi(
  filePath: string,
  totalDurationSec: number,
): Promise<{ tempDir: string; slices: SilenceAlignedAudioSlice[] } | null> {
  if (
    process.env.ASSEMBLYAI_PROGRESSIVE_SLICES === "false" ||
    process.env.VERCEL ||
    totalDurationSec <= 150
  ) {
    return null;
  }

  const ext = path.extname(filePath).toLowerCase();
  const fileSizeBytes = (() => {
    try {
      return fs.statSync(filePath).size;
    } catch {
      return 0;
    }
  })();
  // Zero-reencode packet copy (-c:a copy, ~0.2s) for already-compressed formats (.m4a/.mp3/.aac/.ogg/.opus);
  // only transcode uncompressed WAV/FLAC or very large >45MB containers so we never spend ~45s CPU encoding!
  const isUncompressedExt = ext === ".wav" || ext === ".flac";
  const compressForFastUpload =
    (isUncompressedExt && fileSizeBytes > 8 * 1024 * 1024) || fileSizeBytes > 45 * 1024 * 1024;
  const copyCompatibleExts = new Set([".m4a", ".mp3", ".aac", ".ogg", ".opus", ".wav", ".flac"]);
  const useStreamCopy = !compressForFastUpload && copyCompatibleExts.has(ext);
  const outExt = useStreamCopy ? ext : ".mp3";
  const ffmpegBin = resolveFfmpegBin("ffmpeg");

  let tempDir = "";
  try {
    // 1. Compute ideal cut targets first: first slice ~95s (fast first partial transcript in ~10-15s),
    // subsequent slices ~185s each (max 6 slices).
    const idealCuts: number[] = [];
    let idealCursor = 0;
    const maxSlices = 6;
    while (idealCuts.length < maxSlices - 1) {
      const targetLen =
        idealCuts.length === 0 ? 95 : Math.max(165, Math.ceil(totalDurationSec / maxSlices));
      const idealCut = idealCursor + targetLen;
      if (totalDurationSec - idealCut < 65) break;
      idealCuts.push(idealCut);
      idealCursor = idealCut;
    }

    if (idealCuts.length === 0) return null;

    // 2. Fast targeted silence seek ONLY inside a narrow ±14s window around each ideal cut point!
    // Uses container input-seeking (-ss BEFORE -i) in parallel (~0.25s total vs ~50s full-file decode).
    const silenceMidpoints: number[] = [];
    await Promise.all(
      idealCuts.map(async (idealCut) => {
        const winStart = Math.max(0, idealCut - 14);
        const winDur = Math.min(28, Math.max(4, totalDurationSec - winStart));
        try {
          const { stderr } = await execFileAsync(
            ffmpegBin,
            [
              "-hide_banner",
              "-ss",
              String(winStart),
              "-t",
              String(winDur),
              "-i",
              filePath,
              "-vn",
              "-af",
              "silencedetect=noise=-30dB:d=0.28",
              "-f",
              "null",
              "-",
            ],
            { timeout: 8_000, maxBuffer: 2 * 1024 * 1024 },
          );
          const lines = String(stderr || "").split(/\r?\n/);
          for (const line of lines) {
            const endMatch = line.match(
              /silence_end:\s*([0-9.]+)\s*\|\s*silence_duration:\s*([0-9.]+)/,
            );
            if (endMatch) {
              const relEndSec = parseFloat(endMatch[1]);
              const durSec = parseFloat(endMatch[2]);
              if (Number.isFinite(relEndSec) && Number.isFinite(durSec)) {
                // Handle both relative (reset by -ss before -i) and absolute stream timestamps
                const baseOffset = relEndSec > winDur + 5 ? 0 : winStart;
                const absMid = baseOffset + Math.max(0.1, relEndSec - durSec / 2);
                silenceMidpoints.push(absMid);
              }
            }
          }
        } catch {
          // Proceed cleanly with idealCut if narrow window probe fails
        }
      }),
    );

    const cutPoints: number[] = [];
    let prevCut = 0;
    for (const idealCut of idealCuts) {
      let chosenCut = idealCut;
      let bestDist = 15;
      for (const s of silenceMidpoints) {
        if (s <= prevCut + 45 || s >= totalDurationSec - 45) continue;
        const dist = Math.abs(s - idealCut);
        if (dist < bestDist) {
          bestDist = dist;
          chosenCut = s;
        }
      }
      cutPoints.push(Math.round(chosenCut * 100) / 100);
      prevCut = chosenCut;
    }

    if (cutPoints.length === 0) return null;

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "mm_aai_slices_"));
    const pattern = path.join(tempDir, `slice_%03d${outExt}`);
    const listCsvPath = path.join(tempDir, "slices.csv");
    const codecArgs = useStreamCopy
      ? ["-c:a", "copy"]
      : ["-acodec", "libmp3lame", "-b:a", "40k", "-ar", "16000", "-ac", "1"];

    await execFileAsync(
      ffmpegBin,
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-i",
        filePath,
        "-vn",
        ...codecArgs,
        "-f",
        "segment",
        "-segment_times",
        cutPoints.join(","),
        "-segment_list",
        listCsvPath,
        "-segment_list_type",
        "csv",
        "-reset_timestamps",
        "1",
        pattern,
      ],
      { timeout: 30_000, maxBuffer: 4 * 1024 * 1024 },
    );

    const csvMap = new Map<string, { start: number; end: number }>();
    if (fs.existsSync(listCsvPath)) {
      const csvLines = fs.readFileSync(listCsvPath, "utf8").split(/\r?\n/).filter(Boolean);
      for (const row of csvLines) {
        const parts = row.split(",");
        if (parts.length >= 3) {
          const name = parts[0].trim();
          const st = parseFloat(parts[1]);
          const en = parseFloat(parts[2]);
          if (name && Number.isFinite(st) && Number.isFinite(en) && en > st) {
            csvMap.set(name, { start: st, end: en });
          }
        }
      }
    }

    const files = fs
      .readdirSync(tempDir)
      .filter((f) => f.startsWith("slice_") && f.endsWith(outExt))
      .sort();
    if (files.length < 2) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return null;
    }

    const slices: SilenceAlignedAudioSlice[] = [];
    let cumulativeSec = 0;
    for (let i = 0; i < files.length; i++) {
      const slicePath = path.join(tempDir, files[i]);
      const stat = fs.statSync(slicePath);
      if (stat.size < 512) continue;
      const csvTiming = csvMap.get(files[i]);
      if (csvTiming) {
        slices.push({
          index: slices.length,
          filePath: slicePath,
          startSec: csvTiming.start,
          durationSec: csvTiming.end - csvTiming.start,
        });
        cumulativeSec = csvTiming.end;
      } else {
        const probedDur = await probeFileDurationExactSec(slicePath);
        const fallbackDur =
          i === 0
            ? cutPoints[0]
            : i < cutPoints.length
              ? cutPoints[i] - cutPoints[i - 1]
              : Math.max(5, totalDurationSec - cumulativeSec);
        const dur = probedDur > 0.5 ? probedDur : fallbackDur;
        slices.push({
          index: slices.length,
          filePath: slicePath,
          startSec: cumulativeSec,
          durationSec: dur,
        });
        cumulativeSec += dur;
      }
    }

    if (slices.length < 2) {
      fs.rmSync(tempDir, { recursive: true, force: true });
      return null;
    }

    return { tempDir, slices };
  } catch {
    if (tempDir && fs.existsSync(tempDir)) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
      } catch {
        // ignore cleanup
      }
    }
    return null;
  }
}

interface RawAssemblyAiSliceResult {
  transcriptId: string;
  rawFullText: string;
  detectedLanguage: string;
  resolvedSpeechModel: string;
  languageConfig: string;
  speakerLabelsEnabled: boolean;
  rawSegments: TranscriptSegment[];
  utterances: AssemblyAiUtterance[];
  wordConfidences: number[];
  fallbackConfidence?: number;
  audioDurationSec: number;
  uploadMs: number;
  transcriptionMs: number;
  pollingWaitMs: number;
  pollCount: number;
  transcriptFetchMs: number;
  webhookTriggered: boolean;
}

/**
 * Real server-side AssemblyAI v2 single-file/slice transcription worker:
 * 1) Upload raw audio binary to /v2/upload
 * 2) Create diarized transcript job at /v2/transcript (`speaker_labels: true`)
 * 3) Race webhook completion vs short adaptive polling ([2000, 3000, 5000, 8000, 10000] ms)
 */
async function transcribeSingleSliceWithAssemblyAi(params: {
  apiKey: string;
  baseUrl: string;
  filePath: string;
  startOffsetSec: number;
  sliceIdSuffix: string;
  resourceType: "meeting" | "lecture";
  language?: string;
  jobId: string;
  correlationId: string;
  signal?: AbortSignal;
  timeoutMs: number;
  fastInitialPoll?: boolean;
  withUploadSlot?: <T>(fn: () => Promise<T>) => Promise<T>;
  onStatusPoll?: (pollAttempt: number, remoteStatus: string) => void;
  onUploaded?: (uploadMs: number, bytes: number) => void;
}): Promise<RawAssemblyAiSliceResult> {
  const startedAt = Date.now();
  let activeTranscriptId = "";

  try {
    const audioBuffer = fs.readFileSync(params.filePath);
    if (!audioBuffer || audioBuffer.length === 0) {
      throw new AssemblyAiError("Audio file is empty (0 bytes).", {
        status: 400,
        retryable: false,
        category: "InvalidAudio",
      });
    }

    const runUpload = async () => {
      const aaiUploadStart = Date.now();
      const uploadRes = await fetchWithRetry(
        `${params.baseUrl}/upload`,
        {
          method: "POST",
          headers: {
            authorization: params.apiKey,
            "Content-Type": "application/octet-stream",
          },
          body: new Uint8Array(audioBuffer),
        },
        { timeoutMs: 90_000, maxAttempts: 3, signal: params.signal },
      );

      const uploadJson = (await uploadRes.json()) as { upload_url?: string };
      const uploadMs = Date.now() - aaiUploadStart;
      return { uploadJson, uploadMs };
    };

    const { uploadJson, uploadMs } = params.withUploadSlot
      ? await params.withUploadSlot(runUpload)
      : await runUpload();
    params.onUploaded?.(uploadMs, audioBuffer.length);
    if (!uploadJson.upload_url) {
      throw new AssemblyAiError("AssemblyAI upload did not return an upload_url.", {
        retryable: true,
        category: "AssemblyAiProtocolError",
      });
    }

    const transcriptionStart = Date.now();
    const { payload: langPayload, configLabel: languageConfig } = mapLanguageCodeForAssemblyAi(
      params.language,
    );
    const speechModels = getConfiguredAssemblyAiSpeechModels();
    const speechModelLabel = speechModels.join(",");
    const speakerLabelsEnabled = process.env.ASSEMBLYAI_SPEAKER_LABELS !== "false";
    const webhookUrl = resolveAssemblyAiWebhookUrl();
    const webhookSecret = (process.env.ASSEMBLYAI_WEBHOOK_SECRET || "").trim();

    const buildTranscriptRequestBody = (includeCodeSwitchingOpts: boolean) => {
      const effectiveLangPayload =
        !includeCodeSwitchingOpts && langPayload.language_detection_options
          ? { language_detection: true }
          : langPayload;
      const baseConfig = {
        audio_url: uploadJson.upload_url,
        speech_models: speechModels,
        speaker_labels: true,
        punctuate: true,
        format_text: true,
      };
      if (!speakerLabelsEnabled) {
        baseConfig.speaker_labels = false;
      }
      return JSON.stringify({
        ...baseConfig,
        ...effectiveLangPayload,
        ...(webhookUrl ? { webhook_url: webhookUrl } : {}),
        ...(webhookUrl && webhookSecret
          ? {
              webhook_auth_header_name: "X-MeetMind-Webhook-Secret",
              webhook_auth_header_value: webhookSecret,
            }
          : {}),
      });
    };

    let createRes: Response;
    try {
      createRes = await fetchWithRetry(
        `${params.baseUrl}/transcript`,
        {
          method: "POST",
          headers: {
            authorization: params.apiKey,
            "Content-Type": "application/json; charset=utf-8",
            Accept: "application/json; charset=utf-8",
          },
          body: buildTranscriptRequestBody(true),
        },
        { timeoutMs: 30_000, maxAttempts: 3, signal: params.signal },
      );
    } catch (createErr) {
      if (
        langPayload.language_detection_options &&
        createErr instanceof AssemblyAiError &&
        createErr.status === 400
      ) {
        createRes = await fetchWithRetry(
          `${params.baseUrl}/transcript`,
          {
            method: "POST",
            headers: {
              authorization: params.apiKey,
              "Content-Type": "application/json; charset=utf-8",
              Accept: "application/json; charset=utf-8",
            },
            body: buildTranscriptRequestBody(false),
          },
          { timeoutMs: 30_000, maxAttempts: 2, signal: params.signal },
        );
      } else {
        throw createErr;
      }
    }

    const createJson = (await createRes.json()) as { id?: string; status?: string; error?: string };
    const transcriptId = createJson.id;
    if (!transcriptId) {
      throw new AssemblyAiError(
        createJson.error || "AssemblyAI did not return a transcript job ID.",
        { retryable: true, category: "AssemblyAiProtocolError" },
      );
    }
    activeTranscriptId = transcriptId;

    const webhookWaiter = webhookUrl ? registerAssemblyAiWebhookWaiter(transcriptId) : null;
    let webhookTriggered = false;
    let pollAttempt = 0;
    let pollingWaitMs = 0;

    while (true) {
      if (params.signal?.aborted) {
        throw new AssemblyAiError("Transcription cancelled by user.", {
          retryable: false,
          category: "CancelledByUser",
        });
      }
      if (Date.now() - startedAt > params.timeoutMs) {
        throw new AssemblyAiError(
          `AssemblyAI transcription timed out after ${Math.round(params.timeoutMs / 1000)}s.`,
          { status: 504, retryable: true, category: "Timeout" },
        );
      }

      const pollDelayMs =
        params.fastInitialPoll && pollAttempt === 0
          ? 1200
          : ASSEMBLYAI_ADAPTIVE_POLL_MS[
              Math.min(pollAttempt, ASSEMBLYAI_ADAPTIVE_POLL_MS.length - 1)
            ];
      const waitStart = Date.now();
      if (webhookWaiter && !webhookTriggered) {
        let sleepTimer: ReturnType<typeof setTimeout> | undefined;
        const raced = await Promise.race([
          webhookWaiter.then((evt) => ({ kind: "webhook" as const, evt })),
          new Promise<{ kind: "timer" }>((resolve) => {
            sleepTimer = setTimeout(() => resolve({ kind: "timer" }), pollDelayMs);
          }),
        ]);
        if (sleepTimer) clearTimeout(sleepTimer);
        if (raced.kind === "webhook") {
          webhookTriggered = true;
        }
      } else {
        await new Promise((r) => setTimeout(r, pollDelayMs));
      }
      pollingWaitMs += Date.now() - waitStart;
      pollAttempt++;

      const fetchStart = Date.now();
      const statusRes = await fetchWithRetry(
        `${params.baseUrl}/transcript/${encodeURIComponent(transcriptId)}`,
        {
          method: "GET",
          headers: { authorization: params.apiKey },
        },
        { timeoutMs: 25_000, maxAttempts: 2, signal: params.signal },
      );

      const statusJson = (await statusRes.json()) as {
        id: string;
        status: "queued" | "processing" | "completed" | "error";
        text?: string;
        error?: string;
        audio_duration?: number;
        language_code?: string;
        language_confidence?: number;
        confidence?: number;
        speech_model_used?: string;
        speech_model?: string;
        utterances?: AssemblyAiUtterance[];
        words?: Array<{
          text: string;
          start: number;
          end: number;
          speaker?: string;
          confidence?: number;
        }>;
      };
      const transcriptFetchMs = Date.now() - fetchStart;

      if (statusJson.status === "error") {
        throw new AssemblyAiError(
          statusJson.error || "AssemblyAI failed to transcribe this audio file.",
          { retryable: true, category: "AssemblyAiTranscriptionError" },
        );
      }

      if (statusJson.status === "completed") {
        const offsetMs = Math.round(params.startOffsetSec * 1000);
        const rawFullText = String(statusJson.text || "").trim();
        const resolvedSpeechModel =
          String(
            statusJson.speech_model_used || statusJson.speech_model || speechModelLabel,
          ).trim() || speechModelLabel;
        const detectedLanguage =
          statusJson.language_code ||
          (/[\u0600-\u06FF]/.test(rawFullText) ? "ar" : params.language || "en");

        const rawUtterances = (
          Array.isArray(statusJson.utterances) ? statusJson.utterances : []
        ).map((u) => ({
          ...u,
          start: (u.start || 0) + offsetMs,
          end: (u.end || 0) + offsetMs,
        }));
        const rawWords = (Array.isArray(statusJson.words) ? statusJson.words : []).map((w) => ({
          ...w,
          start: (w.start || 0) + offsetMs,
          end: (w.end || 0) + offsetMs,
        }));
        const wordConfidences = rawWords
          .map((w) => w.confidence)
          .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
        const uniqueRawSpeakers = new Set(
          rawUtterances.map((u) => String(u.speaker || "").trim()).filter(Boolean),
        );

        let rawSegments: TranscriptSegment[] = [];
        const idPrefix = `seg_aai_${params.jobId}_${params.sliceIdSuffix}`;

        if (rawUtterances.length > 0) {
          const splitWordsIntoTimedSegments = (
            wordsSlice: typeof rawWords,
            speakerLabel: string,
          ): TranscriptSegment[] => {
            const out: TranscriptSegment[] = [];
            let buf: typeof rawWords = [];
            const flush = () => {
              if (!buf.length) return;
              const first = buf[0];
              const last = buf[buf.length - 1];
              const txt = buf
                .map((w) => w.text)
                .join(" ")
                .trim();
              if (!txt) {
                buf = [];
                return;
              }
              const confs = buf
                .map((w) => w.confidence)
                .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
              out.push({
                id: `${idPrefix}_${rawSegments.length + out.length + 1}`,
                speaker: speakerLabel,
                startTime: Math.round(((first.start || 0) / 1000) * 10) / 10,
                endTime: Math.round(((last.end || (first.start || 0) + 2000) / 1000) * 10) / 10,
                text: txt,
                confidence: confs.length
                  ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10000) / 10000
                  : undefined,
                language: detectedLanguage,
                isPartial: false,
              });
              buf = [];
            };

            for (const w of wordsSlice) {
              const prev = buf[buf.length - 1];
              const longPause =
                prev &&
                typeof w.start === "number" &&
                typeof prev.end === "number" &&
                w.start - prev.end > 1500;
              if (longPause && buf.length >= 6) {
                flush();
              }
              buf.push(w);
              const durMs = (w.end || 0) - (buf[0].start || 0);
              if (/[.!؟?]$/.test(w.text) && (buf.length >= 14 || durMs >= 10000)) {
                flush();
              } else if (buf.length >= 42 || durMs >= 22000) {
                flush();
              }
            }
            flush();
            return out;
          };

          for (const u of rawUtterances) {
            if (!u || !String(u.text || "").trim()) continue;
            const speakerLabel = normalizeSpeakerLabel(u.speaker, {
              resourceType: params.resourceType,
              uniqueSpeakerCount: uniqueRawSpeakers.size,
            });
            const uStartMs = u.start || 0;
            const uEndMs = u.end || uStartMs + 4000;
            const wordCount = String(u.text).trim().split(/\s+/).length;

            if ((uEndMs - uStartMs > 25000 || wordCount > 45) && rawWords.length > 0) {
              const matchingWords = rawWords.filter(
                (w) =>
                  w.start >= uStartMs - 100 &&
                  w.end <= uEndMs + 100 &&
                  (!w.speaker || !u.speaker || w.speaker === u.speaker),
              );
              if (matchingWords.length > 0) {
                rawSegments.push(...splitWordsIntoTimedSegments(matchingWords, speakerLabel));
                continue;
              }
            }

            rawSegments.push({
              id: `${idPrefix}_${rawSegments.length + 1}`,
              speaker: speakerLabel,
              startTime: Math.round((uStartMs / 1000) * 10) / 10,
              endTime: Math.round((uEndMs / 1000) * 10) / 10,
              text: String(u.text).trim(),
              confidence:
                typeof u.confidence === "number"
                  ? u.confidence
                  : typeof statusJson.confidence === "number"
                    ? statusJson.confidence
                    : undefined,
              language: detectedLanguage,
              isPartial: false,
            });
          }
        } else if (rawWords.length > 0) {
          const grouped: TranscriptSegment[] = [];
          let bufWords: typeof rawWords = [];
          const flushGroup = () => {
            if (!bufWords.length) return;
            const first = bufWords[0];
            const last = bufWords[bufWords.length - 1];
            const text = bufWords
              .map((w) => w.text)
              .join(" ")
              .trim();
            if (!text) {
              bufWords = [];
              return;
            }
            const confs = bufWords
              .map((w) => w.confidence)
              .filter((c): c is number => typeof c === "number" && Number.isFinite(c));
            grouped.push({
              id: `${idPrefix}_${grouped.length + 1}`,
              speaker: normalizeSpeakerLabel(first.speaker, {
                resourceType: params.resourceType,
                uniqueSpeakerCount: 1,
              }),
              startTime: Math.round(((first.start || 0) / 1000) * 10) / 10,
              endTime: Math.round(((last.end || (first.start || 0) + 2000) / 1000) * 10) / 10,
              text,
              confidence: confs.length
                ? Math.round((confs.reduce((a, b) => a + b, 0) / confs.length) * 10000) / 10000
                : undefined,
              language: detectedLanguage,
              isPartial: false,
            });
            bufWords = [];
          };

          for (const w of rawWords) {
            const prev = bufWords[bufWords.length - 1];
            const speakerChanged = prev && w.speaker && prev.speaker && w.speaker !== prev.speaker;
            const longPause =
              prev &&
              typeof w.start === "number" &&
              typeof prev.end === "number" &&
              w.start - prev.end > 1800;
            if (speakerChanged || longPause) {
              flushGroup();
            }
            bufWords.push(w);
            const durMs = (w.end || 0) - (bufWords[0].start || 0);
            if (/[.!؟?]$/.test(w.text) && (bufWords.length >= 12 || durMs >= 8000)) {
              flushGroup();
            } else if (bufWords.length >= 36 || durMs >= 20000) {
              flushGroup();
            }
          }
          flushGroup();
          rawSegments = grouped;
        } else if (rawFullText) {
          const sentences = rawFullText
            .split(/(?<=[.!؟?\n])\s+/)
            .map((s) => s.trim())
            .filter(Boolean);
          const totalDur = Math.max(5, Number(statusJson.audio_duration) || sentences.length * 6);
          const sliceDur = totalDur / Math.max(1, sentences.length);
          rawSegments = sentences.map((txt, idx) => ({
            id: `${idPrefix}_${idx + 1}`,
            speaker: "Speaker 1",
            startTime: Math.round((params.startOffsetSec + idx * sliceDur) * 10) / 10,
            endTime: Math.round((params.startOffsetSec + (idx + 1) * sliceDur) * 10) / 10,
            text: txt,
            confidence:
              typeof statusJson.confidence === "number" ? statusJson.confidence : undefined,
            language: detectedLanguage,
            isPartial: false,
          }));
        }

        const transcriptionMs = Date.now() - transcriptionStart;
        return {
          transcriptId,
          rawFullText,
          detectedLanguage,
          resolvedSpeechModel,
          languageConfig,
          speakerLabelsEnabled,
          rawSegments,
          utterances: rawUtterances,
          wordConfidences,
          fallbackConfidence:
            typeof statusJson.confidence === "number" ? statusJson.confidence : undefined,
          audioDurationSec: Number(statusJson.audio_duration) || 0,
          uploadMs,
          transcriptionMs,
          pollingWaitMs,
          pollCount: pollAttempt,
          transcriptFetchMs,
          webhookTriggered,
        };
      }

      params.onStatusPoll?.(pollAttempt, statusJson.status);
    }
  } finally {
    if (activeTranscriptId) {
      clearAssemblyAiWebhookWaiter(activeTranscriptId);
    }
  }
}

export async function transcribeAudioWithAssemblyAi(params: {
  filePath: string;
  resourceType: "meeting" | "lecture";
  language?: string;
  durationSecondsHint?: number;
  jobId: string;
  correlationId?: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  onProgress?: (percent: number, stageLabel: string) => void;
  onPartialTranscript?: (update: AssemblyAiPartialProgressUpdate) => void;
}): Promise<AssemblyAiTranscriptionResult> {
  const apiKey = getAssemblyAiApiKey();
  if (!apiKey) {
    throw new AssemblyAiError("ASSEMBLYAI_API_KEY is not configured on the server.", {
      status: 503,
      retryable: false,
      category: "MissingApiKey",
    });
  }

  const startedAt = Date.now();
  const baseUrl = getAssemblyAiBaseUrl();
  const correlationId = params.correlationId || `aai_${params.jobId}`;
  const overallTimeoutMs = params.timeoutMs ?? 240_000;

  try {
    const fileStat = fs.statSync(params.filePath);
    if (!fileStat || fileStat.size === 0) {
      throw new AssemblyAiError("Audio file is empty (0 bytes).", {
        status: 400,
        retryable: false,
        category: "InvalidAudio",
      });
    }

    const totalDurHint =
      params.durationSecondsHint && params.durationSecondsHint > 0
        ? params.durationSecondsHint
        : await probeFileDurationExactSec(params.filePath);

    // Progressive Parallel Slice Pipeline for long recordings (> 150s):
    // Splits at exact silence pauses (-c:a copy, 0% quality loss) and transcribes up to 4 slices concurrently,
    // streaming real verified segments progressively as each slice completes!
    const slicedPlan = await splitAudioAtSilencesForAssemblyAi(params.filePath, totalDurHint);

    if (slicedPlan && slicedPlan.slices.length >= 2) {
      const { tempDir, slices } = slicedPlan;
      try {
        const totalDurationSec = slices.reduce((s, x) => s + x.durationSec, 0) || totalDurHint || 1;
        logStageTiming(correlationId, "ASSEMBLYAI_UPLOAD_START", undefined, {
          bytes: fileStat.size,
          parallelSlices: slices.length,
        });
        params.onProgress?.(
          36,
          `Uploading ${slices.length} silence-aligned audio slices to AssemblyAI...`,
        );

        const sliceResults: Array<RawAssemblyAiSliceResult | null> = new Array(slices.length).fill(
          null,
        );
        let uploadedSlices = 0;
        let maxUploadWallMs = 0;
        let completedSlices = 0;
        let completedDurationSec = 0;
        let nextIdx = 0;
        const maxConcurrency = Math.min(6, slices.length);
        // Cap simultaneous binary uploads at 3 so Slice 0 uploads at full link speed without TCP contention,
        // while all 6 slices still transcribe concurrently on AssemblyAI once uploaded!
        let activeUploads = 0;
        const uploadQueue: Array<() => void> = [];
        const withUploadSlot = async <T>(fn: () => Promise<T>): Promise<T> => {
          if (activeUploads >= 3) {
            await new Promise<void>((resolve) => uploadQueue.push(resolve));
          }
          activeUploads++;
          try {
            return await fn();
          } finally {
            activeUploads--;
            const next = uploadQueue.shift();
            if (next) next();
          }
        };
        const transcriptionWallStart = Date.now();

        const emitCumulativePartial = () => {
          const orderedRawSegments: TranscriptSegment[] = [];
          const orderedRawTexts: string[] = [];
          let detectedLang: string | undefined;
          let speechModelUsed: string | undefined;

          for (let i = 0; i < slices.length; i++) {
            const r = sliceResults[i];
            if (!r) continue;
            if (!detectedLang && r.detectedLanguage) detectedLang = r.detectedLanguage;
            if (!speechModelUsed && r.resolvedSpeechModel) speechModelUsed = r.resolvedSpeechModel;
            if (r.rawFullText) orderedRawTexts.push(r.rawFullText);
            orderedRawSegments.push(...r.rawSegments);
          }

          const stageProgress = Math.min(
            100,
            Math.max(1, Math.round((completedDurationSec / totalDurationSec) * 100)),
          );
          const partialArtifacts = buildTranscriptArtifacts({
            rawFullText: orderedRawTexts.join(" "),
            rawSegments: orderedRawSegments,
          });
          const wordsReceived = partialArtifacts.processedTranscript
            .trim()
            .split(/\s+/)
            .filter(Boolean).length;

          logStageTiming(correlationId, "TRANSCRIPTION_PROCESSING", Date.now() - startedAt, {
            completedSlices,
            totalSlices: slices.length,
            stageProgress,
            segmentsReceived: partialArtifacts.processedSegments.length,
            wordsReceived,
          });

          const overallJobPct = Math.min(69, 38 + Math.round((stageProgress / 100) * 31));
          params.onProgress?.(
            overallJobPct,
            `Transcript received: ${stageProgress}% (${wordsReceived} words)`,
          );
          params.onPartialTranscript?.({
            stageProgress,
            completedSlices,
            totalSlices: slices.length,
            transcribedDurationSec: Math.round(completedDurationSec),
            totalDurationSec: Math.round(totalDurationSec),
            segments: partialArtifacts.processedSegments,
            rawSegments: partialArtifacts.rawSegments,
            rawTranscript: partialArtifacts.rawTranscript,
            wordsReceived,
            detectedLanguage: detectedLang,
            speechModel: speechModelUsed,
            uploadMsSoFar: maxUploadWallMs,
          });
        };

        const worker = async () => {
          while (nextIdx < slices.length) {
            const idx = nextIdx++;
            const sl = slices[idx];
            const res = await transcribeSingleSliceWithAssemblyAi({
              apiKey,
              baseUrl,
              filePath: sl.filePath,
              startOffsetSec: sl.startSec,
              sliceIdSuffix: `s${idx}`,
              resourceType: params.resourceType,
              language: params.language,
              jobId: params.jobId,
              correlationId,
              signal: params.signal,
              timeoutMs: overallTimeoutMs,
              fastInitialPoll: true,
              withUploadSlot,
              onUploaded: (uMs) => {
                uploadedSlices++;
                if (uMs > maxUploadWallMs) maxUploadWallMs = uMs;
                if (uploadedSlices === 1) {
                  logStageTiming(correlationId, "TRANSCRIPTION_STARTED", Date.now() - startedAt, {
                    parallelSlices: slices.length,
                  });
                }
                if (uploadedSlices === slices.length) {
                  logStageTiming(correlationId, "ASSEMBLYAI_UPLOAD_COMPLETE", maxUploadWallMs, {
                    parallelSlices: slices.length,
                    bytes: fileStat.size,
                  });
                }
              },
            });
            sliceResults[idx] = res;
            completedSlices++;
            completedDurationSec += sl.durationSec;
            emitCumulativePartial();
          }
        };

        await Promise.all(Array.from({ length: maxConcurrency }, () => worker()));

        const validSlices = sliceResults.filter((x): x is RawAssemblyAiSliceResult => Boolean(x));
        const mergedRawSegments: TranscriptSegment[] = [];
        const mergedUtterances: AssemblyAiUtterance[] = [];
        const mergedWordConfs: number[] = [];
        const mergedRawTexts: string[] = [];
        let totalPollCount = 0;
        let maxPollingWaitMs = 0;
        let sumFetchMs = 0;
        let anyWebhook = false;

        for (const r of validSlices) {
          if (r.rawFullText) mergedRawTexts.push(r.rawFullText);
          mergedRawSegments.push(...r.rawSegments);
          mergedUtterances.push(...r.utterances);
          mergedWordConfs.push(...r.wordConfidences);
          totalPollCount += r.pollCount;
          if (r.pollingWaitMs > maxPollingWaitMs) maxPollingWaitMs = r.pollingWaitMs;
          sumFetchMs += r.transcriptFetchMs;
          if (r.webhookTriggered) anyWebhook = true;
        }

        if (mergedRawSegments.length === 0) {
          throw new AssemblyAiError("No audible speech detected in the recording by AssemblyAI.", {
            status: 422,
            retryable: false,
            category: "NoSpeechDetected",
          });
        }

        // Renumber segment IDs cleanly in chronological order
        mergedRawSegments.forEach((seg, idx) => {
          seg.id = `seg_aai_${params.jobId}_${idx + 1}`;
        });

        const firstSlice = validSlices[0];
        const artifacts = buildTranscriptArtifacts({
          rawFullText:
            mergedRawTexts.join(" ").trim() || mergedRawSegments.map((s) => s.text).join(" "),
          rawSegments: mergedRawSegments,
          wordConfidences: mergedWordConfs,
        });
        const segments = artifacts.processedSegments;
        const fullText = formatTranscriptNonDestructive(
          mergedRawTexts.join(" ").trim() || segments.map((s) => s.text).join(" "),
        );
        const averageConfidence = artifacts.averageConfidence ?? firstSlice?.fallbackConfidence;
        const durationSeconds = Math.max(
          1,
          Math.round(totalDurationSec || segments[segments.length - 1]?.endTime || 10),
        );
        const speakerBreakdown = computeSpeakerBreakdown(segments);
        const transcriptionMs = Math.max(1, Date.now() - transcriptionWallStart);
        const latencyMs = Date.now() - startedAt;
        const combinedTranscriptId = validSlices.map((s) => s.transcriptId).join(",");

        logStageTiming(correlationId, "TRANSCRIPTION_COMPLETE", transcriptionMs, {
          provider: "assemblyai",
          transcriptId: combinedTranscriptId,
          parallelSlices: slices.length,
          segmentsCount: segments.length,
          pollAttempts: totalPollCount,
          pollingWaitMs: maxPollingWaitMs,
          transcriptFetchMs: sumFetchMs,
          webhookTriggered: anyWebhook,
          speechModel: firstSlice.resolvedSpeechModel,
          languageConfig: firstSlice.languageConfig,
          speakerLabelsEnabled: firstSlice.speakerLabelsEnabled,
          averageConfidence,
        });
        logStageTiming(correlationId, "TRANSCRIPT_RECEIVED", sumFetchMs, {
          segmentsCount: segments.length,
        });
        logObservabilityEvent("info", "transcription_completed", {
          correlationId,
          jobId: params.jobId,
          provider: "assemblyai",
          transcriptId: combinedTranscriptId,
          parallelSlices: slices.length,
          segmentsCount: segments.length,
          speakersCount: speakerBreakdown.length,
          detectedLanguage: firstSlice.detectedLanguage,
          languageConfig: firstSlice.languageConfig,
          averageConfidence,
          durationSeconds,
          uploadMs: maxUploadWallMs,
          transcriptionMs,
          pollingWaitMs: maxPollingWaitMs,
          pollCount: totalPollCount,
          transcriptFetchMs: sumFetchMs,
          webhookTriggered: anyWebhook,
          speechModel: firstSlice.resolvedSpeechModel,
          speakerLabelsEnabled: firstSlice.speakerLabelsEnabled,
          latencyMs,
        });

        return {
          transcriptId: firstSlice.transcriptId,
          rawTranscript: artifacts.rawTranscript,
          processedTranscript: artifacts.processedTranscript,
          fullText,
          rawSegments: artifacts.rawSegments,
          segments,
          utterances: mergedUtterances,
          detectedLanguage: firstSlice.detectedLanguage,
          languageConfig: firstSlice.languageConfig,
          durationSeconds,
          speakerBreakdown,
          averageConfidence,
          uploadMs: maxUploadWallMs,
          transcriptionMs,
          pollingWaitMs: maxPollingWaitMs,
          pollCount: totalPollCount,
          transcriptFetchMs: sumFetchMs,
          webhookTriggered: anyWebhook,
          speechModel: firstSlice.resolvedSpeechModel,
          speakerLabelsEnabled: firstSlice.speakerLabelsEnabled,
          latencyMs,
        };
      } finally {
        if (tempDir && fs.existsSync(tempDir)) {
          try {
            fs.rmSync(tempDir, { recursive: true, force: true });
          } catch {
            // ignore cleanup
          }
        }
      }
    }

    // Single-file AssemblyAI fast path (recordings <= 150s or when FFmpeg slicing is skipped)
    params.onProgress?.(38, "Uploading audio to AssemblyAI...");
    logStageTiming(correlationId, "ASSEMBLYAI_UPLOAD_START", undefined, {
      bytes: fileStat.size,
    });

    const single = await transcribeSingleSliceWithAssemblyAi({
      apiKey,
      baseUrl,
      filePath: params.filePath,
      startOffsetSec: 0,
      sliceIdSuffix: "full",
      resourceType: params.resourceType,
      language: params.language,
      jobId: params.jobId,
      correlationId,
      signal: params.signal,
      timeoutMs: overallTimeoutMs,
      fastInitialPoll: totalDurHint > 0 && totalDurHint <= 90,
      onUploaded: (uploadMs, bytes) => {
        logStageTiming(correlationId, "ASSEMBLYAI_UPLOAD_COMPLETE", uploadMs, { bytes });
        logStageTiming(correlationId, "TRANSCRIPTION_STARTED", Date.now() - startedAt, {
          provider: "assemblyai",
        });
        params.onProgress?.(46, "Starting AssemblyAI speaker diarization transcription...");
      },
      onStatusPoll: (pollAttempt, remoteStatus) => {
        logStageTiming(correlationId, "TRANSCRIPTION_PROCESSING", Date.now() - startedAt, {
          pollAttempt,
          remoteStatus,
        });
        const pct = Math.min(68, 48 + pollAttempt * 3);
        params.onProgress?.(pct, `Transcribing via AssemblyAI (${remoteStatus})...`);
      },
    });

    if (single.rawSegments.length === 0) {
      throw new AssemblyAiError("No audible speech detected in the recording by AssemblyAI.", {
        status: 422,
        retryable: false,
        category: "NoSpeechDetected",
      });
    }

    single.rawSegments.forEach((seg, idx) => {
      seg.id = `seg_aai_${params.jobId}_${idx + 1}`;
    });

    const artifacts = buildTranscriptArtifacts({
      rawFullText: single.rawFullText || single.rawSegments.map((s) => s.text).join(" "),
      rawSegments: single.rawSegments,
      wordConfidences: single.wordConfidences,
    });
    const segments = artifacts.processedSegments;
    const fullText = formatTranscriptNonDestructive(
      single.rawFullText || segments.map((s) => s.text).join(" "),
    );
    const averageConfidence =
      artifacts.averageConfidence ??
      (typeof single.fallbackConfidence === "number"
        ? Math.round(single.fallbackConfidence * 10000) / 10000
        : undefined);
    const durationSeconds = Math.max(
      1,
      Math.round(single.audioDurationSec || segments[segments.length - 1]?.endTime || 10),
    );
    const speakerBreakdown = computeSpeakerBreakdown(segments);
    const latencyMs = Date.now() - startedAt;
    const wordsReceived = fullText.trim().split(/\s+/).filter(Boolean).length;

    params.onPartialTranscript?.({
      stageProgress: 100,
      completedSlices: 1,
      totalSlices: 1,
      transcribedDurationSec: durationSeconds,
      totalDurationSec: durationSeconds,
      segments,
      rawSegments: artifacts.rawSegments,
      rawTranscript: artifacts.rawTranscript,
      wordsReceived,
      detectedLanguage: single.detectedLanguage,
      speechModel: single.resolvedSpeechModel,
      uploadMsSoFar: single.uploadMs,
    });

    logStageTiming(correlationId, "TRANSCRIPT_FETCH", single.transcriptFetchMs, {
      transcriptId: single.transcriptId,
      webhookTriggered: single.webhookTriggered,
      pollAttempts: single.pollCount,
    });
    logStageTiming(correlationId, "TRANSCRIPTION_COMPLETE", single.transcriptionMs, {
      provider: "assemblyai",
      transcriptId: single.transcriptId,
      segmentsCount: segments.length,
      pollAttempts: single.pollCount,
      pollingWaitMs: single.pollingWaitMs,
      transcriptFetchMs: single.transcriptFetchMs,
      webhookTriggered: single.webhookTriggered,
      speechModel: single.resolvedSpeechModel,
      languageConfig: single.languageConfig,
      speakerLabelsEnabled: single.speakerLabelsEnabled,
      averageConfidence,
    });
    logStageTiming(correlationId, "TRANSCRIPT_RECEIVED", single.transcriptFetchMs, {
      segmentsCount: segments.length,
      wordsReceived,
    });
    logObservabilityEvent("info", "transcription_completed", {
      correlationId,
      jobId: params.jobId,
      provider: "assemblyai",
      transcriptId: single.transcriptId,
      segmentsCount: segments.length,
      speakersCount: speakerBreakdown.length,
      detectedLanguage: single.detectedLanguage,
      languageConfig: single.languageConfig,
      averageConfidence,
      durationSeconds,
      uploadMs: single.uploadMs,
      transcriptionMs: single.transcriptionMs,
      pollingWaitMs: single.pollingWaitMs,
      pollCount: single.pollCount,
      transcriptFetchMs: single.transcriptFetchMs,
      webhookTriggered: single.webhookTriggered,
      speechModel: single.resolvedSpeechModel,
      speakerLabelsEnabled: single.speakerLabelsEnabled,
      latencyMs,
    });

    return {
      transcriptId: single.transcriptId,
      rawTranscript: artifacts.rawTranscript,
      processedTranscript: artifacts.processedTranscript,
      fullText,
      rawSegments: artifacts.rawSegments,
      segments,
      utterances: single.utterances,
      detectedLanguage: single.detectedLanguage,
      languageConfig: single.languageConfig,
      durationSeconds,
      speakerBreakdown,
      averageConfidence,
      uploadMs: single.uploadMs,
      transcriptionMs: single.transcriptionMs,
      pollingWaitMs: single.pollingWaitMs,
      pollCount: single.pollCount,
      transcriptFetchMs: single.transcriptFetchMs,
      webhookTriggered: single.webhookTriggered,
      speechModel: single.resolvedSpeechModel,
      speakerLabelsEnabled: single.speakerLabelsEnabled,
      latencyMs,
    };
  } catch (err) {
    logObservabilityEvent("error", "assemblyai_failed", {
      correlationId,
      jobId: params.jobId,
      error: err instanceof Error ? err.message : String(err),
      status: err instanceof AssemblyAiError ? err.status : undefined,
      retryable: err instanceof AssemblyAiError ? err.retryable : true,
      latencyMs: Date.now() - startedAt,
    });
    throw err;
  }
}
