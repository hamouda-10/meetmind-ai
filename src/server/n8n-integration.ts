import fs from "node:fs";
import path from "node:path";
import type { TranscriptSegment } from "./db";
import { computeSpeakerBreakdown, type AssemblyAiSpeakerStat } from "./assemblyai";
import { logObservabilityEvent, logStageTiming, redactSensitiveText } from "./pipeline-logger";
import { getProviderSecret } from "./provider-secrets";
import { formatTranscriptNonDestructive, normalizeSpeakerLabel } from "./transcript-format";

export interface N8nIntegrationConfig {
  configured: boolean;
  webhookUrl: string;
  isLocalhost: boolean;
  isProductionVercel: boolean;
  usableInCurrentEnv: boolean;
  fallbackToDirect: boolean;
  timeoutMs: number;
  hostLabel: string;
  reason?: string;
}

export interface N8nQuizQuestion {
  id: string;
  question: string;
  type: "multiple_choice" | "true_false";
  options: string[];
  correctOptionIndex: number;
  correctAnswerText: string;
  explanation: string;
  difficulty: "easy" | "medium" | "hard";
  sectionRef: string;
  timestampRef?: string;
  sourceReference?: string;
  sourceTranscriptSegment?: string;
  groundingVerified: boolean;
}

export interface N8nEssayQuestion {
  question: string;
  modelAnswer?: string;
  sourceReference?: string;
}

export interface N8nFlashcard {
  front: string;
  back: string;
  topic?: string;
  difficulty?: "easy" | "medium" | "hard";
  sourceReference?: string;
}

export interface N8nActionItem {
  title: string;
  ownerName?: string;
  dueDate?: string;
  priority: "high" | "medium" | "low";
}

export interface N8nWorkflowResult {
  provider: "n8n";
  transcript: {
    id?: string;
    text: string;
    rawText?: string;
    language: string;
    asrModel?: string;
    averageConfidence?: number;
    diarizationEnabled?: boolean;
    segments: TranscriptSegment[];
    rawSegments?: TranscriptSegment[];
    durationSeconds: number;
  };
  analysis: {
    summary: string;
    keyPoints: string[];
    importantSentences: string[];
    topics: string[];
    keywords: string[];
    decisions: string[];
    actionItems: N8nActionItem[];
    deadlines: string[];
    examHints: string[];
    notes: string[];
    speakerBreakdown: AssemblyAiSpeakerStat[];
    quiz: N8nQuizQuestion[];
    essayQuestions: N8nEssayQuestion[];
    flashcards: N8nFlashcard[];
  };
  htmlReport?: string;
  stageTimings?: {
    assemblyAiUploadMs?: number;
    transcriptionMs?: number;
    pollingWaitMs?: number;
    pollCount?: number;
    transcriptFetchMs?: number;
    geminiAnalysisMs?: number;
  };
  latencyMs: number;
}

export class N8nIntegrationError extends Error {
  readonly status?: number;
  readonly retryable: boolean;
  readonly category: string;

  constructor(
    message: string,
    opts: { status?: number; retryable?: boolean; category?: string } = {},
  ) {
    super(message);
    this.name = "N8nIntegrationError";
    this.status = opts.status;
    this.retryable = opts.retryable ?? true;
    this.category = opts.category || "N8nUnavailable";
  }
}

function isLocalHostname(hostname: string): boolean {
  const h = hostname.toLowerCase();
  return h === "localhost" || h === "127.0.0.1" || h === "::1" || h === "0.0.0.0";
}

/**
 * Inspects N8N_WEBHOOK_URL cleanly without ever hard-coding a local webhook URL.
 * Automatically blocks localhost URLs when running in deployed Vercel serverless production.
 */
export function getN8nConfig(): N8nIntegrationConfig {
  const rawUrl = (process.env.N8N_WEBHOOK_URL || getProviderSecret("N8N_WEBHOOK_URL") || "").trim();
  const isProductionVercel = Boolean(process.env.VERCEL || process.env.VERCEL_ENV === "production");
  const fallbackToDirect = process.env.N8N_FALLBACK_TO_DIRECT === "true";
  const timeoutMs = Math.max(
    15_000,
    Math.min(300_000, Number(process.env.N8N_TIMEOUT_MS || 180_000)),
  );

  if (!rawUrl) {
    return {
      configured: false,
      webhookUrl: "",
      isLocalhost: false,
      isProductionVercel,
      usableInCurrentEnv: false,
      fallbackToDirect: true,
      timeoutMs,
      hostLabel: "unconfigured",
    };
  }

  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return {
        configured: true,
        webhookUrl: "",
        isLocalhost: false,
        isProductionVercel,
        usableInCurrentEnv: false,
        fallbackToDirect,
        timeoutMs,
        hostLabel: "invalid-protocol",
        reason: "N8N_WEBHOOK_URL must use http:// or https://.",
      };
    }

    const local = isLocalHostname(parsed.hostname);
    if (isProductionVercel && local) {
      return {
        configured: true,
        webhookUrl: rawUrl,
        isLocalhost: true,
        isProductionVercel: true,
        usableInCurrentEnv: false,
        fallbackToDirect,
        timeoutMs,
        hostLabel: parsed.host,
        reason:
          "N8N_WEBHOOK_URL points to localhost, which is unreachable from deployed Vercel functions. Set N8N_WEBHOOK_URL to your hosted HTTPS n8n webhook.",
      };
    }

    return {
      configured: true,
      webhookUrl: rawUrl,
      isLocalhost: local,
      isProductionVercel,
      usableInCurrentEnv: true,
      fallbackToDirect,
      timeoutMs,
      hostLabel: parsed.host,
    };
  } catch {
    return {
      configured: true,
      webhookUrl: "",
      isLocalhost: false,
      isProductionVercel,
      usableInCurrentEnv: false,
      fallbackToDirect,
      timeoutMs,
      hostLabel: "invalid-url",
      reason: "N8N_WEBHOOK_URL is not a valid URL.",
    };
  }
}

