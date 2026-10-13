import React from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { fmtDay } from "./format";

const SEARCH_CONFIG = {
  clicks: { label: "Clicks", color: "hsl(var(--chart-1))" },
  impressions: { label: "Impressions", color: "hsl(var(--chart-2))" },
};

const VISITS_CONFIG = {
  sessions: { label: "Sessions", color: "hsl(var(--chart-3))" },
  ai_sessions: { label: "AI-assistant visits", color: "hsl(var(--chart-1))" },
};

function Trend({ title, data, config, left, right }) {
  return (
    <div className="min-w-0 space-y-2">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      {data?.length ? (
        <ChartContainer config={config} className="aspect-auto h-56 w-full">
          <LineChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} />
            <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis yAxisId="left" tickLine={false} axisLine={false} width={40} allowDecimals={false} />
            <YAxis yAxisId="right" orientation="right" tickLine={false} axisLine={false} width={44} allowDecimals={false} />
            <ChartTooltip content={<ChartTooltipContent labelFormatter={(value) => fmtDay(value)} />} />
            <ChartLegend content={<ChartLegendContent />} />
            <Line yAxisId="left" dataKey={left} type="monotone" stroke={`var(--color-${left})`} strokeWidth={2} dot={false} />
            <Line yAxisId="right" dataKey={right} type="monotone" stroke={`var(--color-${right})`} strokeWidth={1.5} dot={false} />
          </LineChart>
        </ChartContainer>
      ) : (
        <p className="flex h-56 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          No data yet
        </p>
      )}
    </div>
  );
}

export default function TrendCharts({ summary }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <Trend
        title="Google Search (clicks left, impressions right)"
        data={summary.gsc?.series}
        config={SEARCH_CONFIG}
        left="clicks"
        right="impressions"
      />
      <Trend
        title="Site visits, GA4 (sessions left, AI-assistant visits right)"
        data={summary.traffic?.series}
        config={VISITS_CONFIG}
        left="sessions"
        right="ai_sessions"
      />
    </div>
  );
}
