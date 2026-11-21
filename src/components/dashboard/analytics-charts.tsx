import { useQuery } from "@tanstack/react-query";
import { GlassCard } from "@/components/common/glass-card";
import { SectionHeader } from "@/components/common/section-header";
import { api, DashboardTrends } from "@/lib/api-client";
import { useTranslation } from "@/lib/i18n";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const tooltipStyle = {
  backgroundColor: "var(--color-popover)",
  border: "1px solid var(--color-border)",
  borderRadius: 10,
  fontSize: 12,
  boxShadow: "var(--shadow-elegant)",
};

const EMPTY_WEEKLY = [
  { day: "Mon", meetings: 0, lectures: 0 },
  { day: "Tue", meetings: 0, lectures: 0 },
  { day: "Wed", meetings: 0, lectures: 0 },
  { day: "Thu", meetings: 0, lectures: 0 },
  { day: "Fri", meetings: 0, lectures: 0 },
  { day: "Sat", meetings: 0, lectures: 0 },
  { day: "Sun", meetings: 0, lectures: 0 },
];

const AR_DAY_MAP: Record<string, string> = {
  Mon: "الإثنين",
  Tue: "الثلاثاء",
  Wed: "الأربعاء",
  Thu: "الخميس",
  Fri: "الجمعة",
  Sat: "السبت",
  Sun: "الأحد",
};

const EMPTY_TREND = [
  { m: "W1", value: 0 },
  { m: "W2", value: 0 },
  { m: "W3", value: 0 },
  { m: "W4", value: 0 },
];

const AR_WEEK_MAP: Record<string, string> = {
  W1: "أ1",
  W2: "أ2",
  W3: "أ3",
  W4: "أ4",
};

export function WeeklyAnalytics() {
  const { isRtl } = useTranslation();
  const { data: trends } = useQuery<DashboardTrends>({
    queryKey: ["dashboard-trends"],
    queryFn: () => api.getDashboardTrends(),
  });

  const rawWeekly = trends?.weekly || EMPTY_WEEKLY;
  const weeklyData = isRtl
    ? rawWeekly.map((item) => ({ ...item, day: AR_DAY_MAP[item.day] || item.day }))
    : rawWeekly;

  return (
    <GlassCard className="p-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader
        title={isRtl ? "التحليلات الأسبوعية" : "Weekly analytics"}
        description={isRtl ? "الاجتماعات والمحاضرات هذا الأسبوع" : "Meetings & lectures this week"}
      />
      <div className="h-56 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={weeklyData} barGap={4} barCategoryGap="24%">
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="day"
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={26}
            />
            <Tooltip
              cursor={{ fill: "var(--color-accent)", opacity: 0.4 }}
              contentStyle={tooltipStyle}
            />
            <Bar dataKey="meetings" fill="var(--color-chart-1)" radius={[6, 6, 0, 0]} />
            <Bar dataKey="lectures" fill="var(--color-chart-2)" radius={[6, 6, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

export function MeetingAnalytics() {
  const { isRtl } = useTranslation();
  const { data: trends } = useQuery<DashboardTrends>({
    queryKey: ["dashboard-trends"],
    queryFn: () => api.getDashboardTrends(),
  });

  const rawTrend = trends?.meetingTrend || EMPTY_TREND;
  const trendData = isRtl
    ? rawTrend.map((item) => ({ ...item, m: AR_WEEK_MAP[item.m] || item.m }))
    : rawTrend;

  return (
    <GlassCard className="p-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader
        title={isRtl ? "معدل الاجتماعات" : "Meeting trend"}
        description={isRtl ? "وتيرة التسجيل الحديثة" : "Recent recording cadence"}
      />
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={trendData}>
            <defs>
              <linearGradient id="m1" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor="var(--color-chart-1)" stopOpacity={0.6} />
                <stop offset="100%" stopColor="var(--color-chart-1)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="m"
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={26}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Area
              type="monotone"
              dataKey="value"
              stroke="var(--color-chart-1)"
              strokeWidth={2.4}
              fill="url(#m1)"
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}

export function LectureAnalytics() {
  const { isRtl } = useTranslation();
  const { data: trends } = useQuery<DashboardTrends>({
    queryKey: ["dashboard-trends"],
    queryFn: () => api.getDashboardTrends(),
  });

  const rawTrend = trends?.lectureTrend || EMPTY_TREND;
  const lectureTrendData = isRtl
    ? rawTrend.map((item) => ({ ...item, m: AR_WEEK_MAP[item.m] || item.m }))
    : rawTrend;

  return (
    <GlassCard className="p-5" dir={isRtl ? "rtl" : "ltr"}>
      <SectionHeader
        title={isRtl ? "معدل المحاضرات" : "Lecture trend"}
        description={isRtl ? "الوتيرة الأكاديمية الحديثة" : "Recent academic cadence"}
      />
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={lectureTrendData}>
            <CartesianGrid vertical={false} stroke="var(--color-border)" strokeDasharray="3 3" />
            <XAxis
              dataKey="m"
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              allowDecimals={false}
              stroke="var(--color-muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              width={26}
            />
            <Tooltip contentStyle={tooltipStyle} />
            <Line
              type="monotone"
              dataKey="value"
              stroke="var(--color-chart-2)"
              strokeWidth={2.4}
              dot={false}
              activeDot={{ r: 5 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </GlassCard>
  );
}