function stripHtmlTags(html: string): string {
  return String(html || "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function extractListLines(raw: string): string[] {
  return String(raw || "")
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, "").trim())
    .filter((line) => line.length >= 2 && !/^none\.?$|^لا يوجد\.?$/i.test(line));
}

function normalizeForGrounding(text: string): string {
  return String(text || "")
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670]/g, "")
    .replace(/[إأآا]/g, "ا")
    .replace(/ى/g, "ي")
    .replace(/ة/g, "ه")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isQuestionGroundedInText(
  question: string,
  answerText: string,
  transcriptNorm: string,
): boolean {
  if (!transcriptNorm || transcriptNorm.length < 10) return false;
  const combined = normalizeForGrounding(`${question} ${answerText}`);
  const tokens = combined.split(" ").filter((t) => t.length >= 3 || /\d/.test(t));
  if (tokens.length === 0) return false;
  const matched = tokens.filter((t) => transcriptNorm.includes(t));
  return matched.length / tokens.length >= 0.25;
}

function parseMcqSection(
  rawSection: string,
  transcriptNorm: string,
  isArabic: boolean,
): N8nQuizQuestion[] {
  const results: N8nQuizQuestion[] = [];
  const seen = new Set<string>();
  const lines = String(rawSection || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  let currentQ = "";
  let currentOpts: string[] = [];
  let correctLetter = "";

  const flush = () => {
    if (!currentQ || currentOpts.length < 4) {
      currentQ = "";
      currentOpts = [];
      correctLetter = "";
      return;
    }
    const uniqueOpts = Array.from(new Set(currentOpts.map((o) => o.trim()).filter(Boolean))).slice(
      0,
      4,
    );
    if (uniqueOpts.length !== 4) {
      currentQ = "";
      currentOpts = [];
      correctLetter = "";
      return;
    }
    const letterMap: Record<string, number> = { a: 0, b: 1, c: 2, d: 3, أ: 0, ب: 1, ج: 2, د: 3 };
    const idx = letterMap[correctLetter.toLowerCase()] ?? 0;
    const correctIdx = idx >= 0 && idx < 4 ? idx : 0;
    const normQ = normalizeForGrounding(currentQ);
    if (
      !seen.has(normQ) &&
      isQuestionGroundedInText(currentQ, uniqueOpts[correctIdx], transcriptNorm)
    ) {
      seen.add(normQ);
      results.push({
        id: `q_n8n_mcq_${Date.now()}_${results.length + 1}`,
        question: currentQ,
        type: "multiple_choice",
        options: uniqueOpts,
        correctOptionIndex: correctIdx,
        correctAnswerText: uniqueOpts[correctIdx],
        explanation: isArabic
          ? "سؤال مستخلص وموثق من نص التسجيل عبر خط معالجة n8n وGemini."
          : "Grounded multiple-choice question verified against the recording transcript.",
        difficulty: "medium",
        sectionRef: isArabic ? "محاور التسجيل" : "Recording Transcript",
        groundingVerified: true,
      });
    }
    currentQ = "";
    currentOpts = [];
    correctLetter = "";
  };

  for (const line of lines) {
    const clean = line.replace(/\*\*/g, "").trim();
    const qMatch = clean.match(/^\d+[.)]\s+(.+)$/);
    if (qMatch && !/^[A-D]\)/i.test(qMatch[1])) {
      flush();
      currentQ = qMatch[1].trim();
      continue;
    }
    const optMatch = clean.match(/^(?:[-*•]\s*)?([A-Dأبجد])[).:]\s+(.+)$/i);
    if (optMatch && currentQ) {
      currentOpts.push(optMatch[2].trim());
      continue;
    }
    const ansMatch = clean.match(
      /(?:Correct Answer|Answer|الإجابة الصحيحة|الإجابة)\s*[:：]\s*([A-Dأبجد])/i,
    );
    if (ansMatch && currentQ) {
      correctLetter = ansMatch[1].trim();
    }
  }
  flush();
  return results;
}

