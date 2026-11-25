import { useState, useRef, useEffect, useMemo } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Sparkles,
  Wand2,
  FileText,
  Network,
  Layers,
  BrainCircuit,
  ArrowRight,
  ArrowLeft,
  Send,
  Loader2,
  CheckCircle2,
  Quote,
  Clock,
  AlertCircle,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { GlassCard } from "@/components/common/glass-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, Meeting, Lecture, GroundedAnswer } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { AudioOrb3D } from "@/components/3d/audio-orb-3d";

export default function AIWorkspaceView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, isRtl } = useTranslation();
  const questionInputRef = useRef<HTMLInputElement | null>(null);
  const locationSearchStr = useRouterState({ select: (r) => r.location.searchStr });
  const urlId = useMemo(
    () => new URLSearchParams(locationSearchStr || "").get("id")?.trim() || "",
    [locationSearchStr],
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string>(() => urlId);
  const [question, setQuestion] = useState("");
  const [runningOp, setRunningOp] = useState<string | null>(null);
  const [chatLog, setChatLog] = useState<
    {
      id: string;
      question: string;
      answer: string;
      evidenceFound?: boolean;
      citations: { speaker: string; timestamp: string; quote: string }[];
    }[]
  >([]);
  const [activeAnalysis, setActiveAnalysis] = useState<{
    type: string;
    content: string | object;
  } | null>(null);

  useEffect(() => {
    if (urlId) {
      setSelectedResourceId(urlId);
    }
  }, [urlId]);

  const { data: meetings = [], isLoading: loadingMeetings } = useQuery<Meeting[]>({
    queryKey: ["meetings"],
    queryFn: () => api.getMeetings(),
  });

  const { data: lectures = [], isLoading: loadingLectures } = useQuery<Lecture[]>({
    queryKey: ["lectures"],
    queryFn: () => api.getLectures(),
  });

  const allResources = useMemo(
    () => [
      ...meetings.map((m) => ({
        id: m.id,
        title: isRtl ? `[اجتماع] ${m.title}` : `[Meeting] ${m.title}`,
        type: "meeting" as const,
      })),
      ...lectures.map((l) => ({
        id: l.id,
        title: isRtl
          ? `[محاضرة] ${l.courseCode}: ${l.title}`
          : `[Lecture] ${l.courseCode}: ${l.title}`,
        type: "lecture" as const,
      })),
    ],
    [meetings, lectures, isRtl],
  );

  const requestedId = selectedResourceId || urlId;
  const matchedResource = requestedId
    ? allResources.find((r) => r.id === requestedId) || null
    : null;
  const currentResource =
    matchedResource ||
    (requestedId && (loadingMeetings || loadingLectures) ? undefined : allResources[0]);

  const handleSelectResource = (nextId: string) => {
    setSelectedResourceId(nextId);
    setActiveAnalysis(null);
    setChatLog([]);
    void navigate({
      to: "/ai-workspace",
      search: { id: nextId },
      replace: true,
    });
  };

  const askMutation = useMutation({
    mutationFn: (q: string) => api.askQuestion(q, currentResource?.id),
    onSuccess: (data: GroundedAnswer, askedQuestion: string) => {
      const notMentioned =
        data.evidenceFound === false ||
        data.answer.trim() === "Not mentioned in this recording." ||
        data.answer.trim() === "لم يرد ذكر هذا في التسجيل.";
      setChatLog((prev) => [
        {
          id: `chat_${Date.now()}`,
          question: askedQuestion,
          answer: data.answer,
          evidenceFound: !notMentioned,
          citations: data.citations || [],
        },
        ...prev,
      ]);
      setQuestion("");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : isRtl
            ? "تعذر الإجابة على السؤال"
            : "Failed to answer question",
      );
    },
  });

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim()) return;
    askMutation.mutate(question.trim());
  };

  const runOperation = async (toolKey: string) => {
    if (toolKey === "ask") {
      questionInputRef.current?.focus();
      return;
    }

    if (!currentResource) {
      toast.error(
        isRtl ? "يرجى اختيار تسجيل أو محاضرة أولاً" : "Please select a recording or lecture first",
      );
      return;
    }

    setRunningOp(toolKey);
    try {
      if (toolKey === "summarize") {
        const res = await api.generateSummary(currentResource.id, currentResource.type);
        queryClient.invalidateQueries({ queryKey: ["meetings"] });
        queryClient.invalidateQueries({ queryKey: ["lectures"] });
        setActiveAnalysis({
          type: isRtl ? "الملخص التنفيذي" : "Executive Summary",
          content: res.summary,
        });
        toast.success(
          isRtl ? "تم استخراج وحفظ الملخص التنفيذي بنجاح" : "Summary generated and saved",
        );
      } else if (toolKey === "notes") {
        const res = await api.generateAnalysis(currentResource.id, currentResource.type);
        queryClient.invalidateQueries({ queryKey: ["meetings"] });
        queryClient.invalidateQueries({ queryKey: ["lectures"] });
        setActiveAnalysis({
          type: isRtl ? "الملاحظات والتحليل الهيكلي" : "Structured Analysis & Study Notes",
          content: res.analysis,
        });
        toast.success(
          isRtl
            ? "تم استخراج وحفظ التحليل والملاحظات بنجاح"
            : "Structured analysis generated and saved",
        );
      } else if (toolKey === "quiz") {
        const res = await api.generateQuiz(currentResource.id, currentResource.type, 5);
        queryClient.invalidateQueries({ queryKey: ["quizzes"] });
        setActiveAnalysis({
          type: isRtl ? `اختبار مستخلص: ${res.quiz.title}` : `Generated Quiz: ${res.quiz.title}`,
          content: res.quiz.questions.map((q, idx) => ({
            number: idx + 1,
            type: q.type,
            question: q.question,
            options: q.options,
            correctAnswerText: q.correctAnswerText,
            explanation: q.explanation,
          })),
        });
        toast.success(
          isRtl
            ? `تم حفظ الاختبار باحتوائه على ${res.quiz.questions.length} أسئلة موثقة`
            : `Quiz with ${res.quiz.questions.length} grounded questions saved`,
        );
      } else if (toolKey === "flashcards") {
        const cards = await api.generateFlashcards(
          currentResource.type === "lecture"
            ? { lectureId: currentResource.id }
            : { meetingId: currentResource.id },
        );
        queryClient.invalidateQueries({ queryKey: ["flashcards"] });
        setActiveAnalysis({
          type: isRtl
            ? `بطاقات الاستذكار المولدة (${cards.length})`
            : `Generated Flashcards (${cards.length})`,
          content: cards.map((c) => ({ front: c.front, back: c.back })),
        });
        toast.success(
          isRtl
            ? `تم توليد ${cards.length} بطاقة استذكار بنجاح`
            : `Generated ${cards.length} flashcards`,
        );
      } else if (toolKey === "mindmap") {
        const map = await api.generateMindMap(
          currentResource.type === "lecture"
            ? { lectureId: currentResource.id }
            : { meetingId: currentResource.id },
        );
        queryClient.invalidateQueries({ queryKey: ["mindmaps"] });
        queryClient.invalidateQueries({ queryKey: ["mindMaps"] });
        setActiveAnalysis({
          type: isRtl
            ? `الخريطة الذهنية المفاهيمية: ${map.title}`
            : `Concept Mind Map: ${map.title}`,
          content: map.rootNode,
        });
        toast.success(
          isRtl ? "تم توليد وحفظ الخريطة الذهنية بنجاح" : "Mind map generated and saved",
        );
      }
    } catch (err) {
      toast.error(
        err instanceof Error
          ? err.message
          : isRtl
            ? "فشلت عملية الذكاء الاصطناعي"
            : "AI operation failed",
      );
    } finally {
      setRunningOp(null);
    }
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={isRtl ? "استوديو الذكاء الاصطناعي" : "AI Studio"}
        title={isRtl ? "مساحة عمل الذكاء الاصطناعي" : "AI Workspace"}
        description={
          isRtl
            ? "استفسارات استدلالية، اقتباسات موثقة، وتحويلات ذكية للمحتوى الصوتي الخاص بك."
            : "Grounded questioning, verified citations, and intelligent transformations of your spoken content."
        }
      />
      {/* Target Resource Selector */}
      <GlassCard className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg gradient-primary text-primary-foreground">
            <Sparkles className="h-4 w-4" />
          </div>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              {t("activeContext")}
            </div>
            <div className="text-sm font-medium">
              {currentResource ? currentResource.title : t("noRecordingSelected")}
            </div>
          </div>
        </div>

        <div className="w-full sm:w-72">
          <Select value={currentResource?.id ?? ""} onValueChange={handleSelectResource}>
            <SelectTrigger className="bg-background/50">
              <SelectValue placeholder={t("selectSessionPlaceholder")} />
            </SelectTrigger>
            <SelectContent>
              {allResources.map((res) => (
                <SelectItem key={res.id} value={res.id}>
                  {res.title}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </GlassCard>

      {/* Grounded Q&A Assistant with 3D Hologram */}
      <div className="grid gap-6 lg:grid-cols-[1fr_340px] items-start">
        <GlassCard className="relative overflow-hidden p-6 space-y-4 gold-card-animated-border shadow-2xl">
          <div className="pointer-events-none absolute inset-0 gradient-primary opacity-10" />
          <div className="relative">
            <div className="font-display text-lg font-semibold tracking-tight">
              {isRtl ? "اسأل MeetMind أسئلة استدلالية موثقة" : "Ask MeetMind Grounded Questions"}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {isRtl
                ? 'تخضع جميع الإجابات للتحقق الدقيق من نص التسجيل الفعلي. إذا لم يتوفر دليل في النص، يجيب MeetMind بـ "لم يرد ذكر هذا في التسجيل."'
                : 'All answers are strictly verified against the actual recording transcript. If evidence is not present in the transcript, MeetMind responds with "Not mentioned in this recording."'}
            </p>

            <form onSubmit={handleAsk} className="mt-4 flex gap-2">
              <Input
                ref={questionInputRef}
                placeholder={
                  isRtl
                    ? `اسأل أي سؤال حول ${currentResource?.title || "هذه الجلسة"}...`
                    : `Ask anything about ${currentResource?.title || "this session"}...`
                }
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                className="bg-background/80"
                disabled={askMutation.isPending}
              />
              <Button
                type="submit"
                disabled={askMutation.isPending || !question.trim()}
                className="gradient-primary text-primary-foreground shadow-glow shrink-0 cursor-pointer gap-1.5"
              >
                {askMutation.isPending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <span>{isRtl ? "اسأل" : "Ask"}</span>
                    <Send className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
                  </>
                )}
              </Button>
            </form>

            {chatLog.length > 0 && (
              <div className="mt-6 space-y-4">
                {chatLog.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-xl border border-border/60 bg-background/60 p-4 space-y-3"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-sm font-semibold text-primary">
                        {isRtl ? "س:" : "Q:"} {item.question}
                      </div>
                      {item.evidenceFound === false ? (
                        <Badge
                          variant="outline"
                          className="border-amber-500/40 bg-amber-500/10 text-amber-400 text-[10px] gap-1"
                        >
                          <AlertCircle className="h-3 w-3" />
                          <span>{isRtl ? "غير موجود في النص" : "Not in transcript"}</span>
                        </Badge>
                      ) : (
                        <Badge
                          variant="outline"
                          className="border-emerald-500/40 bg-emerald-500/10 text-emerald-400 text-[10px] gap-1"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>{isRtl ? "موثق بالأدلة" : "Grounded"}</span>
                        </Badge>
                      )}
                    </div>
                    <div className="text-sm text-foreground/90 leading-relaxed">{item.answer}</div>

                    {item.citations && item.citations.length > 0 && (
                      <div className="mt-3 pt-3 border-t border-border/40 space-y-2">
                        <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground flex items-center gap-1.5">
                          <Quote className="h-3 w-3" />
                          <span>
                            {isRtl ? "اقتباسات المصدر الموثقة" : "Grounded Source Citations"}
                          </span>
                        </div>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {item.citations.map((c, idx) => (
                            <div
                              key={idx}
                              className="rounded-lg border border-border/40 bg-secondary/40 p-2.5 text-xs space-y-1"
                            >
                              <div className="flex justify-between items-center text-[10px] text-muted-foreground">
                                <span className="font-medium text-foreground">{c.speaker}</span>
                                <span className="flex items-center gap-1">
                                  <Clock className="h-2.5 w-2.5" /> {c.timestamp}
                                </span>
                              </div>
                              <div className="italic text-muted-foreground">
                                &quot;{c.quote}&quot;
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </GlassCard>

        {/* 3D Holographic Visualizer */}
        <div className="space-y-4">
          <AudioOrb3D
            isPlaying={askMutation.isPending || runningOp !== null}
            size="md"
            title={
              isRtl ? "المجسم الصوتي 3D · Neural Hologram" : "3D Audio Hologram · Neural Hologram"
            }
            className="w-full shadow-2xl"
          />
          <div className="p-3.5 rounded-2xl border border-primary/20 bg-secondary/30 text-xs text-muted-foreground space-y-1.5">
            <div className="text-primary font-semibold flex items-center gap-1.5">
              <Sparkles className="h-3.5 w-3.5" />
              <span>{isRtl ? "محاكاة تفاعلية ثلاثية الأبعاد" : "Interactive 3D Simulation"}</span>
            </div>
            <p className="leading-relaxed text-[11px]">
              {isRtl
                ? "يتفاعل المجسم الذهبي في الزمن الحقيقي مع حركة المؤشر ويحاكي ترددات الصوت المفرغة عبر Three.js وWebGL."
                : "The golden sphere interacts in real time with the cursor and simulates extracted voice frequencies via Three.js and WebGL."}
            </p>
          </div>
        </div>
      </div>

      {/* Operation Results Viewer */}
      {activeAnalysis && (
        <GlassCard className="p-5 border-primary/30">
          <div className="flex justify-between items-center mb-3">
            <h3 className="font-display text-base font-semibold text-primary flex items-center gap-2">
              <CheckCircle2 className="h-4 w-4" /> {activeAnalysis.type}
            </h3>
            <Button variant="ghost" size="sm" onClick={() => setActiveAnalysis(null)}>
              {isRtl ? "إغلاق" : "Dismiss"}
            </Button>
          </div>
          <div className="rounded-xl bg-secondary/30 p-4 text-sm leading-relaxed whitespace-pre-line text-foreground overflow-x-auto">
            {typeof activeAnalysis.content === "string"
              ? activeAnalysis.content
              : JSON.stringify(activeAnalysis.content, null, 2)}
          </div>
        </GlassCard>
      )}

      {/* Intelligence Tools Grid */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {[
          {
            key: "summarize",
            icon: Wand2,
            title: isRtl ? "الملخص التنفيذي" : "Summarize",
            desc: isRtl
              ? "توليد ملخص واضح ومهيكل للمناقشة وتحديد النتائج."
              : "Generate a crisp, structured summary of the discussion.",
          },
          {
            key: "notes",
            icon: FileText,
            title: isRtl ? "ملاحظات دراسية" : "Study Notes",
            desc: isRtl
              ? "ملاحظات دراسية شاملة مع التعريفات والمفاهيم الرئيسية."
              : "Comprehensive notes with key definitions.",
          },
          {
            key: "mindmap",
            icon: Network,
            title: isRtl ? "خريطة ذهنية" : "Mind Map",
            desc: isRtl
              ? "بناء روابط مفاهيمية وشجرية ذكية وهرمية."
              : "Build hierarchical concept connections.",
          },
          {
            key: "flashcards",
            icon: Layers,
            title: isRtl ? "بطاقات استذكار" : "Flashcards",
            desc: isRtl
              ? "استخراج بطاقات مراجعة بنظام التكرار المتباعد."
              : "Extract spaced-repetition memory cards.",
          },
          {
            key: "quiz",
            icon: BrainCircuit,
            title: isRtl ? "مولد الاختبارات" : "Quiz Generator",
            desc: isRtl
              ? "إنشاء أسئلة اختبار تدريبية مع مفاتيح الإجابة المعتمدة."
              : "Synthesize test questions with validated answer keys.",
          },
          {
            key: "ask",
            icon: Sparkles,
            title: isRtl ? "أسئلة استدلالية" : "Grounded Q&A",
            desc: isRtl
              ? "التحقق من الحقائق وطرح الأسئلة المباشرة على النص."
              : "Verify facts and ask questions against the transcript.",
          },
        ].map((t) => {
          const Icon = t.icon;
          const isBusy = runningOp === t.key;
          const NextArrow = isRtl ? ArrowLeft : ArrowRight;
          return (
            <GlassCard
              key={t.key}
              className="group p-5 transition hover:-translate-y-0.5 hover:shadow-glow cursor-pointer"
              onClick={() => !runningOp && runOperation(t.key)}
            >
              <div className="grid h-10 w-10 place-items-center rounded-xl gradient-primary text-primary-foreground">
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Icon className="h-4 w-4" />
                )}
              </div>
              <div className="mt-3 font-display text-base font-semibold tracking-tight">
                {t.title}
              </div>
              <p className="mt-1 text-xs text-muted-foreground">{t.desc}</p>
              <Button
                variant="ghost"
                size="sm"
                disabled={isBusy}
                className="mt-3 -ml-2 text-primary gap-1"
              >
                <span>
                  {isBusy ? (isRtl ? "جارٍ التشغيل..." : "Running...") : isRtl ? "تشغيل" : "Run"}
                </span>
                <NextArrow className="h-3.5 w-3.5" />
              </Button>
            </GlassCard>
          );
        })}
      </div>
    </div>
  );
}
