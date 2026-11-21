import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { PageHeader } from "@/components/common/page-header";
import { GlassCard } from "@/components/common/glass-card";
import { StatCard } from "@/components/dashboard/stat-card";
import {
  Building2,
  Users,
  ShieldCheck,
  CreditCard,
  Download,
  Activity,
  AlertTriangle,
  RotateCcw,
  Database,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
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
import { api } from "@/lib/api-client";
import { toast } from "sonner";
import { useTranslation } from "@/lib/i18n";

export default function AdminView() {
  const { t, isRtl } = useTranslation();
  const queryClient = useQueryClient();
  const [resetDialogOpen, setResetDialogOpen] = useState(false);
  const [isResetting, setIsResetting] = useState(false);

  const handleDownloadAudit = () => {
    window.location.href = "/api/v1/reports/export";
    toast.success(isRtl ? "بدء تصدير سجل التدقيق (CSV)..." : "Audit log export started (CSV)...");
  };

  const handleDownloadBackup = () => {
    window.location.href = "/api/v1/system/backup";
    toast.success(
      isRtl
        ? "بدء تنزيل النسخة الاحتياطية للنظام (JSON)..."
        : "System backup download started (JSON)...",
    );
  };

  const handleSystemReset = async () => {
    setIsResetting(true);
    toast.loading(
      isRtl
        ? "جارٍ مسح البيانات التجريبية وإعادة ضبط النظام..."
        : "Wiping test data and resetting system...",
      { id: "reset-sys" },
    );
    try {
      const res = await api.resetSystem(true);
      queryClient.invalidateQueries();
      toast.success(
        res.message ||
          (isRtl ? "تمت إعادة ضبط النظام بنجاح!" : "System reset completed successfully!"),
        { id: "reset-sys" },
      );
      setResetDialogOpen(false);
    } catch {
      toast.error(isRtl ? "فشل في إعادة ضبط النظام" : "Failed to reset system", {
        id: "reset-sys",
      });
    } finally {
      setIsResetting(false);
    }
  };

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={isRtl ? "لوحة التحكم والإدارة" : "Administration & Governance"}
        title={t("nav_admin")}
        description={
          isRtl
            ? "إدارة مساحة العمل، الرقابة على البيانات، النسخ الاحتياطي، وإعادة ضبط النظام."
            : "Workspace management, data compliance, backup archives, and system reset controls."
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadBackup}
              className="cursor-pointer gap-1.5 text-xs"
            >
              <Database className="h-4 w-4 text-primary" />
              <span>{isRtl ? "تنزيل نسخة احتياطية" : "Download Backup"}</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadAudit}
              className="cursor-pointer gap-1.5 text-xs"
            >
              <Download className="h-4 w-4" />
              <span>{isRtl ? "سجل التدقيق (CSV)" : "Audit Log (CSV)"}</span>
            </Button>
          </div>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label={isRtl ? "مساحات العمل" : "Workspaces"}
          value="1"
          icon={Building2}
          tone="primary"
        />
        <StatCard
          label={isRtl ? "المستخدمين النشطين" : "Active Users"}
          value="1"
          icon={Users}
          tone="cyan"
        />
        <StatCard
          label={isRtl ? "معايير الأمان" : "Security Standards"}
          value="SOC 2 & FERPA"
          icon={ShieldCheck}
          tone="pink"
        />
        <StatCard
          label={isRtl ? "خطة الاشتراك" : "Subscription Plan"}
          value="Enterprise AI"
          icon={CreditCard}
          tone="amber"
        />
      </div>

      {/* Usage card */}
      <GlassCard className="p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="font-display text-lg font-semibold">
              {isRtl ? "معدل الاستخدام الشهري للذكاء الاصطناعي" : "Monthly AI Intelligence Quota"}
            </div>
            <div className="text-xs text-muted-foreground">
              {isRtl
                ? "دقائق التفريغ الصوتي والترجمة الفورية وتوليد الملخصات الذكية"
                : "Speech transcription minutes, real-time translations, and Gemini processing"}
            </div>
          </div>
          <div className="text-sm font-semibold text-primary font-mono">
            {isRtl ? "100% متوفر" : "100% Available"}
          </div>
        </div>
        <Progress value={10} className="mt-4 h-2.5" />
      </GlassCard>

      {/* Administrative System Reset Card */}
      <GlassCard className="p-6 border-destructive/30 bg-destructive/5 space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="font-display text-base font-semibold text-destructive flex items-center gap-2">
              <AlertTriangle className="h-5 w-5" />
              <span>
                {isRtl
                  ? "إعادة ضبط النظام بالكامل والبدء من الصفر"
                  : "Complete System Reset to Clean Zero State"}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed max-w-2xl">
              {isRtl
                ? "تتيح لك هذه العملية مسح كافة الاجتماعات والمحاضرات والملفات الصوتية والاختبارات التجريبية والمهام، لتبدأ باستخدام MeetMind AI من نقطة الصفر ببياناتك الحقيقية فقط."
                : "Allows you to permanently wipe all meetings, lectures, audio files, quizzes, and tasks, starting fresh with only your actual production sessions."}
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={handleDownloadBackup}
              className="cursor-pointer gap-1 text-xs"
            >
              <Download className="h-3.5 w-3.5" />
              <span>{isRtl ? "أخذ نسخة احتياطية أولاً" : "Download Backup First"}</span>
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setResetDialogOpen(true)}
              className="cursor-pointer gap-1 text-xs font-semibold"
            >
              <RotateCcw className="h-3.5 w-3.5" />
              <span>{isRtl ? "إعادة ضبط النظام الآن" : "Reset System Now"}</span>
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* System Health */}
      <GlassCard className="p-6 space-y-4">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4 text-primary" />
          <h3 className="font-display text-base font-semibold">
            {isRtl ? "حالة الأنظمة والمحركات التابعة" : "Subsystem & Engine Health Status"}
          </h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 space-y-1">
            <span className="text-muted-foreground font-medium">
              {isRtl ? "محرك التفريغ الصوتي (Whisper ASR)" : "ASR Speech Transcription Engine"}
            </span>
            <div className="text-success font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span>{isRtl ? "يعمل بكفاءة كاملة" : "Fully Operational"}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 space-y-1">
            <span className="text-muted-foreground font-medium">
              {isRtl ? "التخزين المحلي الدائم للملفات" : "Persistent Local Storage"}
            </span>
            <div className="text-success font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span>{isRtl ? "نشط وجاهز (data/recordings)" : "Active (data/recordings)"}</span>
            </div>
          </div>
          <div className="rounded-xl border border-border/60 bg-secondary/30 p-3 space-y-1">
            <span className="text-muted-foreground font-medium">
              {isRtl ? "محرك التلخيص والكويزات (Gemini)" : "AI Analysis & Quiz Engine (Gemini)"}
            </span>
            <div className="text-success font-semibold flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success animate-pulse" />
              <span>{isRtl ? "متصل وجاهز" : "Connected & Ready"}</span>
            </div>
          </div>
        </div>
      </GlassCard>

      {/* System Reset Confirmation Dialog */}
      <AlertDialog open={resetDialogOpen} onOpenChange={setResetDialogOpen}>
        <AlertDialogContent dir={isRtl ? "rtl" : "ltr"}>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              <span>
                {isRtl
                  ? "تأكيد إعادة ضبط النظام وحذف كافة البيانات"
                  : "Confirm system reset and complete data wipe"}
              </span>
            </AlertDialogTitle>
            <AlertDialogDescription className="text-sm leading-relaxed text-muted-foreground">
              {isRtl
                ? "هل أنت متأكد من رغبتك في إعادة ضبط النظام إلى حالة الصفر؟ سيتم حذف جميع التسجيلات الصوتية، المحاضرات، الاجتماعات، الاختبارات، والمهام بشكل نهائي. ننصحك بتحميل نسخة احتياطية أولاً."
                : "Are you sure you want to reset the system to clean zero state? All audio recordings, lectures, meetings, quizzes, and tasks will be permanently removed. We recommend downloading a backup first."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex gap-2 mt-4">
            <AlertDialogCancel className="cursor-pointer">
              {isRtl ? "إلغاء" : "Cancel"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleSystemReset}
              disabled={isResetting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 cursor-pointer"
            >
              {isResetting
                ? isRtl
                  ? "جارٍ المسح..."
                  : "Resetting..."
                : isRtl
                  ? "نعم، تأكيد إعادة الضبط"
                  : "Yes, Confirm Reset"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
