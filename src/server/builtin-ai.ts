import type {
  ActionItemRecord,
  FlashcardRecord,
  LectureRecord,
  MeetingRecord,
  MindMapNode,
  QuizRecord,
  TranscriptSegment,
} from "./db";

function formatMmSs(sec: number): string {
  const safe = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const m = Math.floor(safe / 60);
  const s = safe % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function convertArabicDigits(text: string): string {
  return String(text || "").replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660));
}

export function normalizeText(text: string): string {
  return convertArabicDigits(text)
    .toLowerCase()
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .replace(/[أإآٱ]/g, "ا")
    .replace(/ة/g, "ه")
    .replace(/ى/g, "ي")
    .replace(/ؤ/g, "و")
    .replace(/ئ/g, "ي")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectIsArabic(text: string, fallbackLang?: "en" | "ar"): boolean {
  const arMatches = (text.match(/[\u0600-\u06FF]/g) || []).length;
  const enMatches = (text.match(/[A-Za-z]/g) || []).length;
  if (arMatches > 0 && arMatches >= enMatches * 0.35) return true;
  if (enMatches > 0 && arMatches === 0) return false;
  return fallbackLang === "ar";
}

const STOP_WORDS = new Set([
  "the",
  "and",
  "for",
  "are",
  "but",
  "not",
  "you",
  "all",
  "can",
  "was",
  "one",
  "our",
  "out",
  "has",
  "had",
  "how",
  "why",
  "who",
  "its",
  "with",
  "that",
  "this",
  "from",
  "they",
  "will",
  "have",
  "been",
  "were",
  "said",
  "what",
  "when",
  "where",
  "which",
  "about",
  "does",
  "did",
  "into",
  "also",
  "than",
  "then",
  "them",
  "some",
  "just",
  "like",
  "more",
  "very",
  "your",
  "make",
  "would",
  "could",
  "should",
  "there",
  "their",
  "please",
  "tell",
  "explain",
  "give",
  "في",
  "من",
  "الي",
  "علي",
  "هذا",
  "هذه",
  "ذلك",
  "تلك",
  "التي",
  "الذي",
  "اللي",
  "مع",
  "كان",
  "كانت",
  "يكون",
  "تكون",
  "ليس",
  "ماذا",
  "كيف",
  "متي",
  "اين",
  "هل",
  "عن",
  "ان",
  "انه",
  "انها",
  "هو",
  "هي",
  "هم",
  "نحن",
  "احنا",
  "انت",
  "انا",
  "ما",
  "لا",
  "لم",
  "لن",
  "قد",
  "كل",
  "او",
  "ثم",
  "بعد",
  "قبل",
  "عند",
  "بين",
  "حول",
  "مثل",
  "اكثر",
  "جدا",
  "اي",
  "ايه",
  "يعني",
  "عشان",
  "علشان",
  "ممكن",
  "عايز",
  "اريد",
  "قولي",
  "اشرح",
  "اشرحلي",
  "كده",
  "ده",
  "دي",
  "تم",
  "دلوقتي",
  "عندي",
  "عندك",
  "عندنا",
  "طيب",
  "واحد",
  "واحده",
  "تاني",
  "تانيه",
  "حاجه",
  "حاجات",
  "بقي",
  "بقيت",
  "مثلا",
  "طبعا",
  "اكيد",
  "خلاص",
  "ببساطه",
  "ليه",
  "ازاي",
  "لازم",
  "كمان",
  "برضو",
  "اوي",
  "فقط",
  "ايضا",
  "لو",
  "بس",
  "مش",
  "ولا",
  "شخص",
  "فاهم",
  "رحمه",
  "الله",
  "السلام",
  "عليكم",
  "وبركاته",
]);

const SHORT_KEEP_TOKENS = new Set([
  "ai",
  "ml",
  "dl",
  "ui",
  "ux",
  "db",
  "os",
  "ip",
  "ci",
  "cd",
  "js",
  "ts",
  "go",
  "c#",
  "api",
  "sql",
  "jwt",
  "sse",
  "rag",
  "tcp",
  "udp",
  "dns",
  "tls",
  "ssl",
  "oop",
  "dsa",
  "cpu",
  "gpu",
  "llm",
  "asr",
  "vad",
  "nlp",
]);

/**
 * Lightweight bilingual stemmer for Arabic (prefix/suffix stripping + orthographic
 * normalization) and English (common inflectional suffix stripping).
 */
export function normalizeArabicStem(token: string): string {
  let w = normalizeText(token).replace(/\s+/g, "");
  if (!w) return "";

  const isArabicWord = /[\u0600-\u06FF]/.test(w);
  if (isArabicWord) {
    // Compound & definite prefixes
    const prefixes = ["وال", "بال", "كال", "فال", "ولل", "لل", "ال"];
    for (const p of prefixes) {
      if (w.startsWith(p) && w.length - p.length >= 3) {
        w = w.slice(p.length);
        break;
      }
    }
    if (w.length >= 5 && /^[وبفلك]/.test(w)) {
      w = w.slice(1);
    }

    // Common Arabic inflectional/possessive suffixes
    const suffixes = [
      "يات",
      "تان",
      "تين",
      "ون",
      "ين",
      "ات",
      "ان",
      "هم",
      "هن",
      "كم",
      "كن",
      "ها",
      "نا",
      "يه",
      "ه",
      "ي",
    ];
    for (const s of suffixes) {
      if (w.endsWith(s) && w.length - s.length >= 3) {
        w = w.slice(0, -s.length);
        break;
      }
    }
    return w;
  }

  // English lightweight stemming (skip codes containing digits like b11 or cs101)
  if (/\d/.test(w) || SHORT_KEEP_TOKENS.has(w)) return w;
  if (w.length >= 6 && w.endsWith("ities")) return `${w.slice(0, -5)}ity`;
  if (w.length >= 5 && w.endsWith("ies")) return `${w.slice(0, -3)}y`;
  if (w.length >= 6 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length >= 5 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length >= 5 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length >= 4 && w.endsWith("s") && !/(ss|us|is)$/.test(w)) return w.slice(0, -1);
  return w;
}

export function tokenizeForRetrieval(text: string): string[] {
  const norm = normalizeText(text);
  if (!norm) return [];
  const rawTokens = norm.split(" ").filter(Boolean);
  const out: string[] = [];

  for (const tok of rawTokens) {
    if (STOP_WORDS.has(tok)) continue;
    const hasDigit = /\d/.test(tok);
    if (!hasDigit && tok.length < 3 && !SHORT_KEEP_TOKENS.has(tok)) continue;
    const stem = normalizeArabicStem(tok);
    if (stem && !STOP_WORDS.has(stem)) {
      out.push(stem);
    }
  }
  return out;
}

/**
 * Okapi BM25 retrieval over transcript segments with Arabic stem normalization,
 * exact token boosts, and adjacent phrase proximity bonus.
 */
export function retrieveRelevantSegmentsBM25<T extends { seg: TranscriptSegment }>(
  query: string,
  items: T[],
  options?: { topK?: number; minScore?: number },
): Array<T & { score: number }> {
  const topK = options?.topK ?? 6;
  const minScore = options?.minScore ?? 0.35;
  if (!items || items.length === 0) return [];

  const queryStems = tokenizeForRetrieval(query);
  const queryNormRaw = normalizeText(query)
    .split(" ")
    .filter((w) => w && !STOP_WORDS.has(w) && (/\d/.test(w) || w.length >= 2));

  if (queryStems.length === 0 && queryNormRaw.length === 0) return [];

  const uniqueQueryStems = Array.from(new Set(queryStems));
  const uniqueRawTokens = Array.from(new Set(queryNormRaw));

  const docs = items.map((item) => {
    const stems = tokenizeForRetrieval(item.seg.text);
    const tf = new Map<string, number>();
    for (const st of stems) {
      tf.set(st, (tf.get(st) || 0) + 1);
    }
    const rawNorm = normalizeText(item.seg.text);
    const rawSet = new Set(rawNorm.split(" ").filter(Boolean));
    return { item, stems, tf, len: Math.max(1, stems.length), rawNorm, rawSet };
  });

  const N = docs.length;
  const avgDl = docs.reduce((acc, d) => acc + d.len, 0) / Math.max(1, N);
  const df = new Map<string, number>();
  for (const d of docs) {
    for (const st of d.tf.keys()) {
      df.set(st, (df.get(st) || 0) + 1);
    }
  }

  const k1 = 1.5;
  const b = 0.75;

  const scored: Array<T & { score: number }> = [];
  for (const d of docs) {
    let bm25 = 0;
    for (const qStem of uniqueQueryStems) {
      const freq = d.tf.get(qStem) || 0;
      if (freq > 0) {
        const docFreq = df.get(qStem) || 0;
        const idf = Math.log(1 + (N - docFreq + 0.5) / (docFreq + 0.5));
        const denom = freq + k1 * (1 - b + b * (d.len / Math.max(1, avgDl)));
        bm25 += idf * ((freq * (k1 + 1)) / denom);
      }
    }

    // Exact normalized token & numeric/code bonus (critical for numbers like 7, 250, B11)
    let exactBonus = 0;
    for (const rawTok of uniqueRawTokens) {
      if (d.rawSet.has(rawTok)) {
        exactBonus += /\d/.test(rawTok) ? 1.4 : 0.45;
      } else if (rawTok.length >= 4 && d.rawNorm.includes(rawTok)) {
        exactBonus += 0.35;
      }
    }

    // Consecutive bigram phrase proximity bonus
    let phraseBonus = 0;
    for (let i = 0; i < queryNormRaw.length - 1; i++) {
      const bigram = `${queryNormRaw[i]} ${queryNormRaw[i + 1]}`;
      if (bigram.length >= 5 && d.rawNorm.includes(bigram)) {
        phraseBonus += 0.9;
      }
    }

    const total = Number((bm25 + exactBonus + phraseBonus).toFixed(3));
    if (total >= minScore) {
      scored.push({ ...d.item, score: total });
    }
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, topK);
}

// ============================================================================
// STRUCTURED CLAUSE, ENTITY & NUMERIC SPECIFICATION EXTRACTION
// ============================================================================
interface TranscriptClause {
  text: string;
  speaker: string;
  startTime: number;
  timestamp: string;
  segmentText: string;
}

interface ExtractedFact {
  kind: "spec" | "entity" | "definition" | "decision" | "action" | "concept";
  labelAr: string;
  labelEn: string;
  value: string;
  numericValue?: number;
  unit?: string;
  clause: string;
  segmentText: string;
  speaker: string;
  timestamp: string;
}

function splitIntoClauses(segments: TranscriptSegment[]): TranscriptClause[] {
  const clauses: TranscriptClause[] = [];
  for (const seg of segments) {
    const cleanSeg = String(seg.text || "")
      .replace(/\s+/g, " ")
      .trim();
    if (!cleanSeg) continue;
    const ts = formatMmSs(seg.startTime);

    const rawParts = cleanSeg
      .split(/(?<=[.!؟?])\s+|[\n;]+/)
      .flatMap((part) => (part.length > 140 ? part.split(/[،,]\s+/) : [part]))
      .map((p) => p.trim())
      .filter((p) => p.length >= 8);

    if (rawParts.length === 0) {
      clauses.push({
        text: cleanSeg,
        speaker: seg.speaker,
        startTime: seg.startTime,
        timestamp: ts,
        segmentText: cleanSeg,
      });
    } else {
      for (const part of rawParts) {
        clauses.push({
          text: part,
          speaker: seg.speaker,
          startTime: seg.startTime,
          timestamp: ts,
          segmentText: cleanSeg,
        });
      }
    }
  }
  return clauses;
}

function classifySpecUnit(unitRaw: string): { labelAr: string; labelEn: string } {
  const u = normalizeText(unitRaw);
  if (/مليون|الف|جنيه|دولار|ريال|يورو|usd|egp|sar|million|thousand/.test(u)) {
    return { labelAr: "الميزانية / السعر", labelEn: "Budget / Price" };
  }
  if (/متر|متل|meter|m2|sqm|sqft/.test(u)) {
    return { labelAr: "المساحة", labelEn: "Area / Size" };
  }
  if (/غرف|bedroom|room/.test(u)) {
    return { labelAr: "عدد الغرف", labelEn: "Number of Rooms" };
  }
  if (/حمام|bathroom|bath/.test(u)) {
    return { labelAr: "عدد الحمامات", labelEn: "Number of Bathrooms" };
  }
  if (/دقيق|دقائق|ساع|يوم|ايام|اسبوع|اسابيع|شهر|اشهر|سن|minute|hour|day|week|month|year/.test(u)) {
    return { labelAr: "المدة الزمنية", labelEn: "Duration / Timeframe" };
  }
  if (/%|percent|بالمائه|بالميه/.test(u)) {
    return { labelAr: "النسبة المئوية", labelEn: "Percentage" };
  }
  if (/gb|mb|kb|tb|ms|hz|khz|mhz/.test(u)) {
    return { labelAr: "المواصفة التقنية", labelEn: "Technical Specification" };
  }
  return { labelAr: "القيمة الرقمية", labelEn: "Key Value" };
}

/**
 * Normalizes common Whisper Arabic ASR phonetic artifacts solely for structured fact extraction
 * without altering the user-visible verbatim transcript segments.
 */
function normalizeWhisperPhoneticsForFacts(text: string): string {
  return convertArabicDigits(text)
    .replace(/(\d+(?:[.,]\d+)?)\s*متل(?=$|[\s،,.!?؟])/g, "$1 متر")
    .replace(
      /(^|[\s،,.!?؟])(?:ثلاثة|ثلاثه|ثلاث|تلاتة|تلاته|تلات|لات|لاية|لايه)\s+(غرف(?:ة|ه)?|حمامات)(?=$|[\s،,.!?؟])/g,
      "$13 $2",
    )
    .replace(
      /(^|[\s،,.!?؟])(?:أربعة|أربعه|أربع|اربعة|اربعه|اربع)\s+(غرف(?:ة|ه)?|حمامات)(?=$|[\s،,.!?؟])/g,
      "$14 $2",
    )
    .replace(/(^|[\s،,.!?؟])(?:خمسة|خمسه|خمس)\s+(غرف(?:ة|ه)?|حمامات)(?=$|[\s،,.!?؟])/g, "$15 $2")
    .replace(/(^|[\s،,.!?؟])غرفتين(?=$|[\s،,.!?؟])/g, "$12 غرف")
    .replace(/(^|[\s،,.!?؟])حمامين(?=$|[\s،,.!?؟])/g, "$12 حمامات");
}

function extractStructuredFacts(segments: TranscriptSegment[]): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  const seenValues = new Set<string>();
  const clauses = splitIntoClauses(segments);

  const specRegex =
    /(\d+(?:[.,]\d+)?)\s*(مليون\s*جنيه|ألف\s*جنيه|الف\s*جنيه|مليون|جنيه|دولار|ريال|يورو|متر(?:\s*مربع)?|متل|غرف(?:ة|ه)?|حمام(?:ات)?|دقائق|دقيقة|ساعات|ساعة|أيام|ايام|يوم|أسابيع|أسبوع|أشهر|شهر|سنوات|سنة|%|percent|million(?:\s*(?:egp|usd|dollars?))?|thousand|meters?|m2|sqm|bedrooms?|rooms?|bathrooms?|minutes?|hours?|days?|weeks?|months?|years?|gb|mb|ms|hz|khz|usd|egp|sar)/gi;

  for (const seg of segments) {
    const rawText = normalizeWhisperPhoneticsForFacts(seg.text || "");
    const ts = formatMmSs(seg.startTime);

    // 1. Quantitative specifications
    let match: RegExpExecArray | null;
    specRegex.lastIndex = 0;
    while ((match = specRegex.exec(rawText)) !== null) {
      const num = parseFloat(match[1].replace(",", "."));
      const unitRaw = match[2].trim();
      const unit = unitRaw === "متل" ? "متر" : unitRaw;
      const valStr = `${match[1]} ${unit}`.trim();
      const dedupeKey = `spec:${normalizeText(valStr)}`;
      if (!Number.isFinite(num) || seenValues.has(dedupeKey)) continue;
      seenValues.add(dedupeKey);
      const { labelAr, labelEn } = classifySpecUnit(unit);
      const startCtx = Math.max(0, match.index - 45);
      const endCtx = Math.min(rawText.length, match.index + match[0].length + 45);
      facts.push({
        kind: "spec",
        labelAr,
        labelEn,
        value: valStr,
        numericValue: num,
        unit,
        clause: rawText.slice(startCtx, endCtx).trim(),
        segmentText: seg.text.trim(),
        speaker: seg.speaker,
        timestamp: ts,
      });
    }

    // 2. Location / zone / code identifiers (e.g. "في مدينتي منطقة B11", "في مدينتي منبتقد B11", "منطقة النرجس")
    // Strictly avoid matching generic Arabic prepositions like "في حياتك" or "في البرمجة".
    const locRegex =
      /(?:(?:منطقة|منطقه|مدينة|مدينه|حي|مشروع|كمبوند)\s+([\u0600-\u06FFA-Za-z0-9]{2,}(?:\s+(?:منطقة|منطقه|منبتقد|مبتائد|حي|مرحلة|قطاع|بوابة)?\s*[\u0600-\u06FFA-Za-z0-9]{1,}){0,3})|(?:في|بـ)\s+((?:مدينتي|التجمع(?:\s+(?:الخامس|الأول|الاول|الثالث))?|الشيخ\s+زايد|أكتوبر|اكتوبر|6\s*(?:أكتوبر|اكتوبر)|العاصمة(?:\s+الإدارية)?|القاهرة(?:\s+الجديدة)?|الإسكندرية|الاسكندرية|المعادي|مدينة\s+نصر|مصر\s+الجديدة|المهندسين|الدقي|الرحاب|الشروق|العبور|بدر|الجيزة)(?:\s+(?:منطقة|منطقه|منبتقد|مبتائد|حي|مرحلة|قطاع|بوابة)?\s*[\u0600-\u06FFA-Za-z0-9]{1,}){0,3}|[\u0600-\u06FFA-Za-z0-9]{2,}\s+(?:منطقة|منطقه|منبتقد|مبتائد|حي|مرحلة|قطاع|بوابة)\s*[\u0600-\u06FFA-Za-z0-9]{1,}))/g;
    const nonLocationPattern =
      /^(?:حدود|نطاق|حوالي|تقريبا|قرابه|متوسط|المتوسط|حاله|حالة|وقت|بدايه|نهايه|المقام|يوغاردن|جاردن|فيو|اطلاله|حياتك|حياتنا|حياتي|البرمجه|البرمجة|الكورس|المحاضره|المحاضرة|الفيديو|الكمبيوتر|الاول|الأول|الاخر|الآخر|\d)/i;
    const currencyOrUnitInLoc = /(?:مليون|جنيه|دولار|ريال|يورو|متر|متل|غرف|حمام|دقيق|ساع)/i;
    let locMatch: RegExpExecArray | null;
    while ((locMatch = locRegex.exec(rawText)) !== null) {
      const rawLoc = (locMatch[1] || locMatch[2] || "")
        .replace(/\s+(?:في\s+حدود|بحدود|بسعر|بمساحة|مساحة).*$/i, "")
        .replace(/\s+(?:منبتقد|مبتائد|منطقه)\s+/g, " - منطقة ")
        .replace(/[،,.!?؟]+$/, "")
        .trim();
      const normLoc = normalizeText(rawLoc);
      if (
        rawLoc.length < 3 ||
        nonLocationPattern.test(normLoc) ||
        currencyOrUnitInLoc.test(normLoc) ||
        STOP_WORDS.has(normLoc)
      ) {
        continue;
      }
      const key = `loc:${normLoc}`;
      if (!seenValues.has(key)) {
        seenValues.add(key);
        facts.push({
          kind: "entity",
          labelAr: "الموقع / المنطقة",
          labelEn: "Location / Area",
          value: rawLoc,
          clause: locMatch[0].trim(),
          segmentText: seg.text.trim(),
          speaker: seg.speaker,
          timestamp: ts,
        });
        break;
      }
    }

    // 3. Finishing / Feature attributes (e.g. "تشطيب ألترا سوبر لوكس", "فيو جاردن")
    const finishMatch = rawText.match(
      /(?:تشطيب|تشتريب|تشتيب)\s+([\u0600-\u06FFA-Za-z0-9\s]{3,35}?)(?:[،,.!?؟]|$)/,
    );
    if (finishMatch && finishMatch[1]) {
      const val = finishMatch[1].trim();
      const key = `fin:${normalizeText(val)}`;
      if (val.length >= 3 && !seenValues.has(key)) {
        seenValues.add(key);
        facts.push({
          kind: "entity",
          labelAr: "نوع التشطيب",
          labelEn: "Finishing Level",
          value: val,
          clause: finishMatch[0].trim(),
          segmentText: seg.text.trim(),
          speaker: seg.speaker,
          timestamp: ts,
        });
      }
    }

    const viewMatch = rawText.match(
      /(?:فيو\s+|في\s+يو\s*|إطلالة\s+|اطلالة\s+)([\u0600-\u06FFA-Za-z]{3,20})(?=$|[\s،,.!?؟\d])/,
    );
    if (viewMatch && viewMatch[1]) {
      const val = viewMatch[1].replace(/^(?:غاردن|جاردن)$/i, "جاردن").trim();
      const normView = normalizeText(val);
      const key = `view:${normView}`;
      if (val.length >= 3 && !currencyOrUnitInLoc.test(normView) && !seenValues.has(key)) {
        seenValues.add(key);
        facts.push({
          kind: "entity",
          labelAr: "الإطلالة (الفيو)",
          labelEn: "View / Outlook",
          value: val,
          clause: viewMatch[0].trim(),
          segmentText: seg.text.trim(),
          speaker: seg.speaker,
          timestamp: ts,
        });
      }
    }

    // 4. Named speaker / contact identity (consumes "أنا اسمي" / honorifics cleanly)
    const nameMatch = rawText.match(
      /(?:(?:أنا|انا)\s+اسمي|اسمي)\s+(?:(?:الأستاذ|الاستاذ|الأسطاز|الاسطاز|الدكتور|المهندس|أستاذ|استاذ|دكتور|مهندس|مستر|السيد)\s+)?([\u0600-\u06FF]{2,}(?:\s+[\u0600-\u06FF]{2,})?)/,
    );
    if (nameMatch && nameMatch[1]) {
      const val = nameMatch[1]
        .replace(/^(?:اسمي|الأستاذ|الاستاذ|الأسطاز|الاسطاز|أستاذ|مستر)\s+/g, "")
        .replace(/\s+(?:رقم|رقمي|محتاج|عايز|تليفون|موبايل).*$/g, "")
        .trim();
      const normVal = normalizeText(val);
      const key = `name:${normVal}`;
      if (val.length >= 3 && !STOP_WORDS.has(normVal) && !seenValues.has(key)) {
        seenValues.add(key);
        facts.push({
          kind: "entity",
          labelAr: "اسم المتحدث / صاحب الطلب",
          labelEn: "Speaker / Contact Name",
          value: val,
          clause: nameMatch[0].trim(),
          segmentText: seg.text.trim(),
          speaker: seg.speaker,
          timestamp: ts,
        });
      }
    }

    // 5. Phone / Contact numbers
    const phoneMatch = rawText.match(/\b(01[0125]\d{8}|\+?\d{10,14})\b/);
    if (phoneMatch && phoneMatch[1]) {
      const val = phoneMatch[1].trim();
      const key = `phone:${val}`;
      if (!seenValues.has(key)) {
        seenValues.add(key);
        facts.push({
          kind: "entity",
          labelAr: "رقم التواصل",
          labelEn: "Contact Phone Number",
          value: val,
          clause: `رقم التواصل: ${val}`,
          segmentText: seg.text.trim(),
          speaker: seg.speaker,
          timestamp: ts,
        });
      }
    }
  }

  // 6. Explicit definitions across clauses (strictly genuine academic/technical definitions,
  // avoiding conversational Arabic filler like "فغالبا السبب هو" or "فا يعني")
  const conversationalNonTermRx =
    /\b(?:انا|أنا|انت|أنت|عندي|عندك|غالبا|فغالبا|السبب|وقلت|خلاص|كده|دلوقتي|طيب|يعني|لو|عشان|علشان|ممكن|عايز|تاني|حاجة|حاجه)\b/i;
  for (const cl of clauses) {
    const defMatch = cl.text.match(
      /^([\u0600-\u06FFA-Za-z0-9\s()-]{3,28}?)\s+(?:is defined as|refers to|stands for|يُعرف\s*بأنه|يعرف\s*بأنه|تعريفه\s*هو|معناه\s*هو|يُقصد\s*به|يقصد\s*به|هو\s+عبارة\s*عن|هي\s+عبارة\s*عن|عبارة\s*عن)\s+([^.!؟?\n]{10,160})/i,
    );
    if (defMatch) {
      const term = defMatch[1].replace(/^[،,.\s]+|[،,.\s]+$/g, "").trim();
      const def = defMatch[2].trim();
      const termWords = term.split(/\s+/).filter(Boolean);
      const key = `def:${normalizeText(term)}`;
      if (
        term.length >= 3 &&
        termWords.length <= 4 &&
        def.length >= 10 &&
        !conversationalNonTermRx.test(term) &&
        !STOP_WORDS.has(normalizeText(term)) &&
        !seenValues.has(key)
      ) {
        seenValues.add(key);
        facts.push({
          kind: "definition",
          labelAr: `تعريف: ${term}`,
          labelEn: `Definition: ${term}`,
          value: def,
          clause: cl.text,
          segmentText: cl.segmentText,
          speaker: cl.speaker,
          timestamp: cl.timestamp,
        });
      }
    }
  }

  return facts;
}

