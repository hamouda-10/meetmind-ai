import type { ChatMessageRecord, LectureRecord, MeetingRecord, UserRecord } from "./db";
import { detectIsArabic, normalizeText } from "./builtin-ai";

export type ChatScope = "general" | "all-recordings" | "recording";

export interface RawHistoryTurn {
  role: "user" | "model" | "assistant";
  text: string;
}

export interface NormalizedChatTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ChatIntentProfile {
  isArabic: boolean;
  isMixedArEn: boolean;
  isEgyptianDialect: boolean;
  lengthPreference: "concise" | "balanced" | "detailed";
  requestedBulletCount?: number;
  wantsExample: boolean;
  wantsCode: boolean;
  isFollowUp: boolean;
  isGreetingOrSmallTalk: boolean;
  isWorkspaceQuery: boolean;
  isAskAboutChatGPT: boolean;
  isIdentityQuery: boolean;
  identityAlreadyAnsweredRecently: boolean;
  recommendedLocalMaxTokens: number;
}

export interface SmartChatContext {
  intent: ChatIntentProfile;
  userProfileBlock: string;
  earlierSummaryBlock: string;
  recentTurns: NormalizedChatTurn[];
  currentMessage: string;
  systemInstructionCloud: string;
  systemInstructionLocal: string;
}

/**
 * Extracts durable user facts stated during the conversation (e.g. "اسمي أحمد",
 * "أنا بدرس علوم حاسب", "my name is Sara") so memory survives long conversations
 * even when early turns scroll past the verbatim window.
 */
export function extractConversationFacts(
  turns: NormalizedChatTurn[],
  userRecord?: Pick<UserRecord, "name" | "role" | "department" | "isGuest">,
  isArabic = false,
): string[] {
  const facts: string[] = [];
  const seen = new Set<string>();
  const addFact = (fact: string) => {
    const clean = fact.trim();
    if (!clean) return;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      facts.push(clean);
    }
  };

  if (userRecord && !userRecord.isGuest) {
    if (userRecord.name && userRecord.name.trim()) {
      addFact(
        isArabic
          ? `اسم صاحب الحساب: ${userRecord.name.trim()}`
          : `Account Name: ${userRecord.name.trim()}`,
      );
    }
    if (userRecord.department && userRecord.department.trim()) {
      addFact(
        isArabic
          ? `القسم/التخصص: ${userRecord.department.trim()}`
          : `Department/Field: ${userRecord.department.trim()}`,
      );
    }
  }

  for (const turn of turns) {
    if (turn.role !== "user") continue;
    const txt = turn.content.trim();
    if (!txt || txt.length > 600) continue;

    // Arabic name declaration: "اسمي أحمد" / "أنا اسمي سارة" (stop before conjunctions/verbs like "وبدرس")
    const arName = txt.match(
      /(?:^|[\s،,])(?:أنا\s+)?إ?اسمي\s+([\u0600-\u06FFa-zA-Z]{2,24})(?:\s+([\u0600-\u06FFa-zA-Z]{2,24}))?/i,
    );
    if (arName?.[1] && !/^(إيه|ايه|مين|شو|ماذا|what)$/i.test(arName[1].trim())) {
      const first = arName[1].trim();
      const second = arName[2]?.trim();
      const isSecondPartName =
        Boolean(second) &&
        !/^(و|من|في|على|عن|عمري|سني|بدرس|أدرس|ادرس|طالب|طالبة|شغال|أعمل|اعمل|وبدرس|وأدرس|وادرس|وطالب|وشغال|وأعمل|وبشتغل|وعندي|وعمري|أو|او|لكن|بس)/i.test(
          second || "",
        );
      const fullName = isSecondPartName ? `${first} ${second}` : first;
      addFact(
        isArabic ? `اسم المستخدم هو: ${fullName}` : `User introduced themselves as: ${fullName}`,
      );
    }
    // English name declaration: "my name is Ahmed" / "call me Sara"
    const enName = txt.match(
      /\b(?:my name is|call me)\s+([A-Za-z\u0600-\u06FF]{2,24}(?:\s+[A-Za-z\u0600-\u06FF]{2,24})?)/i,
    );
    if (enName?.[1]) {
      const fullName = enName[1].trim();
      addFact(
        isArabic ? `اسم المستخدم هو: ${fullName}` : `User introduced themselves as: ${fullName}`,
      );
    }
    // Study / major / job declarations
    const arStudy = txt.match(
      /(?:بدرس|أدرس|ادرس|طالب\s+في|طالبة\s+في|تخصصي|شغال|أعمل\s+كـ?)\s+([^\n.!؟?،,]{2,60})/i,
    );
    if (arStudy?.[1] && !/^(إيه|ايه|ماذا|فين|أين)/i.test(arStudy[1].trim())) {
      const study = arStudy[1].trim();
      addFact(isArabic ? `تخصص/عمل المستخدم هو: ${study}` : `User studies/works in: ${study}`);
    }
    const enStudy = txt.match(
      /\b(?:i study|i am studying|my major is|i work as)\s+([^\n.!?,]{2,60})/i,
    );
    if (enStudy?.[1]) {
      const study = enStudy[1].trim();
      addFact(isArabic ? `تخصص/عمل المستخدم هو: ${study}` : `User studies/works in: ${study}`);
    }
  }

  return facts.slice(0, 6);
}

