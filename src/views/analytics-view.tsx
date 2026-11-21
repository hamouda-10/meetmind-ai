import { useQuery } from "@tanstack/react-query";
import { BarChart3, Clock, Users, Sparkles, Loader2 } from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  WeeklyAnalytics,
  MeetingAnalytics,
  LectureAnalytics,
} from "@/components/dashboard/analytics-charts";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";

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
      <div className="grid gap-4 lg:grid-cols-2">
        <WeeklyAnalytics />
        <MeetingAnalytics />
      </div>
      <LectureAnalytics />
    </div>
  );
}
