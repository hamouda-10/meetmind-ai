import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Search as SearchIcon,
  Video,
  GraduationCap,
  CheckSquare,
  FileText,
  Clock,
  Loader2,
  X,
  ArrowRight,
  ArrowLeft,
} from "lucide-react";
import { PageHeader } from "@/components/common/page-header";
import { GlassCard } from "@/components/common/glass-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { api } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";

export default function SearchView() {
  const { isRtl } = useTranslation();
  const [searchTerm, setSearchTerm] = useState("roadmap");

  const { data: results, isLoading } = useQuery({
    queryKey: ["search", searchTerm],
    queryFn: () => api.search(searchTerm),
    enabled: searchTerm.length > 0,
  });

  const totalResults =
    (results?.meetings.length || 0) +
    (results?.lectures.length || 0) +
    (results?.tasks.length || 0) +
    (results?.transcripts.length || 0);

  const quickQueries = isRtl
    ? [
        "التسامح",
        "دار ابتلاء",
        "الصدق منجاة",
        "الآخرة",
        "الصفح الجميل",
        "الذكاء الاصطناعي",
        "خارطة طريق",
        "Raft",
        "latency",
        "roadmap",
      ]
    : [
        "roadmap",
        "latency",
        "Raft consensus",
        "machine learning",
        "database schema",
        "action items",
        "architecture",
        "sprint goal",
      ];

  const ArrowIcon = isRtl ? ArrowLeft : ArrowRight;

  return (
    <div className="space-y-6" dir={isRtl ? "rtl" : "ltr"}>
      <PageHeader
        eyebrow={isRtl ? "النظام" : "System"}
        title={isRtl ? "البحث الشامل" : "Global Search"}
        description={
          isRtl
            ? "بحث موحد ودقيق عبر كافة الاجتماعات والمحاضرات واقتباسات التفريغ الصوتي والمهام."
            : "Unified search across meetings, lectures, transcripts, and action items."
        }
      />

      <GlassCard className="p-5">
        <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background/60 px-3 py-2">
          <SearchIcon className="h-4 w-4 text-muted-foreground shrink-0" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={
              isRtl
                ? "ابحث في الاجتماعات، المحاضرات، اقتباسات النصوص، أو المهام..."
                : "Search meetings, lectures, transcript quotes, or tasks..."
            }
            className="h-9 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
          {searchTerm && (
            <button
              onClick={() => setSearchTerm("")}
              className="text-muted-foreground hover:text-foreground p-1 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {isRtl ? "استعلامات سريعة مقترحة:" : "Quick suggested queries:"}
          </span>
          {quickQueries.map((s) => (
            <button
              key={s}
              onClick={() => setSearchTerm(s)}
              className={`rounded-full border px-2.5 py-1 text-xs transition-colors cursor-pointer ${
                searchTerm === s
                  ? "border-primary bg-primary/10 text-primary font-medium"
                  : "border-border/60 bg-background/50 text-muted-foreground hover:text-foreground"
              }`}
            >
              {s}
            </button>
          ))}
        </div>
      </GlassCard>

      {isLoading ? (
        <div className="flex h-36 items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      ) : totalResults === 0 ? (
        <GlassCard className="p-8 text-center text-sm text-muted-foreground">
          {isRtl
            ? `لا توجد نتائج مطابقة لـ "${searchTerm}". جرب كلمة بحث أخرى أو تحقق من ملفاتك الصوتية.`
            : `No matching results for "${searchTerm}". Try a different keyword or upload more audio sessions.`}
        </GlassCard>
      ) : (
        <div className="space-y-6">
          {/* Transcript Matches */}
          {results?.transcripts && results.transcripts.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-primary flex items-center gap-1.5">
                <FileText className="h-4 w-4" />
                <span>
                  {isRtl
                    ? `نتائج من التفريغ الصوتي الفعلي (${results.transcripts.length})`
                    : `Verified Transcript Matches (${results.transcripts.length})`}
                </span>
              </h3>
              <div className="space-y-2">
                {results.transcripts.map((t, idx) => (
                  <GlassCard key={idx} className="p-4 space-y-1">
                    <div className="flex items-center justify-between text-xs text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <Badge variant="outline" className="text-[10px] uppercase">
                          {t.type === "lecture"
                            ? isRtl
                              ? "محاضرة"
                              : "Lecture"
                            : isRtl
                              ? "اجتماع"
                              : "Meeting"}
                        </Badge>
                        <span className="font-medium text-foreground">{t.title}</span>
                      </div>
                      <span className="flex items-center gap-1 font-mono text-primary">
                        <Clock className="h-3 w-3" /> {Math.floor(t.time / 60)}:
                        {(t.time % 60).toString().padStart(2, "0")}
                      </span>
                    </div>
                    <p className="text-sm italic text-foreground/90">&quot;{t.quote}&quot;</p>
                    <div className="pt-1 flex justify-end">
                      <a
                        href={`/transcript?id=${encodeURIComponent(t.id)}&time=${encodeURIComponent(t.time)}`}
                        className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                      >
                        <span>
                          {isRtl ? "عرض في السياق والاستماع" : "Seek in transcript & listen"}
                        </span>
                        <ArrowIcon className="h-3.5 w-3.5" />
                      </a>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Meeting Matches */}
          {results?.meetings && results.meetings.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-foreground flex items-center gap-1.5">
                <Video className="h-4 w-4 text-primary" />
                <span>
                  {isRtl
                    ? `الاجتماعات المطابقة (${results.meetings.length})`
                    : `Matching Meetings (${results.meetings.length})`}
                </span>
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {results.meetings.map((m) => (
                  <GlassCard key={m.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="font-medium text-sm">{m.title}</div>
                      <Badge variant="outline" className="text-[10px]">
                        {m.date}
                      </Badge>
                    </div>
                    {m.summary && (
                      <p className="mt-2 text-xs text-muted-foreground line-clamp-2">{m.summary}</p>
                    )}
                    <div className="mt-3">
                      <Link to="/meetings">
                        <Button size="sm" variant="outline" className="w-full text-xs">
                          {isRtl ? "فتح تفاصيل الاجتماع" : "Open Meeting"}
                        </Button>
                      </Link>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Lecture Matches */}
          {results?.lectures && results.lectures.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-foreground flex items-center gap-1.5">
                <GraduationCap className="h-4 w-4 text-accent-cyan" />
                <span>
                  {isRtl
                    ? `المحاضرات المطابقة (${results.lectures.length})`
                    : `Matching Lectures (${results.lectures.length})`}
                </span>
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {results.lectures.map((l) => (
                  <GlassCard key={l.id} className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="font-medium text-sm">
                        {l.courseCode} — {l.title}
                      </div>
                      <Badge variant="outline" className="text-[10px]">
                        {l.date}
                      </Badge>
                    </div>
                    {l.studyNotes && (
                      <p className="mt-2 text-xs text-muted-foreground line-clamp-2">
                        {l.studyNotes}
                      </p>
                    )}
                    <div className="mt-3">
                      <Link to="/lectures">
                        <Button size="sm" variant="outline" className="w-full text-xs">
                          {isRtl ? "فتح ملاحظات المحاضرة" : "Open Lecture Notes"}
                        </Button>
                      </Link>
                    </div>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}

          {/* Task Matches */}
          {results?.tasks && results.tasks.length > 0 && (
            <div className="space-y-3">
              <h3 className="font-display text-sm font-semibold text-foreground flex items-center gap-1.5">
                <CheckSquare className="h-4 w-4 text-success" />
                <span>
                  {isRtl
                    ? `المهام المطابقة (${results.tasks.length})`
                    : `Matching Action Items (${results.tasks.length})`}
                </span>
              </h3>
              <div className="space-y-2">
                {results.tasks.map((t) => (
                  <GlassCard key={t.id} className="p-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-medium">{t.title}</div>
                    <Badge variant="secondary" className="capitalize text-[10px]">
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
                    </Badge>
                  </GlassCard>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
