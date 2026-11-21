import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { GlassCard } from "@/components/common/glass-card";
import { SectionHeader } from "@/components/common/section-header";
import { Checkbox } from "@/components/ui/checkbox";
import { Button } from "@/components/ui/button";
import { api, ActionItem } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useTranslation } from "@/lib/i18n";
import { toast } from "sonner";

const PRIORITY = {
  high: "bg-destructive/15 text-destructive",
  medium: "bg-warning/15 text-warning",
  low: "bg-success/15 text-success",
};

export function TasksWidget() {
  const queryClient = useQueryClient();
  const { isRtl } = useTranslation();

  const { data: tasks = [], isLoading } = useQuery<ActionItem[]>({
    queryKey: ["tasks"],
    queryFn: () => api.getTasks(),
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) =>
      api.updateTask(id, { completed }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["dashboard-metrics"] });
      toast.success(isRtl ? "تم تحديث المهمة" : "Task updated");
    },
  });

  return (
    <GlassCard className="p-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader
        title={isRtl ? "المهام والإجراءات" : "Tasks"}
        description={
          isRtl ? "مستخلصة من اجتماعاتك ومحاضراتك" : "Extracted from your meetings and lectures"
        }
        action={
          <Button
            variant="ghost"
            size="sm"
            className="text-xs cursor-pointer"
            onClick={async () => {
              const title = prompt(
                isRtl ? "أدخل بند الإجراء أو المهمة الجديدة:" : "Enter new action item:",
              );
              if (title && title.trim()) {
                await api.createTask({ title: title.trim() });
                queryClient.invalidateQueries({ queryKey: ["tasks"] });
                toast.success(isRtl ? "تم إنشاء المهمة بنجاح" : "Task created");
              }
            }}
          >
            {isRtl ? "إضافة" : "Add"}
          </Button>
        }
      />
      {isLoading ? (
        <div className="flex h-32 items-center justify-center">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : tasks.length === 0 ? (
        <div className="py-8 text-center text-xs text-muted-foreground">
          {isRtl
            ? "لا توجد مهام معلقة. ستظهر المهام المستخلصة من التسجيلات هنا."
            : "No tasks pending. Actions extracted from meetings will appear here."}
        </div>
      ) : (
        <ul className="space-y-2">
          {tasks.slice(0, 5).map((t) => (
            <li
              key={t.id}
              className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/40 p-2.5"
            >
              <Checkbox
                checked={t.completed}
                onCheckedChange={(checked) =>
                  toggleMutation.mutate({ id: t.id, completed: Boolean(checked) })
                }
              />
              <div className="min-w-0 flex-1">
                <div
                  className={cn(
                    "truncate text-sm",
                    t.completed && "text-muted-foreground line-through",
                  )}
                >
                  {t.title}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {t.ownerName ? `${t.ownerName} · ` : ""}
                  {isRtl ? `الموعد: ${t.dueDate || "قريباً"}` : `Due ${t.dueDate || "Soon"}`}
                </div>
              </div>
              <span
                className={cn(
                  "rounded-full px-2 py-0.5 text-[10px] font-medium capitalize",
                  PRIORITY[t.priority] || PRIORITY.medium,
                )}
              >
                {t.priority === "high"
                  ? isRtl
                    ? "عالية"
                    : "high"
                  : t.priority === "low"
                    ? isRtl
                      ? "منخفضة"
                      : "low"
                    : isRtl
                      ? "متوسطة"
                      : "medium"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </GlassCard>
  );
}
