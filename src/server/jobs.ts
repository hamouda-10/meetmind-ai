import crypto from "node:crypto";
import { execFile } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { promisify } from "node:util";

const nodeRequire = createRequire(import.meta.url);

// Ensure static ffmpeg & ffprobe binaries from @ffmpeg-installer are in PATH if system binaries are absent
try {
  const ffmpegInstaller = nodeRequire("@ffmpeg-installer/ffmpeg");
  const ffprobeInstaller = nodeRequire("@ffprobe-installer/ffprobe");
  const extraDirs: string[] = [];
  if (ffmpegInstaller?.path && fs.existsSync(ffmpegInstaller.path)) {
    extraDirs.push(path.dirname(ffmpegInstaller.path));
  }
  if (ffprobeInstaller?.path && fs.existsSync(ffprobeInstaller.path)) {
    extraDirs.push(path.dirname(ffprobeInstaller.path));
  }
  if (extraDirs.length > 0) {
    const sep = path.delimiter;
    process.env.PATH = `${extraDirs.join(sep)}${sep}${process.env.PATH || ""}`;
  }
} catch {
  // best effort
}

import { ThinkingLevel } from "@google/genai";
import { db, JobRecord, TranscriptSegment } from "./db";
import { transcribeAudioWithLocalWhisper } from "./whisper-asr";
import {
  extractHighlightsFromSegments,
  extractKeywordsWithFrequency,
  generateAiSummary,
  generateAiLectureAnalysis,
  generateAiQuiz,
  generateAiFlashcards,
  generateAiMindMap,
  generateUnifiedRecordingAnalysis,
  type UnifiedRecordingAnalysisResult,
} from "./ai";
import {
  extractGeminiTranscriptText,
  getGeminiClient,
  extractHttpStatus,
  isBillingExhaustionError,
  isRetryableGeminiError,
  logGeminiStructured,
  suspendCloudGeminiTemporarily,
  GeminiPipelineError,
} from "./gemini";
import { getChunksDir, inspectMediaContainerSignature } from "./storage";
import { notifySync } from "./sync";
import {
  computeSpeakerBreakdown,
  getConfiguredAssemblyAiSpeechModels,
  isAssemblyAiConfigured,
  transcribeAudioWithAssemblyAi,
  type AssemblyAiSpeakerStat,
} from "./assemblyai";
import { buildTranscriptArtifacts } from "./transcript-format";
import { executeN8nAudioWorkflow, getN8nConfig, type N8nWorkflowResult } from "./n8n-integration";
import {
  createCorrelationId,
  logObservabilityEvent,
  logStageTiming,
  type CanonicalPipelineStage,
  type StageTelemetryEntry,
  type StageTimings,
} from "./pipeline-logger";
import {
  attachCachedAnalysisToAudioHash,
  computeFileSha256,
  computeTranscriptSha256,
  getCachedTranscriptByAudioHash,
  setCachedTranscriptByAudioHash,
} from "./pipeline-cache";

const TEXT_MODEL = "gemini-3.5-flash";

const execFileAsync = promisify(execFile);
const CHUNKS_BASE_DIR = getChunksDir();
const AI_SERVICE_URL = process.env.AI_SERVICE_URL?.replace(/\/$/, "");
const MAX_SIZE_BYTES = Number(process.env.MAX_RECORDING_SIZE_MB || 500) * 1024 * 1024;
const INLINE_AUDIO_LIMIT_BYTES = 8 * 1024 * 1024;

if (!fs.existsSync(CHUNKS_BASE_DIR)) {
  fs.mkdirSync(CHUNKS_BASE_DIR, { recursive: true });
}

let cachedMediaToolsStatus: { ffmpeg: boolean; ffprobe: boolean; checkedAt: number } | null = null;

function isBinaryUnavailableError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string | number; message?: string };
  // A numeric exit code proves the binary executed and rejected the media file
  if (typeof e.code === "number") return false;
  const code = String(e.code || "");
  const msg = String(e.message || "");
  return (
    code === "ENOENT" ||
    code === "EACCES" ||
    code === "ERR_UNSUPPORTED" ||
    /ENOENT|command not found|not implemented|spawn (?:ffmpeg|ffprobe)\s+ENOENT/i.test(msg)
  );
}

export async function checkMediaToolsAvailable(): Promise<{ ffmpeg: boolean; ffprobe: boolean }> {
  if (cachedMediaToolsStatus && Date.now() - cachedMediaToolsStatus.checkedAt < 60_000) {
    return { ffmpeg: cachedMediaToolsStatus.ffmpeg, ffprobe: cachedMediaToolsStatus.ffprobe };
  }
  const [ffprobeOk, ffmpegOk] = await Promise.all([
    execFileAsync("ffprobe", ["-version"], { timeout: 5000 })
      .then(() => true)
      .catch(() => false),
    execFileAsync("ffmpeg", ["-version"], { timeout: 5000 })
      .then(() => true)
      .catch(() => false),
  ]);
  cachedMediaToolsStatus = { ffmpeg: ffmpegOk, ffprobe: ffprobeOk, checkedAt: Date.now() };
  return { ffmpeg: ffmpegOk, ffprobe: ffprobeOk };
}

const cancelledJobs = new Set<string>();
const BLOCKED_NON_MEDIA_EXTENSIONS = new Set([
  ".txt",
  ".md",
  ".csv",
  ".json",
  ".xml",
  ".html",
  ".htm",
  ".css",
  ".js",
  ".ts",
  ".tsx",
  ".jsx",
  ".py",
  ".cs",
  ".java",
  ".c",
  ".cpp",
  ".sh",
  ".bat",
  ".ps1",
  ".exe",
  ".dll",
  ".so",
  ".dmg",
  ".msi",
  ".zip",
  ".rar",
  ".7z",
  ".tar",
  ".gz",
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".svg",
  ".bmp",
  ".webp",
  ".ico",
]);

function logPipelineEvent(
  level: "info" | "warn" | "error",
  event: string,
  details: Record<string, unknown>,
) {
  const entry = JSON.stringify({
    ts: new Date().toISOString(),
    service: "meetmind-pipeline",
    level,
    event,
    ...details,
  });
  if (level === "error") console.error(entry);
  else if (level === "warn") console.warn(entry);
  else console.info(entry);
}

export interface MediaProbeResult {
  valid: boolean;
  error?: string;
  category?: string;
  correlationId?: string;
  hasAudio: boolean;
  hasVideo: boolean;
  durationSeconds: number;
  formatName?: string;
  codec?: string;
  detectedMimeType?: string;
  ffprobeAvailable?: boolean;
  repairedPath?: string;
}

async function probeDurationSeconds(filePath: string): Promise<number> {
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-analyzeduration",
        "100M",
        "-probesize",
        "100M",
        "-show_entries",
        "format=duration",
        "-of",
        "default=noprint_wrappers=1:nokey=1",
        filePath,
      ],
      { timeout: 45000, maxBuffer: 4 * 1024 * 1024 },
    );
    const dur = parseFloat((stdout || "").trim());
    return isNaN(dur) || dur < 0 ? 0 : dur;
  } catch {
    return 0;
  }
}

async function tryTolerantFfmpegRepair(
  inputPath: string,
): Promise<{ repairedPath: string; durationSeconds: number } | null> {
  const repairedPath = `${inputPath}.repaired.wav`;
  const demuxerAttempts: Array<string[]> = [
    [],
    ["-f", "aac"],
    ["-f", "mp3"],
    ["-f", "ogg"],
    ["-f", "matroska"],
    ["-f", "amr"],
    ["-f", "wav"],
  ];

  for (const demuxArgs of demuxerAttempts) {
    try {
      if (fs.existsSync(repairedPath)) fs.unlinkSync(repairedPath);
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
          "-analyzeduration",
          "100M",
          "-probesize",
          "100M",
          ...demuxArgs,
          "-i",
          inputPath,
          "-vn",
          "-acodec",
          "pcm_s16le",
          "-ar",
          "16000",
          "-ac",
          "1",
          repairedPath,
        ],
        { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
      );

      if (fs.existsSync(repairedPath) && fs.statSync(repairedPath).size > 2048) {
        const dur = await probeDurationSeconds(repairedPath);
        if (dur >= 0.5) {
          return { repairedPath, durationSeconds: dur };
        }
        // Decoded audio was genuinely too short
        fs.unlinkSync(repairedPath);
        return { repairedPath: "", durationSeconds: dur };
      }
    } catch {
      if (fs.existsSync(repairedPath)) {
        try {
          fs.unlinkSync(repairedPath);
        } catch {
          /* ignore */
        }
      }
    }
  }

  return null;
}

export async function validateMediaFile(
  filePath: string,
  originalFilename?: string,
): Promise<MediaProbeResult> {
  const correlationId = `val_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`;

  if (!fs.existsSync(filePath)) {
    return {
      valid: false,
      error: `Media file not found on storage (ref: ${correlationId}).`,
      category: "StorageError",
      correlationId,
      hasAudio: false,
      hasVideo: false,
      durationSeconds: 0,
    };
  }

  const stat = fs.statSync(filePath);
  if (stat.size <= 0) {
    return {
      valid: false,
      error: "Uploaded file is empty (0 bytes).",
      category: "MediaValidationError",
      correlationId,
      hasAudio: false,
      hasVideo: false,
      durationSeconds: 0,
    };
  }
  if (stat.size > MAX_SIZE_BYTES) {
    return {
      valid: false,
      error: `File exceeds maximum allowed size of ${Math.round(MAX_SIZE_BYTES / (1024 * 1024))} MB.`,
      category: "FileSizeLimitExceeded",
      correlationId,
      hasAudio: false,
      hasVideo: false,
      durationSeconds: 0,
    };
  }

  const ext = path.extname(originalFilename || filePath).toLowerCase();
  if (ext && BLOCKED_NON_MEDIA_EXTENSIONS.has(ext)) {
    return {
      valid: false,
      error: `Unsupported non-media file format (${ext}).`,
      category: "UnsupportedMediaFormat",
      correlationId,
      hasAudio: false,
      hasVideo: false,
      durationSeconds: 0,
    };
  }

  // Always inspect actual binary container magic bytes (works even if extension mismatches or ffprobe is unavailable)
  const signature = inspectMediaContainerSignature(filePath);
  if (signature.isLikelyTextOrNonMedia) {
    return {
      valid: false,
      error: `Unsupported media container: file contents are not audio or video (ref: ${correlationId}).`,
      category: "UnsupportedMediaContainer",
      correlationId,
      hasAudio: false,
      hasVideo: false,
      durationSeconds: 0,
    };
  }

  let probeErrorMsg = "";
  let ffprobeUnavailable = false;
  try {
    const { stdout } = await execFileAsync(
      "ffprobe",
      [
        "-v",
        "error",
        "-analyzeduration",
        "100M",
        "-probesize",
        "100M",
        "-show_entries",
        "stream=codec_type,codec_name,duration:format=duration,format_name",
        "-of",
        "json",
        filePath,
      ],
      { timeout: 60000, maxBuffer: 10 * 1024 * 1024 },
    );

    const parsed = JSON.parse(stdout || "{}");
    const streams = Array.isArray(parsed.streams) ? parsed.streams : [];
    const audioStream = streams.find((s: { codec_type?: string }) => s.codec_type === "audio");
    const hasAudio = Boolean(audioStream);
    const hasVideo = streams.some((s: { codec_type?: string }) => s.codec_type === "video");
    const audioStreamDur = streams
      .filter((s: { codec_type?: string }) => s.codec_type === "audio")
      .map((s: { duration?: string }) => parseFloat(s.duration || "0"))
      .find((d: number) => !isNaN(d) && d > 0);
    const rawDuration = parseFloat(parsed.format?.duration || "0") || audioStreamDur || 0;
    const durationSeconds = isNaN(rawDuration) ? 0 : rawDuration;
    const formatName = String(parsed.format?.format_name || signature.containerName || "unknown");
    const codec = String(audioStream?.codec_name || "unknown");

    if (!hasAudio && hasVideo) {
      return {
        valid: false,
        error: "Invalid audio stream: video file contains no audio track.",
        category: "InvalidAudioStream",
        correlationId,
        hasAudio: false,
        hasVideo: true,
        durationSeconds,
        formatName,
        ffprobeAvailable: true,
      };
    }

    if (hasAudio) {
      if (durationSeconds > 0 && durationSeconds < 0.5) {
        return {
          valid: false,
          error: "Recording is too short (minimum 0.5 seconds).",
          category: "MediaValidationError",
          correlationId,
          hasAudio,
          hasVideo,
          durationSeconds,
          formatName,
          codec,
          ffprobeAvailable: true,
        };
      }
      return {
        valid: true,
        correlationId,
        hasAudio,
        hasVideo,
        durationSeconds: Math.max(1, Math.round(durationSeconds || 1)),
        formatName,
        codec,
        detectedMimeType: signature.recognized ? signature.mimeType : getAudioMimeType(filePath),
        ffprobeAvailable: true,
      };
    }
  } catch (err) {
    probeErrorMsg = err instanceof Error ? err.message : String(err);
    ffprobeUnavailable = isBinaryUnavailableError(err);
  }

  // Production resilience: if ffprobe is not installed in a slim runtime container,
  // validate strictly using real binary magic-byte container signatures rather than falsely claiming corruption.
  if (ffprobeUnavailable) {
    if (signature.recognized) {
      logPipelineEvent("warn", "ffprobe_unavailable_binary_signature_validated", {
        correlationId,
        originalFilename: originalFilename || path.basename(filePath),
        sizeBytes: stat.size,
        containerName: signature.containerName,
        mimeType: signature.mimeType,
      });
      return {
        valid: true,
        correlationId,
        hasAudio: true,
        hasVideo: false,
        durationSeconds: Math.max(1, Math.round(stat.size / 16000)),
        formatName: signature.containerName,
        detectedMimeType: signature.mimeType,
        ffprobeAvailable: false,
      };
    }

    logPipelineEvent("error", "ffprobe_unavailable_unrecognized_container", {
      correlationId,
      originalFilename: originalFilename || path.basename(filePath),
      sizeBytes: stat.size,
    });
    return {
      valid: false,
      error: `Unsupported media container: unrecognized binary signature while FFprobe is unavailable (ref: ${correlationId}).`,
      category: "FFmpegUnavailable",
      correlationId,
      hasAudio: false,
      hasVideo: false,
      durationSeconds: 0,
      ffprobeAvailable: false,
    };
  }

  // Fallback: tolerant FFmpeg decode/repair for real-world phone/WhatsApp/M4A containers with header quirks
  const recovered = await tryTolerantFfmpegRepair(filePath);
  if (recovered) {
    if (!recovered.repairedPath && recovered.durationSeconds < 0.5) {
      return {
        valid: false,
        error: "Recording is too short (minimum 0.5 seconds).",
        category: "MediaValidationError",
        correlationId,
        hasAudio: true,
        hasVideo: false,
        durationSeconds: recovered.durationSeconds,
        ffprobeAvailable: true,
      };
    }
    if (recovered.repairedPath) {
      logPipelineEvent("info", "media_container_repaired", {
        correlationId,
        originalFilename: originalFilename || path.basename(filePath),
        sizeBytes: stat.size,
        durationSeconds: Math.round(recovered.durationSeconds),
      });
      return {
        valid: true,
        correlationId,
        hasAudio: true,
        hasVideo: false,
        durationSeconds: Math.max(1, Math.round(recovered.durationSeconds)),
        formatName: "wav",
        codec: "pcm_s16le",
        detectedMimeType: "audio/wav",
        ffprobeAvailable: true,
        repairedPath: recovered.repairedPath,
      };
    }
  }

  logPipelineEvent("warn", "media_validation_failed", {
    correlationId,
    originalFilename: originalFilename || path.basename(filePath),
    sizeBytes: stat.size,
    recognizedSignature: signature.recognized,
    containerName: signature.containerName,
    reason: probeErrorMsg.slice(0, 240),
  });

  return {
    valid: false,
    error: `File is corrupted or unreadable media container (ref: ${correlationId}).`,
    category: "UnsupportedMediaContainer",
    correlationId,
    hasAudio: false,
    hasVideo: false,
    durationSeconds: 0,
    ffprobeAvailable: true,
  };
}

async function extractAndNormalizeAudio(inputPath: string, outputPath: string): Promise<number> {
  const baseArgs = [
    "-y",
    "-hide_banner",
    "-loglevel",
    "error",
    "-err_detect",
    "ignore_err",
    "-fflags",
    "+genpts+igndts+discardcorrupt",
    "-analyzeduration",
    "100M",
    "-probesize",
    "100M",
    "-i",
    inputPath,
    "-vn",
  ];
  const outArgs = ["-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1", outputPath];

  try {
    await execFileAsync(
      "ffmpeg",
      [
        ...baseArgs,
        "-af",
        "highpass=f=80,lowpass=f=7600,dynaudnorm=f=200:g=15:p=0.9:m=6",
        ...outArgs,
      ],
      { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
    );
  } catch {
    await execFileAsync("ffmpeg", [...baseArgs, ...outArgs], {
      timeout: 300000,
      maxBuffer: 10 * 1024 * 1024,
    });
  }

  // Fast exact duration from 16kHz mono 16-bit PCM WAV byte size (32,000 bytes/sec), avoiding extra ffprobe spawn
  try {
    const stat = fs.statSync(outputPath);
    if (stat.size > 44) {
      return Math.max(1, Math.round((stat.size - 44) / 32000));
    }
  } catch {
    // fallback to ffprobe below
  }

  const dur = await probeDurationSeconds(outputPath);
  return dur <= 0 ? 1 : Math.round(dur);
}

async function splitAudioIntoChunks(
  audioPath: string,
  outputDir: string,
  chunkDurationSec = 120,
): Promise<Array<{ chunkIndex: number; filePath: string; startSec: number; endSec: number }>> {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }
  const chunkPattern = path.join(outputDir, "chunk_%03d.mp3");
  await execFileAsync(
    "ffmpeg",
    [
      "-y",
      "-hide_banner",
      "-loglevel",
      "error",
      "-i",
      audioPath,
      "-f",
      "segment",
      "-segment_time",
      String(chunkDurationSec),
      "-reset_timestamps",
      "1",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-b:a",
      "48k",
      "-ar",
      "16000",
      "-ac",
      "1",
      chunkPattern,
    ],
    { timeout: 300000, maxBuffer: 10 * 1024 * 1024 },
  );

  const files = fs
    .readdirSync(outputDir)
    .filter((f) => f.startsWith("chunk_") && f.endsWith(".mp3"))
    .sort();

  const chunks: Array<{ chunkIndex: number; filePath: string; startSec: number; endSec: number }> =
    [];
  for (let i = 0; i < files.length; i++) {
    const chunkFile = path.join(outputDir, files[i]);
    const startSec = i * chunkDurationSec;
    const probed = await probeDurationSeconds(chunkFile);
    const dur = probed > 0 ? Math.round(probed) : chunkDurationSec;
    chunks.push({
      chunkIndex: i,
      filePath: chunkFile,
      startSec,
      endSec: startSec + dur,
    });
  }
  return chunks;
}

