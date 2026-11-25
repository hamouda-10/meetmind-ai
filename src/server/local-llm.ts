import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getDataDir } from "./storage";

export type LocalLlmState = "idle" | "loading" | "ready" | "error";

export interface LocalLlmStatus {
  engine: string;
  model: string;
  state: LocalLlmState;
  cachedOnDisk: boolean;
  error?: string;
}

export interface GenerateLocalLlmTextParams {
  systemPrompt: string;
  userPrompt: string;
  maxNewTokens?: number;
  temperature?: number;
  timeoutMs?: number;
}

export interface GenerateLocalLlmJsonParams {
  systemPrompt: string;
  userPrompt: string;
  maxNewTokens?: number;
  timeoutMs?: number;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

type TextGenPipelineFn = (
  input: string | ChatMessage[],
  options?: Record<string, unknown>,
) => Promise<
  Array<{ generated_text?: string | ChatMessage[] }> | { generated_text?: string | ChatMessage[] }
>;

const ENGINE_NAME = "transformers.js-onnx";
const DEFAULT_MODEL_ID = "onnx-community/gemma-3-1b-it-ONNX";
const DEFAULT_DTYPE = "q4";

let currentState: LocalLlmState = "idle";
let lastError: string | undefined;
let cachedPipelinePromise: Promise<TextGenPipelineFn> | null = null;
let cachedModelId: string | null = null;
let cachedDtype: string | null = null;

// Serializes CPU ONNX inference calls so concurrent API requests never thrash threads or OOM
let inferenceQueue: Promise<unknown> = Promise.resolve();

export function getLocalLlmModelId(): string {
  return (process.env.LOCAL_LLM_MODEL || DEFAULT_MODEL_ID).trim();
}

export function getLocalLlmDtype(): string {
  return (process.env.LOCAL_LLM_DTYPE || DEFAULT_DTYPE).trim();
}

export function getLocalLlmCacheDir(): string {
  const candidates = [
    path.join(getDataDir(), "llm-models"),
    path.join(os.tmpdir(), "meetmind-llm-models"),
  ];
  for (const dir of candidates) {
    try {
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    } catch {
      // try next candidate
    }
  }
  return path.join(os.tmpdir(), "meetmind-llm-models");
}

function hasOnnxFilesRecursively(dir: string, depth = 0): boolean {
  if (depth > 3 || !fs.existsSync(dir)) return false;
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isFile() && entry.name.endsWith(".onnx") && !entry.name.includes(".tmp.")) {
        const full = path.join(dir, entry.name);
        const stat = fs.statSync(full);
        // Models with external weights (e.g. Gemma 3 ONNX) store a small .onnx graph alongside .onnx_data
        if (stat.size < 5 * 1024 * 1024) {
          const dataFile = `${full}_data`;
          if (fs.existsSync(dataFile) && fs.statSync(dataFile).size > 10 * 1024 * 1024) {
            return true;
          }
          continue;
        }
        return true;
      }
      if (entry.isDirectory()) {
        if (hasOnnxFilesRecursively(path.join(dir, entry.name), depth + 1)) {
          return true;
        }
      }
    }
  } catch {
    return false;
  }
  return false;
}

export function isLocalLlmCachedOnDisk(modelId = getLocalLlmModelId()): boolean {
  try {
    const cacheDir = getLocalLlmCacheDir();
    const modelDir = path.join(cacheDir, ...modelId.split("/"));
    return hasOnnxFilesRecursively(modelDir);
  } catch {
    return false;
  }
}

function isLocalLlmDisabled(): boolean {
  const flag = (process.env.DISABLE_LOCAL_LLM || "").trim().toLowerCase();
  if (flag === "1" || flag === "true" || flag === "yes") return true;
  // On Vercel serverless without cached model weights, skip remote download so functions stay fast
  if (process.env.VERCEL && !isLocalLlmCachedOnDisk()) return true;
  return false;
}

export function getLocalLlmStatus(): LocalLlmStatus {
  const model = getLocalLlmModelId();
  return {
    engine: ENGINE_NAME,
    model,
    state: currentState,
    cachedOnDisk: isLocalLlmCachedOnDisk(model),
    ...(lastError ? { error: lastError } : {}),
  };
}

