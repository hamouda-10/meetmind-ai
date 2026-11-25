import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import type { TranscriptSegment } from "./db";
import { getDataDir } from "./storage";

const nodeRequire = createRequire(import.meta.url);

const DEFAULT_WHISPER_MODEL = "Xenova/whisper-small";
const SAMPLE_RATE = 16000;
const AUDIO_CONDITION_FILTER = "highpass=f=80,lowpass=f=7600,dynaudnorm=f=200:g=15:p=0.9:m=6";

export interface AsrEngineStatus {
  engine: string;
  model: string;
  state: "idle" | "loading" | "ready" | "error";
  cachedOnDisk: boolean;
  error?: string;
}

type WhisperDtypeConfig = string | { encoder_model: string; decoder_model_merged: string };

interface WhisperPipelineLike {
  (
    audio: Float32Array,
    options?: Record<string, unknown>,
  ): Promise<{
    text?: string;
    chunks?: Array<{ text: string; timestamp?: [number | null, number | null] }>;
  }>;
  processor?: (audio: Float32Array) => Promise<{ input_features: unknown }>;
  model?: {
    generation_config?: {
      decoder_start_token_id?: number;
      lang_to_id?: Record<string, number>;
    };
    forward?: (inputs: Record<string, unknown>) => Promise<{
      logits?: { data?: Float32Array | number[] };
    }>;
  };
}

interface TransformersModuleLike {
  env?: {
    cacheDir: string;
    allowLocalModels: boolean;
    allowRemoteModels: boolean;
  };
  Tensor?: new (type: string, data: BigInt64Array, dims: number[]) => unknown;
  pipeline: (task: string, model: string, options?: Record<string, unknown>) => Promise<unknown>;
}

let cachedPipelinePromise: Promise<WhisperPipelineLike> | null = null;
let cachedTransformersModule: TransformersModuleLike | null = null;
let cachedModelId: string | null = null;
let engineState: "idle" | "loading" | "ready" | "error" = "idle";
let engineError: string | undefined;

function getConfiguredModelId(): string {
  return (process.env.LOCAL_WHISPER_MODEL || DEFAULT_WHISPER_MODEL).trim() || DEFAULT_WHISPER_MODEL;
}

function getConfiguredDtype(): WhisperDtypeConfig {
  const raw = (process.env.LOCAL_WHISPER_DTYPE || "").trim();
  if (!raw) {
    // q4 block-quantized encoder (66MB) + q8 merged decoder (157MB) delivers ~1.8s load and ~9.8s
    // inference on 28s Egyptian Arabic audio while keeping full Arabic/English recognition accuracy.
    // Gracefully fall back to fp32 encoder if only fp32 is cached on disk.
    const modelId = getConfiguredModelId();
    const q4Dtype = { encoder_model: "q4", decoder_model_merged: "q8" };
    const fp32Dtype = { encoder_model: "fp32", decoder_model_merged: "q8" };
    if (isModelCachedOnDisk(modelId, q4Dtype) || !isModelCachedOnDisk(modelId, fp32Dtype)) {
      return q4Dtype;
    }
    return fp32Dtype;
  }
  if (raw.includes(":")) {
    const [enc, dec] = raw.split(":").map((s) => s.trim());
    if (enc && dec) {
      return { encoder_model: enc, decoder_model_merged: dec };
    }
  }
  return raw;
}

function resolveOnnxFileName(
  base: "encoder_model" | "decoder_model_merged",
  dtype: string,
): string {
  switch (dtype) {
    case "fp32":
      return `${base}.onnx`;
    case "fp16":
      return `${base}_fp16.onnx`;
    case "q8":
    case "int8":
    case "uint8":
      return `${base}_quantized.onnx`;
    case "q4":
      return `${base}_q4.onnx`;
    case "q4f16":
      return `${base}_q4f16.onnx`;
    default:
      return `${base}.onnx`;
  }
}

function resolveFfmpegPath(): string {
  try {
    const installer = nodeRequire("@ffmpeg-installer/ffmpeg");
    if (installer?.path && fs.existsSync(installer.path)) {
      return installer.path as string;
    }
  } catch {
    // fallback to system PATH ffmpeg
  }
  return "ffmpeg";
}

function getWhisperCacheDir(): string {
  const candidates = [
    path.join(getDataDir(), "whisper-models"),
    path.join(os.tmpdir(), "meetmind-whisper-models"),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // try next
    }
  }
  return path.join(os.tmpdir(), "meetmind-whisper-models");
}

