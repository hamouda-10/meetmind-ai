import type { TranscriptSegment } from "./db";

export interface FormattedTranscriptArtifacts {
  rawTranscript: string;
  processedTranscript: string;
  rawSegments: TranscriptSegment[];
  processedSegments: TranscriptSegment[];
  averageConfidence?: number;
}

/**
 * Non-destructive UTF-8 safe Arabic & multilingual transcript formatting.
 * NEVER rewrites, paraphrases, translates, or replaces spoken words (Egyptian Arabic or MSA).
 * NEVER strips or alters Arabic letters (أ، إ، آ، ة، ى، ؤ، ئ، ء).
 * ONLY removes invisible zero-width control chars, collapses extra whitespace,
 * and tidies spacing around punctuation marks.
 */
export function formatTranscriptNonDestructive(rawText: string): string {
  if (!rawText) return "";
  return (
    String(rawText)
      // Remove zero-width / BOM control characters only
      .replace(/[\u200B-\u200D\uFEFF]/g, "")
      // Normalize non-breaking spaces to regular space
      .replace(/\u00A0/g, " ")
      // Collapse repeated horizontal spaces while keeping line breaks intact
      .replace(/[ \t]{2,}/g, " ")
      // Remove accidental space BEFORE punctuation marks
      .replace(/[ \t]+([.,!?;:،؛؟])/g, "$1")
      // Ensure a single space AFTER punctuation when followed directly by a letter/digit
      .replace(/([.,!?;:،؛؟])(?=[\p{L}\p{N}])/gu, "$1 ")
      // Collapse excessive blank lines
      .replace(/\n{3,}/g, "\n\n")
      .trim()
  );
}

/**
 * Maps AssemblyAI diarization labels ("A", "B", "C", "1", "2") cleanly to
 * consistent human-readable "Speaker 1", "Speaker 2", "Speaker 3" labels.
 * NEVER fabricates alternating speaker labels when diarization is absent or single-speaker.
 */
export function normalizeSpeakerLabel(
  rawSpeaker: string | undefined | null,
  options: { resourceType?: "meeting" | "lecture"; uniqueSpeakerCount?: number } = {},
): string {
  const cleaned = String(rawSpeaker || "").trim();
  if (!cleaned) {
    return options.resourceType === "lecture" ? "Speaker 1" : "Speaker 1";
  }

  // Already formatted "Speaker N"
  const alreadyNum = cleaned.match(/^speaker\s+(\d+)$/i);
  if (alreadyNum) {
    return `Speaker ${alreadyNum[1]}`;
  }

  // AssemblyAI letter speaker tags: "A" -> Speaker 1, "B" -> Speaker 2, "C" -> Speaker 3 ...
  const letterMatch = cleaned.match(/^(?:speaker\s+)?([A-Z])$/i);
  if (letterMatch) {
    const code = letterMatch[1].toUpperCase().charCodeAt(0) - 64; // A=1, B=2, C=3
    if (code >= 1 && code <= 26) {
      return `Speaker ${code}`;
    }
  }

  // Pure numeric speaker tags: "0" or "1"
  if (/^\d+$/.test(cleaned)) {
    const num = parseInt(cleaned, 10);
    return `Speaker ${num === 0 ? 1 : num}`;
  }

  return cleaned;
}

/**
 * Computes mean confidence across segments (or word-level scores if provided),
 * rounded to 4 decimal places (0..1).
 */
export function computeAverageConfidence(
  segments: TranscriptSegment[],
  wordConfidences?: number[],
): number | undefined {
  const validWords = (wordConfidences || []).filter(
    (v) => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1,
  );
  if (validWords.length > 0) {
    const mean = validWords.reduce((sum, v) => sum + v, 0) / validWords.length;
    return Math.round(mean * 10000) / 10000;
  }

  const validSegs = (segments || [])
    .map((s) => s.confidence)
    .filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1);
  if (validSegs.length > 0) {
    const mean = validSegs.reduce((sum, v) => sum + v, 0) / validSegs.length;
    return Math.round(mean * 10000) / 10000;
  }

  return undefined;
}

/**
 * Builds immutable RAW ASR transcript + non-destructively formatted display transcript
 * so debugging and UI inspection can always trace RAW ASR -> Arabic Formatting -> Final Display.
 */
export function buildTranscriptArtifacts(params: {
  rawFullText?: string;
  rawSegments: TranscriptSegment[];
  wordConfidences?: number[];
}): FormattedTranscriptArtifacts {
  const rawSegments: TranscriptSegment[] = (params.rawSegments || []).map((seg) => ({
    ...seg,
    text: String(seg.text || ""),
  }));

  const rawTranscript =
    typeof params.rawFullText === "string" && params.rawFullText.trim().length > 0
      ? params.rawFullText.trim()
      : rawSegments
          .map((s) => s.text.trim())
          .filter(Boolean)
          .join(" ");

  const processedSegments: TranscriptSegment[] = rawSegments.map((seg) => ({
    ...seg,
    text: formatTranscriptNonDestructive(seg.text),
  }));

  const processedTranscript =
    processedSegments.length > 0
      ? processedSegments
          .map((s) => (s.speaker ? `${s.speaker}: ${s.text}` : s.text))
          .filter(Boolean)
          .join("\n")
      : formatTranscriptNonDestructive(rawTranscript);

  const averageConfidence = computeAverageConfidence(rawSegments, params.wordConfidences);

  return {
    rawTranscript,
    processedTranscript,
    rawSegments,
    processedSegments,
    averageConfidence,
  };
}
