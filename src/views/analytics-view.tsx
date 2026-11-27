import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, Users, Sparkles, Loader2, Gauge, Cpu, CheckCircle2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import { GlassCard } from "@/components/common/glass-card";
import { Badge } from "@/components/ui/badge";
import {
  WeeklyAnalytics,
  MeetingAnalytics,
  LectureAnalytics,
} from "@/components/dashboard/analytics-charts";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";

function fmtSec(ms?: number): string {
  if (typeof ms !== "number" || !Number.isFinite(ms) || ms < 0) return "—";
  return `${(ms / 1000).toFixed(2)}s`;
}

export default function AnalyticsView() {
  const { t, isRtl } = useTranslation();
  const { data: metrics, isLoading } = useQuery({
    queryKey: ["dashboard-metrics"],
    queryFn: () => api.getDashboardMetrics(),
  });

  const { data: reports } = useQuery({
    queryKey: ["reports"],
    queryFn: () => api.getReports(),
  });

  const { data: perfReport } = useQuery({
    queryKey: ["pipeline-performance"],
    queryFn: () => api.getPipelinePerformance(),
    refetchInterval: 15000,
  });

  const totalRecordings =
    reports?.totalRecordings ?? (metrics ? metrics.totalMeetings + metrics.totalLectures : 0);
  const audioHours = reports?.totalAudioHours ?? metrics?.totalAudioHours ?? 0;
  const taskCompletionRate = reports?.taskCompletionRate ?? 0;
  const totalTasks = (metrics?.completedTasks ?? 0) + (metrics?.pendingTasks ?? 0);

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={isRtl ? "الرؤى والتحليلات" : "Insights"}
        title={t("analyticsTitle")}
        description={t("analyticsSubtitle")}
      />
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <StatCard
            label={isRtl ? "إجمالي التسجيلات" : "Total Recordings"}
            value={String(totalRecordings)}
            delta={{ value: totalRecordings > 0 ? `+${totalRecordings}` : "0", direction: "up" }}
            icon={BarChart3}
            tone="primary"
          />
          <StatCard
            label={isRtl ? "ساعات الصوت المعالجة" : "Audio Processed"}
            value={`${audioHours}h`}
            delta={{ value: audioHours > 0 ? `+${audioHours}h` : "0h", direction: "up" }}
            icon={Clock}
            tone="cyan"
          />
          <StatCard
            label={isRtl ? "نسبة إنجاز المهام" : "Task Completion"}
            value={`${taskCompletionRate}%`}
            delta={{ value: `${taskCompletionRate}%`, direction: "up" }}
            icon={Users}
            tone="pink"
          />
          <StatCard
            label={isRtl ? "المهام المستخرجة" : "Extracted Tasks"}
            value={String(totalTasks)}
            delta={{ value: totalTasks > 0 ? `+${totalTasks}` : "0", direction: "up" }}
            icon={Sparkles}
            tone="amber"
          />
        </div>
      )}

      {/* Internal Pipeline Performance Telemetry Dashboard */}
      {perfReport && (
        <GlassCard className="p-5 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Gauge className="h-5 w-5 text-primary" />
              <div>
                <h3 className="font-display text-sm font-bold text-foreground">
                  {isRtl
                    ? "لوحة قياس أداء خط المعالجة الذكي (الوقت الحقيقي)"
                    : "AI Pipeline Performance Telemetry"}
                </h3>
                <p className="text-xs text-muted-foreground">
                  {isRtl
                    ? "قياسات حقيقية لكل مرحلة: الرفع، التفريغ الصوتي، تحليل Gemini، وحفظ قاعدة البيانات"
                    : "Real per-stage timings: Upload, Transcription, AI Analysis, Database, and Total latency"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-mono">
              <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">
                <Cpu className="h-3 w-3 me-1" />
                Mode: {perfReport.config.pipelineMode}
              </Badge>
              <Badge variant="outline">
                AssemblyAI:{" "}
                {perfReport.config.assemblyAiConfigured
                  ? perfReport.config.assemblyAiSpeechModel
                  : "off"}
              </Badge>
              <Badge variant="outline">
                Whisper Pool: {perfReport.config.localWhisperWorkers}w
              </Badge>
              {perfReport.averages.sampleCount > 0 && (
                <Badge variant="outline" className="border-emerald-500/40 text-emerald-400">
                  <CheckCircle2 className="h-3 w-3 me-1" />
                  Cache Hit: {perfReport.averages.cacheHitRatePercent}%
                </Badge>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2.5 text-center font-mono">
            {[
              {
                label: isRtl ? "متوسط الرفع" : "Upload",
                val: fmtSec(perfReport.averages.avgUploadMs),
              },
              {
                label: isRtl ? "متوسط التفريغ" : "Transcription",
                val: fmtSec(perfReport.averages.avgTranscriptionMs),
              },
              {
                label: isRtl ? "تحليل الذكاء" : "AI Analysis",
                val: fmtSec(perfReport.averages.avgAiAnalysisMs),
              },
              {
                label: isRtl ? "قاعدة البيانات" : "Database",
                val: fmtSec(perfReport.averages.avgDatabaseSaveMs),
              },
              {
                label: isRtl ? "الإجمالي" : "Total",
                val: fmtSec(perfReport.averages.avgTotalMs),
                highlight: true,
              },
            ].map((cell) => (
              <div
                key={cell.label}
                className={`rounded-xl border px-3 py-2.5 ${
                  cell.highlight
                    ? "border-primary/40 bg-primary/10 text-primary"
                    : "border-border/60 bg-secondary/40 text-foreground"
                }`}
              >
                <div className="text-[11px] text-muted-foreground">{cell.label}</div>
                <div className="text-base font-bold mt-0.5">{cell.val}</div>
              </div>
            ))}
          </div>

          {perfReport.recentJobs.length > 0 && (
            <div className="overflow-x-auto rounded-xl border border-border/60">
              <table className="w-full text-xs font-mono">
                <thead className="bg-secondary/50 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 text-start">{isRtl ? "التسجيل" : "Recording"}</th>
                    <th className="px-3 py-2 text-start">IDs</th>
                    <th className="px-3 py-2 text-end">{isRtl ? "الرفع" : "Upload"}</th>
                    <th className="px-3 py-2 text-end">{isRtl ? "التفريغ" : "Transcription"}</th>
                    <th className="px-3 py-2 text-end">{isRtl ? "التحليل" : "AI"}</th>
                    <th className="px-3 py-2 text-end">{isRtl ? "القاعدة" : "DB"}</th>
                    <th className="px-3 py-2 text-end">{isRtl ? "الإجمالي" : "Total"}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/40">
                  {perfReport.recentJobs.slice(0, 8).map((entry) => (
                    <tr key={entry.jobId} className="hover:bg-secondary/30">
                      <td className="px-3 py-2 font-sans max-w-[180px] truncate">
                        <div className="font-medium text-foreground truncate">{entry.title}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {entry.transcriptionProvider || "—"} · {entry.durationSeconds}s
                          {entry.timings.transcriptCacheHit ? " · cached" : ""}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-[10px] text-muted-foreground">
                        <div>corr: {entry.correlationId || "—"}</div>
                        <div>job: {entry.jobId.slice(0, 18)}</div>
                        <div>rec: {entry.recordingId}</div>
                        {entry.transcriptId && <div>tr: {entry.transcriptId.slice(0, 16)}</div>}
                      </td>
                      <td className="px-3 py-2 text-end">{fmtSec(entry.timings.uploadMs)}</td>
                      <td className="px-3 py-2 text-end">
                        {fmtSec(entry.timings.transcriptionMs)}
                      </td>
                      <td className="px-3 py-2 text-end">
                        {fmtSec(entry.timings.geminiAnalysisMs)}
                      </td>
                      <td className="px-3 py-2 text-end">{fmtSec(entry.timings.databaseSaveMs)}</td>
                      <td className="px-3 py-2 text-end font-bold text-primary">
                        {fmtSec(entry.timings.totalMs)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </GlassCard>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <WeeklyAnalytics />
        <MeetingAnalytics />
      </div>
      <LectureAnalytics />
    </div>
  );
}
