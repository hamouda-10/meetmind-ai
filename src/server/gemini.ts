import fs from "node:fs";
import path from "node:path";
import { GoogleGenAI } from "@google/genai";

let aiInstance: GoogleGenAI | null = null;
let cachedApiKey: string | null = null;
let envLoaded = false;

function loadEnvFileDirectly(): void {
  if (envLoaded) return;
  envLoaded = true;
  try {
    const envPath = path.resolve(process.cwd(), ".env");
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const eqIdx = trimmed.indexOf("=");
        if (eqIdx > 0) {
          const key = trimmed.slice(0, eqIdx).trim();
          const val = trimmed.slice(eqIdx + 1).trim();
          if (!process.env[key]) {
            process.env[key] = val;
          }
        }
      }
    }
  } catch {
    // best effort
  }
}

function isPlaceholderKey(key: string): boolean {
  const upper = key.toUpperCase();
  return (
    key.length < 20 ||
    upper.includes("MY_GEMINI_API_KEY") ||
    upper.includes("YOUR_API_KEY") ||
    upper.includes("PLACEHOLDER") ||
    upper.includes("REPLACE_ME")
  );
}

export function getResolvedGeminiApiKey(): string | null {
  loadEnvFileDirectly();
  const raw = (process.env.GEMINI_API_KEY || process.env.API_KEY || "").trim();
  if (!raw || isPlaceholderKey(raw)) {
    return null;
  }
  return raw;
}

export function isGeminiConfigured(): boolean {
  return getResolvedGeminiApiKey() !== null;
}

export function getGeminiClient(): GoogleGenAI | null {
  const apiKey = getResolvedGeminiApiKey();
  if (!apiKey) {
    return null;
  }
  if (!aiInstance || cachedApiKey !== apiKey) {
    cachedApiKey = apiKey;
    aiInstance = new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    });
  }
  return aiInstance;
}

export interface GeminiConfig {
  textModel: string;
  fallbackTextModel: string;
  asrModel: string;
  fallbackAsrModel: string;
  maxRetries: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export function getGeminiConfig(): GeminiConfig {
  loadEnvFileDirectly();
  const maxRetries = Math.max(0, parseInt(process.env.GEMINI_MAX_RETRIES || "3", 10));
  const baseDelayMs = Math.max(100, parseInt(process.env.GEMINI_RETRY_BASE_DELAY_MS || "1000", 10));
  const maxDelayMs = Math.max(
    baseDelayMs,
    parseInt(process.env.GEMINI_RETRY_MAX_DELAY_MS || "8000", 10),
  );

  return {
    textModel: (process.env.GEMINI_MODEL || "gemini-3.5-flash").trim(),
    fallbackTextModel: (process.env.GEMINI_FALLBACK_MODEL || "gemini-3.5-flash-lite").trim(),
    asrModel: (process.env.GEMINI_ASR_MODEL || "gemini-3.5-transcribe").trim(),
    fallbackAsrModel: (process.env.GEMINI_ASR_FALLBACK_MODEL || "gemini-3.5-flash").trim(),
    maxRetries: Number.isFinite(maxRetries) ? maxRetries : 3,
    baseDelayMs: Number.isFinite(baseDelayMs) ? baseDelayMs : 1000,
    maxDelayMs: Number.isFinite(maxDelayMs) ? maxDelayMs : 8000,
  };
}

export class GeminiPipelineError extends Error {
  status?: number;
  model: string;
  retryable: boolean;
  operation: string;