function getAudioMimeType(filePath: string): string {
  // Always prefer real binary container signature over filename extension
  // (e.g. a WebM/Opus file saved with `.m4a` extension must be sent as `audio/webm`)
  const sig = inspectMediaContainerSignature(filePath);
  if (sig.recognized && sig.mimeType) {
    return sig.mimeType;
  }

  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case ".mp3":
      return "audio/mp3";
    case ".wav":
      return "audio/wav";
    case ".m4a":
    case ".aac":
    case ".mp4":
      return "audio/mp4";
    case ".ogg":
    case ".oga":
    case ".opus":
      return "audio/ogg";
    case ".flac":
      return "audio/flac";
    case ".webm":
      return "audio/webm";
    default:
      return "audio/wav";
  }
}

function splitVerbatimTextIntoSegments(
  rawText: string,
  isMeeting: boolean,
  startOffsetSec: number,
  durationSeconds: number,
  language: string,
): TranscriptSegment[] {
  const cleaned = rawText
    .replace(/^```(?:json|text)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  if (!cleaned) return [];

  const rawSentences = cleaned
    .split(/(?<=[.!?؟।\n])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 1);

  if (rawSentences.length === 0) {
    return [
      {
        id: `seg_${Date.now()}_1`,
        speaker: isMeeting ? "Speaker 1" : "Lecturer",
        startTime: startOffsetSec,
        endTime: startOffsetSec + Math.max(5, durationSeconds),
        text: cleaned,
        confidence: 0.9,
        language,
        isPartial: false,
      },
    ];
  }

  const groupedTexts: string[] = [];
  let currentGroup = "";
  for (const sent of rawSentences) {
    if (currentGroup.length + sent.length > 180 && currentGroup.length > 0) {
      groupedTexts.push(currentGroup.trim());
      currentGroup = sent;
    } else {
      currentGroup = currentGroup ? `${currentGroup} ${sent}` : sent;
    }
  }
  if (currentGroup.trim()) groupedTexts.push(currentGroup.trim());

  const totalChars = Math.max(
    1,
    groupedTexts.reduce((acc, t) => acc + t.length, 0),
  );
  const effectiveDuration = Math.max(groupedTexts.length * 4, durationSeconds || 10);
  let cursorSec = startOffsetSec;

  return groupedTexts.map((txt, idx) => {
    const share = Math.max(2, Math.round((txt.length / totalChars) * effectiveDuration));
    const segStart = cursorSec;
    const segEnd =
      idx === groupedTexts.length - 1
        ? Math.max(segStart + 2, startOffsetSec + effectiveDuration)
        : segStart + share;
    cursorSec = segEnd;

    let speaker = isMeeting ? `Speaker ${(idx % 2) + 1}` : "Lecturer";
    let cleanText = txt;
    const speakerMatch = txt.match(/^([^:]{2,25}):\s*(.+)$/s);
    if (speakerMatch) {
      speaker = speakerMatch[1].trim();
      cleanText = speakerMatch[2].trim();
    }

    return {
      id: `seg_${Date.now()}_${idx + 1}`,
      speaker,
      startTime: segStart,
      endTime: segEnd,
      text: cleanText,
      confidence: 0.9,
      language,
      isPartial: false,
    };
  });
}

async function transcribeWithPythonAiService(
  audioFilePath: string,
  resourceType: "meeting" | "lecture",
  language: string,
): Promise<TranscriptSegment[]> {
  if (!AI_SERVICE_URL) return [];
  try {
    const fileBuf = fs.readFileSync(audioFilePath);
    const form = new FormData();
    form.append("file", new Blob([fileBuf]), path.basename(audioFilePath));
    form.append("is_meeting", resourceType === "meeting" ? "true" : "false");
    form.append("language", language || "auto");

    const resp = await fetch(`${AI_SERVICE_URL}/api/v1/transcribe`, {
      method: "POST",
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    if (!resp.ok) return [];
    const data = (await resp.json()) as {
      segments?: Array<{
        id?: string;
        speaker?: string;
        start_time?: number;
        end_time?: number;
        startTime?: number;
        endTime?: number;
        text?: string;
        confidence?: number;
        language?: string;
      }>;
      detected_language?: string;
    };
    if (!Array.isArray(data.segments)) return [];
    return data.segments
      .filter((s) => s.text && s.text.trim())
      .map((s, idx) => {
        const sTime =
          typeof s.start_time === "number"
            ? s.start_time
            : typeof s.startTime === "number"
              ? s.startTime
              : idx * 5;
        const eTime =
          typeof s.end_time === "number"
            ? s.end_time
            : typeof s.endTime === "number"
              ? s.endTime
              : sTime + 5;
        return {
          id: s.id || `seg_py_${Date.now()}_${idx + 1}`,
          speaker: s.speaker || (resourceType === "meeting" ? "Speaker 1" : "Lecturer"),
          startTime: sTime,
          endTime: eTime,
          text: s.text!.trim(),
          confidence: typeof s.confidence === "number" ? s.confidence : 0.92,
          language: s.language || data.detected_language || language,
          isPartial: false,
        };
      });
  } catch {
    return [];
  }
}

interface GeminiTranscriptionOutcome {
  segments: TranscriptSegment[];
  errorMessage?: string;
  silent?: boolean;
}

function formatGeminiErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err || "Unknown Gemini API error");
  if (isBillingExhaustionError(err)) {
    return "Gemini API credits are depleted (HTTP 402). Switched to built-in local Whisper ASR.";
  }
  if (
    raw.includes("API_KEY_INVALID") ||
    raw.includes("API key not valid") ||
    raw.includes("PERMISSION_DENIED") ||
    raw.includes("403")
  ) {
    return "Gemini API key is missing or invalid (API_KEY_INVALID / 403). Please set a valid GEMINI_API_KEY in Settings > Secrets.";
  }
  if (raw.includes("RESOURCE_EXHAUSTED") || raw.includes("429") || raw.includes("quota")) {
    return "Gemini API rate limit or quota exceeded (429 RESOURCE_EXHAUSTED). Please check your quota or select a paid API key in Settings > Secrets.";
  }
  if (raw.includes("NOT_FOUND") || raw.includes("404")) {
    return "Configured Gemini speech transcription model was not found (404).";
  }
  return `Gemini speech-to-text error: ${raw.slice(0, 240)}`;
}

function isFatalCloudGeminiError(err: unknown): boolean {
  if (isBillingExhaustionError(err)) return true;
  const status = extractHttpStatus(err);
  if (status === 401 || status === 402 || status === 403) return true;
  const msg = err instanceof Error ? err.message : String(err || "");
  return /API_KEY_INVALID|API key not valid|PERMISSION_DENIED|403|401|402|prepayment credits|credits are depleted/i.test(
    msg,
  );
}

async function transcribeAudioWithGemini(
  audioFilePath: string,
  resourceType: "meeting" | "lecture",
  startOffsetSec = 0,
  durationSeconds = 60,
  language = "auto",
): Promise<GeminiTranscriptionOutcome> {
  const ai = getGeminiClient();
  const isMeeting = resourceType === "meeting";

  if (!ai) {
    return {
      segments: [],
      errorMessage:
        "GEMINI_API_KEY is not configured. Please add a valid key in Settings > Secrets.",
    };
  }

  let uploadedFileName: string | undefined;
  try {
    const fileStat = fs.statSync(audioFilePath);
    const mimeType = getAudioMimeType(audioFilePath);
    const langHint =
      language && language !== "auto"
        ? `Spoken language hint: ${language}.`
        : "Detect the spoken language automatically (Arabic, English, or mixed) and transcribe faithfully without translating.";

    // Use Gemini Files API for larger audio files (> 8 MB) so even zero-FFmpeg production
    // containers can transcribe large real recordings directly without base64 payload limits.
    let audioPart:
      | { inlineData: { mimeType: string; data: string } }
      | { fileData: { fileUri: string; mimeType: string } };

    if (fileStat.size > INLINE_AUDIO_LIMIT_BYTES) {
      const uploaded = await ai.files.upload({
        file: audioFilePath,
        config: { mimeType },
      });
      uploadedFileName = uploaded.name;
      audioPart = {
        fileData: {
          fileUri: uploaded.uri!,
          mimeType: uploaded.mimeType || mimeType,
        },
      };
    } else {
      const audioBuffer = fs.readFileSync(audioFilePath);
      audioPart = {
        inlineData: {
          mimeType,
          data: audioBuffer.toString("base64"),
        },
      };
    }

    // Step 1: Dedicated ASR model (Speech -> Verbatim Text) separated from LLM reasoning.
    // Note: gemini-3.5-transcribe returns text inside non-text `part.audioTranscription.text`.
    const transcribePrompt = `Transcribe this audio verbatim word for word in its original spoken language. ${langHint} Do NOT invent any speech. If the recording contains only silence or noise with no human speech, return an empty string.`;

    let verbatimText = "";
    try {
      const transcribeResp = await ai.models.generateContent({
        model: "gemini-3.5-transcribe",
        contents: {
          parts: [audioPart, { text: transcribePrompt }],
        },
      });
      verbatimText = extractGeminiTranscriptText(transcribeResp);
    } catch (asrErr) {
      if (isFatalCloudGeminiError(asrErr)) {
        suspendCloudGeminiTemporarily(30 * 60 * 1000);
        throw asrErr;
      }
      const msg = asrErr instanceof Error ? asrErr.message : String(asrErr);
      console.warn("Primary gemini-3.5-transcribe warning, trying multimodal fallback:", msg);
    }

    // Secondary real multimodal ASR pass via gemini-3.5-flash if dedicated ASR returned empty
    if (!verbatimText) {
      try {
        const fallbackResp = await ai.models.generateContent({
          model: TEXT_MODEL,
          contents: {
            parts: [
              audioPart,
              {
                text: `${transcribePrompt} Return ONLY the spoken transcript text with no commentary. If there is strictly no human speech at all, reply with [SILENCE].`,
              },
            ],
          },
          config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL } },
        });
        verbatimText = extractGeminiTranscriptText(fallbackResp);
      } catch (fallbackErr) {
        if (isFatalCloudGeminiError(fallbackErr)) {
          suspendCloudGeminiTemporarily(30 * 60 * 1000);
          throw fallbackErr;
        }
      }
    }

    const isSilentOutput =
      !verbatimText ||
      verbatimText === "[]" ||
      verbatimText.toLowerCase() === "[silence]" ||
      verbatimText === "[صمت]";

    if (isSilentOutput) {
      return { segments: [], silent: true };
    }

    const segments: TranscriptSegment[] = [];
    // Step 2: Optional timestamp & speaker turn segmentation via fast LLM on verbatim transcript text
    try {
      const segPrompt = `Split the following verbatim ASR transcript into chronological speaker segments totaling ${durationSeconds} seconds starting at ${startOffsetSec}s. Preserve EVERY word without altering or inventing content.
Transcript:
"""
${verbatimText}
"""
Return ONLY a JSON array: [{"speaker":"${isMeeting ? "Speaker 1" : "Lecturer"}","startTime":0,"endTime":10,"text":"exact text slice"}]`;

      const structuredResp = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: segPrompt,
        config: {
          responseMimeType: "application/json",
          thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        },
      });

      const rawResp = (structuredResp.text || "").trim();
      if (rawResp) {
        const cleanedJson = rawResp
          .replace(/^```(?:json)?\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();
        const arrayMatch = cleanedJson.match(/\[[\s\S]*\]/);
        const parsed = JSON.parse(arrayMatch ? arrayMatch[0] : cleanedJson);
        if (Array.isArray(parsed) && parsed.length > 0) {
          parsed.forEach((item, idx) => {
            if (item && typeof item.text === "string" && item.text.trim()) {
              const sTime =
                typeof item.startTime === "number" ? Math.round(item.startTime) : idx * 6;
              const eTime =
                typeof item.endTime === "number" && item.endTime > sTime
                  ? Math.round(item.endTime)
                  : sTime + 6;
              segments.push({
                id: `seg_${Date.now()}_${idx + 1}`,
                speaker: item.speaker || (isMeeting ? `Speaker ${(idx % 2) + 1}` : "Lecturer"),
                startTime: sTime >= startOffsetSec ? sTime : startOffsetSec + sTime,
                endTime: eTime >= startOffsetSec ? eTime : startOffsetSec + eTime,
                text: item.text.trim(),
                confidence: 0.92,
                language,
                isPartial: false,
              });
            }
          });
        }
      }
    } catch {
      // Fall back to deterministic splitter on verbatim ASR text
    }

    if (segments.length > 0) return { segments };

    return {
      segments: splitVerbatimTextIntoSegments(
        verbatimText,
        isMeeting,
        startOffsetSec,
        durationSeconds,
        language,
      ),
    };
  } catch (sttErr) {
    const formatted = formatGeminiErrorMessage(sttErr);
    console.warn("Gemini transcription error:", formatted);
    return { segments: [], errorMessage: formatted };
  } finally {
    if (uploadedFileName) {
      await ai.files.delete({ name: uploadedFileName }).catch(() => {});
    }
  }
}

function classifyFailureCategory(errMessage: string): { category: string; transient: boolean } {
  const lower = errMessage.toLowerCase();
  if (lower.includes("cancelled")) return { category: "CancelledByUser", transient: false };
  if (lower.includes("n8n")) return { category: "N8nUnavailable", transient: false };
  if (
    lower.includes("api_key_invalid") ||
    lower.includes("api key") ||
    lower.includes("settings > secrets") ||
    lower.includes("permission_denied") ||
    lower.includes("not configured") ||
    lower.includes("not found (404)")
  ) {
    return { category: "ConfigurationError", transient: false };
  }
  if (
    lower.includes("empty") ||
    lower.includes("corrupted") ||
    lower.includes("stream was not found") ||
    lower.includes("too short") ||
    lower.includes("unsupported media")
  ) {
    return { category: "MediaValidationError", transient: false };
  }
  if (lower.includes("no speech") || lower.includes("audible speech")) {
    return { category: "TranscriptionServiceError", transient: false };
  }
  if (lower.includes("timeout") || lower.includes("network") || lower.includes("econn")) {
    return { category: "TimeoutError", transient: true };
  }
  return { category: "TranscriptionServiceError", transient: true };
}

function assertNotCancelled(jobId: string) {
  if (cancelledJobs.has(jobId)) {
    throw new Error("Job cancelled by user.");
  }
}

