import { useState, useRef, useEffect, useMemo, lazy, Suspense, type ReactNode } from "react";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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
  Square,
  RotateCcw,
  Trash2,
  Copy,
  Check,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { GlassCard } from "@/components/common/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api, Meeting, Lecture } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

const AudioOrb3D = lazy(() =>
  import("@/components/3d/audio-orb-3d").then((m) => ({ default: m.AudioOrb3D })),
);

function WorkspaceMarkdown({ content }: { content: string }) {
  const [copiedCodeIdx, setCopiedCodeIdx] = useState<number | null>(null);
  const blocks = useMemo(() => {
    const parts: Array<{ type: "text" | "code"; lang?: string; value: string }> = [];
    const regex = /```([a-zA-Z0-9_+-]*)\n?([\s\S]*?)```/g;
    let last = 0;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(content)) !== null) {
      if (m.index > last) {
        parts.push({ type: "text", value: content.slice(last, m.index) });
      }
      parts.push({ type: "code", lang: m[1] || "code", value: m[2].replace(/\n$/, "") });
      last = regex.lastIndex;
    }
    if (last < content.length) {
      parts.push({ type: "text", value: content.slice(last) });
    }
    return parts;
  }, [content]);

  const renderInline = (line: string): ReactNode[] => {
    const out: ReactNode[] = [];
    const tokenRegex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
    let idx = 0;
    let m: RegExpExecArray | null;
    let k = 0;
    while ((m = tokenRegex.exec(line)) !== null) {
      if (m.index > idx) out.push(line.slice(idx, m.index));
      const tok = m[0];
      if (tok.startsWith("**") && tok.endsWith("**")) {
        out.push(
          <strong key={k++} className="font-semibold text-foreground">
            {tok.slice(2, -2)}
          </strong>,
        );
      } else if (tok.startsWith("`") && tok.endsWith("`")) {
        out.push(
          <code
            key={k++}
            dir="ltr"
            className="inline-block rounded bg-secondary/80 px-1.5 py-0.5 font-mono text-[12px] text-primary"
          >
            {tok.slice(1, -1)}
          </code>,
        );
      }
      idx = tokenRegex.lastIndex;
    }
    if (idx < line.length) out.push(line.slice(idx));
    return out;
  };

  return (
    <div className="space-y-2 text-sm text-foreground/90 leading-relaxed">
      {blocks.map((block, bIdx) => {
        if (block.type === "code") {
          return (
            <div
              key={bIdx}
              dir="ltr"
              className="rounded-lg border border-border/70 bg-zinc-950 text-zinc-100 overflow-hidden my-1.5"
            >
              <div className="flex items-center justify-between px-3 py-1 bg-zinc-900/90 border-b border-zinc-800 text-[10px] font-mono text-zinc-400">
                <span>{block.lang || "code"}</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(block.value);
                    setCopiedCodeIdx(bIdx);
                    setTimeout(() => setCopiedCodeIdx(null), 1500);
                  }}
                  className="inline-flex items-center gap-1 hover:text-zinc-100 cursor-pointer"
                >
                  {copiedCodeIdx === bIdx ? (
                    <>
                      <Check className="h-3 w-3 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="h-3 w-3" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
              </div>
              <pre className="p-3 text-xs font-mono overflow-x-auto leading-relaxed">
                <code>{block.value}</code>
              </pre>
            </div>
          );
        }
        const lines = block.value.split(/\r?\n/);
        const nodes: ReactNode[] = [];
        let li = 0;
        while (li < lines.length) {
          const line = lines[li];
          const trimmed = line.trim();
          if (!trimmed) {
            nodes.push(<div key={`sp-${li}`} className="h-1" />);
            li++;
            continue;
          }
          if (
            trimmed.includes("|") &&
            li + 1 < lines.length &&
            /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[li + 1].trim())
          ) {
            const splitRow = (raw: string): string[] =>
              raw
                .trim()
                .replace(/^\|/, "")
                .replace(/\|$/, "")
                .split("|")
                .map((c) => c.trim());
            const headers = splitRow(trimmed);
            li += 2;
            const rows: string[][] = [];
            while (li < lines.length && lines[li].trim().includes("|") && lines[li].trim()) {
              rows.push(splitRow(lines[li]));
              li++;
            }
            nodes.push(
              <div
                key={`tbl-${li}`}
                className="my-2 overflow-x-auto rounded-lg border border-border/60 bg-background/70"
              >
                <table className="w-full border-collapse text-xs">
                  <thead>
                    <tr className="border-b border-border/60 bg-secondary/50">
                      {headers.map((h, hIdx) => (
                        <th
                          key={hIdx}
                          className="px-3 py-1.5 text-start font-semibold text-foreground"
                        >
                          {renderInline(h)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, rIdx) => (
                      <tr
                        key={rIdx}
                        className="border-b border-border/40 last:border-b-0 even:bg-secondary/20"
                      >
                        {headers.map((_, cIdx) => (
                          <td key={cIdx} className="px-3 py-1.5 align-top text-foreground/90">
                            {renderInline(row[cIdx] || "")}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>,
            );
            continue;
          }
          const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
          if (headingMatch) {
            nodes.push(
              <h4 key={`h-${li}`} className="mt-2 font-semibold text-primary">
                {renderInline(headingMatch[2])}
              </h4>,
            );
            li++;
            continue;
          }
          if (/^[-*•]\s+/.test(trimmed)) {
            nodes.push(
              <div key={`ul-${li}`} className="flex items-start gap-2">
                <span className="text-primary mt-0.5">•</span>
                <span>{renderInline(trimmed.replace(/^[-*•]\s+/, ""))}</span>
              </div>,
            );
            li++;
            continue;
          }
          const numMatch = trimmed.match(/^(\d+[.)])\s+(.+)$/);
          if (numMatch) {
            nodes.push(
              <div key={`ol-${li}`} className="flex items-start gap-2">
                <span className="text-primary font-mono text-xs mt-0.5">{numMatch[1]}</span>
                <span>{renderInline(numMatch[2])}</span>
              </div>,
            );
            li++;
            continue;
          }
          nodes.push(<p key={`p-${li}`}>{renderInline(line)}</p>);
          li++;
        }
        return (
          <div key={bIdx} className="space-y-1 break-words">
            {nodes}
          </div>
        );
      })}
    </div>
  );
}

interface WorkspaceChatEntry {
  id: string;
  question: string;
  answer: string;
  evidenceFound?: boolean;
  isStreaming?: boolean;
  isError?: boolean;
  citations: { speaker: string; timestamp: string; quote: string }[];
}

export default function AIWorkspaceView() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { t, isRtl } = useTranslation();
  const questionInputRef = useRef<HTMLTextAreaElement | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const locationSearchStr = useRouterState({ select: (r) => r.location.searchStr });
  const urlId = useMemo(
    () => new URLSearchParams(locationSearchStr || "").get("id")?.trim() || "",
    [locationSearchStr],
  );
  const [selectedResourceId, setSelectedResourceId] = useState<string>(() => urlId);
  const [question, setQuestion] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [runningOp, setRunningOp] = useState<string | null>(null);
  const [chatLog, setChatLog] = useState<WorkspaceChatEntry[]>([]);
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

  // Load persisted Q&A history for the active resource
  useEffect(() => {
    let cancelled = false;
    const resourceId = currentResource?.id;
    if (!resourceId) return;
    api
      .getChatHistory({ resourceId })
      .then((records) => {
        if (cancelled) return;
        // Records arrive chronological (role: "user" | "assistant") — pair each user question with its assistant answer
        const paired: WorkspaceChatEntry[] = [];
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          if (rec.role === "user") {
            const next = records[i + 1];
            if (next && next.role === "assistant") {
              const answerText = next.content || "";
              paired.push({
                id: next.id || rec.id,
                question: rec.content,
                answer: answerText,
                evidenceFound:
                  next.evidenceFound !== false &&
                  answerText.trim() !== "Not mentioned in this recording." &&
                  answerText.trim() !== "لم يرد ذكر هذا في التسجيل.",
                citations: next.citations || [],
              });
              i++;
            }
          }
        }
        setChatLog(paired.reverse());
      })
      .catch(() => {
        // Keep current chatLog on transient error
      });
    return () => {
      cancelled = true;
    };
  }, [currentResource?.id]);

  useEffect(() => {
    return () => {
      abortControllerRef.current?.abort();
    };
  }, []);

  const handleSelectResource = (nextId: string) => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setSelectedResourceId(nextId);
    setActiveAnalysis(null);
    setChatLog([]);
    void navigate({
      to: "/ai-workspace",
      search: { id: nextId },
      replace: true,
    });
  };

  const handleStopStream = () => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsStreaming(false);
    setChatLog((prev) =>
      prev.map((item) => (item.isStreaming ? { ...item, isStreaming: false } : item)),
    );
  };

  const handleClearChat = async () => {
    handleStopStream();
    try {
      await api.clearChatHistory({ resourceId: currentResource?.id });
      setChatLog([]);
      toast.success(isRtl ? "تم مسح سجل المحادثة" : "Chat history cleared");
    } catch {
      toast.error(isRtl ? "تعذر مسح السجل" : "Failed to clear history");
    }
  };

  const askStreaming = async (askedQuestion: string) => {
    const trimmed = askedQuestion.trim();
    if (!trimmed || isStreaming) return;

    abortControllerRef.current?.abort();
    const controller = new AbortController();
    abortControllerRef.current = controller;

    const priorHistory: Array<{ role: "user" | "model"; text: string }> = chatLog
      .slice(0, 5)
      .reverse()
      .flatMap((entry) =>
        entry.isError || !entry.answer
          ? []
          : [
              { role: "user" as const, text: entry.question },
              { role: "model" as const, text: entry.answer },
            ],
      );

    const entryId = `chat_${Date.now()}`;
    setQuestion("");
    setIsStreaming(true);
    setChatLog((prev) => [
      {
        id: entryId,
        question: trimmed,
        answer: "",
        evidenceFound: true,
        isStreaming: true,
        citations: [],
      },
      ...prev,
    ]);

    try {
      const result = await api.askQuestionStream(
        {
          question: trimmed,
          resourceId: currentResource?.id,
          scope: currentResource ? "recording" : "all-recordings",
          history: priorHistory,
        },
        {
          onToken: (token: string) => {
            setChatLog((prev) =>
              prev.map((item) =>
                item.id === entryId ? { ...item, answer: item.answer + token } : item,
              ),
            );
          },
        },
        controller.signal,
      );
      const notMentioned =
        result.evidenceFound === false ||
        /(not mentioned in (?:this|the available) recording|لم يرد ذكر هذا في التسجيل|المعلومة دي غير موجودة في التسجيل المتاح|غير مذكور في هذا التسجيل)/i.test(
          result.answer.trim(),
        );
      setChatLog((prev) =>
        prev.map((item) =>
          item.id === entryId
            ? {
                ...item,
                answer: result.answer || item.answer,
                evidenceFound: !notMentioned,
                citations: result.citations || [],
                isStreaming: false,
                isError: false,
              }
            : item,
        ),
      );
    } catch (err) {
      if ((err as Error)?.name === "AbortError") {
        setChatLog((prev) =>
          prev.map((item) => (item.id === entryId ? { ...item, isStreaming: false } : item)),
        );
      } else {
        const errMsg =
          err instanceof Error
            ? err.message
            : isRtl
              ? "تعذر الإجابة على السؤال"
              : "Failed to answer question";
        setChatLog((prev) =>
          prev.map((item) =>
            item.id === entryId
              ? {
                  ...item,
                  answer: errMsg,
                  isStreaming: false,
                  isError: true,
                  evidenceFound: false,
                }
              : item,
          ),
        );
        toast.error(errMsg);
      }
    } finally {
      if (abortControllerRef.current === controller) {
        abortControllerRef.current = null;
      }
      setIsStreaming(false);
    }
  };

  const handleAsk = (e: React.FormEvent) => {
    e.preventDefault();
    if (!question.trim() || isStreaming) return;
    void askStreaming(question);
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
            <div className="flex items-center justify-between gap-2">
              <div className="font-display text-lg font-semibold tracking-tight">
                {isRtl ? "اسأل MeetMind أسئلة استدلالية موثقة" : "Ask MeetMind Grounded Questions"}
              </div>
              {chatLog.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => void handleClearChat()}
                  className="h-7 px-2 text-xs text-muted-foreground hover:text-destructive gap-1 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>{isRtl ? "مسح السجل" : "Clear"}</span>
                </Button>
              )}
            </div>
            <p className="mt-1 text-xs text-muted-foreground leading-relaxed">
              {isRtl
                ? 'تخضع جميع الإجابات للتحقق الدقيق من نص التسجيل الفعلي مع بث لحظي فوري. إذا لم يتوفر دليل في النص، يجيب MeetMind بـ "لم يرد ذكر هذا في التسجيل."'
                : 'All answers are strictly verified against the actual recording transcript with live token streaming. If evidence is not present in the transcript, MeetMind responds with "Not mentioned in this recording."'}
            </p>

            <form onSubmit={handleAsk} className="mt-4 flex items-end gap-2">
              <textarea
                ref={questionInputRef}
                rows={1}
                placeholder={
                  isRtl
                    ? `اسأل أي سؤال حول ${currentResource?.title || "هذه الجلسة"}... (Shift+Enter لسطر جديد)`
                    : `Ask anything about ${currentResource?.title || "this session"}... (Shift+Enter for newline)`
                }
                value={question}
                onChange={(e) => {
                  setQuestion(e.target.value);
                  const el = e.currentTarget;
                  el.style.height = "auto";
                  el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                    e.preventDefault();
                    if (question.trim() && !isStreaming) {
                      void askStreaming(question);
                    }
                  }
                }}
                className="max-h-32 min-h-10 flex-1 resize-none rounded-md border border-input bg-background/80 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                disabled={isStreaming}
              />
              {isStreaming ? (
                <Button
                  type="button"
                  variant="destructive"
                  onClick={handleStopStream}
                  className="shrink-0 cursor-pointer gap-1.5"
                >
                  <Square className="h-3.5 w-3.5 fill-current" />
                  <span>{isRtl ? "إيقاف" : "Stop"}</span>
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!question.trim()}
                  className="gradient-primary text-primary-foreground shadow-glow shrink-0 cursor-pointer gap-1.5"
                >
                  <span>{isRtl ? "اسأل" : "Ask"}</span>
                  <Send className={cn("h-3.5 w-3.5", isRtl && "rotate-180")} />
                </Button>
              )}
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
                      <div className="flex items-center gap-1.5 shrink-0">
                        {item.isStreaming ? (
                          <Badge
                            variant="outline"
                            className="border-primary/40 bg-primary/10 text-primary text-[10px] gap-1"
                          >
                            <Loader2 className="h-3 w-3 animate-spin" />
                            <span>{isRtl ? "جاري البث..." : "Streaming"}</span>
                          </Badge>
                        ) : item.isError ? (
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() => void askStreaming(item.question)}
                            className="h-6 px-2 text-[10px] border-destructive/40 text-destructive hover:bg-destructive/10 gap-1 cursor-pointer"
                          >
                            <RotateCcw className="h-3 w-3" />
                            <span>{isRtl ? "إعادة المحاولة" : "Retry"}</span>
                          </Button>
                        ) : item.evidenceFound === false ? (
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
                    </div>
                    {item.isStreaming && !item.answer ? (
                      <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                        <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                        <span>
                          {isRtl ? "جارٍ تحليل النص وصياغة الإجابة..." : "Analyzing transcript..."}
                        </span>
                      </div>
                    ) : (
                      <WorkspaceMarkdown content={item.answer} />
                    )}

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

        {/* 3D Holographic Visualizer (Lazy-loaded to keep Three.js off critical path) */}
        <div className="space-y-4">
          <Suspense
            fallback={
              <div className="h-80 w-full rounded-2xl border border-primary/20 bg-secondary/30 flex items-center justify-center text-xs text-muted-foreground gap-2">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                <span>{isRtl ? "تحميل المجسم ثلاثي الأبعاد..." : "Loading 3D Visualizer..."}</span>
              </div>
            }
          >
            <AudioOrb3D
              isPlaying={isStreaming || runningOp !== null}
              size="md"
              title={
                isRtl ? "المجسم الصوتي 3D · Neural Hologram" : "3D Audio Hologram · Neural Hologram"
              }
              className="w-full shadow-2xl"
            />
          </Suspense>
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
