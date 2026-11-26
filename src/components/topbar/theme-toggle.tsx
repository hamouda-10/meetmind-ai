import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { useUIStore } from "@/stores/ui-store";
import { useTranslation } from "@/lib/i18n";
import { THEME_OPTIONS, getThemeMeta, type ThemeId } from "@/lib/theme";
import { cn } from "@/lib/utils";

function ColorSwatchDot({
  dotColor,
  dotBorder,
  active = false,
}: {
  dotColor: string;
  dotBorder: string;
  active?: boolean;
}) {
  return (
    <span
      data-theme-swatch="true"
      aria-hidden="true"
      className={cn(
        "inline-block h-3.5 w-3.5 shrink-0 rounded-full border-2 transition-transform",
        active && "scale-110",
      )}
      style={{
        backgroundColor: dotColor,
        borderColor: dotBorder,
      }}
    />
  );
}

export function ThemeToggle({ showLabel = false }: { showLabel?: boolean }) {
  const resolved = useUIStore((s) => s.resolvedTheme);
  const setTheme = useUIStore((s) => s.setTheme);
  const { language, isRtl } = useTranslation();
  const isAr = language === "AR";

  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const currentMeta = getThemeMeta(resolved);
  const buttonTitle = isAr
    ? `تغيير ألوان الموقع (الحالي: ${currentMeta.label})`
    : `Switch color theme (Current: ${currentMeta.label})`;

  const handleSelect = (nextTheme: ThemeId) => {
    setTheme(nextTheme);
    setOpen(false);
  };

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={buttonTitle}
        title={buttonTitle}
        data-theme-switcher-trigger="true"
        className={cn(
          "flex h-9 items-center justify-center gap-2 rounded-lg border border-amber-500/25 bg-zinc-950/80 text-amber-400 transition-all hover:border-amber-500/50 hover:bg-zinc-900 hover:text-amber-300 cursor-pointer shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
          showLabel ? "px-2.5 sm:px-3 text-xs font-semibold" : "w-9 sm:w-auto sm:px-2.5",
        )}
      >
        <ColorSwatchDot dotColor={currentMeta.dotColor} dotBorder={currentMeta.dotBorder} active />
        <span
          className={cn(
            "text-xs font-semibold whitespace-nowrap",
            showLabel ? "inline" : "hidden xl:inline",
          )}
        >
          {currentMeta.label}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 opacity-75 transition-transform duration-150",
            showLabel ? "inline" : "hidden sm:inline",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <div
          role="menu"
          aria-label={isAr ? "اختيار ألوان الموقع" : "Choose color theme"}
          dir={isRtl ? "rtl" : "ltr"}
          className={cn(
            "theme-switcher-menu absolute mt-2 w-60 rounded-xl border border-border bg-popover p-1.5 shadow-2xl backdrop-blur-xl z-50",
            isRtl ? "left-0" : "right-0",
          )}
        >
          <div className="px-2.5 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground">
            {isAr ? "ألوان المنصة" : "Color Theme"}
          </div>
          <div className="space-y-1">
            {THEME_OPTIONS.map((opt) => {
              const active = resolved === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  role="menuitemradio"
                  aria-checked={active}
                  data-theme-option={opt.id}
                  onClick={() => handleSelect(opt.id)}
                  className={cn(
                    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-start transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    active
                      ? "bg-primary/12 text-foreground ring-1 ring-primary/40"
                      : "text-foreground/85 hover:bg-secondary hover:text-foreground",
                  )}
                >
                  <ColorSwatchDot
                    dotColor={opt.dotColor}
                    dotBorder={opt.dotBorder}
                    active={active}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2 text-xs font-semibold">
                      <span className="truncate">{opt.label}</span>
                      <span className="inline-flex items-center gap-1" aria-hidden="true">
                        {opt.swatches.map((hex, i) => (
                          <span
                            key={i}
                            data-theme-swatch="true"
                            className="h-2.5 w-2.5 rounded-full border border-black/15"
                            style={{ backgroundColor: hex }}
                          />
                        ))}
                      </span>
                    </span>
                  </span>
                  {active && <Check className="h-3.5 w-3.5 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
