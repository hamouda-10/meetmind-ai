import { Moon, Sun } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useTranslation } from "@/lib/i18n";

export function ThemeToggle({ showLabel = false }: { showLabel?: boolean }) {
  const resolved = useUIStore((s) => s.resolvedTheme);
  const setTheme = useUIStore((s) => s.setTheme);
  const { language } = useTranslation();
  const isAr = language === "AR";
  const isDark = resolved === "dark";

  const label = isDark ? (isAr ? "الوضع النهاري" : "Light") : isAr ? "الوضع الليلي" : "Dark";

  const title = isDark
    ? isAr
      ? "التبديل إلى الوضع النهاري (أبيض وأسود)"
      : "Switch to Light Mode (White & Black)"
    : isAr
      ? "التبديل إلى الوضع الليلي"
      : "Switch to Dark Mode";

  return (
    <button
      type="button"
      onClick={() => setTheme(isDark ? "light" : "dark")}
      aria-label={title}
      title={title}
      className={
        showLabel
          ? "flex h-9 items-center gap-1.5 rounded-lg border border-amber-500/25 bg-zinc-950/80 px-3 text-xs font-semibold text-amber-300 transition-all hover:border-amber-500/50 hover:bg-zinc-900 cursor-pointer shadow-sm"
          : "relative flex h-9 w-9 items-center justify-center rounded-lg border border-amber-500/25 bg-zinc-950/80 text-amber-400 transition-all hover:border-amber-500/50 hover:bg-zinc-900 hover:text-amber-300 cursor-pointer shadow-sm"
      }
    >
      {isDark ? (
        <Sun className="h-4 w-4 shrink-0 text-amber-400" />
      ) : (
        <Moon className="h-4 w-4 shrink-0 text-zinc-950" />
      )}
      {showLabel && <span>{label}</span>}
    </button>
  );
}
