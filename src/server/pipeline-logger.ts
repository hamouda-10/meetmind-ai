import crypto from "node:crypto";

export type PipelineEventName =
  | "upload_started"
  | "upload_completed"
  | "transcription_started"
  | "transcription_completed"
  | "ai_analysis_started"
  | "ai_analysis_completed"
  | "quiz_generation_started"
  | "quiz_generation_completed"
  | "n8n_request_started"
  | "n8n_request_completed"
  | "n8n_request_failed"
  | "assemblyai_failed"
  | "gemini_failed"
  | "database_failed"
  | "transcript_cache_hit"
  | "analysis_cache_hit"
  | "stage_timing"
  | "result_ready";

export type CanonicalPipelineStage =
  | "UPLOAD"
  | "ASSEMBLYAI_UPLOAD"
  | "TRANSCRIPTION_STARTED"
  | "TRANSCRIPTION_PROCESSING"
  | "TRANSCRIPTION_COMPLETED"
  | "TRANSCRIPT_RECEIVED"
  | "AI_ANALYSIS_STARTED"
  | "SUMMARY_COMPLETED"
  | "KEYWORDS_COMPLETED"
  | "TASKS_COMPLETED"
  | "QUIZ_COMPLETED"
  | "FLASHCARDS_COMPLETED"
  | "DATABASE_SAVED"
  | "JOB_COMPLETED";

export interface StageTelemetryEntry {
  stage: CanonicalPipelineStage | string;
  status: "pending" | "running" | "completed" | "failed";
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  detail?: string;
  error?: string;
}

export interface StageTimings {
  uploadMs?: number;
  validationMs?: number;
  n8nWebhookMs?: number;
  assemblyAiUploadMs?: number;
  transcriptionMs?: number;
  pollingWaitMs?: number;
  pollCount?: number;
  transcriptFetchMs?: number;
  webhookTriggered?: boolean;
  geminiAnalysisMs?: number;
  summaryMs?: number;
  keywordsMs?: number;
  tasksMs?: number;
  quizMs?: number;
  flashcardsMs?: number;
  databaseSaveMs?: number;
  firstResultMs?: number;
  totalMs?: number;
  transcriptCacheHit?: boolean;
  analysisCacheHit?: boolean;
  pipelineMode?: "direct" | "n8n" | "local" | "cache";
  audioHash?: string;
  transcriptHash?: string;
  analysisHash?: string;
  transcriptionProvider?: string;
  analysisProvider?: string;
}

export function formatSeconds(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "0.00s";
  return `${(ms / 1000).toFixed(2)}s`;
}

export function logStageTiming(
  correlationId: string,
  stageLabel: string,
  durationMs?: number,
  extra?: Record<string, unknown>,
): void {
  const suffix = typeof durationMs === "number" ? `: ${formatSeconds(durationMs)}` : "";
  console.info(`[${correlationId}] ${stageLabel}${suffix}`);
  logObservabilityEvent("info", "stage_timing", {
    correlationId,
    stage: stageLabel,
    ...(typeof durationMs === "number" ? { durationMs } : {}),
    ...(extra || {}),
  });
}

export function createCorrelationId(prefix = "mm"): string {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(4).toString("hex")}`;
}

export function redactSensitiveText(input: unknown): string {
  return String(input ?? "")
    .replace(/AIza[0-9A-Za-z_-]{20,}/g, "[REDACTED_GEMINI_KEY]")
    .replace(/AQ\.[0-9A-Za-z_-]{20,}/g, "[REDACTED_API_KEY]")
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED_TOKEN]")
    .replace(
      /(authorization|x-goog-api-key|api[_-]?key|password|secret)["']?\s*[:=]\s*["']?[^\s"',}]+/gi,
      "$1=[REDACTED]",
    )
    .replace(/\b[0-9a-f]{32}\b/gi, (match) =>
      // Preserve common MD5/UUID-like short hashes only if clearly prefixed; redact raw 32-char AssemblyAI tokens
      match.length === 32 ? "[REDACTED_HEX_TOKEN]" : match,
    )
    .slice(0, 500);
}

function sanitizeDetails(details: Record<string, unknown>): Record<string, unknown> {
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(details)) {
    if (/key|token|secret|password|authorization/i.test(k)) {
      safe[k] = "[REDACTED]";
    } else if (typeof v === "string") {
      safe[k] = redactSensitiveText(v);
    } else if (v instanceof Error) {
      safe[k] = redactSensitiveText(v.message);
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

export function logObservabilityEvent(
  level: "info" | "warn" | "error",
  event: PipelineEventName | string,
  details: Record<string, unknown> & { correlationId?: string },
): void {
  const payload = {
    timestamp: new Date().toISOString(),
    service: "meetmind-ai-pipeline",
    level,
    event,
    correlationId: details.correlationId || createCorrelationId("corr"),
    ...sanitizeDetails(details),
  };
  const serialized = JSON.stringify(payload);
  if (level === "error") {
    console.error(`[MeetMind] ${serialized}`);
  } else if (level === "warn") {
    console.warn(`[MeetMind] ${serialized}`);
  } else {
    console.info(`[MeetMind] ${serialized}`);
  }
}
