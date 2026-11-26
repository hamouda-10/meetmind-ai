import { useState, useEffect, useMemo } from "react";
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  BrainCircuit,
  CheckCircle2,
  XCircle,
  RotateCcw,
  Sparkles,
  Trophy,
  Loader2,
  HelpCircle,
  Clock,
  History,
  PenTool,
  Check,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { EmptyState } from "@/components/common/empty-state";
import { GlassCard } from "@/components/common/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { api, Quiz, QuizAttempt } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

function parseTimestampToSeconds(ts?: string): number {
  if (!ts) return 0;
  const match = ts.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (!match) return 0;
  if (match[3]) {
    return parseInt(match[1]) * 3600 + parseInt(match[2]) * 60 + parseInt(match[3]);
  }
  return parseInt(match[1]) * 60 + parseInt(match[2]);
}

export default function QuizView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { language } = useTranslation();
  const isArabic = language.toUpperCase() === "AR";

  const locationSearchStr = useRouterState({ select: (r) => r.location.searchStr });
  const { urlQuizId, urlResourceId } = useMemo(() => {
    const params = new URLSearchParams(locationSearchStr || "");
    return {
      urlQuizId: params.get("quizId")?.trim() || "",
      urlResourceId: (params.get("lectureId") || params.get("id") || "").trim(),
    };
  }, [locationSearchStr]);

  const [selectedQuizId, setSelectedQuizId] = useState<string>(() => urlQuizId);
  const [selectedAnswers, setSelectedAnswers] = useState<Record<string, string | number>>({});
  const [selectedDifficulty, setSelectedDifficulty] = useState<"all" | "easy" | "medium" | "hard">(
    "all",
  );
  const [historyOpen, setHistoryOpen] = useState(false);
  const [submittedResults, setSubmittedResults] = useState<{
    scorePercent: number;
    correctCount: number;
    totalQuestions: number;
    results: {
      questionId: string;
      type: string;
      userAnswer: string | number;
      chosenOptionIndex?: number;
      correctOptionIndex: number;
      correctAnswerText?: string;
      isCorrect: boolean;
      explanation: string;
    }[];
  } | null>(null);

  const { data: quizzes = [], isLoading } = useQuery<Quiz[]>({
    queryKey: ["quizzes"],
    queryFn: () => api.getQuizzes(),
  });

  const { data: lectures = [] } = useQuery({
    queryKey: ["lectures"],
    queryFn: () => api.getLectures(),
  });

  const { data: meetings = [] } = useQuery({
    queryKey: ["meetings"],
    queryFn: () => api.getMeetings(),
  });

  // Reactively align selectedQuizId whenever URL params (?quizId= or ?lectureId=/id=) change
  useEffect(() => {
    if (urlQuizId) {
      setSelectedQuizId(urlQuizId);
      return;
    }
    if (urlResourceId) {
      const matched = quizzes.find(
        (q) => q.lectureId === urlResourceId || q.meetingId === urlResourceId,
      );
      setSelectedQuizId(matched ? matched.id : "");
    }
  }, [urlQuizId, urlResourceId, quizzes]);

  const requestedResource = useMemo(() => {
    if (!urlResourceId) return null;
    const lec = lectures.find((l) => l.id === urlResourceId);
    if (lec) return { id: lec.id, title: lec.title, type: "lecture" as const };
    const mtg = meetings.find((m) => m.id === urlResourceId);
    if (mtg) return { id: mtg.id, title: mtg.title, type: "meeting" as const };
    return null;
  }, [urlResourceId, lectures, meetings]);

  const matchedForRequestedResource = urlResourceId
    ? quizzes.find((q) => q.lectureId === urlResourceId || q.meetingId === urlResourceId) || null
    : null;

  const missingRequestedResourceQuiz = Boolean(
    urlResourceId && !isLoading && !matchedForRequestedResource && !selectedQuizId,
  );

  const activeQuiz = missingRequestedResourceQuiz
    ? null
    : quizzes.find((q) => q.id === selectedQuizId) ||
      matchedForRequestedResource ||
      (urlResourceId && isLoading ? null : quizzes[0] || null);

  // Reset per-quiz local answers/results when switching quizzes
  useEffect(() => {
    setSelectedAnswers({});
    setSubmittedResults(null);
  }, [activeQuiz?.id]);

  const handleSelectQuiz = (quiz: Quiz) => {
    setSelectedQuizId(quiz.id);
    setSelectedAnswers({});
    setSubmittedResults(null);
    void navigate({
      to: "/quiz",
      search: {
        quizId: quiz.id,
        lectureId: quiz.lectureId || quiz.meetingId,
      },
      replace: true,
    });
  };

  const generateForRequestedMutation = useMutation({
    mutationFn: async () => {
      if (!urlResourceId) {
        throw new Error(isArabic ? "لم يتم تحديد محاضرة" : "No lecture selected");
      }
      const resType = requestedResource?.type || "lecture";
      const res = await api.generateQuiz(urlResourceId, resType, 6, selectedDifficulty);
      return res.quiz;
    },
    onSuccess: (newQuiz) => {
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
      setSelectedQuizId(newQuiz.id);
      handleReset();
      toast.success(
        isArabic
          ? "تم إنشاء الاختبار التقييمي لهذه المحاضرة بنجاح!"
          : "Generated quiz for this lecture!",
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "تعذر توليد الاختبار");
    },
  });

  const { data: attempts = [] } = useQuery<QuizAttempt[]>({
    queryKey: ["quizAttempts", activeQuiz?.id],
    queryFn: () => (activeQuiz ? api.getQuizAttempts(activeQuiz.id) : Promise.resolve([])),
    enabled: !!activeQuiz,
  });

  const submitMutation = useMutation({
    mutationFn: (answers: Record<string, string | number>) =>
      api.submitQuizAttempt(activeQuiz!.id, answers),
    onSuccess: (data) => {
      setSubmittedResults(data);
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
      queryClient.invalidateQueries({ queryKey: ["quizAttempts", activeQuiz?.id] });
      toast.success(
        isArabic
          ? `اكتمل الاختبار! النتيجة: ${data.scorePercent}% (${data.correctCount}/${data.totalQuestions})`
          : `Quiz completed! Score: ${data.scorePercent}%`,
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "فشل تسليم الإجابات");
    },
  });

  const generateNewQuizMutation = useMutation({
    mutationFn: async () => {
      const sourceResourceId = activeQuiz?.lectureId || activeQuiz?.meetingId;
      if (!sourceResourceId) {
        throw new Error(
          isArabic
            ? "لا يوجد تسجيل أو محاضرة مرتبطة بهذا الاختبار لتوليد نموذج جديد"
            : "No linked lecture or meeting found for generating fresh questions",
        );
      }
      const avoidTitles = activeQuiz.questions.map((q) => q.question);
      return api.generateNewQuiz(sourceResourceId, {
        avoidQuestionTitles: avoidTitles,
        variant: (activeQuiz.attemptsCount || 0) + 2,
        difficulty: selectedDifficulty,
      });
    },
    onSuccess: (newQuiz) => {
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
      setSelectedQuizId(newQuiz.id);
      handleReset();
      toast.success(
        isArabic
          ? "تم توليد نموذج اختبار جديد بأسئلة مختلفة!"
          : "Generated new quiz with fresh questions!",
      );
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "تعذر توليد الاختبار الجديد");
    },
  });

  const handleSelectOption = (questionId: string, optionIndex: number) => {
    if (submittedResults) return;
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: optionIndex }));
  };

  const handleTextAnswer = (questionId: string, text: string) => {
    if (submittedResults) return;
    setSelectedAnswers((prev) => ({ ...prev, [questionId]: text }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeQuiz) return;
    submitMutation.mutate(selectedAnswers);
  };

  const handleReset = () => {
    setSelectedAnswers({});
    setSubmittedResults(null);
  };

  const getDifficultyBadge = (difficulty?: string) => {
    switch (difficulty) {
      case "easy":
        return (
          <Badge className="bg-emerald-500/15 text-emerald-400 border-emerald-500/30 text-[10px]">
            {isArabic ? "سهل" : "Easy"}
          </Badge>
        );
      case "hard":
        return (
          <Badge className="bg-purple-500/15 text-purple-400 border-purple-500/30 text-[10px]">
            {isArabic ? "متقدم" : "Hard"}
          </Badge>
        );
      default:
        return (
          <Badge className="bg-amber-500/15 text-amber-400 border-amber-500/30 text-[10px]">
            {isArabic ? "متوسط" : "Medium"}
          </Badge>
        );
    }
  };

  const getTypeLabel = (type?: string) => {
    switch (type) {
      case "true_false":
        return isArabic ? "صح / خطأ" : "True / False";
      case "fill_in_the_blank":
        return isArabic ? "أكمل الفراغ" : "Fill in the Blank";
      case "short_answer":
        return isArabic ? "سؤال مقالي واستنتاجي" : "Conceptual / Short Answer";
      default:
        return isArabic ? "اختيار من متعدد (MCQ)" : "Multiple Choice (MCQ)";
    }
  };

  return (
    <div className="space-y-6" dir={isArabic ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={isArabic ? "التقييم الأكاديمي الذكي" : "Academic Self-Assessment"}
        title={isArabic ? "مولد الاختبارات والتقييم الذكي" : "AI Quiz & Self-Assessment"}
        description={
          isArabic
            ? "اختبارات استنتاجية وتقييمية شاملة تغطي كامل محاور المحاضرة (MCQ، صح وخطأ، أكمل الفراغ، وأسئلة مقالية) مع تصحيح تلقائي وتوثيق استدلالي."
            : "Comprehensive AI quizzes covering the entire lecture (MCQ, True/False, Fill in blanks, Short answers) with automatic grading and source explanations."
        }
        actions={
          activeQuiz ? (
            <div className="flex flex-wrap items-center gap-2">
              <div
                className="inline-flex items-center rounded-lg border border-border/60 bg-secondary/40 p-0.5 text-[11px]"
                role="group"
                aria-label={isArabic ? "مستوى الصعوبة" : "Quiz Difficulty"}
              >
                {(["all", "easy", "medium", "hard"] as const).map((lvl) => (
                  <button
                    key={lvl}
                    type="button"
                    onClick={() => setSelectedDifficulty(lvl)}
                    className={`rounded-md px-2 py-1 font-medium transition-colors cursor-pointer ${
                      selectedDifficulty === lvl
                        ? "bg-primary text-primary-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {lvl === "all"
                      ? isArabic
                        ? "الكل"
                        : "All"
                      : lvl === "easy"
                        ? isArabic
                          ? "سهل"
                          : "Easy"
                        : lvl === "medium"
                          ? isArabic
                            ? "متوسط"
                            : "Medium"
                          : isArabic
                            ? "صعب"
                            : "Hard"}
                  </button>
                ))}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setHistoryOpen(true)}
                className="cursor-pointer gap-1.5"
              >
                <History className="h-4 w-4 text-muted-foreground" />
                <span>
                  {isArabic ? `سجل المحاولات (${attempts.length})` : `History (${attempts.length})`}
                </span>
              </Button>

              <Button
                size="sm"
                variant="outline"
                onClick={() => generateNewQuizMutation.mutate()}
                disabled={generateNewQuizMutation.isPending}
                className="border-primary/40 text-primary hover:bg-primary/10 gap-1.5 cursor-pointer shadow-glow"
              >
                {generateNewQuizMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Sparkles className="h-4 w-4" />
                )}
                <span>{isArabic ? "توليد أسئلة جديدة مختلفة" : "Generate Fresh Questions"}</span>
              </Button>
            </div>
          ) : undefined
        }
      />

      {isLoading ? (
        <div className="flex h-48 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : missingRequestedResourceQuiz ? (
        <GlassCard className="p-10 text-center space-y-4">
          <BrainCircuit className="h-10 w-10 text-primary mx-auto" />
          <h3 className="font-display text-lg font-semibold">
            {isArabic
              ? `لا يوجد اختبار منشأ بعد لـ "${requestedResource?.title || "هذه المحاضرة"}"`
              : `No quiz generated yet for "${requestedResource?.title || "this recording"}"`}
          </h3>
          <p className="text-xs text-muted-foreground max-w-md mx-auto">
            {isArabic
              ? "يمكنك توليد اختبار تقييمي مخصص وموثق من محتوى هذه المحاضرة الآن بضغطة واحدة."
              : "Generate a grounded assessment quiz strictly from this lecture's transcript in one click."}
          </p>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
            <Button
              onClick={() => generateForRequestedMutation.mutate()}
              disabled={generateForRequestedMutation.isPending}
              className="gradient-primary text-primary-foreground shadow-glow gap-2 cursor-pointer"
            >
              {generateForRequestedMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              <span>
                {isArabic ? "توليد اختبار لهذه المحاضرة الآن" : "Generate Quiz for This Lecture"}
              </span>
            </Button>
            {quizzes.length > 0 && (
              <Button
                variant="outline"
                onClick={() => handleSelectQuiz(quizzes[0])}
                className="cursor-pointer text-xs"
              >
                {isArabic ? "استعراض الاختبارات الأخرى" : "Browse Other Quizzes"}
              </Button>
            )}
          </div>
        </GlassCard>
      ) : quizzes.length === 0 ? (
        <EmptyState
          icon={BrainCircuit}
          title={isArabic ? "لا توجد اختبارات منشأة بعد" : "No quizzes generated yet"}
          description={
            isArabic
              ? "قم بتسجيل أو رفع محاضرة أو اجتماع لإنشاء اختبار تقييمي شامل تلقائياً."
              : "Record or upload a lecture to automatically generate practice quizzes."
          }
        />
      ) : (
        <div className="space-y-6">
          {/* Quiz Selector */}
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground ml-1">
              {isArabic ? "اختر المحاضرة:" : "Select Quiz:"}
            </span>
            {quizzes.map((q) => (
              <Button
                key={q.id}
                variant={activeQuiz?.id === q.id ? "default" : "outline"}
                size="sm"
                onClick={() => handleSelectQuiz(q)}
                className={`cursor-pointer ${
                  activeQuiz?.id === q.id
                    ? "gradient-primary text-primary-foreground shadow-glow"
                    : "border-border/60"
                }`}
              >
                {q.courseCode ? `${q.courseCode} · ` : ""}
                {q.title}
              </Button>
            ))}
          </div>

          {activeQuiz && (
            <div className="space-y-6">
              {/* Quiz Header Banner */}
              <GlassCard className="p-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2 mb-1.5">
                      {activeQuiz.courseCode && (
                        <Badge
                          variant="outline"
                          className="font-mono text-xs border-primary/40 text-primary bg-primary/10"
                        >
                          {activeQuiz.courseCode}
                        </Badge>
                      )}
                      <span className="text-xs text-muted-foreground flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        {isArabic
                          ? `${activeQuiz.questions.length} أسئلة متنوعة · ${activeQuiz.attemptsCount || 0} محاولات مسجلة`
                          : `${activeQuiz.questions.length} questions · ${activeQuiz.attemptsCount || 0} recorded attempts`}
                      </span>
                    </div>
                    <h2 className="font-display text-xl font-semibold tracking-tight">
                      {activeQuiz.title}
                    </h2>
                  </div>

                  {submittedResults ? (
                    <div className="flex items-center gap-3 bg-secondary/50 px-4 py-2 rounded-xl border border-border">
                      <Trophy className="h-6 w-6 text-primary" />
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-muted-foreground">
                          {isArabic ? "النتيجة النهائية" : "Final Score"}
                        </div>
                        <div className="text-lg font-bold text-foreground">
                          {submittedResults.scorePercent}% ({submittedResults.correctCount}/
                          {submittedResults.totalQuestions})
                        </div>
                      </div>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={handleReset}
                        className="mr-2 cursor-pointer gap-1.5"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />{" "}
                        {isArabic ? "إعادة الاختبار" : "Retake Quiz"}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      onClick={handleSubmit}
                      disabled={submitMutation.isPending}
                      className="gradient-primary text-primary-foreground shadow-glow cursor-pointer"
                    >
                      {submitMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin ml-1.5" />
                      ) : (
                        <Check className="h-4 w-4 ml-1.5" />
                      )}
                      {isArabic ? "تسليم وحساب النتيجة" : "Submit Quiz"}
                    </Button>
                  )}
                </div>
              </GlassCard>

              {/* Quiz Progress Bar */}
              {(() => {
                const totalQ = activeQuiz.questions.length;
                const answeredQ = activeQuiz.questions.filter(
                  (q) => selectedAnswers[q.id] !== undefined,
                ).length;
                const pct = Math.round((answeredQ / (totalQ || 1)) * 100);
                return (
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-1 text-xs text-muted-foreground">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-foreground">
                        {isArabic
                          ? `التقدم: ${answeredQ} من ${totalQ} أسئلة مجابة`
                          : `Progress: ${answeredQ} of ${totalQ} questions answered`}
                      </span>
                      <span className="font-mono text-primary font-bold">({pct}%)</span>
                    </div>
                    <div className="w-full sm:w-48 h-2 rounded-full bg-secondary/80 overflow-hidden border border-border/50">
                      <div
                        className="h-full gradient-primary transition-all duration-300 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })()}

              {/* Questions List */}
              <div className="space-y-5">
                {activeQuiz.questions.map((q, qIndex) => {
                  const resultItem = submittedResults?.results.find((r) => r.questionId === q.id);
                  const qType = q.type || "multiple_choice";
                  const chosenOption = selectedAnswers[q.id];
                  const isQuestionArabic = /[\u0600-\u06FF]/.test(q.question);

                  return (
                    <GlassCard
                      key={q.id}
                      className="p-5 sm:p-6 space-y-4"
                      dir={isQuestionArabic ? "rtl" : "ltr"}
                    >
                      {/* Question Header */}
                      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                        <div className="font-medium text-sm sm:text-base text-foreground flex items-start gap-3">
                          {/* Distinct Red Highlight Badge with Subtle Glow */}
                          <span className="inline-flex items-center justify-center px-2.5 py-1 rounded-lg text-xs font-mono font-bold border border-rose-500/50 bg-rose-500/15 text-rose-300 shadow-[0_0_12px_rgba(244,63,94,0.35)] shrink-0 mt-0.5">
                            {isQuestionArabic ? `السؤال ${qIndex + 1}` : `Question ${qIndex + 1}`}
                          </span>
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-2 mb-1">
                              <span className="text-[11px] font-mono text-muted-foreground bg-secondary/50 px-2 py-0.5 rounded border border-border/40">
                                {isQuestionArabic
                                  ? `${qIndex + 1} من ${activeQuiz.questions.length}`
                                  : `${qIndex + 1} of ${activeQuiz.questions.length}`}
                              </span>
                              <Badge variant="outline" className="text-[10px] bg-secondary/60">
                                {getTypeLabel(qType)}
                              </Badge>
                              {getDifficultyBadge(q.difficulty)}
                              {(q.timestampRef || q.sectionRef) && (
                                <Link
                                  to="/transcript"
                                  search={{
                                    id: activeQuiz.lectureId || activeQuiz.meetingId || undefined,
                                    time: String(
                                      parseTimestampToSeconds(q.timestampRef || q.sectionRef),
                                    ),
                                  }}
                                  className="inline-flex items-center gap-1 text-[11px] text-primary hover:underline font-mono bg-primary/10 px-2 py-0.5 rounded border border-primary/25 cursor-pointer"
                                  title={
                                    isQuestionArabic
                                      ? "الاستماع للمقطع الصوتي الذي استند إليه السؤال في التفريغ"
                                      : "Listen to audio segment for this question"
                                  }
                                >
                                  <Clock className="h-3 w-3" />
                                  <span>{q.timestampRef || q.sectionRef}</span>
                                </Link>
                              )}
                            </div>
                            <span
                              className={`leading-relaxed font-semibold block ${isQuestionArabic ? "text-right" : "text-left"}`}
                            >
                              {q.question}
                            </span>
                          </div>
                        </div>

                        {resultItem && (
                          <div className="shrink-0">
                            {resultItem.isCorrect ? (
                              <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-400 gap-1 px-2.5 py-1">
                                <CheckCircle2 className="h-3.5 w-3.5" />{" "}
                                {isArabic ? "صحيح" : "Correct"}
                              </Badge>
                            ) : (
                              <Badge className="border-destructive/30 bg-destructive/15 text-destructive gap-1 px-2.5 py-1">
                                <XCircle className="h-3.5 w-3.5" />{" "}
                                {isArabic ? "إجابة تحتاج مراجعة" : "Needs Review"}
                              </Badge>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Question Interaction Based on Type */}
                      {qType === "multiple_choice" && (
                        <div className="space-y-2 pt-1">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = chosenOption === optIdx;
                            let optionClass = "border-border/60 hover:bg-secondary/40";

                            if (submittedResults) {
                              if (optIdx === q.correctOptionIndex) {
                                optionClass =
                                  "border-emerald-500 bg-emerald-500/10 text-emerald-400 font-medium";
                              } else if (isSelected && !resultItem?.isCorrect) {
                                optionClass =
                                  "border-destructive bg-destructive/10 text-destructive line-through";
                              }
                            } else if (isSelected) {
                              optionClass =
                                "border-primary bg-primary/10 text-foreground font-medium ring-1 ring-primary/40";
                            }

                            const optionLetter = isQuestionArabic
                              ? ["أ", "ب", "ج", "د"][optIdx] || String.fromCharCode(65 + optIdx)
                              : String.fromCharCode(65 + optIdx);

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => handleSelectOption(q.id, optIdx)}
                                className={`w-full p-3 rounded-xl border text-xs sm:text-sm transition-all flex items-center gap-3 cursor-pointer ${
                                  isQuestionArabic ? "text-right" : "text-left"
                                } ${optionClass}`}
                              >
                                <span className="h-5 w-5 rounded-full border border-current flex items-center justify-center text-[10px] shrink-0 font-mono">
                                  {optionLetter}
                                </span>
                                <span className="flex-1">{opt}</span>
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {qType === "true_false" && (
                        <div className="grid grid-cols-2 gap-3 pt-1">
                          {q.options.slice(0, 2).map((opt, optIdx) => {
                            const isSelected = chosenOption === optIdx;
                            let btnVariant = "border-border/60 hover:bg-secondary/40";

                            if (submittedResults) {
                              if (optIdx === q.correctOptionIndex) {
                                btnVariant =
                                  "border-emerald-500 bg-emerald-500/10 text-emerald-400 font-bold";
                              } else if (isSelected && !resultItem?.isCorrect) {
                                btnVariant =
                                  "border-destructive bg-destructive/10 text-destructive line-through";
                              }
                            } else if (isSelected) {
                              btnVariant =
                                "border-primary bg-primary/15 text-foreground font-bold ring-1 ring-primary";
                            }

                            return (
                              <button
                                key={optIdx}
                                type="button"
                                onClick={() => handleSelectOption(q.id, optIdx)}
                                className={`p-3.5 rounded-xl border text-center text-sm font-semibold transition-all cursor-pointer ${btnVariant}`}
                              >
                                {opt}
                              </button>
                            );
                          })}
                        </div>
                      )}

                      {qType === "fill_in_the_blank" && (
                        <div className="space-y-2 pt-1">
                          <Input
                            placeholder={
                              isArabic
                                ? "اكتب الإجابة أو المصطلح الناقص هنا..."
                                : "Type the missing answer or term here..."
                            }
                            value={selectedAnswers[q.id] || ""}
                            onChange={(e) => handleTextAnswer(q.id, e.target.value)}
                            disabled={!!submittedResults}
                            className="bg-secondary/40 border-border/80 focus:border-primary text-sm"
                          />
                          {submittedResults && (
                            <div className="text-xs text-muted-foreground flex items-center gap-2 pt-1">
                              <span className="font-semibold text-primary">
                                {isArabic ? "الإجابة المعتمدة:" : "Approved Answer:"}
                              </span>
                              <span className="font-mono bg-secondary px-2 py-0.5 rounded border border-border">
                                {q.correctAnswerText || q.options[q.correctOptionIndex || 0]}
                              </span>
                            </div>
                          )}
                        </div>
                      )}

                      {qType === "short_answer" && (
                        <div className="space-y-2 pt-1">
                          <Textarea
                            placeholder={
                              isArabic
                                ? "اكتب استنتاجك أو إجابتك التحليلية استناداً إلى شرح المحاضر..."
                                : "Write your analytical answer based on lecture explanation..."
                            }
                            value={selectedAnswers[q.id] || ""}
                            onChange={(e) => handleTextAnswer(q.id, e.target.value)}
                            disabled={!!submittedResults}
                            rows={3}
                            className="bg-secondary/40 border-border/80 focus:border-primary text-sm"
                          />
                          {submittedResults && (
                            <div className="p-3 rounded-xl bg-secondary/30 border border-border/60 text-xs space-y-1">
                              <div className="font-semibold text-primary flex items-center gap-1.5">
                                <PenTool className="h-3.5 w-3.5" />{" "}
                                {isArabic ? "نموذج الإجابة الأكاديمي:" : "Model Answer:"}
                              </div>
                              <p className="text-foreground leading-relaxed">
                                {q.correctAnswerText || q.explanation}
                              </p>
                            </div>
                          )}
                        </div>
                      )}

                      {/* Explanation (Revealed upon submission) */}
                      {resultItem && (
                        <div className="mt-3 rounded-xl border border-primary/20 bg-primary/5 p-3.5 text-xs space-y-1">
                          <div className="font-semibold text-primary flex items-center gap-1.5">
                            <Sparkles className="h-3.5 w-3.5" />{" "}
                            {isArabic
                              ? "التوثيق الاستدلالي من نص المحاضرة:"
                              : "Grounded Lecture Citation:"}
                          </div>
                          <div className="text-foreground/90 leading-relaxed">
                            {resultItem.explanation}
                          </div>
                        </div>
                      )}
                    </GlassCard>
                  );
                })}
              </div>

              {!submittedResults && (
                <div className="flex justify-end pt-2">
                  <Button
                    size="lg"
                    onClick={handleSubmit}
                    disabled={submitMutation.isPending}
                    className="gradient-primary text-primary-foreground shadow-glow cursor-pointer px-8"
                  >
                    {submitMutation.isPending ? (
                      <Loader2 className="h-5 w-5 animate-spin ml-2" />
                    ) : (
                      <Check className="h-5 w-5 ml-2" />
                    )}
                    {isArabic ? "تسليم الاختبار وحساب الدرجة" : "Submit Quiz"}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Attempts History Modal */}
      <Dialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <DialogContent className="max-w-md" dir={isArabic ? "rtl" : "ltr"}>
          <DialogHeader className={isArabic ? "text-right" : "text-left"}>
            <DialogTitle className="font-display flex items-center gap-2">
              <History className="h-5 w-5 text-primary" />
              {isArabic ? "سجل محاولات الاختبار السابق" : "Quiz Attempt History"}
            </DialogTitle>
            <DialogDescription>
              {isArabic
                ? "جميع درجات المحاولات المحفوظة بصورة دائمة في قاعدة البيانات."
                : "All previous attempt scores saved persistently in the database."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 pt-3 max-h-[60vh] overflow-y-auto">
            {attempts.length === 0 ? (
              <p className="text-center text-xs text-muted-foreground py-6">
                {isArabic
                  ? "لا توجد محاولات سابقة مسجلة لهذا الاختبار بعد."
                  : "No previous attempts recorded for this quiz yet."}
              </p>
            ) : (
              attempts.map((att, idx) => (
                <div
                  key={att.id || idx}
                  className="flex items-center justify-between p-3 rounded-xl border border-border/60 bg-secondary/30 text-xs"
                >
                  <div className="space-y-0.5">
                    <div className="font-semibold text-foreground">
                      {isArabic
                        ? `المحاولة ${attempts.length - idx}`
                        : `Attempt ${attempts.length - idx}`}
                    </div>
                    <div className="text-[11px] text-muted-foreground">
                      {new Date(att.submittedAt).toLocaleString(isArabic ? "ar-EG" : "en-US")}
                    </div>
                  </div>
                  <div className="text-left font-mono">
                    <span
                      className={`text-sm font-bold ${
                        att.scorePercent >= 70 ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      {att.scorePercent}%
                    </span>
                    <span className="text-[11px] text-muted-foreground mr-1.5">
                      ({att.correctCount}/{att.totalQuestions})
                    </span>
                  </div>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
