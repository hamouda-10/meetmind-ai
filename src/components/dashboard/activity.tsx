import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/common/glass-card";
import { SectionHeader } from "@/components/common/section-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";

export function ActivityWidget() {
  const { isRtl } = useTranslation();
  const { data: activity = [] } = useQuery({
    queryKey: ["dashboardActivity"],
    queryFn: () => api.getDashboardActivity(),
  });

  return (
    <GlassCard className="p-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader title={isRtl ? "سجل النشاط المباشر" : "Live Activity Feed"} />
      {activity.length === 0 ? (
        <div className="py-6 text-center text-xs text-muted-foreground">
          {isRtl ? "لا يوجد نشاط مسجل حتى الآن." : "No activity recorded yet."}
        </div>
      ) : (
        <ul className="space-y-3">
          {activity.map((a) => (
            <li key={a.id} className="flex items-start gap-3">
              <Avatar className="h-7 w-7 shrink-0">
                <AvatarFallback className="gradient-primary text-[10px] font-semibold text-primary-foreground">
                  {a.who.slice(0, 2).toUpperCase()}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0 flex-1 text-sm">
                <span className="font-medium text-foreground">{a.who}</span>{" "}
                <span className="text-muted-foreground">
                  {a.what} {isRtl ? "في" : "in"}
                </span>{" "}
                <span className="font-medium text-foreground">{a.where}</span>
                <div className="text-[11px] text-muted-foreground font-mono mt-0.5">{a.when}</div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
