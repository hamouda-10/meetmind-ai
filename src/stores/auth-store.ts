import { create } from "zustand";
import { api, type AuthUser } from "@/lib/api-client";

export type AuthStatus =
  "loading" | "authenticated" | "guest" | "unauthenticated" | "session_expired";

const TOKEN_STORAGE_KEY = "meetmind_token";

function persistAccessToken(token: string, rememberMe: boolean): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
    if (rememberMe) {
      localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      sessionStorage.setItem(TOKEN_STORAGE_KEY, token);
    }
  } catch {
    // storage may be restricted; HttpOnly cookie still maintains session
  }
}

export function clearStoredAccessToken(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
    sessionStorage.removeItem(TOKEN_STORAGE_KEY);
  } catch {
    // ignore storage errors
  }
}

export function getStoredAccessToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(TOKEN_STORAGE_KEY) || sessionStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface AuthState {
  status: AuthStatus;
  user: AuthUser | null;
  initialized: boolean;
  sessionNotice: string | null;

  restoreSession: () => Promise<void>;
  login: (params: { email: string; password: string; rememberMe?: boolean }) => Promise<AuthUser>;
  register: (params: {
    name: string;
    email: string;
    password: string;
    confirmPassword: string;
    department?: string;
  }) => Promise<AuthUser>;
  loginAsGuest: () => Promise<AuthUser>;
  logout: () => Promise<void>;
  setUser: (user: AuthUser) => void;
  handleSessionExpired: (message?: string) => void;
  clearSessionNotice: () => void;
}

let restoreInFlight: Promise<void> | null = null;

export const useAuthStore = create<AuthState>((set, get) => ({
  status: "loading",
  user: null,
  initialized: false,
  sessionNotice: null,

  restoreSession: async () => {
    const currentStatus = get().status;
    if (currentStatus === "authenticated" || currentStatus === "guest") {
      return;
    }
    if (restoreInFlight) return restoreInFlight;

    restoreInFlight = (async () => {
      try {
        const user = await api.authMe();
        set((state) => {
          if (state.status === "authenticated" && !state.user?.isGuest && user.isGuest) {
            return state;
          }
          return {
            user,
            status: user.isGuest ? "guest" : "authenticated",
            initialized: true,
            sessionNotice: null,
          };
        });
      } catch {
        // Attempt silent refresh using HttpOnly refresh cookie before concluding unauthenticated
        try {
          const refreshed = await api.authRefresh();
          if (refreshed?.token && refreshed?.user) {
            const hadLocalToken =
              typeof window !== "undefined" && Boolean(localStorage.getItem(TOKEN_STORAGE_KEY));
            const shouldPersist =
              typeof refreshed.rememberMe === "boolean" ? refreshed.rememberMe : hadLocalToken;
            persistAccessToken(refreshed.token, shouldPersist && !refreshed.user.isGuest);
            set((state) => {
              if (
                state.status === "authenticated" &&
                !state.user?.isGuest &&
                refreshed.user.isGuest
              ) {
                return state;
              }
              return {
                user: refreshed.user,
                status: refreshed.user.isGuest ? "guest" : "authenticated",
                initialized: true,
                sessionNotice: null,
              };
            });
            return;
          }
        } catch {
          // refresh cookie missing or expired
        }

        set((state) => {
          if (state.status === "authenticated" || state.status === "guest") {
            // Concurrent login or guest session succeeded while restore was in flight
            return state;
          }
          const hadToken = Boolean(getStoredAccessToken());
          clearStoredAccessToken();
          return {
            user: null,
            status: hadToken ? "session_expired" : "unauthenticated",
            initialized: true,
            sessionNotice: hadToken ? "Your session expired. Please sign in again." : null,
          };
        });
      } finally {
        restoreInFlight = null;
      }
    })();

    return restoreInFlight;
  },

  login: async ({ email, password, rememberMe = false }) => {
    const res = await api.authLogin({ email, password, rememberMe });
    persistAccessToken(res.token, rememberMe);
    set({
      user: res.user,
      status: res.user.isGuest ? "guest" : "authenticated",
      initialized: true,
      sessionNotice: null,
    });
    return res.user;
  },

  register: async ({ name, email, password, confirmPassword, department }) => {
    const res = await api.authRegister({
      name,
      email,
      password,
      confirmPassword,
      department,
    });
    persistAccessToken(res.token, true);
    set({
      user: res.user,
      status: "authenticated",
      initialized: true,
      sessionNotice: null,
    });
    return res.user;
  },

  loginAsGuest: async () => {
    const res = await api.authGuest();
    persistAccessToken(res.token, false);
    set({
      user: res.user,
      status: "guest",
      initialized: true,
      sessionNotice: null,
    });
    return res.user;
  },

  logout: async () => {
    try {
      await api.authLogout();
    } catch {
      // always clear local state even if network fails
    } finally {
      clearStoredAccessToken();
      set({
        user: null,
        status: "unauthenticated",
        initialized: true,
        sessionNotice: null,
      });
    }
  },

  setUser: (user: AuthUser) => {
    set((state) => ({
      user,
      status: user.isGuest ? "guest" : state.status === "guest" ? "guest" : "authenticated",
    }));
  },

  handleSessionExpired: (message) => {
    const currentStatus = get().status;
    clearStoredAccessToken();
    if (currentStatus === "unauthenticated") return;
    set({
      user: null,
      status: "session_expired",
      initialized: true,
      sessionNotice: message || "Your session expired. Please sign in again.",
    });
  },

  clearSessionNotice: () => set({ sessionNotice: null }),
}));