  constructor(
    message: string,
    options: { status?: number; model: string; retryable: boolean; operation: string },
  ) {
    super(message);
    this.name = "GeminiPipelineError";
    this.status = options.status;
    this.model = options.model;
    this.retryable = options.retryable;
    this.operation = options.operation;
  }
}

export function extractHttpStatus(err: unknown): number | undefined {
  if (!err || typeof err !== "object") return undefined;
  const e = err as {
    status?: number;
    code?: number;
    response?: { status?: number };
    message?: string;
  };
  if (typeof e.status === "number") return e.status;
  if (typeof e.code === "number") return e.code;
  if (e.response && typeof e.response.status === "number") return e.response.status;
  if (typeof e.message === "string") {
    const codeMatch = e.message.match(/"code":\s*(\d{3})/);
    if (codeMatch) return parseInt(codeMatch[1], 10);
    const statusMatch = e.message.match(/\b(400|401|402|403|404|429|500|502|503|504)\b/);
    if (statusMatch) return parseInt(statusMatch[1], 10);
  }
  return undefined;
}

export function isRetryableGeminiStatus(status?: number): boolean {
  if (!status) return false;
  return status === 429 || status === 503 || status === 500 || status === 502 || status === 504;
}

export function isRetryableGeminiError(err: unknown): boolean {
  const status = extractHttpStatus(err);
  if (isRetryableGeminiStatus(status)) return true;
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    if (
      msg.includes("high demand") ||
      msg.includes("unavailable") ||
      msg.includes("spikes in demand") ||
      msg.includes("rate") ||
      msg.includes("quota") ||
      msg.includes("fetch failed") ||
      msg.includes("econnreset") ||
      msg.includes("etimedout") ||
      msg.includes("timeout") ||
      msg.includes("socket hang up")
    ) {
      return true;
    }
  }
  return false;
}

export function isBillingExhaustionError(err: unknown): boolean {
  const status = extractHttpStatus(err);
  if (status === 402) return true;
  if (err instanceof Error) {
    return /402|prepayment credits|credits are depleted|billing|insufficient quota/i.test(
      err.message,
    );
  }
  return false;
}

export function sanitizeLogText(text: string): string {
  return String(text || "")
    .replace(/AIza[0-9A-Za-z-_]{35}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]")
    .slice(0, 300);
}

export interface GeminiLogEvent {
  level: "info" | "warn" | "error";
  event: string;
  operation: string;
  model: string;
  status?: number;
  attempt?: number;
  maxRetries?: number;
  retryDelayMs?: number;
  finalFailureReason?: string;
  detail?: string;
}

export function logGeminiStructured(evt: GeminiLogEvent): void {
  const entry = {
    timestamp: new Date().toISOString(),
    service: "meetmind-gemini-ai",
    level: evt.level,
    event: evt.event,
    operation: evt.operation,
    model: evt.model,
    status: evt.status,
    attempt: evt.attempt,
    maxRetries: evt.maxRetries,
    retryDelayMs: evt.retryDelayMs,
    finalFailureReason: evt.finalFailureReason
      ? sanitizeLogText(evt.finalFailureReason)
      : undefined,
    detail: evt.detail ? sanitizeLogText(evt.detail) : undefined,
  };
  const json = JSON.stringify(entry);
  if (evt.level === "error") {
    console.error(`[GeminiAI] ${json}`);
  } else if (evt.level === "warn") {
    console.warn(`[GeminiAI] ${json}`);
  } else {
    console.log(`[GeminiAI] ${json}`);
  }
}

