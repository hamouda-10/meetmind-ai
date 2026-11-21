import { useQuery } from "@tanstack/react-query";
import { Sparkles, CheckSquare, GraduationCap, Video } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { SectionHeader } from "@/components/common/section-header";
import { api, Meeting, Lecture } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";

export function AIInsights() {
  const { isRtl } = useTranslation();
  const { data: meetings = [] } = useQuery<Meeting[]>({
    queryKey: ["meetings"],
    queryFn: () => api.getMeetings(),
  });

  const { data: lectures = [] } = useQuery<Lecture[]>({
    queryKey: ["lectures"],
    queryFn: () => api.getLectures(),
  });

  const insights: { id: string; title: string; icon: typeof Sparkles }[] = [];

  if (meetings.length > 0) {
    const latestMeeting = meetings[0];
    insights.push({
      id: "ins_1",
      title: isRtl
        ? `تم توثيق وتفريغ اجتماع "${latestMeeting.title}" بنجاح بالعربية.`
        : `Meeting "${latestMeeting.title}" documented and transcribed successfully.`,
      icon: Video,
    });
  }

  if (lectures.length > 0) {
    const latestLecture = lectures[0];
    insights.push({
      id: "ins_2",
      title: isRtl
        ? `محاضرة ${latestLecture.courseCode} — ${latestLecture.title} جاهزة للمراجعة والاختبار.`
        : `Lecture ${latestLecture.courseCode} — ${latestLecture.title} is ready for study and quiz.`,
      icon: GraduationCap,
    });
  }

  const completedCount =
    meetings.filter((m) => m.status === "Completed").length +
    lectures.filter((l) => l.status === "Completed").length;
  if (completedCount > 0) {
    insights.push({
      id: "ins_3",
      title: isRtl
        ? `إجمالي الجلسات المكتملة بالتفريغ والترجمة الذكية: ${completedCount} جلسات.`
        : `Total completed sessions transcribed with AI: ${completedCount} sessions.`,
      icon: CheckSquare,
    });
  }

  return (
    <GlassCard className="relative overflow-hidden p-5" dir={isRtl ? "rtl" : "ltr"}>
      <div className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full gradient-primary opacity-25 blur-3xl" />
      <div className="relative space-y-3">
        <SectionHeader
          title={isRtl ? "رؤى MeetMind الذكية" : "AI Insights"}
          description={
            isRtl ? "استنتاجات وتنبيهات الأداء المباشرة" : "Live intelligence & key takeaways"
          }
          action={<Sparkles className="h-4 w-4 text-primary" />}
        />
        {insights.length === 0 ? (
          <div className="py-6 text-center text-xs text-muted-foreground">
            {isRtl
              ? "لا توجد رؤى اصطناعية بعد. قم ببدء أول تسجيل صوتي لاستخلاص الرؤى مباشرة."
              : "No AI insights yet. Record or upload your first session to generate actionable takeaways."}
          </div>
        ) : (
          <ul className="space-y-2">
            {insights.map((i) => {
              const Icon = i.icon;
              return (
                <li
                  key={i.id}
                  className="flex items-start gap-3 rounded-xl border border-border/60 bg-background/40 p-3"
                >
                  <div className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-primary/30 bg-primary/10 text-primary">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1 text-xs text-foreground leading-relaxed font-medium">
                    {i.title}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </GlassCard>
  );
}