function parseTrueFalseSection(
  rawSection: string,
  transcriptNorm: string,
  isArabic: boolean,
): N8nQuizQuestion[] {
  const results: N8nQuizQuestion[] = [];
  const seen = new Set<string>();
  const lines = String(rawSection || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\*\*/g, "").trim())
    .filter(Boolean);

  let currentStmt = "";
  for (const line of lines) {
    const qMatch = line.match(/^\d+[.)]\s+(.+)$/);
    if (qMatch) {
      currentStmt = qMatch[1].trim();
      continue;
    }
    const ansMatch = line.match(
      /(?:Answer|Correct Answer|الإجابة)\s*[:：]\s*(True|False|صح|صواب|خطأ)/i,
    );
    if (ansMatch && currentStmt) {
      const isTrue = /^(true|صح|صواب)$/i.test(ansMatch[1].trim());
      const normQ = normalizeForGrounding(currentStmt);
      if (!seen.has(normQ) && isQuestionGroundedInText(currentStmt, "", transcriptNorm)) {
        seen.add(normQ);
        const options = isArabic ? ["صح", "خطأ"] : ["True", "False"];
        const correctIdx = isTrue ? 0 : 1;
        results.push({
          id: `q_n8n_tf_${Date.now()}_${results.length + 1}`,
          question: currentStmt,
          type: "true_false",
          options,
          correctOptionIndex: correctIdx,
          correctAnswerText: options[correctIdx],
          explanation: isArabic
            ? "عبارة صح/خطأ موثقة مباشرة من نص التسجيل."
            : "True/False statement grounded directly in the recording transcript.",
          difficulty: "easy",
          sectionRef: isArabic ? "محاور التسجيل" : "Recording Transcript",
          groundingVerified: true,
        });
      }
      currentStmt = "";
    }
  }
  return results;
}

function parseFlashcardsSection(rawSection: string): N8nFlashcard[] {
  const cards: N8nFlashcard[] = [];
  const lines = String(rawSection || "")
    .split(/\r?\n/)
    .map((l) => l.replace(/\*\*/g, "").trim())
    .filter(Boolean);

  let front = "";
  for (const line of lines) {
    const qMatch = line.match(/^(?:\d+[.)]\s*)?(?:Q|س|Question|السؤال)\s*[:：]\s*(.+)$/i);
    if (qMatch) {
      front = qMatch[1].trim();
      continue;
    }
    const aMatch = line.match(/^(?:A|ج|Answer|الإجابة)\s*[:：]\s*(.+)$/i);
    if (aMatch && front) {
      cards.push({
        front,
        back: aMatch[1].trim(),
        difficulty: "medium",
      });
      front = "";
    }
  }
  return cards;
}

function buildSegmentsFromTranscriptPayload(params: {
  text: string;
  utterances?: unknown;
  resourceType: "meeting" | "lecture";
  jobId: string;
  language: string;
}): TranscriptSegment[] {
  const { text, utterances, resourceType, jobId, language } = params;
  const isMeeting = resourceType === "meeting";

  let parsedUtterances: Array<{
    speaker?: string;
    text?: string;
    start?: number;
    end?: number;
    startTime?: number;
    endTime?: number;
    confidence?: number;
  }> = [];

  if (Array.isArray(utterances)) {
    parsedUtterances = utterances;
  } else if (typeof utterances === "string" && utterances.trim().startsWith("[")) {
    try {
      const p = JSON.parse(utterances);
      if (Array.isArray(p)) parsedUtterances = p;
    } catch {
      // fall through to text parsing
    }
  }

  if (parsedUtterances.length > 0) {
    const valid = parsedUtterances
      .filter((u) => u && String(u.text || "").trim())
      .map((u, idx) => {
        const startSec =
          typeof u.startTime === "number"
            ? u.startTime
            : typeof u.start === "number"
              ? Math.round((u.start / 1000) * 10) / 10
              : idx * 6;
        const endSec =
          typeof u.endTime === "number"
            ? u.endTime
            : typeof u.end === "number"
              ? Math.round((u.end / 1000) * 10) / 10
              : startSec + 5;
        return {
          id: `seg_n8n_${jobId}_${idx + 1}`,
          speaker: normalizeSpeakerLabel(u.speaker ? String(u.speaker) : undefined, {
            resourceType,
          }),
          startTime: startSec,
          endTime: Math.max(startSec + 1, endSec),
          text: formatTranscriptNonDestructive(String(u.text).trim()),
          confidence: typeof u.confidence === "number" ? u.confidence : 0.94,
          language,
          isPartial: false,
        };
      });
    if (valid.length > 0) return valid;
  }

  const cleanText = String(text || "").trim();
  if (!cleanText) return [];

  const lines = cleanText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const segments: TranscriptSegment[] = [];

  for (let i = 0; i < lines.length; i++) {
    const speakerMatch = lines[i].match(/^([^:：]{2,36})\s*[:：]\s*(.+)$/);
    if (speakerMatch) {
      segments.push({
        id: `seg_n8n_${jobId}_${i + 1}`,
        speaker: speakerMatch[1].trim(),
        startTime: i * 8,
        endTime: (i + 1) * 8,
        text: speakerMatch[2].trim(),
        confidence: 0.92,
        language,
        isPartial: false,
      });
    } else {
      const subSentences = lines[i]
        .split(/(?<=[.!؟?])\s+/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const sent of subSentences) {
        const idx = segments.length;
        segments.push({
          id: `seg_n8n_${jobId}_${idx + 1}`,
          speaker: isMeeting ? "Speaker 1" : "Lecturer",
          startTime: idx * 7,
          endTime: (idx + 1) * 7,
          text: sent,
          confidence: 0.91,
          language,
          isPartial: false,
        });
      }
    }
  }

  return segments;
}