/**
 * Compresses older conversation turns beyond the recent sliding window into a
 * compact summary preserving topics, key facts, and unresolved questions.
 */
function summarizeOlderTurns(olderTurns: NormalizedChatTurn[]): string {
  if (olderTurns.length === 0) return "";
  const lines: string[] = [];
  for (let i = 0; i < olderTurns.length; i++) {
    const t = olderTurns[i];
    const compact = t.content.replace(/\s+/g, " ").trim();
    if (!compact) continue;
    const snippet = compact.length > 140 ? `${compact.slice(0, 137)}...` : compact;
    lines.push(`${t.role === "user" ? "User" : "Assistant"}: ${snippet}`);
    if (lines.length >= 8) break;
  }
  return lines.join("\n");
}

/**
 * Normalizes and deduplicates conversation history from client + DB persistence,
 * ensuring the current user question is never duplicated at the tail.
 */
export function buildNormalizedHistory(params: {
  clientHistory?: RawHistoryTurn[];
  dbMessages?: ChatMessageRecord[];
  currentQuestion: string;
}): NormalizedChatTurn[] {
  const { clientHistory, dbMessages = [], currentQuestion } = params;

  const source: NormalizedChatTurn[] = [];
  // Only fall back to persisted DB history when the caller omitted `history` completely.
  // An explicit `history: []` represents a fresh conversation and must NOT pull stale DB turns.
  if (Array.isArray(clientHistory)) {
    for (const h of clientHistory) {
      const content = String(h?.text || "").trim();
      if (!content) continue;
      // Skip static frontend greeting banner so it never pollutes model context
      if (
        (h.role === "model" || h.role === "assistant") &&
        /(مرحباً(?:\s+بك)?!\s*أنا مساعد MeetMind|Hello!\s*I am your Super-Intelligent MeetMind AI Assistant)/i.test(
          content,
        )
      ) {
        continue;
      }
      source.push({
        role: h.role === "user" ? "user" : "assistant",
        content,
      });
    }
  } else if (dbMessages.length > 0) {
    for (const m of dbMessages.slice(-24)) {
      const content = String(m.content || "").trim();
      if (!content) continue;
      source.push({
        role: m.role === "user" ? "user" : "assistant",
        content,
      });
    }
  }

  // Deduplicate if the caller already appended the current question to history
  const normCurrent = normalizeText(currentQuestion);
  while (
    source.length > 0 &&
    source[source.length - 1].role === "user" &&
    normalizeText(source[source.length - 1].content) === normCurrent
  ) {
    source.pop();
  }

  // Merge accidental consecutive turns of the same role (required by strict chat templates like Gemma & Gemini)
  const alternating: NormalizedChatTurn[] = [];
  for (const turn of source) {
    const prev = alternating[alternating.length - 1];
    if (prev && prev.role === turn.role) {
      prev.content = `${prev.content}\n${turn.content}`;
    } else {
      alternating.push({ ...turn });
    }
  }

  // Ensure sequence starts with a user turn when non-empty
  while (alternating.length > 0 && alternating[0].role !== "user") {
    alternating.shift();
  }

  return alternating;
}

