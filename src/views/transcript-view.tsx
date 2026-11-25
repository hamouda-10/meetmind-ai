import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useNavigate, useRouterState } from "@tanstack/react-router";
import {
  FileText,
  Search,
  Play,
  Pause,
  Clock,
  User,
  Edit2,
  Check,
  X,
  Download,
  Copy,
  Mic,
  Sparkles,
  Volume2,
  VolumeX,
  RotateCcw,
  Trash2,
  HelpCircle,
  CheckCircle2,
  XCircle,
  Brain,
  ListOrdered,
  UploadCloud,
  AlertTriangle,
  AlertCircle,
  RefreshCw,
  BookOpen,
  Quote,
  CheckSquare,
  FileDown,
  Boxes,
  Loader2,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { GlassCard } from "@/components/common/glass-card";
import { EmptyState } from "@/components/common/empty-state";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { LiveArabicRecorder } from "@/components/recording/live-arabic-recorder";
import { UploadRecordingDialog } from "@/components/common/upload-recording-dialog";
import { api, Meeting, Lecture, Quiz } from "@/lib/api-client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { matchesArabicQuery } from "@/lib/arabic";
import { AudioOrb3D } from "@/components/3d/audio-orb-3d";
import { useTranslation } from "@/lib/i18n";

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || isNaN(seconds) || seconds < 0) return "00:00";
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
}