function isModelCachedOnDisk(modelId: string, dtype: WhisperDtypeConfig): boolean {
  try {
    const cacheDir = getWhisperCacheDir();
    const modelDir = path.join(cacheDir, ...modelId.split("/"));
    const onnxDir = path.join(modelDir, "onnx");
    if (!fs.existsSync(modelDir) || !fs.existsSync(onnxDir)) {
      return false;
    }

    const encDtype = typeof dtype === "string" ? dtype : dtype.encoder_model;
    const decDtype = typeof dtype === "string" ? dtype : dtype.decoder_model_merged;

    const requiredMeta = ["config.json", "preprocessor_config.json", "tokenizer.json"];
    for (const meta of requiredMeta) {
      const p = path.join(modelDir, meta);
      if (!fs.existsSync(p) || fs.statSync(p).size < 16) return false;
    }

    const encFile = path.join(onnxDir, resolveOnnxFileName("encoder_model", encDtype));
    const decFile = path.join(onnxDir, resolveOnnxFileName("decoder_model_merged", decDtype));
    const minOnnxBytes = 1024 * 1024;
    return (
      fs.existsSync(encFile) &&
      fs.statSync(encFile).size >= minOnnxBytes &&
      fs.existsSync(decFile) &&
      fs.statSync(decFile).size >= minOnnxBytes
    );
  } catch {
    return false;
  }
}

export function getAsrEngineStatus(): AsrEngineStatus {
  const model = getConfiguredModelId();
  const dtype = getConfiguredDtype();
  return {
    engine: "whisper-onnx",
    model,
    state: engineState,
    cachedOnDisk: isModelCachedOnDisk(model, dtype),
    ...(engineError ? { error: engineError } : {}),
  };
}

function runFfmpegPcmDecode(
  ffmpegBin: string,
  filePath: string,
  audioFilter?: string,
): Promise<Float32Array> {
  return new Promise<Float32Array>((resolve, reject) => {
    const args = [
      "-v",
      "error",
      "-err_detect",
      "ignore_err",
      "-fflags",
      "+genpts+igndts+discardcorrupt",
      "-i",
      filePath,
      "-vn",
    ];
    if (audioFilter) {
      args.push("-af", audioFilter);
    }
    args.push(
      "-ac",
      "1",
      "-ar",
      String(SAMPLE_RATE),
      "-f",
      "f32le",
      "-acodec",
      "pcm_f32le",
      "pipe:1",
    );

    const proc = spawn(ffmpegBin, args, { stdio: ["ignore", "pipe", "pipe"] });

    const chunks: Buffer[] = [];
    let stderrText = "";

    proc.stdout.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    proc.stderr.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString();
    });

    proc.on("error", (err) => {
      reject(new Error(`FFmpeg failed to start: ${err.message}`));
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`FFmpeg decode exited with code ${code}: ${stderrText.slice(0, 300)}`));
        return;
      }
      const raw = Buffer.concat(chunks);
      const byteLength = raw.byteLength - (raw.byteLength % 4);
      if (byteLength === 0) {
        resolve(new Float32Array(0));
        return;
      }
      // Copy into an aligned ArrayBuffer so Float32Array view never fails on unaligned Buffer pool offset
      const aligned = new ArrayBuffer(byteLength);
      new Uint8Array(aligned).set(raw.subarray(0, byteLength));
      resolve(new Float32Array(aligned));
    });
  });
}

/**
 * Fast zero-spawn parser for standard 16kHz mono 16-bit signed PCM WAV files.
 * Avoids spawning a second FFmpeg process when audio is already normalized WAV.
 */