async function persistN8nWorkflowResult(params: {
  n8nResult: N8nWorkflowResult;
  jobId: string;
  correlationId: string;
  resourceType: "meeting" | "lecture";
  resourceId: string;
  title: string;
  courseCode?: string;
  userId: string;
  appLanguage?: "en" | "ar";
}): Promise<void> {
  const {
    n8nResult,
    jobId,
    correlationId,
    resourceType,
    resourceId,
    title,
    courseCode,
    userId,
    appLanguage,
  } = params;

  const { transcript, analysis, htmlReport } = n8nResult;
  const artifacts = buildTranscriptArtifacts({
    rawFullText: transcript.rawText || transcript.text,
    rawSegments: transcript.rawSegments || transcript.segments,
  });
  const segments = artifacts.processedSegments;
  const rawSegments = artifacts.rawSegments;
  const rawTranscript = artifacts.rawTranscript;
  const processedTranscript = artifacts.processedTranscript;
  const averageConfidence = transcript.averageConfidence ?? artifacts.averageConfidence;
  const asrModel = transcript.asrModel || getConfiguredAssemblyAiSpeechModels().join(",");
  const diarizationEnabled = transcript.diarizationEnabled !== false;
  const fullText = processedTranscript || segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
  const keywords = extractKeywordsWithFrequency(segments, 12);
  const cueHighlights = extractHighlightsFromSegments(segments);
  const now = new Date().toISOString();
  const speakerBreakdown =
    analysis.speakerBreakdown.length > 0
      ? analysis.speakerBreakdown
      : computeSpeakerBreakdown(segments);

  updateJob(jobId, {
    status: "Generating Results",
    stage: "GeneratingResults",
    progressPercent: 88,
  });

  const deepBlock = {
    overview: analysis.summary || undefined,
    topics: analysis.topics.length ? analysis.topics : keywords.slice(0, 5).map((k) => k.term),
    keywords: analysis.keywords.length ? analysis.keywords : keywords.map((k) => k.term),
    definitions: [],
    questionsAsked: [],
    actionItems: analysis.actionItems.map((a) => ({
      task: a.title,
      owner: a.ownerName,
      deadline: a.dueDate,
    })),
    emphasizedPoints: analysis.examHints.length ? analysis.examHints : analysis.keyPoints,
    importantSentences: analysis.importantSentences,
    reviewAreas: analysis.notes,
  };

  if (resourceType === "meeting") {
    db.update("meetings", (meetings) =>
      meetings.map((m) =>
        m.id === resourceId
          ? {
              ...m,
              status: "Completed",
              transcriptionStatus: "Completed",
              transcriptStatus: "final_verified",
              analysisStatus: analysis.summary ? "Completed" : "Unavailable",
              analysisRetryable: !analysis.summary,
              analyzedAt: now,
              transcriptId: transcript.id,
              transcriptionProvider: "n8n",
              asrModel,
              languageConfig: transcript.language,
              diarizationEnabled,
              averageConfidence,
              analysisProvider: "n8n",
              correlationId,
              language: transcript.language,
              appLanguage: appLanguage || m.appLanguage,
              durationSeconds: Math.max(1, transcript.durationSeconds, m.durationSeconds || 1),
              summary: analysis.summary || undefined,
              executiveSummary: analysis.summary || undefined,
              detailedSummary: analysis.notes.length
                ? `${analysis.summary}\n\n${analysis.notes.map((n) => `- ${n}`).join("\n")}`.trim()
                : analysis.summary || undefined,
              keyPoints: analysis.keyPoints.length
                ? analysis.keyPoints
                : analysis.notes.slice(0, 6),
              decisions: analysis.decisions,
              deadlines: analysis.deadlines,
              examHints: analysis.examHints,
              essayQuestions: analysis.essayQuestions,
              speakerBreakdown,
              htmlReport,
              topics: deepBlock.topics,
              keywords,
              highlights: cueHighlights,
              analysis: deepBlock,
              rawTranscript,
              processedTranscript,
              rawSegments,
              fullText,
              segments,
              updatedAt: now,
            }
          : m,
      ),
    );
  } else {
    db.update("lectures", (lectures) =>
      lectures.map((l) =>
        l.id === resourceId
          ? {
              ...l,
              status: "Completed",
              transcriptionStatus: "Completed",
              transcriptStatus: "final_verified",
              analysisStatus: analysis.summary ? "Completed" : "Unavailable",
              analysisRetryable: !analysis.summary,
              analyzedAt: now,
              transcriptId: transcript.id,
              transcriptionProvider: "n8n",
              asrModel,
              languageConfig: transcript.language,
              diarizationEnabled,
              averageConfidence,
              analysisProvider: "n8n",
              correlationId,
              language: transcript.language,
              appLanguage: appLanguage || l.appLanguage,
              durationSeconds: Math.max(1, transcript.durationSeconds, l.durationSeconds || 1),
              studyNotes: analysis.notes.length ? analysis.notes.join("\n") : analysis.summary,
              summary: analysis.summary || undefined,
              executiveSummary: analysis.summary || undefined,
              detailedSummary: analysis.notes.length
                ? `${analysis.summary}\n\n${analysis.notes.map((n) => `- ${n}`).join("\n")}`.trim()
                : analysis.summary || undefined,
              examHighlights: analysis.examHints.length ? analysis.examHints : analysis.keyPoints,
              deadlines: analysis.deadlines,
              examHints: analysis.examHints,
              essayQuestions: analysis.essayQuestions,
              speakerBreakdown,
              htmlReport,
              topics: deepBlock.topics,
              keywords,
              highlights: cueHighlights,
              analysis: deepBlock,
              rawTranscript,
              processedTranscript,
              rawSegments,
              fullText,
              segments,
              updatedAt: now,
            }
          : l,
      ),
    );
  }

  if (analysis.actionItems.length > 0) {
    db.update("actionItems", (items) => [
      ...items.filter((i) =>
        resourceType === "meeting" ? i.meetingId !== resourceId : i.lectureId !== resourceId,
      ),
      ...analysis.actionItems.map((t, idx) => ({
        id: `task_n8n_${jobId}_${idx + 1}`,
        userId,
        ...(resourceType === "meeting" ? { meetingId: resourceId } : { lectureId: resourceId }),
        title: t.title,
        ownerName: t.ownerName || "Not specified",
        dueDate: t.dueDate,
        deadlineText: t.dueDate || "Not specified",
        priority: t.priority || "medium",
        completed: false,
        createdAt: now,
      })),
    ]);
  }

  if (analysis.quiz.length > 0) {
    const isAr = transcript.language.startsWith("ar") || /[\u0600-\u06FF]/.test(transcript.text);
    db.update("quizzes", (quizzes) => [
      {
        id: `quiz_n8n_${jobId}`,
        ...(resourceType === "meeting" ? { meetingId: resourceId } : { lectureId: resourceId }),
        title: isAr ? `اختبار الفهم: ${title}` : `Comprehension Quiz: ${title}`,
        courseCode,
        questions: analysis.quiz,
        attemptsCount: 0,
        createdAt: now,
      },
      ...quizzes.filter((q) =>
        resourceType === "meeting" ? q.meetingId !== resourceId : q.lectureId !== resourceId,
      ),
    ]);
    logObservabilityEvent("info", "quiz_generation_completed", {
      correlationId,
      jobId,
      resourceId,
      provider: "n8n",
      questionsCount: analysis.quiz.length,
    });
  }

  if (analysis.flashcards.length > 0) {
    db.update("flashcards", (cards) => [
      ...analysis.flashcards.map((c, idx) => ({
        id: `fc_n8n_${jobId}_${idx + 1}`,
        deckId: `deck_${resourceId}`,
        deckTitle: title.length > 35 ? `${title.slice(0, 35)}...` : title,
        ...(resourceType === "meeting" ? { meetingId: resourceId } : { lectureId: resourceId }),
        front: c.front,
        back: c.back,
        topic: c.topic,
        difficulty: c.difficulty || "medium",
        mastered: false,
        reviewCount: 0,
        createdAt: now,
      })),
      ...cards.filter((c) =>
        resourceType === "meeting" ? c.meetingId !== resourceId : c.lectureId !== resourceId,
      ),
    ]);
  }

  logObservabilityEvent("info", "ai_analysis_completed", {
    correlationId,
    jobId,
    resourceId,
    provider: "n8n",
    summaryChars: analysis.summary.length,
    quizCount: analysis.quiz.length,
    flashcardsCount: analysis.flashcards.length,
    tasksCount: analysis.actionItems.length,
  });
}

export interface PreValidatedMediaMeta {
  durationSeconds: number;
  detectedMimeType?: string;
  hasVideo?: boolean;
  fileSha256?: string;
  uploadMs?: number;
  validationMs?: number;
  forceRetranscribe?: boolean;
}

function markStageLedger(
  ledger: Record<string, StageTelemetryEntry>,
  correlationId: string,
  jobId: string | undefined,
  recordingId: string,
  stage: CanonicalPipelineStage | string,
  status: "pending" | "running" | "completed" | "failed",
  opts?: { durationMs?: number; detail?: string; error?: string; startedAtIso?: string },
): void {
  const nowIso = new Date().toISOString();
  const prev = ledger[stage];
  const startedAt = opts?.startedAtIso || prev?.startedAt || nowIso;
  const durationMs =
    typeof opts?.durationMs === "number"
      ? Math.max(0, Math.round(opts.durationMs))
      : status === "completed" || status === "failed"
        ? Math.max(0, Date.now() - Date.parse(startedAt))
        : prev?.durationMs;

  ledger[stage] = {
    stage,
    status,
    startedAt,
    ...(status === "completed" || status === "failed" ? { endedAt: nowIso } : {}),
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(opts?.detail ? { detail: opts.detail } : {}),
    ...(opts?.error ? { error: opts.error } : {}),
  };

  if (status === "running" || status === "completed" || status === "failed") {
    logStageTiming(
      correlationId,
      stage,
      status === "completed" || status === "failed" ? durationMs : undefined,
      {
        jobId,
        recordingId,
        status,
        ...(opts?.detail ? { detail: opts.detail } : {}),
        ...(opts?.error ? { error: opts.error } : {}),
      },
    );
  }
}