export default function TranscriptView() {
  const { language, isRtl } = useTranslation();
  const isArabic = language === "AR";
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  // Reactively read ?id=, ?time=, ?tab= from TanStack Router location
  const locationSearchStr = useRouterState({ select: (r) => r.location.searchStr });
  const { urlId, urlTime, urlTab } = useMemo(() => {
    const params = new URLSearchParams(locationSearchStr || "");
    return {
      urlId: params.get("id")?.trim() || "",
      urlTime: params.get("time")?.trim() || "",
      urlTab: params.get("tab")?.trim() || "",
    };
  }, [locationSearchStr]);

  const [selectedId, setSelectedId] = useState<string>(() => urlId);
  const [activeTab, setActiveTab] = useState<string>(() =>
    urlTab === "transcript" || urlTab === "summary" || urlTab === "quiz" || urlTab === "analysis"
      ? urlTab
      : "transcript",
  );
  const [viewMode, setViewMode] = useState<"continuous" | "segments">("continuous");
  const [searchQuery, setSearchQuery] = useState("");
  const [speakerFilter, setSpeakerFilter] = useState<string>("ALL");
  const [editingSegId, setEditingSegId] = useState<string | null>(null);
  const [editedText, setEditedText] = useState("");
  const [renamingSpeaker, setRenamingSpeaker] = useState<string | null>(null);
  const [newSpeakerName, setNewSpeakerName] = useState("");

  // Modals
  const [liveRecorderOpen, setLiveRecorderOpen] = useState(false);
  const [uploadModalOpen, setUploadModalOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);

  // Audio Player State
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const activeSegmentRef = useRef<HTMLElement | null>(null);
  const lastScrolledSegIdRef = useRef<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [audioDuration, setAudioDuration] = useState(0);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);
  const [volume, setVolume] = useState(1);
  const [isMuted, setIsMuted] = useState(false);
  const [audioAvailable, setAudioAvailable] = useState(true);
  const [show3DVisualizer, setShow3DVisualizer] = useState(false);

  // AI Generation States
  const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
  const [isGeneratingQuiz, setIsGeneratingQuiz] = useState(false);
  const [isGeneratingAnalysis, setIsGeneratingAnalysis] = useState(false);
  const [isRetryingAnalysis, setIsRetryingAnalysis] = useState(false);
  const [isRetranscribing, setIsRetranscribing] = useState(false);
  const [retranscribeProgress, setRetranscribeProgress] = useState<number | null>(null);
  const retranscribePollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [quizQuestionCount, setQuizQuestionCount] = useState<number>(5);

  useEffect(() => {
    return () => {
      if (retranscribePollRef.current) {
        clearInterval(retranscribePollRef.current);
        retranscribePollRef.current = null;
      }
    };
  }, []);

  // Quiz Interaction State
  const [userAnswers, setUserAnswers] = useState<Record<string, number>>({});
  const [quizSubmitted, setQuizSubmitted] = useState(false);

  // Fetch meetings and lectures
  const {
    data: meetings = [],
    isLoading: loadingMeetings,
    isFetching: fetchingMeetings,
  } = useQuery<Meeting[]>({
    queryKey: ["meetings"],
    queryFn: () => api.getMeetings(),
  });

  const {
    data: lectures = [],
    isLoading: loadingLectures,
    isFetching: fetchingLectures,
  } = useQuery<Lecture[]>({
    queryKey: ["lectures"],
    queryFn: () => api.getLectures(),
  });

  const { data: allQuizzes = [] } = useQuery<Quiz[]>({
    queryKey: ["quizzes"],
    queryFn: () => api.getQuizzes(),
  });

  // Combine items sorted newest first so newly uploaded lectures or meetings appear at the top
  const allItems = useMemo<
    Array<{
      id: string;
      title: string;
      rawTitle: string;
      item: Meeting | Lecture;
      type: "meeting" | "lecture";
      courseCode?: string;
    }>
  >(() => {
    const combined = [
      ...meetings.map((m) => ({
        id: m.id,
        title: `اجتماع: ${m.title}`,
        rawTitle: m.title,
        item: m,
        type: "meeting" as const,
      })),
      ...lectures.map((l) => ({
        id: l.id,
        title: `محاضرة: ${l.courseCode} — ${l.title}`,
        rawTitle: l.title,
        item: l,
        type: "lecture" as const,
        courseCode: l.courseCode,
      })),
    ];

    const extractTimestamp = (id: string, fallbackDate?: string) => {
      const match = id.match(/_(\d{10,})/);
      if (match) return Number(match[1]);
      return fallbackDate ? new Date(fallbackDate).getTime() || 0 : 0;
    };

    return combined.sort(
      (a, b) => extractTimestamp(b.id, b.item.date) - extractTimestamp(a.id, a.item.date),
    );
  }, [meetings, lectures]);

  // Reactively sync selectedId & activeTab whenever URL search params change
  useEffect(() => {
    if (urlId) {
      setSelectedId(urlId);
    }
  }, [urlId]);

  useEffect(() => {
    if (
      urlTab === "transcript" ||
      urlTab === "summary" ||
      urlTab === "quiz" ||
      urlTab === "analysis"
    ) {
      setActiveTab(urlTab);
    }
  }, [urlTab, urlId]);

  // Strictly match requested recording ID — NEVER hijack to allItems[0] while queries are loading/fetching!
  const requestedId = selectedId || urlId;
  const matchedSelection = requestedId ? allItems.find((a) => a.id === requestedId) || null : null;
  const isWaitingForRequestedId = Boolean(
    requestedId &&
    !matchedSelection &&
    (loadingMeetings || loadingLectures || fetchingMeetings || fetchingLectures),
  );
  const currentSelection =
    matchedSelection || (isWaitingForRequestedId ? null : allItems[0] || null);

  // Only settle fallback selection AFTER both meetings and lectures finish loading
  useEffect(() => {
    if (loadingMeetings || loadingLectures || fetchingMeetings || fetchingLectures) return;
    if (allItems.length === 0) return;

    if (urlId && allItems.some((a) => a.id === urlId)) {
      if (selectedId !== urlId) {
        setSelectedId(urlId);
      }
      return;
    }

    if (!selectedId || !allItems.some((a) => a.id === selectedId)) {
      setSelectedId(allItems[0].id);
    }
  }, [
    allItems,
    selectedId,
    urlId,
    loadingMeetings,
    loadingLectures,
    fetchingMeetings,
    fetchingLectures,
  ]);

  const handleSelectRecording = (nextId: string) => {
    setSelectedId(nextId);
    const validTab =
      activeTab === "transcript" ||
      activeTab === "summary" ||
      activeTab === "quiz" ||
      activeTab === "analysis"
        ? activeTab
        : undefined;
    void navigate({
      to: "/transcript",
      search: { id: nextId, tab: validTab },
      replace: true,
    });
  };

  // Audio source URL
  const audioSrc = currentSelection ? `/api/v1/recordings/audio/${currentSelection.id}` : "";

  // Reset ALL per-recording local UI state cleanly whenever selected recording changes
  useEffect(() => {
    setIsPlaying(false);
    setCurrentTime(0);
    setAudioDuration(0);
    setAudioAvailable(true);
    setUserAnswers({});
    setQuizSubmitted(false);
    setSearchQuery("");
    setSpeakerFilter("ALL");
    setEditingSegId(null);
    setEditedText("");
    setRenamingSpeaker(null);
    setNewSpeakerName("");
    lastScrolledSegIdRef.current = null;

    if (retranscribePollRef.current) {
      clearInterval(retranscribePollRef.current);
      retranscribePollRef.current = null;
      setIsRetranscribing(false);
      setRetranscribeProgress(null);
    }

    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current.currentTime = 0;
      audioRef.current.load();
    }
  }, [currentSelection?.id]);

  // Audio element listeners
  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) return;

    const handleTimeUpdate = () => setCurrentTime(audio.currentTime);
    const handleLoadedMetadata = () => {
      const dur = audio.duration;
      if (Number.isFinite(dur) && dur > 0) {
        setAudioDuration(dur);
      } else if (currentSelection?.item.durationSeconds) {
        setAudioDuration(currentSelection.item.durationSeconds);
      } else if (currentSelection?.item.segments && currentSelection.item.segments.length > 0) {
        const maxEnd = Math.max(...currentSelection.item.segments.map((s) => s.endTime));
        setAudioDuration(maxEnd || 60);
      } else {
        setAudioDuration(60);
      }
      setAudioAvailable(true);
    };
    const handleEnded = () => setIsPlaying(false);
    const handleError = () => {
      // Audio file might not exist yet for this item
      setAudioAvailable(false);
      setIsPlaying(false);
    };

    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("ended", handleEnded);
    audio.addEventListener("error", handleError);

    return () => {
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("ended", handleEnded);
      audio.removeEventListener("error", handleError);
    };
  }, [currentSelection]);

  // Handle Play/Pause
  const togglePlay = () => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
      setIsPlaying(false);
    } else {
      audioRef.current
        .play()
        .then(() => setIsPlaying(true))
        .catch(() => {
          setIsPlaying(false);
          toast.error("تعذر تشغيل الملف الصوتي. قد لا يتوفر ملف مسجل لهذه الجلسة.");
        });
    }
  };

  // Handle Seek
  const handleSeek = (newSec: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = newSec;
    setCurrentTime(newSec);
  };

  // Handle Jump to Timestamp
  const jumpToTimestamp = (seconds: number) => {
    if (!audioRef.current) return;
    audioRef.current.currentTime = seconds;
    setCurrentTime(seconds);
    audioRef.current
      .play()
      .then(() => setIsPlaying(true))
      .catch(() => {});
    toast.success(`تم الانتقال في التسجيل إلى ${formatTime(seconds)}`);
  };

  // Handle Speed Change
  const handleSpeedChange = (speed: number) => {
    setPlaybackSpeed(speed);
    if (audioRef.current) {
      audioRef.current.playbackRate = speed;
    }
  };

  // Handle Volume Change
  const handleVolumeChange = (newVol: number) => {
    setVolume(newVol);
    setIsMuted(newVol === 0);
    if (audioRef.current) {
      audioRef.current.volume = newVol;
    }
  };

  const toggleMute = () => {
    if (!audioRef.current) return;
    if (isMuted) {
      audioRef.current.volume = volume || 1;
      setIsMuted(false);
    } else {
      audioRef.current.volume = 0;
      setIsMuted(true);
    }
  };

  // Seek to ?time= once when the target recording is loaded
  const lastSeekKeyRef = useRef<string>("");
  useEffect(() => {
    if (!urlTime || !currentSelection?.id) return;
    const seekKey = `${currentSelection.id}:${urlTime}`;
    if (lastSeekKeyRef.current === seekKey) return;
    const parsed = parseFloat(urlTime);
    if (!isNaN(parsed) && parsed >= 0) {
      lastSeekKeyRef.current = seekKey;
      const timer = setTimeout(() => {
        jumpToTimestamp(parsed);
      }, 450);
      return () => clearTimeout(timer);
    }
  }, [urlTime, currentSelection?.id]);

  // Segments & Speakers
  const segments = useMemo(() => currentSelection?.item.segments || [], [currentSelection]);
  const speakers = Array.from(new Set(segments.map((s) => s.speaker)));
  const activeSegId = useMemo(() => {
    const active = segments.find((s) => currentTime >= s.startTime && currentTime <= s.endTime);
    return active?.id || null;
  }, [segments, currentTime]);

  useEffect(() => {
    if (isPlaying && activeSegId && activeSegId !== lastScrolledSegIdRef.current) {
      lastScrolledSegIdRef.current = activeSegId;
      activeSegmentRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [isPlaying, activeSegId]);

  // Filtered segments with Arabic normalization
  const filteredSegments = segments.filter((seg) => {
    const matchesSearch =
      searchQuery === "" ||
      matchesArabicQuery(seg.text, searchQuery) ||
      matchesArabicQuery(seg.speaker, searchQuery);
    const matchesSpeaker = speakerFilter === "ALL" || seg.speaker === speakerFilter;
    return matchesSearch && matchesSpeaker;
  });

  // Edit segment mutation
  const updateMutation = useMutation({
    mutationFn: (newSegments: typeof segments) =>
      api.updateTranscript(currentSelection!.id, newSegments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["lectures"] });
      toast.success("تم حفظ التعديل النصي بنجاح");
      setEditingSegId(null);
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : isArabic
            ? "فشل في حفظ التعديل"
            : "Failed to save edit",
      );
    },
  });

  const renameSpeakerMutation = useMutation({
    mutationFn: ({ oldName, nextName }: { oldName: string; nextName: string }) =>
      api.renameSpeaker(currentSelection!.id, { [oldName]: nextName }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["lectures"] });
      queryClient.invalidateQueries({ queryKey: ["transcript"] });
      if (speakerFilter === vars.oldName) {
        setSpeakerFilter(vars.nextName);
      }
      setRenamingSpeaker(null);
      setNewSpeakerName("");
      toast.success(isArabic ? "تم تحديث اسم المتحدث بنجاح" : "Speaker renamed successfully");
    },
    onError: (err) => {
      toast.error(
        err instanceof Error
          ? err.message
          : isArabic
            ? "تعذر تحديث اسم المتحدث"
            : "Failed to rename speaker",
      );
    },
  });

  const handleSaveEdit = (segId: string) => {
    if (!editedText.trim() || !currentSelection) return;
    const updated = segments.map((s) => (s.id === segId ? { ...s, text: editedText.trim() } : s));
    updateMutation.mutate(updated);
  };

  // Delete Mutation
  const deleteMutation = useMutation({
    mutationFn: async () => {
      if (!currentSelection) return;
      if (currentSelection.type === "meeting") {
        await api.deleteMeeting(currentSelection.id);
      } else {
        await api.deleteLecture(currentSelection.id);
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["meetings"] });
      queryClient.invalidateQueries({ queryKey: ["lectures"] });
      queryClient.invalidateQueries({ queryKey: ["quizzes"] });
      toast.success("تم حذف التسجيل والملف الصوتي المرتبط بنجاح");
      setDeleteConfirmOpen(false);
      setSelectedId("");
      void navigate({ to: "/transcript", search: {}, replace: true });
    },
    onError: (err) => {
      toast.error(err instanceof Error ? err.message : "فشل حذف التسجيل");
    },
  });

  // AI Summary Generation
  const handleGenerateSummary = async () => {
    if (!currentSelection) return;
    setIsGeneratingSummary(true);
    toast.loading(
      isArabic
        ? "جاري توليد التلخيص الشامل الموثق بالذكاء الاصطناعي المدمج..."
        : "Generating comprehensive grounded summary...",
      { id: "summary-gen" },
    );

    try {
      await api.generateSummary(currentSelection.id, currentSelection.type);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["lectures"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      toast.success(
        isArabic ? "تم توليد وحفظ التلخيص الذكي بنجاح!" : "Summary generated and saved!",
        { id: "summary-gen" },
      );
      setActiveTab("summary");
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : isArabic
            ? "تعذر توليد التلخيص بواسطة الذكاء الاصطناعي"
            : "Failed to generate summary";
      toast.error(msg, { id: "summary-gen" });
    } finally {
      setIsGeneratingSummary(false);
    }
  };

  // AI Quiz Generation
  const handleGenerateQuiz = async () => {
    if (!currentSelection) return;
    setIsGeneratingQuiz(true);
    toast.loading(
      isArabic
        ? `جاري بناء وتنسيق ${quizQuestionCount} أسئلة كويز تفاعلي من الجلسة...`
        : `Building ${quizQuestionCount} grounded quiz questions...`,
      { id: "quiz-gen" },
    );

    try {
      await api.generateQuiz(currentSelection.id, currentSelection.type, quizQuestionCount);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["quizzes"] }),
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["lectures"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      setUserAnswers({});
      setQuizSubmitted(false);
      toast.success(
        isArabic ? "تم إنشاء الكويز التقييمي بنجاح!" : "Interactive quiz generated successfully!",
        { id: "quiz-gen" },
      );
      setActiveTab("quiz");
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : isArabic
            ? "تعذر إنشاء الكويز بواسطة الذكاء الاصطناعي"
            : "Failed to generate quiz";
      toast.error(msg, { id: "quiz-gen" });
    } finally {
      setIsGeneratingQuiz(false);
    }
  };

  // AI Lecture Analysis
  const handleGenerateAnalysis = async () => {
    if (!currentSelection) return;
    setIsGeneratingAnalysis(true);
    toast.loading(
      isArabic
        ? "جاري تحليل المحتوى واستخراج المصطلحات والأسئلة..."
        : "Analyzing content, keywords, and key concepts...",
      { id: "analysis-gen" },
    );

    try {
      await api.generateAnalysis(currentSelection.id, currentSelection.type);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["lectures"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);
      toast.success(
        isArabic ? "تم تحديث التحليل الذكي للجلسة بنجاح!" : "Deep analysis updated successfully!",
        { id: "analysis-gen" },
      );
      setActiveTab("analysis");
    } catch (e) {
      const msg =
        e instanceof Error && e.message
          ? e.message
          : isArabic
            ? "تعذر تحليل الجلسة"
            : "Failed to generate analysis";
      toast.error(msg, { id: "analysis-gen" });
    } finally {
      setIsGeneratingAnalysis(false);
    }
  };

  // Re-transcribe original audio with Built-in Whisper AI
  const handleRetranscribeWithWhisper = async () => {
    if (!currentSelection || isRetranscribing) return;
    setIsRetranscribing(true);
    setRetranscribeProgress(5);
    const toastId = "retranscribe-whisper";
    toast.loading(
      isArabic
        ? "جاري إعادة التفريغ الصوتي بدقة عالية عبر Whisper AI..."
        : "Starting fresh transcription with built-in Whisper AI...",
      { id: toastId },
    );

    try {
      const res = await api.reprocessRecording(currentSelection.id);
      if (retranscribePollRef.current) {
        clearInterval(retranscribePollRef.current);
      }

      let lastCount = 0;
      retranscribePollRef.current = setInterval(async () => {
        try {
          const job = await api.getJob(res.jobId);
          setRetranscribeProgress(job.progressPercent || 10);

          if (
            typeof job.partialSegmentsCount === "number" &&
            job.partialSegmentsCount > lastCount
          ) {
            lastCount = job.partialSegmentsCount;
            void queryClient.invalidateQueries({ queryKey: ["meetings"] });
            void queryClient.invalidateQueries({ queryKey: ["lectures"] });
          }

          if (job.status === "Completed") {
            if (retranscribePollRef.current) {
              clearInterval(retranscribePollRef.current);
              retranscribePollRef.current = null;
            }
            setIsRetranscribing(false);
            setRetranscribeProgress(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ["meetings"] }),
              queryClient.invalidateQueries({ queryKey: ["lectures"] }),
              queryClient.invalidateQueries({ queryKey: ["quizzes"] }),
              queryClient.invalidateQueries({ queryKey: ["flashcards"] }),
              queryClient.invalidateQueries({ queryKey: ["mindmaps"] }),
              queryClient.invalidateQueries({ queryKey: ["tasks"] }),
              queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
            ]);
            toast.success(
              isArabic
                ? "اكتملت إعادة التفريغ الصوتي بـ Whisper AI وتحديث التحليل بنجاح!"
                : "Re-transcription with Whisper AI and analysis completed!",
              { id: toastId },
            );
          } else if (job.status === "Failed" || job.status === "Cancelled") {
            if (retranscribePollRef.current) {
              clearInterval(retranscribePollRef.current);
              retranscribePollRef.current = null;
            }
            setIsRetranscribing(false);
            setRetranscribeProgress(null);
            toast.error(
              job.errorMessage ||
                (isArabic
                  ? "فشلت إعادة التفريغ الصوتي بـ Whisper"
                  : "Whisper re-transcription failed"),
              { id: toastId },
            );
          }
        } catch {
          // keep polling briefly until job settles
        }
      }, 1200);
    } catch (e) {
      setIsRetranscribing(false);
      setRetranscribeProgress(null);
      const msg =
        e instanceof Error && e.message
          ? e.message
          : isArabic
            ? "تعذر بدء إعادة التفريغ الصوتي. تأكد من وجود الملف الصوتي."
            : "Failed to start Whisper re-transcription.";
      toast.error(msg, { id: toastId });
    }
  };

  const handleExtractKeywords = async () => {
    await handleGenerateAnalysis();
    setActiveTab("analysis");
  };

  const handleExtractImportantSentences = async () => {
    await handleGenerateAnalysis();
    setActiveTab("analysis");
  };

  const handleExtractTasks = async () => {
    await handleGenerateAnalysis();
    setActiveTab("analysis");
  };

  // Retry Unified AI Analysis (Preserves recorded audio and transcript segments)
  const handleRetryAnalysis = async () => {
    if (!currentSelection) return;
    setIsRetryingAnalysis(true);
    toast.loading(
      isArabic
        ? "جاري إعادة محاولة التحليل الذكي بالذكاء الاصطناعي المدمج..."
        : "Retrying unified AI analysis...",
      { id: "retry-analysis" },
    );
    try {
      const res = await api.retryAnalysis(currentSelection.id, currentSelection.type);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["meetings"] }),
        queryClient.invalidateQueries({ queryKey: ["lectures"] }),
        queryClient.invalidateQueries({ queryKey: ["quizzes"] }),
        queryClient.invalidateQueries({ queryKey: ["flashcards"] }),
        queryClient.invalidateQueries({ queryKey: ["mindmaps"] }),
        queryClient.invalidateQueries({ queryKey: ["tasks"] }),
        queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] }),
      ]);

      if (res.analysisStatus === "Completed") {
        toast.success(
          isArabic
            ? "تم إكمال التحليل الذكي بنجاح وتوليد الملخص والكويز!"
            : "AI analysis completed and summary & quiz updated!",
          { id: "retry-analysis" },
        );
        setActiveTab("summary");
      } else {
        toast.error(
          res.analysisError ||
            (isArabic ? "تعذر إكمال التحليل الذكي" : "Failed to complete AI analysis"),
          { id: "retry-analysis" },
        );
      }
    } catch (e) {
      toast.error(
        e instanceof Error && e.message
          ? e.message
          : isArabic
            ? "تعذرت إعادة محاولة التحليل"
            : "Failed to retry analysis",
        { id: "retry-analysis" },
      );
    } finally {
      setIsRetryingAnalysis(false);
    }
  };

  // Find linked quiz strictly for the active recording
  const currentQuiz = allQuizzes.find(
    (q) =>
      Boolean(currentSelection?.id) &&
      (q.lectureId === currentSelection?.id || q.meetingId === currentSelection?.id),
  );

  // Copy transcript text
  const handleCopyTranscript = () => {
    if (segments.length === 0) {
      toast.info("لا توجد نصوص للنسخ");
      return;
    }
    const textContent = segments
      .map(
        (s) => `[${formatTime(s.startTime)} - ${formatTime(s.endTime)}] ${s.speaker}:\n${s.text}\n`,
      )
      .join("\n");
    navigator.clipboard.writeText(textContent);
    toast.success("تم نسخ النص العربي بالكامل إلى الحافظة");
  };

  // Export TXT
  const handleExportText = () => {
    if (segments.length === 0) {
      toast.info("لا توجد نصوص للتصدير");
      return;
    }
    const textContent =
      `# تفريغ جلسة MeetMind AI: ${currentSelection?.rawTitle || "تفريغ صوتي"}\n` +
      `التاريخ: ${new Date().toLocaleDateString("ar-EG")}\n` +
      `اللغة: العربية (تفريغ مباشر وترجمة فورية)\n\n` +
      segments
        .map(
          (s) =>
            `[${formatTime(s.startTime)} - ${formatTime(s.endTime)}] ${s.speaker}:\n${s.text}\n`,
        )
        .join("\n");

    const blob = new Blob([textContent], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${(currentSelection?.rawTitle || "transcript").replace(/[^a-zA-Z0-9ء-ي_]/g, "_")}_arabic.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("تم تصدير ملف النص العربي (.txt)");
  };

  // Export Unicode / RTL-safe Printable PDF via server UTF-8 HTML export
  const handleExportPDF = async () => {
    if (!currentSelection || segments.length === 0) {
      toast.info("لا توجد نصوص للتصدير");
      return;
    }
    try {
      const html = await api.exportTranscriptHtml(currentSelection.id);

      const iframe = document.createElement("iframe");
      iframe.style.position = "fixed";
      iframe.style.right = "0";
      iframe.style.bottom = "0";
      iframe.style.width = "0";
      iframe.style.height = "0";
      iframe.style.border = "0";
      iframe.srcdoc = html;
      document.body.appendChild(iframe);

      iframe.onload = () => {
        try {
          iframe.contentWindow?.focus();
          iframe.contentWindow?.print();
          toast.success("تم تجهيز مستند PDF (دعم كامل للعربية وRTL)");
        } finally {
          setTimeout(() => {
            if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
          }, 2000);
        }
      };
    } catch {
      window.print();
    }
  };

  // Export Word / DOCX
  const handleExportWord = () => {
    if (segments.length === 0) {
      toast.info("لا توجد نصوص للتصدير");
      return;
    }
    const title = currentSelection?.rawTitle || "التفريغ الصوتي";
    const sessionDate = new Date().toLocaleDateString("ar-EG");
    const duration = formatTime(effectiveDuration);

    const segmentsHtml = segments
      .map(
        (seg) => `
        <div style="margin-bottom: 14px; padding: 10px 14px; background: #fdfbf7; border-right: 4px solid #D4AF37; border-radius: 4px;">
          <div style="font-size: 11pt; font-weight: bold; color: #1e293b; margin-bottom: 4px;">
            [${formatTime(seg.startTime)} - ${formatTime(seg.endTime)}] ${seg.speaker}:
          </div>
          <div style="font-size: 12pt; line-height: 1.8; color: #0f172a;">
            ${seg.text}
          </div>
        </div>
      `,
      )
      .join("");

    const wordHtml = `
      <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40">
      <head>
        <meta charset="utf-8">
        <title>${title}</title>
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Arial, sans-serif;
            direction: rtl;
            text-align: right;
            margin: 30px;
            color: #0f172a;
          }
          h1 { color: #855800; font-size: 20pt; margin-bottom: 6px; }
          .meta { color: #64748b; font-size: 11pt; margin-bottom: 24px; border-bottom: 1px solid #e2e8f0; padding-bottom: 12px; }
        </style>
      </head>
      <body>
        <h1>${title} - MeetMind AI</h1>
        <div class="meta">
          <span><strong>تاريخ الجلسة:</strong> ${sessionDate}</span> |
          <span><strong>المدة الزمنية:</strong> ${duration}</span> |
          <span><strong>عدد المقاطع:</strong> ${segments.length} مقطع</span>
        </div>
        ${segmentsHtml}
      </body>
      </html>
    `;

    const blob = new Blob(["\ufeff" + wordHtml], {
      type: "application/msword;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9ء-ي_]/g, "_")}_transcript.doc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("تم تصدير مستند Word (.doc) بنجاح!");
  };

  // Export Captions (WebVTT / SRT)
  const handleExportCaptions = (format: "vtt" | "srt") => {
    if (!currentSelection) {
      toast.info("يرجى اختيار تسجيل أولاً");
      return;
    }
    const downloadUrl = `/api/v1/transcripts/${currentSelection.id}/captions?format=${format}`;
    const a = document.createElement("a");
    a.href = downloadUrl;
    a.download = `${currentSelection.rawTitle.replace(/[^a-zA-Z0-9ء-ي_]/g, "_")}.${format}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    toast.success(`جاري تحميل ملف الترجمة (${format.toUpperCase()})...`);
  };

  // Copy Summary
  const handleCopySummary = (text: string) => {
    navigator.clipboard.writeText(text);
    toast.success("تم نسخ التلخيص إلى الحافظة");
  };

  // Calculate Quiz Score
  const calculateQuizScore = () => {
    if (!currentQuiz) return { score: 0, total: 0, percent: 0 };
    let correct = 0;
    currentQuiz.questions.forEach((q) => {
      if (userAnswers[q.id] === q.correctOptionIndex) {
        correct++;
      }
    });
    const total = currentQuiz.questions.length;
    const percent = total > 0 ? Math.round((correct / total) * 100) : 0;
    return { score: correct, total, percent };
  };

  const effectiveDuration = audioDuration || currentSelection?.item.durationSeconds || 180;

  // Active item's summary text
  const currentSummary =
    currentSelection?.type === "meeting"
      ? (currentSelection.item as Meeting).summary ||
        (currentSelection.item as Meeting).detailedSummary ||
        (currentSelection.item as Meeting).executiveSummary
      : (currentSelection?.item as Lecture)?.studyNotes ||
        (currentSelection?.item as Lecture)?.summary ||
        (currentSelection?.item as Lecture)?.detailedSummary;

  // Active item's analysis
  const currentAnalysis = currentSelection?.item.analysis;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      {/* Hidden native HTML audio element (keyed by recording ID so audio always reloads cleanly) */}
      {audioSrc && (
        <audio
          key={currentSelection?.id || "none"}
          ref={audioRef}
          src={audioSrc}
          preload="metadata"
          className="hidden"
        />
      )}

      <PageHeader
        eyebrow={isArabic ? "استوديو الذكاء الاصطناعي" : "AI Speech & Lecture Studio"}
        title={
          isArabic
            ? "التفريغ والتلخيص والاختبارات الذكية"
            : "Transcription, Summary & Smart Quizzes"
        }
        description={
          isArabic
            ? "تسجيل صوتي عالي الدقة، تفريغ وترجمة فورية، تلخيص مقسم لمحاور أساسية، وتوليد كويزات تفاعلية مستندة كلياً إلى المحتوى."
            : "High-fidelity audio recording, synchronized transcription, structured AI summaries, and grounded interactive quizzes."
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            <div className="gold-btn-rotating-border">
              <Button
                onClick={() => setLiveRecorderOpen(true)}
                className="gold-btn-rotating-border-inner h-9 px-4 gap-2 text-xs font-semibold cursor-pointer text-primary hover:text-white"
              >
                <Mic className="h-4 w-4" />
                {isArabic ? "بدء تسجيل مباشر" : "Start Live Recording"}
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setUploadModalOpen(true)}
              className="cursor-pointer text-xs gap-1.5 border-border/70 hover:border-primary/50"
            >
              <UploadCloud className="h-4 w-4 text-primary" />
              {isArabic ? "رفع ملف صوتي" : "Upload Audio File"}
            </Button>
            <Button
              variant={show3DVisualizer ? "default" : "outline"}
              size="sm"
              onClick={() => setShow3DVisualizer(!show3DVisualizer)}
              className={`cursor-pointer text-xs gap-1.5 ${
                show3DVisualizer
                  ? "gradient-primary text-primary-foreground shadow-glow"
                  : "border-primary/40 text-primary hover:bg-primary/10"
              }`}
            >
              <Boxes className="h-4 w-4" />
              <span>{isArabic ? "مجسم 3D للموجات" : "3D Audio Orb"}</span>
            </Button>
          </div>
        }
      />

      {/* Loading requested recording from URL ?id= without flashing wrong item */}
      {isWaitingForRequestedId ? (
        <GlassCard className="my-8 p-12 flex flex-col items-center justify-center gap-3 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
          <p className="text-sm font-medium text-muted-foreground">
            {isArabic ? "جاري تحميل بيانات الجلسة المحددة..." : "Loading selected recording..."}
          </p>
        </GlassCard>
      ) : allItems.length === 0 && !loadingMeetings && !loadingLectures ? (
        <EmptyState
          icon={Mic}
          title={isArabic ? "لا توجد أي تسجيلات أو محاضرات بعد" : "No recordings or lectures yet"}
          description={
            isArabic
              ? "النظام في حالة نظيفة وجاهز لاستقبال أول جلسة. يمكنك الضغط على 'بدء تسجيل مباشر' للتحدث أو رفع ملف صوتي ليتم تفريغه وتحليله تلقائياً."
              : "Ready for your first session. Click 'Start Live Recording' or upload an audio file to generate synchronized transcripts and AI analysis."
          }
          className="my-8"
        >
          <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
            <Button
              onClick={() => setLiveRecorderOpen(true)}
              className="gradient-primary text-primary-foreground shadow-glow px-6 py-2.5 text-sm font-semibold cursor-pointer gap-2"
            >
              <Mic className="h-4 w-4" />
              {isArabic ? "ابدأ أول تسجيل صوتي مباشر الآن" : "Start Live Recording Now"}
            </Button>
            <Button
              variant="outline"
              onClick={() => setUploadModalOpen(true)}
              className="px-5 py-2.5 text-sm cursor-pointer gap-2"
            >
              <UploadCloud className="h-4 w-4" />
              {isArabic ? "رفع ملف صوتي مسجل" : "Upload Audio File"}
            </Button>
          </div>
        </EmptyState>
      ) : (
        <>
          {/* Top Session Bar & Selector */}
          <GlassCard className="p-4 flex flex-col md:flex-row items-center justify-between gap-4">
            <div className="flex items-center gap-3 w-full md:w-auto flex-1">
              <span className="text-xs font-semibold text-muted-foreground whitespace-nowrap">
                {isArabic ? "الجلسة المحددة:" : "Selected Session:"}
              </span>
              <Select value={currentSelection?.id ?? ""} onValueChange={handleSelectRecording}>
                <SelectTrigger
                  className={`w-full md:w-96 bg-background/60 ${isRtl ? "text-right" : "text-left"}`}
                >
                  <SelectValue
                    placeholder={
                      isArabic ? "اختر جلسة أو محاضرة..." : "Select session or lecture..."
                    }
                  />
                </SelectTrigger>
                <SelectContent>
                  {allItems.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {currentSelection && (
                <Badge
                  variant={currentSelection.type === "meeting" ? "secondary" : "outline"}
                  className="text-xs font-mono shrink-0"
                >
                  {isArabic
                    ? currentSelection.type === "meeting"
                      ? "اجتماع عمل"
                      : "محاضرة جامعية"
                    : currentSelection.type === "meeting"
                      ? "Meeting"
                      : "Lecture"}
                </Badge>
              )}
            </div>

            {/* Quick Session Actions */}
            {currentSelection && (
              <div className="flex items-center gap-2 self-end md:self-auto shrink-0 flex-wrap">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleCopyTranscript}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" /> {isArabic ? "نسخ النص" : "Copy"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportText}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" /> {isArabic ? "تصدير TXT" : "Export TXT"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleExportPDF}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  <FileDown className="h-3.5 w-3.5" /> {isArabic ? "تصدير PDF" : "Export PDF"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExportCaptions("vtt")}
                  className="cursor-pointer text-xs gap-1.5"
                  title={
                    isArabic
                      ? "تصدير ملف ترجمة WebVTT مع التوقيتات الدقيقة"
                      : "Export WebVTT captions"
                  }
                >
                  <FileText className="h-3.5 w-3.5" /> {isArabic ? "ترجمة VTT" : "VTT"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleExportCaptions("srt")}
                  className="cursor-pointer text-xs gap-1.5"
                  title={
                    isArabic
                      ? "تصدير ملف ترجمة SubRip SRT مع التوقيتات الدقيقة"
                      : "Export SRT captions"
                  }
                >
                  <FileText className="h-3.5 w-3.5" /> {isArabic ? "ترجمة SRT" : "SRT"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setDeleteConfirmOpen(true)}
                  className="cursor-pointer text-xs text-destructive hover:bg-destructive/10 gap-1.5"
                >
                  <Trash2 className="h-3.5 w-3.5" /> {isArabic ? "حذف التسجيل" : "Delete"}
                </Button>
              </div>
            )}
          </GlassCard>

          {/* Full Audio Player with Timeline Seeking, Speeds, and Download */}
          {currentSelection && (
            <GlassCard className="p-4 bg-secondary/30 space-y-3 gold-card-animated-border shadow-2xl">
              <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
                {/* Track Info */}
                <div className={`w-full sm:w-auto ${isRtl ? "text-right" : "text-left"}`}>
                  <div className="text-sm font-semibold truncate max-w-md">
                    {currentSelection.rawTitle}
                  </div>
                  <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                    {audioAvailable ? (
                      <span className="text-emerald-500 font-medium flex items-center gap-1 text-[11px]">
                        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                        {isArabic
                          ? "الملف الصوتي جاهز للبث والمزامنة"
                          : "Audio ready for playback & sync"}
                      </span>
                    ) : (
                      <span className="text-amber-500 font-medium text-[11px]">
                        {isArabic
                          ? "الملف الصوتي غير متاح (تفريغ نصي فقط)"
                          : "Audio unavailable (transcript only)"}
                      </span>
                    )}
                    <span>•</span>
                    <span className="font-mono text-[11px]">
                      {isArabic
                        ? `المدة الإجمالية: ${formatTime(effectiveDuration)}`
                        : `Duration: ${formatTime(effectiveDuration)}`}
                    </span>
                  </div>
                </div>

                {/* Primary Playback & Controls */}
                <div className="flex items-center gap-2 shrink-0">
                  {/* Download Audio */}
                  <a
                    href={`/api/v1/recordings/download/${currentSelection.id}`}
                    download={`${currentSelection.rawTitle}.webm`}
                    className="inline-flex items-center justify-center h-8 px-2.5 rounded-lg border border-border/60 bg-background/50 hover:bg-background text-xs font-medium transition cursor-pointer gap-1"
                    title={isArabic ? "تنزيل الملف الصوتي الأصلي" : "Download original audio"}
                  >
                    <Download className="h-3.5 w-3.5" />
                    <span className="hidden md:inline">
                      {isArabic ? "تنزيل الصوت" : "Download Audio"}
                    </span>
                  </a>

                  {/* Playback Speed */}
                  <Select
                    value={String(playbackSpeed)}
                    onValueChange={(val) => handleSpeedChange(parseFloat(val))}
                  >
                    <SelectTrigger className="h-8 w-20 bg-background/50 text-xs font-mono">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="0.75">0.75x</SelectItem>
                      <SelectItem value="1">1.0x</SelectItem>
                      <SelectItem value="1.25">1.25x</SelectItem>
                      <SelectItem value="1.5">1.5x</SelectItem>
                      <SelectItem value="2">2.0x</SelectItem>
                    </SelectContent>
                  </Select>

                  {/* Volume Control */}
                  <div className="hidden lg:flex items-center gap-1.5 bg-background/40 px-2 py-1 rounded-lg">
                    <button
                      onClick={toggleMute}
                      className="text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      {isMuted ? (
                        <VolumeX className="h-3.5 w-3.5" />
                      ) : (
                        <Volume2 className="h-3.5 w-3.5" />
                      )}
                    </button>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={isMuted ? 0 : volume}
                      onChange={(e) => handleVolumeChange(parseFloat(e.target.value))}
                      className="w-16 h-1 accent-primary cursor-pointer"
                    />
                  </div>

                  {/* Play/Pause Button */}
                  <Button
                    size="icon"
                    className="h-10 w-10 rounded-full gradient-primary text-primary-foreground shadow-glow cursor-pointer shrink-0"
                    onClick={togglePlay}
                  >
                    {isPlaying ? (
                      <Pause className="h-4 w-4" />
                    ) : (
                      <Play className="h-4 w-4 ml-0.5" />
                    )}
                  </Button>
                </div>
              </div>

              {/* Seeker Bar with Timers */}
              <div className="flex items-center gap-3 pt-1">
                <span className="text-xs font-mono text-muted-foreground shrink-0 w-11 text-left">
                  {formatTime(currentTime)}
                </span>

                <input
                  type="range"
                  min={0}
                  max={effectiveDuration || 100}
                  step={0.5}
                  value={currentTime}
                  onChange={(e) => handleSeek(parseFloat(e.target.value))}
                  className="flex-1 h-2 bg-secondary rounded-lg appearance-none cursor-pointer accent-primary"
                />

                <span className="text-xs font-mono text-muted-foreground shrink-0 w-11 text-right">
                  {formatTime(effectiveDuration)}
                </span>
              </div>
            </GlassCard>
          )}

          {/* 3D Neural Soundwave Visualizer */}
          {show3DVisualizer && currentSelection && (
            <div className="animate-in fade-in zoom-in-95 duration-300">
              <AudioOrb3D
                isPlaying={isPlaying}
                size="md"
                title={
                  isArabic
                    ? `الموجات الصوتية ثلاثية الأبعاد: ${currentSelection.rawTitle}`
                    : `3D Soundwave Orb: ${currentSelection.rawTitle}`
                }
                className="w-full shadow-2xl"
              />
            </div>
          )}

          {/* Analysis Status Banners */}
          {currentSelection && currentSelection.item.analysisStatus === "Unavailable" && (
            <div
              className={`p-4 rounded-xl border border-amber-500/40 bg-amber-500/10 text-amber-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in fade-in ${isRtl ? "text-right" : "text-left"}`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-amber-300 flex items-center gap-2">
                    <span>
                      {isArabic
                        ? "التفريغ الصوتي مكتمل ومحفوظ بنجاح"
                        : "Audio transcript complete & preserved"}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 font-mono">
                      HTTP 503 UNAVAILABLE
                    </span>
                  </div>
                  <div className="text-xs text-amber-200/80 leading-relaxed">
                    {currentSelection.item.analysisError ||
                      (isArabic
                        ? "خوادم الذكاء الاصطناعي تشهد ضغطاً عالياً ومؤقتاً. تم حفظ الصوت والتفريغ النصي بنسبة 100%. يمكنك الضغط على 'إعادة محاولة التحليل' الآن أو لاحقاً دون إعادة تسجيل الصوت."
                        : "AI servers are experiencing temporary high demand. Audio and transcript are 100% saved. Click 'Retry Analysis Now' to run without re-recording.")}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                onClick={handleRetryAnalysis}
                disabled={isRetryingAnalysis}
                className="shrink-0 bg-amber-500 hover:bg-amber-600 text-black font-semibold text-xs gap-1.5 cursor-pointer shadow-md"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRetryingAnalysis ? "animate-spin" : ""}`} />
                {isArabic ? "إعادة محاولة التحليل الآن" : "Retry Analysis Now"}
              </Button>
            </div>
          )}

          {currentSelection && currentSelection.item.analysisStatus === "Failed" && (
            <div
              className={`p-4 rounded-xl border border-destructive/40 bg-destructive/10 text-destructive-foreground flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-lg animate-in fade-in ${isRtl ? "text-right" : "text-left"}`}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <div className="text-sm font-semibold text-destructive">
                    {isArabic
                      ? "تعذر التحليل الذكي (التفريغ الصوتي محفوظ بالكامل)"
                      : "AI analysis unavailable (transcript safely saved)"}
                  </div>
                  <div className="text-xs text-muted-foreground leading-relaxed">
                    {currentSelection.item.analysisError ||
                      (isArabic
                        ? "حدث خطأ أثناء إجراء التحليل الذكي. التسجيل الصوتي والنص محفوظان بأمان في قاعدة البيانات."
                        : "An error occurred during AI analysis. Audio recording and transcript are safely saved.")}
                  </div>
                </div>
              </div>
              <Button
                size="sm"
                variant="destructive"
                onClick={handleRetryAnalysis}
                disabled={isRetryingAnalysis}
                className="shrink-0 text-xs gap-1.5 cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${isRetryingAnalysis ? "animate-spin" : ""}`} />
                {isArabic ? "إعادة المحاولة" : "Retry"}
              </Button>
            </div>
          )}

          {currentSelection && currentSelection.item.analysisStatus === "Processing" && (
            <div className="p-3.5 rounded-xl border border-primary/30 bg-primary/10 text-foreground flex items-center justify-between gap-3 shadow-md animate-in fade-in">
              <div className="flex items-center gap-2.5">
                <Sparkles className="h-4 w-4 text-primary animate-spin" />
                <span className="text-xs font-medium">
                  {isArabic
                    ? "جاري تشغيل المعالجة والتحليل الذكي عبر الذكاء الاصطناعي المدمج في الخلفية..."
                    : "Built-in AI processing and analysis running in background..."}
                </span>
              </div>
              <span className="text-[11px] text-muted-foreground">
                {isArabic ? "التفريغ الصوتي مكتمل ومتاح" : "Transcript complete & available"}
              </span>
            </div>
          )}

          {/* Direct Manual Actions on Recording & Transcript */}
          {currentSelection && (
            <GlassCard className="p-3.5 bg-card/70 border border-primary/20 space-y-2.5">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-1 text-xs font-semibold px-1">
                <span className="flex items-center gap-1.5 text-primary">
                  <Sparkles className="h-3.5 w-3.5" />
                  {isArabic
                    ? "العمليات والإجراءات الفورية على التسجيل والنص"
                    : "Instant AI Operations & File Exports"}
                </span>
                <span className="text-[11px] font-normal text-muted-foreground">
                  {isArabic
                    ? "عمليات ذكاء اصطناعي ومعالجة حقيقية متصلة بقاعدة البيانات"
                    : "Grounded AI pipelines linked directly to persistent storage"}
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {/* 0. إعادة التفريغ الصوتي بـ Whisper */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleRetranscribeWithWhisper}
                  disabled={isRetranscribing || !audioAvailable}
                  className="cursor-pointer text-xs gap-1.5 border-amber-500/40 hover:border-amber-400 hover:bg-amber-500/10"
                  title={
                    !audioAvailable
                      ? isArabic
                        ? "الملف الصوتي غير متاح على القرص لإعادة التفريغ"
                        : "Original audio file is not available on disk"
                      : isArabic
                        ? "إعادة التفريغ الصوتي من الملف الأصلي باستخدام Whisper AI المدمج"
                        : "Re-transcribe original audio from scratch using Built-in Whisper AI"
                  }
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 text-amber-500 ${isRetranscribing ? "animate-spin" : ""}`}
                  />
                  {isRetranscribing
                    ? isArabic
                      ? `جاري التفريغ (${retranscribeProgress ?? 0}%)...`
                      : `Transcribing (${retranscribeProgress ?? 0}%)...`
                    : isArabic
                      ? "إعادة التفريغ الصوتي بـ Whisper"
                      : "Re-transcribe with Whisper AI"}
                </Button>

                {/* 1. تلخيص النص */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateSummary}
                  disabled={isGeneratingSummary}
                  className="cursor-pointer text-xs gap-1.5 border-primary/30 hover:border-primary hover:bg-primary/10"
                >
                  <Sparkles
                    className={`h-3.5 w-3.5 text-primary ${isGeneratingSummary ? "animate-spin" : ""}`}
                  />
                  {isArabic ? "تلخيص النص" : "Summarize"}
                </Button>

                {/* 2. استخراج الكلمات المهمة */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExtractKeywords}
                  disabled={isGeneratingAnalysis}
                  className="cursor-pointer text-xs gap-1.5 border-cyan-500/30 hover:border-cyan-500 hover:bg-cyan-500/10"
                >
                  <BookOpen className="h-3.5 w-3.5 text-cyan-500" />
                  {isArabic ? "استخراج الكلمات المهمة" : "Extract Keywords"}
                </Button>

                {/* 3. استخراج الجمل المهمة */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExtractImportantSentences}
                  disabled={isGeneratingAnalysis}
                  className="cursor-pointer text-xs gap-1.5 border-amber-500/30 hover:border-amber-500 hover:bg-amber-500/10"
                >
                  <Quote className="h-3.5 w-3.5 text-amber-500" />
                  {isArabic ? "استخراج الجمل المهمة" : "Important Quotes"}
                </Button>

                {/* 4. استخراج المهام */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleExtractTasks}
                  disabled={isGeneratingAnalysis}
                  className="cursor-pointer text-xs gap-1.5 border-emerald-500/30 hover:border-emerald-500 hover:bg-emerald-500/10"
                >
                  <CheckSquare className="h-3.5 w-3.5 text-emerald-500" />
                  {isArabic ? "استخراج المهام" : "Extract Tasks"}
                </Button>

                {/* 5. إنشاء كويز */}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleGenerateQuiz}
                  disabled={isGeneratingQuiz}
                  className="cursor-pointer text-xs gap-1.5 border-pink-500/30 hover:border-pink-500 hover:bg-pink-500/10"
                >
                  <Brain
                    className={`h-3.5 w-3.5 text-pink-500 ${isGeneratingQuiz ? "animate-pulse" : ""}`}
                  />
                  {isArabic ? "إنشاء كويز" : "Generate Quiz"}
                </Button>

                {/* 6. نسخ النص بالكامل */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleCopyTranscript}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {isArabic ? "نسخ النص بالكامل" : "Copy Full Text"}
                </Button>

                {/* 7. تحميل النص TXT */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleExportText}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  <Download className="h-3.5 w-3.5" />
                  {isArabic ? "تحميل النص TXT" : "Download TXT"}
                </Button>

                {/* تحميل PDF */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleExportPDF}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  <FileDown className="h-3.5 w-3.5" />
                  {isArabic ? "تحميل PDF" : "Download PDF"}
                </Button>

                {/* تحميل Word DOCX */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={handleExportWord}
                  className="cursor-pointer text-xs gap-1.5 border-primary/20 hover:border-primary/50"
                >
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  {isArabic ? "تحميل Word (.doc)" : "Download Word (.doc)"}
                </Button>

                {/* تحميل ترجمة VTT */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleExportCaptions("vtt")}
                  className="cursor-pointer text-xs gap-1.5"
                  title={isArabic ? "تصدير ملف ترجمة WebVTT" : "Export WebVTT"}
                >
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  {isArabic ? "ترجمة VTT" : "VTT"}
                </Button>

                {/* تحميل ترجمة SRT */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => handleExportCaptions("srt")}
                  className="cursor-pointer text-xs gap-1.5"
                  title={isArabic ? "تصدير ملف ترجمة SRT" : "Export SRT"}
                >
                  <FileText className="h-3.5 w-3.5 text-primary" />
                  {isArabic ? "ترجمة SRT" : "SRT"}
                </Button>

                {/* 8. تشغيل الصوت */}
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={togglePlay}
                  className="cursor-pointer text-xs gap-1.5"
                >
                  {isPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
                  {isPlaying
                    ? isArabic
                      ? "إيقاف مؤقت"
                      : "Pause"
                    : isArabic
                      ? "تشغيل الصوت"
                      : "Play Audio"}
                </Button>

                {/* 9. تحميل الملف الصوتي */}
                <a
                  href={`/api/v1/recordings/download/${currentSelection.id}`}
                  download={`${currentSelection.rawTitle}.webm`}
                  className="inline-flex items-center justify-center h-8 px-3 rounded-lg border border-border/60 bg-secondary/80 hover:bg-secondary text-xs font-medium transition cursor-pointer gap-1.5"
                >
                  <Download className="h-3.5 w-3.5 text-muted-foreground" />
                  {isArabic ? "تحميل الملف الصوتي" : "Download Audio"}
                </a>
              </div>
            </GlassCard>
          )}

          {/* Main Workspace Navigation: 4 Core Capabilities */}
          <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
            <TabsList className="grid grid-cols-2 md:grid-cols-4 bg-card/60 p-1 border border-border/60 rounded-xl">
              <TabsTrigger
                value="transcript"
                className="gap-1.5 text-xs font-semibold cursor-pointer"
              >
                <FileText className="h-3.5 w-3.5" />
                {isArabic ? "النص المفرغ الكامل" : "Full Transcript"}
              </TabsTrigger>
              <TabsTrigger value="summary" className="gap-1.5 text-xs font-semibold cursor-pointer">
                <Sparkles className="h-3.5 w-3.5 text-primary" />
                {isArabic ? "تلخيص المحاضرة" : "Summary"}
              </TabsTrigger>
              <TabsTrigger value="quiz" className="gap-1.5 text-xs font-semibold cursor-pointer">
                <Brain className="h-3.5 w-3.5 text-pink-500" />
                {isArabic ? "كويز تفاعلي" : "Interactive Quiz"}
              </TabsTrigger>
              <TabsTrigger
                value="analysis"
                className="gap-1.5 text-xs font-semibold cursor-pointer"
              >
                <ListOrdered className="h-3.5 w-3.5 text-cyan-500" />
                {isArabic ? "تحليل المحاضرة والبيانات" : "Analytics & Insights"}
              </TabsTrigger>
            </TabsList>

            {/* TAB 1: TRANSCRIPT */}
            <TabsContent value="transcript" className="space-y-4">
              {/* Toolbar: Search, Speaker Filter, and View Mode Toggle */}
              <GlassCard className="p-3.5 flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="relative flex-1 w-full">
                  <Search
                    className={`absolute ${isRtl ? "right-3" : "left-3"} top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground`}
                  />
                  <Input
                    placeholder={
                      isArabic
                        ? "ابحث داخل النص المفرغ بالكلمة أو العبارة..."
                        : "Search transcript by keyword or phrase..."
                    }
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className={`${isRtl ? "pr-9 pl-3 text-right" : "pl-9 pr-3 text-left"} bg-background/50 text-sm`}
                  />
                </div>

                <div className="flex items-center gap-2 w-full sm:w-auto shrink-0">
                  <Select value={speakerFilter} onValueChange={setSpeakerFilter}>
                    <SelectTrigger
                      className={`w-36 bg-background/50 ${isRtl ? "text-right" : "text-left"} text-xs`}
                    >
                      <SelectValue placeholder={isArabic ? "المتحدث" : "Speaker"} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="ALL">
                        {isArabic ? "جميع المتحدثين" : "All Speakers"}
                      </SelectItem>
                      {speakers.map((spk) => (
                        <SelectItem key={spk} value={spk}>
                          {spk}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <div className="flex bg-secondary/50 p-1 rounded-xl border border-border/40 shrink-0">
                    <button
                      onClick={() => setViewMode("continuous")}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                        viewMode === "continuous"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isArabic ? "النص المتصل" : "Continuous"}
                    </button>
                    <button
                      onClick={() => setViewMode("segments")}
                      className={`px-3 py-1 text-xs font-semibold rounded-lg transition cursor-pointer ${
                        viewMode === "segments"
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      {isArabic ? "المقاطع" : "Segments"}
                    </button>
                  </div>
                </div>
              </GlassCard>

              {/* View 1: ONE Main Continuous Transcript Block (Default) */}
              {viewMode === "continuous" ? (
                <GlassCard className={`p-6 md:p-8 space-y-4 ${isRtl ? "text-right" : "text-left"}`}>
                  <div className="flex items-center justify-between border-b border-border/40 pb-3">
                    <div className="flex items-center gap-2">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleCopyTranscript}
                        className="text-xs cursor-pointer gap-1.5"
                      >
                        <Copy className="h-3.5 w-3.5" />{" "}
                        {isArabic ? "نسخ النص الكامل" : "Copy Full Text"}
                      </Button>
                    </div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-display font-semibold text-base text-foreground flex items-center gap-2">
                        {isArabic ? "النص الموحد الكامل" : "Continuous Full Transcript"}
                        <FileText className="h-4 w-4 text-primary" />
                      </h3>
                      <Badge variant="outline" className="text-xs font-mono">
                        {isArabic ? "تفريغ معتمد" : "Verified Transcript"}
                      </Badge>
                    </div>
                  </div>

                  {speakers.length > 0 && (
                    <div className="flex flex-wrap items-center gap-2 pb-2 border-b border-border/30">
                      <span className="text-[11px] font-semibold text-muted-foreground">
                        {isArabic
                          ? "المتحدثون (انقر لإعادة التسمية):"
                          : "Speakers (click to rename):"}
                      </span>
                      {speakers.map((spk) =>
                        renamingSpeaker === spk ? (
                          <div key={spk} className="inline-flex items-center gap-1">
                            <Input
                              value={newSpeakerName}
                              onChange={(e) => setNewSpeakerName(e.target.value)}
                              className="h-7 w-36 text-xs"
                              placeholder={isArabic ? "الاسم الجديد..." : "New name..."}
                              autoFocus
                            />
                            <Button
                              size="sm"
                              className="h-7 px-2 text-xs gradient-primary text-primary-foreground"
                              disabled={!newSpeakerName.trim() || renameSpeakerMutation.isPending}
                              onClick={() =>
                                renameSpeakerMutation.mutate({
                                  oldName: spk,
                                  nextName: newSpeakerName.trim(),
                                })
                              }
                            >
                              <Check className="h-3 w-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-7 px-2 text-xs"
                              onClick={() => setRenamingSpeaker(null)}
                            >
                              <X className="h-3 w-3" />
                            </Button>
                          </div>
                        ) : (
                          <Badge
                            key={spk}
                            variant="outline"
                            onClick={() => {
                              setRenamingSpeaker(spk);
                              setNewSpeakerName(spk);
                            }}
                            className="cursor-pointer hover:border-primary text-xs gap-1"
                            title={
                              isArabic
                                ? "انقر لتغيير اسم المتحدث في كامل الجلسة"
                                : "Click to rename speaker across this session"
                            }
                          >
                            <User className="h-3 w-3 text-primary" />
                            <span>{spk}</span>
                            <Edit2 className="h-2.5 w-2.5 text-muted-foreground" />
                          </Badge>
                        ),
                      )}
                    </div>
                  )}

                  {filteredSegments.length === 0 ? (
                    <div className="py-12 text-center text-muted-foreground text-sm">
                      {isArabic
                        ? "لم يتم العثور على أي نصوص مفرغة تطابق بحثك."
                        : "No transcript segments matching your search."}
                    </div>
                  ) : (
                    <div
                      className={`prose prose-sm dark:prose-invert max-w-none ${isRtl ? "text-right" : "text-left"} font-sans leading-relaxed text-foreground/90 space-y-4 text-base selection:bg-primary/20`}
                    >
                      <p className="inline leading-loose">
                        {filteredSegments.map((seg, idx) => {
                          const isActive =
                            currentTime >= seg.startTime && currentTime <= seg.endTime;
                          return (
                            <span
                              key={seg.id}
                              ref={
                                isActive
                                  ? (activeSegmentRef as React.RefObject<HTMLSpanElement>)
                                  : undefined
                              }
                              className="inline"
                            >
                              <button
                                onClick={() => jumpToTimestamp(seg.startTime)}
                                className={`inline-flex items-center gap-1 mx-1 px-1.5 py-0.5 rounded text-xs font-mono font-medium border transition cursor-pointer select-none align-baseline ${
                                  isActive
                                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                                    : "bg-secondary/60 text-primary border-border/50 hover:bg-primary/20"
                                }`}
                                title={`انقر للاستماع فورياً بدءاً من ${formatTime(seg.startTime)}`}
                              >
                                <Clock className="h-3 w-3 inline" />
                                {formatTime(seg.startTime)}
                              </button>
                              <span
                                className={`transition-colors font-medium ${
                                  isActive
                                    ? "bg-primary/15 text-foreground font-bold rounded px-1"
                                    : ""
                                }`}
                              >
                                {searchQuery ? highlightQuery(seg.text, searchQuery) : seg.text}
                              </span>
                              {idx < filteredSegments.length - 1 ? " " : ""}
                            </span>
                          );
                        })}
                      </p>
                    </div>
                  )}
                </GlassCard>
              ) : (
                /* View 2: Detailed Speaker Segments List */
                <div className="space-y-3">
                  {filteredSegments.length === 0 ? (
                    <GlassCard className="p-8 text-center text-muted-foreground text-sm space-y-3">
                      <p>لم يتم العثور على أي مقاطع نصية تطابق بحثك في هذا التسجيل.</p>
                    </GlassCard>
                  ) : (
                    filteredSegments.map((seg) => {
                      const isEditing = editingSegId === seg.id;
                      const isActive = currentTime >= seg.startTime && currentTime <= seg.endTime;

                      return (
                        <GlassCard
                          key={seg.id}
                          ref={
                            isActive
                              ? (activeSegmentRef as React.RefObject<HTMLDivElement>)
                              : undefined
                          }
                          className={`p-4 transition-all relative group text-right ${
                            isActive
                              ? "border-primary/60 bg-primary/5 shadow-sm"
                              : "hover:border-primary/30"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3 mb-2">
                            {!isEditing && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                                onClick={() => {
                                  setEditingSegId(seg.id);
                                  setEditedText(seg.text);
                                }}
                              >
                                <Edit2 className="h-3 w-3 mr-1" /> تعديل النص
                              </Button>
                            )}

                            <div className="flex items-center gap-2">
                              <button
                                onClick={() => jumpToTimestamp(seg.startTime)}
                                className="inline-flex items-center gap-1.5 text-xs font-mono text-muted-foreground hover:text-primary transition-colors cursor-pointer bg-background/60 px-2 py-0.5 rounded border border-border/40"
                                title="انقر للاستماع فورياً من هذه اللحظة"
                              >
                                <span>
                                  [{formatTime(seg.startTime)} - {formatTime(seg.endTime)}]
                                </span>
                                <Clock className="h-3 w-3" />
                              </button>
                              <Badge
                                variant="outline"
                                onClick={() => {
                                  setRenamingSpeaker(seg.speaker);
                                  setNewSpeakerName(seg.speaker);
                                }}
                                className="font-mono text-xs flex items-center gap-1 font-semibold text-primary cursor-pointer hover:border-primary"
                                title="انقر لإعادة تسمية المتحدث"
                              >
                                <span>{seg.speaker}</span>
                                <User className="h-3 w-3 ml-1" />
                              </Badge>
                            </div>
                          </div>

                          {isEditing ? (
                            <div className="space-y-2 mt-2">
                              <Input
                                value={editedText}
                                onChange={(e) => setEditedText(e.target.value)}
                                className="bg-background/80 text-right text-sm"
                                autoFocus
                              />
                              <div className="flex gap-2 justify-end">
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  onClick={() => setEditingSegId(null)}
                                  className="cursor-pointer text-xs"
                                >
                                  <X className="h-3.5 w-3.5 mr-1" /> إلغاء
                                </Button>
                                <Button
                                  size="sm"
                                  className="gradient-primary text-primary-foreground cursor-pointer text-xs"
                                  onClick={() => handleSaveEdit(seg.id)}
                                >
                                  <Check className="h-3.5 w-3.5 mr-1" /> حفظ التعديل
                                </Button>
                              </div>
                            </div>
                          ) : (
                            <p className="text-sm text-foreground/90 leading-relaxed font-sans text-right select-text font-medium">
                              {searchQuery ? highlightQuery(seg.text, searchQuery) : seg.text}
                            </p>
                          )}
                        </GlassCard>
                      );
                    })
                  )}
                </div>
              )}
            </TabsContent>

            {/* TAB 2: AI SUMMARY (8 SECTIONS) */}
            <TabsContent value="summary" className="space-y-4">
              <GlassCard className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-base font-semibold flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-primary" />
                    التلخيص الشامل الموثق للمحاضرة باللغة العربية
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    يولد ملخصاً هيكلياً دقيقاً من ثمانية أقسام مستنداً كلياً إلى نص التسجيل
                  </p>
                </div>

                <div className="flex items-center gap-2">
                  {currentSummary && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => handleCopySummary(currentSummary)}
                      className="cursor-pointer text-xs gap-1.5"
                    >
                      <Copy className="h-3.5 w-3.5" /> نسخ التلخيص
                    </Button>
                  )}
                  <Button
                    onClick={handleGenerateSummary}
                    disabled={isGeneratingSummary}
                    className="gradient-primary text-primary-foreground shadow-glow h-9 px-4 text-xs font-semibold cursor-pointer gap-2"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isGeneratingSummary ? "animate-spin" : ""}`}
                    />
                    {currentSummary ? "إعادة توليد التلخيص" : "تلخيص المحاضرة بالذكاء الاصطناعي"}
                  </Button>
                </div>
              </GlassCard>

              {isGeneratingSummary ? (
                <GlassCard className="p-12 text-center space-y-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary mx-auto">
                    <RefreshCw className="h-6 w-6 animate-spin" />
                  </div>
                  <h4 className="font-semibold text-base">
                    جاري صياغة التلخيص الهيكلي باللغة العربية...
                  </h4>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    يقوم النموذج بفحص النص المفرغ بالكامل، واستخراج المحاور، والقرارات، والمهام
                    المسندة، والمفاهيم، ومجالات المراجعة بدقة تامة.
                  </p>
                </GlassCard>
              ) : currentSummary ? (
                <div className="space-y-4">{renderSummarySections(currentSummary, isRtl)}</div>
              ) : (
                <GlassCard className="p-12 text-center space-y-3">
                  <BookOpen className="h-10 w-10 text-muted-foreground mx-auto" />
                  <h4 className="font-semibold text-base">لم يتم إنشاء تلخيص لهذه الجلسة بعد</h4>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    انقر على زر "تلخيص المحاضرة بالذكاء الاصطناعي" بالأعلى لتوليد التلخيص المكون من
                    8 أقسام وحفظه دائماً في قاعدة البيانات.
                  </p>
                  <Button
                    onClick={handleGenerateSummary}
                    className="gradient-primary text-primary-foreground mt-2 cursor-pointer text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    توليد التلخيص الآن
                  </Button>
                </GlassCard>
              )}
            </TabsContent>

            {/* TAB 3: INTERACTIVE QUIZ */}
            <TabsContent value="quiz" className="space-y-4">
              <GlassCard className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-base font-semibold flex items-center gap-2">
                    <Brain className="h-4 w-4 text-pink-500" />
                    كويز تقييمي تفاعلي من المحاضرة
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    أسئلة اختيار من متعدد، صواب وخطأ، وتفكير مفاهيمي مصاغة مباشرة من مضمون الشرح
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs text-muted-foreground">عدد الأسئلة:</span>
                    <Select
                      value={String(quizQuestionCount)}
                      onValueChange={(val) => setQuizQuestionCount(parseInt(val, 10))}
                    >
                      <SelectTrigger className="h-8 w-16 bg-background/50 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="3">3</SelectItem>
                        <SelectItem value="5">5</SelectItem>
                        <SelectItem value="8">8</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <Button
                    onClick={handleGenerateQuiz}
                    disabled={isGeneratingQuiz}
                    className="gradient-primary text-primary-foreground shadow-glow h-9 px-4 text-xs font-semibold cursor-pointer gap-2"
                  >
                    <RefreshCw
                      className={`h-3.5 w-3.5 ${isGeneratingQuiz ? "animate-spin" : ""}`}
                    />
                    {currentQuiz ? "إنشاء كويز جديد" : "إنشاء كويز من المحاضرة"}
                  </Button>
                </div>
              </GlassCard>

              {isGeneratingQuiz ? (
                <GlassCard className="p-12 text-center space-y-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-pink-500/10 text-pink-500 mx-auto">
                    <RefreshCw className="h-6 w-6 animate-spin" />
                  </div>
                  <h4 className="font-semibold text-base">جاري إنشاء أسئلة الكويز التقييمي...</h4>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    يقوم الذكاء الاصطناعي بصياغة خيارات ذكية وتوضيحات تفصيلية لكل سؤال مستندة إلى
                    الشرح الوارد في الجلسة.
                  </p>
                </GlassCard>
              ) : currentQuiz && currentQuiz.questions.length > 0 ? (
                <div className="space-y-4">
                  {/* Score summary banner if submitted */}
                  {quizSubmitted && (
                    <GlassCard className="p-4 border-primary/40 bg-primary/10 flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setUserAnswers({});
                            setQuizSubmitted(false);
                            toast.info("تمت إعادة تعيين إجابات الكويز للمحاولة مرة أخرى");
                          }}
                          className="cursor-pointer text-xs gap-1"
                        >
                          <RotateCcw className="h-3.5 w-3.5" /> إعادة المحاولة
                        </Button>
                      </div>

                      <div className="text-right">
                        <div className="text-base font-bold text-foreground">
                          النتيجة المحققة: {calculateQuizScore().percent}%
                        </div>
                        <div className="text-xs text-muted-foreground">
                          أجبت بشكل صحيح على {calculateQuizScore().score} من أصل{" "}
                          {calculateQuizScore().total} أسئلة
                        </div>
                      </div>
                    </GlassCard>
                  )}

                  {/* Question cards */}
                  {currentQuiz.questions.map((q, idx) => {
                    const chosen = userAnswers[q.id];
                    const isAnswered = chosen !== undefined;
                    const isCorrect = chosen === q.correctOptionIndex;

                    return (
                      <GlassCard
                        key={q.id}
                        className={`p-5 space-y-4 text-right transition-all ${
                          quizSubmitted
                            ? isCorrect
                              ? "border-emerald-500/50 bg-emerald-500/5"
                              : "border-destructive/50 bg-destructive/5"
                            : ""
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="flex items-center gap-2">
                            {quizSubmitted && (
                              <Badge
                                variant={isCorrect ? "default" : "destructive"}
                                className="text-xs gap-1 font-semibold"
                              >
                                {isCorrect ? (
                                  <>
                                    <CheckCircle2 className="h-3 w-3" /> إجابة صحيحة
                                  </>
                                ) : (
                                  <>
                                    <XCircle className="h-3 w-3" /> إجابة خاطئة
                                  </>
                                )}
                              </Badge>
                            )}
                          </div>

                          <div className="flex items-center gap-2">
                            <span className="font-bold text-sm text-foreground">
                              السؤال {idx + 1}:
                            </span>
                            <span className="text-sm font-medium text-foreground leading-relaxed">
                              {q.question}
                            </span>
                          </div>
                        </div>

                        {/* Options */}
                        <div className="space-y-2 pt-1">
                          {q.options.map((opt, optIdx) => {
                            const isSelected = chosen === optIdx;
                            const isThisCorrect = q.correctOptionIndex === optIdx;

                            let optClasses =
                              "flex items-center justify-between p-3 rounded-xl border text-sm transition cursor-pointer ";
                            if (quizSubmitted) {
                              if (isThisCorrect) {
                                optClasses +=
                                  "border-emerald-500 bg-emerald-500/15 text-emerald-600 font-semibold dark:text-emerald-400";
                              } else if (isSelected && !isThisCorrect) {
                                optClasses +=
                                  "border-destructive bg-destructive/15 text-destructive font-semibold";
                              } else {
                                optClasses += "border-border/40 opacity-60";
                              }
                            } else {
                              if (isSelected) {
                                optClasses +=
                                  "border-primary bg-primary/10 text-primary font-medium";
                              } else {
                                optClasses += "border-border/60 hover:bg-secondary/40";
                              }
                            }

                            return (
                              <div
                                key={optIdx}
                                onClick={() => {
                                  if (!quizSubmitted) {
                                    setUserAnswers((prev) => ({ ...prev, [q.id]: optIdx }));
                                  }
                                }}
                                className={optClasses}
                              >
                                <div className="flex items-center gap-2">
                                  {quizSubmitted && isThisCorrect && (
                                    <CheckCircle2 className="h-4 w-4 text-emerald-500" />
                                  )}
                                  {quizSubmitted && isSelected && !isThisCorrect && (
                                    <XCircle className="h-4 w-4 text-destructive" />
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <span>{opt}</span>
                                  <span className="h-5 w-5 rounded-full border border-border/70 grid place-items-center text-xs font-mono">
                                    {String.fromCharCode(65 + optIdx)}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>

                        {/* Explanation box on submit */}
                        {quizSubmitted && q.explanation && (
                          <div className="rounded-xl border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
                            <span className="font-semibold text-primary flex items-center gap-1 justify-end">
                              الشرح والتوثيق من المحاضرة:
                              <HelpCircle className="h-3.5 w-3.5" />
                            </span>
                            <p className="text-muted-foreground leading-relaxed">{q.explanation}</p>
                          </div>
                        )}
                      </GlassCard>
                    );
                  })}

                  {/* Submit Quiz Action */}
                  {!quizSubmitted && (
                    <div className="flex justify-end pt-2">
                      <Button
                        onClick={() => {
                          const answeredCount = Object.keys(userAnswers).length;
                          if (answeredCount === 0) {
                            toast.warning("يرجى الإجابة على الأسئلة أولاً قبل تسليم الكويز");
                            return;
                          }
                          setQuizSubmitted(true);
                          const { percent } = calculateQuizScore();
                          toast.success(`تم تقييم الكويز بنجاح! النتيجة: ${percent}%`);
                        }}
                        className="gradient-primary text-primary-foreground shadow-glow px-6 py-2 text-sm font-semibold cursor-pointer"
                      >
                        تصحيح الإجابات وتقييم النتيجة
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <GlassCard className="p-12 text-center space-y-3">
                  <Brain className="h-10 w-10 text-muted-foreground mx-auto" />
                  <h4 className="font-semibold text-base">لا يوجد كويز متاح لهذه المحاضرة بعد</h4>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    اضغط على "إنشاء كويز من المحاضرة" ليقوم الذكاء الاصطناعي بصياغة أسئلة تفاعلية
                    ذكية تقيس مدى استيعابك للمفاهيم المشروحة.
                  </p>
                  <Button
                    onClick={handleGenerateQuiz}
                    className="gradient-primary text-primary-foreground mt-2 cursor-pointer text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    إنشاء الكويز الآن
                  </Button>
                </GlassCard>
              )}
            </TabsContent>

            {/* TAB 4: LECTURE ANALYSIS */}
            <TabsContent value="analysis" className="space-y-4">
              <GlassCard className="p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div>
                  <h3 className="font-display text-base font-semibold flex items-center gap-2">
                    <ListOrdered className="h-4 w-4 text-cyan-500" />
                    التحليل الذكي المتعمق للمحاضرة
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    استخراج المصطلحات التقنية، الأسئلة المطروحة، النقاط المؤكد عليها، ومجالات
                    المراجعة مع روابط زمنية
                  </p>
                </div>

                <Button
                  onClick={handleGenerateAnalysis}
                  disabled={isGeneratingAnalysis}
                  className="gradient-primary text-primary-foreground shadow-glow h-9 px-4 text-xs font-semibold cursor-pointer gap-2"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isGeneratingAnalysis ? "animate-spin" : ""}`}
                  />
                  {currentAnalysis ? "تحديث التحليل" : "استخراج تحليل المحاضرة"}
                </Button>
              </GlassCard>

              {isGeneratingAnalysis ? (
                <GlassCard className="p-12 text-center space-y-3">
                  <div className="grid h-12 w-12 place-items-center rounded-2xl bg-cyan-500/10 text-cyan-500 mx-auto">
                    <RefreshCw className="h-6 w-6 animate-spin" />
                  </div>
                  <h4 className="font-semibold text-base">جاري تحليل البيانات ومحاور الشرح...</h4>
                </GlassCard>
              ) : currentAnalysis ||
                (currentSelection?.item.keywords && currentSelection.item.keywords.length > 0) ||
                (currentSelection?.item.highlights &&
                  currentSelection.item.highlights.length > 0) ? (
                <div className="grid gap-4 md:grid-cols-2">
                  {/* Extracted Keywords with Frequency & Importance */}
                  {currentSelection?.item.keywords && currentSelection.item.keywords.length > 0 && (
                    <GlassCard className="p-4 space-y-3 text-right md:col-span-2">
                      <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                        الكلمات المفتاحية المستخرجة مع التكرار والأهمية
                        <BookOpen className="h-4 w-4 text-cyan-500" />
                      </h4>
                      <div className="flex flex-wrap gap-2 justify-end">
                        {currentSelection.item.keywords.map((kw, i) => (
                          <Badge
                            key={i}
                            variant="outline"
                            className="border-cyan-500/30 bg-cyan-500/10 text-xs gap-1.5 py-1 px-2.5"
                          >
                            <span className="font-semibold text-foreground">{kw.term}</span>
                            <span className="text-[10px] font-mono text-cyan-400">
                              ×{kw.frequency} ({Math.round((kw.importance || 0) * 100)}%)
                            </span>
                          </Badge>
                        ))}
                      </div>
                    </GlassCard>
                  )}

                  {/* Categorized Highlights */}
                  {currentSelection?.item.highlights &&
                    currentSelection.item.highlights.length > 0 && (
                      <GlassCard className="p-4 space-y-3 text-right md:col-span-2">
                        <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                          النقاط البارزة المصنفة زمنياً
                          <Sparkles className="h-4 w-4 text-amber-400" />
                        </h4>
                        <div className="grid gap-2 sm:grid-cols-2">
                          {currentSelection.item.highlights.map((hl, i) => (
                            <div
                              key={i}
                              className="p-3 rounded-xl bg-background/50 border border-amber-500/20 text-xs space-y-1.5"
                            >
                              <div className="flex items-center justify-between gap-2 text-[10px]">
                                <Badge variant="secondary" className="font-mono">
                                  {hl.timestamp}
                                </Badge>
                                <div className="flex items-center gap-1.5">
                                  <Badge
                                    variant="outline"
                                    className="border-amber-500/40 text-amber-400"
                                  >
                                    {hl.category} · {hl.priority}
                                  </Badge>
                                  {hl.speaker && (
                                    <span className="text-muted-foreground">{hl.speaker}</span>
                                  )}
                                </div>
                              </div>
                              <p className="text-foreground font-medium leading-relaxed">
                                {hl.quote}
                              </p>
                            </div>
                          ))}
                        </div>
                      </GlassCard>
                    )}

                  {/* Important Quotes / Sentences */}
                  {currentAnalysis?.importantSentences &&
                    currentAnalysis.importantSentences.length > 0 && (
                      <GlassCard className="p-4 space-y-3 text-right md:col-span-2">
                        <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                          أهم الجمل والاقتباسات الحاسمة من المحاضر
                          <Quote className="h-4 w-4 text-primary" />
                          <Badge variant="outline" className="text-[10px]">
                            {currentAnalysis.importantSentences.length}
                          </Badge>
                        </h4>
                        <div className="grid gap-2.5 sm:grid-cols-2">
                          {currentAnalysis.importantSentences.map((rawItem, i: number) => {
                            const item = typeof rawItem === "string" ? { quote: rawItem } : rawItem;
                            return (
                              <div
                                key={i}
                                className="p-3 rounded-xl bg-background/50 border border-primary/20 text-xs space-y-1.5 relative overflow-hidden"
                              >
                                <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                                  {item.timestamp && (
                                    <Badge variant="secondary" className="text-[10px] font-mono">
                                      {item.timestamp}
                                    </Badge>
                                  )}
                                  <span className="font-medium text-primary">
                                    اقتباس محوري #{i + 1}
                                  </span>
                                </div>
                                <p className="font-semibold text-foreground leading-relaxed">
                                  "{item.quote}"
                                </p>
                                {item.context && (
                                  <p className="text-[11px] text-muted-foreground/90">
                                    السياق: {item.context}
                                  </p>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </GlassCard>
                    )}

                  {/* Action Items / Assigned Tasks */}
                  {currentAnalysis?.actionItems && currentAnalysis.actionItems.length > 0 && (
                    <GlassCard className="p-4 space-y-3 text-right md:col-span-2">
                      <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                        المهام والتكليفات والتعليمات المستخرجة
                        <CheckSquare className="h-4 w-4 text-emerald-500" />
                        <Badge variant="outline" className="text-[10px]">
                          {currentAnalysis.actionItems.length}
                        </Badge>
                      </h4>
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                        {currentAnalysis.actionItems.map((item, i: number) => (
                          <div
                            key={i}
                            className="p-3 rounded-xl bg-background/50 border border-border/50 text-xs space-y-1.5 flex flex-col justify-between"
                          >
                            <div className="space-y-1">
                              <div className="flex items-center justify-between gap-1">
                                {item.priority && (
                                  <Badge
                                    variant="outline"
                                    className={cn(
                                      "text-[10px] px-1.5",
                                      item.priority === "high" &&
                                        "border-destructive/40 text-destructive bg-destructive/10",
                                      item.priority === "medium" &&
                                        "border-amber-500/40 text-amber-500 bg-amber-500/10",
                                      item.priority === "low" &&
                                        "border-muted-foreground/40 text-muted-foreground bg-muted/10",
                                    )}
                                  >
                                    {item.priority === "high"
                                      ? "أولوية عالية"
                                      : item.priority === "medium"
                                        ? "أولوية متوسطة"
                                        : "عادية"}
                                  </Badge>
                                )}
                                <span className="font-bold text-foreground text-xs leading-snug">
                                  {item.task || item.item || "مهمة مستخرجة"}
                                </span>
                              </div>
                            </div>
                            <div className="flex items-center justify-between pt-1 border-t border-border/30 text-[10.5px] text-muted-foreground">
                              <span>{item.deadline ? `الموعد: ${item.deadline}` : "غير محدد"}</span>
                              <span>
                                {item.owner || item.assignee
                                  ? `المسؤول: ${item.owner || item.assignee}`
                                  : "الجميع"}
                              </span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </GlassCard>
                  )}

                  {/* Key Concepts / Definitions */}
                  {currentAnalysis?.definitions && currentAnalysis.definitions.length > 0 && (
                    <GlassCard className="p-4 space-y-3 text-right">
                      <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                        المصطلحات والمفاهيم الأساسية
                        <Badge variant="outline" className="text-[10px]">
                          {currentAnalysis.definitions.length}
                        </Badge>
                      </h4>
                      <div className="space-y-2">
                        {currentAnalysis.definitions.map(
                          (d: { term: string; definition: string }, i: number) => (
                            <div
                              key={i}
                              className="p-2.5 rounded-xl bg-background/50 border border-border/50 text-xs space-y-1"
                            >
                              <div className="font-bold text-foreground">{d.term}</div>
                              <div className="text-muted-foreground leading-relaxed">
                                {d.definition}
                              </div>
                            </div>
                          ),
                        )}
                      </div>
                    </GlassCard>
                  )}

                  {/* Questions Raised */}
                  {currentAnalysis?.questionsAsked && currentAnalysis.questionsAsked.length > 0 && (
                    <GlassCard className="p-4 space-y-3 text-right">
                      <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                        الأسئلة والنقاشات المطروحة
                        <Badge variant="outline" className="text-[10px]">
                          {currentAnalysis.questionsAsked.length}
                        </Badge>
                      </h4>
                      <ul className="space-y-2">
                        {currentAnalysis.questionsAsked.map(
                          (q: { question: string; answer?: string }, i: number) => (
                            <li
                              key={i}
                              className="p-2.5 rounded-xl bg-background/50 border border-border/50 text-xs space-y-1"
                            >
                              <div className="font-semibold text-foreground">؟ {q.question}</div>
                              {q.answer && (
                                <div className="text-muted-foreground text-[11px] leading-relaxed">
                                  الإجابة: {q.answer}
                                </div>
                              )}
                            </li>
                          ),
                        )}
                      </ul>
                    </GlassCard>
                  )}

                  {/* Emphasized Points */}
                  {currentAnalysis?.emphasizedPoints &&
                    currentAnalysis.emphasizedPoints.length > 0 && (
                      <GlassCard className="p-4 space-y-3 text-right">
                        <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                          النقاط التي تم التأكيد عليها بشدة
                          <AlertTriangle className="h-3.5 w-3.5 text-amber-500" />
                        </h4>
                        <ul className="space-y-1.5 text-xs">
                          {currentAnalysis.emphasizedPoints.map((pt: string, i: number) => (
                            <li
                              key={i}
                              className="flex items-start gap-2 justify-end text-muted-foreground"
                            >
                              <span>{pt}</span>
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                            </li>
                          ))}
                        </ul>
                      </GlassCard>
                    )}

                  {/* Review Areas / Exam Prep */}
                  {currentAnalysis?.reviewAreas && currentAnalysis.reviewAreas.length > 0 && (
                    <GlassCard className="p-4 space-y-3 text-right">
                      <h4 className="font-semibold text-sm text-primary flex items-center gap-1.5 justify-end">
                        مجالات المراجعة الموصى بها
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      </h4>
                      <ul className="space-y-1.5 text-xs">
                        {currentAnalysis.reviewAreas.map((area: string, i: number) => (
                          <li
                            key={i}
                            className="flex items-start gap-2 justify-end text-muted-foreground"
                          >
                            <span>{area}</span>
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 mt-1.5 shrink-0" />
                          </li>
                        ))}
                      </ul>
                    </GlassCard>
                  )}
                </div>
              ) : (
                <GlassCard className="p-12 text-center space-y-3">
                  <ListOrdered className="h-10 w-10 text-muted-foreground mx-auto" />
                  <h4 className="font-semibold text-base">لا يوجد تحليل تفصيلي حتى الآن</h4>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    انقر على "استخراج تحليل المحاضرة" لاستخراج المصطلحات والمحاور والأسئلة تلقائياً.
                  </p>
                  <Button
                    onClick={handleGenerateAnalysis}
                    className="gradient-primary text-primary-foreground mt-2 cursor-pointer text-xs"
                  >
                    <Sparkles className="h-3.5 w-3.5 mr-1.5" />
                    استخراج التحليل الآن
                  </Button>
                </GlassCard>
              )}
            </TabsContent>
          </Tabs>
        </>
      )}

      {/* Delete Confirmation Alert Dialog */}
      <AlertDialog open={deleteConfirmOpen} onOpenChange={setDeleteConfirmOpen}>
        <AlertDialogContent
          dir={isRtl ? "rtl" : "ltr"}
          className={isRtl ? "text-right" : "text-left"}
        >
          <AlertDialogHeader>
            <AlertDialogTitle
              className={`flex items-center gap-2 text-destructive ${isRtl ? "justify-end" : "justify-start"}`}
            >
              <AlertTriangle className="h-5 w-5" />
              <span>{isArabic ? "تأكيد حذف التسجيل بالكامل" : "Confirm Permanent Deletion"}</span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
              {isArabic ? (
                <>
                  هل أنت متأكد من رغبتك في حذف تسجيل "<b>{currentSelection?.rawTitle}</b>"؟ سيتم حذف
                  الملف الصوتي من القرص الصلب نهائياً، وإزالة النص المفرغ والتلخيص والكويز المرتبط
                  فوراً دون إمكانية الاسترجاع.
                </>
              ) : (
                <>
                  Are you sure you want to permanently delete "<b>{currentSelection?.rawTitle}</b>"?
                  The audio file, transcript, summary, and quiz will be permanently removed.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter
            className={`flex gap-2 ${isRtl ? "justify-start" : "justify-end"} mt-4`}
          >
            <AlertDialogCancel className="cursor-pointer">
              {isArabic ? "إلغاء" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteMutation.mutate()}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              {isArabic ? "نعم، حذف نهائي" : "Yes, Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Live Arabic Recorder Modal */}
      <LiveArabicRecorder
        open={liveRecorderOpen}
        onOpenChange={setLiveRecorderOpen}
        defaultType="meeting"
        onCompleted={(resourceId) => {
          queryClient.invalidateQueries({ queryKey: ["meetings"] });
          queryClient.invalidateQueries({ queryKey: ["lectures"] });
          handleSelectRecording(resourceId);
        }}
      />

      {/* Upload Recording Dialog */}
      <UploadRecordingDialog
        open={uploadModalOpen}
        onOpenChange={setUploadModalOpen}
        onUploaded={(resourceId) => {
          queryClient.invalidateQueries({ queryKey: ["meetings"] });
          queryClient.invalidateQueries({ queryKey: ["lectures"] });
          handleSelectRecording(resourceId);
        }}
      />
    </div>
  );
}

// Helper to highlight queries in text
function highlightQuery(text: string, query: string) {
  if (!query) return text;
  const parts = text.split(new RegExp(`(${query})`, "gi"));
  return (
    <>
      {parts.map((part, i) =>
        part.toLowerCase() === query.toLowerCase() ? (
          <mark key={i} className="bg-primary/25 text-primary font-bold rounded px-1">
            {part}
          </mark>
        ) : (
          part
        ),
      )}
    </>
  );
}

function renderSummaryInline(text: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /(`[^`\n]+`|\*\*[^*\n]+?\*\*|__[^_\n]+?__)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let keyIdx = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index).replace(/\*\*/g, ""));
    }
    const token = match[0];
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={`sc-${keyIdx++}`}
          className="rounded bg-secondary/80 border border-border/60 px-1 py-0.5 font-mono text-xs text-primary"
        >
          {token.slice(1, -1)}
        </code>,
      );
    } else {
      nodes.push(
        <strong key={`sb-${keyIdx++}`} className="font-bold text-foreground">
          {token.slice(2, -2)}
        </strong>,
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex).replace(/\*\*/g, ""));
  }

  return nodes;
}

function renderSummaryBody(content: string): ReactNode {
  const lines = content.split(/\r?\n/);
  const nodes: ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (!trimmed) {
      i++;
      continue;
    }

    const subHeading = trimmed.match(/^#{3,4}\s+(.+)$/);
    if (subHeading) {
      nodes.push(
        <h5 key={`sh-${key++}`} className="mt-2 font-semibold text-foreground text-sm">
          {renderSummaryInline(subHeading[1].trim())}
        </h5>,
      );
      i++;
      continue;
    }

    if (/^\s*[-*•]\s+/.test(line)) {
      const bullets: string[] = [];
      while (i < lines.length && /^\s*[-*•]\s+/.test(lines[i])) {
        bullets.push(lines[i].replace(/^\s*[-*•]\s+/, "").trim());
        i++;
      }
      nodes.push(
        <ul key={`sul-${key++}`} className="list-disc space-y-1.5 ps-5">
          {bullets.map((b, bIdx) => (
            <li key={bIdx} className="leading-relaxed">
              {renderSummaryInline(b)}
            </li>
          ))}
        </ul>,
      );
      continue;
    }

    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, "").trim());
        i++;
      }
      nodes.push(
        <ol key={`sol-${key++}`} className="list-decimal space-y-1.5 ps-5">
          {items.map((item, idx) => (
            <li key={idx} className="leading-relaxed">
              {renderSummaryInline(item)}
            </li>
          ))}
        </ol>,
      );
      continue;
    }

    nodes.push(
      <p key={`sp-${key++}`} className="leading-relaxed">
        {renderSummaryInline(trimmed)}
      </p>,
    );
    i++;
  }

  return <div className="space-y-2">{nodes}</div>;
}

// Helper to render the structured sections
function renderSummarySections(markdown: string, isRtl: boolean = true) {
  if (!markdown) return null;

  // Split by markdown h2 headers (## )
  const sections = markdown.split(/(?=^## )/gm).filter((s) => s.trim().length > 0);

  if (sections.length <= 1) {
    // Single block fallback
    return (
      <GlassCard className={`p-6 ${isRtl ? "text-right" : "text-left"} space-y-3`}>
        <div
          className={`prose prose-sm dark:prose-invert max-w-none ${isRtl ? "text-right" : "text-left"} leading-relaxed font-sans select-text`}
        >
          {renderSummaryBody(markdown.replace(/^#\s+/gm, "### "))}
        </div>
      </GlassCard>
    );
  }

  return sections.map((sec, idx) => {
    const lines = sec.trim().split("\n");
    const rawHeader = lines[0]
      .replace(/^##\s*/, "")
      .replace(/\*\*/g, "")
      .trim();
    const content = lines.slice(1).join("\n").trim();

    return (
      <GlassCard key={idx} className={`p-5 ${isRtl ? "text-right" : "text-left"} space-y-3`}>
        <div className="flex items-center justify-between border-b border-border/40 pb-2.5">
          <Badge variant="outline" className="text-xs font-mono font-semibold">
            {isRtl
              ? `القسم ${idx + 1} من ${sections.length}`
              : `Section ${idx + 1} of ${sections.length}`}
          </Badge>
          <h4 className="font-display font-semibold text-base text-foreground flex items-center gap-2">
            <span>{rawHeader}</span>
            <Sparkles className="h-4 w-4 text-primary" />
          </h4>
        </div>
        <div className="text-sm text-foreground/90 leading-relaxed font-sans select-text">
          {renderSummaryBody(content)}
        </div>
      </GlassCard>
    );
  });
}