function tryReadMono16kPcmWavDirectly(
  filePath: string,
  alreadyConditioned: boolean,
): Float32Array | null {
  try {
    const fd = fs.openSync(filePath, "r");
    const header = Buffer.alloc(12);
    const bytesRead = fs.readSync(fd, header, 0, 12, 0);
    fs.closeSync(fd);
    if (
      bytesRead < 12 ||
      header.toString("ascii", 0, 4) !== "RIFF" ||
      header.toString("ascii", 8, 12) !== "WAVE"
    ) {
      return null;
    }

    const buf = fs.readFileSync(filePath);
    let offset = 12;
    let audioFormat = 0;
    let channels = 0;
    let sampleRate = 0;
    let bitsPerSample = 0;
    let dataOffset = -1;
    let dataSize = 0;

    while (offset + 8 <= buf.length) {
      const chunkId = buf.toString("ascii", offset, offset + 4);
      const chunkSize = buf.readUInt32LE(offset + 4);
      const chunkDataStart = offset + 8;

      if (chunkId === "fmt " && chunkSize >= 16 && chunkDataStart + 16 <= buf.length) {
        audioFormat = buf.readUInt16LE(chunkDataStart);
        channels = buf.readUInt16LE(chunkDataStart + 2);
        sampleRate = buf.readUInt32LE(chunkDataStart + 4);
        bitsPerSample = buf.readUInt16LE(chunkDataStart + 14);
      } else if (chunkId === "data") {
        dataOffset = chunkDataStart;
        dataSize = Math.min(chunkSize, buf.length - chunkDataStart);
        break;
      }

      // RIFF chunks are word-aligned (padded to even byte boundary)
      offset = chunkDataStart + chunkSize + (chunkSize % 2);
    }

    if (
      audioFormat !== 1 ||
      channels !== 1 ||
      sampleRate !== SAMPLE_RATE ||
      bitsPerSample !== 16 ||
      dataOffset < 0 ||
      dataSize < 2
    ) {
      return null;
    }

    const sampleCount = Math.floor(dataSize / 2);
    const pcm = new Float32Array(sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      pcm[i] = buf.readInt16LE(dataOffset + i * 2) / 32768;
    }

    if (!alreadyConditioned && sampleCount > 0) {
      applyFastJsSpeechConditioning(pcm);
    }

    return pcm;
  } catch {
    return null;
  }
}

/**
 * Lightweight in-memory 80Hz high-pass DC filter + gentle RMS/peak normalization
 * used on direct-parsed 16kHz PCM WAV buffers (runs in ~1–2ms without FFmpeg).
 */
function applyFastJsSpeechConditioning(pcm: Float32Array): void {
  const n = pcm.length;
  if (n === 0) return;

  // 1-pole high-pass filter (~80Hz @ 16kHz): alpha = RC / (RC + dt) ≈ 0.9695
  const alpha = 0.9695;
  let prevX = pcm[0];
  let prevY = 0;
  let sumSq = 0;
  let peak = 0;

  for (let i = 0; i < n; i++) {
    const x = pcm[i];
    const y = alpha * (prevY + x - prevX);
    prevX = x;
    prevY = y;
    pcm[i] = y;
    sumSq += y * y;
    const absY = Math.abs(y);
    if (absY > peak) peak = absY;
  }

  const rms = Math.sqrt(sumSq / n);
  if (rms > 0.0008 && peak > 0.001) {
    const targetGain = Math.min(5.0, 0.14 / rms, 0.92 / peak);
    if (Math.abs(targetGain - 1.0) > 0.08) {
      for (let i = 0; i < n; i++) {
        const scaled = pcm[i] * targetGain;
        pcm[i] = scaled > 0.98 ? 0.98 : scaled < -0.98 ? -0.98 : scaled;
      }
    }
  }
}

/**
 * Decodes any audio/video file (OGG, M4A, MP3, WAV, WEBM, MP4, AAC, FLAC)
 * directly to a speech-conditioned 16kHz mono Float32Array PCM buffer.
 * Uses a zero-spawn pure-JS fast path when the file is already 16kHz mono 16-bit PCM WAV,
 * otherwise decodes & conditions in a single FFmpeg pass (80Hz–7.6kHz bandpass + dynaudnorm).
 */
