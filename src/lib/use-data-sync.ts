import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api-client";
import { useAuthStore } from "@/stores/auth-store";

const EVENT_QUERY_MAP: Record<string, string[][]> = {
  TranscriptSegmentAvailable: [["transcript"], ["recordingSessions"]],
  TranscriptFinal: [
    ["transcript"],
    ["meetings"],
    ["lectures"],
    ["jobs"],
    ["dashboardMetrics"],
    ["dashboard-metrics"],
  ],
  SummaryReady: [["meetings"], ["lectures"], ["transcript"], ["dashboardMetrics"]],
  SUMMARY_GENERATED: [["meetings"], ["lectures"], ["transcript"], ["dashboardMetrics"]],
  ANALYSIS_GENERATED: [["meetings"], ["lectures"], ["transcript"], ["dashboardMetrics"]],
  TasksReady: [["tasks"], ["actionItems"], ["dashboardMetrics"], ["dashboard-metrics"]],
  TASK_CREATED: [["tasks"], ["actionItems"], ["dashboardMetrics"]],
  TASK_UPDATED: [["tasks"], ["actionItems"], ["dashboardMetrics"]],
  TASK_DELETED: [["tasks"], ["actionItems"], ["dashboardMetrics"]],
  QUIZ_GENERATED: [["quizzes"], ["dashboardMetrics"], ["dashboard-metrics"]],
  QUIZ_READY: [["quizzes"], ["dashboardMetrics"]],
  QuizReady: [["quizzes"], ["dashboardMetrics"]],
  QUIZ_ATTEMPTED: [["quizzes"], ["dashboardMetrics"], ["dashboard-trends"]],
  FlashcardsReady: [["flashcards"], ["dashboardMetrics"]],
  FLASHCARDS_GENERATED: [["flashcards"], ["dashboardMetrics"]],
  MindMapReady: [["mindmaps"], ["mindMaps"]],
  MINDMAP_GENERATED: [["mindmaps"], ["mindMaps"]],
  JOB_PROGRESS: [["jobs"]],
  JOB_COMPLETED: [
    ["jobs"],
    ["meetings"],
    ["lectures"],
    ["transcript"],
    ["dashboardMetrics"],
    ["dashboard-metrics"],
    ["notifications"],
  ],
  JOB_FAILED: [["jobs"], ["meetings"], ["lectures"], ["notifications"]],
  NOTIFICATION_CREATED: [["notifications"]],
  NOTIFICATION_READ: [["notifications"]],
  MEETING_CREATED: [["meetings"], ["dashboardMetrics"], ["dashboard-metrics"]],
  MEETING_UPDATED: [["meetings"], ["transcript"]],
  MEETING_DELETED: [["meetings"], ["dashboardMetrics"], ["dashboard-metrics"], ["transcript"]],
  LECTURE_CREATED: [["lectures"], ["dashboardMetrics"], ["dashboard-metrics"]],
  LECTURE_UPDATED: [["lectures"], ["transcript"]],
  LECTURE_DELETED: [["lectures"], ["dashboardMetrics"], ["dashboard-metrics"], ["transcript"]],
  SESSION_STARTED: [["recordingSessions"]],
  SESSION_FINALIZED: [
    ["recordingSessions"],
    ["meetings"],
    ["lectures"],
    ["transcript"],
    ["jobs"],
    ["dashboardMetrics"],
  ],
};

const FALLBACK_KEYS: string[][] = [
  ["dashboardMetrics"],
  ["dashboard-metrics"],
  ["meetings"],
  ["lectures"],
  ["jobs"],
  ["notifications"],
];

export function useDataSync() {
  const queryClient = useQueryClient();
  const authStatus = useAuthStore((s) => s.status);
  const lastSyncTimestampRef = useRef<number>(0);

  useEffect(() => {
    const canSync = authStatus === "authenticated" || authStatus === "guest";
    if (!canSync) {
      return;
    }

    let es: EventSource | null = null;
    let fallbackInterval: ReturnType<typeof setInterval> | null = null;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    let isConnected = false;
    let isDisposed = false;
    const pendingKeys = new Map<string, string[]>();

    const flushInvalidations = () => {
      flushTimer = null;
      if (isDisposed || pendingKeys.size === 0) return;
      const keys = Array.from(pendingKeys.values());
      pendingKeys.clear();
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey });
      }
    };

    const handleSyncEvent = (eventData: { type: string; id?: string; timestamp?: number }) => {
      if (eventData.timestamp && eventData.timestamp <= lastSyncTimestampRef.current) {
        return;
      }
      if (eventData.timestamp) {
        lastSyncTimestampRef.current = eventData.timestamp;
      }

      const targetKeys = EVENT_QUERY_MAP[eventData.type] || FALLBACK_KEYS;
      for (const key of targetKeys) {
        pendingKeys.set(key.join(":"), key);
      }
      if (!flushTimer) {
        flushTimer = setTimeout(flushInvalidations, 120);
      }
    };

    // Defer SSE connection to let browser finish initial page load without keeping tab spinner active
    const initSSE = () => {
      if (isDisposed) return;
      try {
        es = new EventSource("/api/v1/sync/events", { withCredentials: true });

        es.onopen = () => {
          isConnected = true;
        };

        es.onmessage = (event) => {
          try {
            if (!event.data || event.data.startsWith(":")) return;
            const parsed = JSON.parse(event.data);
            handleSyncEvent(parsed);
          } catch {
            // ignore malformed message
          }
        };

        es.onerror = () => {
          isConnected = false;
        };
      } catch {
        isConnected = false;
      }
    };

    // Start SSE after 2.5s once initial paint and hydration have fully settled
    const startTimer = setTimeout(() => {
      if (typeof window !== "undefined" && "requestIdleCallback" in window) {
        (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(
          initSSE,
        );
      } else {
        initSSE();
      }
    }, 2500);

    // Resilient Polling Fallback if SSE drops or disconnects (only when active tab is visible)
    fallbackInterval = setInterval(async () => {
      if (isDisposed || isConnected) return;
      if (typeof document !== "undefined" && document.hidden) return;
      try {
        const status = await api.getSyncStatus();
        if (status.timestamp && status.timestamp > lastSyncTimestampRef.current) {
          handleSyncEvent(status);
        }
      } catch {
        // network issue or session expired
      }
    }, 6000);

    return () => {
      isDisposed = true;
      clearTimeout(startTimer);
      if (flushTimer) clearTimeout(flushTimer);
      if (es) es.close();
      if (fallbackInterval) clearInterval(fallbackInterval);
    };
  }, [queryClient, authStatus]);
}
