import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RouteSkeleton } from "@/components/common/route-skeleton";

const TranscriptView = lazy(() => import("@/views/transcript-view"));

export interface TranscriptSearch {
  id?: string;
  time?: string;
  tab?: "transcript" | "summary" | "quiz" | "analysis";
}

const VALID_TABS = new Set(["transcript", "summary", "quiz", "analysis"]);

export const Route = createFileRoute("/transcript")({
  validateSearch: (search: Record<string, unknown>): TranscriptSearch => {
    const id = typeof search.id === "string" && search.id.trim() ? search.id.trim() : undefined;
    const time =
      typeof search.time === "string" && search.time.trim()
        ? search.time.trim()
        : typeof search.time === "number" && Number.isFinite(search.time)
          ? String(search.time)
          : undefined;
    const rawTab = typeof search.tab === "string" ? search.tab.trim() : undefined;
    const tab = rawTab && VALID_TABS.has(rawTab) ? (rawTab as TranscriptSearch["tab"]) : undefined;
    return { id, time, tab };
  },
  head: () => ({ meta: [{ title: "التفريغ الصوتي الذكي · MeetMind AI" }] }),
  component: TranscriptRouteComponent,
});

function TranscriptRouteComponent() {
  return (
    <Suspense
      fallback={
        <RouteSkeleton
          eyebrow="AI Intelligence"
          title="التفريغ الصوتي الذكي"
          description="تفريغ دقيق فائق السرعة مع المزامنة الصوتية الكاملة وتحديد المتحدثين"
          cardsCount={4}
        />
      }
    >
      <TranscriptView />
    </Suspense>
  );
}