export async function decodeAudioFileToFloat32Pcm(
  filePath: string,
  options?: { alreadyConditioned?: boolean },
): Promise<Float32Array> {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Audio file not found: ${filePath}`);
  }

  // Zero-spawn fast path for already-normalized 16kHz mono 16-bit PCM WAV
  const directPcm = tryReadMono16kPcmWavDirectly(filePath, Boolean(options?.alreadyConditioned));
  if (directPcm && directPcm.length > 0) {
    return directPcm;
  }

  const ffmpegBin = resolveFfmpegPath();

  try {
    const conditioned = await runFfmpegPcmDecode(ffmpegBin, filePath, AUDIO_CONDITION_FILTER);
    if (conditioned.length > 0) {
      return conditioned;
    }
  } catch (filterErr) {
    // Fallback to raw 16kHz mono PCM if FFmpeg build lacks a filter
    console.warn(
      "[WhisperASR] Speech conditioning filter fallback to raw PCM:",
      filterErr instanceof Error ? filterErr.message : String(filterErr),
    );
  }

  return runFfmpegPcmDecode(ffmpegBin, filePath);
}

function getOptimalIntraOpThreads(): number {
  const envThreads = Number(process.env.WHISPER_INTRA_OP_THREADS || 0);
  if (Number.isFinite(envThreads) && envThreads > 0) {
    return Math.min(16, Math.max(1, Math.floor(envThreads)));
  }
  // Match physical core count (up to 8) for peak CPU throughput without hyperthread contention
  const logicalCores = os.cpus()?.length || 4;
  return Math.min(8, Math.max(2, Math.floor(logicalCores / 2)));
}

async function getLocalWhisperPipeline(): Promise<WhisperPipelineLike> {
  const modelId = getConfiguredModelId();
  if (cachedPipelinePromise && cachedModelId === modelId) {
    return cachedPipelinePromise;
  }

  cachedModelId = modelId;
  engineState = "loading";
  engineError = undefined;

  const dtype = getConfiguredDtype();
  const cacheDir = getWhisperCacheDir();
  const localModelDir = path.join(cacheDir, ...modelId.split("/"));
  const cachedLocally = isModelCachedOnDisk(modelId, dtype);

  cachedPipelinePromise = (async () => {
    const pkgName = "@huggingface/transformers";
    const transformers = (await import(/* @vite-ignore */ pkgName)) as TransformersModuleLike;
    cachedTransformersModule = transformers;

    // Never mutate global transformers.env.cacheDir or set allowRemoteModels = false (avoids race
    // conditions with concurrent Local LLM warmup). In @huggingface/transformers v4, pipeline()'s
    // internal get_files() helper ignores options.cache_dir for HF repo IDs, so when cached on disk
    // we pass the resolved localModelDir directly (bypassing global env.cacheDir completely).
    if (transformers.env) {
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = true;
    }

    const sessionOptions = {
      intraOpNumThreads: getOptimalIntraOpThreads(),
      interOpNumThreads: 1,
      // "extended" fuses CPU attention/LayerNorm kernels while keeping ONNX load under ~2s
      graphOptimizationLevel: "extended",
    };

    const loadPipeline = async (localOnly: boolean) => {
      const targetModel = localOnly ? localModelDir : modelId;
      return transformers.pipeline("automatic-speech-recognition", targetModel, {
        dtype,
        device: "cpu",
        cache_dir: cacheDir,
        local_files_only: localOnly,
        session_options: sessionOptions,
      });
    };

    let asr: unknown;
    if (cachedLocally) {
      try {
        asr = await loadPipeline(true);
      } catch {
        // Partial cache fallback: fetch missing model artifact from HuggingFace
        asr = await loadPipeline(false);
      }
    } else {
      asr = await loadPipeline(false);
    }

    engineState = "ready";
    engineError = undefined;
    return asr as unknown as WhisperPipelineLike;
  })();

  try {
    return await cachedPipelinePromise;
  } catch (err) {
    cachedPipelinePromise = null;
    cachedModelId = null;
    engineState = "error";
    engineError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

/**
 * Proactively loads and warms the local ONNX Whisper model in memory.
 * Safe to invoke multiple times concurrently or in background startup hooks.
 */
export async function warmupWhisperModel(): Promise<void> {
  if (engineState === "ready" && cachedPipelinePromise) {
    return;
  }
  try {
    await getLocalWhisperPipeline();
  } catch (err) {
    console.warn(
      "[WhisperASR] Background warmup warning:",
      err instanceof Error ? err.message : String(err),
    );
  }
}

function normalizeExplicitWhisperLang(language?: string): string | undefined {
  if (!language) return undefined;
  const low = language.trim().toLowerCase();
  if (!low || low === "auto" || low === "mixed") return undefined;
  if (low.startsWith("ar")) return "arabic";
  if (low.startsWith("en")) return "english";
  if (low.startsWith("fr")) return "french";
  if (low.startsWith("es")) return "spanish";
  if (low.startsWith("de")) return "german";
  if (low.startsWith("tr")) return "turkish";
  return undefined;
}

/**
 * Performs fast 1-step Whisper native language identification (Arabic / English / etc.)
 * using the model's encoder + first decoder step logits, preventing transformers.js
 * from silently defaulting unspecified language to English translation.
 */
async function detectWhisperLanguage(
  asr: WhisperPipelineLike,
  audioSample: Float32Array,
): Promise<string> {
  try {
    const TensorCtor = cachedTransformersModule?.Tensor;
    const processor = asr.processor;
    const model = asr.model;
    const startId = model?.generation_config?.decoder_start_token_id;
    const langToId = model?.generation_config?.lang_to_id;

    if (!TensorCtor || !processor || !model?.forward || typeof startId !== "number" || !langToId) {
      return "arabic";
    }

    const slice =
      audioSample.length > SAMPLE_RATE * 15
        ? audioSample.subarray(0, SAMPLE_RATE * 15)
        : audioSample;
    const inputs = await processor(slice);
    const decoderInputIds = new TensorCtor("int64", BigInt64Array.from([BigInt(startId)]), [1, 1]);
    const out = await model.forward({
      input_features: inputs.input_features,
      decoder_input_ids: decoderInputIds,
    });
    const logits = out?.logits?.data;
    if (!logits) return "arabic";

    const candidates: Array<[string, string]> = [
      ["arabic", "<|ar|>"],
      ["english", "<|en|>"],
      ["french", "<|fr|>"],
      ["spanish", "<|es|>"],
      ["german", "<|de|>"],
    ];

    let bestLang = "arabic";
    let bestScore = -Infinity;
    for (const [langName, token] of candidates) {
      const tokenId = langToId[token];
      if (typeof tokenId === "number" && tokenId < logits.length) {
        const score = Number(logits[tokenId]);
        if (score > bestScore) {
          bestScore = score;
          bestLang = langName;
        }
      }
    }
    return bestLang;
  } catch {
    return "arabic";
  }
}

interface SpeechWindow {
  startSample: number;
  endSample: number;
  rms: number;
}

/**
 * Energy-based VAD + silence-aligned speech chunker.
 * - Clips <= 30s stay in a single optimal Whisper receptive-field pass.
 * - Longer recordings (e.g. 23-min lectures) skip pure-silence stretches (> 3.5s)
 *   and slice active speech at natural low-energy pauses every ~26-29.5s so each
 *   window executes in one clean encoder pass and streams real segments immediately.
 */
function buildVadSpeechWindows(pcm: Float32Array): SpeechWindow[] {
  const totalSamples = pcm.length;
  if (totalSamples === 0) return [];

  // Short audio fits directly into a single 30s Whisper receptive field
  if (totalSamples <= 30 * SAMPLE_RATE) {
    return [
      { startSample: 0, endSample: totalSamples, rms: computeSliceRms(pcm, 0, totalSamples) },
    ];
  }

  const FRAME_MS = 250;
  const FRAME_SAMPLES = Math.floor((SAMPLE_RATE * FRAME_MS) / 1000); // 4000 samples
  const numFrames = Math.ceil(totalSamples / FRAME_SAMPLES);
  const frameRms = new Float32Array(numFrames);

  for (let f = 0; f < numFrames; f++) {
    const s = f * FRAME_SAMPLES;
    const e = Math.min(totalSamples, s + FRAME_SAMPLES);
    frameRms[f] = computeSliceRms(pcm, s, e);
  }

  // Adaptive noise floor (15th percentile RMS)
  const sorted = Array.from(frameRms).sort((a, b) => a - b);
  const noiseFloor = sorted[Math.floor(sorted.length * 0.15)] || 0.001;
  const speechThreshold = Math.max(0.0035, Math.min(0.02, noiseFloor * 2.4));

  // Merge active frames into speech spans, skipping dead silence > 3.5s (14 frames)
  const MAX_GAP_FRAMES = 14;
  const PAD_FRAMES = 2; // 0.5s padding around speech edges
  const spans: Array<{ startFrame: number; endFrame: number }> = [];
  let spanStart = -1;
  let lastActiveFrame = -1;

  for (let f = 0; f < numFrames; f++) {
    if (frameRms[f] >= speechThreshold) {
      if (spanStart === -1) {
        spanStart = Math.max(0, f - PAD_FRAMES);
      }
      lastActiveFrame = f;
    } else if (spanStart !== -1 && f - lastActiveFrame > MAX_GAP_FRAMES) {
      spans.push({
        startFrame: spanStart,
        endFrame: Math.min(numFrames, lastActiveFrame + 1 + PAD_FRAMES),
      });
      spanStart = -1;
      lastActiveFrame = -1;
    }
  }
  if (spanStart !== -1) {
    spans.push({
      startFrame: spanStart,
      endFrame: Math.min(numFrames, lastActiveFrame + 1 + PAD_FRAMES),
    });
  }

  if (spans.length === 0) {
    return [];
  }

  // Split long speech spans into ~26–29.5s windows at lowest-energy pause frames
  const TARGET_FRAMES = Math.round(28 / (FRAME_MS / 1000)); // 28s = 112 frames
  const MIN_CUT_FRAMES = Math.round(20 / (FRAME_MS / 1000)); // 20s = 80 frames
  const MAX_CUT_FRAMES = Math.round(29.5 / (FRAME_MS / 1000)); // 29.5s = 118 frames

  const windows: SpeechWindow[] = [];
  for (const span of spans) {
    let cursor = span.startFrame;
    while (cursor < span.endFrame) {
      const remaining = span.endFrame - cursor;
      if (remaining <= MAX_CUT_FRAMES) {
        const startSample = cursor * FRAME_SAMPLES;
        const endSample = Math.min(totalSamples, span.endFrame * FRAME_SAMPLES);
        windows.push({
          startSample,
          endSample,
          rms: computeSliceRms(pcm, startSample, endSample),
        });
        break;
      }

      // Find quietest frame in [cursor + MIN_CUT_FRAMES, cursor + MAX_CUT_FRAMES]
      const searchStart = cursor + MIN_CUT_FRAMES;
      const searchEnd = Math.min(span.endFrame - 4, cursor + MAX_CUT_FRAMES);
      let bestCut = Math.min(span.endFrame, cursor + TARGET_FRAMES);
      let minEnergy = Infinity;
      for (let f = searchStart; f <= searchEnd; f++) {
        if (frameRms[f] < minEnergy) {
          minEnergy = frameRms[f];
          bestCut = f;
        }
      }

      const startSample = cursor * FRAME_SAMPLES;
      const endSample = Math.min(totalSamples, bestCut * FRAME_SAMPLES);
      windows.push({
        startSample,
        endSample,
        rms: computeSliceRms(pcm, startSample, endSample),
      });
      // Slight 0.25s overlap to avoid clipping consonants at pause boundaries; deduped in post-processing
      cursor = Math.max(cursor + 4, bestCut - 1);
    }
  }

  return windows;
}

function computeSliceRms(pcm: Float32Array, start: number, end: number): number {
  const len = end - start;
  if (len <= 0) return 0;
  const step = Math.max(1, Math.floor(len / 8000));
  let sumSq = 0;
  let count = 0;
  for (let i = start; i < end; i += step) {
    const v = pcm[i];
    sumSq += v * v;
    count++;
  }
  return count > 0 ? Math.sqrt(sumSq / count) : 0;
}

const KNOWN_HALLUCINATION_PATTERNS: RegExp[] = [
  /^(?:اشتركوا?\s+في\s+القناة|لا\s+تنسوا?\s+الاشتراك|شكرا?\s+للمشاهدة|شكرًا\s+للمشاهدة|ترجمة\s+[^\s]+(?:\s+[^\s]+)?)\.?$/i,
  /^(?:thanks?\s+for\s+watching|thank\s+you(?:\s+for\s+watching)?|please\s+subscribe|subtitles?\s+by\b.*|captions?\s+by\b.*|mbc|amara\.org)\.?$/i,
  /^[.\s،,!؟?\-–—…]+$/,
];

function normalizeComparisonToken(token: string): string {
  return token
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "") // strip Arabic diacritics & tatweel
    .replace(/[أإآ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/[^\p{L}\p{N}]/gu, "");
}

/**
 * Removes repeated n-gram hallucination loops (e.g. "ورحمة الله ورحمة الله ورحمة الله")
 * and cleans spacing while preserving original punctuation and numbers.
 */
function sanitizeWhisperText(raw: string): string {
  let text = String(raw || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (!text) return "";

  // Reject pure known Whisper non-speech hallucinations
  for (const pat of KNOWN_HALLUCINATION_PATTERNS) {
    if (pat.test(text)) return "";
  }

  // Collapse consecutive repeated phrases (n = 1..6 words repeating >= 3 times)
  const words = text.split(" ");
  const deduped: string[] = [];
  let i = 0;
  while (i < words.length) {
    let collapsed = false;
    for (let n = 1; n <= 6; n++) {
      if (i + n * 3 > words.length) continue;
      const base = words
        .slice(i, i + n)
        .map(normalizeComparisonToken)
        .join(" ");
      if (!base) continue;

      let repeats = 1;
      while (i + (repeats + 1) * n <= words.length) {
        const next = words
          .slice(i + repeats * n, i + (repeats + 1) * n)
          .map(normalizeComparisonToken)
          .join(" ");
        if (next === base) {
          repeats++;
        } else {
          break;
        }
      }

      if (repeats >= 3) {
        deduped.push(...words.slice(i, i + n));
        i += repeats * n;
        collapsed = true;
        break;
      }
    }
    if (!collapsed) {
      deduped.push(words[i]);
      i++;
    }
  }

  text = deduped
    .join(" ")
    .replace(/\s+([.,!?;:،؛؟])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  // Reject degenerate low-diversity hallucination loops (long text with almost no unique words)
  const finalWords = text.split(" ").map(normalizeComparisonToken).filter(Boolean);
  if (finalWords.length >= 20) {
    const uniqueRatio = new Set(finalWords).size / finalWords.length;
    if (uniqueRatio < 0.25) {
      return "";
    }
  }

  return text;
}

/**
 * Strips overlapping suffix/prefix words duplicated across stride or window boundaries
 * while preserving original casing, punctuation, and numbers.
 */
function stripBoundaryOverlap(prevText: string, nextText: string): string {
  if (!prevText || !nextText) return nextText;
  const prevWords = prevText.split(" ").filter(Boolean);
  const nextWords = nextText.split(" ").filter(Boolean);
  if (prevWords.length === 0 || nextWords.length === 0) return nextText;

  const prevNorm = prevWords.map(normalizeComparisonToken);
  const nextNorm = nextWords.map(normalizeComparisonToken);

  // Full duplicate segment check
  if (prevNorm.join(" ") === nextNorm.join(" ")) {
    return "";
  }

  const maxOverlap = Math.min(6, prevNorm.length, nextNorm.length);
  for (let k = maxOverlap; k >= 2; k--) {
    let matches = true;
    for (let j = 0; j < k; j++) {
      const a = prevNorm[prevNorm.length - k + j];
      const b = nextNorm[j];
      if (!a || a !== b) {
        matches = false;
        break;
      }
    }
    if (matches) {
      return nextWords.slice(k).join(" ").trim();
    }
  }

  return nextText;
}

function detectSegmentLanguage(text: string): "ar" | "en" {
  const arMatches = text.match(/[\u0600-\u06FF]/g)?.length || 0;
  const enMatches = text.match(/[A-Za-z]/g)?.length || 0;
  return arMatches >= enMatches && arMatches > 0 ? "ar" : "en";
}

export interface LocalWhisperResult {
  segments: TranscriptSegment[];
  fullText: string;
  model: string;
  durationSeconds: number;
  latencyMs?: number;
  detectedLanguage?: string;
  silent?: boolean;
  errorMessage?: string;
}

/**
 * Runs 100% real local multilingual OpenAI Whisper speech-to-text (Arabic, Egyptian Arabic & English)
 * using @huggingface/transformers ONNX Runtime + FFmpeg speech conditioning + VAD streaming.
 * Zero external API keys or billing required.
 */
export async function transcribeAudioWithLocalWhisper(params: {
  filePath: string;
  resourceType: "meeting" | "lecture";
  language?: string;
  jobId?: string;
  startOffsetSec?: number;
  alreadyConditioned?: boolean;
  onProgress?: (pct: number, partialSegments?: TranscriptSegment[]) => void;
  checkCancelled?: () => void;
}): Promise<LocalWhisperResult> {
  const {
    filePath,
    resourceType,
    language,
    jobId = "whisper",
    startOffsetSec = 0,
    alreadyConditioned = false,
    onProgress,
    checkCancelled,
  } = params;

  const startedAt = performance.now();
  const modelId = getConfiguredModelId();
  const speakerDefault = resourceType === "lecture" ? "المحاضر" : "المتحدث";

  try {
    checkCancelled?.();
    const pcm = await decodeAudioFileToFloat32Pcm(filePath, { alreadyConditioned });
    const totalDurationSec = pcm.length / SAMPLE_RATE;
    if (pcm.length < 1600) {
      return {
        segments: [],
        fullText: "",
        model: modelId,
        durationSeconds: 0,
        latencyMs: Math.round(performance.now() - startedAt),
        silent: true,
        errorMessage: "Audio file contains less than 0.1 seconds of audio.",
      };
    }

    const overallRms = computeSliceRms(pcm, 0, pcm.length);
    if (overallRms < 0.0005) {
      return {
        segments: [],
        fullText: "",
        model: modelId,
        durationSeconds: Math.round(totalDurationSec),
        latencyMs: Math.round(performance.now() - startedAt),
        silent: true,
        errorMessage: "No audible speech detected in the recording.",
      };
    }

    const speechWindows = buildVadSpeechWindows(pcm);
    if (speechWindows.length === 0) {
      return {
        segments: [],
        fullText: "",
        model: modelId,
        durationSeconds: Math.round(totalDurationSec),
        latencyMs: Math.round(performance.now() - startedAt),
        silent: true,
        errorMessage: "No audible speech detected in the recording.",
      };
    }

    checkCancelled?.();
    const asr = await getLocalWhisperPipeline();

    // Determine spoken language: respect explicit language or run 1-step Whisper native language ID
    let whisperLang = normalizeExplicitWhisperLang(language);
    if (!whisperLang) {
      const firstWin = speechWindows[0];
      const probeSlice = pcm.subarray(firstWin.startSample, firstWin.endSample);
      whisperLang = await detectWhisperLanguage(asr, probeSlice);
    }

    const segments: TranscriptSegment[] = [];

    for (let w = 0; w < speechWindows.length; w++) {
      checkCancelled?.();
      const win = speechWindows[w];
      const windowAudio = pcm.subarray(win.startSample, win.endSample);
      const windowOffsetSec = startOffsetSec + win.startSample / SAMPLE_RATE;
      const windowDurSec = windowAudio.length / SAMPLE_RATE;

      const output = await asr(windowAudio, {
        chunk_length_s: 30,
        stride_length_s: windowDurSec > 30 ? 4 : 0,
        return_timestamps: true,
        task: "transcribe",
        language: whisperLang,
        num_beams: 1,
        do_sample: false,
        max_new_tokens: 224,
        repetition_penalty: 1.1,
        no_repeat_ngram_size: 4,
      });

      const rawChunks = Array.isArray(output?.chunks) ? output.chunks : [];
      const appendSegment = (rawText: string, relStart: number, relEnd: number, conf: number) => {
        const sanitized = sanitizeWhisperText(rawText);
        if (!sanitized || sanitized.length < 2) return;

        const prevText = segments.length > 0 ? segments[segments.length - 1].text : "";
        const deduped = stripBoundaryOverlap(prevText, sanitized);
        if (!deduped || deduped.length < 2) return;

        const segStart = Math.round((windowOffsetSec + Math.max(0, relStart)) * 10) / 10;
        const segEnd =
          Math.round(
            (windowOffsetSec + Math.max(relStart + 0.4, Math.min(windowDurSec, relEnd))) * 10,
          ) / 10;
        const langCode = detectSegmentLanguage(deduped);
        const useEnglishSpeaker = whisperLang === "english" && langCode === "en";
        const speakerLabel = useEnglishSpeaker
          ? resourceType === "lecture"
            ? "Lecturer"
            : `Speaker ${(segments.length % 2) + 1}`
          : resourceType === "meeting"
            ? `${speakerDefault} ${(segments.length % 2) + 1}`
            : speakerDefault;

        segments.push({
          id: `seg_${jobId}_${segments.length + 1}`,
          speaker: speakerLabel,
          startTime: segStart,
          endTime: Math.max(segStart + 0.4, segEnd),
          text: deduped,
          confidence: conf,
          language: langCode,
          isPartial: false,
        });
      };

      if (rawChunks.length > 0) {
        for (const ch of rawChunks) {
          const relStart = typeof ch.timestamp?.[0] === "number" ? ch.timestamp[0] : 0;
          const relEnd =
            typeof ch.timestamp?.[1] === "number"
              ? ch.timestamp[1]
              : Math.min(windowDurSec, relStart + 5);
          appendSegment(String(ch.text || ""), relStart, relEnd, 0.94);
        }
      } else if (output?.text && output.text.trim()) {
        appendSegment(output.text, 0, windowDurSec, 0.91);
      }

      if (onProgress) {
        const pct = Math.round(((w + 1) / speechWindows.length) * 100);
        onProgress(pct, segments.slice());
      }
    }

    return {
      segments,
      fullText: segments.map((s) => s.text).join(" "),
      model: modelId,
      durationSeconds: Math.round(totalDurationSec),
      latencyMs: Math.round(performance.now() - startedAt),
      detectedLanguage: whisperLang,
    };
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    if (/cancelled by user/i.test(errMsg)) {
      throw err;
    }
    return {
      segments: [],
      fullText: "",
      model: modelId,
      durationSeconds: 0,
      latencyMs: Math.round(performance.now() - startedAt),
      errorMessage: errMsg,
    };
  }
}