function parse13SectionMarkdown(
  markdown: string,
  fallbackTranscriptText: string,
  resourceType: "meeting" | "lecture",
  jobId: string,
): Omit<N8nWorkflowResult, "provider" | "latencyMs" | "htmlReport"> {
  const sections: Record<number, string> = {};
  const parts = String(markdown || "").split(/(?=^#{1,2}\s*\d+\.\s*)/m);
  for (const part of parts) {
    const m = part.match(/^#{1,2}\s*(\d+)\.\s*[^\n]*\n?([\s\S]*)$/);
    if (m) {
      sections[parseInt(m[1], 10)] = (m[2] || "").trim();
    }
  }

  const transcriptText = (fallbackTranscriptText || sections[13] || "").trim();
  const isArabic = /[\u0600-\u06FF]/.test(transcriptText || markdown);
  const language = isArabic ? "ar" : "en";
  const segments = buildSegmentsFromTranscriptPayload({
    text: transcriptText,
    resourceType,
    jobId,
    language,
  });
  const transcriptNorm = normalizeForGrounding(
    segments.map((s) => s.text).join(" ") || transcriptText,
  );

  const mcq = parseMcqSection(sections[4] || "", transcriptNorm, isArabic);
  const tf = parseTrueFalseSection(sections[5] || "", transcriptNorm, isArabic);
  const quiz = [...mcq, ...tf].slice(0, 20);
  const essayQuestions = extractListLines(sections[6] || "").map((q) => ({ question: q }));
  const flashcards = parseFlashcardsSection(sections[7] || "");
  const notes = extractListLines(sections[8] || "");
  const actionItems = extractListLines(sections[9] || "").map((title) => ({
    title,
    priority: "medium" as const,
  }));
  const deadlines = extractListLines(sections[10] || "");
  const examHints = extractListLines(sections[11] || "");

  return {
    transcript: {
      text: transcriptText,
      language,
      segments,
      durationSeconds: Math.max(10, segments[segments.length - 1]?.endTime || 10),
    },
    analysis: {
      summary: (sections[1] || "").trim(),
      keyPoints: notes.slice(0, 8),
      importantSentences: examHints.slice(0, 6),
      topics: extractListLines(sections[2] || ""),
      keywords: extractListLines(sections[3] || ""),
      decisions: [],
      actionItems,
      deadlines,
      examHints,
      notes,
      speakerBreakdown: computeSpeakerBreakdown(segments),
      quiz,
      essayQuestions,
      flashcards,
    },
  };
}

function parse13SectionHtml(
  html: string,
  fallbackTranscriptText: string,
  resourceType: "meeting" | "lecture",
  jobId: string,
): Omit<N8nWorkflowResult, "provider" | "latencyMs"> {
  const getSectionText = (id: string): string => {
    const rx = new RegExp(
      `<div[^>]*class=["']section["'][^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/div>(?=\\s*<div[^>]*class=["']section["']|\\s*<\\/div>\\s*<div[^>]*class=["']footer["'])`,
      "i",
    );
    const m = html.match(rx);
    if (!m?.[1]) return "";
    // Remove section h2 header before converting to plain lines
    const withoutTitle = m[1].replace(/<h2[^>]*>[\s\S]*?<\/h2>/i, "");
    return stripHtmlTags(withoutTitle);
  };

  const summary = getSectionText("summary");
  const topics = extractListLines(getSectionText("topics"));
  const keywords = extractListLines(getSectionText("keywords"));
  const transcriptText = (fallbackTranscriptText || getSectionText("transcript")).trim();
  const isArabic = /[\u0600-\u06FF]/.test(transcriptText || summary);
  const language = isArabic ? "ar" : "en";
  const segments = buildSegmentsFromTranscriptPayload({
    text: transcriptText,
    resourceType,
    jobId,
    language,
  });
  const transcriptNorm = normalizeForGrounding(
    segments.map((s) => s.text).join(" ") || transcriptText,
  );

  const mcq = parseMcqSection(getSectionText("mcq"), transcriptNorm, isArabic);
  const tf = parseTrueFalseSection(getSectionText("tf"), transcriptNorm, isArabic);
  const quiz = [...mcq, ...tf].slice(0, 20);
  const essayQuestions = extractListLines(getSectionText("essay")).map((q) => ({ question: q }));
  const flashcards = parseFlashcardsSection(getSectionText("flashcards"));
  const notes = extractListLines(getSectionText("notes"));
  const actionItems = extractListLines(getSectionText("actions")).map((title) => ({
    title,
    priority: "medium" as const,
  }));
  const deadlines = extractListLines(getSectionText("deadlines"));
  const examHints = extractListLines(getSectionText("hints"));

  return {
    transcript: {
      text: transcriptText,
      language,
      segments,
      durationSeconds: Math.max(10, segments[segments.length - 1]?.endTime || 10),
    },
    analysis: {
      summary,
      keyPoints: notes.slice(0, 8),
      importantSentences: examHints.slice(0, 6),
      topics,
      keywords,
      decisions: [],
      actionItems,
      deadlines,
      examHints,
      notes,
      speakerBreakdown: computeSpeakerBreakdown(segments),
      quiz,
      essayQuestions,
      flashcards,
    },
    htmlReport: html,
  };
}

function validateStructuredQuizItems(
  rawItems: unknown[],
  transcriptNorm: string,
  isArabic: boolean,
): N8nQuizQuestion[] {
  const valid: N8nQuizQuestion[] = [];
  const seen = new Set<string>();

  for (const raw of rawItems) {
    if (!raw || typeof raw !== "object") continue;
    if (valid.length >= 20) break;
    const item = raw as Record<string, unknown>;
    const question = String(item.question || "").trim();
    if (question.length < 8) continue;
    const normQ = normalizeForGrounding(question);
    if (seen.has(normQ)) continue;

    const rawType = String(item.type || "multiple_choice").toLowerCase();
    const qType: "multiple_choice" | "true_false" =
      rawType === "true_false" || rawType === "tf" ? "true_false" : "multiple_choice";

    let options: string[] = [];
    let correctOptionIndex =
      typeof item.correctOptionIndex === "number" ? item.correctOptionIndex : 0;

    if (qType === "multiple_choice") {
      const rawOpts = Array.isArray(item.options)
        ? item.options.map((o) => String(o || "").trim()).filter(Boolean)
        : [];
      const uniqueOpts = Array.from(new Set(rawOpts));
      if (uniqueOpts.length !== 4) continue;
      options = uniqueOpts;
      if (correctOptionIndex < 0 || correctOptionIndex >= 4) {
        const ansText = String(item.correctAnswerText || item.answer || "").trim();
        const foundIdx = options.findIndex((o) => o.toLowerCase() === ansText.toLowerCase());
        correctOptionIndex = foundIdx >= 0 ? foundIdx : 0;
      }
    } else {
      options = isArabic ? ["صح", "خطأ"] : ["True", "False"];
      const ansVal = String(item.correctAnswerText ?? item.answer ?? "")
        .trim()
        .toLowerCase();
      if (
        typeof item.correctOptionIndex === "number" &&
        (item.correctOptionIndex === 0 || item.correctOptionIndex === 1)
      ) {
        correctOptionIndex = item.correctOptionIndex;
      } else if (ansVal === "false" || ansVal === "خطأ") {
        correctOptionIndex = 1;
      } else {
        correctOptionIndex = 0;
      }
    }

    const correctAnswerText = options[correctOptionIndex];
    if (!isQuestionGroundedInText(question, correctAnswerText, transcriptNorm)) continue;

    seen.add(normQ);
    valid.push({
      id: `q_n8n_${Date.now()}_${valid.length + 1}`,
      question,
      type: qType,
      options,
      correctOptionIndex,
      correctAnswerText,
      explanation:
        String(item.explanation || "").trim() ||
        (isArabic ? "موثق من نص التسجيل الفعلي." : "Grounded in the actual recording transcript."),
      difficulty: (["easy", "medium", "hard"].includes(String(item.difficulty || ""))
        ? String(item.difficulty)
        : "medium") as "easy" | "medium" | "hard",
      sectionRef: String(item.sectionRef || (isArabic ? "نص التسجيل" : "Transcript")),
      timestampRef: typeof item.timestampRef === "string" ? item.timestampRef : undefined,
      sourceTranscriptSegment:
        typeof item.sourceTranscriptSegment === "string" ? item.sourceTranscriptSegment : undefined,
      groundingVerified: true,
    });
  }

  return valid;
}

/**
 * Universal adapter for n8n workflow outputs:
 * - Structured MeetMind JSON contract ({ success, transcript, analysis, htmlReport })
 * - Raw Gemini Markdown / AssemblyAI JSON from intermediate n8n nodes
 * - Styled 13-section HTML report generated by the AI team's Style Report node
 */
export function parseN8nWorkflowResponse(params: {
  rawBody: string;
  contentType: string;
  resourceType: "meeting" | "lecture";
  jobId: string;
  latencyMs: number;
}): N8nWorkflowResult {
  const { rawBody, contentType, resourceType, jobId, latencyMs } = params;
  const trimmed = String(rawBody || "").trim();
  if (!trimmed) {
    throw new N8nIntegrationError("n8n webhook returned an empty response.", {
      retryable: true,
      category: "N8nEmptyResponse",
    });
  }

  // Case 1: Direct HTML report response
  if (contentType.includes("text/html") || /^<!doctype html|^<html/i.test(trimmed)) {
    const parsedHtml = parse13SectionHtml(trimmed, "", resourceType, jobId);
    if (!parsedHtml.transcript.segments.length) {
      throw new N8nIntegrationError("n8n HTML report did not contain a valid transcript.", {
        retryable: true,
        category: "N8nInvalidPayload",
      });
    }
    return { provider: "n8n", latencyMs, ...parsedHtml };
  }

  let json: Record<string, unknown>;
  try {
    const parsed = JSON.parse(trimmed);
    json = (Array.isArray(parsed) ? parsed[0] : parsed) as Record<string, unknown>;
  } catch {
    // Plain Markdown response fallback
    const parsedMd = parse13SectionMarkdown(trimmed, "", resourceType, jobId);
    if (!parsedMd.transcript.segments.length) {
      throw new N8nIntegrationError("n8n returned an unrecognized non-JSON response.", {
        retryable: true,
        category: "N8nInvalidPayload",
      });
    }
    return { provider: "n8n", latencyMs, ...parsedMd };
  }

  if (!json || typeof json !== "object") {
    throw new N8nIntegrationError("n8n JSON response was malformed.", {
      retryable: true,
      category: "N8nInvalidPayload",
    });
  }

  if (json.success === false && typeof json.error === "string") {
    throw new N8nIntegrationError(redactSensitiveText(json.error), {
      retryable: true,
      category: "N8nWorkflowError",
    });
  }

  // Case 2: Preferred Structured JSON Contract
  if (json.transcript && typeof json.transcript === "object") {
    const tr = json.transcript as Record<string, unknown>;
    const text = String(tr.text || "").trim();
    const language =
      String(tr.language || tr.language_code || "").trim() ||
      (/[\u0600-\u06FF]/.test(text) ? "ar" : "en");
    const isArabic = language.startsWith("ar") || /[\u0600-\u06FF]/.test(text);
    const segments = buildSegmentsFromTranscriptPayload({
      text,
      utterances: tr.utterances || tr.segments,
      resourceType,
      jobId,
      language,
    });
    if (segments.length === 0) {
      throw new N8nIntegrationError("n8n response transcript is empty.", {
        retryable: true,
        category: "N8nEmptyTranscript",
      });
    }

    const transcriptNorm = normalizeForGrounding(segments.map((s) => s.text).join(" ") || text);
    const an = (json.analysis && typeof json.analysis === "object" ? json.analysis : {}) as Record<
      string,
      unknown
    >;

    const rawQuiz = [
      ...(Array.isArray(an.quiz) ? an.quiz : []),
      ...(Array.isArray(an.mcq) ? an.mcq : []),
      ...(Array.isArray(an.trueFalse) ? an.trueFalse : []),
    ];
    const quiz = validateStructuredQuizItems(rawQuiz, transcriptNorm, isArabic);

    const flashcards: N8nFlashcard[] = Array.isArray(an.flashcards)
      ? an.flashcards
          .filter((f): f is Record<string, unknown> => Boolean(f && typeof f === "object"))
          .map((f) => ({
            front: String(f.front || f.q || f.question || "").trim(),
            back: String(f.back || f.a || f.answer || "").trim(),
            topic: typeof f.topic === "string" ? f.topic : undefined,
            difficulty: (["easy", "medium", "hard"].includes(String(f.difficulty || ""))
              ? String(f.difficulty)
              : "medium") as "easy" | "medium" | "hard",
          }))
          .filter((f) => f.front && f.back)
      : [];

    const rawTasks = Array.isArray(an.tasks)
      ? an.tasks
      : Array.isArray(an.actionItems)
        ? an.actionItems
        : Array.isArray(an.action_items)
          ? an.action_items
          : [];
    const actionItems: N8nActionItem[] = rawTasks
      .map((t) => {
        if (typeof t === "string") {
          return { title: t.trim(), priority: "medium" as const };
        }
        if (t && typeof t === "object") {
          const obj = t as Record<string, unknown>;
          const title = String(obj.title || obj.task || "").trim();
          if (!title) return null;
          return {
            title,
            ownerName:
              typeof obj.ownerName === "string"
                ? obj.ownerName
                : typeof obj.owner === "string"
                  ? obj.owner
                  : undefined,
            dueDate:
              typeof obj.dueDate === "string"
                ? obj.dueDate
                : typeof obj.deadline === "string"
                  ? obj.deadline
                  : undefined,
            priority: (["high", "medium", "low"].includes(String(obj.priority || ""))
              ? String(obj.priority)
              : "medium") as "high" | "medium" | "low",
          };
        }
        return null;
      })
      .filter((x): x is N8nActionItem => Boolean(x && x.title));

    const toStrList = (val: unknown): string[] =>
      Array.isArray(val)
        ? val
            .map((x) =>
              typeof x === "string"
                ? x.trim()
                : typeof x === "object" && x && "term" in x
                  ? String((x as { term: unknown }).term).trim()
                  : "",
            )
            .filter(Boolean)
        : [];

    const essayQuestions: N8nEssayQuestion[] = Array.isArray(an.essayQuestions)
      ? an.essayQuestions
          .map((e) =>
            typeof e === "string"
              ? { question: e.trim() }
              : e && typeof e === "object"
                ? {
                    question: String((e as Record<string, unknown>).question || "").trim(),
                    modelAnswer:
                      typeof (e as Record<string, unknown>).modelAnswer === "string"
                        ? String((e as Record<string, unknown>).modelAnswer)
                        : undefined,
                  }
                : null,
          )
          .filter((e): e is N8nEssayQuestion => Boolean(e && e.question))
      : [];

    const computedSpeakers = computeSpeakerBreakdown(segments);
    const speakerBreakdown =
      Array.isArray(an.speakerBreakdown) && an.speakerBreakdown.length > 0
        ? (an.speakerBreakdown as AssemblyAiSpeakerStat[])
        : computedSpeakers;

    const rawTimings =
      json.timings && typeof json.timings === "object"
        ? (json.timings as Record<string, unknown>)
        : undefined;
    const summaryText = Array.isArray(an.summary)
      ? toStrList(an.summary).join(" ")
      : String(an.summary || "").trim();

    return {
      provider: "n8n",
      latencyMs,
      ...(rawTimings
        ? {
            stageTimings: {
              assemblyAiUploadMs:
                typeof rawTimings.assemblyAiUploadMs === "number"
                  ? rawTimings.assemblyAiUploadMs
                  : undefined,
              transcriptionMs:
                typeof rawTimings.transcriptionMs === "number"
                  ? rawTimings.transcriptionMs
                  : undefined,
              pollingWaitMs:
                typeof rawTimings.pollingWaitMs === "number" ? rawTimings.pollingWaitMs : undefined,
              pollCount:
                typeof rawTimings.pollCount === "number" ? rawTimings.pollCount : undefined,
              transcriptFetchMs:
                typeof rawTimings.transcriptFetchMs === "number"
                  ? rawTimings.transcriptFetchMs
                  : undefined,
              geminiAnalysisMs:
                typeof rawTimings.geminiAnalysisMs === "number"
                  ? rawTimings.geminiAnalysisMs
                  : undefined,
            },
          }
        : {}),
      transcript: {
        id: typeof tr.id === "string" ? tr.id : undefined,
        text: formatTranscriptNonDestructive(text || segments.map((s) => s.text).join(" ")),
        rawText: String(tr.rawText || text || segments.map((s) => s.text).join(" ")).trim(),
        language,
        asrModel:
          typeof tr.asrModel === "string"
            ? tr.asrModel
            : typeof tr.speechModelUsed === "string"
              ? tr.speechModelUsed
              : undefined,
        averageConfidence:
          typeof tr.averageConfidence === "number" ? tr.averageConfidence : undefined,
        diarizationEnabled:
          typeof tr.diarizationEnabled === "boolean" ? tr.diarizationEnabled : true,
        segments,
        rawSegments: segments,
        durationSeconds: Math.max(
          1,
          Number(tr.durationSeconds || tr.audio_duration) ||
            segments[segments.length - 1]?.endTime ||
            10,
        ),
      },
      analysis: {
        summary: summaryText,
        keyPoints: toStrList(an.keyPoints || an.key_points),
        importantSentences: toStrList(an.importantSentences || an.important_sentences),
        topics: toStrList(an.topics),
        keywords: toStrList(an.keywords),
        decisions: toStrList(an.decisions),
        actionItems,
        deadlines: toStrList(an.deadlines),
        examHints: toStrList(an.examHints || an.exam_hints),
        notes: toStrList(an.notes),
        speakerBreakdown,
        quiz,
        essayQuestions,
        flashcards,
      },
      htmlReport:
        typeof json.htmlReport === "string"
          ? json.htmlReport
          : typeof json.html_report === "string"
            ? json.html_report
            : undefined,
    };
  }

  // Case 3: Current n8n workflow output ({ html_report / meeting_report / candidates / transcript_text })
  const htmlCandidate =
    typeof json.html_report === "string"
      ? json.html_report
      : typeof json.meeting_report === "string"
        ? json.meeting_report
        : "";
  const transcriptTextCandidate = String(json.transcript_text || json.text || "").trim();

  if (htmlCandidate && /<div[^>]*class=["']section["']/i.test(htmlCandidate)) {
    const parsedHtml = parse13SectionHtml(
      htmlCandidate,
      transcriptTextCandidate,
      resourceType,
      jobId,
    );
    if (typeof json.transcript_id === "string") {
      parsedHtml.transcript.id = json.transcript_id;
    }
    if (json.transcript_utterances) {
      const uttSegments = buildSegmentsFromTranscriptPayload({
        text: parsedHtml.transcript.text,
        utterances: json.transcript_utterances,
        resourceType,
        jobId,
        language: parsedHtml.transcript.language,
      });
      if (uttSegments.length > 0) {
        parsedHtml.transcript.segments = uttSegments;
        parsedHtml.analysis.speakerBreakdown = computeSpeakerBreakdown(uttSegments);
      }
    }
    if (!parsedHtml.transcript.segments.length) {
      throw new N8nIntegrationError("n8n HTML payload contained no transcript segments.", {
        retryable: true,
        category: "N8nEmptyTranscript",
      });
    }
    return { provider: "n8n", latencyMs, ...parsedHtml };
  }

  // Raw Gemini candidates payload from n8n Meeting Analyzer node
  const candidates = Array.isArray(json.candidates) ? json.candidates : [];
  const firstCandidateText = String(
    (
      candidates[0] as
        | {
            content?: { parts?: Array<{ text?: string }> };
          }
        | undefined
    )?.content?.parts?.[0]?.text || "",
  ).trim();
  if (firstCandidateText) {
    const parsedMd = parse13SectionMarkdown(
      firstCandidateText,
      transcriptTextCandidate,
      resourceType,
      jobId,
    );
    if (typeof json.transcript_id === "string") {
      parsedMd.transcript.id = json.transcript_id;
    }
    if (!parsedMd.transcript.segments.length) {
      throw new N8nIntegrationError("n8n Gemini response contained no transcript segments.", {
        retryable: true,
        category: "N8nEmptyTranscript",
      });
    }
    return { provider: "n8n", latencyMs, ...parsedMd };
  }

  throw new N8nIntegrationError(
    "n8n webhook response did not match any supported MeetMind contract (JSON, HTML report, or Gemini report).",
    { retryable: true, category: "N8nInvalidPayload" },
  );
}

/**
 * Invokes the configured n8n webhook (`POST {N8N_WEBHOOK_URL}`) with the uploaded audio
 * under binary field `"audio"` (matching the AI team's Webhook node) + metadata + correlation ID.
 */
export async function executeN8nAudioWorkflow(params: {
  filePath: string;
  originalFilename: string;
  mimeType?: string;
  resourceId: string;
  resourceType: "meeting" | "lecture";
  title: string;
  language?: string;
  appLanguage?: "en" | "ar";
  jobId: string;
  correlationId: string;
  signal?: AbortSignal;
}): Promise<N8nWorkflowResult> {
  const cfg = getN8nConfig();
  if (!cfg.configured) {
    throw new N8nIntegrationError("N8N_WEBHOOK_URL is not configured.", {
      status: 503,
      retryable: false,
      category: "N8nUnconfigured",
    });
  }
  if (!cfg.usableInCurrentEnv || !cfg.webhookUrl) {
    throw new N8nIntegrationError(
      cfg.reason || "N8N_WEBHOOK_URL is invalid or unreachable in this deployment environment.",
      { status: 503, retryable: false, category: "N8nConfigError" },
    );
  }

  const startedAt = Date.now();
  logStageTiming(params.correlationId, "N8N_REQUEST_START", undefined, {
    host: cfg.hostLabel,
  });
  logObservabilityEvent("info", "n8n_request_started", {
    correlationId: params.correlationId,
    jobId: params.jobId,
    resourceId: params.resourceId,
    host: cfg.hostLabel,
    isLocalhost: cfg.isLocalhost,
  });

  const audioBuffer = fs.readFileSync(params.filePath);
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new N8nIntegrationError("Audio file is empty (0 bytes).", {
      status: 400,
      retryable: false,
      category: "InvalidAudio",
    });
  }

  const fileName = path.basename(params.originalFilename || "recording.mp3");
  const mime = params.mimeType || "audio/mpeg";
  const form = new FormData();
  form.append("audio", new Blob([new Uint8Array(audioBuffer)], { type: mime }), fileName);
  form.append("resourceId", params.resourceId);
  form.append("resourceType", params.resourceType);
  form.append("title", params.title);
  form.append("language", params.language || "auto");
  form.append("appLanguage", params.appLanguage || "en");
  form.append("correlationId", params.correlationId);
  form.append("originalFilename", fileName);

  const headers: Record<string, string> = {
    "X-Correlation-ID": params.correlationId,
    Accept: "application/json, text/html",
  };
  const authApiKey = (process.env.N8N_WEBHOOK_API_KEY || "").trim();
  if (authApiKey) {
    const authHeaderName = (process.env.N8N_WEBHOOK_AUTH_HEADER || "X-N8N-API-Key").trim();
    headers[authHeaderName] = authApiKey;
  }

  const controller = new AbortController();
  const onParentAbort = () => controller.abort();
  params.signal?.addEventListener("abort", onParentAbort, { once: true });
  const timeoutTimer = setTimeout(() => controller.abort(), cfg.timeoutMs);

  try {
    const res = await fetch(cfg.webhookUrl, {
      method: "POST",
      headers,
      body: form,
      signal: controller.signal,
    });

    const contentType = (res.headers.get("content-type") || "").toLowerCase();
    const rawBody = await res.text();

    if (!res.ok) {
      throw new N8nIntegrationError(
        `n8n webhook returned HTTP ${res.status}: ${redactSensitiveText(rawBody || res.statusText)}`,
        {
          status: res.status,
          retryable:
            res.status === 408 || res.status === 429 || res.status >= 500 || res.status === 404,
          category: "N8nHttpError",
        },
      );
    }

    const latencyMs = Date.now() - startedAt;
    logStageTiming(params.correlationId, "N8N_REQUEST_COMPLETE", latencyMs, {
      host: cfg.hostLabel,
    });
    const parsed = parseN8nWorkflowResponse({
      rawBody,
      contentType,
      resourceType: params.resourceType,
      jobId: params.jobId,
      latencyMs,
    });

    logObservabilityEvent("info", "n8n_request_completed", {
      correlationId: params.correlationId,
      jobId: params.jobId,
      resourceId: params.resourceId,
      host: cfg.hostLabel,
      segmentsCount: parsed.transcript.segments.length,
      quizCount: parsed.analysis.quiz.length,
      flashcardsCount: parsed.analysis.flashcards.length,
      latencyMs,
    });

    return parsed;
  } catch (err) {
    const latencyMs = Date.now() - startedAt;
    const isTimeout = controller.signal.aborted && !params.signal?.aborted;
    const wrapped =
      err instanceof N8nIntegrationError
        ? err
        : new N8nIntegrationError(
            isTimeout
              ? `n8n AI workflow timed out after ${Math.round(cfg.timeoutMs / 1000)}s. Please retry.`
              : `n8n AI workflow is unavailable (${redactSensitiveText(err instanceof Error ? err.message : String(err))}). Please ensure n8n is running and retry.`,
            {
              status: isTimeout ? 504 : 503,
              retryable: true,
              category: isTimeout ? "N8nTimeout" : "N8nUnavailable",
            },
          );

    logObservabilityEvent("error", "n8n_request_failed", {
      correlationId: params.correlationId,
      jobId: params.jobId,
      resourceId: params.resourceId,
      host: cfg.hostLabel,
      status: wrapped.status,
      category: wrapped.category,
      error: wrapped.message,
      latencyMs,
    });

    throw wrapped;
  } finally {
    clearTimeout(timeoutTimer);
    params.signal?.removeEventListener("abort", onParentAbort);
  }
}