export async function executeWithRetryAndFallback<T>(
  operation: string,
  fn: (model: string) => Promise<T>,
  options?: {
    primaryModel?: string;
    fallbackModel?: string;
    maxRetries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
  },
): Promise<{ result: T; modelUsed: string; attemptsMade: number }> {
  const config = getGeminiConfig();
  const primaryModel = options?.primaryModel || config.textModel;
  const fallbackModel = options?.fallbackModel || config.fallbackTextModel;
  const maxRetries = options?.maxRetries ?? config.maxRetries;
  const baseDelayMs = options?.baseDelayMs ?? config.baseDelayMs;
  const maxDelayMs = options?.maxDelayMs ?? config.maxDelayMs;

  const modelsToTry: string[] = [primaryModel];
  if (fallbackModel && fallbackModel !== primaryModel) {
    modelsToTry.push(fallbackModel);
  }

  let lastError: unknown = null;
  let totalAttempts = 0;

  for (let mIdx = 0; mIdx < modelsToTry.length; mIdx++) {
    const currentModel = modelsToTry[mIdx];
    const isPrimary = mIdx === 0;
    const modelMaxAttempts = isPrimary ? maxRetries + 1 : Math.max(2, maxRetries);

    for (let attempt = 0; attempt < modelMaxAttempts; attempt++) {
      totalAttempts++;
      try {
        const result = await fn(currentModel);
        if (totalAttempts > 1) {
          logGeminiStructured({
            level: "info",
            event: "gemini_call_succeeded_after_retry",
            operation,
            model: currentModel,
            attempt: attempt + 1,
            maxRetries: modelMaxAttempts,
            detail: `Operation succeeded on model ${currentModel} after ${totalAttempts} total attempts.`,
          });
        }
        return { result, modelUsed: currentModel, attemptsMade: totalAttempts };
      } catch (err) {
        lastError = err;
        const status = extractHttpStatus(err);
        const retryable = isRetryableGeminiError(err);
        const billing = isBillingExhaustionError(err);
        const errMessage = err instanceof Error ? err.message : String(err);

        // Immediate fail on non-retryable client error (like 400 or 402 billing)
        if (billing || status === 400 || status === 401 || status === 403) {
          logGeminiStructured({
            level: "error",
            event: "gemini_call_non_retryable_failure",
            operation,
            model: currentModel,
            status,
            attempt: attempt + 1,
            finalFailureReason: errMessage,
          });
          throw new GeminiPipelineError(errMessage, {
            status,
            model: currentModel,
            retryable: false,
            operation,
          });
        }

        // If model not found (404), break immediately to try fallback model without wasting retries
        if (status === 404) {
          logGeminiStructured({
            level: "warn",
            event: "gemini_model_not_found",
            operation,
            model: currentModel,
            status: 404,
            detail: `Model ${currentModel} returned 404 Not Found. Transitioning to fallback model if available.`,
          });
          break;
        }

        const hasMoreAttemptsThisModel = attempt < modelMaxAttempts - 1;
        const hasFallbackModelNext = mIdx < modelsToTry.length - 1;

        if (retryable && hasMoreAttemptsThisModel) {
          const exponent = Math.min(attempt, 4);
          const backoff = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, exponent));
          const jitter = Math.floor(Math.random() * (backoff * 0.25));
          const delay = backoff + jitter;

          logGeminiStructured({
            level: "warn",
            event: "gemini_call_retry",
            operation,
            model: currentModel,
            status,
            attempt: attempt + 1,
            maxRetries: modelMaxAttempts,
            retryDelayMs: delay,
            finalFailureReason: errMessage,
          });

          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // If this was the last attempt on the primary model and a fallback model exists
        if (hasFallbackModelNext) {
          logGeminiStructured({
            level: "warn",
            event: "gemini_switching_to_fallback_model",
            operation,
            model: currentModel,
            status,
            detail: `Primary model ${currentModel} unavailable after ${attempt + 1} attempts. Falling back to ${modelsToTry[mIdx + 1]}.`,
            finalFailureReason: errMessage,
          });
          break;
        }
      }
    }
  }

  // If we reach here, all attempts across all models failed
  const finalStatus = extractHttpStatus(lastError);
  const finalMessage =
    lastError instanceof Error ? lastError.message : String(lastError || "Unknown Gemini error");
  const isRetryable = isRetryableGeminiError(lastError);

  logGeminiStructured({
    level: "error",
    event: "gemini_call_all_retries_exhausted",
    operation,
    model: modelsToTry[modelsToTry.length - 1],
    status: finalStatus,
    attempt: totalAttempts,
    finalFailureReason: finalMessage,
  });

  throw new GeminiPipelineError(finalMessage, {
    status: finalStatus,
    model: modelsToTry[modelsToTry.length - 1],
    retryable: isRetryable,
    operation,
  });
}

interface TranscriptionPartLike {
  text?: string;
  audioTranscription?: {
    text?: string;
  };
}

interface TranscriptionResponseLike {
  text?: string;
  candidates?: Array<{
    content?: {
      parts?: TranscriptionPartLike[];
    };
  }>;
}

/**
 * Extracts verbatim transcript text from Gemini responses.
 * Dedicated ASR models like `gemini-3.5-transcribe` return speech output inside
 * non-text `part.audioTranscription.text` blocks while `response.text` is empty.
 */
export function extractGeminiTranscriptText(response: unknown): string {
  const resp = response as TranscriptionResponseLike | null | undefined;
  if (!resp) return "";

  const parts = resp.candidates?.[0]?.content?.parts;
  if (Array.isArray(parts) && parts.length > 0) {
    const audioPieces = parts
      .map((p) => (p?.audioTranscription?.text || "").trim())
      .filter(Boolean);
    if (audioPieces.length > 0) {
      return audioPieces.join(" ").trim();
    }

    const textPieces = parts.map((p) => (p?.text || "").trim()).filter(Boolean);
    if (textPieces.length > 0) {
      return textPieces.join(" ").trim();
    }
  }

  return typeof resp.text === "string" ? resp.text.trim() : "";
}
