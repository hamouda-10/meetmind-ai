import { create } from "zustand";
import { useI18nStore, type LanguageCode } from "@/lib/i18n";
import {
  DEFAULT_THEME,
  THEME_STORAGE_KEY,
  getThemeMeta,
  normalizeTheme,
  type ThemeId,
  type ThemeInput,
} from "@/lib/theme";

export type Theme = ThemeInput;
export type ResolvedTheme = ThemeId;
export { THEME_STORAGE_KEY };

export type AudioSystemMode =
  | "Ready"
  | "Listening"
  | "Recording"
  | "Uploading"
  | "Processing"
  | "Transcribing"
  | "Analyzing"
  | "Completed";

/**
 * High-frequency mutable telemetry object read directly by Canvas/WebGL requestAnimationFrame loops
 * without triggering React component re-renders on every frame (60fps zero-lag architecture).
 */
export const liveAudioTelemetry = {
  active: false,
  rms: 0, // 0.0 to 1.0 normalized root-mean-square amplitude
  peak: 0, // 0.0 to 1.0 peak amplitude
  bands: new Float32Array(32), // 32 normalized frequency bins (0.0 to 1.0)
  waveform: new Float32Array(64), // 64 normalized time-domain samples (-1.0 to 1.0)
  updatedAt: 0,
};

export function resetLiveAudioTelemetry() {
  liveAudioTelemetry.active = false;
  liveAudioTelemetry.rms = 0;
  liveAudioTelemetry.peak = 0;
  liveAudioTelemetry.bands.fill(0);
  liveAudioTelemetry.waveform.fill(0);
  liveAudioTelemetry.updatedAt = Date.now();
}

type UIState = {
  sidebarCollapsed: boolean;
  mobileSidebarOpen: boolean;
  commandOpen: boolean;
  notificationsOpen: boolean;
  aiDockOpen: boolean;
  theme: ThemeId;
  resolvedTheme: ResolvedTheme;
  hydrateTheme: () => void;
  recordingDialogOpen: boolean;
  setRecordingDialogOpen: (v: boolean) => void;
  audioSystemMode: AudioSystemMode;
  audioJobProgress: number;
  setAudioSystemState: (mode: AudioSystemMode, progress?: number) => void;
  language: string;
  hydrateLanguage: () => void;
  workspace: string;
  setSidebarCollapsed: (v: boolean) => void;
  toggleSidebar: () => void;
  setMobileSidebarOpen: (v: boolean) => void;
  setCommandOpen: (v: boolean) => void;
  toggleCommand: () => void;
  setNotificationsOpen: (v: boolean) => void;
  setAiDockOpen: (v: boolean) => void;
  toggleAiDock: () => void;
  setTheme: (t: Theme) => void;
  setLanguage: (l: string) => void;
  setWorkspace: (w: string) => void;
};

function resolve(t: Theme): ResolvedTheme {
  return normalizeTheme(t);
}

function applyTheme(resolved: ResolvedTheme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  const isBlackGold = resolved === "black-gold";
  const isPureWhite = resolved === "pure-white";
  const isSkyBlue = resolved === "sky-blue";

  root.classList.toggle("dark", isBlackGold);
  root.classList.toggle("light", !isBlackGold);
  root.classList.toggle("theme-black-gold", isBlackGold);
  root.classList.toggle("theme-pure-white", isPureWhite);
  root.classList.toggle("theme-sky-blue", isSkyBlue);
  root.classList.remove("theme-dark-gold", "theme-light", "theme-ai-neon");
  root.dataset.theme = resolved;

  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) {
    meta.setAttribute("content", getThemeMeta(resolved).metaThemeColor);
  }
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  mobileSidebarOpen: false,
  commandOpen: false,
  notificationsOpen: false,
  aiDockOpen: false,
  theme: DEFAULT_THEME,
  resolvedTheme: DEFAULT_THEME,
  hydrateTheme: () => {
    let stored: ResolvedTheme = DEFAULT_THEME;
    try {
      const v = localStorage.getItem(THEME_STORAGE_KEY);
      if (v) stored = normalizeTheme(v);
    } catch {
      /* storage unavailable */
    }
    applyTheme(stored);
    set({ theme: stored, resolvedTheme: stored });
  },
  recordingDialogOpen: false,
  setRecordingDialogOpen: (v) => set({ recordingDialogOpen: v }),
  audioSystemMode: "Ready",
  audioJobProgress: 0,
  setAudioSystemState: (mode, progress) =>
    set((s) => ({
      audioSystemMode: mode,
      audioJobProgress: progress !== undefined ? progress : s.audioJobProgress,
    })),
  language: "EN",
  hydrateLanguage: () => {
    try {
      if (typeof window === "undefined") return;
      const stored = localStorage.getItem("meetmind-lang");
      if (stored === "AR" || stored === "EN") {
        set({ language: stored });
        useI18nStore.getState().setLanguage(stored as LanguageCode);
        if (typeof document !== "undefined") {
          document.documentElement.dir = stored === "AR" ? "rtl" : "ltr";
          document.documentElement.lang = stored === "AR" ? "ar" : "en";
        }
      }
    } catch {
      /* ignore */
    }
  },
  workspace: "Acme University",
  setSidebarCollapsed: (v) => set({ sidebarCollapsed: v }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  setMobileSidebarOpen: (v) => set({ mobileSidebarOpen: v }),
  setCommandOpen: (v) => set({ commandOpen: v }),
  toggleCommand: () => set((s) => ({ commandOpen: !s.commandOpen })),
  setNotificationsOpen: (v) => set({ notificationsOpen: v }),
  setAiDockOpen: (v) => set({ aiDockOpen: v }),
  toggleAiDock: () => set((s) => ({ aiDockOpen: !s.aiDockOpen })),
  setTheme: (theme) => {
    const resolvedTheme = resolve(theme);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, resolvedTheme);
    } catch {
      /* storage unavailable */
    }
    applyTheme(resolvedTheme);
    set({ theme: resolvedTheme, resolvedTheme });
  },
  setLanguage: (language) => {
    const code = (language === "AR" ? "AR" : "EN") as LanguageCode;
    try {
      localStorage.setItem("meetmind-lang", code);
    } catch {
      /* ignore */
    }
    if (typeof document !== "undefined") {
      document.documentElement.dir = code === "AR" ? "rtl" : "ltr";
      document.documentElement.lang = code === "AR" ? "ar" : "en";
    }
    useI18nStore.getState().setLanguage(code);
    set({ language: code });
  },
  setWorkspace: (workspace) => set({ workspace }),
}));