export function detectChatIntent(params: {
  question: string;
  history: NormalizedChatTurn[];
  appLanguage?: "en" | "ar";
  scope: ChatScope;
}): ChatIntentProfile {
  const { question, history, appLanguage, scope } = params;
  const q = question.trim();
  const norm = normalizeText(q);

  const arChars = (q.match(/[\u0600-\u06FF]/g) || []).length;
  const enChars = (q.match(/[A-Za-z]/g) || []).length;
  const isArabic = detectIsArabic(q, appLanguage);
  const isMixedArEn = arChars >= 3 && enChars >= 3;
  const isEgyptianDialect =
    /(عايز|إزاي|ازاي|إيه|ايه|ليه|عشان|بتشتغل|اديني|قولي|بدرس|عامل|ازيك|إزيك|كده|ده|دي|دول|مفيش|اللي|بتاع|التانية|التاني|الأولانية|طب)/i.test(
      q,
    );

  const bulletMatch = q.match(
    /(?:في|بـ?|in)\s*([1-9])\s*(?:نقاط|نقط|سطور|سطر|points?|bullets?|steps?|lines?)/i,
  );
  const requestedBulletCount = bulletMatch ? parseInt(bulletMatch[1], 10) : undefined;

  const wantsConcise =
    Boolean(requestedBulletCount && requestedBulletCount <= 5) ||
    /(اختصر|باختصار|مختصر|سريع|بإيجاز|في سطر|في سطرين|briefly|concise|short|tldr|tl;dr|summarize it|shorten)/i.test(
      q,
    );
  const wantsCode =
    /(اكتب\s*(?:لي\s*)?(?:كود|api|دالة|برنامج|سكريبت)|كود|مثال\s*برمجي|asp\.?net|c#|typescript|javascript|python|sql|react|node\.?js|html|css|اصلح\s*(?:هذا\s*)?الخطأ|fix\s+this\s+(?:bug|error|code)|write\s+(?:a\s+)?(?:code|api|function|script))/i.test(
      q,
    );
  const wantsDetailed =
    wantsCode ||
    /(بالتفصيل|تفصيل|مفصل|شرح كامل|خطوة بخطوة|الخطوات|حل المسألة|in detail|detailed|step by step|comprehensive|deep dive|thoroughly)/i.test(
      q,
    );
  const wantsExample =
    /(مثال|أمثلة|امثلة|اديني مثال|بمثال|عملي|example|for instance|demonstrate|show me how)/i.test(
      q,
    );

  const isFollowUp =
    history.length > 0 &&
    (q.length <= 95 ||
      /(النقطة|النقطه|التانية|التانيه|الثانية|الثانيه|الأولى|الاولى|التالتة|الثالثة|دي|ده|دول|اختصرها|وضح أكتر|وضح اكتر|اديني مثال|ليه\??|طب إيه|طب ايه|إيه الفرق|ايه الفرق|مثال عليها|كمل|أكمل|اكمل|explain more|elaborate|give an example|shorten it|the second|the first|why\??|what about|compare them)/i.test(
        q,
      ));

  const isGreetingOrSmallTalk =
    /^(السلام\s*عليكم(\s*ورحمة\s*الله(\s*وبركاته)?)?|سلام|اهلا|أهلا|أهلاً|مرحبا|مرحباً|هاي|هلو|ازيك|إزيك|عامل\s*ايه|صباح\s*الخير|مساء\s*الخير|شكرا|شكراً|متشكر|تسلم|يعطيك\s*العافية|hello|hi|hey|good\s*(?:morning|evening|afternoon)|how\s*are\s*you|thanks|thank\s*you|thx)[!?.،\s]*$/i.test(
      q,
    );

  const isWorkspaceQuery =
    scope === "recording" ||
    (scope === "all-recordings" &&
      /(التسجيل|تسجيلات|المحاضر[ةه]|محاضرات|الاجتماع|اجتماعات|ملخص|لخص|المهام|تكليف|قرارات|التفريغ|المتحدث|مسؤول عن المهمة|كويز|اختبار|بطاقات|my recording|this recording|the recording|transcript|my lecture|this lecture|my meeting|this meeting|summarize my|action items|what did .* say|who was responsible|make a quiz)/i.test(
        q,
      ));

  const isAskAboutChatGPT =
    /(?:هل\s*(?:انت|أنت)\s*(?:شات\s*جي\s*بي\s*تي|chatgpt|gpt|جيميناي|gemini|كلود|claude|جوجل|google)|انت\s*(?:شات\s*جي\s*بي\s*تي|chatgpt|gpt|gemini|claude)|are\s+you\s+(?:chatgpt|gpt|openai|gemini|google|claude|gemma))/i.test(
      q,
    );

  const arIdentityRx =
    /(?:^|\s)(?:انت\s*مين|من\s*انت|مين\s*انت|مين\s*(?:اللي\s*)?(?:برمجك|عملك|طورك|صممك|صنعك|انشاك|اسسك|بناك|وراك)|من\s*(?:الذي\s*)?(?:برمجك|عملك|طورك|صممك|صنعك|انشاك|اسسك|بناك)|مين\s*(?:مبرمجك|مطورك|مطورينك|مبرمجينك|مصممك|صانعك)|من\s*(?:هو\s*)?(?:مبرمجك|مطورك|صانعك|مصممك)|انت\s*تبع\s*مين|تبع\s*مين|تابع\s*لمين|عرفني\s*بنفسك|عرف\s*بنفسك|اسمك\s*ايه|انت\s*اسمك\s*ايه|ما\s*اسمك|هويتك)(?:\s|$)/i;
  const enIdentityRx =
    /\b(?:who\s+(?:are\s+you|made\s+you|programmed\s+you|built\s+you|created\s+you|developed\s+you|designed\s+you|trained\s+you|owns\s+you)|who\s+(?:is|are)\s+your\s+(?:creator|creators|developer|developers|programmer|programmers|maker|makers|designer|designers|team|author|authors)|what\s+(?:are\s+you|is\s+your\s+name)|introduce\s+yourself|tell\s+me\s+about\s+yourself)\b/i;

  const isIdentityQuery =
    !isAskAboutChatGPT && q.length <= 240 && (arIdentityRx.test(norm) || enIdentityRx.test(q));

  const identityAlreadyAnsweredRecently = history
    .slice(-6)
    .some(
      (t) =>
        t.role === "assistant" &&
        /(Modern Academy|مودرن أكاديمي|مهندسي البرمجة|software engineering students)/i.test(
          t.content,
        ),
    );

  const lengthPreference: "concise" | "balanced" | "detailed" = wantsConcise
    ? "concise"
    : wantsDetailed
      ? "detailed"
      : "balanced";

  const recommendedLocalMaxTokens = isGreetingOrSmallTalk
    ? 80
    : lengthPreference === "concise"
      ? 180
      : wantsCode
        ? 340
        : lengthPreference === "detailed"
          ? 290
          : 230;

  return {
    isArabic,
    isMixedArEn,
    isEgyptianDialect,
    lengthPreference,
    requestedBulletCount,
    wantsExample,
    wantsCode,
    isFollowUp,
    isGreetingOrSmallTalk,
    isWorkspaceQuery,
    isAskAboutChatGPT,
    isIdentityQuery,
    identityAlreadyAnsweredRecently,
    recommendedLocalMaxTokens,
  };
}

