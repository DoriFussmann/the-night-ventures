import React from "react";
import { Bar, CartesianGrid, ComposedChart, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtDay, fmtNum, fmtPct } from "./format";

const SEARCH_CONFIG = {
  clicks: { label: "Clicks", color: "hsl(var(--chart-1))" },
  impressions: { label: "Impressions", color: "hsl(var(--chart-2))" },
};

const VISITS_CONFIG = {
  sessions: { label: "Sessions", color: "hsl(var(--chart-3))" },
  ai_sessions: { label: "AI-assistant visits", color: "hsl(var(--chart-1))" },
};

const AI_CONFIG = {
  ai_search: { label: "AI search crawlers", color: "hsl(var(--chart-1))" },
  ai_user: { label: "Live AI fetches", color: "hsl(var(--chart-2))" },
  ai_training: { label: "AI training crawlers", color: "hsl(var(--chart-4))" },
  cited: { label: "Keywords cited in AI Overviews", color: "hsl(var(--chart-3))" },
};

const ENGAGEMENT_CONFIG = {
  organic_rate: { label: "Organic search", color: "hsl(var(--chart-2))" },
  ai_rate: { label: "AI assistants", color: "hsl(var(--chart-1))" },
  direct_rate: { label: "Direct", color: "hsl(var(--chart-4))" },
};

function bucketLabel(granularity) {
  return (value) => (granularity === "week" ? `Week of ${fmtDay(value)}` : fmtDay(value));
}

/** Tooltip row that also shows zero values (the default hides them). */
function rowFormatter(config, format) {
  return function formatRow(value, name, item) {
    const label = config[name]?.label || name;
    const color = item?.color || item?.payload?.fill;
    return (
      <div className="flex w-full items-center gap-2">
        <span className="h-2.5 w-2.5 shrink-0 rounded-[2px]" style={{ backgroundColor: color }} aria-hidden="true" />
        <span className="flex-1 text-muted-foreground">{label}</span>
        <span className="font-mono font-medium tabular-nums text-foreground">{format(value, item?.payload, name)}</span>
      </div>
    );
  };
}

function ChartCard({ title, note, children }) {
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border p-3">
      <div>
        <p className="text-xs font-medium">{title}</p>
        {note ? <p className="text-[11px] text-muted-foreground">{note}</p> : null}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }) {
  return (
    <p className="flex h-56 items-center justify-center rounded-md border border-dashed border-border px-4 text-center text-xs text-muted-foreground">
      {children}
    </p>
  );
}

function TwoLineChart({ data, config, left, right, granularity }) {
  return (
    <ChartContainer config={config} className="aspect-auto h-56 w-full">
      <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={44} allowDecimals={false} />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => bucketLabel(granularity)(payload?.[0]?.payload?.date)}
              formatter={rowFormatter(config, (v) => fmtNum(v))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1" />} />
        <Line yAxisId="left" dataKey={left} type="monotone" stroke={`var(--color-${left})`} strokeWidth={2} dot={false} />
        <Line yAxisId="right" dataKey={right} type="monotone" stroke={`var(--color-${right})`} strokeWidth={1.5} dot={false} />
      </LineChart>
    </ChartContainer>
  );
}

function hasValues(data, keys) {
  return (data || []).some((p) => keys.some((k) => Number(p[k]) > 0));
}