async function getLocalLlmPipeline(): Promise<TextGenPipelineFn> {
  if (isLocalLlmDisabled()) {
    throw new Error("Local embedded LLM is disabled in this environment.");
  }

  const modelId = getLocalLlmModelId();
  const dtype = getLocalLlmDtype();

  if (cachedPipelinePromise && cachedModelId === modelId && cachedDtype === dtype) {
    return cachedPipelinePromise;
  }

  cachedModelId = modelId;
  cachedDtype = dtype;
  currentState = "loading";
  lastError = undefined;

  cachedPipelinePromise = (async () => {
    const pkgName = "@huggingface/transformers";
    const transformers = (await import(/* @vite-ignore */ pkgName)) as {
      env?: {
        cacheDir: string;
        allowLocalModels: boolean;
        allowRemoteModels: boolean;
      };
      pipeline: (
        task: string,
        model: string,
        options?: Record<string, unknown>,
      ) => Promise<unknown>;
    };

    const cacheDir = getLocalLlmCacheDir();
    const localModelDir = path.join(cacheDir, ...modelId.split("/"));
    const alreadyCached = isLocalLlmCachedOnDisk(modelId);

    // Do NOT mutate global env.cacheDir or disable env.allowRemoteModels here so
    // concurrent Whisper ASR + Local LLM warmups never race on shared global env state.
    if (transformers.env) {
      transformers.env.allowLocalModels = true;
      transformers.env.allowRemoteModels = true;
    }

    const physicalCores = Math.max(2, Math.min(8, Math.floor(os.cpus().length / 2)));
    const sessionOptions = {
      intraOpNumThreads: physicalCores,
      interOpNumThreads: 1,
      graphOptimizationLevel: "basic",
    };

    const loadPipeline = async (localOnly: boolean) => {
      // In @huggingface/transformers v4, passing the resolved local model directory path
      // directly bypasses global env.cacheDir completely (100% immune to concurrent warmup races).
      const targetModelRef = localOnly && alreadyCached ? localModelDir : modelId;
      return transformers.pipeline("text-generation", targetModelRef, {
        dtype,
        device: "cpu",
        cache_dir: cacheDir,
        local_files_only: localOnly,
        session_options: sessionOptions,
      });
    };

    let gen: unknown;
    if (alreadyCached) {
      try {
        gen = await loadPipeline(true);
      } catch {
        // Incomplete cache — retry allowing remote fetch
        gen = await loadPipeline(false);
      }
    } else {
      gen = await loadPipeline(false);
    }

    currentState = "ready";
    lastError = undefined;
    return gen as TextGenPipelineFn;
  })();

  try {
    return await cachedPipelinePromise;
  } catch (err) {
    cachedPipelinePromise = null;
    cachedModelId = null;
    cachedDtype = null;
    currentState = "error";
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  }
}

