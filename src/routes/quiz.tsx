import { lazy, Suspense } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { RouteSkeleton } from "@/components/common/route-skeleton";

const QuizView = lazy(() => import("@/views/quiz-view"));

export interface QuizSearch {
  id?: string;
  lectureId?: string;
  quizId?: string;
}

export const Route = createFileRoute("/quiz")({
  validateSearch: (search: Record<string, unknown>): QuizSearch => ({
    id: typeof search.id === "string" && search.id.trim() ? search.id.trim() : undefined,
    lectureId:
      typeof search.lectureId === "string" && search.lectureId.trim()
        ? search.lectureId.trim()
        : undefined,
    quizId:
      typeof search.quizId === "string" && search.quizId.trim() ? search.quizId.trim() : undefined,
  }),
  head: () => ({ meta: [{ title: "الاختبارات الذكية والتقييم الأكاديمي · MeetMind AI" }] }),
  component: QuizRouteComponent,
});

function QuizRouteComponent() {
  return (
    <Suspense
      fallback={
        <RouteSkeleton
          eyebrow="Evaluation & Testing"
          title="الاختبارات الذكية والتقييم الأكاديمي"
          description="توليد تلقائي للاختبارات التفاعلية مع التصحيح الفوري وتتبع التقدم"
          cardsCount={3}
        />
      }
    >
      <QuizView />
    </Suspense>
  );
}