export async function processRecordingJob(
  jobId: string,
  resourceType: "meeting" | "lecture",
  resourceId: string,
  filePath: string,
  originalFilename: string,
  language = "auto",
  preValidated?: PreValidatedMediaMeta,
) {
  const jobStartedAt = Date.now();
  const jobChunkDir = path.join(CHUNKS_BASE_DIR, `job_${jobId}`);
  const normalizedAudioPath = path.join(CHUNKS_BASE_DIR, `norm_${jobId}.wav`);
  const jsonOutputPath = path.join(jobChunkDir, `transcript_${jobId}.json`);
  const existingJob = db.get("jobs").find((j) => j.id === jobId);
  const correlationId = existingJob?.correlationId || createCorrelationId("rec");
  const timings: StageTimings = {
    uploadMs: preValidated?.uploadMs ?? existingJob?.timings?.uploadMs ?? 0,
    validationMs: preValidated?.validationMs ?? existingJob?.timings?.validationMs ?? 0,
  };
  const stageLedger: Record<string, StageTelemetryEntry> = {
    ...(existingJob?.stageLedger || {}),
  };
  const uploadDurMs = timings.uploadMs || 0;
  markStageLedger(stageLedger, correlationId, jobId, resourceId, "UPLOAD", "completed", {
    durationMs: uploadDurMs,
    startedAtIso: new Date(Date.now() - uploadDurMs).toISOString(),
  });
  let fileSizeBytes = existingJob?.fileSizeBytes || 0;
  try {
    if (fs.existsSync(filePath)) fileSizeBytes = fs.statSync(filePath).size;
  } catch {
    // ignore stat error
  }

  if (!fs.existsSync(jobChunkDir)) {
    fs.mkdirSync(jobChunkDir, { recursive: true });
  }

  try {
    assertNotCancelled(jobId);
    logPipelineEvent("info", "job_started", {
      correlationId,
      jobId,
      resourceId,
      resourceType,
      originalFilename,
      language,
    });
    notifySync({ type: "ProcessingStarted", id: jobId, resourceId, resourceType, progress: 5 });

    // 1. Validate media (skip redundant ffprobe spawn when finalizeUploadedRecording already verified this file!)
    let probe: MediaProbeResult;
    if (preValidated && preValidated.durationSeconds > 0 && fs.existsSync(filePath)) {
      probe = {
        valid: true,
        correlationId,
        hasAudio: true,
        hasVideo: Boolean(preValidated.hasVideo),
        durationSeconds: preValidated.durationSeconds,
        detectedMimeType: preValidated.detectedMimeType,
        ffprobeAvailable: true,
      };
      updateJob(jobId, {
        correlationId,
        status: "Validating",
        stage: "Validated",
        progressPercent: 12,
        filePath,
        originalFilename,
        language,
        timings,
        milestones: { uploadComplete: true },
      });
    } else {
      updateJob(jobId, {
        correlationId,
        status: "Validating",
        stage: "ValidatingMedia",
        progressPercent: 10,
        filePath,
        originalFilename,
        language,
        timings,
        milestones: { uploadComplete: true },
      });
      const valStart = Date.now();
      probe = await validateMediaFile(filePath, originalFilename);
      timings.validationMs = (timings.validationMs || 0) + (Date.now() - valStart);
      if (!probe.valid) {
        throw new Error(probe.error || "Invalid media file.");
      }
    }

    assertNotCancelled(jobId);

    const jobOwnerId = db.get("jobs").find((j) => j.id === jobId)?.userId || "usr_admin";
    const jobRecordPre = db.get("jobs").find((j) => j.id === jobId);
    const audioSha256 =
      preValidated?.fileSha256 || jobRecordPre?.fileSha256 || computeFileSha256(filePath);
    const resourceTitlePre =
      resourceType === "meeting"
        ? db.get("meetings").find((m) => m.id === resourceId)?.title || originalFilename
        : db.get("lectures").find((l) => l.id === resourceId)?.title || originalFilename;
    const courseCodePre =
      resourceType === "lecture"
        ? db.get("lectures").find((l) => l.id === resourceId)?.courseCode
        : undefined;

    // 1A. Persistent Audio Hash -> Real Transcript (+ Analysis) Cache Check
    // Respects active ASR provider tier (never serves low-accuracy local cache when AssemblyAI/n8n is configured)
    // and bypasses cache cleanly when the user explicitly requests Re-transcribe.
    const n8nConfig = getN8nConfig();
    const pipelineModePref = (process.env.PIPELINE_MODE || "auto").trim().toLowerCase();
    const preferDirectOverN8n =
      pipelineModePref === "direct" || (pipelineModePref !== "n8n" && isAssemblyAiConfigured());
    const shouldUseN8nPrimary = n8nConfig.configured && !preferDirectOverN8n;
    const preferredProviderForCache: "n8n" | "assemblyai" | "whisper-local" = shouldUseN8nPrimary
      ? "n8n"
      : isAssemblyAiConfigured()
        ? "assemblyai"
        : "whisper-local";

    timings.audioHash = audioSha256 ? audioSha256.slice(0, 16) : undefined;
    const cachedTranscript = preValidated?.forceRetranscribe
      ? null
      : getCachedTranscriptByAudioHash(
          audioSha256,
          language,
          correlationId,
          preferredProviderForCache,
        );
    if (cachedTranscript && cachedTranscript.segments.length > 0) {
      timings.pipelineMode = "cache";
      timings.transcriptCacheHit = true;
      timings.transcriptionMs = 0;
      timings.transcriptionProvider = cachedTranscript.provider;
      timings.transcriptHash =
        cachedTranscript.transcriptHash?.slice(0, 16) ||
        computeTranscriptSha256(cachedTranscript.segments).slice(0, 16);
      logStageTiming(correlationId, "TRANSCRIPTION_COMPLETE", 0, {
        cacheHit: true,
        provider: cachedTranscript.provider,
        segmentsCount: cachedTranscript.segments.length,
      });

      if (
        cachedTranscript.cachedN8nAnalysis &&
        (cachedTranscript.cachedN8nAnalysis.summary ||
          cachedTranscript.cachedN8nAnalysis.quiz.length > 0)
      ) {
        timings.analysisCacheHit = true;
        timings.geminiAnalysisMs = 0;
        timings.analysisProvider = "n8n";
        const dbSaveStart = Date.now();
        await persistN8nWorkflowResult({
          n8nResult: {
            provider: "n8n",
            latencyMs: 0,
            transcript: {
              id: cachedTranscript.transcriptId,
              text: cachedTranscript.fullText,
              language: cachedTranscript.detectedLanguage || language,
              segments: cachedTranscript.segments,
              durationSeconds: cachedTranscript.durationSeconds || probe.durationSeconds || 10,
            },
            analysis: cachedTranscript.cachedN8nAnalysis,
            htmlReport: cachedTranscript.cachedHtmlReport,
          },
          jobId,
          correlationId,
          resourceType,
          resourceId,
          title: resourceTitlePre,
          courseCode: courseCodePre,
          userId: jobOwnerId,
          appLanguage: jobRecordPre?.appLanguage,
        });
        timings.databaseSaveMs = Date.now() - dbSaveStart;
        timings.firstResultMs = (timings.uploadMs || 0) + (Date.now() - jobStartedAt);
        timings.totalMs = timings.firstResultMs;
        logStageTiming(correlationId, "DATABASE_SAVE", timings.databaseSaveMs);
        logStageTiming(correlationId, "RESULT_READY", timings.totalMs, {
          transcriptCacheHit: true,
          analysisCacheHit: true,
        });
        if (resourceType === "meeting") {
          db.update("meetings", (list) =>
            list.map((m) => (m.id === resourceId ? { ...m, timings } : m)),
          );
        } else {
          db.update("lectures", (list) =>
            list.map((l) => (l.id === resourceId ? { ...l, timings } : l)),
          );
        }
        updateJob(jobId, {
          status: "Completed",
          stage: "Completed",
          progressPercent: 100,
          transcriptId: cachedTranscript.transcriptId,
          transcriptionProvider: cachedTranscript.provider,
          analysisProvider: "n8n",
          timings,
          milestones: {
            uploadComplete: true,
            transcriptionStarted: true,
            transcriptionCompleted: true,
            summaryReady: Boolean(cachedTranscript.cachedN8nAnalysis.summary),
            keywordsReady: true,
            tasksReady: cachedTranscript.cachedN8nAnalysis.actionItems.length > 0,
            quizReady: cachedTranscript.cachedN8nAnalysis.quiz.length > 0,
            flashcardsReady: cachedTranscript.cachedN8nAnalysis.flashcards.length > 0,
            completed: true,
          },
          progressiveSummary: cachedTranscript.cachedN8nAnalysis.summary || undefined,
          progressiveKeywords: cachedTranscript.cachedN8nAnalysis.keywords.slice(0, 12),
          progressiveKeywordsCount: cachedTranscript.cachedN8nAnalysis.keywords.length,
          progressiveTasksCount: cachedTranscript.cachedN8nAnalysis.actionItems.length,
          progressiveQuizCount: cachedTranscript.cachedN8nAnalysis.quiz.length,
          progressiveFlashcardsCount: cachedTranscript.cachedN8nAnalysis.flashcards.length,
        });
        notifySync({
          type: "ProcessingCompleted",
          userId: jobOwnerId,
          id: resourceId,
          resourceId,
          resourceType,
          jobId,
          progress: 100,
        });
        return;
      }

      updateJob(jobId, {
        status: "Analyzing",
        stage: "TranscriptCacheHit",
        progressPercent: 74,
        transcriptId: cachedTranscript.transcriptId,
        transcriptionProvider: cachedTranscript.provider,
        timings,
        milestones: {
          uploadComplete: true,
          transcriptionStarted: true,
          transcriptionCompleted: true,
        },
      });

      const pipelineResult = await runUnifiedPostTranscriptionPipeline({
        resourceType,
        resourceId,
        title: resourceTitlePre,
        courseCode: courseCodePre,
        language: cachedTranscript.detectedLanguage || language,
        appLanguage: jobRecordPre?.appLanguage,
        durationSeconds: cachedTranscript.durationSeconds || probe.durationSeconds || 10,
        segments: cachedTranscript.segments,
        rawSegments: cachedTranscript.rawSegments,
        rawTranscript: cachedTranscript.rawTranscript,
        processedTranscript: cachedTranscript.processedTranscript,
        asrModel: cachedTranscript.asrModel,
        languageConfig: cachedTranscript.languageConfig,
        diarizationEnabled: cachedTranscript.diarizationEnabled,
        averageConfidence: cachedTranscript.averageConfidence,
        userId: jobOwnerId,
        jobId,
        correlationId,
        transcriptId: cachedTranscript.transcriptId,
        transcriptionProvider: cachedTranscript.provider,
        speakerBreakdown: cachedTranscript.speakerBreakdown,
        timings,
        audioSha256,
        precomputedUnifiedAnalysis: cachedTranscript.cachedUnifiedAnalysis,
        checkCancelled: () => assertNotCancelled(jobId),
      });

      timings.totalMs = (timings.uploadMs || 0) + (Date.now() - jobStartedAt);
      logStageTiming(correlationId, "RESULT_READY", timings.totalMs, {
        transcriptCacheHit: true,
        analysisCacheHit: timings.analysisCacheHit,
      });
      if (resourceType === "meeting") {
        db.update("meetings", (list) =>
          list.map((m) => (m.id === resourceId ? { ...m, timings } : m)),
        );
      } else {
        db.update("lectures", (list) =>
          list.map((l) => (l.id === resourceId ? { ...l, timings } : l)),
        );
      }
      updateJob(jobId, {
        status: "Completed",
        stage: "Completed",
        progressPercent: 100,
        transcriptId: cachedTranscript.transcriptId,
        transcriptionProvider: cachedTranscript.provider,
        analysisProvider: timings.analysisProvider,
        timings,
        errorMessage: pipelineResult.analysisError,
      });
      notifySync({
        type: "ProcessingCompleted",
        userId: jobOwnerId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 100,
      });
      return;
    }

    // 1B. Architecture Routing (Requirement #9):
    // - "direct": Backend -> AssemblyAI -> Immediate Progressive Transcript -> Single Unified Gemini JSON -> DB
    // - "auto" (default): Prefer Direct AssemblyAI when ASSEMBLYAI_API_KEY is set (eliminates redundant n8n audio hop
    //   and delivers transcript immediately before AI analysis); otherwise use thin n8n if N8N_WEBHOOK_URL is configured.
    // - "n8n": Always route via N8N_WEBHOOK_URL when configured.
    if (shouldUseN8nPrimary) {
      timings.pipelineMode = "n8n";
      timings.transcriptionProvider = "n8n";
      updateJob(jobId, {
        status: "Transcribing",
        stage: "TranscribingViaN8n",
        progressPercent: 32,
        transcriptionProvider: "n8n",
        milestones: { uploadComplete: true, transcriptionStarted: true },
      });
      logStageTiming(correlationId, "TRANSCRIPTION_START", Date.now() - jobStartedAt, {
        provider: "n8n",
      });
      logObservabilityEvent("info", "transcription_started", {
        correlationId,
        jobId,
        resourceId,
        provider: "n8n",
      });
      notifySync({ type: "TranscriptionStarted", id: jobId, resourceId, progress: 32 });

      try {
        const n8nStart = Date.now();
        const n8nResult = await executeN8nAudioWorkflow({
          filePath:
            probe.repairedPath && fs.existsSync(probe.repairedPath) ? probe.repairedPath : filePath,
          originalFilename,
          mimeType: probe.detectedMimeType,
          resourceId,
          resourceType,
          title: resourceTitlePre,
          language,
          appLanguage: jobRecordPre?.appLanguage,
          jobId,
          correlationId,
        });

        assertNotCancelled(jobId);
        timings.n8nWebhookMs = n8nResult.latencyMs || Date.now() - n8nStart;
        timings.assemblyAiUploadMs = n8nResult.stageTimings?.assemblyAiUploadMs;
        timings.transcriptionMs = n8nResult.stageTimings?.transcriptionMs ?? timings.n8nWebhookMs;
        timings.pollingWaitMs = n8nResult.stageTimings?.pollingWaitMs;
        timings.pollCount = n8nResult.stageTimings?.pollCount;
        timings.transcriptFetchMs = n8nResult.stageTimings?.transcriptFetchMs;
        timings.geminiAnalysisMs = n8nResult.stageTimings?.geminiAnalysisMs;
        timings.transcriptHash = computeTranscriptSha256(n8nResult.transcript.segments).slice(
          0,
          16,
        );

        // Cache verified real transcript (+ structured analysis) by audio SHA-256 for instant repeat reuse
        setCachedTranscriptByAudioHash({
          audioSha256,
          language,
          transcriptId: n8nResult.transcript.id,
          provider: "n8n",
          detectedLanguage: n8nResult.transcript.language || language,
          durationSeconds: n8nResult.transcript.durationSeconds || probe.durationSeconds || 10,
          segments: n8nResult.transcript.segments,
          speakerBreakdown:
            n8nResult.analysis.speakerBreakdown.length > 0
              ? n8nResult.analysis.speakerBreakdown
              : computeSpeakerBreakdown(n8nResult.transcript.segments),
          cachedN8nAnalysis:
            n8nResult.analysis.summary || n8nResult.analysis.quiz.length > 0
              ? n8nResult.analysis
              : undefined,
          cachedHtmlReport: n8nResult.htmlReport,
        });

        logStageTiming(correlationId, "TRANSCRIPTION_COMPLETE", timings.transcriptionMs, {
          provider: "n8n",
          transcriptId: n8nResult.transcript.id,
          segmentsCount: n8nResult.transcript.segments.length,
        });
        logObservabilityEvent("info", "transcription_completed", {
          correlationId,
          jobId,
          resourceId,
          provider: "n8n",
          transcriptId: n8nResult.transcript.id,
          segmentsCount: n8nResult.transcript.segments.length,
        });

        // If n8n returned BOTH transcript and structured analysis, commit directly (ZERO duplicate Gemini calls!)
        const n8nHasAnalysis = Boolean(
          n8nResult.analysis.summary ||
          n8nResult.analysis.quiz.length > 0 ||
          n8nResult.analysis.flashcards.length > 0,
        );
        if (n8nHasAnalysis) {
          timings.analysisProvider = "n8n";
          const dbSaveStart = Date.now();
          await persistN8nWorkflowResult({
            n8nResult,
            jobId,
            correlationId,
            resourceType,
            resourceId,
            title: resourceTitlePre,
            courseCode: courseCodePre,
            userId: jobOwnerId,
            appLanguage: jobRecordPre?.appLanguage,
          });
          timings.databaseSaveMs = Date.now() - dbSaveStart;
          logStageTiming(correlationId, "DATABASE_SAVE", timings.databaseSaveMs);
        } else {
          // n8n returned transcript only — run MeetMind's unified post-transcription analysis once
          await runUnifiedPostTranscriptionPipeline({
            resourceType,
            resourceId,
            title: resourceTitlePre,
            courseCode: courseCodePre,
            language: n8nResult.transcript.language || language,
            appLanguage: jobRecordPre?.appLanguage,
            durationSeconds: n8nResult.transcript.durationSeconds || probe.durationSeconds || 10,
            segments: n8nResult.transcript.segments,
            userId: jobOwnerId,
            jobId,
            correlationId,
            transcriptId: n8nResult.transcript.id,
            transcriptionProvider: "n8n",
            speakerBreakdown: n8nResult.analysis.speakerBreakdown,
            timings,
            audioSha256,
            checkCancelled: () => assertNotCancelled(jobId),
          });
        }

        timings.firstResultMs =
          timings.firstResultMs || (timings.uploadMs || 0) + (Date.now() - jobStartedAt);
        timings.totalMs = (timings.uploadMs || 0) + (Date.now() - jobStartedAt);
        logStageTiming(correlationId, "RESULT_READY", timings.totalMs, { provider: "n8n" });

        // Persist final timings onto the recording record & job record
        if (resourceType === "meeting") {
          db.update("meetings", (list) =>
            list.map((m) => (m.id === resourceId ? { ...m, timings } : m)),
          );
        } else {
          db.update("lectures", (list) =>
            list.map((l) => (l.id === resourceId ? { ...l, timings } : l)),
          );
        }

        updateJob(jobId, {
          status: "Completed",
          stage: "Completed",
          progressPercent: 100,
          retryable: false,
          errorMessage: undefined,
          transcriptId: n8nResult.transcript.id,
          transcriptionProvider: "n8n",
          analysisProvider: timings.analysisProvider || "n8n",
          timings,
          milestones: {
            uploadComplete: true,
            transcriptionStarted: true,
            transcriptionCompleted: true,
            summaryReady: Boolean(n8nResult.analysis.summary),
            keywordsReady: true,
            tasksReady: n8nResult.analysis.actionItems.length > 0,
            quizReady: n8nResult.analysis.quiz.length > 0,
            flashcardsReady: n8nResult.analysis.flashcards.length > 0,
            completed: true,
          },
          progressiveSummary: n8nResult.analysis.summary || undefined,
          progressiveKeywords: n8nResult.analysis.keywords.slice(0, 12),
          progressiveKeywordsCount: n8nResult.analysis.keywords.length,
          progressiveTasks: n8nResult.analysis.actionItems.slice(0, 8).map((a) => ({
            title: a.title,
            ownerName: a.ownerName,
            dueDate: a.dueDate,
          })),
          progressiveTasksCount: n8nResult.analysis.actionItems.length,
          progressiveQuizCount: n8nResult.analysis.quiz.length,
          progressiveFlashcardsCount: n8nResult.analysis.flashcards.length,
        });
        notifySync({
          type: "ProcessingCompleted",
          userId: jobOwnerId,
          id: resourceId,
          resourceId,
          resourceType,
          jobId,
          progress: 100,
        });
        return;
      } catch (n8nErr) {
        if (!n8nConfig.fallbackToDirect) {
          throw n8nErr;
        }
        logPipelineEvent("warn", "n8n_fallback_to_direct_pipeline", {
          correlationId,
          jobId,
          resourceId,
          reason: n8nErr instanceof Error ? n8nErr.message : String(n8nErr),
        });
      }
    }

    // 2. Audio preparation:
    // Direct AssemblyAI and Built-in Whisper both accept original M4A/MP3/WAV/OGG/WEBM directly!
    // Skip writing a 27MB normalized disk WAV unless external Python AI_SERVICE_URL or explicit Gemini ASR is enabled.
    updateJob(jobId, { status: "ExtractingAudio", stage: "AudioExtraction", progressPercent: 22 });
    notifySync({ type: "AudioExtractionStarted", id: jobId, resourceId, progress: 22 });

    const sourceAudioPath =
      probe.repairedPath && fs.existsSync(probe.repairedPath) ? probe.repairedPath : filePath;
    // STRICT SEPARATION OF ASR AND LLM:
    // NEVER silently fall back to a generic Gemini text/multimodal LLM as a speech-recognition engine.
    // Primary transcription MUST come from a dedicated ASR engine (AssemblyAI or dedicated Whisper ASR).
    const shouldTryGeminiAsr = false;
    const needsNormalizedDiskWav = Boolean(AI_SERVICE_URL);
    let durationSeconds = probe.durationSeconds || 10;

    if (needsNormalizedDiskWav) {
      try {
        durationSeconds = await extractAndNormalizeAudio(sourceAudioPath, normalizedAudioPath);
        logPipelineEvent("info", "audio_normalized", {
          jobId,
          resourceId,
          durationSeconds,
          hasVideo: probe.hasVideo,
        });
      } catch (normErr) {
        if (isBinaryUnavailableError(normErr)) {
          logPipelineEvent("warn", "ffmpeg_unavailable_using_original_media", {
            jobId,
            resourceId,
            detectedMimeType: probe.detectedMimeType,
          });
        } else {
          throw new Error(
            `Audio extraction failed: ${normErr instanceof Error ? normErr.message : "ffmpeg error"}`,
          );
        }
      }
    }

    assertNotCancelled(jobId);

    // 3. Real Speech-to-Text Pipeline (Direct AssemblyAI -> Python FastAPI -> Optional Gemini ASR -> Parallel Multi-Worker Whisper ONNX)
    const directTranscriptionStart = Date.now();
    const usingAssemblyAi = isAssemblyAiConfigured();
    timings.pipelineMode = usingAssemblyAi ? "direct" : "local";
    markStageLedger(
      stageLedger,
      correlationId,
      jobId,
      resourceId,
      "TRANSCRIPTION_STARTED",
      "completed",
      {
        durationMs: Date.now() - jobStartedAt,
        detail: usingAssemblyAi ? "AssemblyAI" : "Local Whisper ONNX",
      },
    );
    markStageLedger(
      stageLedger,
      correlationId,
      jobId,
      resourceId,
      "TRANSCRIPTION_PROCESSING",
      "running",
      {
        detail: usingAssemblyAi ? "AssemblyAI speech-to-text" : "Local Whisper ONNX",
      },
    );
    updateJob(jobId, {
      status: "Transcribing",
      stage: "Transcribing",
      stageProgress: 0,
      progressPercent: 35,
      fileSizeBytes,
      audioDurationSeconds: probe.durationSeconds,
      currentOperation: usingAssemblyAi
        ? "Sending audio to AssemblyAI transcription engine..."
        : "Transcribing speech with local Whisper engine...",
      currentOperationAr: usingAssemblyAi
        ? "جاري إرسال الملف الصوتي لبدء التفريغ عبر AssemblyAI..."
        : "جاري تفريغ الكلام عبر محرك Whisper المحلي...",
      transcriptionProvider: usingAssemblyAi ? "assemblyai" : "whisper-local",
      stageLedger,
      milestones: { uploadComplete: true, audioValidated: true, transcriptionStarted: true },
    });
    logStageTiming(correlationId, "TRANSCRIPTION_START", Date.now() - jobStartedAt, {
      provider: usingAssemblyAi ? "assemblyai" : "whisper-local",
    });
    logObservabilityEvent("info", "transcription_started", {
      correlationId,
      jobId,
      resourceId,
      provider: usingAssemblyAi ? "assemblyai" : "whisper-local",
    });
    notifySync({
      type: "TranscriptionStarted",
      userId: jobOwnerId,
      id: jobId,
      resourceId,
      resourceType,
      jobId,
      progress: 35,
    });

    let segments: TranscriptSegment[] = [];
    let rawSegments: TranscriptSegment[] = [];
    let rawTranscriptText = "";
    let processedTranscriptText = "";
    let resolvedTranscriptId: string | undefined;
    let resolvedTranscriptionProvider: "n8n" | "assemblyai" | "gemini" | "whisper-local" =
      "whisper-local";
    let resolvedAsrModel: string | undefined;
    let resolvedLanguageConfig: string | undefined;
    let resolvedDetectedLanguage = language;
    let resolvedDiarizationEnabled = false;
    let resolvedAverageConfidence: number | undefined;
    let resolvedSpeakerBreakdown: AssemblyAiSpeakerStat[] | undefined;
    const isMeeting = resourceType === "meeting";
    const hasNormalizedWav = needsNormalizedDiskWav && fs.existsSync(normalizedAudioPath);
    const activeAudioFile = hasNormalizedWav ? normalizedAudioPath : sourceAudioPath;
    const activeStat = fs.statSync(activeAudioFile);

    // 3a0. Real Direct AssemblyAI Dedicated ASR (progressive silence-aligned parallel slices + adaptive 2s-10s poll)
    let assemblyAiErrorMsg: string | undefined;
    if (usingAssemblyAi) {
      markStageLedger(
        stageLedger,
        correlationId,
        jobId,
        resourceId,
        "ASSEMBLYAI_UPLOAD",
        "running",
      );
      try {
        const aaiRes = await transcribeAudioWithAssemblyAi({
          filePath: sourceAudioPath,
          resourceType,
          language,
          durationSecondsHint: probe.durationSeconds,
          jobId,
          correlationId,
          onProgress: (pct, stageLabel) => {
            updateJob(jobId, {
              status: "Transcribing",
              stage: stageLabel,
              progressPercent: pct,
              currentOperation: stageLabel,
              transcriptStatus: "live",
              stageLedger,
            });
          },
          onPartialTranscript: (partial) => {
            if (partial.uploadMsSoFar > 0) {
              timings.assemblyAiUploadMs = partial.uploadMsSoFar;
              markStageLedger(
                stageLedger,
                correlationId,
                jobId,
                resourceId,
                "ASSEMBLYAI_UPLOAD",
                "completed",
                { durationMs: partial.uploadMsSoFar },
              );
            }
            markStageLedger(
              stageLedger,
              correlationId,
              jobId,
              resourceId,
              "TRANSCRIPTION_PROCESSING",
              "running",
              {
                detail: `${partial.stageProgress}% (${partial.wordsReceived} words, ${partial.segments.length} segments)`,
              },
            );

            const partialFullText = partial.segments
              .map((s) => `${s.speaker}: ${s.text}`)
              .join("\n");
            const nowTs = new Date().toISOString();
            if (partial.segments.length > 0) {
              if (resourceType === "meeting") {
                db.update("meetings", (meetings) =>
                  meetings.map((m) =>
                    m.id === resourceId
                      ? {
                          ...m,
                          transcriptionStatus: "Processing",
                          transcriptStatus: "live",
                          transcriptionProvider: "assemblyai",
                          asrModel: partial.speechModel || m.asrModel,
                          language: partial.detectedLanguage || m.language,
                          rawTranscript: partial.rawTranscript,
                          rawSegments: partial.rawSegments,
                          segments: partial.segments.map((s) => ({
                            ...s,
                            isPartial: partial.stageProgress < 100,
                          })),
                          fullText: partialFullText,
                          updatedAt: nowTs,
                        }
                      : m,
                  ),
                );
              } else {
                db.update("lectures", (lectures) =>
                  lectures.map((l) =>
                    l.id === resourceId
                      ? {
                          ...l,
                          transcriptionStatus: "Processing",
                          transcriptStatus: "live",
                          transcriptionProvider: "assemblyai",
                          asrModel: partial.speechModel || l.asrModel,
                          language: partial.detectedLanguage || l.language,
                          rawTranscript: partial.rawTranscript,
                          rawSegments: partial.rawSegments,
                          segments: partial.segments.map((s) => ({
                            ...s,
                            isPartial: partial.stageProgress < 100,
                          })),
                          fullText: partialFullText,
                          updatedAt: nowTs,
                        }
                      : l,
                  ),
                );
              }
            }

            const mappedJobPct = Math.min(70, 38 + Math.round((partial.stageProgress / 100) * 32));
            const langBadge =
              partial.detectedLanguage === "ar"
                ? "Arabic"
                : partial.detectedLanguage === "en"
                  ? "English"
                  : "speech";
            updateJob(jobId, {
              status: "Transcribing",
              stage: "Transcribing",
              stageProgress: partial.stageProgress,
              progressPercent: mappedJobPct,
              segmentsReceived: partial.segments.length,
              wordsReceived: partial.wordsReceived,
              detectedLanguage: partial.detectedLanguage,
              asrModel: partial.speechModel,
              currentOperation: `Transcribing ${langBadge} (${partial.stageProgress}% · ${partial.wordsReceived.toLocaleString()} words received)`,
              currentOperationAr: `جاري تفريغ الكلام (${partial.stageProgress}% · تم استلام ${partial.wordsReceived.toLocaleString()} كلمة)`,
              transcriptStatus: "live",
              timings,
              stageLedger,
              milestones: {
                uploadComplete: true,
                audioValidated: true,
                transcriptionStarted: true,
                languageDetected: Boolean(partial.detectedLanguage),
              },
            });
            notifySync({
              type: "TranscriptSegmentAvailable",
              userId: jobOwnerId,
              id: resourceId,
              resourceId,
              resourceType,
              jobId,
              count: partial.segments.length,
              progress: mappedJobPct,
            });
          },
        });
        if (aaiRes.segments.length > 0) {
          segments = aaiRes.segments;
          rawSegments = aaiRes.rawSegments;
          rawTranscriptText = aaiRes.rawTranscript;
          processedTranscriptText = aaiRes.processedTranscript;
          resolvedTranscriptId = aaiRes.transcriptId;
          resolvedTranscriptionProvider = "assemblyai";
          resolvedAsrModel = aaiRes.speechModel;
          resolvedLanguageConfig = aaiRes.languageConfig;
          resolvedDetectedLanguage = aaiRes.detectedLanguage || language;
          resolvedDiarizationEnabled = aaiRes.speakerLabelsEnabled;
          resolvedAverageConfidence = aaiRes.averageConfidence;
          resolvedSpeakerBreakdown = aaiRes.speakerBreakdown;
          timings.assemblyAiUploadMs = aaiRes.uploadMs;
          timings.transcriptionMs = aaiRes.transcriptionMs;
          timings.pollingWaitMs = aaiRes.pollingWaitMs;
          timings.pollCount = aaiRes.pollCount;
          timings.transcriptFetchMs = aaiRes.transcriptFetchMs;
          timings.webhookTriggered = aaiRes.webhookTriggered;
          timings.transcriptionProvider = "assemblyai";
          markStageLedger(
            stageLedger,
            correlationId,
            jobId,
            resourceId,
            "ASSEMBLYAI_UPLOAD",
            "completed",
            { durationMs: aaiRes.uploadMs },
          );
          if (aaiRes.durationSeconds > 0) durationSeconds = aaiRes.durationSeconds;
        }
      } catch (aaiErr) {
        assemblyAiErrorMsg = aaiErr instanceof Error ? aaiErr.message : String(aaiErr);
        markStageLedger(
          stageLedger,
          correlationId,
          jobId,
          resourceId,
          "TRANSCRIPTION_PROCESSING",
          "failed",
          { error: assemblyAiErrorMsg },
        );
        // When AssemblyAI is configured, do NOT silently degrade Arabic accuracy into local fallback
        // unless the operator explicitly opted into ASSEMBLYAI_ALLOW_LOCAL_FALLBACK=true.
        if (process.env.ASSEMBLYAI_ALLOW_LOCAL_FALLBACK !== "true") {
          throw aaiErr;
        }
      }
    }

    // 3a. Microservice HTTP contract if configured
    if (segments.length === 0 && AI_SERVICE_URL) {
      segments = await transcribeWithPythonAiService(activeAudioFile, resourceType, language);
    }

    let geminiErrorMsg: string | undefined;
    let geminiObservedSilence = false;

    // 3b. Optional Gemini Multimodal ASR (only when explicitly enabled via ENABLE_GEMINI_ASR=true)
    if (segments.length === 0 && shouldTryGeminiAsr && Boolean(getGeminiClient())) {
      if ((activeStat.size > 3.5 * 1024 * 1024 || durationSeconds > 150) && hasNormalizedWav) {
        const chunks = await splitAudioIntoChunks(normalizedAudioPath, jobChunkDir, 120);
        const chunkResults: Array<TranscriptSegment[]> = new Array(chunks.length);
        let completedChunks = 0;
        let fatalConfigError = false;
        let nextIndex = 0;
        const concurrency = Math.min(3, chunks.length);

        const worker = async () => {
          while (!fatalConfigError && Boolean(getGeminiClient())) {
            const idx = nextIndex++;
            if (idx >= chunks.length) break;
            assertNotCancelled(jobId);
            const ch = chunks[idx];
            const outcome = await transcribeAudioWithGemini(
              ch.filePath,
              resourceType,
              ch.startSec,
              Math.max(5, ch.endSec - ch.startSec),
              language,
            );
            if (outcome.errorMessage) {
              geminiErrorMsg = outcome.errorMessage;
              if (
                !getGeminiClient() ||
                outcome.errorMessage.includes("402") ||
                outcome.errorMessage.includes("credits are depleted") ||
                outcome.errorMessage.includes("API_KEY_INVALID") ||
                outcome.errorMessage.includes("Settings > Secrets") ||
                outcome.errorMessage.includes("not configured")
              ) {
                fatalConfigError = true;
                break;
              }
            }
            if (outcome.silent) geminiObservedSilence = true;
            chunkResults[idx] = outcome.segments;
            completedChunks++;
            const chunkPct = 35 + Math.round((completedChunks / chunks.length) * 30);
            updateJob(jobId, {
              status: "Transcribing",
              stage: `Chunk ${completedChunks}/${chunks.length}`,
              progressPercent: chunkPct,
            });
            if (outcome.segments.length > 0) {
              notifySync({
                type: "TranscriptSegmentAvailable",
                userId: jobOwnerId,
                id: resourceId,
                resourceId,
                resourceType,
                jobId,
                count: outcome.segments.length,
                progress: chunkPct,
              });
            }
          }
        };

        await Promise.all(Array.from({ length: concurrency }, () => worker()));
        for (const list of chunkResults) {
          if (list && list.length > 0) segments.push(...list);
        }
        segments.sort((a, b) => a.startTime - b.startTime);
      } else {
        const outcome = await transcribeAudioWithGemini(
          activeAudioFile,
          resourceType,
          0,
          durationSeconds,
          language,
        );
        if (outcome.errorMessage) geminiErrorMsg = outcome.errorMessage;
        if (outcome.silent) geminiObservedSilence = true;
        segments = outcome.segments;
      }
    }

    // 3c. Built-in Real Multilingual Whisper ONNX ASR (@huggingface/transformers + FFmpeg)
    // Primary zero-API-key speech-to-text engine with real-time DB streaming of partial segments
    let localWhisperSilent = false;
    let localWhisperError: string | undefined;
    if (segments.length === 0) {
      updateJob(jobId, {
        status: "Transcribing",
        stage: "Transcribing",
        progressPercent: 40,
      });

      let lastStreamedCount = 0;
      const localWhisper = await transcribeAudioWithLocalWhisper({
        filePath: activeAudioFile,
        resourceType,
        language,
        jobId,
        alreadyConditioned: hasNormalizedWav,
        checkCancelled: () => assertNotCancelled(jobId),
        onProgress: (pct, partialSegments) => {
          const mappedPct = Math.min(68, 40 + Math.round((pct / 100) * 28));
          const segCount = partialSegments?.length || 0;

          // Stream partial transcribed segments directly to DB so UI renders live text during long jobs
          if (partialSegments && segCount > lastStreamedCount) {
            lastStreamedCount = segCount;
            const partialFullText = partialSegments
              .map((s) => `${s.speaker}: ${s.text}`)
              .join("\n");
            const nowTs = new Date().toISOString();
            if (resourceType === "meeting") {
              db.update("meetings", (meetings) =>
                meetings.map((m) =>
                  m.id === resourceId
                    ? {
                        ...m,
                        transcriptionStatus: "Processing",
                        transcriptStatus: "live",
                        segments: partialSegments.map((s) => ({ ...s, isPartial: true })),
                        fullText: partialFullText,
                        updatedAt: nowTs,
                      }
                    : m,
                ),
              );
            } else {
              db.update("lectures", (lectures) =>
                lectures.map((l) =>
                  l.id === resourceId
                    ? {
                        ...l,
                        transcriptionStatus: "Processing",
                        transcriptStatus: "live",
                        segments: partialSegments.map((s) => ({ ...s, isPartial: true })),
                        fullText: partialFullText,
                        updatedAt: nowTs,
                      }
                    : l,
                ),
              );
            }
          }

          updateJob(jobId, {
            status: "Transcribing",
            stage: "Transcribing",
            transcriptStatus: "live",
            progressPercent: mappedPct,
          });
          notifySync({
            type: "TranscriptSegmentAvailable",
            userId: jobOwnerId,
            id: resourceId,
            resourceId,
            resourceType,
            jobId,
            count: segCount,
            progress: mappedPct,
          });
        },
      });
      if (localWhisper.segments.length > 0) {
        const artifacts = buildTranscriptArtifacts({
          rawFullText: localWhisper.rawTranscript || localWhisper.fullText,
          rawSegments: localWhisper.segments,
        });
        segments = artifacts.processedSegments;
        rawSegments = artifacts.rawSegments;
        rawTranscriptText = artifacts.rawTranscript;
        processedTranscriptText = artifacts.processedTranscript;
        resolvedAsrModel = localWhisper.model;
        resolvedLanguageConfig =
          language && language !== "auto" ? `${language} (explicit)` : "auto (whisper-lang-id)";
        resolvedDetectedLanguage = localWhisper.detectedLanguage || language;
        resolvedDiarizationEnabled = false;
        resolvedAverageConfidence = artifacts.averageConfidence;
        if (localWhisper.durationSeconds > 0) {
          durationSeconds = localWhisper.durationSeconds;
        }
        logPipelineEvent("info", "whisper_asr_completed", {
          jobId,
          resourceId,
          model: localWhisper.model,
          segmentsCount: localWhisper.segments.length,
          detectedLanguage: localWhisper.detectedLanguage,
          latencyMs: localWhisper.latencyMs,
        });
      } else {
        localWhisperSilent = Boolean(localWhisper.silent);
        localWhisperError = localWhisper.errorMessage;
        if (localWhisper.errorMessage) {
          console.warn(`[Job ${jobId}] Built-in Whisper ASR notice:`, localWhisper.errorMessage);
        }
      }
    }

    // 3d. Local Python faster-whisper CLI engine (optional secondary fallback when local ONNX Whisper could not run)
    if (segments.length === 0 && !localWhisperSilent) {
      try {
        const pyBin = process.platform === "win32" ? "python" : "python3";
        const pyArgs = [
          "services/ai_service/transcribe.py",
          activeAudioFile,
          "--language",
          language || "auto",
          ...(isMeeting ? ["--meeting"] : []),
          "--output",
          jsonOutputPath,
        ];
        await execFileAsync(pyBin, pyArgs, { maxBuffer: 25 * 1024 * 1024, timeout: 180000 });
        if (fs.existsSync(jsonOutputPath)) {
          const parsed = JSON.parse(fs.readFileSync(jsonOutputPath, "utf-8"));
          if (parsed.success && Array.isArray(parsed.segments) && parsed.segments.length > 0) {
            segments = (
              parsed.segments as Array<{
                speaker?: string;
                startTime?: number;
                endTime?: number;
                text: string;
                confidence?: number;
                language?: string;
              }>
            ).map((s, idx: number) => ({
              id: `seg_${jobId}_${idx + 1}`,
              speaker: s.speaker || (isMeeting ? `Speaker ${(idx % 2) + 1}` : "Lecturer"),
              startTime: typeof s.startTime === "number" ? Math.round(s.startTime * 10) / 10 : 0,
              endTime: typeof s.endTime === "number" ? Math.round(s.endTime * 10) / 10 : 5,
              text: s.text.trim(),
              confidence: typeof s.confidence === "number" ? s.confidence : 0.9,
              language: s.language || language,
              isPartial: false,
            }));
          }
        }
      } catch (whisperErr) {
        console.warn(`[Job ${jobId}] Python Whisper notice:`, whisperErr);
      }
    }

    // Strict Zero-Fake-Transcript Policy: NEVER fabricate placeholder transcript text when all real ASR engines fail.
    if (segments.length === 0) {
      if (localWhisperSilent || (geminiObservedSilence && !geminiErrorMsg)) {
        throw new Error(
          "No audible speech detected in the recording. Please check the audio file and try again.",
        );
      }
      logPipelineEvent("error", "all_real_asr_engines_failed", {
        jobId,
        resourceId,
        localWhisperError: localWhisperError?.slice(0, 240),
        geminiError: geminiErrorMsg?.slice(0, 240),
      });
      const detail =
        localWhisperError ||
        assemblyAiErrorMsg ||
        geminiErrorMsg ||
        "All speech-to-text engines failed to extract speech from this audio file.";
      throw new Error(`Real speech-to-text transcription failed: ${detail}`);
    }

    assertNotCancelled(jobId);

    // 4. Merging & Completion of Transcription Stage
    if (typeof timings.transcriptionMs !== "number") {
      timings.transcriptionMs = Date.now() - directTranscriptionStart;
    }
    const finalArtifacts =
      rawTranscriptText && rawSegments.length > 0
        ? {
            rawTranscript: rawTranscriptText,
            processedTranscript:
              processedTranscriptText || segments.map((s) => `${s.speaker}: ${s.text}`).join("\n"),
            rawSegments,
            processedSegments: segments,
            averageConfidence: resolvedAverageConfidence,
          }
        : buildTranscriptArtifacts({ rawSegments: segments });
    segments = finalArtifacts.processedSegments;
    rawSegments = finalArtifacts.rawSegments;
    rawTranscriptText = finalArtifacts.rawTranscript;
    processedTranscriptText = finalArtifacts.processedTranscript;
    resolvedAverageConfidence = resolvedAverageConfidence ?? finalArtifacts.averageConfidence;

    const finalSpeakerBreakdown = resolvedSpeakerBreakdown || computeSpeakerBreakdown(segments);
    timings.transcriptionProvider = resolvedTranscriptionProvider;
    timings.transcriptHash = computeTranscriptSha256(segments).slice(0, 16);
    timings.firstResultMs = (timings.uploadMs || 0) + (Date.now() - jobStartedAt);
    setCachedTranscriptByAudioHash({
      audioSha256,
      language,
      transcriptId: resolvedTranscriptId,
      provider: resolvedTranscriptionProvider,
      asrModel: resolvedAsrModel,
      languageConfig: resolvedLanguageConfig,
      diarizationEnabled: resolvedDiarizationEnabled,
      averageConfidence: resolvedAverageConfidence,
      detectedLanguage: resolvedDetectedLanguage || language,
      durationSeconds,
      rawTranscript: rawTranscriptText,
      processedTranscript: processedTranscriptText,
      rawSegments,
      segments,
      speakerBreakdown: finalSpeakerBreakdown,
    });
    const totalWordsExtracted = processedTranscriptText.trim().split(/\s+/).filter(Boolean).length;
    markStageLedger(
      stageLedger,
      correlationId,
      jobId,
      resourceId,
      "TRANSCRIPTION_PROCESSING",
      "completed",
      {
        durationMs: timings.transcriptionMs,
        detail: `${segments.length} segments, ${totalWordsExtracted} words`,
      },
    );
    markStageLedger(
      stageLedger,
      correlationId,
      jobId,
      resourceId,
      "TRANSCRIPTION_COMPLETED",
      "completed",
      {
        durationMs: timings.transcriptionMs,
        detail: resolvedTranscriptionProvider,
      },
    );
    markStageLedger(
      stageLedger,
      correlationId,
      jobId,
      resourceId,
      "TRANSCRIPT_RECEIVED",
      "completed",
      {
        durationMs: timings.transcriptFetchMs ?? 0,
        detail: `${segments.length} segments (${totalWordsExtracted} words)`,
      },
    );
    logStageTiming(correlationId, "TRANSCRIPTION_COMPLETE", timings.transcriptionMs, {
      provider: resolvedTranscriptionProvider,
      asrModel: resolvedAsrModel,
      languageConfig: resolvedLanguageConfig,
      diarizationEnabled: resolvedDiarizationEnabled,
      averageConfidence: resolvedAverageConfidence,
      segmentsCount: segments.length,
    });
    updateJob(jobId, {
      status: "Merging",
      stage: "MergingTranscript",
      stageProgress: 100,
      progressPercent: 72,
      segmentsReceived: segments.length,
      wordsReceived: totalWordsExtracted,
      detectedLanguage: resolvedDetectedLanguage,
      audioDurationSeconds: durationSeconds,
      currentOperation: "Transcript completed — starting parallel AI analysis...",
      currentOperationAr: "اكتمل التفريغ الصوتي — بدء التحليل الذكي المتوازي...",
      transcriptId: resolvedTranscriptId,
      transcriptionProvider: resolvedTranscriptionProvider,
      transcriptStatus: "final_verified",
      asrModel: resolvedAsrModel,
      languageConfig: resolvedLanguageConfig,
      diarizationEnabled: resolvedDiarizationEnabled,
      averageConfidence: resolvedAverageConfidence,
      timings,
      stageLedger,
      milestones: {
        uploadComplete: true,
        audioValidated: true,
        transcriptionStarted: true,
        languageDetected: true,
        transcriptionCompleted: true,
        transcriptSaved: true,
      },
    });
    logObservabilityEvent("info", "transcription_completed", {
      correlationId,
      jobId,
      resourceId,
      provider: resolvedTranscriptionProvider,
      transcriptId: resolvedTranscriptId,
      segmentsCount: segments.length,
    });
    notifySync({
      type: "TranscriptionCompleted",
      userId: jobOwnerId,
      id: resourceId,
      resourceId,
      resourceType,
      jobId,
      count: segments.length,
      progress: 72,
    });

    // 5-8. Run the Unified Post-Transcription Intelligence Pipeline (shared identically by Upload & Live Recording)
    const resourceTitle = resourceTitlePre;
    const courseCode = courseCodePre;

    const jobRecord = db.get("jobs").find((j) => j.id === jobId);
    const pipelineResult = await runUnifiedPostTranscriptionPipeline({
      resourceType,
      resourceId,
      title: resourceTitle,
      courseCode,
      language: resolvedDetectedLanguage || language,
      appLanguage: jobRecord?.appLanguage,
      durationSeconds,
      segments,
      rawSegments,
      rawTranscript: rawTranscriptText,
      processedTranscript: processedTranscriptText,
      asrModel: resolvedAsrModel,
      languageConfig: resolvedLanguageConfig,
      diarizationEnabled: resolvedDiarizationEnabled,
      averageConfidence: resolvedAverageConfidence,
      userId: jobOwnerId,
      jobId,
      correlationId,
      transcriptId: resolvedTranscriptId,
      transcriptionProvider: resolvedTranscriptionProvider,
      speakerBreakdown: finalSpeakerBreakdown,
      timings,
      stageLedger,
      audioSha256,
      checkCancelled: () => assertNotCancelled(jobId),
    });

    timings.totalMs = (timings.uploadMs || 0) + (Date.now() - jobStartedAt);
    markStageLedger(stageLedger, correlationId, jobId, resourceId, "JOB_COMPLETED", "completed", {
      durationMs: timings.totalMs,
    });
    logStageTiming(correlationId, "RESULT_READY", timings.totalMs, {
      provider: resolvedTranscriptionProvider,
      pipelineMode: timings.pipelineMode,
      firstResultMs: timings.firstResultMs,
    });

    if (resourceType === "meeting") {
      db.update("meetings", (list) =>
        list.map((m) => (m.id === resourceId ? { ...m, timings } : m)),
      );
    } else {
      db.update("lectures", (list) =>
        list.map((l) => (l.id === resourceId ? { ...l, timings } : l)),
      );
    }

    const jobStage =
      pipelineResult.analysisStatus === "Completed"
        ? "Completed"
        : pipelineResult.analysisStatus === "Unavailable"
          ? "AnalysisUnavailable"
          : "Completed";

    updateJob(jobId, {
      status: "Completed",
      stage: jobStage,
      stageProgress: 100,
      progressPercent: 100,
      currentOperation: "Processing completed — all outputs ready",
      currentOperationAr: "اكتملت المعالجة بنجاح — جميع المخرجات جاهزة",
      transcriptId: resolvedTranscriptId,
      transcriptionProvider: resolvedTranscriptionProvider,
      analysisProvider: timings.analysisProvider,
      timings,
      stageLedger,
      errorMessage: pipelineResult.analysisError,
    });

    // Optional non-blocking post-completion n8n webhook notification (zero impact on user latency)
    const postWebhookUrl = (process.env.N8N_POST_COMPLETE_WEBHOOK_URL || "").trim();
    if (postWebhookUrl && /^https?:\/\//i.test(postWebhookUrl)) {
      void fetch(postWebhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Correlation-ID": correlationId,
        },
        body: JSON.stringify({
          event: "meetmind.recording.completed",
          correlationId,
          jobId,
          resourceId,
          resourceType,
          title: resourceTitle,
          transcriptId: resolvedTranscriptId,
          durationSeconds,
          segmentsCount: segments.length,
          summary: pipelineResult.executiveSummary || pipelineResult.summary,
          timings,
        }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    }
    logPipelineEvent("info", "job_completed", {
      jobId,
      resourceId,
      resourceType,
      segmentsCount: segments.length,
      durationSeconds,
    });
    notifySync({
      type: "ProcessingCompleted",
      userId: jobOwnerId,
      id: resourceId,
      resourceId,
      resourceType,
      jobId,
      progress: 100,
    });
  } catch (error) {
    const errMessage = error instanceof Error ? error.message : "Unknown processing error";
    const { category, transient } = classifyFailureCategory(errMessage);
    logPipelineEvent("error", "job_error", {
      jobId,
      resourceId,
      resourceType,
      category,
      transient,
      error: errMessage,
    });
    const currentJob = db.get("jobs").find((j) => j.id === jobId);
    const retries = currentJob?.retryCount || 0;
    const maxRetries = currentJob?.maxRetries ?? 2;

    if (category === "CancelledByUser") {
      cancelledJobs.delete(jobId);
      updateJob(jobId, {
        status: "Cancelled",
        stage: "Cancelled",
        failureCategory: category,
        failureTimestamp: new Date().toISOString(),
        errorMessage: "Cancelled by user.",
      });
      if (resourceType === "meeting") {
        db.update("meetings", (meetings) =>
          meetings.map((m) => (m.id === resourceId ? { ...m, status: "Failed" } : m)),
        );
      } else {
        db.update("lectures", (lectures) =>
          lectures.map((l) => (l.id === resourceId ? { ...l, status: "Failed" } : l)),
        );
      }
      notifySync({ type: "JobCancelled", id: resourceId, jobId });
      return;
    }

    // Exponential backoff retry for transient failures
    if (transient && retries < maxRetries) {
      const nextRetry = retries + 1;
      const backoffMs = Math.pow(2, nextRetry) * 1000;
      updateJob(jobId, {
        status: "Queued",
        stage: `Retrying (${nextRetry}/${maxRetries})`,
        retryCount: nextRetry,
        failureCategory: category,
        errorMessage: `Temporary error, retrying automatically: ${errMessage}`,
      });
      setTimeout(() => {
        void processRecordingJob(
          jobId,
          resourceType,
          resourceId,
          filePath,
          originalFilename,
          language,
        );
      }, backoffMs);
      return;
    }

    updateJob(jobId, {
      status: "Failed",
      stage: "Failed",
      retryable: category !== "MediaValidationError" && category !== "CancelledByUser",
      failureCategory: category,
      failureTimestamp: new Date().toISOString(),
      errorMessage: errMessage,
    });

    if (resourceType === "meeting") {
      db.update("meetings", (meetings) =>
        meetings.map((m) => (m.id === resourceId ? { ...m, status: "Failed" } : m)),
      );
    } else {
      db.update("lectures", (lectures) =>
        lectures.map((l) => (l.id === resourceId ? { ...l, status: "Failed" } : l)),
      );
    }
    notifySync({ type: "ProcessingFailed", id: resourceId, jobId });
  } finally {
    try {
      if (fs.existsSync(jobChunkDir)) fs.rmSync(jobChunkDir, { recursive: true, force: true });
      if (fs.existsSync(normalizedAudioPath)) fs.unlinkSync(normalizedAudioPath);
    } catch {
      /* ignore cleanup */
    }
  }
}

export function updateJob(jobId: string, updates: Partial<JobRecord>) {
  db.update("jobs", (jobs) =>
    jobs.map((j) =>
      j.id === jobId ? { ...j, ...updates, updatedAt: new Date().toISOString() } : j,
    ),
  );
  notifySync({ type: "JOB_UPDATED", id: jobId, progress: updates.progressPercent });
}

export function createJob(
  resourceType: "meeting" | "lecture",
  resourceId: string,
  fileName: string,
  filePath?: string,
  language = "auto",
  options?: { userId?: string; idempotencyKey?: string; appLanguage?: "en" | "ar" },
): JobRecord {
  const job: JobRecord = {
    id: `job_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
    userId: options?.userId || "usr_admin",
    correlationId: `corr_${Date.now().toString(36)}`,
    idempotencyKey: options?.idempotencyKey,
    type: "transcription",
    status: "Queued",
    stage: "Queued",
    progressPercent: 5,
    resourceType,
    resourceId,
    fileName,
    filePath,
    originalFilename: fileName,
    language,
    appLanguage:
      options?.appLanguage || (language === "ar" ? "ar" : language === "en" ? "en" : undefined),
    retryCount: 0,
    maxRetries: 2,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  db.update("jobs", (jobs) => [job, ...jobs]);
  return job;
}

export function cancelJob(jobId: string): JobRecord {
  const job = db.get("jobs").find((j) => j.id === jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }
  cancelledJobs.add(jobId);
  updateJob(jobId, {
    status: "Cancelled",
    stage: "Cancelled",
    failureCategory: "CancelledByUser",
    failureTimestamp: new Date().toISOString(),
    errorMessage: "Cancelled by user.",
  });
  return db.get("jobs").find((j) => j.id === jobId)!;
}

export async function retryJob(jobId: string): Promise<JobRecord> {
  const job = db.get("jobs").find((j) => j.id === jobId);
  if (!job) {
    throw new Error(`Job not found: ${jobId}`);
  }

  let filePath = job.filePath;
  if (!filePath) {
    if (job.resourceType === "meeting") {
      filePath = db.get("meetings").find((m) => m.id === job.resourceId)?.recordingPath;
    } else {
      filePath = db.get("lectures").find((l) => l.id === job.resourceId)?.recordingPath;
    }
  }

  if (!filePath || !fs.existsSync(filePath)) {
    throw new Error("Original audio recording file is no longer available on disk for retry.");
  }

  cancelledJobs.delete(jobId);
  updateJob(jobId, {
    status: "Queued",
    stage: "Queued",
    progressPercent: 5,
    retryCount: 0,
    failureCategory: undefined,
    failureTimestamp: undefined,
    errorMessage: undefined,
  });

  if (job.resourceType === "meeting") {
    db.update("meetings", (meetings) =>
      meetings.map((m) => (m.id === job.resourceId ? { ...m, status: "Processing" } : m)),
    );
  } else {
    db.update("lectures", (lectures) =>
      lectures.map((l) => (l.id === job.resourceId ? { ...l, status: "Processing" } : l)),
    );
  }

  setTimeout(() => {
    void processRecordingJob(
      job.id,
      job.resourceType,
      job.resourceId,
      filePath!,
      job.originalFilename || job.fileName,
      job.language || "auto",
    );
  }, 50);

  return db.get("jobs").find((j) => j.id === jobId)!;
}

let recoveryRan = false;
export function recoverInterruptedJobs() {
  if (recoveryRan) return;
  recoveryRan = true;

  const jobs = db.get("jobs") || [];
  const interrupted = jobs.filter(
    (j) => j.status !== "Completed" && j.status !== "Failed" && j.status !== "Cancelled",
  );
  const nowMs = Date.now();
  const MAX_AUTO_RESUME_AGE_MS = 5 * 60 * 1000;

  for (const job of interrupted) {
    const lastTouchMs = Date.parse(job.updatedAt || job.createdAt || "") || 0;
    const isFresh = lastTouchMs > 0 && nowMs - lastTouchMs <= MAX_AUTO_RESUME_AGE_MS;
    if (isFresh && job.filePath && fs.existsSync(job.filePath)) {
      setTimeout(() => {
        void processRecordingJob(
          job.id,
          job.resourceType,
          job.resourceId,
          job.filePath!,
          job.originalFilename || job.fileName,
          job.language || "auto",
        );
      }, 250);
    } else {
      const hasFile = Boolean(job.filePath && fs.existsSync(job.filePath));
      updateJob(job.id, {
        status: "Failed",
        stage: "Failed",
        retryable: hasFile,
        failureCategory: hasFile ? "InterruptedOnRestart" : "StorageError",
        failureTimestamp: new Date().toISOString(),
        errorMessage: hasFile
          ? "Processing was interrupted when the server restarted. Click Retry to process cleanly."
          : "Interrupted job could not resume because source media file is missing.",
      });
    }
  }
}

/**
 * Safely returns the isolated directory where live audio chunks for a session are stored.
 */
export function getLiveSessionChunksDir(sessionId: string): string {
  const safeId = sessionId.replace(/[^a-zA-Z0-9_-]/g, "");
  if (!safeId || safeId.length < 3 || safeId.length > 80) {
    throw new Error("Invalid sessionId");
  }
  const target = path.resolve(CHUNKS_BASE_DIR, `live_${safeId}`);
  const baseWithSep = path.resolve(CHUNKS_BASE_DIR) + path.sep;
  if (!target.startsWith(baseWithSep)) {
    throw new Error("Invalid live session chunk directory path");
  }
  return target;
}

/**
 * Concatenates all persisted live audio chunks for a session into one canonical
 * playable audio file using ffmpeg (avoiding multi-hour browser base64 uploads).
 */
export async function assembleLiveAudioChunks(
  sessionId: string,
  outputPath: string,
): Promise<{ assembledPath?: string; durationSeconds: number }> {
  const dir = getLiveSessionChunksDir(sessionId);
  if (!fs.existsSync(dir)) {
    return { durationSeconds: 0 };
  }

  const files = fs
    .readdirSync(dir)
    .filter((f) => /^chunk_\d+\.(wav|webm|ogg|m4a|mp3)$/i.test(f))
    .sort((a, b) => {
      const na = parseInt(a.match(/^chunk_(\d+)/)?.[1] || "0", 10);
      const nb = parseInt(b.match(/^chunk_(\d+)/)?.[1] || "0", 10);
      return na - nb;
    });

  if (files.length === 0) {
    return { durationSeconds: 0 };
  }

  const outputDir = path.dirname(outputPath);
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  // Normalize each chunk to 16kHz mono WAV if needed, then concat cleanly
  const normalizedList: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const src = path.join(dir, files[i]);
    if (files[i].endsWith(".wav")) {
      normalizedList.push(src);
    } else {
      const wavOut = path.join(dir, `norm_${String(i).padStart(5, "0")}.wav`);
      try {
        await execFileAsync(
          "ffmpeg",
          [
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-err_detect",
            "ignore_err",
            "-i",
            src,
            "-vn",
            "-acodec",
            "pcm_s16le",
            "-ar",
            "16000",
            "-ac",
            "1",
            wavOut,
          ],
          { timeout: 30000, maxBuffer: 4 * 1024 * 1024 },
        );
        if (fs.existsSync(wavOut) && fs.statSync(wavOut).size > 256) {
          normalizedList.push(wavOut);
        }
      } catch {
        // skip unreadable individual slice without failing the full recording
      }
    }
  }

  if (normalizedList.length === 0) {
    return { durationSeconds: 0 };
  }

  if (normalizedList.length === 1) {
    fs.copyFileSync(normalizedList[0], outputPath);
    const dur = await probeDurationSeconds(outputPath);
    return { assembledPath: outputPath, durationSeconds: Math.max(1, Math.round(dur || 1)) };
  }

  const listPath = path.join(dir, "concat_list.txt");
  const listContent = normalizedList.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
  fs.writeFileSync(listPath, listContent, "utf-8");

  try {
    await execFileAsync(
      "ffmpeg",
      [
        "-y",
        "-hide_banner",
        "-loglevel",
        "error",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listPath,
        "-acodec",
        "pcm_s16le",
        "-ar",
        "16000",
        "-ac",
        "1",
        outputPath,
      ],
      { timeout: 120000, maxBuffer: 10 * 1024 * 1024 },
    );
    if (fs.existsSync(outputPath) && fs.statSync(outputPath).size > 512) {
      const dur = await probeDurationSeconds(outputPath);
      return { assembledPath: outputPath, durationSeconds: Math.max(1, Math.round(dur || 1)) };
    }
  } catch (err) {
    console.warn("Failed to concat live audio chunks:", err);
  }

  return { durationSeconds: 0 };
}

export interface UnifiedPipelineParams {
  resourceType: "meeting" | "lecture";
  resourceId: string;
  title: string;
  courseCode?: string;
  language: string;
  appLanguage?: "en" | "ar";
  durationSeconds: number;
  segments: TranscriptSegment[];
  rawSegments?: TranscriptSegment[];
  rawTranscript?: string;
  processedTranscript?: string;
  asrModel?: string;
  languageConfig?: string;
  diarizationEnabled?: boolean;
  averageConfidence?: number;
  userId: string;
  jobId?: string;
  correlationId?: string;
  transcriptId?: string;
  transcriptionProvider?: "n8n" | "assemblyai" | "gemini" | "whisper-local" | "live";
  speakerBreakdown?: AssemblyAiSpeakerStat[];
  timings?: StageTimings;
  stageLedger?: Record<string, StageTelemetryEntry>;
  audioSha256?: string;
  precomputedUnifiedAnalysis?: UnifiedRecordingAnalysisResult;
  recordingPath?: string;
  recordingFileName?: string;
  audioUrl?: string;
  checkCancelled?: () => void;
}

export interface UnifiedPipelineResult {
  summary?: string;
  executiveSummary?: string;
  detailedSummary?: string;
  keyPoints?: string[];
  decisions?: string[];
  keywordsCount: number;
  highlightsCount: number;
  tasksCount: number;
  quizQuestionsCount: number;
  flashcardsCount: number;
  hasMindMap: boolean;
  transcriptionStatus: "Completed" | "Processing" | "Failed";
  analysisStatus: "Completed" | "Processing" | "Unavailable" | "Failed";
  analysisError?: string;
  analysisRetryable?: boolean;
}

/**
 * UNIFIED POST-TRANSCRIPTION AI INTELLIGENCE PIPELINE
 * Executed identically for BOTH uploaded audio files (`processRecordingJob`)
 * AND finalized live recordings (`/api/v1/transcripts/live-session/finalize`).
 */
export async function runUnifiedPostTranscriptionPipeline(
  params: UnifiedPipelineParams,
): Promise<UnifiedPipelineResult> {
  const {
    resourceType,
    resourceId,
    title,
    courseCode,
    language,
    appLanguage,
    durationSeconds,
    segments,
    rawSegments: incomingRawSegments,
    rawTranscript: incomingRawTranscript,
    processedTranscript: incomingProcessedTranscript,
    asrModel,
    languageConfig,
    diarizationEnabled,
    averageConfidence: incomingAverageConfidence,
    userId,
    jobId,
    correlationId: rawCorrelationId,
    transcriptId,
    transcriptionProvider,
    speakerBreakdown: rawSpeakerBreakdown,
    timings: sharedTimings,
    stageLedger: incomingStageLedger,
    audioSha256,
    precomputedUnifiedAnalysis,
    recordingPath,
    recordingFileName,
    audioUrl,
    checkCancelled,
  } = params;

  const correlationId = rawCorrelationId || createCorrelationId("pipe");
  const analysisStartedAt = Date.now();
  const stageLedger: Record<string, StageTelemetryEntry> = incomingStageLedger || {};
  const speakerBreakdown = rawSpeakerBreakdown || computeSpeakerBreakdown(segments);
  const artifacts = buildTranscriptArtifacts({
    rawFullText: incomingRawTranscript,
    rawSegments: incomingRawSegments || segments,
  });
  const rawTranscript = incomingRawTranscript || artifacts.rawTranscript;
  const processedTranscript =
    incomingProcessedTranscript || segments.map((s) => `${s.speaker}: ${s.text}`).join("\n");
  const finalTranscript = processedTranscript;
  const rawSegments = incomingRawSegments || artifacts.rawSegments;
  const averageConfidence = incomingAverageConfidence ?? artifacts.averageConfidence;
  const fullText = processedTranscript;
  const runId = jobId || `live_${resourceId}_${Date.now()}`;
  const liveMilestones: NonNullable<JobRecord["milestones"]> = {
    uploadComplete: true,
    audioValidated: true,
    transcriptionStarted: true,
    languageDetected: true,
    transcriptionCompleted: true,
    transcriptSaved: true,
    analysisStarted: true,
  };
  const pushJobProgress = (patch: Partial<JobRecord>) => {
    if (!jobId) return;
    updateJob(jobId, {
      ...patch,
      stageLedger,
      milestones: { ...liveMilestones, ...(patch.milestones || {}) },
      ...(sharedTimings ? { timings: sharedTimings } : {}),
    });
  };

  markStageLedger(
    stageLedger,
    correlationId,
    jobId,
    resourceId,
    "AI_ANALYSIS_STARTED",
    "completed",
    {
      durationMs: 0,
      detail: `${segments.length} segments`,
    },
  );
  logStageTiming(correlationId, "GEMINI_START");
  pushJobProgress({
    status: "Analyzing",
    stage: "AIAnalysis",
    stageProgress: 10,
    progressPercent: 76,
    currentOperation: "Generating keywords, summary, action items, quiz & flashcards...",
    currentOperationAr: "جاري توليد الكلمات المفتاحية والملخص والمهام والاختبار والبطاقات...",
  });
  logObservabilityEvent("info", "ai_analysis_started", {
    correlationId,
    jobId,
    resourceId,
    resourceType,
    segmentsCount: segments.length,
  });
  notifySync({
    type: "AIAnalysisStarted",
    userId,
    id: resourceId,
    resourceId,
    resourceType,
    jobId,
    progress: 76,
  });

  // 1. Transcript-derived Keywords & Cue Highlights (instant <5ms, streamed immediately!)
  const keywordsStartAt = Date.now();
  const keywords = extractKeywordsWithFrequency(segments, 12);
  const cueHighlights = extractHighlightsFromSegments(segments);
  const keywordsMs = Math.max(1, Date.now() - keywordsStartAt);
  if (sharedTimings) sharedTimings.keywordsMs = keywordsMs;
  markStageLedger(
    stageLedger,
    correlationId,
    jobId,
    resourceId,
    "KEYWORDS_COMPLETED",
    "completed",
    {
      durationMs: keywordsMs,
      detail: `${keywords.length} keywords`,
    },
  );
  liveMilestones.keywordsReady = true;
  pushJobProgress({
    progressPercent: 80,
    stageProgress: 22,
    currentOperation: "Keywords extracted — generating summary, tasks, quiz & flashcards...",
    currentOperationAr:
      "تم استخراج الكلمات المفتاحية — جاري توليد الملخص والمهام والاختبار والبطاقات...",
    progressiveKeywords: keywords.slice(0, 12).map((k) => k.term),
    progressiveKeywordsCount: keywords.length,
  });
  notifySync({
    type: "KeywordsReady",
    userId,
    id: resourceId,
    resourceId,
    resourceType,
    jobId,
    progress: 80,
  });

  // STEP 1: IMMEDIATELY save verified raw + final transcript, audio, duration, and keywords to DB!
  // Users can immediately read the verified transcript & keywords while Gemini analysis runs.
  const initialNow = new Date().toISOString();
  if (resourceType === "meeting") {
    db.update("meetings", (meetings) =>
      meetings.map((m) => {
        if (m.id !== resourceId) return m;
        return {
          ...m,
          status: "Completed",
          transcriptionStatus: "Completed",
          transcriptStatus: "final_verified",
          analysisStatus: "Processing",
          transcriptId: transcriptId || m.transcriptId,
          transcriptionProvider: transcriptionProvider || m.transcriptionProvider,
          asrModel: asrModel || m.asrModel,
          languageConfig: languageConfig || m.languageConfig,
          diarizationEnabled: diarizationEnabled ?? m.diarizationEnabled,
          averageConfidence: averageConfidence ?? m.averageConfidence,
          language,
          appLanguage:
            appLanguage || (language === "ar" ? "ar" : language === "en" ? "en" : undefined),
          durationSeconds: Math.max(1, durationSeconds, m.durationSeconds || 1),
          recordingPath: recordingPath || m.recordingPath,
          recordingFileName: recordingFileName || m.recordingFileName,
          audioUrl: audioUrl || m.audioUrl,
          keywords,
          highlights: cueHighlights,
          rawTranscript,
          finalTranscript,
          processedTranscript,
          rawSegments,
          fullText,
          segments,
          updatedAt: initialNow,
        };
      }),
    );
  } else {
    db.update("lectures", (lectures) =>
      lectures.map((l) => {
        if (l.id !== resourceId) return l;
        return {
          ...l,
          status: "Completed",
          transcriptionStatus: "Completed",
          transcriptStatus: "final_verified",
          analysisStatus: "Processing",
          transcriptId: transcriptId || l.transcriptId,
          transcriptionProvider: transcriptionProvider || l.transcriptionProvider,
          asrModel: asrModel || l.asrModel,
          languageConfig: languageConfig || l.languageConfig,
          diarizationEnabled: diarizationEnabled ?? l.diarizationEnabled,
          averageConfidence: averageConfidence ?? l.averageConfidence,
          language,
          appLanguage:
            appLanguage || (language === "ar" ? "ar" : language === "en" ? "en" : undefined),
          durationSeconds: Math.max(1, durationSeconds, l.durationSeconds || 1),
          recordingPath: recordingPath || l.recordingPath,
          recordingFileName: recordingFileName || l.recordingFileName,
          audioUrl: audioUrl || l.audioUrl,
          keywords,
          highlights: cueHighlights,
          rawTranscript,
          finalTranscript,
          processedTranscript,
          rawSegments,
          fullText,
          segments,
          updatedAt: initialNow,
        };
      }),
    );
  }

  // STEP 2: Controlled Parallel AI Analysis Execution (default: parallel progressive commits!)
  // Runs Summary+Tasks, DeepAnalysis, Grounded Quiz, and Flashcards concurrently so each artifact
  // persists and streams to the modal the instant it completes (~2.5-6s total wall-clock!).
  let analysisStatus: "Completed" | "Unavailable" | "Failed" = "Completed";
  let analysisError: string | undefined = undefined;
  let analysisRetryable = false;
  let analyzedAt: string | undefined = undefined;
  let analysis: Awaited<ReturnType<typeof generateAiSummary>> | undefined = undefined;
  let deepAnalysis: Awaited<ReturnType<typeof generateAiLectureAnalysis>> | undefined = undefined;
  let generatedQuiz: Awaited<ReturnType<typeof generateAiQuiz>> | undefined = undefined;
  let generatedCards: Awaited<ReturnType<typeof generateAiFlashcards>> = [];
  let generatedMindMap: Awaited<ReturnType<typeof generateAiMindMap>> | undefined = undefined;

  const useParallelMode =
    !precomputedUnifiedAnalysis &&
    (process.env.AI_ANALYSIS_MODE || "parallel").trim().toLowerCase() !== "unified";

  if (!useParallelMode) {
    try {
      const unified =
        precomputedUnifiedAnalysis ||
        (await generateUnifiedRecordingAnalysis({
          title,
          segments,
          resourceType,
          courseCode,
          appLanguage,
        }));

      analysis = unified.summary;
      deepAnalysis = unified.deepAnalysis;
      generatedQuiz = unified.quiz;
      generatedCards = unified.flashcards;
      generatedMindMap = unified.mindMap;
      analysisStatus = "Completed";
      analysisRetryable = false;
      analyzedAt = new Date().toISOString();

      if (sharedTimings) {
        sharedTimings.analysisProvider = unified.provider;
        sharedTimings.transcriptHash = unified.transcriptHash.slice(0, 16);
        sharedTimings.analysisHash = unified.analysisHash.slice(0, 16);
        if (precomputedUnifiedAnalysis || unified.cacheHit) {
          sharedTimings.analysisCacheHit = true;
        }
      }

      if (audioSha256 && !precomputedUnifiedAnalysis) {
        attachCachedAnalysisToAudioHash({
          audioSha256,
          language,
          provider: transcriptionProvider,
          analysis: unified,
        });
      }

      liveMilestones.summaryReady = Boolean(analysis.summary);
      if ((analysis.actionItems?.length || 0) > 0) liveMilestones.tasksReady = true;
      if ((generatedQuiz?.questions.length || 0) > 0) liveMilestones.quizReady = true;
      if (generatedCards.length > 0) liveMilestones.flashcardsReady = true;
      pushJobProgress({
        progressPercent: 94,
        analysisProvider: unified.provider,
        progressiveSummary: analysis.executiveSummary || analysis.summary,
        progressiveTasks: (analysis.actionItems || []).slice(0, 8).map((a) => ({
          title: a.title,
          ownerName: a.ownerName,
          dueDate: a.dueDate,
        })),
        progressiveTasksCount: analysis.actionItems?.length || 0,
        progressiveQuizCount: generatedQuiz?.questions.length || 0,
        progressiveFlashcardsCount: generatedCards.length,
      });
      notifySync({
        type: "SummaryReady",
        userId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 90,
      });
    } catch (reason) {
      const status = extractHttpStatus(reason);
      const retryable = isRetryableGeminiError(reason);
      if (retryable) {
        analysisStatus = "Unavailable";
        analysisRetryable = true;
        analysisError =
          status === 503
            ? "التحليل الذكي غير متاح مؤقتاً بسبب الضغط العالي على خوادم الذكاء الاصطناعي (HTTP 503 UNAVAILABLE). النص والتسجيل محفوظان بالكامل ويمكنك إعادة محاولة التحليل دون إعادة التسجيل."
            : status === 429
              ? "تم تجاوز حد الطلبات مؤقتاً (HTTP 429). النص والتسجيل محفوظان، يمكنك إعادة المحاولة بعد لحظات."
              : `التحليل الذكي غير متاح مؤقتاً (${reason instanceof Error ? reason.message : String(reason)}). النص والتسجيل محفوظان، يمكنك إعادة المحاولة.`;
      } else {
        analysisStatus = "Failed";
        analysisRetryable = false;
        analysisError = reason instanceof Error ? reason.message : String(reason);
      }
    }
  } else {
    async function withStageTimeout<T>(
      task: () => Promise<T>,
      label: string,
      timeoutMs = 60000,
    ): Promise<T> {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          task(),
          new Promise<T>((_, reject) => {
            timer = setTimeout(() => {
              reject(new Error(`AI pipeline stage "${label}" timed out after ${timeoutMs}ms.`));
            }, timeoutMs);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    }

    async function runControlledConcurrency<T extends readonly (() => Promise<unknown>)[]>(
      tasks: T,
      maxConcurrency = 4,
    ): Promise<{ [K in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[K]>>> }> {
      const results: PromiseSettledResult<unknown>[] = new Array(tasks.length);
      let nextIndex = 0;
      async function worker() {
        while (nextIndex < tasks.length) {
          const idx = nextIndex++;
          try {
            const val = await tasks[idx]();
            results[idx] = { status: "fulfilled", value: val };
          } catch (err) {
            results[idx] = { status: "rejected", reason: err };
          }
        }
      }
      const workers = Array.from({ length: Math.min(maxConcurrency, tasks.length) }, () =>
        worker(),
      );
      await Promise.all(workers);
      return results as unknown as {
        [K in keyof T]: PromiseSettledResult<Awaited<ReturnType<T[K]>>>;
      };
    }

    let completedBranches = 0;
    const bumpParallelPct = (opEn: string, opAr: string, extra?: Partial<JobRecord>) => {
      completedBranches++;
      const stagePct = Math.min(95, 25 + Math.round((completedBranches / 4) * 70));
      const overallPct = Math.min(95, 80 + Math.round((completedBranches / 4) * 15));
      pushJobProgress({
        progressPercent: overallPct,
        stageProgress: stagePct,
        currentOperation: opEn,
        currentOperationAr: opAr,
        ...(extra || {}),
      });
    };

    markStageLedger(stageLedger, correlationId, jobId, resourceId, "SUMMARY_COMPLETED", "running");
    markStageLedger(stageLedger, correlationId, jobId, resourceId, "TASKS_COMPLETED", "running");
    markStageLedger(stageLedger, correlationId, jobId, resourceId, "QUIZ_COMPLETED", "running");
    markStageLedger(
      stageLedger,
      correlationId,
      jobId,
      resourceId,
      "FLASHCARDS_COMPLETED",
      "running",
    );

    const [summarySettled, deepSettled, quizSettled, cardsSettled, mindMapSettled] =
      (await runControlledConcurrency(
        [
          () =>
            withStageTimeout(
              async () => {
                const t0 = Date.now();
                const res = await generateAiSummary(
                  title,
                  segments,
                  resourceType,
                  courseCode,
                  appLanguage,
                  { fastFallback: true },
                );
                const durMs = Math.max(1, Date.now() - t0);
                if (sharedTimings) {
                  sharedTimings.summaryMs = durMs;
                  sharedTimings.tasksMs = durMs;
                }
                markStageLedger(
                  stageLedger,
                  correlationId,
                  jobId,
                  resourceId,
                  "SUMMARY_COMPLETED",
                  "completed",
                  { durationMs: durMs },
                );
                markStageLedger(
                  stageLedger,
                  correlationId,
                  jobId,
                  resourceId,
                  "TASKS_COMPLETED",
                  "completed",
                  {
                    durationMs: durMs,
                    detail: `${res.actionItems?.length || 0} tasks`,
                  },
                );
                liveMilestones.summaryReady = true;
                liveMilestones.tasksReady = true;

                // Immediately persist summary to DB so users see it without waiting for Quiz/Flashcards
                const tsNow = new Date().toISOString();
                if (resourceType === "meeting") {
                  db.update("meetings", (list) =>
                    list.map((m) =>
                      m.id === resourceId
                        ? {
                            ...m,
                            summary: res.summary,
                            executiveSummary: res.executiveSummary || res.summary,
                            detailedSummary: res.detailedSummary || res.summary,
                            keyPoints: res.keyPoints || [],
                            decisions: res.decisions || [],
                            updatedAt: tsNow,
                          }
                        : m,
                    ),
                  );
                } else {
                  db.update("lectures", (list) =>
                    list.map((l) =>
                      l.id === resourceId
                        ? {
                            ...l,
                            studyNotes: res.summary,
                            summary: res.summary,
                            executiveSummary: res.executiveSummary || res.summary,
                            detailedSummary: res.detailedSummary || res.summary,
                            updatedAt: tsNow,
                          }
                        : l,
                    ),
                  );
                }

                bumpParallelPct(
                  "Summary & action items ready — finishing quiz & flashcards...",
                  "الملخص والمهام جاهزان — جاري استكمال الاختبار والبطاقات...",
                  {
                    progressiveSummary: res.executiveSummary || res.summary,
                    progressiveTasks: (res.actionItems || []).slice(0, 8).map((a) => ({
                      title: a.title,
                      ownerName: a.ownerName,
                      dueDate: a.dueDate,
                    })),
                    progressiveTasksCount: res.actionItems?.length || 0,
                  },
                );
                return res;
              },
              "summary",
              60000,
            ),
          () =>
            withStageTimeout(
              () =>
                generateAiLectureAnalysis(title, segments, resourceType, courseCode, appLanguage),
              "deep_analysis",
              45000,
            ),
          () =>
            withStageTimeout(
              async () => {
                const t0 = Date.now();
                const res = await generateAiQuiz(title, segments, undefined, courseCode, {
                  appLanguage,
                  fastFallback: true,
                });
                const durMs = Math.max(1, Date.now() - t0);
                if (sharedTimings) sharedTimings.quizMs = durMs;
                markStageLedger(
                  stageLedger,
                  correlationId,
                  jobId,
                  resourceId,
                  "QUIZ_COMPLETED",
                  "completed",
                  {
                    durationMs: durMs,
                    detail: `${res.questions.length} questions`,
                  },
                );
                liveMilestones.quizReady = true;

                if (res.questions.length > 0) {
                  const tsNow = new Date().toISOString();
                  db.update("quizzes", (quizzes) => [
                    {
                      id: `quiz_${runId}`,
                      ...(resourceType === "meeting"
                        ? { meetingId: resourceId }
                        : { lectureId: resourceId }),
                      title: res.title,
                      courseCode,
                      questions: res.questions,
                      attemptsCount: 0,
                      createdAt: tsNow,
                    },
                    ...quizzes.filter((q) =>
                      resourceType === "meeting"
                        ? q.meetingId !== resourceId
                        : q.lectureId !== resourceId,
                    ),
                  ]);
                }

                bumpParallelPct(
                  `Quiz ready (${res.questions.length} questions)...`,
                  `الاختبار جاهز (${res.questions.length} أسئلة)...`,
                  { progressiveQuizCount: res.questions.length },
                );
                return res;
              },
              "quiz",
              55000,
            ),
          () =>
            withStageTimeout(
              async () => {
                const t0 = Date.now();
                const res = await generateAiFlashcards(
                  title,
                  segments,
                  undefined,
                  courseCode,
                  appLanguage,
                );
                const durMs = Math.max(1, Date.now() - t0);
                if (sharedTimings) sharedTimings.flashcardsMs = durMs;
                markStageLedger(
                  stageLedger,
                  correlationId,
                  jobId,
                  resourceId,
                  "FLASHCARDS_COMPLETED",
                  "completed",
                  {
                    durationMs: durMs,
                    detail: `${res.length} flashcards`,
                  },
                );
                liveMilestones.flashcardsReady = true;

                if (res.length > 0) {
                  const tsNow = new Date().toISOString();
                  db.update("flashcards", (cards) => [
                    ...res.map((c, idx) => ({
                      id: `fc_${runId}_${idx + 1}`,
                      deckId: `deck_${resourceId}`,
                      deckTitle: title.length > 35 ? title.slice(0, 35) + "..." : title,
                      ...(resourceType === "meeting"
                        ? { meetingId: resourceId }
                        : { lectureId: resourceId }),
                      front: c.front,
                      back: c.back,
                      sourceReference: c.sourceReference,
                      topic: c.topic,
                      difficulty: c.difficulty,
                      mastered: false,
                      reviewCount: 0,
                      createdAt: tsNow,
                    })),
                    ...cards.filter((c) =>
                      resourceType === "meeting"
                        ? c.meetingId !== resourceId
                        : c.lectureId !== resourceId,
                    ),
                  ]);
                }

                bumpParallelPct(
                  `Flashcards ready (${res.length} cards)...`,
                  `البطاقات التعليمية جاهزة (${res.length} بطاقة)...`,
                  { progressiveFlashcardsCount: res.length },
                );
                return res;
              },
              "flashcards",
              45000,
            ),
          () =>
            withStageTimeout(
              () => generateAiMindMap(title, segments, undefined, courseCode, appLanguage),
              "mindmap",
              45000,
            ),
        ],
        4,
      )) as [
        PromiseSettledResult<Awaited<ReturnType<typeof generateAiSummary>>>,
        PromiseSettledResult<Awaited<ReturnType<typeof generateAiLectureAnalysis>>>,
        PromiseSettledResult<Awaited<ReturnType<typeof generateAiQuiz>>>,
        PromiseSettledResult<Awaited<ReturnType<typeof generateAiFlashcards>>>,
        PromiseSettledResult<Awaited<ReturnType<typeof generateAiMindMap>>>,
      ];

    if (summarySettled.status === "fulfilled") {
      analysis = summarySettled.value;
      analysisStatus = "Completed";
      analysisRetryable = false;
      analyzedAt = new Date().toISOString();
      notifySync({
        type: "SummaryReady",
        userId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 88,
      });
    } else {
      const reason = summarySettled.reason;
      const status = extractHttpStatus(reason);
      const retryable = isRetryableGeminiError(reason);
      if (retryable) {
        analysisStatus = "Unavailable";
        analysisRetryable = true;
        analysisError =
          status === 503
            ? "التحليل الذكي غير متاح مؤقتاً بسبب الضغط العالي على خوادم الذكاء الاصطناعي (HTTP 503 UNAVAILABLE). النص والتسجيل محفوظان بالكامل ويمكنك إعادة محاولة التحليل دون إعادة التسجيل."
            : status === 429
              ? "تم تجاوز حد الطلبات مؤقتاً (HTTP 429). النص والتسجيل محفوظان، يمكنك إعادة المحاولة بعد لحظات."
              : `التحليل الذكي غير متاح مؤقتاً (${reason instanceof Error ? reason.message : String(reason)}). النص والتسجيل محفوظان، يمكنك إعادة المحاولة.`;
      } else {
        analysisStatus = "Failed";
        analysisRetryable = false;
        analysisError = reason instanceof Error ? reason.message : String(reason);
      }
    }

    deepAnalysis = deepSettled.status === "fulfilled" ? deepSettled.value : undefined;
    generatedQuiz = quizSettled.status === "fulfilled" ? quizSettled.value : undefined;
    generatedCards = cardsSettled.status === "fulfilled" ? cardsSettled.value : [];
    generatedMindMap = mindMapSettled.status === "fulfilled" ? mindMapSettled.value : undefined;
  }

  const geminiAnalysisMs = precomputedUnifiedAnalysis ? 0 : Date.now() - analysisStartedAt;
  if (sharedTimings) {
    sharedTimings.geminiAnalysisMs = geminiAnalysisMs;
    if (precomputedUnifiedAnalysis || geminiAnalysisMs < 15) {
      sharedTimings.analysisCacheHit =
        sharedTimings.analysisCacheHit ?? Boolean(precomputedUnifiedAnalysis);
    }
  }
  logStageTiming(correlationId, "GEMINI_COMPLETE", geminiAnalysisMs, {
    mode: useParallelMode ? "parallel" : "unified",
    provider: sharedTimings?.analysisProvider || "gemini",
    cacheHit: Boolean(sharedTimings?.analysisCacheHit),
  });

  checkCancelled?.();

  // Merge AI-detected important sentences with cue-based highlights (preserving timestamps)
  const highlights = [...cueHighlights];
  if (deepAnalysis?.importantSentences?.length) {
    for (const sentence of deepAnalysis.importantSentences) {
      const cleanSent = String(sentence || "").trim();
      if (!cleanSent) continue;
      const already = highlights.some(
        (h) => h.quote.includes(cleanSent) || cleanSent.includes(h.quote),
      );
      if (!already) {
        const matchedSeg = segments.find(
          (s) => s.text.includes(cleanSent.slice(0, 24)) || cleanSent.includes(s.text.slice(0, 24)),
        );
        const mins = Math.floor((matchedSeg?.startTime || 0) / 60);
        const secs = Math.floor((matchedSeg?.startTime || 0) % 60);
        highlights.push({
          quote: cleanSent,
          context: matchedSeg
            ? `From ${matchedSeg.speaker}`
            : "Identified key sentence from transcript",
          speaker: matchedSeg?.speaker,
          timestamp: `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`,
          category: "ImportantSentence",
          priority: "high",
        });
      }
    }
  }

  if (generatedQuiz && generatedQuiz.questions.length > 0) {
    notifySync({
      type: "QuizReady",
      userId,
      id: resourceId,
      resourceId,
      resourceType,
      jobId,
      progress: 93,
    });
  }

  // Merge tasks from summary + deepAnalysis without fabricating owners/deadlines
  const combinedTasks: Array<{
    title: string;
    ownerName: string;
    dueDate?: string;
    deadlineText: string;
    sourceTimestamp?: string;
    priority: "high" | "medium" | "low";
  }> = [];
  const seenTasks = new Set<string>();

  for (const item of analysis?.actionItems || []) {
    const key = item.title.trim().toLowerCase();
    if (!key || seenTasks.has(key)) continue;
    seenTasks.add(key);
    const deadline =
      item.dueDate && item.dueDate !== "Deadline not specified." ? item.dueDate : "Not specified";
    combinedTasks.push({
      title: item.title.trim(),
      ownerName: item.ownerName && item.ownerName.trim() ? item.ownerName.trim() : "Not specified",
      dueDate: deadline === "Not specified" ? undefined : deadline,
      deadlineText: deadline,
      sourceTimestamp: item.sourceTimestamp,
      priority: item.priority || "medium",
    });
  }
  for (const item of deepAnalysis?.actionItems || []) {
    const taskTitle = (item.task || "").trim();
    const key = taskTitle.toLowerCase();
    if (!key || seenTasks.has(key)) continue;
    seenTasks.add(key);
    const deadline =
      item.deadline && item.deadline !== "Deadline not specified." && item.deadline !== "null"
        ? item.deadline
        : "Not specified";
    combinedTasks.push({
      title: taskTitle,
      ownerName: item.owner && item.owner !== "null" ? item.owner.trim() : "Not specified",
      dueDate: deadline === "Not specified" ? undefined : deadline,
      deadlineText: deadline,
      priority: "medium",
    });
  }

  const now = new Date().toISOString();
  const dbSaveStartedAt = Date.now();
  liveMilestones.completed = true;
  if (combinedTasks.length > 0) liveMilestones.tasksReady = true;
  pushJobProgress({
    status: "Generating Results",
    stage: "GeneratingResults",
    progressPercent: 96,
    progressiveTasksCount: combinedTasks.length,
  });
  logObservabilityEvent("info", "ai_analysis_completed", {
    correlationId,
    jobId,
    resourceId,
    analysisStatus,
    quizQuestionsCount: generatedQuiz?.questions.length || 0,
    flashcardsCount: generatedCards.length,
    tasksCount: combinedTasks.length,
  });

  // STEP 3: Persist Complete Record + Any Derived Intelligence Artifacts
  if (resourceType === "meeting") {
    const targetMeeting = db.get("meetings").find((m) => m.id === resourceId);
    const ownerId = targetMeeting?.hostId || userId || "usr_admin";

    db.update("meetings", (meetings) =>
      meetings.map((m) => {
        if (m.id !== resourceId) return m;
        return {
          ...m,
          status: "Completed",
          transcriptionStatus: "Completed",
          transcriptStatus: "final_verified",
          analysisStatus,
          analysisError,
          analysisRetryable,
          analyzedAt,
          transcriptId: transcriptId || m.transcriptId,
          transcriptionProvider: transcriptionProvider || m.transcriptionProvider,
          asrModel: asrModel || m.asrModel,
          languageConfig: languageConfig || m.languageConfig,
          diarizationEnabled: diarizationEnabled ?? m.diarizationEnabled,
          averageConfidence: averageConfidence ?? m.averageConfidence,
          correlationId,
          speakerBreakdown,
          language,
          durationSeconds: Math.max(1, durationSeconds, m.durationSeconds || 1),
          recordingPath: recordingPath || m.recordingPath,
          recordingFileName: recordingFileName || m.recordingFileName,
          audioUrl: audioUrl || m.audioUrl,
          summary: analysis?.summary,
          executiveSummary: analysis?.executiveSummary || analysis?.summary,
          detailedSummary: analysis?.detailedSummary || analysis?.summary,
          keyPoints: analysis?.keyPoints || [],
          decisions: analysis?.decisions || [],
          topics: deepAnalysis?.topics?.length
            ? deepAnalysis.topics
            : keywords.slice(0, 5).map((k) => k.term),
          keywords,
          highlights,
          analysis: deepAnalysis
            ? {
                overview: deepAnalysis.overview,
                topics: deepAnalysis.topics,
                keywords: deepAnalysis.keywords,
                definitions: deepAnalysis.definitions,
                questionsAsked: deepAnalysis.questionsAsked,
                actionItems: deepAnalysis.actionItems,
                emphasizedPoints: deepAnalysis.emphasizedPoints,
                importantSentences: deepAnalysis.importantSentences,
                reviewAreas: deepAnalysis.reviewAreas,
              }
            : undefined,
          rawTranscript,
          finalTranscript,
          processedTranscript,
          rawSegments,
          fullText,
          segments,
          updatedAt: now,
        };
      }),
    );

    if (combinedTasks.length > 0) {
      db.update("actionItems", (items) => [
        ...items.filter((i) => i.meetingId !== resourceId),
        ...combinedTasks.map((t, idx) => ({
          id: `task_${runId}_${idx + 1}`,
          userId: ownerId,
          meetingId: resourceId,
          title: t.title,
          ownerName: t.ownerName,
          deadlineText: t.deadlineText,
          dueDate: t.dueDate,
          sourceTimestamp: t.sourceTimestamp,
          priority: t.priority,
          completed: false,
          createdAt: now,
        })),
      ]);
      notifySync({
        type: "TasksReady",
        userId: ownerId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 95,
      });
    }

    if (generatedQuiz && generatedQuiz.questions.length > 0) {
      db.update("quizzes", (quizzes) => [
        {
          id: `quiz_${runId}`,
          meetingId: resourceId,
          title: generatedQuiz.title,
          questions: generatedQuiz.questions,
          attemptsCount: 0,
          createdAt: now,
        },
        ...quizzes.filter((q) => q.meetingId !== resourceId),
      ]);
    }

    if (generatedCards && generatedCards.length > 0) {
      db.update("flashcards", (cards) => [
        ...generatedCards.map((c, idx) => ({
          id: `fc_${runId}_${idx + 1}`,
          deckId: `deck_${resourceId}`,
          deckTitle: title.length > 35 ? title.slice(0, 35) + "..." : title,
          meetingId: resourceId,
          front: c.front,
          back: c.back,
          sourceReference: c.sourceReference,
          topic: c.topic,
          difficulty: c.difficulty,
          mastered: false,
          reviewCount: 0,
          createdAt: now,
        })),
        ...cards.filter((c) => c.meetingId !== resourceId),
      ]);
      notifySync({
        type: "FlashcardsReady",
        userId: ownerId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 97,
      });
    }

    if (generatedMindMap) {
      db.update("mindMaps", (maps) => [
        {
          id: `mm_${runId}`,
          title,
          meetingId: resourceId,
          rootNode: generatedMindMap,
          createdAt: now,
        },
        ...maps.filter((m) => m.meetingId !== resourceId),
      ]);
    }
  } else {
    const targetLecture = db.get("lectures").find((l) => l.id === resourceId);
    const ownerId = targetLecture?.instructorId || userId || "usr_admin";

    db.update("lectures", (lectures) =>
      lectures.map((l) => {
        if (l.id !== resourceId) return l;
        return {
          ...l,
          status: "Completed",
          transcriptionStatus: "Completed",
          transcriptStatus: "final_verified",
          analysisStatus,
          analysisError,
          analysisRetryable,
          analyzedAt,
          transcriptId: transcriptId || l.transcriptId,
          transcriptionProvider: transcriptionProvider || l.transcriptionProvider,
          asrModel: asrModel || l.asrModel,
          languageConfig: languageConfig || l.languageConfig,
          diarizationEnabled: diarizationEnabled ?? l.diarizationEnabled,
          averageConfidence: averageConfidence ?? l.averageConfidence,
          correlationId,
          speakerBreakdown,
          language,
          durationSeconds: Math.max(1, durationSeconds, l.durationSeconds || 1),
          recordingPath: recordingPath || l.recordingPath,
          recordingFileName: recordingFileName || l.recordingFileName,
          audioUrl: audioUrl || l.audioUrl,
          studyNotes: analysis?.summary,
          summary: analysis?.summary,
          executiveSummary: analysis?.executiveSummary || analysis?.summary,
          detailedSummary: analysis?.detailedSummary || analysis?.summary,
          keyConcepts: deepAnalysis?.definitions?.length
            ? deepAnalysis.definitions.map((d) => ({ term: d.term, definition: d.definition }))
            : [],
          examHighlights: deepAnalysis?.emphasizedPoints?.length
            ? deepAnalysis.emphasizedPoints
            : analysis?.keyPoints || [],
          topics: deepAnalysis?.topics?.length
            ? deepAnalysis.topics
            : keywords.slice(0, 5).map((k) => k.term),
          keywords,
          highlights,
          analysis: deepAnalysis
            ? {
                overview: deepAnalysis.overview,
                topics: deepAnalysis.topics,
                keywords: deepAnalysis.keywords,
                definitions: deepAnalysis.definitions,
                questionsAsked: deepAnalysis.questionsAsked,
                actionItems: deepAnalysis.actionItems,
                emphasizedPoints: deepAnalysis.emphasizedPoints,
                importantSentences: deepAnalysis.importantSentences,
                reviewAreas: deepAnalysis.reviewAreas,
              }
            : undefined,
          rawTranscript,
          finalTranscript,
          processedTranscript,
          rawSegments,
          fullText,
          segments,
          updatedAt: now,
        };
      }),
    );

    if (generatedQuiz && generatedQuiz.questions.length > 0) {
      db.update("quizzes", (quizzes) => [
        {
          id: `quiz_${runId}`,
          lectureId: resourceId,
          title: generatedQuiz.title,
          courseCode,
          questions: generatedQuiz.questions,
          attemptsCount: 0,
          createdAt: now,
        },
        ...quizzes.filter((q) => q.lectureId !== resourceId),
      ]);
    }

    if (combinedTasks.length > 0) {
      db.update("actionItems", (items) => [
        ...items.filter((i) => i.lectureId !== resourceId),
        ...combinedTasks.map((t, idx) => ({
          id: `task_${runId}_${idx + 1}`,
          userId: ownerId,
          lectureId: resourceId,
          title: t.title,
          ownerName: t.ownerName,
          deadlineText: t.deadlineText,
          dueDate: t.dueDate,
          sourceTimestamp: t.sourceTimestamp,
          priority: t.priority,
          completed: false,
          createdAt: now,
        })),
      ]);
      notifySync({
        type: "TasksReady",
        userId: ownerId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 95,
      });
    }

    if (generatedCards && generatedCards.length > 0) {
      db.update("flashcards", (cards) => [
        ...generatedCards.map((c, idx) => ({
          id: `fc_${runId}_${idx + 1}`,
          deckId: `deck_${resourceId}`,
          deckTitle: title.length > 35 ? title.slice(0, 35) + "..." : title,
          lectureId: resourceId,
          front: c.front,
          back: c.back,
          sourceReference: c.sourceReference,
          topic: c.topic,
          difficulty: c.difficulty,
          mastered: false,
          reviewCount: 0,
          createdAt: now,
        })),
        ...cards.filter((c) => c.lectureId !== resourceId),
      ]);
      notifySync({
        type: "FlashcardsReady",
        userId: ownerId,
        id: resourceId,
        resourceId,
        resourceType,
        jobId,
        progress: 97,
      });
    }

    if (generatedMindMap) {
      db.update("mindMaps", (maps) => [
        {
          id: `mm_${runId}`,
          title,
          lectureId: resourceId,
          rootNode: generatedMindMap,
          createdAt: now,
        },
        ...maps.filter((m) => m.lectureId !== resourceId),
      ]);
    }
  }

  db.update("notifications", (notifs) => [
    {
      id: `notif_${Date.now()}`,
      userId: userId || "usr_admin",
      title:
        resourceType === "meeting" ? "Meeting recording processed" : "Lecture recording processed",
      body:
        analysisStatus === "Completed"
          ? `Processed "${title}" (${segments.length} transcript segments with AI intelligence).`
          : `Processed "${title}" (${segments.length} segments transcribed; AI analysis ${analysisStatus.toLowerCase()}).`,
      targetUrl: `/transcript?id=${resourceId}`,
      read: false,
      type: "summary",
      createdAt: now,
    },
    ...notifs,
  ]);

  if (analysisStatus === "Completed") {
    notifySync({
      type: "AnalysisCompleted",
      userId,
      id: resourceId,
      resourceId,
      resourceType,
      jobId,
      progress: 100,
    });
  } else if (analysisStatus === "Unavailable") {
    notifySync({
      type: "AnalysisUnavailable",
      userId,
      id: resourceId,
      resourceId,
      resourceType,
      jobId,
      error: analysisError,
      retryable: true,
      progress: 100,
    });
  } else {
    notifySync({
      type: "AnalysisFailed",
      userId,
      id: resourceId,
      resourceId,
      resourceType,
      jobId,
      error: analysisError,
      retryable: false,
      progress: 100,
    });
  }

  const dbSaveMs = Date.now() - dbSaveStartedAt;
  if (sharedTimings) {
    sharedTimings.databaseSaveMs = dbSaveMs;
  }
  liveMilestones.databaseSaved = true;
  markStageLedger(stageLedger, correlationId, jobId, resourceId, "DATABASE_SAVED", "completed", {
    durationMs: dbSaveMs,
  });
  logStageTiming(correlationId, "DATABASE_SAVE", dbSaveMs);

  return {
    summary: analysis?.summary,
    executiveSummary: analysis?.executiveSummary,
    detailedSummary: analysis?.detailedSummary,
    keyPoints: analysis?.keyPoints,
    decisions: analysis?.decisions,
    keywordsCount: keywords.length,
    highlightsCount: highlights.length,
    tasksCount: combinedTasks.length,
    quizQuestionsCount: generatedQuiz?.questions.length || 0,
    flashcardsCount: generatedCards.length,
    hasMindMap: Boolean(generatedMindMap),
    transcriptionStatus: "Completed",
    analysisStatus,
    analysisError,
    analysisRetryable,
  };
}