function AiVisibilityChart({ bots, granularity }) {
  const data = bots?.series || [];
  const hasCrawlers = hasValues(data, ["ai_search", "ai_user", "ai_training"]);
  const hasChecks = data.some((p) => p.checked != null);
  const maxChecked = Math.max(0, ...data.map((p) => Number(p.checked) || 0));
  if (!hasCrawlers && !hasChecks) {
    return (
      <Empty>
        {bots?.installed
          ? "No AI crawler visits or AI Overview checks in this period."
          : "Install AI crawler tracking (Setup, below) and run Check AI now to fill this chart."}
      </Empty>
    );
  }
  const format = (value, payload, name) => {
    if (value == null) return "—";
    return name === "cited" && payload?.checked != null ? `${value} of ${payload.checked}` : fmtNum(value);
  };
  return (
    <ChartContainer config={AI_CONFIG} className="aspect-auto h-56 w-full">
      <ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis yAxisId="left" tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <YAxis
          yAxisId="right"
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={32}
          allowDecimals={false}
          domain={[0, maxChecked || "auto"]}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => bucketLabel(granularity)(payload?.[0]?.payload?.date)}
              formatter={rowFormatter(AI_CONFIG, format)}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1" />} />
        <Bar yAxisId="left" dataKey="ai_search" stackId="crawlers" fill="var(--color-ai_search)" />
        <Bar yAxisId="left" dataKey="ai_user" stackId="crawlers" fill="var(--color-ai_user)" />
        <Bar yAxisId="left" dataKey="ai_training" stackId="crawlers" fill="var(--color-ai_training)" radius={[2, 2, 0, 0]} />
        <Line
          yAxisId="right"
          dataKey="cited"
          type="monotone"
          stroke="var(--color-cited)"
          strokeWidth={2}
          connectNulls
          dot={{ r: 3 }}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function EngagementChart({ traffic, granularity }) {
  const data = traffic?.series || [];
  if (!hasValues(data, ["organic", "ai", "direct"])) {
    return <Empty>{traffic ? "No visits in this period." : "Needs GA4 — see Setup."}</Empty>;
  }
  return (
    <ChartContainer config={ENGAGEMENT_CONFIG} className="aspect-auto h-56 w-full">
      <LineChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis
          tickLine={false}
          axisLine={false}
          width={40}
          domain={[0, 1]}
          ticks={[0, 0.25, 0.5, 0.75, 1]}
          tickFormatter={(v) => fmtPct(v, 0)}
        />
        <ChartTooltip
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => bucketLabel(granularity)(payload?.[0]?.payload?.date)}
              formatter={rowFormatter(ENGAGEMENT_CONFIG, (v) => fmtPct(v, 0))}
            />
          }
        />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1" />} />
        {Object.keys(ENGAGEMENT_CONFIG).map((key) => (
          <Line
            key={key}
            dataKey={key}
            type="linear"
            stroke={`var(--color-${key})`}
            strokeWidth={2}
            dot={granularity === "week" ? { r: 2 } : false}
          />
        ))}
      </LineChart>
    </ChartContainer>
  );
}

export default function TrendCharts({ summary }) {
  const { gsc, traffic, bots, granularity } = summary;
  const per = granularity === "week" ? "Weekly" : "Daily";
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ChartCard title="Google Search" note={`${per} clicks (left) and impressions (right).`}>
        {gsc?.series?.length ? (
          <TwoLineChart data={gsc.series} config={SEARCH_CONFIG} left="clicks" right="impressions" granularity={granularity} />
        ) : (
          <Empty>Connect Search Console — see Setup.</Empty>
        )}
      </ChartCard>
      <ChartCard title="Visits (GA4)" note={`${per} sessions (left) and AI-assistant visits (right).`}>
        {traffic?.series?.length ? (
          <TwoLineChart data={traffic.series} config={VISITS_CONFIG} left="sessions" right="ai_sessions" granularity={granularity} />
        ) : (
          <Empty>Needs GA4 — see Setup.</Empty>
        )}
      </ChartCard>
      <ChartCard
        title="AI visibility"
        note={`${per} AI crawler visits (bars) and core keywords cited in Google AI Overviews (line, weekly check).${
          bots?.seriesPartial ? " Partial: very high crawler volume." : ""
        }`}
      >
        <AiVisibilityChart bots={bots} granularity={granularity} />
      </ChartCard>
      <ChartCard title="Engagement" note={`${per} share of visits that engaged, by source (GA4).`}>
        <EngagementChart traffic={traffic} granularity={granularity} />
      </ChartCard>
    </div>
  );
}