/**
 * Generates MeetMind AI's product identity reply naturally, avoiding robotic
 * verbatim repetition when the user asks again in the same conversation, and
 * handling "Are you ChatGPT?" accurately without claiming to be ChatGPT.
 */
export function buildConversationalIdentityReply(intent: ChatIntentProfile): string | null {
  if (intent.isAskAboutChatGPT) {
    return intent.isArabic
      ? "لا، أنا لست ChatGPT. أنا **MeetMind AI**، المساعد الذكي المدمج داخل منصة MeetMind AI، وأعمل بمحرك الذكاء الاصطناعي المُعد داخل المنصة.\nتم تطويري وبرمجتي بواسطة مجموعة من مهندسي البرمجة من قسم علوم الحاسب في Modern Academy."
      : "No, I am not ChatGPT. I am the **MeetMind AI** assistant, powered by the AI model configured by the MeetMind AI platform, and developed by a group of software engineering students from the Computer Science Department at Modern Academy.";
  }

  if (!intent.isIdentityQuery) return null;

  if (intent.identityAlreadyAnsweredRecently) {
    return intent.isArabic
      ? "أنا MeetMind AI 😄\nوكما ذكرت، تم تطويري بواسطة مجموعة من طلاب هندسة البرمجيات من قسم علوم الحاسب في Modern Academy كجزء من مشروع التخرج MeetMind AI. تحب أساعدك في إيه دلوقتي؟"
      : "Still me — MeetMind AI! As mentioned, I was developed by a group of software engineering students from the Computer Science Department at Modern Academy as part of the MeetMind AI graduation project. What would you like to explore next?";
  }

  return intent.isArabic
    ? "تم تطويري بواسطة مجموعة من طلاب هندسة البرمجيات من قسم علوم الحاسب في Modern Academy كجزء من مشروع التخرج MeetMind AI."
    : "I was developed by a group of software engineering students from the Computer Science Department at Modern Academy as part of the MeetMind AI graduation project.";
}