export async function warmupLocalLlm(): Promise<void> {
  if (isLocalLlmDisabled()) return;
  try {
    await getLocalLlmPipeline();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LocalLLM] Warmup notice: ${msg}`);
  }
}

function enqueueInference<T>(task: () => Promise<T>): Promise<T> {
  const next = inferenceQueue.then(task, task);
  inferenceQueue = next.then(
    () => undefined,
    () => undefined,
  );
  return next;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T | null>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (!settled) {
        settled = true;
        resolve(null);
      }
    }, timeoutMs);

    promise.then(
      (value) => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(value);
        }
      },
      () => {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          resolve(null);
        }
      },
    );
  });
}

function extractGeneratedReply(output: unknown): string {
  const first = Array.isArray(output) ? output[0] : output;
  if (!first || typeof first !== "object") return "";
  const generated = (first as { generated_text?: unknown }).generated_text;
  if (typeof generated === "string") {
    return generated.trim();
  }
  if (Array.isArray(generated)) {
    for (let i = generated.length - 1; i >= 0; i--) {
      const msg = generated[i] as { role?: string; content?: unknown } | undefined;
      if (msg && msg.role === "assistant" && typeof msg.content === "string") {
        return msg.content.trim();
      }
    }
    const last = generated[generated.length - 1] as { content?: unknown } | undefined;
    if (last && typeof last.content === "string") {
      return last.content.trim();
    }
  }
  return "";
}

const IDENTITY_GUARD_SYSTEM =
  "Identity rule (never violate): You are MeetMind AI, programmed by a team of Software Engineers from the Computer Science Department at Modern Academy (مبرمجني مجموعة من مهندسين برمجة قسم علوم حاسب مودرن أكاديمي). NEVER claim you were created or trained by Google, Gemma, OpenAI, or any other company.";

function trimTruncatedTrailingFragment(text: string): string {
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 60) return trimmed;
  // Never alter JSON-like outputs
  if (/^[[{]/.test(trimmed) || trimmed.includes("```json")) return trimmed;

  // Drop a dangling tiny trailing paragraph/line (e.g. "با" or "أتمنى" after a blank line)
  const paragraphs = trimmed.split(/\n{2,}/);
  if (paragraphs.length >= 2) {
    const lastPara = paragraphs[paragraphs.length - 1].trim();
    const prevPara = paragraphs[paragraphs.length - 2].trim();
    if (
      lastPara.length < 28 &&
      !/[.!؟?:"'»)\]`*]$/.test(lastPara) &&
      /[.!؟?:"'»)\]`*]$/.test(prevPara)
    ) {
      return paragraphs.slice(0, -1).join("\n\n").trim();
    }
  }

  // If the final line is clearly truncated mid-sentence (no terminal punctuation) and we already
  // have a complete sentence earlier in the response, trim cleanly to the last complete sentence.
  if (!/[.!؟?:"'»)\]`*]$/.test(trimmed) && !/\d$/.test(trimmed)) {
    const lastBreak = Math.max(
      trimmed.lastIndexOf("."),
      trimmed.lastIndexOf("؟"),
      trimmed.lastIndexOf("?"),
      trimmed.lastIndexOf("!"),
      trimmed.lastIndexOf("\n"),
    );
    if (lastBreak >= Math.floor(trimmed.length * 0.55)) {
      const candidate = trimmed.slice(0, lastBreak + 1).trim();
      if (candidate.length >= 40) return candidate;
    }
  }

  return trimmed;
}

function sanitizeLlmOutput(text: string, trimTrailing = true): string {
  const cleaned = String(text || "")
    .replace(/<\|im_end\|>/g, "")
    .replace(/<\|endoftext\|>/g, "")
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(
      /(?:I am|I'm)\s+(?:Gemma|a large language model)[^.\n]*(?:trained|created|developed|built)\s+by\s+(?:Google|OpenAI|Meta|Alibaba)[^.\n]*\.?/gi,
      "I am MeetMind AI, programmed by a team of Software Engineers from the Computer Science Department at Modern Academy.",
    )
    .replace(
      /(?:أنا|انا)\s+(?:نموذج\s+لغوي|جيما|Gemma)[^.\n]*(?:طوّرته|طورته|دربته|أنشأته|صممته)\s*(?:جوجل|غوغل|Google|OpenAI)[^.\n]*\.?/gi,
      "أنا مساعد MeetMind AI الذكي، مبرمجني مجموعة من مهندسين برمجة قسم علوم حاسب مودرن أكاديمي.",
    )
    .trim();
  return trimTrailing ? trimTruncatedTrailingFragment(cleaned) : cleaned;
}

export async function generateLocalLlmText(
  params: GenerateLocalLlmTextParams,
): Promise<string | null> {
  if (isLocalLlmDisabled()) return null;

  const {
    systemPrompt,
    userPrompt,
    maxNewTokens = 200,
    temperature = 0,
    timeoutMs = 35000,
  } = params;

  const rawSystem = String(systemPrompt || "").trim();
  const isJsonSystem = /STRICT valid JSON/i.test(rawSystem);
  const effectiveSystem = isJsonSystem
    ? rawSystem
    : rawSystem
      ? `${rawSystem}\n${IDENTITY_GUARD_SYSTEM}`
      : IDENTITY_GUARD_SYSTEM;
  const boundedSystem = effectiveSystem.slice(0, 1800);
  const boundedUser = String(userPrompt || "")
    .trim()
    .slice(0, 5000);
  if (!boundedUser) return null;

  const boundedMaxTokens = Math.min(640, Math.max(32, Math.round(maxNewTokens)));
  const useSampling = typeof temperature === "number" && temperature > 0.05;

  const runWork = enqueueInference(async () => {
    const generator = await getLocalLlmPipeline();
    const messages: ChatMessage[] = [
      ...(boundedSystem ? [{ role: "system" as const, content: boundedSystem }] : []),
      { role: "user" as const, content: boundedUser },
    ];

    const out = await generator(messages, {
      max_new_tokens: boundedMaxTokens,
      do_sample: useSampling,
      ...(useSampling ? { temperature: Math.min(1.0, temperature), top_p: 0.9 } : {}),
      repetition_penalty: 1.1,
      return_full_text: false,
    });

    const cleaned = sanitizeLlmOutput(extractGeneratedReply(out), !isJsonSystem);
    return cleaned || null;
  });

  try {
    return await withTimeout(runWork, timeoutMs);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn(`[LocalLLM] Text generation notice: ${msg}`);
    return null;
  }
}

function tryParseJsonCandidate<T>(candidate: string): T | null {
  const cleaned = candidate.trim();
  if (!cleaned) return null;
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    // Attempt light repair for trailing commas before closing brackets/braces
    try {
      const noTrailingCommas = cleaned.replace(/,\s*([}\]])/g, "$1");
      return JSON.parse(noTrailingCommas) as T;
    } catch {
      return null;
    }
  }
}

function extractBalancedJsonSlice(text: string, openChar: "{" | "["): string | null {
  const closeChar = openChar === "{" ? "}" : "]";
  const start = text.indexOf(openChar);
  if (start === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }

    if (ch === '"') {
      inString = true;
    } else if (ch === openChar) {
      depth++;
    } else if (ch === closeChar) {
      depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
  }

  return null;
}

/**
 * Recovers completed JSON elements if a JSON array was slightly truncated near max_new_tokens.
 */
function tryRecoverTruncatedJsonArray<T>(text: string): T | null {
  const start = text.indexOf("[");
  if (start === -1) return null;
  const sub = text.slice(start);
  let lastGoodClose = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < sub.length; i++) {
    const ch = sub[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[" || ch === "{") depth++;
    else if (ch === "]" || ch === "}") {
      depth--;
      if (depth === 1 && ch === "}") {
        lastGoodClose = i;
      }
    }
  }

  if (lastGoodClose > 0) {
    const repaired = `${sub.slice(0, lastGoodClose + 1)}]`;
    return tryParseJsonCandidate<T>(repaired);
  }
  return null;
}

export function extractJsonFromLlmOutput<T>(rawText: string): T | null {
  if (!rawText) return null;

  const stripped = sanitizeLlmOutput(rawText)
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Also check fenced block inside prose
  const fenceMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    const fencedParsed = tryParseJsonCandidate<T>(fenceMatch[1]);
    if (fencedParsed !== null) return fencedParsed;
  }

  const direct = tryParseJsonCandidate<T>(stripped);
  if (direct !== null) return direct;

  // Determine whether object or array appears first
  const objIdx = stripped.indexOf("{");
  const arrIdx = stripped.indexOf("[");
  const order: Array<"{" | "["> =
    arrIdx !== -1 && (objIdx === -1 || arrIdx < objIdx) ? ["[", "{"] : ["{", "["];

  for (const opener of order) {
    const slice = extractBalancedJsonSlice(stripped, opener);
    if (slice) {
      const parsed = tryParseJsonCandidate<T>(slice);
      if (parsed !== null) return parsed;
    }
  }

  // Last resort: recover completed items from a slightly truncated JSON array
  if (arrIdx !== -1) {
    const recovered = tryRecoverTruncatedJsonArray<T>(stripped);
    if (recovered !== null) return recovered;
  }

  return null;
}

export async function generateLocalLlmJson<T>(
  params: GenerateLocalLlmJsonParams,
): Promise<T | null> {
  const { systemPrompt, userPrompt, maxNewTokens = 440, timeoutMs = 45000 } = params;

  const strictSystem = `${systemPrompt.trim()}\nRespond with STRICT valid JSON only. No markdown fences, no commentary, no extra text.`;

  const raw = await generateLocalLlmText({
    systemPrompt: strictSystem,
    userPrompt,
    maxNewTokens,
    temperature: 0,
    timeoutMs,
  });

  if (!raw) return null;
  return extractJsonFromLlmOutput<T>(raw);
}