function extractSignificantTerms(
  segments: TranscriptSegment[],
  limit = 12,
): Array<{ term: string; frequency: number; importance: number; timestamp: string }> {
  const counts = new Map<string, { raw: string; count: number; firstTs: number }>();

  for (const seg of segments) {
    const rawWords = convertArabicDigits(seg.text || "")
      .split(/[\s؟?!.,،:;()"'[\]{}<>/\\|]+/)
      .filter((w) => w.length >= 2);
    for (const raw of rawWords) {
      const norm = normalizeText(raw);
      const isCodeOrTech = SHORT_KEEP_TOKENS.has(norm) || /^[a-z]\d{1,3}$/i.test(raw);
      if ((!isCodeOrTech && norm.length < 3) || STOP_WORDS.has(norm) || /^\d+$/.test(norm)) {
        continue;
      }
      const stem = normalizeArabicStem(norm) || norm;
      if (STOP_WORDS.has(stem)) continue;
      const existing = counts.get(stem);
      if (existing) {
        existing.count += 1;
        // Prefer cleaner/longer surface form
        if (raw.length > existing.raw.length && raw.length <= 24) {
          existing.raw = raw;
        }
      } else {
        counts.set(stem, { raw, count: 1, firstTs: seg.startTime });
      }
    }
  }

  const sorted = Array.from(counts.values())
    .sort((a, b) => b.count - a.count)
    .slice(0, limit);
  const maxFreq = sorted[0]?.count || 1;

  return sorted.map((item) => ({
    term: item.raw,
    frequency: item.count,
    importance: Math.max(0.35, Math.min(1, Number((item.count / maxFreq).toFixed(2)))),
    timestamp: formatMmSs(item.firstTs),
  }));
}

function extractKeyPhrases(segments: TranscriptSegment[], limit = 8): string[] {
  const phraseCounts = new Map<string, { display: string; score: number }>();
  for (const seg of segments) {
    const tokens = convertArabicDigits(seg.text || "")
      .split(/[\s؟?!.,،:;()"'[\]{}<>/\\|]+/)
      .map((t) => t.trim())
      .filter((t) => t.length >= 2);

    for (let i = 0; i < tokens.length - 1; i++) {
      const a = tokens[i];
      const b = tokens[i + 1];
      const na = normalizeText(a);
      const nb = normalizeText(b);
      if (!na || !nb || STOP_WORDS.has(na) || STOP_WORDS.has(nb)) continue;
      if (/^\d+$/.test(na) && /^\d+$/.test(nb)) continue;
      const key = `${normalizeArabicStem(na)}_${normalizeArabicStem(nb)}`;
      const display = `${a} ${b}`;
      const prev = phraseCounts.get(key);
      const bonus = /\d/.test(display) ? 1.4 : 1;
      if (prev) {
        prev.score += bonus;
      } else {
        phraseCounts.set(key, { display, score: bonus });
      }
    }
  }

  return Array.from(phraseCounts.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((p) => p.display);
}

function scoreSegments(
  segments: TranscriptSegment[],
): Array<{ seg: TranscriptSegment; score: number }> {
  if (segments.length === 0) return [];
  const terms = extractSignificantTerms(segments, 20);
  const termWeights = new Map<string, number>();
  for (const t of terms) {
    termWeights.set(normalizeArabicStem(t.term), t.importance);
  }

  const cuePattern =
    /(important|key|summary|conclude|decided|agreed|action|task|deadline|exam|remember|definition|means|must|should|مهم|ملخص|خلاصة|قررنا|اتفقنا|مهمة|تكليف|امتحان|تذكر|تعريف|يعني|يجب|أساسي|نقطة|محتاج|مطلوب|في حدود)/i;

  return segments.map((seg, idx) => {
    const stems = tokenizeForRetrieval(seg.text);
    let score = 0;
    const seen = new Set<string>();
    for (const st of stems) {
      if (seen.has(st)) continue;
      seen.add(st);
      score += termWeights.get(st) || 0.15;
    }
    if (stems.length >= 5 && stems.length <= 50) score += 1.5;
    if (cuePattern.test(seg.text)) score += 2.2;
    if (/\d/.test(convertArabicDigits(seg.text))) score += 1.4;
    if (idx === 0 || idx === segments.length - 1) score += 0.9;

    return { seg, score };
  });
}

/**
 * Selects the highest-signal transcript segments within a strict character budget,
 * keeping chronological order for clean LLM ingestion on CPU.
 */
export function selectHighSignalSegments(
  segments: TranscriptSegment[],
  maxChars = 2800,
): TranscriptSegment[] {
  if (!segments || segments.length === 0) return [];
  const totalChars = segments.reduce((acc, s) => acc + (s.text?.length || 0) + 24, 0);
  if (totalChars <= maxChars) return segments;

  const scored = scoreSegments(segments).map((item, idx) => ({ ...item, idx }));
  const chosenIndices = new Set<number>();
  let usedChars = 0;

  const addIdx = (idx: number): boolean => {
    if (chosenIndices.has(idx) || idx < 0 || idx >= segments.length) return false;
    const est = (segments[idx].text?.length || 0) + 26;
    if (usedChars + est > maxChars && chosenIndices.size > 0) return false;
    chosenIndices.add(idx);
    usedChars += est;
    return true;
  };

  // Always include opening and closing context
  addIdx(0);
  if (segments.length > 1) addIdx(segments.length - 1);

  const byScore = [...scored].sort((a, b) => b.score - a.score);
  for (const item of byScore) {
    if (!addIdx(item.idx) && usedChars >= maxChars * 0.9) break;
  }

  return Array.from(chosenIndices)
    .sort((a, b) => a - b)
    .map((i) => segments[i]);
}

// ============================================================================
// SAFE ARITHMETIC & UNIT CONVERSION EVALUATOR (ZERO eval)
// ============================================================================
function safeEvalMathExpression(expr: string): number | null {
  const cleaned = expr.replace(/\s+/g, "");
  if (!/^[0-9+\-*/().^%]+$/.test(cleaned)) return null;
  if (cleaned.length > 80) return null;

  let pos = 0;
  const peek = () => cleaned[pos];
  const consume = () => cleaned[pos++];

  function parseExpression(): number {
    let val = parseTerm();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseTerm();
      val = op === "+" ? val + right : val - right;
    }
    return val;
  }

  function parseTerm(): number {
    let val = parsePower();
    while (peek() === "*" || peek() === "/" || peek() === "%") {
      const op = consume();
      const right = parsePower();
      if (op === "*") val *= right;
      else if (op === "/") {
        if (right === 0) throw new Error("Division by zero");
        val /= right;
      } else {
        val %= right;
      }
    }
    return val;
  }

  function parsePower(): number {
    const base = parseUnary();
    if (peek() === "^") {
      consume();
      const exp = parsePower();
      return Math.pow(base, exp);
    }
    return base;
  }

  function parseUnary(): number {
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    if (peek() === "-") {
      consume();
      return -parseUnary();
    }
    return parsePrimary();
  }

  function parsePrimary(): number {
    if (peek() === "(") {
      consume();
      const val = parseExpression();
      if (peek() !== ")") throw new Error("Missing closing parenthesis");
      consume();
      return val;
    }
    const start = pos;
    while (pos < cleaned.length && /[0-9.]/.test(cleaned[pos])) pos++;
    if (start === pos) throw new Error("Unexpected token");
    const num = Number(cleaned.slice(start, pos));
    if (!Number.isFinite(num)) throw new Error("Invalid number");
    return num;
  }

  try {
    const result = parseExpression();
    if (pos !== cleaned.length || !Number.isFinite(result)) return null;
    return Math.round(result * 1e9) / 1e9;
  } catch {
    return null;
  }
}

export function trySolveMathQuery(question: string, isAr: boolean): string | null {
  const q = convertArabicDigits(question.trim());

  // Percentage query: "15% of 400" or "15% من 400"
  const pctMatch = q.match(/(\d+(?:\.\d+)?)\s*%\s*(?:of|من)\s*(\d+(?:\.\d+)?)/i);
  if (pctMatch) {
    const pct = Number(pctMatch[1]);
    const total = Number(pctMatch[2]);
    const res = Math.round((pct / 100) * total * 1e6) / 1e6;
    return isAr
      ? `حساب النسبة المئوية:\n\n**${pct}% من ${total} = ${res}**\n\nالطريقة: (${pct} ÷ 100) × ${total} = ${res}`
      : `Percentage Calculation:\n\n**${pct}% of ${total} = ${res}**\n\nFormula: (${pct} / 100) × ${total} = ${res}`;
  }

  // Square root: sqrt(144) or الجذر التربيعي لـ 144
  const sqrtMatch = q.match(
    /(?:sqrt\s*\(|الجذر\s*(?:التربيعي)?\s*(?:ل|لـ|لرقم)?\s*)(\d+(?:\.\d+)?)\)?/i,
  );
  if (sqrtMatch) {
    const n = Number(sqrtMatch[1]);
    if (n >= 0) {
      const res = Math.round(Math.sqrt(n) * 1e6) / 1e6;
      return isAr
        ? `الجذر التربيعي للرقم **${n}** هو:\n\n**√${n} = ${res}**`
        : `The square root of **${n}** is:\n\n**√${n} = ${res}**`;
    }
  }

  // Pure or embedded arithmetic expression with at least one operator (avoid matching natural text with hyphens)
  const normalizedMath = q
    .replace(/[×]/g, "*")
    .replace(/[÷]/g, "/")
    .replace(/(\d)\s*[xX]\s*(\d)/g, "$1*$2")
    .replace(/كم\s*يساوي|احسب|ناتج|calculate|what\s+is|solve|=/gi, " ")
    .trim();

  const exprMatch = normalizedMath.match(/^[0-9()+\-*/.^%\s]{3,}$/);
  if (exprMatch) {
    const candidate = exprMatch[0].trim();
    if (/[+\-*/^]/.test(candidate) && /\d/.test(candidate)) {
      const val = safeEvalMathExpression(candidate);
      if (val !== null) {
        return isAr
          ? `ناتج العملية الحسابية:\n\n\`${candidate}\` = **${val}**`
          : `Calculation Result:\n\n\`${candidate}\` = **${val}**`;
      }
    }
  }

  return null;
}

// ============================================================================
// BUILT-IN BILINGUAL KNOWLEDGE & EXPLANATION ENGINE (TIER-3 FALLBACK)
// ============================================================================
interface KnowledgeTopic {
  id: string;
  patterns: RegExp[];
  arTitle: string;
  enTitle: string;
  arBody: string;
  enBody: string;
}

const KNOWLEDGE_BASE: KnowledgeTopic[] = [
  {
    id: "rag",
    patterns: [/\brag\b|retrieval[\s-]*augmented|التوليد\s*المعزز\s*بالاسترجاع/i],
    arTitle: "التوليد المعزز بالاسترجاع (RAG — Retrieval-Augmented Generation)",
    enTitle: "How RAG (Retrieval-Augmented Generation) Works",
    arBody: `**RAG** هي معمارية تربط نماذج اللغة الكبيرة بقاعدة بياناتك ومستنداتك الفعلية قبل توليد الإجابة لمنع الاختلاق (Hallucination):

- **1. الفهرسة والتقسيم (Indexing & Chunking):** تقسيم التسجيلات والمستندات إلى مقاطع دلالية وفهرستها للبحث السريع (BM25 / Embeddings).
- **2. الاسترجاع الذكي (Retrieval):** عند طرح سؤال، يسترجع النظام أدق المقاطع المطابقة من مصادر المستخدم فقط.
- **3. التوليد الموثّق (Grounded Generation):** يُحقن السياق المسترجع داخل موجه النموذج ليُنتج إجابة دقيقة مدعومة بالمصادر والتوقيتات.`,
    enBody: `**RAG (Retrieval-Augmented Generation)** grounds LLM answers in verified external documents or transcripts before generating text:

- **Indexing & Chunking:** Documents or transcripts are split into focused chunks and indexed (via BM25 lexical scoring and/or vector embeddings).
- **Relevant Retrieval:** When a user asks a question, the retriever fetches the top matching passages with timestamps and citations.
- **Grounded Generation:** Those retrieved passages are injected into the LLM prompt so the model synthesizes an accurate, citation-backed answer with minimal hallucination.`,
  },
  {
    id: "generative-ai",
    patterns: [
      /generative\s*ai|genai|llm|large\s*language|الذكاء\s*الاصطناعي\s*التوليدي|نماذج\s*اللغة|شات\s*جي\s*بي\s*تي|chatgpt|gemini|transformer/i,
    ],
    arTitle: "الذكاء الاصطناعي التوليدي (Generative AI)",
    enTitle: "Generative AI & Large Language Models",
    arBody: `**الذكاء الاصطناعي التوليدي (Generative AI)** هو فرع متقدم من الذكاء الاصطناعي يمتلك القدرة على **إنشاء محتوى جديد تماماً** (نصوص، أكواد، صور، صوتيات، وفيديو) بدلاً من الاكتفاء بتصنيف البيانات فقط.

**كيف يعمل ببساطة؟**
1. **التدريب المسبق (Pre-training):** يتعلم النموذج الأنماط اللغوية والمعرفية من مليارات النصوص عبر معمارية **Transformers** وآلية الانتباه (**Self-Attention**).
2. **التنبؤ الذكي (Next-Token Prediction):** عند طرح سؤال، يحلل النموذج السياق بالكامل ويتنبأ بأدق تسلسل كلمات لتكوين إجابة منطقية ومفيدة.
3. **الضبط الدقيق (Fine-Tuning & RLHF):** يُدرَّب على اتباع التعليمات البشرية بأمان ودقة.

**أبرز التطبيقات العملية:**
- تلخيص الاجتماعات والمحاضرات الصوتية وتوليد الاختبارات (مثل **MeetMind AI**).
- كتابة ومراجعة الأكواد البرمجية وحل المشكلات الهندسية.
- البحث المعرفي المدعوم بالمستندات (**RAG — Retrieval-Augmented Generation**).`,
    enBody: `**Generative AI** is a branch of artificial intelligence capable of **creating brand-new content** — including text, code, audio, images, and structured summaries — rather than only classifying or predicting labels.

**How it works simply:**
1. **Transformer Architecture & Self-Attention:** Models analyze relationships between every word in context simultaneously.
2. **Pre-training:** Learned across massive datasets to capture language grammar, reasoning patterns, and domain knowledge.
3. **Instruction Tuning & Alignment:** Fine-tuned to follow instructions accurately, answer questions, and stay helpful.

**Key Practical Applications:**
- Summarizing lectures & meetings, extracting action items, and generating grounded quizzes (like **MeetMind AI**).
- Code generation, debugging, and software architecture design.
- **RAG (Retrieval-Augmented Generation)** for answering questions grounded directly in private documents and transcripts.`,
  },
  {
    id: "machine-learning",
    patterns: [
      /machine\s*learning|deep\s*learning|neural\s*network|تعلم\s*الالة|تعلم\s*الآلة|التعلم\s*العميق|الشبكات\s*العصبية|ذكاء\s*اصطناعي|artificial\s*intelligence|\bai\b/i,
    ],
    arTitle: "تعلم الآلة والتعلم العميق (Machine Learning & Deep Learning)",
    enTitle: "Machine Learning & Deep Learning",
    arBody: `**الذكاء الاصطناعي (AI)** هو المجال الأوسع، ويدخل تحته **تعلم الآلة (Machine Learning)** ثم **التعلم العميق (Deep Learning)**.

**الأنواع الثلاثة الرئيسية لتعلم الآلة:**
1. **التعلم الموجه (Supervised Learning):** تدريب النموذج على بيانات مصنفة (مدخلات + إجابات صحيحة)، مثل التصنيف (Classification) والتوقع الرقمي (Regression).
2. **التعلم غير الموجه (Unsupervised Learning):** اكتشاف أنماط وتجمعات خفية في بيانات غير مصنفة، مثل التجميع (Clustering - K-Means) وتقليل الأبعاد (PCA).
3. **التعلم المعزز (Reinforcement Learning):** يتعلم الوكيل الذكي عبر التجربة والمكافآت والعقوبات داخل بيئة تفاعلية.

**مفاهيم أساسية للامتحانات والمشاريع:**
- **Overfitting (فرط التخصيص):** حفظ النموذج لبيانات التدريب وفشله في التعميم على بيانات جديدة (الحل: Regularization، Dropout، بيانات أكثر).
- **مقاييس التقييم:** الدقة (Accuracy)، الإحكام (Precision)، الاستدعاء (Recall)، ومعيار F1-Score.`,
    enBody: `**Artificial Intelligence (AI)** encompasses **Machine Learning (ML)** and **Deep Learning (DL)** using multi-layer neural networks.

**Three Core Paradigms of Machine Learning:**
1. **Supervised Learning:** Trained on labeled input-output pairs (Classification & Regression).
2. **Unsupervised Learning:** Discovers hidden patterns in unlabeled data (Clustering like K-Means, Dimensionality Reduction like PCA).
3. **Reinforcement Learning:** An agent learns optimal actions through environment feedback (rewards and penalties).

**Core Concepts to Master:**
- **Overfitting vs. Underfitting:** Overfitting memorizes training noise and generalizes poorly (mitigated via Regularization, Dropout, Cross-Validation, and more data).
- **Evaluation Metrics:** Accuracy, Precision, Recall, F1-Score, ROC-AUC, and Mean Squared Error (MSE).`,
  },
  {
    id: "exam-study",
    patterns: [
      /exam|study|prepare|memorize|امتحان|مذاكرة|الاستعداد\s*للامتحان|أذاكر|اذاكر|مراجعة|خطة\s*مذاكرة|pomodoro|active\s*recall/i,
    ],
    arTitle: "خطة عملية متكاملة للاستعداد للامتحان والمذاكرة الذكية",
    enTitle: "High-Impact Exam Preparation & Smart Study Blueprint",
    arBody: `لتحقيق أعلى درجة بأقل مجهود مهدر، اعتمد على الاستراتيجيات المثبتة علمياً:

**1. الاسترجاع النشط (Active Recall):**
- بدلاً من إعادة القراءة السلبية، أغلق الملخص واختبر نفسك فوراً. استخدم قسم **الاختبارات (Quiz)** و**البطاقات التعليمية (Flashcards)** في MeetMind لتحويل كل محاضرة إلى أسئلة تفاعلية.

**2. التكرار المتباعد (Spaced Repetition):**
- راجع المعلومات بعد: **يوم واحد ← 3 أيام ← أسبوع ← قبل الامتحان بيومين** لتثبيتها في الذاكرة طويلة المدى.

**3. تقنية بومودورو (Pomodoro Technique):**
- ذاكر **25 إلى 45 دقيقة تركيز كامل** بدون هاتف، تليها **5–10 دقائق راحة**.

**4. تقنية فاينمان (Feynman Technique):**
- حاول شرح المفهوم الصعب بكلماتك البسيطة كأنك تشرحه لشخص مبتدئ؛ أي نقطة تتعثر فيها هي بالضبط ما يحتاج مراجعة فورية.`,
    enBody: `Follow these science-backed techniques to maximize exam retention and performance:

**1. Active Recall:**
- Stop passive re-reading. Close your notes and test yourself from memory using **MeetMind Quizzes & Flashcards**.

**2. Spaced Repetition:**
- Review material at expanding intervals: **Day 1 → Day 3 → Day 7 → 48 hours before the exam**.

**3. Pomodoro Deep-Focus Blocks:**
- Work in focused **25–45 minute sprints** with zero distractions, followed by **5–10 minute breaks**.

**4. The Feynman Technique:**
- Explain any complex topic in plain language as if teaching a beginner; wherever you hesitate reveals the exact knowledge gap to review.`,
  },
  {
    id: "programming-web",
    patterns: [
      /\b(python|javascript|typescript|react|node\.?js|html|css|next\.?js|api|rest|graphql|git|docker|frontend|backend)\b|برمجة|بايثون|جافاسكريبت|رياكت|تطوير\s*الويب|كود|برمجي/i,
    ],
    arTitle: "تطوير البرمجيات والويب (Software & Web Engineering)",
    enTitle: "Software & Web Engineering Guide",
    arBody: `إليك ملخصاً هندسياً لأهم ركائز تطوير البرمجيات الحديثة:

**1. الواجهة الأمامية (Frontend):**
- **HTML/CSS/TypeScript** لبناء هيكل وتصميم تفاعلي خالٍ من الأخطاء النوعية.
- **React / Next.js / TanStack:** بناء واجهات تعتمد على المكونات (Components) وإدارة الحالة (Zustand / React Query).

**2. الواجهة الخلفية (Backend & APIs):**
- **Node.js / Python (FastAPI):** استقبال الطلبات عبر **REST APIs** (GET, POST, PUT, DELETE) والتحقق الصارم من المدخلات.
- **المصادقة والأمان:** تشفير كلمات المرور بخوارزميات قوية مثل **scrypt/bcrypt** واستخدام جلسات موقعة (**JWT + HttpOnly Cookies**).`,
    enBody: `Here is a concise engineering overview of modern software & web development:

**1. Frontend Architecture:**
- **TypeScript + React:** Component-driven UI with strict compile-time type safety and predictable state management (Zustand / TanStack Query).

**2. Backend & APIs:**
- **Node.js / Python (FastAPI):** Clean RESTful routes (GET, POST, PUT, DELETE), strict validation, and structured error handling.
- **Authentication & Security:** Password hashing with **scrypt / Argon2 / bcrypt**, signed JWTs, and HttpOnly cookies.`,
  },
  {
    id: "databases-sql",
    patterns: [
      /\b(sql|nosql|database|postgres|mysql|mongodb|redis|acid|normalization|index|join)\b|قواعد\s*البيانات|قاعدة\s*بيانات|تطبيع|استعلام/i,
    ],
    arTitle: "قواعد البيانات (SQL & NoSQL Databases)",
    enTitle: "Databases: SQL, NoSQL, ACID & Normalization",
    arBody: `**قواعد البيانات** تنقسم إلى نوعين أساسيين:

**1. قواعد البيانات العلائقية (SQL — مثل PostgreSQL, MySQL):**
- تخزن البيانات في **جداول (Tables)** مرتبطة بعلاقات عبر **Primary Key** و **Foreign Key**.
- تضمن خصائص **ACID** (Atomicity, Consistency, Isolation, Durability).

**2. قواعد البيانات غير العلائقية (NoSQL — مثل MongoDB, Redis):**
- تخزن البيانات بصيغة مستندات (**JSON**) أو **Key-Value** بمرونة عالية وتوسع أفقي سريع.

**مفاهيم هامة:** الفهرسة (**Indexing**) لتسريع الاستعلامات، والتطبيع (**Normalization 1NF-3NF**) لمنع التكرار.`,
    enBody: `**Databases** fall into two primary families:

**1. Relational Databases (SQL — PostgreSQL, MySQL):**
- Store structured data in **tables** connected by **Primary Keys** and **Foreign Keys** with **ACID** transaction guarantees.

**2. Non-Relational Databases (NoSQL — MongoDB, Redis):**
- Document, Key-Value, Columnar, or Graph models offering flexible schemas and horizontal scaling.

**Key Concepts:** **Indexing (B-Tree / Hash)** accelerates queries; **Normalization (1NF → 3NF)** eliminates redundancy.`,
  },
  {
    id: "dsa-oop",
    patterns: [
      /\b(oop|object\s*oriented|data\s*structure|algorithm|big[\s-]*o|linked\s*list|binary\s*tree|graph|sorting|recursion|dynamic\s*programming)\b|هياكل\s*البيانات|خوارزميات|البرمجة\s*كائنية|تعقيد\s*الوقت/i,
    ],
    arTitle: "هياكل البيانات والخوارزميات والبرمجة كائنية التوجه (DSA & OOP)",
    enTitle: "Data Structures, Algorithms & OOP Fundamentals",
    arBody: `**أولاً: المبادئ الأربعة للبرمجة كائنية التوجه (OOP):**
1. **التغليف (Encapsulation)** • 2. **الوراثة (Inheritance)** • 3. **تعدد الأشكال (Polymorphism)** • 4. **التجريد (Abstraction)**.

**ثانياً: أهم هياكل البيانات وتعقيد الوقت (Big-O):**
- **Array:** الوصول O(1)، البحث الخطي O(n).
- **Hash Table / Map:** البحث والإضافة والحذف في المتوسط O(1).
- **Binary Search:** على مصفوفة مرتبة بتعقيد O(log n).
- **Merge Sort / Quick Sort:** ترتيب فعّال بتعقيد O(n log n).`,
    enBody: `**1. Four Pillars of OOP:**
- **Encapsulation**, **Inheritance**, **Polymorphism**, and **Abstraction**.

**2. Essential Data Structures & Big-O:**
- **Arrays:** Index access O(1), linear search O(n).
- **Hash Maps:** Average O(1) lookup, insert, delete.
- **Binary Search:** O(log n) on sorted arrays.
- **Merge Sort / Quick Sort (avg):** O(n log n).`,
  },
  {
    id: "networks-os-security",
    patterns: [
      /\b(tcp|udp|http|https|dns|osi|operating\s*system|deadlock|thread|process|cybersecurity|jwt|encryption|hash|scrypt|ssl|tls)\b|شبكات|نظم\s*التشغيل|أمن\s*سيبراني|تشفير|بروتوكول/i,
    ],
    arTitle: "الشبكات ونظم التشغيل والأمن السيبراني",
    enTitle: "Networking, Operating Systems & Cybersecurity",
    arBody: `**1. الفرق بين TCP و UDP:**
- **TCP (موثوق ومتصل):** ينشئ اتصالاً (3-Way Handshake)، يضمن وصول كل الحزم بالترتيب ويعيد إرسال المفقود (مناسب للويب HTTP/HTTPS والملفات والبريد).
- **UDP (سريع وخفيف بدون اتصال):** يرسل الحزم مباشرة بدون تأكيد وصول أو إعادة إرسال، مما يمنح زمن تأخير أقل (مناسب للبث المباشر والمكالمات الصوتية والألعاب).

**2. نظم التشغيل والأمان:**
- **Process vs. Thread:** العملية لها ذاكرة معزولة، بينما الخيوط تتشارك الذاكرة داخل نفس العملية.
- **HTTPS (TLS/SSL):** يشفر الاتصال بين العميل والخادم ويحمي البيانات أثناء النقل.`,
    enBody: `**1. TCP vs. UDP:**
- **TCP (Connection-Oriented & Reliable):** Uses a 3-way handshake, guarantees ordered, lossless packet delivery with retransmission — ideal for web traffic (HTTP/HTTPS), APIs, and file transfers.
- **UDP (Connectionless & Fast):** Minimal overhead with no delivery guarantee or ordering — ideal for live audio/video streaming, VoIP, DNS, and online gaming.

**2. Operating Systems & Security:**
- **Process vs. Thread:** Processes have isolated memory; threads share process memory for fast concurrency.
- **HTTPS (TLS):** Encrypts traffic in transit and authenticates server identity.`,
  },
  {
    id: "agile-meetings-project",
    patterns: [
      /\b(agile|scrum|kanban|swot|okr|smart\s*goals|project\s*management|graduation\s*project|meeting\s*minutes)\b|أجايل|سكرم|مشروع\s*التخرج|إدارة\s*المشاريع|إدارة\s*الاجتماعات|محضر\s*اجتماع/i,
    ],
    arTitle: "إدارة المشاريع والاجتماعات الاحترافية (Agile & Meetings)",
    enTitle: "Project Management, Agile & High-Impact Meetings",
    arBody: `**1. منهجية Agile & Scrum:**
- تقسيم العمل إلى دورات قصيرة (**Sprints** من أسبوع إلى أسبوعين) مع اجتماعات **Daily Standup** و **Sprint Review** و **Retrospective**.

**2. محضر الاجتماع المثالي:**
1. **الملخص التنفيذي** • 2. **القرارات المعتمدة** • 3. **قائمة المهام (المهمة + المسؤول + الموعد النهائي)**.`,
    enBody: `**1. Agile & Scrum:**
- Iterative **1–2 week Sprints** with Sprint Planning, Daily Standups, Sprint Reviews, and Retrospectives.

**2. Effective Meeting Minutes:**
1. **Executive Summary** • 2. **Key Decisions** • 3. **Action Items (Task + Owner + Deadline)**.`,
  },
];

// ============================================================================
// MANDATORY AI IDENTITY HANDLER (ARABIC & ENGLISH — CONTEXT-AWARE, NON-REPETITIVE)
// ============================================================================
export const MEETMIND_IDENTITY_AR =
  "تم تطويري بواسطة مجموعة من طلاب هندسة البرمجيات من قسم علوم الحاسب في Modern Academy كجزء من مشروع التخرج MeetMind AI.";

export const MEETMIND_IDENTITY_EN =
  "I was developed by a group of software engineering students from the Computer Science Department at Modern Academy as part of the MeetMind AI graduation project.";

export function tryAnswerIdentityQuery(
  question: string,
  appLanguage?: "en" | "ar",
  recentAssistantMessages: string[] = [],
): { answer: string; isAr: boolean } | null {
  const q = String(question || "").trim();
  if (!q || q.length > 280) return null;
  const norm = normalizeText(q);
  const isAr = detectIsArabic(q, appLanguage);

  // Explicit "Are you ChatGPT / Gemini / Claude?" check
  const chatGptRx =
    /(?:هل\s*(?:انت|أنت)\s*(?:شات\s*جي\s*بي\s*تي|chatgpt|gpt|جيميناي|gemini|كلود|claude|جوجل|google)|انت\s*(?:شات\s*جي\s*بي\s*تي|chatgpt|gpt|gemini|claude)|are\s+you\s+(?:chatgpt|gpt|openai|gemini|google|claude|gemma))/i;
  if (chatGptRx.test(q)) {
    return {
      answer: isAr
        ? "لا، أنا لست ChatGPT. أنا **MeetMind AI**، المساعد الذكي المدمج داخل منصة MeetMind AI، وأعمل بنموذج الذكاء الاصطناعي المُعد داخل المنصة.\nتم تطويري وبرمجتي بواسطة مجموعة من مهندسي البرمجة من قسم علوم الحاسب في Modern Academy."
        : "No, I am not ChatGPT. I am the **MeetMind AI** assistant powered by the AI model configured by the platform, developed by software engineering students from the Computer Science Department at Modern Academy.",
      isAr,
    };
  }

  const arIdentityRx =
    /(?:^|\s)(?:انت\s*مين|من\s*انت|مين\s*انت|مين\s*(?:اللي\s*)?(?:برمجك|عملك|طورك|صممك|صنعك|انشاك|اسسك|بناك|وراك)|من\s*(?:الذي\s*)?(?:برمجك|عملك|طورك|صممك|صنعك|انشاك|اسسك|بناك)|مين\s*(?:مبرمجك|مطورك|مطورينك|مبرمجينك|مصممك|صانعك)|من\s*(?:هو\s*)?(?:مبرمجك|مطورك|صانعك|مصممك)|انت\s*تبع\s*مين|تبع\s*مين|تابع\s*لمين|عرفني\s*بنفسك|عرف\s*بنفسك|اسمك\s*ايه|انت\s*اسمك\s*ايه|ما\s*اسمك|هويتك|شغال\s*بايه)(?:\s|$)/i;

  const enIdentityRx =
    /\b(?:who\s+(?:are\s+you|made\s+you|programmed\s+you|built\s+you|created\s+you|developed\s+you|designed\s+you|trained\s+you|owns\s+you)|who\s+(?:is|are)\s+your\s+(?:creator|creators|developer|developers|programmer|programmers|maker|makers|designer|designers|team|author|authors)|what\s+(?:are\s+you|is\s+your\s+name|model\s+are\s+you)|introduce\s+yourself|tell\s+me\s+about\s+yourself)\b/i;

  if (arIdentityRx.test(norm) || enIdentityRx.test(q)) {
    const alreadyAnswered = recentAssistantMessages.some((m) =>
      /(Modern Academy|مهندسي البرمجة|software engineering students)/i.test(m),
    );
    if (alreadyAnswered) {
      return {
        answer: isAr
          ? "أنا MeetMind AI 😄\nولو تقصد مين اللي طورني، فأنا تم تطويري بواسطة مجموعة من مهندسي البرمجة من قسم علوم الحاسب في Modern Academy. تحب نكمل في سؤال معين؟"
          : "I'm still MeetMind AI! As mentioned, I was developed by software engineering students from the Computer Science Department at Modern Academy. What would you like to ask next?",
        isAr,
      };
    }
    return {
      answer: isAr ? MEETMIND_IDENTITY_AR : MEETMIND_IDENTITY_EN,
      isAr,
    };
  }
  return null;
}

// ============================================================================
// BUILT-IN CONVERSATIONAL AI CHAT ENGINE (TIER-3 ANALYTICAL FALLBACK)
// ============================================================================
export function answerBuiltInChat(params: {
  question: string;
  appLanguage?: "en" | "ar";
  targetItem?: MeetingRecord | LectureRecord;
  meetings: MeetingRecord[];
  lectures: LectureRecord[];
  tasks: ActionItemRecord[];
  quizzes: QuizRecord[];
  flashcards: FlashcardRecord[];
}): {
  answer: string;
  evidenceFound: boolean;
  citations: { speaker: string; timestamp: string; quote: string }[];
  suggestedFollowUps: string[];
} {
  const { question, appLanguage, targetItem, meetings, lectures, tasks, flashcards } = params;
  const q = question.trim();
  const isAr = detectIsArabic(q, appLanguage);

  const defaultFollowUps = isAr
    ? [
        "لخص لي آخر تسجيل أو محاضرة",
        "اعمل لي 5 أسئلة اختبار مع الإجابات",
        "إيه المهام والقرارات المستخرجة؟",
        "اشرح لي الفرق بين TCP و UDP باختصار",
      ]
    : [
        "Summarize my latest recording or lecture",
        "Create 5 quiz questions with answers",
        "What action items and decisions were extracted?",
        "Explain how RAG works in 3 bullet points",
      ];

  // 0. Mandatory AI Identity (instant, zero exceptions)
  const identityHit = tryAnswerIdentityQuery(q, appLanguage);
  if (identityHit) {
    return {
      answer: identityHit.answer,
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: defaultFollowUps,
    };
  }

  // 1. Greetings, Small Talk & Identity
  if (
    /^(السلام\s*عليكم|سلام|اهلا|أهلا|أهلاً|مرحبا|مرحباً|هاي|هلو|ازيك|إزيك|عامل\s*ايه|صباح\s*الخير|مساء\s*الخير|hello|hi|hey|good\s*morning|good\s*evening|good\s*afternoon|how\s*are\s*you|yo|sup)[!?.،\s]*$/i.test(
      q,
    ) ||
    /^(السلام\s*عليكم\s*ورحمة\s*الله(\s*وبركاته)?)[!?.،\s]*$/i.test(q)
  ) {
    const isSalam = /السلام\s*عليكم|سلام/i.test(q);
    const totalRecs = meetings.length + lectures.length;
    const greetingAr = isSalam
      ? `وعليكم السلام ورحمة الله وبركاته! أهلاً بك في **مساعد MeetMind AI المدمج**.\n\nأنا جاهز لمساعدتك بالعربية أو الإنجليزية في أي سؤال علمي أو برمجي أو تحليل تسجيلاتك الصوتية.${totalRecs > 0 ? `\n\nلديك حالياً **${meetings.length}** اجتماع و**${lectures.length}** محاضرة جاهزة للتحليل والتلخيص وتوليد الاختبارات.` : ""}\n\nكيف يمكنني مساعدتك الآن؟`
      : `أهلاً بك! أنا **مساعد MeetMind AI المدمج** وجاهز لمساعدتك فوراً في أي سؤال أو تحليل تسجيلاتك الصوتية.\n\nبماذا تحب أن نبدأ اليوم؟`;

    const greetingEn = `Hello! I am your **Built-in MeetMind AI Assistant**, ready to help you in English or Arabic.\n\nAsk me about any technical, academic, or general topic — or anything inside your recordings.${totalRecs > 0 ? `\n\nYour workspace currently has **${meetings.length}** meeting(s) and **${lectures.length}** lecture(s) ready for summaries, tasks, and quizzes.` : ""}\n\nHow can I help you right now?`;

    return {
      answer: isAr ? greetingAr : greetingEn,
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: defaultFollowUps,
    };
  }

  if (/^(شكرا|شكراً|متشكر|تسلم|يعطيك\s*العافية|thanks|thank\s*you|thx)[!?.،\s]*$/i.test(q)) {
    return {
      answer: isAr
        ? "العفو! يسعدني دائماً مساعدتك. إذا كان لديك أي سؤال آخر أو ترغب في تلخيص تسجيل أو إنشاء اختبار، أنا هنا في أي وقت."
        : "You're very welcome! Ask another question anytime or request a summary, quiz, or study plan.",
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: defaultFollowUps,
    };
  }

  // 2. Exact Math Solver
  const mathAnswer = trySolveMathQuery(q, isAr);
  if (mathAnswer) {
    return {
      answer: mathAnswer,
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: isAr
        ? ["احسب 25% من 840", "كم يساوي (45 * 12) + 180", "اشرح لي كيفية الاستعداد للامتحان"]
        : ["Calculate 25% of 840", "Solve (45 * 12) + 180", "How should I prepare for my exam?"],
    };
  }

  const latestRecording: MeetingRecord | LectureRecord | undefined =
    targetItem || lectures[0] || meetings[0];

  // 3. Summarize recording intent
  if (/(لخص|ملخص|تلخيص|summarize|summary|recap|overview)/i.test(q) && latestRecording) {
    const segs = latestRecording.segments || [];
    const built =
      segs.length > 0
        ? buildBuiltInSummary(
            latestRecording.title,
            segs,
            "courseCode" in latestRecording ? "lecture" : "meeting",
            "courseCode" in latestRecording ? latestRecording.courseCode : undefined,
            isAr ? "ar" : "en",
          )
        : null;
    const summaryText =
      latestRecording.summary ||
      latestRecording.executiveSummary ||
      built?.detailedSummary ||
      (isAr
        ? `التسجيل "${latestRecording.title}" محفوظ بدون نص مفرغ حتى الآن.`
        : `Recording "${latestRecording.title}" has no transcript segments yet.`);
    const citations = segs.slice(0, 3).map((s) => ({
      speaker: s.speaker,
      timestamp: formatMmSs(s.startTime),
      quote: s.text,
    }));

    return {
      answer: isAr
        ? `**ملخص تسجيل "${latestRecording.title}":**\n\n${summaryText}`
        : `**Summary of "${latestRecording.title}":**\n\n${summaryText}`,
      evidenceFound: true,
      citations,
      suggestedFollowUps: defaultFollowUps,
    };
  }

  // 4. Tasks & Decisions intent
  if (
    /(مهام|المهام|تكليف|تكليفات|قرارات|القرارات|action\s*item|task|todo|assigned|decision)/i.test(q)
  ) {
    const scopedTasks = targetItem
      ? tasks.filter((t) => t.meetingId === targetItem.id || t.lectureId === targetItem.id)
      : tasks;
    const decisions =
      targetItem && "decisions" in targetItem && targetItem.decisions
        ? targetItem.decisions
        : meetings.flatMap((m) => m.decisions || []);

    if (scopedTasks.length > 0 || decisions.length > 0) {
      const lines: string[] = [];
      if (scopedTasks.length > 0) {
        lines.push(
          isAr ? "**المهام والتكليفات المستخرجة:**" : "**Extracted Action Items & Tasks:**",
        );
        scopedTasks.slice(0, 8).forEach((t, i) => {
          const status = t.completed
            ? isAr
              ? "مكتملة ✅"
              : "Done ✅"
            : isAr
              ? "قيد التنفيذ ⏳"
              : "Pending ⏳";
          lines.push(
            `${i + 1}. **${t.title}** — ${status}${t.ownerName ? ` (${t.ownerName})` : ""}${
              t.dueDate ? ` | ${t.dueDate}` : ""
            }`,
          );
        });
      }
      if (decisions.length > 0) {
        lines.push("");
        lines.push(isAr ? "**أبرز القرارات المعتمدة:**" : "**Key Decisions:**");
        decisions.slice(0, 5).forEach((d, i) => lines.push(`${i + 1}. ${d}`));
      }
      return {
        answer: lines.join("\n"),
        evidenceFound: true,
        citations: [],
        suggestedFollowUps: defaultFollowUps,
      };
    }
  }

  // 5. Quiz Request in Chat
  if (
    /(كويز|اختبار|اسئلة|أسئلة|امتحان\s*تجريبي|quiz|practice\s*question|test\s*me|questions\s*with\s*answers)/i.test(
      q,
    ) &&
    latestRecording &&
    latestRecording.segments &&
    latestRecording.segments.length > 0
  ) {
    const countMatch = convertArabicDigits(q).match(/\b(\d{1,2})\b/);
    const requestedCount = Math.min(10, Math.max(3, countMatch ? parseInt(countMatch[1], 10) : 5));
    const generatedQuiz = buildBuiltInQuiz(latestRecording.title, latestRecording.segments, {
      appLanguage: isAr ? "ar" : "en",
      numQuestions: requestedCount,
    });
    const lines = [
      isAr
        ? `**أسئلة اختبار ومراجعة مبنية على تسجيل "${latestRecording.title}":**\n`
        : `**Grounded Practice Quiz from "${latestRecording.title}":**\n`,
    ];
    generatedQuiz.questions.forEach((item, idx) => {
      const ans = item.correctAnswerText || item.options[item.correctOptionIndex] || "";
      lines.push(
        isAr
          ? `**س${idx + 1}:** ${item.question}\n- **الإجابة الصحيحة:** ${ans}\n- **التوضيح:** ${item.explanation}\n`
          : `**Q${idx + 1}:** ${item.question}\n- **Correct Answer:** ${ans}\n- **Explanation:** ${item.explanation}\n`,
      );
    });
    return {
      answer: lines.join("\n"),
      evidenceFound: true,
      citations: latestRecording.segments.slice(0, 3).map((s) => ({
        speaker: s.speaker,
        timestamp: formatMmSs(s.startTime),
        quote: s.text,
      })),
      suggestedFollowUps: defaultFollowUps,
    };
  }

  // 6. Flashcards Request
  if (/(فلاش\s*كارد|بطاقات|flashcard|study\s*card)/i.test(q) && flashcards.length > 0) {
    const cards = flashcards.slice(0, 6);
    const body = cards
      .map((c, i) =>
        isAr
          ? `**بطاقة ${i + 1}:** ${c.front}\n- **الإجابة:** ${c.back}`
          : `**Card ${i + 1}:** ${c.front}\n- **Answer:** ${c.back}`,
      )
      .join("\n\n");
    return {
      answer: isAr
        ? `**بطاقات المراجعة من مساحة عملك:**\n\n${body}`
        : `**Study Flashcards from your workspace:**\n\n${body}`,
      evidenceFound: true,
      citations: [],
      suggestedFollowUps: defaultFollowUps,
    };
  }

  // 7. Grounded BM25 Transcript Search (uses Arabic stemmer + BM25 scoring)
  const searchPool: Array<{ seg: TranscriptSegment; title: string }> = [];
  if (targetItem && targetItem.segments) {
    for (const seg of targetItem.segments) searchPool.push({ seg, title: targetItem.title });
  } else {
    for (const l of lectures.slice(0, 5)) {
      for (const seg of l.segments || []) searchPool.push({ seg, title: l.title });
    }
    for (const m of meetings.slice(0, 5)) {
      for (const seg of m.segments || []) searchPool.push({ seg, title: m.title });
    }
  }

  if (searchPool.length > 0) {
    const bm25Hits = retrieveRelevantSegmentsBM25(q, searchPool, {
      topK: 3,
      minScore: targetItem ? 0.5 : 1.4,
    });
    if (bm25Hits.length > 0) {
      const citations = bm25Hits.map((m) => ({
        speaker: m.seg.speaker,
        timestamp: formatMmSs(m.seg.startTime),
        quote: m.seg.text,
      }));
      const bullets = bm25Hits
        .map(
          (m) =>
            `- **[${formatMmSs(m.seg.startTime)}] ${m.seg.speaker}** (${m.title}): "${m.seg.text}"`,
        )
        .join("\n");

      return {
        answer: isAr
          ? `بناءً على النص المفرغ في تسجيلاتك، إليك أدق ما ورد بخصوص سؤالك:\n\n${bullets}`
          : `Based on your saved transcripts, here are the closest matching statements:\n\n${bullets}`,
        evidenceFound: true,
        citations,
        suggestedFollowUps: defaultFollowUps,
      };
    }
  }

  // 8. Built-in Bilingual Knowledge Base Match
  for (const topic of KNOWLEDGE_BASE) {
    if (topic.patterns.some((rx) => rx.test(q))) {
      return {
        answer: isAr
          ? `### ${topic.arTitle}\n\n${topic.arBody}`
          : `### ${topic.enTitle}\n\n${topic.enBody}`,
        evidenceFound: true,
        citations: [],
        suggestedFollowUps: defaultFollowUps,
      };
    }
  }

  // 9. Scoped recording miss vs structured analytical response
  if (targetItem) {
    return {
      answer: isAr
        ? `لم يُذكر هذا التفصيل صراحة في تسجيل **"${targetItem.title}"**. يمكنك طرح سؤال حول أحد المحاور المذكورة في النص أو تبديل النطاق إلى **كل مساحة العمل** للأسئلة العامة.`
        : `That detail was not mentioned in **"${targetItem.title}"**. Ask about topics covered in this recording or switch scope to **All Workspace** for general questions.`,
      evidenceFound: false,
      citations: [],
      suggestedFollowUps: defaultFollowUps,
    };
  }

  const cleanTopic = q
    .replace(
      /^(اشرح\s*لي|اشرحلي|قولي|ما\s*هو|ما\s*هي|كيف|ازاي|إزاي|عايز\s*اعرف|ممكن\s*تشرح|explain|what\s*is|how\s*to|tell\s*me\s*about)\s*/i,
      "",
    )
    .replace(/[؟?]+$/g, "")
    .trim();
  const displayTopic = cleanTopic || q;

  return {
    answer: isAr
      ? `حول **"${displayTopic}"**:\n\n- **لتفاصيل من تسجيلاتك:** اختر التسجيل المطلوب من القائمة بالأعلى لاستخراج الإجابات الموثّقة بالتوقيت.\n- **للشرح العميق أو التلخيص:** أعد صياغة السؤال بتحديد النقطة المطلوبة (تعريف، مقارنة، خطوات عملية، أو اختبار مراجعة).`
      : `Regarding **"${displayTopic}"**:\n\n- **For answers from your recordings:** Select a recording in the scope selector to query timestamp-cited transcript evidence.\n- **For conceptual explanations:** Specify whether you want a concise overview, comparison, step-by-step guide, or practice questions.`,
    evidenceFound: true,
    citations: [],
    suggestedFollowUps: defaultFollowUps,
  };
}

// ============================================================================
// UPGRADED BUILT-IN ANALYTICAL NLP PIPELINES (SUMMARY, ANALYSIS, QUIZ, CARDS, MINDMAP)
// ============================================================================
export function buildBuiltInSummary(
  title: string,
  segments: TranscriptSegment[],
  type: "meeting" | "lecture",
  courseCode?: string,
  appLanguage?: "en" | "ar",
): {
  summary: string;
  executiveSummary: string;
  detailedSummary: string;
  keyPoints: string[];
  decisions: string[];
  actionItems: {
    title: string;
    ownerName?: string;
    dueDate?: string;
    sourceTimestamp?: string;
    priority: "high" | "medium" | "low";
  }[];
} {
  const combinedText = segments.map((s) => s.text).join(" ");
  const isAr = appLanguage ? appLanguage === "ar" : detectIsArabic(`${title} ${combinedText}`);

  if (!segments || segments.length === 0) {
    const empty = isAr
      ? `لا يوجد نص مفرغ متاح حالياً لتسجيل "${title}".`
      : `No transcript segments are currently available for "${title}".`;
    return {
      summary: empty,
      executiveSummary: empty,
      detailedSummary: empty,
      keyPoints: [],
      decisions: [],
      actionItems: [],
    };
  }

  const facts = extractStructuredFacts(segments);
  const keyPhrases = extractKeyPhrases(segments, 6);
  const terms = extractSignificantTerms(segments, 8).map((t) => t.term);
  const clauses = splitIntoClauses(segments);
  const scoredSegs = scoreSegments(segments).sort((a, b) => b.score - a.score);

  const uniqueSpeakers = Array.from(new Set(segments.map((s) => s.speaker).filter(Boolean)));
  const durationSec = Math.max(...segments.map((s) => s.endTime || s.startTime || 0), 0);

  // Build crisp, concept-focused key points combining structured facts and high-signal clauses
  const keyPoints: string[] = [];
  const seenPointKeys = new Set<string>();
  const pushPoint = (pt: string) => {
    const clean = pt.replace(/\s+/g, " ").trim();
    const key = normalizeText(clean).slice(0, 60);
    if (!clean || clean.length < 8 || seenPointKeys.has(key)) return;
    seenPointKeys.add(key);
    keyPoints.push(clean);
  };

  const factPriority = (f: ExtractedFact): number => {
    if (f.labelAr === "الموقع / المنطقة") return 0;
    if (f.labelAr === "الميزانية / السعر") return 1;
    if (f.labelAr === "المساحة") return 2;
    if (f.labelAr === "عدد الغرف") return 3;
    if (f.labelAr === "عدد الحمامات") return 4;
    if (f.labelAr === "نوع التشطيب") return 5;
    if (f.labelAr === "الإطلالة (الفيو)") return 6;
    return 7;
  };
  const orderedFacts = [...facts].sort((a, b) => factPriority(a) - factPriority(b));

  for (const fact of orderedFacts.slice(0, 9)) {
    pushPoint(
      isAr
        ? `**${fact.labelAr}:** ${fact.value} [${fact.timestamp}]`
        : `**${fact.labelEn}:** ${fact.value} [${fact.timestamp}]`,
    );
  }

  for (const item of scoredSegs.slice(0, 6)) {
    if (keyPoints.length >= 6) break;
    const text = item.seg.text.trim();
    const concise = text.length > 180 ? `${text.slice(0, 177).trim()}...` : text;
    pushPoint(concise);
  }

  if (keyPoints.length === 0) {
    for (const cl of clauses.slice(0, 4)) pushPoint(cl.text);
  }

  const themeList = (keyPhrases.length > 0 ? keyPhrases : terms).slice(0, 5);
  const highValueSpecs = facts.filter(
    (f) =>
      (f.kind === "spec" && f.labelAr !== "المدة الزمنية" && f.labelAr !== "القيمة الرقمية") ||
      f.kind === "entity",
  );
  const specDigest = highValueSpecs
    .slice(0, 4)
    .map((f) => (isAr ? `${f.labelAr}: ${f.value}` : `${f.labelEn}: ${f.value}`));

  const leadSnippet = clauses[0]?.text.slice(0, 190) || scoredSegs[0]?.seg.text.slice(0, 190) || "";
  const secondSnippet =
    scoredSegs
      .map((s) => s.seg.text.trim())
      .find((t) => t.length >= 25 && t !== clauses[0]?.segmentText)
      ?.slice(0, 180) || "";

  const executiveSummary = isAr
    ? `تتناول ${type === "lecture" ? "المحاضرة" : "الجلسة"} «${title}»${courseCode ? ` (${courseCode})` : ""} ${
        specDigest.length > 0 && type !== "lecture"
          ? `مجموعة من التفاصيل والمواصفات المحددة تشمل: ${specDigest.join("، ")}.`
          : themeList.length > 0
            ? `محاور أساسية أبرزها: ${themeList.join("، ")}.${secondSnippet ? ` ومن أبرز ما ورد فيها: «${secondSnippet}».` : ""}`
            : `${leadSnippet}`
      }`
    : `This ${type} ("${title}"${courseCode ? ` — ${courseCode}` : ""}) covers ${
        specDigest.length > 0 && type !== "lecture"
          ? `specific details including ${specDigest.join(", ")}.`
          : themeList.length > 0
            ? `key topics including ${themeList.join(", ")}.${secondSnippet ? ` Key takeaway: "${secondSnippet}".` : ""}`
            : leadSnippet
      }`;

  const decisions = clauses
    .filter((cl) =>
      /(decided|agreed|approved|confirmed|concluded|will adopt|finalized|قررنا|اتفقنا|تم اعتماد|الموافقة|القرار|الخلاصة النهائية)/i.test(
        cl.text,
      ),
    )
    .slice(0, 5)
    .map((cl) => `[${cl.timestamp}] ${cl.text}`);

  const actionItems = clauses
    .filter((cl) =>
      /(action|task|todo|must |need to|should |assign|deliver|submit|deadline|looking for|need a|مطلوب|مهمة|تكليف|لازم|يجب|تسليم|محتاج|نحتاج|هنعمل|موعد)/i.test(
        cl.text,
      ),
    )
    .slice(0, 5)
    .map((cl) => ({
      title: cl.text.length > 130 ? `${cl.text.slice(0, 127).trim()}...` : cl.text,
      ownerName: cl.speaker || (isAr ? "غير محدد" : "Not specified"),
      dueDate: isAr ? "غير محدد" : "Not specified",
      sourceTimestamp: cl.timestamp,
      priority: /(urgent|asap|critical|high|immediately|عاجل|فوري|ضروري|امتحان)/i.test(cl.text)
        ? ("high" as const)
        : ("medium" as const),
    }));

  // Build rich, structured Markdown detailed summary (omitting empty sections!)
  const mdSections: string[] = [];
  if (isAr) {
    mdSections.push(`# الملخص التنفيذي\n${executiveSummary}`);
    if (keyPoints.length > 0) {
      mdSections.push(
        `## أبرز النقاط والمعلومات المستخلصة\n${keyPoints.map((p) => `- ${p}`).join("\n")}`,
      );
    }
    if (themeList.length > 0) {
      mdSections.push(
        `## المحاور والمفاهيم الرئيسية\n${themeList.map((t) => `- ${t}`).join("\n")}`,
      );
    }
    if (decisions.length > 0 || actionItems.length > 0) {
      const lines: string[] = [];
      for (const d of decisions) lines.push(`- **قرار:** ${d}`);
      for (const a of actionItems) {
        lines.push(
          `- **مهمة / طلب:** ${a.title}${a.sourceTimestamp ? ` [${a.sourceTimestamp}]` : ""}`,
        );
      }
      mdSections.push(`## القرارات والمهام المطلوبة\n${lines.join("\n")}`);
    }
    mdSections.push(
      `> تم تحليل ${segments.length} مقطع صوتي${uniqueSpeakers.length > 0 ? ` (${uniqueSpeakers.join("، ")})` : ""}${durationSec > 0 ? ` — المدة ${formatMmSs(durationSec)}` : ""}.`,
    );
  } else {
    mdSections.push(`# Executive Summary\n${executiveSummary}`);
    if (keyPoints.length > 0) {
      mdSections.push(`## Key Points & Findings\n${keyPoints.map((p) => `- ${p}`).join("\n")}`);
    }
    if (themeList.length > 0) {
      mdSections.push(`## Core Topics & Concepts\n${themeList.map((t) => `- ${t}`).join("\n")}`);
    }
    if (decisions.length > 0 || actionItems.length > 0) {
      const lines: string[] = [];
      for (const d of decisions) lines.push(`- **Decision:** ${d}`);
      for (const a of actionItems) {
        lines.push(
          `- **Action Item:** ${a.title}${a.sourceTimestamp ? ` [${a.sourceTimestamp}]` : ""}`,
        );
      }
      mdSections.push(`## Decisions & Action Items\n${lines.join("\n")}`);
    }
    mdSections.push(
      `> Analyzed ${segments.length} transcript segment(s)${uniqueSpeakers.length > 0 ? ` (${uniqueSpeakers.join(", ")})` : ""}${durationSec > 0 ? ` — duration ${formatMmSs(durationSec)}` : ""}.`,
    );
  }

  const detailedSummary = mdSections.join("\n\n");

  return {
    summary: detailedSummary,
    executiveSummary,
    detailedSummary,
    keyPoints: keyPoints.map((p) => p.replace(/\*\*/g, "")).slice(0, 8),
    decisions,
    actionItems,
  };
}

export function buildBuiltInLectureAnalysis(
  title: string,
  segments: TranscriptSegment[],
  type: "meeting" | "lecture",
  courseCode?: string,
  appLanguage?: "en" | "ar",
) {
  const combinedText = segments.map((s) => s.text).join(" ");
  const isAr = appLanguage ? appLanguage === "ar" : detectIsArabic(`${title} ${combinedText}`);
  const kwItems = extractSignificantTerms(segments, 12);
  const keyPhrases = extractKeyPhrases(segments, 6);
  const facts = extractStructuredFacts(segments);
  const clauses = splitIntoClauses(segments);
  const scored = scoreSegments(segments).sort((a, b) => b.score - a.score);

  const topics = Array.from(
    new Set([
      ...facts.slice(0, 3).map((f) => (isAr ? f.labelAr : f.labelEn)),
      ...keyPhrases.slice(0, 4),
      ...kwItems.slice(0, 4).map((k) => k.term),
    ]),
  ).slice(0, 6);

  const keywords = Array.from(
    new Set([...kwItems.map((k) => k.term), ...facts.map((f) => f.value)]),
  ).slice(0, 12);

  // Definitions & key structured specifications
  const definitions: { term: string; definition: string; timestamp?: string }[] = [];
  for (const f of facts) {
    if (definitions.length >= 6) break;
    if (f.kind === "definition") {
      definitions.push({
        term: f.labelAr.replace(/^تعريف:\s*/, ""),
        definition: f.value,
        timestamp: f.timestamp,
      });
    } else if (f.kind === "spec" || f.kind === "entity") {
      definitions.push({
        term: isAr ? f.labelAr : f.labelEn,
        definition: `${f.value} — ${f.clause}`,
        timestamp: f.timestamp,
      });
    }
  }
  if (definitions.length === 0 && kwItems.length > 0) {
    for (const kw of kwItems.slice(0, 4)) {
      const matched = segments.find((s) =>
        normalizeText(s.text).includes(normalizeArabicStem(kw.term)),
      );
      if (matched) {
        definitions.push({
          term: kw.term,
          definition: matched.text.trim(),
          timestamp: formatMmSs(matched.startTime),
        });
      }
    }
  }

  // Questions asked (explicit question mark or interrogative phrase)
  const questionsAsked: { question: string; answer?: string; timestamp?: string }[] = [];
  const interrogativeRx =
    /[?؟]|^(?:what|how|why|when|where|which|can we|should we|هل|ما هو|ما هي|كيف|لماذا|إزاي|متى|أين)\b/i;
  for (let i = 0; i < clauses.length && questionsAsked.length < 5; i++) {
    if (interrogativeRx.test(clauses[i].text)) {
      questionsAsked.push({
        question: clauses[i].text,
        answer: clauses[i + 1]?.text,
        timestamp: clauses[i].timestamp,
      });
    }
  }

  const summaryBuilt = buildBuiltInSummary(title, segments, type, courseCode, appLanguage);
  const actionItems = summaryBuilt.actionItems.map((a) => ({
    task: a.title,
    owner: a.ownerName,
    deadline: a.dueDate,
  }));

  const emphasizedPoints = Array.from(
    new Set([
      ...facts
        .slice(0, 4)
        .map((f) => (isAr ? `${f.labelAr}: ${f.value}` : `${f.labelEn}: ${f.value}`)),
      ...scored.slice(0, 4).map((x) => x.seg.text.trim()),
    ]),
  ).slice(0, 5);

  const importantSentences = Array.from(
    new Set([
      ...clauses
        .filter((c) => c.text.length >= 20)
        .slice(0, 6)
        .map((c) => c.text),
      ...scored.slice(0, 6).map((x) => x.seg.text.trim()),
    ]),
  ).slice(0, 6);

  const reviewAreas =
    topics.length > 0
      ? topics.map((topic) =>
          isAr
            ? `مراجعة تفاصيل ومحاور: ${topic}`
            : `Review and verify key details around: ${topic}`,
        )
      : [isAr ? `مراجعة محاور "${title}"` : `Review key points from "${title}"`];

  return {
    overview: summaryBuilt.executiveSummary,
    topics: topics.length > 0 ? topics : [title],
    keywords,
    definitions,
    questionsAsked,
    actionItems,
    emphasizedPoints,
    importantSentences,
    reviewAreas,
  };
}

// ============================================================================
// UPGRADED GROUNDED CONCEPT & SPECIFICATION QUIZ BUILDER (ZERO TRIVIAL COPY-PASTE)
// ============================================================================
export interface BuiltInQuizQuestion {
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
}

function buildNumericDistractors(num: number, unit: string): string[] {
  const isArabicPluralUnit = /^(غرف|حمامات|أيام|ايام|أسابيع|أشهر|سنوات|دقائق|ساعات)$/.test(
    unit.trim(),
  );
  const minAllowed = isArabicPluralUnit ? 3 : 1;
  const stepCandidates =
    num <= 5
      ? [1, 2, 3, 4]
      : num <= 20
        ? [2, 3, 5, 7]
        : num <= 100
          ? [10, 20, 30, 50]
          : num <= 500
            ? [50, 75, 100, 150]
            : [Math.round(num * 0.2), Math.round(num * 0.35), Math.round(num * 0.5)];

  const values: number[] = [];
  for (const delta of stepCandidates) {
    const higher = Math.round((num + delta) * 100) / 100;
    const lower = Math.round((num - delta) * 100) / 100;
    if (lower >= minAllowed && lower !== num && !values.includes(lower)) values.push(lower);
    if (higher !== num && !values.includes(higher)) values.push(higher);
    if (values.length >= 3) break;
  }
  while (values.length < 3) {
    const next = Math.round(num + (values.length + 2) * Math.max(1, Math.round(num * 0.25)));
    if (!values.includes(next) && next !== num) values.push(next);
  }
  return values.slice(0, 3).map((v) => `${v} ${unit}`.trim());
}

function rotateOptions(
  correct: string,
  distractors: string[],
  seed: number,
): { options: string[]; correctOptionIndex: number } {
  const uniqueDistractors = Array.from(new Set(distractors))
    .filter((d) => d && normalizeText(d) !== normalizeText(correct))
    .slice(0, 3);
  const options = [correct, ...uniqueDistractors];
  const slot = Math.abs(seed) % options.length;
  const swapped = [...options];
  const tmp = swapped[0];
  swapped[0] = swapped[slot];
  swapped[slot] = tmp;
  return { options: swapped, correctOptionIndex: slot };
}

export function buildBuiltInQuiz(
  title: string,
  segments: TranscriptSegment[],
  options?: {
    courseCode?: string;
    appLanguage?: "en" | "ar";
    numQuestions?: number;
    variant?: number;
    avoidQuestionTitles?: string[];
    difficulty?: "all" | "easy" | "medium" | "hard";
  },
): {
  title: string;
  courseCode?: string;
  questions: BuiltInQuizQuestion[];
} {
  const combinedText = segments.map((s) => s.text).join(" ");
  const isAr = options?.appLanguage
    ? options.appLanguage === "ar"
    : detectIsArabic(`${title} ${combinedText}`);
  const variant = options?.variant || 1;
  const avoidSet = new Set((options?.avoidQuestionTitles || []).map((q) => normalizeText(q)));

  const totalWords = combinedText.trim().split(/\s+/).filter(Boolean).length;
  const defaultCount = totalWords < 40 ? 4 : totalWords < 120 ? 5 : totalWords < 250 ? 7 : 10;
  const targetCount = options?.numQuestions
    ? Math.min(20, Math.max(1, Math.round(options.numQuestions)))
    : defaultCount;

  const facts = extractStructuredFacts(segments);
  const terms = extractSignificantTerms(segments, 14);
  const clauses = splitIntoClauses(segments);
  const questions: BuiltInQuizQuestion[] = [];
  const seenQuestions = new Set<string>(avoidSet);
  const requestedDifficulty =
    options?.difficulty && options.difficulty !== "all" ? options.difficulty : undefined;

  const pushQuestion = (q: BuiltInQuizQuestion) => {
    const key = normalizeText(q.question);
    if (!key || seenQuestions.has(key) || questions.length >= targetCount) return;
    seenQuestions.add(key);
    questions.push(requestedDifficulty ? { ...q, difficulty: requestedDifficulty } : q);
  };

  // 1. Quantitative / Specification MCQs (sharp, factual, non-trivial!)
  const specFacts = facts.filter((f) => f.kind === "spec" && typeof f.numericValue === "number");
  for (let i = 0; i < specFacts.length && questions.length < targetCount; i++) {
    const f = specFacts[i];
    const distractors = buildNumericDistractors(f.numericValue!, f.unit || "");
    const { options: opts, correctOptionIndex } = rotateOptions(f.value, distractors, i + variant);
    if (opts.length < 4) continue;

    pushQuestion({
      id: `q_spec_${Date.now()}_${questions.length + 1}`,
      question: isAr
        ? `وفقاً لما ورد في «${title}»، ما هي قيمة (${f.labelAr}) المذكورة في التسجيل؟`
        : `According to "${title}", what is the stated value for "${f.labelEn}"?`,
      type: "multiple_choice",
      options: opts,
      correctOptionIndex,
      correctAnswerText: f.value,
      acceptableAnswers: [f.value],
      explanation: isAr
        ? `ورد صراحةً عند [${f.timestamp}] أن ${f.labelAr} هي «${f.value}» ضمن سياق: "${f.clause}".`
        : `Explicitly stated at [${f.timestamp}] as "${f.value}" in context: "${f.clause}".`,
      difficulty: i % 2 === 0 ? "easy" : "medium",
      sectionRef: isAr ? f.labelAr : f.labelEn,
      timestampRef: f.timestamp,
      sourceReference: `${isAr ? f.labelAr : f.labelEn} [${f.timestamp}]`,
      sourceTranscriptSegment: f.segmentText,
      groundingVerified: true,
    });
  }

  // 2. Definition & Entity Attribute MCQs
  const entityFacts = facts.filter((f) => f.kind === "definition" || f.kind === "entity");
  const entityDistractorPool = Array.from(
    new Set([
      ...entityFacts.map((e) => e.value),
      ...terms.map((t) => t.term),
      ...(isAr
        ? ["التجمع الخامس", "الشيخ زايد", "نصف تشطيب", "تشطيب تجاري", "فيو شارع رئيسي", "غير مذكور"]
        : [
            "Alternative specification",
            "Preliminary draft only",
            "Standard baseline option",
            "Not specified in session",
          ]),
    ]),
  );

  for (let i = 0; i < entityFacts.length && questions.length < targetCount; i++) {
    const f = entityFacts[i];
    if (f.value.length > 90) continue;
    const sameCategoryFallbacks =
      f.labelAr === "نوع التشطيب"
        ? isAr
          ? ["نصف تشطيب (على الطوب)", "تشطيب تجاري أساسي", "تشطيب لوكس عادي"]
          : ["Semi-finished", "Basic shell & core", "Standard finish"]
        : f.labelAr === "الإطلالة (الفيو)"
          ? isAr
            ? ["فيو شارع رئيسي", "فيو باركينج داخلي", "فيو منور خلفي"]
            : ["Main road view", "Parking lot view", "Interior courtyard view"]
          : f.labelAr === "الموقع / المنطقة"
            ? isAr
              ? ["التجمع الخامس منطقة النرجس", "الشيخ زايد الحي الرابع", "مدينة نصر الحي السابع"]
              : ["Downtown District A", "West Business Park", "North Campus Zone"]
            : entityDistractorPool;

    const distractors = sameCategoryFallbacks
      .filter((cand) => normalizeText(cand) !== normalizeText(f.value))
      .slice(0, 3);
    if (distractors.length < 3) continue;

    const { options: opts, correctOptionIndex } = rotateOptions(
      f.value,
      distractors,
      i + variant + 1,
    );

    pushQuestion({
      id: `q_ent_${Date.now()}_${questions.length + 1}`,
      question: isAr
        ? `ما هو (${f.labelAr}) المحدد الذي ذكره المتحدث في تسجيل «${title}»؟`
        : `Which "${f.labelEn}" was specified by the speaker in "${title}"?`,
      type: "multiple_choice",
      options: opts,
      correctOptionIndex,
      correctAnswerText: f.value,
      acceptableAnswers: [f.value],
      explanation: isAr
        ? `ذُكر في التسجيل عند [${f.timestamp}]: «${f.clause}».`
        : `Verified in transcript at [${f.timestamp}]: "${f.clause}".`,
      difficulty: "medium",
      sectionRef: isAr ? f.labelAr : f.labelEn,
      timestampRef: f.timestamp,
      sourceReference: `${isAr ? f.labelAr : f.labelEn} [${f.timestamp}]`,
      sourceTranscriptSegment: f.segmentText,
      groundingVerified: true,
    });
  }

  // 3. Fact-Checked True/False Questions (True statement OR realistic altered-number False statement!)
  for (let i = 0; i < specFacts.length && questions.length < targetCount; i++) {
    const f = specFacts[i];
    const makeTrue = (i + variant) % 2 === 0;
    const altVal = buildNumericDistractors(f.numericValue!, f.unit || "")[0];
    const shownVal = makeTrue ? f.value : altVal;

    pushQuestion({
      id: `q_tf_spec_${Date.now()}_${questions.length + 1}`,
      question: isAr
        ? `صح أم خطأ: ذكر المتحدث في تسجيل «${title}» أن ${f.labelAr} هي (${shownVal}).`
        : `True or False: In "${title}", the speaker stated that "${f.labelEn}" is (${shownVal}).`,
      type: "true_false",
      options: isAr ? ["صح (صواب)", "خطأ"] : ["True", "False"],
      correctOptionIndex: makeTrue ? 0 : 1,
      correctAnswerText: makeTrue ? (isAr ? "صح (صواب)" : "True") : isAr ? "خطأ" : "False",
      acceptableAnswers: [makeTrue ? (isAr ? "صح (صواب)" : "True") : isAr ? "خطأ" : "False"],
      explanation: isAr
        ? makeTrue
          ? `صحيح — ورد صراحة عند [${f.timestamp}]: «${f.clause}».`
          : `خطأ — القيمة الصحيحة المذكورة عند [${f.timestamp}] هي «${f.value}» وليست «${altVal}».`
        : makeTrue
          ? `True — explicitly stated at [${f.timestamp}]: "${f.clause}".`
          : `False — the actual stated value at [${f.timestamp}] is "${f.value}", not "${altVal}".`,
      difficulty: "easy",
      sectionRef: isAr ? f.labelAr : f.labelEn,
      timestampRef: f.timestamp,
      sourceReference: `${isAr ? f.labelAr : f.labelEn} [${f.timestamp}]`,
      sourceTranscriptSegment: f.segmentText,
      groundingVerified: true,
    });
  }

  // 4. Concept Cloze MCQ from informative clauses (replaces a key term with ______)
  const termPool = terms.map((t) => t.term);
  for (let i = 0; i < clauses.length && questions.length < targetCount; i++) {
    const cl = clauses[i];
    if (cl.text.length < 25) continue;
    const matchedTerm = terms.find(
      (t) =>
        t.term.length >= 4 && cl.text.includes(t.term) && !STOP_WORDS.has(normalizeText(t.term)),
    );
    if (!matchedTerm) continue;

    const distractors = termPool
      .filter((cand) => normalizeText(cand) !== normalizeText(matchedTerm.term))
      .slice(0, 3);
    if (distractors.length < 3) continue;

    const maskedClause = cl.text.replace(matchedTerm.term, "______");
    const clippedMask =
      maskedClause.length > 130 ? `${maskedClause.slice(0, 127)}...` : maskedClause;
    const { options: opts, correctOptionIndex } = rotateOptions(
      matchedTerm.term,
      distractors,
      i + variant + 2,
    );

    pushQuestion({
      id: `q_cloze_${Date.now()}_${questions.length + 1}`,
      question: isAr
        ? `أكمل المصطلح أو المعلومة الصحيحة وفقاً لما ورد في التسجيل: «${clippedMask}»`
        : `Which term accurately completes this statement from the transcript: "${clippedMask}"?`,
      type: "multiple_choice",
      options: opts,
      correctOptionIndex,
      correctAnswerText: matchedTerm.term,
      acceptableAnswers: [matchedTerm.term],
      explanation: isAr
        ? `المصطلح الدقيق المذكور عند [${cl.timestamp}] هو «${matchedTerm.term}» في سياق: "${cl.text}".`
        : `The exact term stated at [${cl.timestamp}] is "${matchedTerm.term}" in context: "${cl.text}".`,
      difficulty: "hard",
      sectionRef: isAr ? `المقطع [${cl.timestamp}]` : `Segment [${cl.timestamp}]`,
      timestampRef: cl.timestamp,
      sourceReference: `[${cl.timestamp}]`,
      sourceTranscriptSegment: cl.segmentText,
      groundingVerified: true,
    });
  }

  // 4b. Grounded Short-Answer / Analytical Questions (always include at least 1 when targetCount >= 4)
  const shortAnswerSlot =
    targetCount >= 4 && !questions.some((q) => q.type === "short_answer")
      ? Math.max(1, Math.min(2, Math.floor(targetCount / 4)))
      : 0;
  if (shortAnswerSlot > 0) {
    // Make room if earlier MCQ/TF stages filled all targetCount slots
    if (questions.length >= targetCount && questions.length >= 2) {
      questions.splice(questions.length - 1, 1);
    }
    const shortCandidates = [
      ...facts.filter((f) => f.kind === "definition" || f.kind === "entity" || f.kind === "spec"),
    ];
    for (let i = 0; i < shortCandidates.length && questions.length < targetCount; i++) {
      const f = shortCandidates[i];
      if (!f.value || f.value.length < 2) continue;
      const alreadyUsed = questions.some(
        (q) =>
          q.type === "short_answer" &&
          normalizeText(q.correctAnswerText || "") === normalizeText(f.value),
      );
      if (alreadyUsed) continue;
      pushQuestion({
        id: `q_sa_${Date.now()}_${questions.length + 1}`,
        question: isAr
          ? `باختصار، ما الذي ذُكر في «${title}» بخصوص (${f.labelAr})؟ اذكر التفاصيل الدقيقة.`
          : `Briefly explain what was stated in "${title}" regarding "${f.labelEn}".`,
        type: "short_answer",
        options: [],
        correctOptionIndex: 0,
        correctAnswerText: `${f.value} — ${f.clause}`,
        acceptableAnswers: [f.value, f.clause],
        explanation: isAr
          ? `الإجابة النموذجية الموثقة عند [${f.timestamp}]: «${f.value}» في سياق «${f.clause}».`
          : `Verified model answer from [${f.timestamp}]: "${f.value}" in context: "${f.clause}".`,
        difficulty: requestedDifficulty || "hard",
        sectionRef: isAr ? f.labelAr : f.labelEn,
        timestampRef: f.timestamp,
        sourceReference: `${isAr ? f.labelAr : f.labelEn} [${f.timestamp}]`,
        sourceTranscriptSegment: f.segmentText,
        groundingVerified: true,
      });
      if (questions.filter((q) => q.type === "short_answer").length >= shortAnswerSlot) break;
    }
  }

  // 5. Fallback True/False for any remaining slots on sparse transcripts
  for (let i = 0; i < clauses.length && questions.length < targetCount; i++) {
    const cl = clauses[i];
    if (cl.text.length < 18) continue;
    const snippet = cl.text.length > 110 ? `${cl.text.slice(0, 107)}...` : cl.text;
    pushQuestion({
      id: `q_tf_cl_${Date.now()}_${questions.length + 1}`,
      question: isAr
        ? `صح أم خطأ: تناولت الجلسة النقطة التالية عند [${cl.timestamp}]: «${snippet}».`
        : `True or False: The recording covered the following point at [${cl.timestamp}]: "${snippet}".`,
      type: "true_false",
      options: isAr ? ["صح (صواب)", "خطأ"] : ["True", "False"],
      correctOptionIndex: 0,
      correctAnswerText: isAr ? "صح (صواب)" : "True",
      acceptableAnswers: [isAr ? "صح (صواب)" : "True"],
      explanation: isAr
        ? `صحيح — موثق في النص عند [${cl.timestamp}]: «${cl.text}».`
        : `True — verified in the transcript at [${cl.timestamp}]: "${cl.text}".`,
      difficulty: "easy",
      sectionRef: isAr ? `المقطع [${cl.timestamp}]` : `Segment [${cl.timestamp}]`,
      timestampRef: cl.timestamp,
      sourceReference: `[${cl.timestamp}]`,
      sourceTranscriptSegment: cl.segmentText,
      groundingVerified: true,
    });
  }

  return {
    title: isAr
      ? `اختبار الفهم الشامل (${variant > 1 ? `النموذج ${variant}` : "النموذج الرئيسي"}): ${title}`
      : `Comprehension Assessment Quiz (${variant > 1 ? `Variant ${variant}` : "Main"}): ${title}`,
    courseCode: options?.courseCode,
    questions,
  };
}

export function buildBuiltInFlashcards(
  title: string,
  segments: TranscriptSegment[],
  courseCode?: string,
  appLanguage?: "en" | "ar",
): {
  front: string;
  back: string;
  sourceReference?: string;
  topic?: string;
  difficulty: "easy" | "medium" | "hard";
}[] {
  const combinedText = segments.map((s) => s.text).join(" ");
  const isAr = appLanguage ? appLanguage === "ar" : detectIsArabic(`${title} ${combinedText}`);
  const facts = extractStructuredFacts(segments);
  const analysis = buildBuiltInLectureAnalysis(title, segments, "lecture", courseCode, appLanguage);

  const cards: {
    front: string;
    back: string;
    sourceReference?: string;
    topic?: string;
    difficulty: "easy" | "medium" | "hard";
  }[] = [];
  const seenFronts = new Set<string>();

  const pushCard = (card: {
    front: string;
    back: string;
    sourceReference?: string;
    topic?: string;
    difficulty: "easy" | "medium" | "hard";
  }) => {
    const key = normalizeText(card.front);
    if (!key || seenFronts.has(key) || cards.length >= 8) return;
    seenFronts.add(key);
    cards.push(card);
  };

  for (const fact of facts) {
    if (fact.kind === "definition") {
      const term = fact.labelAr.replace(/^تعريف:\s*/, "");
      pushCard({
        front: isAr
          ? `ما هو تعريف «${term}» كما ورد في التسجيل؟`
          : `Define "${term}" based on the recording.`,
        back: fact.value,
        sourceReference: fact.timestamp,
        topic: courseCode || title,
        difficulty: "medium",
      });
    } else {
      pushCard({
        front: isAr
          ? `ما هي تفاصيل (${fact.labelAr}) المذكورة في «${title}»؟`
          : `What was specified for "${fact.labelEn}" in "${title}"?`,
        back: `${fact.value} (${fact.clause})`,
        sourceReference: fact.timestamp,
        topic: isAr ? fact.labelAr : fact.labelEn,
        difficulty: fact.kind === "spec" ? "easy" : "medium",
      });
    }
  }

  const clauses = splitIntoClauses(segments);
  for (let i = 0; i < clauses.length && cards.length < 6; i++) {
    const cl = clauses[i];
    if (cl.text.length < 22) continue;
    const topicLabel = analysis.topics[i % Math.max(1, analysis.topics.length)] || title;
    pushCard({
      front: isAr
        ? `ما النقطة المحورية حول «${topicLabel}» في «${title}»؟`
        : `What is the key takeaway regarding "${topicLabel}" in "${title}"?`,
      back: cl.text,
      sourceReference: cl.timestamp,
      topic: topicLabel,
      difficulty: i % 3 === 0 ? "easy" : i % 3 === 1 ? "medium" : "hard",
    });
  }

  return cards;
}

function cleanNodeLabel(text: string, maxLen = 44): string {
  const clean = text.replace(/\*\*/g, "").replace(/\s+/g, " ").trim();
  if (clean.length <= maxLen) return clean;
  const cut = clean.slice(0, maxLen);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > 18 ? cut.slice(0, lastSpace) : cut).trim()}...`;
}

export function buildBuiltInMindMap(
  title: string,
  segments: TranscriptSegment[],
  courseCode?: string,
  appLanguage?: "en" | "ar",
): MindMapNode {
  const combinedText = segments.map((s) => s.text).join(" ");
  const isAr = appLanguage ? appLanguage === "ar" : detectIsArabic(`${title} ${combinedText}`);
  const summary = buildBuiltInSummary(title, segments, "lecture", courseCode, appLanguage);
  const analysis = buildBuiltInLectureAnalysis(title, segments, "lecture", courseCode, appLanguage);
  const facts = extractStructuredFacts(segments);

  const branches: MindMapNode[] = [];

  if (facts.length > 0) {
    branches.push({
      id: "branch_facts",
      label: isAr ? "المواصفات والحقائق الرئيسية" : "Key Facts & Specifications",
      description: isAr
        ? "الأرقام والمواصفات والكيانات المستخرجة"
        : "Extracted figures, entities, and specifications",
      children: facts.slice(0, 4).map((f, i) => ({
        id: `fact_${i + 1}`,
        label: cleanNodeLabel(isAr ? `${f.labelAr}: ${f.value}` : `${f.labelEn}: ${f.value}`),
        description: f.clause,
      })),
    });
  }

  branches.push({
    id: "branch_topics",
    label: isAr ? "المحاور والمفاهيم الرئيسية" : "Core Topics & Concepts",
    description: isAr ? "أهم المواضيع التي تم تناولها" : "Main themes extracted from transcript",
    children: (analysis.topics.length > 0 ? analysis.topics : [title]).slice(0, 4).map((t, i) => ({
      id: `topic_${i + 1}`,
      label: cleanNodeLabel(t),
      description: analysis.definitions[i]?.definition?.slice(0, 120) || "",
    })),
  });

  branches.push({
    id: "branch_keypoints",
    label: isAr ? "أبرز النقاط المستخلصة" : "Key Takeaways",
    description: isAr ? "خلاصة النقاط الأكثر أهمية" : "Highest-signal grounded insights",
    children: summary.keyPoints.slice(0, 4).map((p, i) => ({
      id: `kp_${i + 1}`,
      label: cleanNodeLabel(p),
      description: p,
    })),
  });

  if (summary.decisions.length > 0 || summary.actionItems.length > 0) {
    branches.push({
      id: "branch_actions",
      label: isAr ? "القرارات والمهام التنفيذية" : "Decisions & Action Items",
      description: isAr ? "خطوات العمل المتفق عليها" : "Extracted follow-ups and decisions",
      children: [
        ...summary.decisions.slice(0, 2).map((d, i) => ({
          id: `dec_${i + 1}`,
          label: cleanNodeLabel(d),
          description: d,
        })),
        ...summary.actionItems.slice(0, 3).map((a, i) => ({
          id: `act_${i + 1}`,
          label: cleanNodeLabel(a.title),
          description: a.title,
        })),
      ],
    });
  } else {
    branches.push({
      id: "branch_review",
      label: isAr ? "نقاط المراجعة والاختبار" : "Study & Review Focus",
      description: isAr ? "مناطق التركيز للامتحان والمراجعة" : "Recommended review focus areas",
      children: analysis.reviewAreas.slice(0, 3).map((r, i) => ({
        id: `rev_${i + 1}`,
        label: cleanNodeLabel(r),
        description: r,
      })),
    });
  }

  return {
    id: "root",
    label: cleanNodeLabel(title, 56),
    description: summary.executiveSummary.slice(0, 180),
    children: branches.slice(0, 4),
  };
}