/**
 * Builds the complete structured multi-turn context package for both Cloud Gemini
 * and Embedded Local LLM pipelines:
 *   SYSTEM INSTRUCTIONS
 *   USER PROFILE / PREFERENCES
 *   EARLIER CONVERSATION SUMMARY (when long)
 *   OPTIONAL RECORDING CONTEXT (strictly scoped)
 *   RECENT CONVERSATION (native multi-turn array)
 *   CURRENT USER MESSAGE
 */
export function buildSmartChatContext(params: {
  question: string;
  clientHistory?: RawHistoryTurn[];
  dbMessages?: ChatMessageRecord[];
  userRecord?: Pick<UserRecord, "name" | "role" | "department" | "isGuest">;
  scope: ChatScope;
  targetItem?: MeetingRecord | LectureRecord;
  recordingContextBlock?: string;
  appLanguage?: "en" | "ar";
}): SmartChatContext {
  const {
    question,
    clientHistory,
    dbMessages,
    userRecord,
    scope,
    targetItem,
    recordingContextBlock,
    appLanguage,
  } = params;

  const fullHistory = buildNormalizedHistory({
    clientHistory,
    dbMessages,
    currentQuestion: question,
  });

  const intent = detectChatIntent({
    question,
    history: fullHistory,
    appLanguage,
    scope,
  });

  const userFacts = extractConversationFacts(fullHistory, userRecord, intent.isArabic);
  const userProfileHeader = intent.isArabic
    ? "[معلومات المستخدم المؤكدة في هذه الجلسة]"
    : "[User Profile & Session Facts]";
  const userProfileBlock =
    userFacts.length > 0
      ? `${userProfileHeader}\n${userFacts.map((f) => `- ${f}`).join("\n")}`
      : "";

  // Sliding window: keep last 8 messages (4 full Q&A turns) verbatim for local LLM and up to 14 messages (7 turns) for cloud
  const maxRecentMessages = 12;
  const splitIdx = Math.max(0, fullHistory.length - maxRecentMessages);
  const olderTurns = fullHistory.slice(0, splitIdx);
  const recentTurns = fullHistory.slice(splitIdx).map((t) => ({
    role: t.role,
    // Keep full numbered explanations & code examples intact (up to 1600 chars per recent turn!)
    content: t.content.length > 1600 ? `${t.content.slice(0, 1590)}...` : t.content,
  }));

  const earlierSummaryText = summarizeOlderTurns(olderTurns);
  const earlierSummaryBlock = earlierSummaryText
    ? `[Earlier Conversation Summary]\n${earlierSummaryText}`
    : "";

  const lengthDirectiveEn = intent.requestedBulletCount
    ? `Respond in EXACTLY ${intent.requestedBulletCount} clear, concise bullet points.`
    : intent.lengthPreference === "concise"
      ? "Keep your answer brief, focused, and direct."
      : intent.lengthPreference === "detailed"
        ? "Provide a thorough, well-structured explanation with step-by-step reasoning and clean code/examples where helpful."
        : "Provide a clear, well-structured, balanced answer: for concepts include a clear definition, how it works, and a practical example when helpful.";

  const lengthDirectiveAr = intent.requestedBulletCount
    ? `التزم تماماً بتقديم الإجابة في ${intent.requestedBulletCount} نقاط واضحة ومباشرة فقط.`
    : intent.lengthPreference === "concise"
      ? "اجعل الإجابة مختصرة ومركزة ومباشرة بدون إطالة."
      : intent.lengthPreference === "detailed"
        ? "قدّم شرحاً وافياً ومنظماً خطوة بخطوة مع مثال عملي أو كود واضح عند الحاجة."
        : "قدّم إجابة متوازنة وواضحة: عند شرح مفهوم قدّم تعريفاً بسيطاً، كيف يعمل، ومثالاً عملياً مناسباً.";

  const languageDirective = intent.isArabic
    ? intent.isMixedArEn
      ? "Respond naturally in clear Arabic while keeping technical terms in English (e.g., API, SDK, Dependency Injection, TCP/IP)."
      : "أجب بلغة عربية طبيعية واضحة وسلسة (مناسبة للفصحى أو اللهجة المصرية حسب أسلوب المستخدم)، مع إبقاء المصطلحات التقنية بالإنجليزية عند الحاجة، وبلا صياغة آلية مترجمة."
    : "Respond naturally in fluent, clear English using clean Markdown formatting.";

  const groundingDirective =
    scope === "recording" && targetItem
      ? intent.isArabic
        ? `نطاق التسجيل المحدد: "${targetItem.title}".
- إذا سأل المستخدم عما ذُكر أو تقرر أو أُسند في هذا التسجيل، اعتمد حصرياً على النص المرفق مع ذكر اسم المتحدث والتوقيت [MM:SS].
- إذا لم تكن المعلومة موجودة في النص المرفق، قل بوضوح: "المعلومة دي غير موجودة في التسجيل المتاح." ولا تختلق أي تفاصيل.`
        : `Selected Recording Scope: "${targetItem.title}".
- For questions about what was said, decided, or assigned in this recording, rely STRICTLY on the provided transcript with speaker & [MM:SS] citations.
- If the detail is absent from the transcript, clearly state: "This information is not mentioned in the available recording." Never invent facts.`
      : scope === "all-recordings" && recordingContextBlock
        ? intent.isArabic
          ? `- يتوفر سياق من تسجيلات المستخدم أدناه. استخدمه بدقة عند سؤال المستخدم عن تسجيلاته أو محاضراته أو مهامه، ولا تختلق شيئاً غير موجود في النص.
- للأسئلة العامة أو الأكاديمية أو البرمجية أو الرياضية غير المرتبطة بالتسجيلات، أجب بحرية ودقة كاملة دون تقييد بالتسجيلات.`
          : `- Authorized user recording context is attached below. Ground recording/lecture/meeting questions strictly in it without fabricating facts.
- For general, academic, math, or programming questions unrelated to recordings, answer freely and thoroughly.`
        : intent.isArabic
          ? `- هذا وضع المساعد العام (General AI). أجب على أي سؤال علمي أو برمجي أو أكاديمي أو عام أو محادثة يومية بدقة وذكاء.`
          : `- General AI mode: answer any academic, technical, programming, math, science, or general question accurately and naturally.`;

  const personaCore = `You are MeetMind AI, an advanced, helpful AI assistant integrated into the MeetMind AI platform.
Identity rules:
- If asked who you are or who developed you, state that you are MeetMind AI, developed by software engineering students from the Computer Science Department at Modern Academy. Never invent names of individuals or other companies/universities.
- If asked whether you are ChatGPT, clarify you are the MeetMind AI assistant powered by the AI model configured by the platform.
- Never repeat the exact same static answer mechanically across consecutive turns.
Quality & Anti-Hallucination rules:
- Correctness and context understanding come first. Carefully read the previous conversation turns and resolve follow-up references (like "النقطة التانية", "اختصرها", "اديني مثال", "اسمي إيه", "أنا بدرس إيه") directly from the conversation history.
- NEVER fabricate facts, APIs, statistics, people, quotes, or recording details. If genuinely unsure, explicitly say "${intent.isArabic ? "لست متأكدًا من هذه المعلومة." : "I am not certain about this information."}".
- ${languageDirective}
- ${intent.isArabic ? lengthDirectiveAr : lengthDirectiveEn}
${groundingDirective}`;

  // Compact system prompt optimized for Local Gemma 3 1B ONNX (fast prefill + sharp multi-turn memory)
  const localSystemCore = intent.isArabic
    ? `أنت MeetMind AI (تطوير مهندسي البرمجة بقسم علوم الحاسب في Modern Academy). لا تقل أبداً "أنا نموذج لغوي كبير".
- استخدم [معلومات المستخدم المؤكدة في هذه الجلسة] وسجل المحادثة للإجابة بدقة عن اسم المستخدم وتخصصه ومتابعة النقاط السابقة (ملاحظة: كلمة "إيه" بالعامية المصرية تعني "ماذا" وليست اسماً لشخص).
- أجب مباشرة بدون تكرار عبارات ترحيب متكررة في كل رسالة، وبلغة عربية واضحة مع المصطلحات التقنية بالإنجليزية عند الحاجة. ${lengthDirectiveAr}
- لا تختلق أي معلومة. إذا لم تكن متأكداً قل: "لست متأكدًا من هذه المعلومة."
${
  recordingContextBlock
    ? scope === "recording"
      ? `- اعتمد حصرياً على النص المرفق للتسجيل. إذا لم تُذكر المعلومة قل: "المعلومة دي غير موجودة في التسجيل المتاح."`
      : `- عند السؤال عن التسجيلات اعتمد على المقتطفات المرفقة فقط.`
    : ""
}`
    : `You are MeetMind AI (developed by CS software engineering students at Modern Academy). Never say "I am a large language model".
- Use [User Profile & Session Facts] and prior conversation turns accurately for memory and follow-ups.
- Answer directly without repeating greeting banners across turns, in clear Markdown. ${lengthDirectiveEn}
- Never fabricate facts or APIs. If unsure, say "I am not certain about this information."
${
  recordingContextBlock
    ? scope === "recording"
      ? `- Ground answers strictly in the attached transcript. If absent, say "This information is not mentioned in the available recording."`
      : `- Use attached recording excerpts strictly when asked about recordings.`
    : ""
}`;

  return {
    intent,
    userProfileBlock,
    earlierSummaryBlock,
    recentTurns,
    currentMessage: question,
    systemInstructionCloud: personaCore,
    systemInstructionLocal: localSystemCore,
  };
}
