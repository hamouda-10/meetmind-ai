export type ThemeId = "black-gold" | "pure-white" | "sky-blue";

/**
 * Accepts current ThemeId values plus legacy persisted values so existing
 * user sessions migrate cleanly without flashing or losing preferences.
 */
export type ThemeInput = ThemeId | "dark" | "dark-gold" | "light" | "ai-neon" | "system";

export const THEME_STORAGE_KEY = "meetmind-theme";
export const DEFAULT_THEME: ThemeId = "black-gold";

export interface ThemeMeta {
  id: ThemeId;
  /** Exact user-facing color name (identical across locales for clean branding) */
  label: "Black & Gold" | "Pure White" | "Sky Blue";
  descEn: string;
  descAr: string;
  isDarkSurface: boolean;
  metaThemeColor: string;
  /** Primary preview dot + supporting palette dots */
  dotColor: string;
  dotBorder: string;
  swatches: readonly [string, string, string];
}

export const THEME_OPTIONS: readonly ThemeMeta[] = [
  {
    id: "black-gold",
    label: "Black & Gold",
    descEn: "Matte black surfaces with signature gold highlights",
    descAr: "أسود مطفي فاخر بلمسات ذهبية مميزة (الافتراضي)",
    isDarkSurface: true,
    metaThemeColor: "#070709",
    dotColor: "#D4AF37",
    dotBorder: "#070709",
    swatches: ["#070709", "#D4AF37", "#F5D77F"],
  },
  {
    id: "pure-white",
    label: "Pure White",
    descEn: "Clean minimal white, black & neutral gray SaaS palette",
    descAr: "أبيض نقي وأسود ورمادي محايد بتصميم احترافي هادئ",
    isDarkSurface: false,
    metaThemeColor: "#FFFFFF",
    dotColor: "#FFFFFF",
    dotBorder: "#111111",
    swatches: ["#FFFFFF", "#F7F8FA", "#111111"],
  },
  {
    id: "sky-blue",
    label: "Sky Blue",
    descEn: "Fresh light sky blue, crisp white & cyan modern palette",
    descAr: "أزرق سماوي فاتح ومنعش مع أبيض ناصع وتدرجات سماوية",
    isDarkSurface: false,
    metaThemeColor: "#F4FAFF",
    dotColor: "#0284C7",
    dotBorder: "#BAE6FD",
    swatches: ["#F4FAFF", "#0284C7", "#38BDF8"],
  },
] as const;

export function normalizeTheme(value: string | null | undefined): ThemeId {
  if (value === "pure-white" || value === "light") return "pure-white";
  if (value === "sky-blue" || value === "ai-neon") return "sky-blue";
  // "black-gold", legacy "dark", "dark-gold", "system", or unknown -> default "black-gold"
  return DEFAULT_THEME;
}

export function getThemeMeta(theme: ThemeId): ThemeMeta {
  return THEME_OPTIONS.find((item) => item.id === theme) ?? THEME_OPTIONS[0];
}
