import { useState, useRef, useEffect } from "react";
import {
  Mic,
  Upload,
  Loader2,
  Sparkles,
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Circle,
  RotateCw,
  Copy,
  Check,
  FileText,
  ExternalLink,
  MessageSquare,
  Pause,
  Play,
  Clock,
  Activity,
} from "lucide-react";
import { useNavigate } from "@tanstack/react-router";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  api,
  type Job,
  type JobMilestones,
  type JobTimings,
  type StageTelemetryItem,
  type TranscriptSegmentItem,
} from "@/lib/api-client";
import { Badge } from "@/components/ui/badge";
import { LiveArabicRecorder } from "@/components/recording/live-arabic-recorder";
import { useTranslation } from "@/lib/i18n";
import {
  liveAudioTelemetry,
  resetLiveAudioTelemetry,
  useUIStore,
  type AudioSystemMode,
} from "@/stores/ui-store";
import {
  processMedia,
  cancelMediaProcessing,
  validateClientMediaFile,
  getSavedActiveUploadJob,
  clearSavedActiveUploadJob,
} from "@/lib/media-processor";

interface UploadRecordingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultType?: "meeting" | "lecture";
  onSuccess?: () => void;
  onUploaded?: (resourceId: string) => void;
}

interface CompletedTranscriptData {
  resourceId: string;
  resourceType: "meeting" | "lecture";
  title: string;
  fullText: string;
  rawTranscript?: string;
  transcriptStatus?: "live" | "final_verified";
  transcriptionProvider?: string;
  asrModel?: string;
  languageConfig?: string;
  diarizationEnabled?: boolean;
  averageConfidence?: number;
  durationSeconds: number;
  segments: {
    id: string;
    speaker: string;
    startTime: number;
    endTime: number;
    text: string;
    confidence?: number;
  }[];
}

const STAGE_LABELS_AR: Record<string, string> = {
  Preparing: "جاري تجهيز الملف الصوتي...",
  Uploading: "جاري الرفع...",
  Uploaded: "اكتمل الرفع",
  Validating: "جاري التحقق من سلامة الملف الصوتي...",
  Queued: "في قائمة انتظار المعالجة الذكية...",
  ExtractingAudio: "جاري تجهيز الصوت...",
  Transcribing: "جاري التفريغ الصوتي...",
  Translating: "جاري تنسيق النص المستخرج والمصطلحات...",
  Merging: "جاري تجميع ودمج النص المفرغ...",
  Analyzing: "جاري التحليل الذكي...",
  "Generating Results": "جاري توليد النتائج...",
  "Generating Quiz": "جاري توليد النتائج والاختبار...",
  Completed: "اكتملت المعالجة بنجاح!",
  Failed: "تعذرت المعالجة.",
  Cancelled: "تم إلغاء المعالجة من قبل المستخدم.",
};

const STAGE_LABELS_EN: Record<string, string> = {
  Preparing: "Preparing audio...",
  Uploading: "Uploading...",
  Uploaded: "Upload complete",
  Validating: "Validating audio file...",
  Queued: "Queued for processing...",
  ExtractingAudio: "Preparing audio stream...",
  Transcribing: "Transcribing...",
  Translating: "Formatting transcript & terminology...",
  Merging: "Merging transcript...",
  Analyzing: "Analyzing...",
  "Generating Results": "Generating results...",
  "Generating Quiz": "Generating results...",
  Completed: "Completed",
  Failed: "Processing failed.",
  Cancelled: "Processing cancelled.",
};

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

export function UploadRecordingDialog({
  open,
  onOpenChange,
  defaultType = "meeting",
  onSuccess,
  onUploaded,
}: UploadRecordingDialogProps) {
  const { language } = useTranslation();
  const isArabic = language.toUpperCase() === "AR";
  const navigate = useNavigate();

  const [type, setType] = useState<"meeting" | "lecture">(defaultType);
  const [title, setTitle] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [selectedLanguage, setSelectedLanguage] = useState<string>(() =>
    language.toUpperCase() === "AR" ? "ar-EG" : "auto",
  );
  const [file, setFile] = useState<File | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [isMicPaused, setIsMicPaused] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const micAnim = isRecording && !isMicPaused ? "animate-pulse" : "";
  const isMicPausedRef = useRef(false);

  // Job processing state
  const [isUploading, setIsUploading] = useState(false);
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const [activeResourceId, setActiveResourceId] = useState<string | null>(null);
  const [activeCorrelationId, setActiveCorrelationId] = useState<string | null>(null);
  const [activeTranscriptId, setActiveTranscriptId] = useState<string | null>(null);
  const [activeAsrModel, setActiveAsrModel] = useState<string | null>(null);
  const [activeLanguageConfig, setActiveLanguageConfig] = useState<string | null>(null);
  const [activeConfidence, setActiveConfidence] = useState<number | null>(null);
  const [jobStatus, setJobStatus] = useState<string>("Queued");
  const [progressPercent, setProgressPercent] = useState<number>(0);
  const [stageProgress, setStageProgress] = useState<number>(0);
  const [livePartialCount, setLivePartialCount] = useState<number>(0);
  const [liveWordsReceived, setLiveWordsReceived] = useState<number>(0);
  const [livePartialPreview, setLivePartialPreview] = useState<string>("");
  const [liveSegments, setLiveSegments] = useState<TranscriptSegmentItem[]>([]);
  const [autoScrollLive, setAutoScrollLive] = useState<boolean>(true);
  const [currentOpText, setCurrentOpText] = useState<string>("");
  const [currentOpTextAr, setCurrentOpTextAr] = useState<string>("");
  const [detectedLang, setDetectedLang] = useState<string>("");
  const [fileSizeBytes, setFileSizeBytes] = useState<number>(0);
  const [audioDurationSec, setAudioDurationSec] = useState<number>(0);
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const [lastUpdatedSecAgo, setLastUpdatedSecAgo] = useState<number>(0);
  const [estRemainingSec, setEstRemainingSec] = useState<number | null>(null);
  const [isDelayed, setIsDelayed] = useState<boolean>(false);
  const [delayReason, setDelayReason] = useState<string | null>(null);
  const [stageLedger, setStageLedger] = useState<Record<string, StageTelemetryItem>>({});
  const [jobMilestones, setJobMilestones] = useState<JobMilestones>({});
  const [jobTimings, setJobTimings] = useState<JobTimings | null>(null);
  const [progressiveSummary, setProgressiveSummary] = useState<string>("");
  const [progressiveKeywords, setProgressiveKeywords] = useState<string[]>([]);
  const [progressiveTasks, setProgressiveTasks] = useState<
    Array<{ title: string; ownerName?: string; dueDate?: string }>
  >([]);
  const [progressiveQuizCount, setProgressiveQuizCount] = useState<number>(0);
  const [progressiveFlashcardsCount, setProgressiveFlashcardsCount] = useState<number>(0);
  const [jobError, setJobError] = useState<string | null>(null);
  const [isRetrying, setIsRetrying] = useState(false);

  // Completed extracted transcript display state
  const [completedTranscript, setCompletedTranscript] = useState<CompletedTranscriptData | null>(
    null,
  );
  const [transcriptViewMode, setTranscriptViewMode] = useState<"continuous" | "segments" | "raw">(
    "continuous",
  );
  const [copiedFullText, setCopiedFullText] = useState(false);

  const [liveRecorderOpen, setLiveRecorderOpen] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const sseUnsubRef = useRef<(() => void) | null>(null);
  const livePreviewScrollRef = useRef<HTMLDivElement | null>(null);
  const completionHandledRef = useRef<boolean>(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const micRafRef = useRef<number | null>(null);
  const fileEnvelopeRef = useRef<Float32Array | null>(null);

  // Auto-scroll live transcript preview as real ASR segments arrive
  useEffect(() => {
    if (autoScrollLive && livePreviewScrollRef.current) {
      livePreviewScrollRef.current.scrollTop = livePreviewScrollRef.current.scrollHeight;
    }
  }, [liveSegments, livePartialPreview, autoScrollLive]);

  // Avoid blocking the browser main thread with eager decodeAudioData during file upload;
  // raw binary bytes stream immediately via XHR / chunked upload with zero client re-encoding.
  useEffect(() => {
    if (!file) {
      fileEnvelopeRef.current = null;
    }
  }, [file]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      if (sseUnsubRef.current) sseUnsubRef.current();
      if (micRafRef.current) cancelAnimationFrame(micRafRef.current);
      if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  const mapJobStatusToSystemMode = (status: string): AudioSystemMode => {
    if (status === "Preparing" || status === "Uploading" || status === "Uploaded") {
      return "Uploading";
    }
    if (status === "Validating" || status === "Queued" || status === "ExtractingAudio") {
      return "Processing";
    }
    if (status === "Transcribing" || status === "Translating" || status === "Merging") {
      return "Transcribing";
    }
    if (status === "Analyzing" || status === "Generating Results" || status === "Generating Quiz") {
      return "Analyzing";
    }
    if (status === "Completed") return "Completed";
    return "Processing";
  };

  const startMicrophoneRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      recordedChunksRef.current = [];

      const candidateMimeTypes = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4;codecs=mp4a.40.2",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/ogg",
      ];
      const chosenMime =
        typeof MediaRecorder !== "undefined" && typeof MediaRecorder.isTypeSupported === "function"
          ? candidateMimeTypes.find((t) => MediaRecorder.isTypeSupported(t))
          : undefined;

      const mr = chosenMime
        ? new MediaRecorder(stream, { mimeType: chosenMime })
        : new MediaRecorder(stream);
      mediaRecorderRef.current = mr;

      // Connect real Web Audio API AnalyserNode
      try {
        const AudioCtx =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 128;
        analyser.smoothingTimeConstant = 0.82;
        source.connect(analyser);

        const freqData = new Uint8Array(analyser.frequencyBinCount);
        const timeData = new Uint8Array(analyser.frequencyBinCount);

        const updateMicTelemetry = () => {
          analyser.getByteFrequencyData(freqData);
          analyser.getByteTimeDomainData(timeData);
          let sumSq = 0;
          let peak = 0;
          for (let i = 0; i < 32; i++) {
            const v = (freqData[i] || 0) / 255;
            liveAudioTelemetry.bands[i] = v;
            if (v > peak) peak = v;
          }
          for (let i = 0; i < 64; i++) {
            const s = ((timeData[i] || 128) - 128) / 128;
            liveAudioTelemetry.waveform[i] = s;
            sumSq += s * s;
          }
          liveAudioTelemetry.active = true;
          liveAudioTelemetry.rms = Math.min(1, Math.sqrt(sumSq / 64) * 3.2);
          liveAudioTelemetry.peak = peak;
          liveAudioTelemetry.updatedAt = performance.now();
          micRafRef.current = requestAnimationFrame(updateMicTelemetry);
        };
        updateMicTelemetry();
      } catch {
        // ignore if AudioContext unavailable
      }

      mr.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) recordedChunksRef.current.push(e.data);
      };

      mr.onstop = () => {
        if (micRafRef.current) cancelAnimationFrame(micRafRef.current);
        resetLiveAudioTelemetry();
        useUIStore.getState().setAudioSystemState("Ready", 0);
        if (audioCtxRef.current && audioCtxRef.current.state !== "closed") {
          audioCtxRef.current.close().catch(() => {});
          audioCtxRef.current = null;
        }
        stream.getTracks().forEach((track) => track.stop());

        const actualMime = (
          mr.mimeType ||
          chosenMime ||
          recordedChunksRef.current[0]?.type ||
          "audio/webm"
        )
          .split(";")[0]
          .trim();
        const audioBlob = new Blob(recordedChunksRef.current, { type: actualMime });
        if (audioBlob.size <= 0) {
          toast.error(
            isArabic
              ? "التسجيل الصوتي فارغ، يرجى المحاولة مرة أخرى."
              : "Recorded audio is empty. Please try recording again.",
          );
          return;
        }
        const ext = actualMime.includes("mp4")
          ? ".m4a"
          : actualMime.includes("ogg")
            ? ".ogg"
            : ".webm";
        const recordedFile = new File([audioBlob], `mic_recording_${Date.now()}${ext}`, {
          type: actualMime,
        });
        setFile(recordedFile);
      };

      mr.start(500);
      isMicPausedRef.current = false;
      setIsMicPaused(false);
      setIsRecording(true);
      setRecordingSeconds(0);
      useUIStore.getState().setAudioSystemState("Recording");
      timerRef.current = setInterval(() => {
        if (!isMicPausedRef.current) {
          setRecordingSeconds((prev) => prev + 1);
        }
      }, 1000);
      toast.info(isArabic ? "بدأ تسجيل الميكروفون" : "Microphone recording active");
    } catch {
      toast.error(
        isArabic
          ? "تعذر الوصول للميكروفون. يرجى منح الإذن من المتصفح."
          : "Unable to access microphone. Please grant permission.",
      );
    }
  };

  const toggleMicPause = () => {
    const mr = mediaRecorderRef.current;
    if (!mr || !isRecording) return;
    if (isMicPaused) {
      mr.resume?.();
      isMicPausedRef.current = false;
      setIsMicPaused(false);
    } else {
      mr.pause?.();
      isMicPausedRef.current = true;
      setIsMicPaused(true);
    }
  };

  const stopMicrophoneRecording = () => {
    if (mediaRecorderRef.current && isRecording) {
      mediaRecorderRef.current.stop();
      isMicPausedRef.current = false;
      setIsMicPaused(false);
      setIsRecording(false);
      if (timerRef.current) clearInterval(timerRef.current);
      toast.success(isArabic ? "تم حفظ التسجيل بنجاح!" : "Recording captured successfully!");
    }
  };

  const stopRealtimeTracking = () => {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
    if (sseUnsubRef.current) {
      sseUnsubRef.current();
      sseUnsubRef.current = null;
    }
  };

  const applyJobSnapshot = async (job: Job, tickIdxRef: { val: number }) => {
    const rawJobStatus =
      (job as Job & { rawStatus?: string }).rawStatus ||
      (job.canonicalStatus === "completed"
        ? "Completed"
        : job.canonicalStatus === "failed"
          ? "Failed"
          : job.canonicalStatus === "cancelled"
            ? "Cancelled"
            : job.canonicalStatus === "analyzing"
              ? "Analyzing"
              : job.canonicalStatus === "saving"
                ? "Generating Results"
                : job.canonicalStatus === "transcribing"
                  ? "Transcribing"
                  : job.status);

    setJobStatus(rawJobStatus);
    const pct = job.progressPercent ?? job.progress ?? 15;
    setProgressPercent(pct);
    if (typeof job.stageProgress === "number") {
      setStageProgress(job.stageProgress);
    }

    const segCount = job.segmentsReceived ?? job.partialSegmentsCount ?? 0;
    if (segCount > 0) setLivePartialCount(segCount);
    if (typeof job.wordsReceived === "number" && job.wordsReceived > 0) {
      setLiveWordsReceived(job.wordsReceived);
    }
    if (typeof job.latestTextPreview === "string" && job.latestTextPreview.trim()) {
      setLivePartialPreview(job.latestTextPreview.trim());
    }
    if (Array.isArray(job.latestSegments) && job.latestSegments.length > 0) {
      setLiveSegments(job.latestSegments);
    }
    if (typeof job.currentOperation === "string") setCurrentOpText(job.currentOperation);
    if (typeof job.currentOperationAr === "string") setCurrentOpTextAr(job.currentOperationAr);
    if (typeof job.detectedLanguage === "string" && job.detectedLanguage) {
      setDetectedLang(job.detectedLanguage);
    }
    if (typeof job.fileSizeBytes === "number" && job.fileSizeBytes > 0) {
      setFileSizeBytes(job.fileSizeBytes);
    }
    if (typeof job.audioDurationSeconds === "number" && job.audioDurationSeconds > 0) {
      setAudioDurationSec(job.audioDurationSeconds);
    }
    if (typeof job.elapsedSeconds === "number") setElapsedSec(job.elapsedSeconds);
    if (typeof job.lastUpdatedSecondsAgo === "number") {
      setLastUpdatedSecAgo(job.lastUpdatedSecondsAgo);
    }
    setEstRemainingSec(
      typeof job.estimatedRemainingSeconds === "number" ? job.estimatedRemainingSeconds : null,
    );
    setIsDelayed(Boolean(job.delayed));
    setDelayReason(job.delayReason || null);

    if (job.stageLedger) setStageLedger(job.stageLedger);
    if (job.milestones) setJobMilestones(job.milestones);
    if (job.timings) setJobTimings(job.timings);
    if (typeof job.progressiveSummary === "string" && job.progressiveSummary.trim()) {
      setProgressiveSummary(job.progressiveSummary.trim());
    }
    if (Array.isArray(job.progressiveKeywords) && job.progressiveKeywords.length > 0) {
      setProgressiveKeywords(job.progressiveKeywords);
    }
    if (Array.isArray(job.progressiveTasks) && job.progressiveTasks.length > 0) {
      setProgressiveTasks(job.progressiveTasks);
    }
    if (typeof job.progressiveQuizCount === "number") {
      setProgressiveQuizCount(job.progressiveQuizCount);
    }
    if (typeof job.progressiveFlashcardsCount === "number") {
      setProgressiveFlashcardsCount(job.progressiveFlashcardsCount);
    }
    if (job.resourceId) setActiveResourceId(job.resourceId);
    if (job.correlationId) setActiveCorrelationId(job.correlationId);
    if (job.transcriptId) setActiveTranscriptId(job.transcriptId);
    if (job.asrModel) setActiveAsrModel(job.asrModel);
    if (job.languageConfig) setActiveLanguageConfig(job.languageConfig);
    if (typeof job.averageConfidence === "number") setActiveConfidence(job.averageConfidence);

    const mappedMode = mapJobStatusToSystemMode(rawJobStatus);
    useUIStore.getState().setAudioSystemState(mappedMode, pct);

    const env = fileEnvelopeRef.current;
    if (env && env.length > 0 && rawJobStatus !== "Completed" && rawJobStatus !== "Failed") {
      const offset = (tickIdxRef.val * 16) % env.length;
      let sum = 0;
      for (let i = 0; i < 32; i++) {
        const val = env[(offset + i) % env.length] || 0.2;
        liveAudioTelemetry.bands[i] = val;
        sum += val;
      }
      liveAudioTelemetry.active = true;
      liveAudioTelemetry.rms = sum / 32;
      liveAudioTelemetry.updatedAt = performance.now();
      tickIdxRef.val++;
    }

    if (rawJobStatus === "Completed") {
      if (completionHandledRef.current) return;
      completionHandledRef.current = true;
      stopRealtimeTracking();
      clearSavedActiveUploadJob();
      resetLiveAudioTelemetry();
      useUIStore.getState().setAudioSystemState("Completed", 100);
      setTimeout(() => {
        useUIStore.getState().setAudioSystemState("Ready", 0);
      }, 5000);

      try {
        const sessionData = await api.getRecordingSessionTranscript(job.resourceId);
        const extractedFullText =
          (sessionData.segments || []).map((s) => s.text).join(" ") || sessionData.fullText || "";
        setCompletedTranscript({
          resourceId: job.resourceId,
          resourceType: (job.resourceType as "meeting" | "lecture") || type,
          title: sessionData.title || title || "تسجيل صوتي",
          fullText: extractedFullText,
          rawTranscript: sessionData.rawTranscript || extractedFullText,
          transcriptStatus: sessionData.transcriptStatus || "final_verified",
          transcriptionProvider: sessionData.transcriptionProvider || job.transcriptionProvider,
          asrModel: sessionData.asrModel || job.asrModel,
          languageConfig: sessionData.languageConfig || job.languageConfig,
          diarizationEnabled: sessionData.diarizationEnabled ?? job.diarizationEnabled,
          averageConfidence: sessionData.averageConfidence ?? job.averageConfidence,
          durationSeconds: sessionData.durationSeconds || 60,
          segments: sessionData.segments || [],
        });
      } catch {
        try {
          const tr = await api.getTranscript(job.resourceId);
          const joined = (tr.segments || []).map((s) => s.text).join(" ");
          setCompletedTranscript({
            resourceId: job.resourceId,
            resourceType: (job.resourceType as "meeting" | "lecture") || type,
            title: tr.title || title || "تسجيل صوتي",
            fullText: joined,
            rawTranscript: tr.rawTranscript || joined,
            transcriptStatus: tr.transcriptStatus || "final_verified",
            transcriptionProvider: tr.transcriptionProvider || job.transcriptionProvider,
            asrModel: tr.asrModel || job.asrModel,
            languageConfig: tr.languageConfig || job.languageConfig,
            diarizationEnabled: tr.diarizationEnabled ?? job.diarizationEnabled,
            averageConfidence: tr.averageConfidence ?? job.averageConfidence,
            durationSeconds: 60,
            segments: tr.segments || [],
          });
        } catch {
          // ignore
        }
      }

      setIsUploading(false);
      toast.success(
        isArabic
          ? `تم استخراج النص الكامل من الصوت وتحليله بنجاح!`
          : `Full speech transcript extracted and analyzed!`,
      );
      if (onSuccess) onSuccess();
      if (onUploaded) onUploaded(job.resourceId);
    } else if (rawJobStatus === "Failed") {
      stopRealtimeTracking();
      clearSavedActiveUploadJob();
      resetLiveAudioTelemetry();
      useUIStore.getState().setAudioSystemState("Ready", 0);
      setJobError(
        job.errorMessage ||
          job.error ||
          (isArabic ? "فشلت عملية التفريغ والتحليل" : "Processing pipeline failed"),
      );
      setIsUploading(false);
      toast.error(isArabic ? "فشلت معالجة التسجيل" : "Transcription pipeline failed");
    } else if (rawJobStatus === "Cancelled") {
      stopRealtimeTracking();
      clearSavedActiveUploadJob();
      resetLiveAudioTelemetry();
      useUIStore.getState().setAudioSystemState("Ready", 0);
      setIsUploading(false);
      setActiveJobId(null);
      toast.info(isArabic ? "تم إلغاء معالجة التسجيل" : "Processing cancelled");
    }
  };

  const startPolling = (jobId: string, resourceIdHint?: string) => {
    stopRealtimeTracking();
    completionHandledRef.current = false;
    const tickIdxRef = { val: 0 };
    const lookupKey = resourceIdHint || jobId;

    const startFallbackInterval = () => {
      if (pollTimerRef.current) return;
      pollTimerRef.current = setInterval(async () => {
        try {
          const snap = await api.getRecordingStatus(lookupKey);
          await applyJobSnapshot(snap, tickIdxRef);
        } catch {
          try {
            const job = await api.getJob(jobId);
            await applyJobSnapshot(job, tickIdxRef);
          } catch {
            // keep polling while network recovers
          }
        }
      }, 1000);
    };

    // Primary real-time SSE stream + automatic short-polling fallback if SSE drops
    sseUnsubRef.current = api.streamRecordingStatus(lookupKey, {
      onUpdate: (snap) => {
        void applyJobSnapshot(snap, tickIdxRef);
      },
      onError: () => {
        startFallbackInterval();
      },
    });
  };

  // Proactively warm built-in AI models & recover any active background upload job on open
  useEffect(() => {
    if (!open) return;
    void api.warmupAi().catch(() => {});
    const saved = getSavedActiveUploadJob();
    if (saved && !isUploading && !completedTranscript) {
      setActiveJobId(saved.jobId);
      setActiveResourceId(saved.resourceId);
      setTitle(saved.title || title);
      setType(saved.resourceType || defaultType);
      setIsUploading(true);
      setJobStatus("Queued");
      setProgressPercent(15);
      setLivePartialCount(0);
      setLiveWordsReceived(0);
      setLivePartialPreview("");
      setLiveSegments([]);
      startPolling(saved.jobId, saved.resourceId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleCancelActiveJob = async () => {
    if (!activeJobId) {
      setIsUploading(false);
      return;
    }
    try {
      await cancelMediaProcessing(activeJobId);
      stopRealtimeTracking();
      resetLiveAudioTelemetry();
      useUIStore.getState().setAudioSystemState("Ready", 0);
      setIsUploading(false);
      setActiveJobId(null);
      toast.info(isArabic ? "تم إلغاء المعالجة بنجاح" : "Processing cancelled");
    } catch {
      toast.error(isArabic ? "تعذر إلغاء المهمة" : "Failed to cancel processing");
    }
  };

  const handleRetry = async () => {
    if (!activeJobId) {
      if (file) {
        await executeUpload(file, title);
      } else {
        setJobError(null);
      }
      return;
    }
    try {
      setIsRetrying(true);
      setJobError(null);
      setIsDelayed(false);
      setDelayReason(null);
      setCompletedTranscript(null);
      setLivePartialCount(0);
      setLiveWordsReceived(0);
      setLivePartialPreview("");
      setLiveSegments([]);
      setIsUploading(true);
      setJobStatus("Queued");
      setProgressPercent(15);

      await api.retryJob(activeJobId);
      toast.info(isArabic ? "جاري إعادة معالجة التسجيل..." : "Retrying recording job...");
      startPolling(activeJobId, activeResourceId || undefined);
    } catch {
      toast.error(isArabic ? "تعذرت إعادة المحاولة" : "Failed to retry job");
      setIsUploading(false);
    } finally {
      setIsRetrying(false);
    }
  };

  // No synthetic/sample audio — all processing operates strictly on user-provided media or mic capture.

  // Execute upload immediately and reliably
  const executeUpload = async (uploadFile: File, uploadTitle?: string) => {
    const finalTitle = (uploadTitle || title || uploadFile.name.replace(/\.[^/.]+$/, "")).trim();
    const finalCourseCode = courseCode.trim();

    const check = validateClientMediaFile(uploadFile);
    if (!check.valid) {
      toast.error(check.error || (isArabic ? "ملف وسائط غير صالح" : "Invalid media file"));
      return;
    }

    try {
      setIsUploading(true);
      setJobError(null);
      setCompletedTranscript(null);
      setStageProgress(0);
      setLivePartialCount(0);
      setLiveWordsReceived(0);
      setLivePartialPreview("");
      setLiveSegments([]);
      setCurrentOpText("Uploading audio file to MeetMind...");
      setCurrentOpTextAr("جاري رفع الملف الصوتي إلى منصة MeetMind...");
      setDetectedLang("");
      setFileSizeBytes(uploadFile.size);
      setAudioDurationSec(0);
      setElapsedSec(0);
      setLastUpdatedSecAgo(0);
      setEstRemainingSec(null);
      setIsDelayed(false);
      setDelayReason(null);
      setStageLedger({});
      setJobMilestones({});
      setJobTimings(null);
      setProgressiveSummary("");
      setProgressiveKeywords([]);
      setProgressiveTasks([]);
      setProgressiveQuizCount(0);
      setProgressiveFlashcardsCount(0);
      setActiveResourceId(null);
      setActiveCorrelationId(null);
      setActiveTranscriptId(null);
      setActiveAsrModel(null);
      setActiveLanguageConfig(null);
      setActiveConfidence(null);
      setJobStatus("Preparing");
      setProgressPercent(0);
      useUIStore.getState().setAudioSystemState("Uploading", 0);

      const res = await processMedia({
        file: uploadFile,
        type,
        title: finalTitle,
        courseCode: finalCourseCode,
        language: selectedLanguage,
        onUploadProgress: (pct) => {
          setJobStatus(pct >= 100 ? "Uploaded" : "Uploading");
          setProgressPercent(pct);
          setStageProgress(pct);
          useUIStore.getState().setAudioSystemState("Uploading", pct);
        },
      });

      if (res.deduplicated) {
        toast.info(
          isArabic
            ? "تم التعرف على نفس الملف الصوتي مسبقاً، جاري جلب التحليل والتفريغ..."
            : "Identical audio file detected. Fetching existing transcription...",
        );
      }

      setActiveJobId(res.jobId);
      setActiveResourceId(res.resourceId);
      setJobStatus("Transcribing");
      setStageProgress(0);
      useUIStore.getState().setAudioSystemState("Transcribing", 25);
      startPolling(res.jobId, res.resourceId);
    } catch (err) {
      clearSavedActiveUploadJob();
      setIsUploading(false);
      useUIStore.getState().setAudioSystemState("Ready", 0);
      const errMsg = err instanceof Error ? err.message : isArabic ? "فشل الرفع" : "Upload failed";
      setJobError(errMsg);
      toast.error(errMsg);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim()) {
      toast.error(isArabic ? "يرجى إدخال العنوان" : "Please enter a title");
      return;
    }
    if (type === "lecture" && !courseCode.trim()) {
      toast.error(isArabic ? "يرجى إدخال كود المادة (مثل CS 6410)" : "Please enter a course code");
      return;
    }
    if (!file) {
      toast.error(
        isArabic
          ? "يرجى اختيار ملف صوتي أو تسجيل صوتي من الميكروفون أولاً للمتابعة"
          : "Please select an audio file or record via microphone first to proceed",
      );
      return;
    }

    await executeUpload(file, title);
  };

  const handleCopyExtractedText = () => {
    if (!completedTranscript) return;
    navigator.clipboard.writeText(completedTranscript.fullText);
    setCopiedFullText(true);
    toast.success(isArabic ? "تم نسخ النص المستخرج بالكامل!" : "Copied full transcript!");
    setTimeout(() => setCopiedFullText(false), 2000);
  };

  const handleResetForNewUpload = () => {
    setCompletedTranscript(null);
    setFile(null);
    setTitle("");
    setJobError(null);
  };

  const statusLabel = isArabic
    ? STAGE_LABELS_AR[jobStatus] || jobStatus
    : STAGE_LABELS_EN[jobStatus] || jobStatus;

  const wordCount = completedTranscript
    ? completedTranscript.fullText.split(/\s+/).filter(Boolean).length
    : 0;

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          if (isUploading && !v) {
            stopRealtimeTracking();
          }
          onOpenChange(v);
        }}
      >
        <DialogContent
          className={
            completedTranscript
              ? "max-w-2xl"
              : isUploading
                ? "max-w-lg max-h-[90vh] overflow-y-auto"
                : "max-w-md"
          }
          dir={isArabic ? "rtl" : "ltr"}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display text-lg">
              <Sparkles className="h-5 w-5 text-primary" />
              <span>
                {completedTranscript
                  ? isArabic
                    ? "النص المستخرج من الملف الصوتي"
                    : "Extracted Audio Transcript"
                  : isUploading
                    ? isArabic
                      ? "جاري معالجة التسجيل الصوتي"
                      : "Processing your recording"
                    : isArabic
                      ? "رفع أو تسجيل صوتي ذكي"
                      : "Upload or Record Audio"}
              </span>
            </DialogTitle>
            <DialogDescription>
              {completedTranscript
                ? isArabic
                  ? "تم استخراج الكلام المنطوق من الملف الصوتي بالكامل وحفظه في الموقع مع الملخص والأسئلة."
                  : "All spoken words have been extracted from your audio file and saved to your workspace."
                : isUploading
                  ? isArabic
                    ? "متابعة حية ودقيقة لمراحل الرفع والتفريغ الصوتي والتحليل المتوازي."
                    : "Real-time pipeline telemetry across upload, speech recognition, and parallel AI analysis."
                  : isArabic
                    ? "تقوم منصة MeetMind تلقائياً باستخراج النص الكامل من الصوت، وتوليد الملخص، واستخراج المهام، وإنشاء كويز تقييمي."
                    : "MeetMind automatically extracts the full transcript from your audio, generates summaries, quizzes, and action items."}
            </DialogDescription>
          </DialogHeader>

          {isUploading ? (
            <div className="py-2 space-y-3.5 text-start">
              {/* Top Progress Ring + Stage Title + Bar */}
              <div className="flex items-center gap-4 rounded-xl border border-border/60 bg-secondary/25 p-3.5">
                <div className="relative flex h-14 w-14 shrink-0 items-center justify-center">
                  <Loader2 className="h-13 w-13 animate-spin text-primary" />
                  <span className="absolute text-xs font-mono font-bold text-foreground">
                    {progressPercent}%
                  </span>
                </div>
                <div className="min-w-0 flex-1 space-y-1.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground truncate">
                      {jobStatus === "Uploading"
                        ? isArabic
                          ? `جاري الرفع (${progressPercent}%)`
                          : `Uploading audio (${progressPercent}%)`
                        : jobStatus === "Transcribing"
                          ? isArabic
                            ? "التفريغ الصوتي قيد التنفيذ"
                            : "Transcription in progress"
                          : jobStatus === "Analyzing"
                            ? isArabic
                              ? "التحليل الذكي المتوازي قيد التنفيذ"
                              : "Generating AI analysis"
                            : statusLabel}
                    </span>
                    {elapsedSec > 0 && (
                      <span className="text-[11px] font-mono text-muted-foreground shrink-0">
                        {formatTime(elapsedSec)}
                      </span>
                    )}
                  </div>
                  <div className="w-full h-2 rounded-full bg-secondary overflow-hidden">
                    <div
                      className="h-full gradient-primary transition-all duration-300 rounded-full"
                      style={{ width: `${Math.max(4, Math.min(100, progressPercent))}%` }}
                    />
                  </div>
                  <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                    <span className="truncate">
                      {isArabic
                        ? currentOpTextAr || currentOpText || statusLabel
                        : currentOpText || statusLabel}
                    </span>
                    {typeof estRemainingSec === "number" && estRemainingSec > 0 && (
                      <span className="font-mono text-primary shrink-0 flex items-center gap-1">
                        <Clock className="h-3 w-3" />
                        {isArabic ? `متبقي ~${estRemainingSec}ث` : `~${estRemainingSec}s left`}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Delayed / Provider Processing Notice (Part 13) */}
              {isDelayed && (
                <div className="rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 space-y-1.5">
                  <div className="flex items-center justify-between gap-2 text-xs font-semibold text-amber-400">
                    <span className="flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                      {isArabic ? "التفريغ الصوتي ما زال مستمراً" : "Transcription delayed"}
                    </span>
                    <span className="text-[10.5px] font-mono text-amber-300/90">
                      {isArabic
                        ? `آخر تحديث: منذ ${lastUpdatedSecAgo}ث`
                        : `Last update: ${lastUpdatedSecAgo}s ago`}
                    </span>
                  </div>
                  <p className="text-[11.5px] text-foreground/85 leading-snug">
                    {delayReason ||
                      (isArabic
                        ? "يقوم محرك التعرف الصوتي بمعالجة التسجيل الطويل حالياً."
                        : "The speech-to-text provider is still processing the audio.")}
                  </p>
                  <div className="pt-0.5">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={handleRetry}
                      disabled={isRetrying}
                      className="h-6 px-2.5 text-[11px] border-amber-500/40 text-amber-300 hover:bg-amber-500/15 cursor-pointer gap-1"
                    >
                      <RotateCw className={`h-3 w-3 ${isRetrying ? "animate-spin" : ""}`} />
                      <span>{isArabic ? "إعادة المحاولة" : "Retry"}</span>
                    </Button>
                  </div>
                </div>
              )}

              {/* Completed / Current / Upcoming Pipeline Checklist (Parts 5, 6, 11) */}
              <div className="rounded-xl border border-border/60 bg-secondary/20 p-3 space-y-1.5">
                <div className="flex items-center justify-between text-[11px] font-semibold text-muted-foreground pb-1 border-b border-border/40">
                  <span>{isArabic ? "مراحل المعالجة الفعلية" : "Pipeline Stages"}</span>
                  {jobStatus === "Transcribing" && stageProgress > 0 && (
                    <span className="font-mono text-primary">
                      {isArabic
                        ? `تم استلام النص: ${stageProgress}%`
                        : `Transcript received: ${stageProgress}%`}
                    </span>
                  )}
                </div>

                {(() => {
                  const uploadDone = Boolean(
                    jobMilestones.uploadComplete ||
                    (jobStatus !== "Uploading" && jobStatus !== "Preparing"),
                  );
                  const validatedDone = Boolean(
                    jobMilestones.audioValidated ||
                    jobMilestones.transcriptionStarted ||
                    (uploadDone && jobStatus !== "Validating"),
                  );
                  const transStarted = Boolean(
                    jobMilestones.transcriptionStarted ||
                    jobStatus === "Transcribing" ||
                    jobMilestones.transcriptionCompleted,
                  );
                  const transDone = Boolean(jobMilestones.transcriptionCompleted);
                  const analysisRunning = Boolean(
                    jobMilestones.analysisStarted ||
                    jobStatus === "Analyzing" ||
                    jobStatus === "Generating Results" ||
                    jobStatus === "Generating Quiz",
                  );
                  const langDisplay =
                    detectedLang === "ar" || selectedLanguage.startsWith("ar")
                      ? isArabic
                        ? "العربية"
                        : "Arabic"
                      : detectedLang === "en" || selectedLanguage.startsWith("en")
                        ? isArabic
                          ? "الإنجليزية"
                          : "English"
                        : isArabic
                          ? "تلقائي"
                          : " speech";

                  const checklist: Array<{
                    key: string;
                    state: "done" | "current" | "upcoming";
                    label: string;
                    meta?: string;
                  }> = [
                    {
                      key: "upload",
                      state: uploadDone ? "done" : "current",
                      label: isArabic ? "تم رفع الملف الصوتي" : "File uploaded",
                      meta:
                        typeof jobTimings?.uploadMs === "number"
                          ? `${(jobTimings.uploadMs / 1000).toFixed(2)}s`
                          : undefined,
                    },
                    {
                      key: "validated",
                      state: validatedDone ? "done" : uploadDone ? "current" : "upcoming",
                      label: isArabic ? "تم التحقق من سلامة الصوت" : "Audio validated",
                      meta:
                        typeof jobTimings?.validationMs === "number"
                          ? `${(jobTimings.validationMs / 1000).toFixed(2)}s`
                          : undefined,
                    },
                    {
                      key: "sent_asr",
                      state: transStarted ? "done" : validatedDone ? "current" : "upcoming",
                      label: isArabic ? "بدء محرك التفريغ الصوتي" : "Transcription started",
                      meta:
                        typeof jobTimings?.assemblyAiUploadMs === "number"
                          ? `ASR upload ${(jobTimings.assemblyAiUploadMs / 1000).toFixed(1)}s`
                          : activeAsrModel || undefined,
                    },
                    {
                      key: "transcribing",
                      state: transDone ? "done" : transStarted ? "current" : "upcoming",
                      label: transDone
                        ? isArabic
                          ? `اكتمل تفريغ الكلام وحفظ النص (${langDisplay})`
                          : `Transcript completed & saved (${langDisplay})`
                        : isArabic
                          ? `تفريغ الكلام (${langDisplay})`
                          : `Transcribing ${langDisplay}`,
                      meta: transDone
                        ? typeof jobTimings?.transcriptionMs === "number"
                          ? `${(jobTimings.transcriptionMs / 1000).toFixed(1)}s`
                          : `${livePartialCount} segs`
                        : stageProgress > 0
                          ? `${stageProgress}%`
                          : undefined,
                    },
                    {
                      key: "keywords",
                      state: jobMilestones.keywordsReady
                        ? "done"
                        : analysisRunning
                          ? "current"
                          : "upcoming",
                      label: isArabic ? "الكلمات المفتاحية والجمل المهمة" : "Keywords & highlights",
                      meta:
                        typeof jobTimings?.keywordsMs === "number"
                          ? `${(jobTimings.keywordsMs / 1000).toFixed(2)}s`
                          : progressiveKeywords.length > 0
                            ? `${progressiveKeywords.length}`
                            : undefined,
                    },
                    {
                      key: "summary",
                      state: jobMilestones.summaryReady
                        ? "done"
                        : analysisRunning
                          ? "current"
                          : "upcoming",
                      label: isArabic ? "الملخص الذكي والملاحظات" : "Summary & notes",
                      meta:
                        typeof jobTimings?.summaryMs === "number"
                          ? `${(jobTimings.summaryMs / 1000).toFixed(1)}s`
                          : stageLedger.SUMMARY_COMPLETED?.durationMs
                            ? `${(stageLedger.SUMMARY_COMPLETED.durationMs / 1000).toFixed(1)}s`
                            : undefined,
                    },
                    {
                      key: "tasks",
                      state: jobMilestones.tasksReady
                        ? "done"
                        : analysisRunning
                          ? "current"
                          : "upcoming",
                      label: isArabic ? "استخراج المهام والمواعيد" : "Action items & deadlines",
                      meta:
                        typeof jobTimings?.tasksMs === "number"
                          ? `${(jobTimings.tasksMs / 1000).toFixed(1)}s`
                          : progressiveTasks.length > 0
                            ? `${progressiveTasks.length}`
                            : undefined,
                    },
                    {
                      key: "quiz",
                      state: jobMilestones.quizReady
                        ? "done"
                        : analysisRunning
                          ? "current"
                          : "upcoming",
                      label: isArabic ? "الاختبار التقييمي الموثق" : "Grounded comprehension quiz",
                      meta:
                        typeof jobTimings?.quizMs === "number"
                          ? `${(jobTimings.quizMs / 1000).toFixed(1)}s`
                          : progressiveQuizCount > 0
                            ? `${progressiveQuizCount} Q`
                            : undefined,
                    },
                    {
                      key: "flashcards",
                      state: jobMilestones.flashcardsReady
                        ? "done"
                        : analysisRunning
                          ? "current"
                          : "upcoming",
                      label: isArabic ? "البطاقات التعليمية" : "Study flashcards",
                      meta:
                        typeof jobTimings?.flashcardsMs === "number"
                          ? `${(jobTimings.flashcardsMs / 1000).toFixed(1)}s`
                          : progressiveFlashcardsCount > 0
                            ? `${progressiveFlashcardsCount}`
                            : undefined,
                    },
                  ];

                  return (
                    <div className="grid grid-cols-1 gap-1 pt-0.5">
                      {checklist.map((item) => (
                        <div
                          key={item.key}
                          className={`flex items-center justify-between gap-2 rounded-lg px-2 py-1 text-xs transition-colors ${
                            item.state === "done"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : item.state === "current"
                                ? "bg-primary/10 text-foreground font-medium border border-primary/30"
                                : "text-muted-foreground/75"
                          }`}
                        >
                          <span className="flex items-center gap-2 min-w-0">
                            {item.state === "done" ? (
                              <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
                            ) : item.state === "current" ? (
                              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
                            ) : (
                              <Circle className="h-3.5 w-3.5 shrink-0 opacity-40" />
                            )}
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.meta && (
                            <span className="text-[10.5px] font-mono opacity-85 shrink-0">
                              {item.meta}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>

              {/* Live Transcript Preview with Speaker Labels + Auto-Scroll (Part 7) */}
              {(livePartialCount > 0 || liveSegments.length > 0) && (
                <div
                  className={`rounded-xl border p-3 space-y-2 ${
                    jobMilestones.transcriptionCompleted
                      ? "border-emerald-500/40 bg-emerald-500/5"
                      : "border-amber-500/40 bg-amber-500/5"
                  }`}
                >
                  <div className="flex items-center justify-between gap-2 text-[11px] font-semibold">
                    <span
                      className={`flex items-center gap-1.5 ${
                        jobMilestones.transcriptionCompleted ? "text-emerald-400" : "text-amber-400"
                      }`}
                    >
                      <span
                        className={`h-1.5 w-1.5 rounded-full ${
                          jobMilestones.transcriptionCompleted
                            ? "bg-emerald-500"
                            : "bg-amber-400 animate-pulse"
                        }`}
                      />
                      {jobMilestones.transcriptionCompleted
                        ? isArabic
                          ? "تفريغ نهائي معتمد — جاهز الآن"
                          : "Final Verified Transcript"
                        : isArabic
                          ? "تفريغ مباشر أولي (قيد المعالجة — غير نهائي)"
                          : "Live Transcript (In Progress — Preliminary)"}
                    </span>
                    <button
                      type="button"
                      onClick={() => setAutoScrollLive((v) => !v)}
                      className={`rounded px-1.5 py-0.5 text-[10px] font-mono border cursor-pointer transition ${
                        autoScrollLive
                          ? "border-primary/40 bg-primary/15 text-primary"
                          : "border-border/60 text-muted-foreground"
                      }`}
                    >
                      {isArabic
                        ? `تمرير تلقائي: ${autoScrollLive ? "مفعّل" : "متوقف"}`
                        : `Auto-scroll: ${autoScrollLive ? "ON" : "OFF"}`}
                    </button>
                  </div>

                  <div className="flex items-center gap-3 text-[11px] font-mono text-muted-foreground">
                    <span>
                      {liveWordsReceived.toLocaleString()}{" "}
                      {isArabic ? "كلمة مستلمة" : "words received"}
                    </span>
                    <span>·</span>
                    <span>
                      {livePartialCount} {isArabic ? "مقطع معالج" : "segments processed"}
                    </span>
                  </div>

                  <div
                    ref={livePreviewScrollRef}
                    className="max-h-32 overflow-y-auto rounded-lg border border-border/50 bg-background/70 p-2.5 space-y-2"
                  >
                    {liveSegments.length > 0 ? (
                      liveSegments.map((seg, idx) => (
                        <div key={seg.id || idx} className="space-y-0.5 text-xs">
                          <div className="flex items-center justify-between text-[10px] font-mono text-primary">
                            <span className="font-semibold">{seg.speaker}</span>
                            <span className="text-muted-foreground">
                              {formatTime(seg.startTime)}
                            </span>
                          </div>
                          <p
                            dir={/[\u0600-\u06FF]/.test(seg.text) ? "rtl" : "ltr"}
                            className="text-foreground/90 leading-relaxed"
                          >
                            &ldquo;{seg.text}&rdquo;
                          </p>
                        </div>
                      ))
                    ) : (
                      <p
                        dir={/[\u0600-\u06FF]/.test(livePartialPreview) ? "rtl" : "ltr"}
                        className="text-xs text-foreground/90 leading-relaxed"
                      >
                        {livePartialPreview}
                      </p>
                    )}
                  </div>

                  {activeResourceId && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => {
                        const targetId = activeResourceId;
                        onOpenChange(false);
                        navigate({ to: "/transcript", search: { id: targetId } });
                      }}
                      className="w-full h-7 text-[11px] border-emerald-500/40 text-emerald-400 hover:bg-emerald-500/10 cursor-pointer gap-1"
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>
                        {jobMilestones.transcriptionCompleted
                          ? isArabic
                            ? "افتح التفريغ النهائي الآن (التحليل يكمل بالخلفية)"
                            : "Open Full Transcript Now (Analysis Continues Live)"
                          : isArabic
                            ? "افتح النص المستلم فوراً أثناء استكمال التفريغ"
                            : "Open Transcript Immediately"}
                      </span>
                    </Button>
                  )}
                </div>
              )}

              {/* Progressive Summary / Keywords Preview as Ready (Part 11) */}
              {progressiveSummary && (
                <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/5 p-2.5 space-y-1">
                  <div className="text-[11px] font-semibold text-emerald-400">
                    {isArabic ? "الملخص جاهز الآن:" : "Summary Ready:"}
                  </div>
                  <p
                    dir={/[\u0600-\u06FF]/.test(progressiveSummary) ? "rtl" : "ltr"}
                    className="text-xs text-foreground/90 leading-relaxed line-clamp-2"
                  >
                    {progressiveSummary}
                  </p>
                </div>
              )}

              {/* Real Processing Metrics Grid (Part 8) */}
              <div className="rounded-xl border border-border/50 bg-secondary/25 px-3 py-2 text-[10.5px] font-mono text-muted-foreground space-y-1">
                <div className="flex items-center gap-1.5 text-[10.5px] font-semibold text-foreground/80">
                  <Activity className="h-3 w-3 text-primary" />
                  <span>{isArabic ? "القياسات الفعلية الحية" : "Real Processing Telemetry"}</span>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-0.5">
                  {(fileSizeBytes > 0 || (file && file.size > 0)) && (
                    <span>
                      {isArabic ? "الحجم" : "File size"}:{" "}
                      {((fileSizeBytes || file?.size || 0) / (1024 * 1024)).toFixed(1)} MB
                    </span>
                  )}
                  {audioDurationSec > 0 && (
                    <span>
                      {isArabic ? "المدة" : "Audio duration"}: {formatTime(audioDurationSec)}
                    </span>
                  )}
                  {typeof jobTimings?.uploadMs === "number" && (
                    <span>
                      {isArabic ? "الرفع" : "Upload"}: {(jobTimings.uploadMs / 1000).toFixed(2)}s
                    </span>
                  )}
                  <span>
                    {isArabic ? "التفريغ" : "Transcription"}:{" "}
                    {typeof jobTimings?.transcriptionMs === "number"
                      ? `${(jobTimings.transcriptionMs / 1000).toFixed(1)}s`
                      : stageProgress > 0
                        ? `${stageProgress}%`
                        : isArabic
                          ? "قيد التنفيذ"
                          : "In progress"}
                  </span>
                  <span>
                    {isArabic ? "المقاطع" : "Segments"}: {livePartialCount}
                  </span>
                  <span>
                    {isArabic ? "الكلمات" : "Words"}: {liveWordsReceived.toLocaleString()}
                  </span>
                  <span className="col-span-2 truncate">
                    {isArabic ? "التحليل الذكي" : "AI analysis"}:{" "}
                    {typeof jobTimings?.geminiAnalysisMs === "number"
                      ? `${(jobTimings.geminiAnalysisMs / 1000).toFixed(1)}s`
                      : jobMilestones.transcriptionCompleted
                        ? isArabic
                          ? "يعمل بالتوازي الآن..."
                          : "Running in parallel..."
                        : isArabic
                          ? "بانتظار اكتمال النص"
                          : "Waiting for transcript"}
                  </span>
                </div>
                {(activeAsrModel || activeCorrelationId) && (
                  <div className="truncate opacity-75 pt-0.5 border-t border-border/30">
                    {activeAsrModel ? `ASR=${activeAsrModel}` : ""}
                    {activeConfidence !== null
                      ? ` · conf=${Math.round(activeConfidence * 100)}%`
                      : ""}
                    {activeCorrelationId ? ` · ${activeCorrelationId}` : ""}
                  </div>
                )}
              </div>

              {/* Footer Actions: Continue in Background + Cancel (Part 12) */}
              <div className="flex items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    toast.info(
                      isArabic
                        ? "تستمر المعالجة في الخلفية — سيصلك إشعار فور الجاهزية."
                        : "Processing continues in background — we'll notify you when ready.",
                    );
                    onOpenChange(false);
                  }}
                  className="flex-1 text-xs cursor-pointer"
                >
                  {isArabic ? "المتابعة في الخلفية" : "Continue in Background"}
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  size="sm"
                  onClick={handleCancelActiveJob}
                  className="text-xs cursor-pointer"
                >
                  {isArabic ? "إلغاء المعالجة" : "Cancel Processing"}
                </Button>
              </div>
            </div>
          ) : completedTranscript ? (
            <div className="space-y-4 pt-1">
              {/* Success Banner & Stats */}
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/40 bg-emerald-500/10 px-3.5 py-2.5">
                <div className="flex items-center gap-2 text-emerald-400 font-bold text-xs sm:text-sm">
                  <CheckCircle2 className="h-4 w-4 shrink-0" />
                  <span className="truncate max-w-[260px]">{completedTranscript.title}</span>
                </div>
                <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
                  <Badge
                    variant="outline"
                    className="border-emerald-500/40 bg-emerald-500/15 text-emerald-300"
                  >
                    {isArabic ? "تفريغ نهائي معتمد" : "Final Verified Transcript"}
                  </Badge>
                  {completedTranscript.asrModel && (
                    <Badge
                      variant="outline"
                      className="border-cyan-500/40 bg-cyan-500/10 text-cyan-300"
                    >
                      {completedTranscript.asrModel}
                    </Badge>
                  )}
                  {typeof completedTranscript.averageConfidence === "number" && (
                    <Badge
                      variant="outline"
                      className="border-emerald-500/30 bg-emerald-500/10 text-emerald-300"
                    >
                      {Math.round(completedTranscript.averageConfidence * 100)}%
                    </Badge>
                  )}
                  <Badge
                    variant="outline"
                    className="border-amber-500/40 bg-amber-500/10 text-amber-300"
                  >
                    {wordCount} {isArabic ? "كلمة" : "words"}
                  </Badge>
                  <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                    {completedTranscript.segments.length} {isArabic ? "مقطع" : "segments"}
                  </Badge>
                </div>
              </div>

              {/* Real Stage Timing Breakdown */}
              {jobTimings && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border/60 bg-secondary/40 px-3 py-1.5 text-[11px] font-mono text-muted-foreground">
                  {typeof jobTimings.uploadMs === "number" && (
                    <span>
                      {isArabic ? "الرفع" : "Upload"}: {(jobTimings.uploadMs / 1000).toFixed(2)}s
                    </span>
                  )}
                  {typeof jobTimings.transcriptionMs === "number" && (
                    <span>
                      · {isArabic ? "التفريغ" : "Transcription"}:{" "}
                      {(jobTimings.transcriptionMs / 1000).toFixed(2)}s
                      {jobTimings.transcriptCacheHit ? " (cached)" : ""}
                    </span>
                  )}
                  {typeof jobTimings.geminiAnalysisMs === "number" && (
                    <span>
                      · {isArabic ? "التحليل" : "AI Analysis"}:{" "}
                      {(jobTimings.geminiAnalysisMs / 1000).toFixed(2)}s
                    </span>
                  )}
                  {typeof jobTimings.databaseSaveMs === "number" && (
                    <span>
                      · {isArabic ? "القاعدة" : "DB"}:{" "}
                      {(jobTimings.databaseSaveMs / 1000).toFixed(2)}s
                    </span>
                  )}
                  {typeof jobTimings.totalMs === "number" && (
                    <span className="font-bold text-primary">
                      · {isArabic ? "الإجمالي" : "Total"}: {(jobTimings.totalMs / 1000).toFixed(2)}s
                    </span>
                  )}
                </div>
              )}

              {/* View Mode Switcher + Copy Button */}
              <div className="flex items-center justify-between gap-2">
                <div className="inline-flex rounded-lg border border-border/70 bg-secondary/50 p-0.5 text-xs">
                  <button
                    type="button"
                    onClick={() => setTranscriptViewMode("continuous")}
                    className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                      transcriptViewMode === "continuous"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isArabic ? "النص الكامل المستمر" : "Full Continuous Text"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptViewMode("segments")}
                    className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                      transcriptViewMode === "segments"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isArabic ? "مقاطع المتحدثين بالتوقيت" : "Timestamped Segments"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptViewMode("raw")}
                    className={`rounded-md px-2.5 py-1 font-semibold transition cursor-pointer ${
                      transcriptViewMode === "raw"
                        ? "bg-primary text-primary-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {isArabic ? "النص الخام (RAW ASR)" : "Raw ASR"}
                  </button>
                </div>

                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={handleCopyExtractedText}
                  className="h-7 gap-1.5 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/15 cursor-pointer"
                >
                  {copiedFullText ? (
                    <Check className="h-3.5 w-3.5 text-emerald-400" />
                  ) : (
                    <Copy className="h-3.5 w-3.5 text-amber-400" />
                  )}
                  <span>{isArabic ? "نسخ النص بالكامل" : "Copy Full Text"}</span>
                </Button>
              </div>

              {/* Extracted Transcript Reading Box */}
              <div className="max-h-[290px] overflow-y-auto rounded-xl border border-[#D4AF37]/35 bg-zinc-950/90 p-4 shadow-inner">
                {transcriptViewMode === "continuous" ? (
                  <div
                    dir={/[\u0600-\u06FF]/.test(completedTranscript.fullText) ? "rtl" : "ltr"}
                    className="text-sm leading-relaxed text-zinc-100 whitespace-pre-line select-text font-medium"
                  >
                    {completedTranscript.fullText}
                  </div>
                ) : transcriptViewMode === "raw" ? (
                  <div className="space-y-2">
                    <div className="text-[11px] font-mono text-cyan-300">
                      RAW ASR ({completedTranscript.transcriptionProvider || "asr"}
                      {completedTranscript.asrModel ? ` · ${completedTranscript.asrModel}` : ""}
                      {completedTranscript.languageConfig
                        ? ` · ${completedTranscript.languageConfig}`
                        : ""}
                      )
                    </div>
                    <div
                      dir={
                        /[\u0600-\u06FF]/.test(
                          completedTranscript.rawTranscript || completedTranscript.fullText,
                        )
                          ? "rtl"
                          : "ltr"
                      }
                      className="text-sm leading-relaxed text-zinc-200 whitespace-pre-wrap select-text"
                    >
                      {completedTranscript.rawTranscript || completedTranscript.fullText}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {completedTranscript.segments.map((seg, idx) => (
                      <div
                        key={seg.id || idx}
                        className="rounded-lg border border-zinc-800/80 bg-zinc-900/70 p-2.5 text-xs"
                      >
                        <div className="flex items-center justify-between text-[10.5px] font-mono text-amber-400/90 mb-1">
                          <span className="font-bold">{seg.speaker}</span>
                          <span>
                            {formatTime(seg.startTime)} - {formatTime(seg.endTime)}
                          </span>
                        </div>
                        <p
                          dir={/[\u0600-\u06FF]/.test(seg.text) ? "rtl" : "ltr"}
                          className="text-zinc-100 leading-relaxed"
                        >
                          {seg.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Actions Footer */}
              <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleResetForNewUpload}
                  className="text-xs cursor-pointer"
                >
                  {isArabic ? "رفع ملف آخر" : "Upload Another"}
                </Button>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      onOpenChange(false);
                      useUIStore.getState().setAiDockOpen(true);
                    }}
                    className="gap-1.5 text-xs border-amber-500/40 text-amber-300 hover:bg-amber-500/15 cursor-pointer"
                  >
                    <MessageSquare className="h-3.5 w-3.5 text-amber-400" />
                    <span>{isArabic ? "اسأل الذكاء الاصطناعي" : "Ask AI Assistant"}</span>
                  </Button>

                  <Button
                    type="button"
                    size="sm"
                    onClick={() => {
                      const targetId = completedTranscript.resourceId;
                      onOpenChange(false);
                      navigate({
                        to: "/transcript",
                        search: { id: targetId },
                      });
                    }}
                    className="gradient-primary text-primary-foreground shadow-glow gap-1.5 text-xs cursor-pointer"
                  >
                    <FileText className="h-3.5 w-3.5" />
                    <span>
                      {isArabic
                        ? "فتح في صفحة التفريغ الكامل والتحليل"
                        : "Open Full Transcript Page"}
                    </span>
                    <ExternalLink className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            </div>
          ) : jobError ? (
            <div className="py-5 space-y-4">
              <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-4 space-y-2.5 text-start">
                <div className="flex items-center justify-between gap-2 text-destructive font-semibold text-sm">
                  <span className="flex items-center gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0" />
                    <span>{isArabic ? "فشلت عملية التفريغ" : "Transcription failed"}</span>
                  </span>
                  {lastUpdatedSecAgo > 0 && (
                    <span className="text-[10.5px] font-mono text-muted-foreground">
                      {isArabic ? `منذ ${lastUpdatedSecAgo}ث` : `${lastUpdatedSecAgo}s ago`}
                    </span>
                  )}
                </div>
                <div className="space-y-1">
                  <div className="text-[11px] font-semibold text-foreground/80">
                    {isArabic ? "السبب الفعلي:" : "Reason:"}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed break-words">
                    {jobError}
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap justify-end gap-2 pt-1">
                <Button variant="ghost" onClick={() => setJobError(null)}>
                  {isArabic ? "عودة" : "Back"}
                </Button>
                <Button
                  onClick={handleRetry}
                  disabled={isRetrying}
                  className="gradient-primary text-primary-foreground shadow-glow gap-2 cursor-pointer"
                >
                  <RotateCw className={`h-4 w-4 ${isRetrying ? "animate-spin" : ""}`} />
                  <span>{isArabic ? "إعادة محاولة التفريغ" : "Retry transcription"}</span>
                </Button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-4 pt-2">
              <div className="space-y-1.5">
                <Label>{isArabic ? "نوع الجلسة" : "Type"}</Label>
                <Select value={type} onValueChange={(v: "meeting" | "lecture") => setType(v)}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="meeting">
                      {isArabic ? "اجتماع عمل ومتابعة مهام" : "Business Meeting"}
                    </SelectItem>
                    <SelectItem value="lecture">
                      {isArabic ? "محاضرة تعليمية وأكاديمية" : "Educational Lecture"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>{isArabic ? "عنوان الجلسة أو المحاضرة" : "Title"}</Label>
                <Input
                  placeholder={
                    type === "meeting"
                      ? isArabic
                        ? "مثال: مراجعة خطة التسليم الربع سنوية"
                        : "e.g. Q4 Strategy Review"
                      : isArabic
                        ? "مثال: مقدمة في نظم التشغيل الموزعة"
                        : "e.g. Distributed Operating Systems"
                  }
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              {type === "lecture" && (
                <div className="space-y-1.5">
                  <Label>{isArabic ? "كود المادة" : "Course Code"}</Label>
                  <Input
                    placeholder="e.g. CS 6410"
                    value={courseCode}
                    onChange={(e) => setCourseCode(e.target.value)}
                    required
                  />
                </div>
              )}

              <div className="space-y-1.5">
                <Label className="flex items-center justify-between">
                  <span>
                    {isArabic ? "لغة التسجيل واللهجة المسموعة" : "Spoken Language / Dialect"}
                  </span>
                  <Badge
                    variant="outline"
                    className="text-[10px] font-mono border-primary/30 text-primary"
                  >
                    {isArabic ? "محرك MeetMind AI" : "MeetMind AI Engine"}
                  </Badge>
                </Label>
                <Select value={selectedLanguage} onValueChange={(v) => setSelectedLanguage(v)}>
                  <SelectTrigger className="bg-background/80">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">
                      {isArabic
                        ? "🌐 كشف تلقائي ذكي (عربي / إنجليزي / هجين)"
                        : "🌐 Auto-Detect (Arabic / English / Mixed)"}
                    </SelectItem>
                    <SelectItem value="ar-EG">
                      {isArabic ? "🇪🇬 لهجة مصرية وعامية (Egyptian Arabic)" : "🇪🇬 Egyptian Arabic"}
                    </SelectItem>
                    <SelectItem value="ar-SA">
                      {isArabic
                        ? "🇸🇦 لغة عربية فصحى (Modern Standard Arabic)"
                        : "🇸🇦 Modern Standard Arabic"}
                    </SelectItem>
                    <SelectItem value="en">
                      {isArabic ? "🇺🇸 لغة إنجليزية (English)" : "🇺🇸 English"}
                    </SelectItem>
                    <SelectItem value="mixed">
                      {isArabic
                        ? "⚡ مزيج عربي وإنجليزي تقني (Code-Switching)"
                        : "⚡ Mixed Technical (Code-Switching)"}
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Direct Live Stream Option */}
              <div className="rounded-xl border border-primary/30 bg-primary/10 p-3.5 space-y-2">
                <div className="flex items-center justify-between">
                  <Badge
                    variant="outline"
                    className="border-primary/40 bg-primary/20 text-primary text-[10px]"
                  >
                    مباشر · Real-Time Stream
                  </Badge>
                  <div className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                    {isArabic ? "التفريغ الصوتي الحي المباشر" : "Live Arabic Transcription"}
                    <Sparkles className="h-3.5 w-3.5 text-primary" />
                  </div>
                </div>
                <p className="text-[11px] text-muted-foreground leading-relaxed">
                  {isArabic
                    ? "تفريغ وترجمة فورية متزامنة أثناء التحدث، تظهر الكلمات تباعاً بالعربية الفصحى مع الحفظ التلقائي في قاعدة البيانات."
                    : "Real-time progressive transcription with live auto-saving and full persistence."}
                </p>
                <Button
                  type="button"
                  onClick={() => {
                    onOpenChange(false);
                    setLiveRecorderOpen(true);
                  }}
                  className="w-full gradient-primary text-primary-foreground shadow-glow h-8 text-xs font-semibold gap-2 cursor-pointer"
                >
                  <Mic className="h-3.5 w-3.5" />
                  <span>
                    {isArabic ? "بدء جلسة التفريغ المباشر الآن" : "Start Live Recording Now"}
                  </span>
                </Button>
              </div>

              {/* Upload Recorded Audio File Option */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>
                    {isArabic ? "رفع ملف صوتي أو تسجيل مباشر" : "Upload Audio or Record"}
                  </Label>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {isArabic ? "حد أقصى 500MB" : "Max 500MB"}
                  </span>
                </div>

                {/* Hidden File Input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".mp3,.wav,.m4a,.aac,.flac,.ogg,.opus,.webm,.mp4,.mov,.avi,.mkv,.wma,.aiff,audio/*,video/*"
                  className="hidden"
                  onChange={(e) => {
                    if (e.target.files && e.target.files[0]) {
                      const selected = e.target.files[0];
                      const check = validateClientMediaFile(selected);
                      if (!check.valid) {
                        toast.error(
                          check.error || (isArabic ? "ملف وسائط غير صالح" : "Invalid media file"),
                        );
                        e.target.value = "";
                        return;
                      }
                      setFile(selected);
                      const derivedTitle = title.trim() || selected.name.replace(/\.[^/.]+$/, "");
                      if (!title.trim()) setTitle(derivedTitle);
                      toast.success(
                        isArabic
                          ? `تم اختيار الملف: ${selected.name} — بدء الرفع فوراً...`
                          : `Selected: ${selected.name} — Uploading now...`,
                      );
                      void executeUpload(selected, derivedTitle);
                    }
                  }}
                />

                {/* Interactive Drag & Click Upload Box */}
                <div
                  onClick={() => fileInputRef.current?.click()}
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                      const dropped = e.dataTransfer.files[0];
                      const check = validateClientMediaFile(dropped);
                      if (!check.valid) {
                        toast.error(
                          check.error || (isArabic ? "ملف وسائط غير صالح" : "Invalid media file"),
                        );
                        return;
                      }
                      setFile(dropped);
                      const derivedTitle = title.trim() || dropped.name.replace(/\.[^/.]+$/, "");
                      if (!title.trim()) setTitle(derivedTitle);
                      toast.success(
                        isArabic
                          ? `تم سحب الملف: ${dropped.name} — بدء الرفع فوراً...`
                          : `Dropped: ${dropped.name} — Uploading now...`,
                      );
                      void executeUpload(dropped, derivedTitle);
                    }
                  }}
                  className={`relative flex flex-col items-center justify-center p-5 rounded-xl border-2 border-dashed transition-all cursor-pointer ${
                    file
                      ? "border-emerald-500/60 bg-emerald-500/10 hover:bg-emerald-500/15"
                      : "border-amber-500/40 bg-zinc-950/70 hover:border-amber-400 hover:bg-zinc-900/80 shadow-inner"
                  }`}
                >
                  <div className="flex h-11 w-11 items-center justify-center rounded-full bg-amber-500/15 border border-amber-500/30 text-amber-400 mb-2">
                    <Upload className="h-5 w-5" />
                  </div>

                  <div className="text-sm font-bold text-foreground text-center">
                    {file
                      ? file.name
                      : isArabic
                        ? "اضغط هنا لاختيار ملف صوتي أو فيديو من جهازك"
                        : "Click here to choose an audio or video file"}
                  </div>

                  <p className="text-[11.5px] text-muted-foreground mt-1 text-center">
                    {file
                      ? isArabic
                        ? "اضغط لتغيير الملف المحدد"
                        : "Click to change selected file"
                      : isArabic
                        ? "يدعم MP3, WAV, M4A, AAC, WEBM, OGG, MP4"
                        : "Supports MP3, WAV, M4A, AAC, WEBM, OGG, MP4"}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-2 pt-1">
                  <Button
                    type="button"
                    variant={isRecording ? "destructive" : "outline"}
                    className="flex items-center gap-2 cursor-pointer border-amber-500/30"
                    onClick={isRecording ? stopMicrophoneRecording : startMicrophoneRecording}
                  >
                    <Mic className={`h-4 w-4 text-amber-400 ${micAnim}`} />
                    <span>
                      {isRecording
                        ? `${isArabic ? "إيقاف" : "Stop"} (${recordingSeconds}s)`
                        : isArabic
                          ? "تسجيل من الميكروفون"
                          : "Record Mic"}
                    </span>
                  </Button>

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => fileInputRef.current?.click()}
                    className="w-full flex items-center justify-center gap-2 cursor-pointer border-amber-500/30 text-amber-300 font-semibold"
                  >
                    <Upload className="h-4 w-4 text-amber-400" />
                    <span className="truncate">
                      {file
                        ? isArabic
                          ? "تغيير الملف"
                          : "Change File"
                        : isArabic
                          ? "تصفح الملفات"
                          : "Browse File"}
                    </span>
                  </Button>
                </div>

                {isRecording && (
                  <div className="flex items-center justify-between gap-2 p-3 rounded-xl bg-destructive/10 border border-destructive/30 mt-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`h-2 w-2 rounded-full bg-destructive ${isMicPaused ? "" : "animate-ping"}`}
                      />
                      <span className="text-xs font-semibold text-destructive">
                        {isMicPaused
                          ? isArabic
                            ? "التسجيل متوقف مؤقتاً"
                            : "Recording paused"
                          : isArabic
                            ? "جاري التسجيل من الميكروفون..."
                            : "Recording live audio..."}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-mono font-medium text-destructive">
                        {Math.floor(recordingSeconds / 60)}:
                        {(recordingSeconds % 60).toString().padStart(2, "0")}
                      </span>
                      <Button
                        type="button"
                        size="icon"
                        variant="outline"
                        onClick={toggleMicPause}
                        className="h-7 w-7 border-destructive/30 cursor-pointer"
                        title={isMicPaused ? "Resume" : "Pause"}
                      >
                        {isMicPaused ? (
                          <Play className="h-3.5 w-3.5" />
                        ) : (
                          <Pause className="h-3.5 w-3.5" />
                        )}
                      </Button>
                    </div>
                  </div>
                )}

                {file && !isRecording && (
                  <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-500/10 p-2.5 rounded-lg border border-emerald-500/30 mt-2">
                    <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                    <span className="truncate font-medium">{file.name}</span>
                    <span className="text-[10px] text-muted-foreground ml-auto font-mono">
                      {file.size > 1024 * 1024
                        ? `${(file.size / (1024 * 1024)).toFixed(1)} MB`
                        : `${Math.round(file.size / 1024)} KB`}
                    </span>
                  </div>
                )}
              </div>

              <div className="pt-2 flex items-center justify-between gap-2">
                {!file && !isRecording && (
                  <span className="text-[11px] text-amber-400/85">
                    {isArabic
                      ? "اختر ملفاً صوتياً/فيديو أو ابدأ التسجيل من الميكروفون"
                      : "Select an audio/video file or record via microphone"}
                  </span>
                )}
                <div className="flex items-center gap-2 ml-auto">
                  <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                    {isArabic ? "إلغاء" : "Cancel"}
                  </Button>
                  <Button
                    type="submit"
                    disabled={!file && !isRecording}
                    className="gradient-primary text-primary-foreground shadow-glow cursor-pointer disabled:opacity-50"
                  >
                    {isArabic ? "حفظ واستخراج النص" : "Save & Extract Text"}
                  </Button>
                </div>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <LiveArabicRecorder
        open={liveRecorderOpen}
        onOpenChange={setLiveRecorderOpen}
        defaultType={type}
        onCompleted={() => {
          if (onSuccess) onSuccess();
        }}
      />
    </>
  );
}
