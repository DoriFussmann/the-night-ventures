import React from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ChartContainer, ChartLegend, ChartLegendContent, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { DataTable, Delta } from "./parts";
import { fmtDay, fmtNum, fmtPct } from "./format";

const GROUP_CONFIG = {
  organic: { label: "Organic search", color: "hsl(var(--chart-2))" },
  ai: { label: "AI assistants", color: "hsl(var(--chart-1))" },
  direct: { label: "Direct", color: "hsl(var(--chart-4))" },
  referral: { label: "Referral", color: "hsl(var(--chart-3))" },
  social: { label: "Social", color: "hsl(var(--chart-5))" },
  other: { label: "Other", color: "hsl(var(--muted-foreground))" },
};

function ShareBar({ value }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <div className="h-1.5 w-full min-w-[60px] rounded bg-muted" aria-hidden="true">
      <div className="h-1.5 rounded bg-primary" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function change(current, previous) {
  return previous > 0 ? (current - previous) / previous : null;
}

function SourcesOverTime({ traffic, granularity }) {
  const label = (_, payload) => {
    const date = payload?.[0]?.payload?.date;
    return granularity === "week" ? `Week of ${fmtDay(date)}` : fmtDay(date);
  };
  return (
    <ChartContainer config={GROUP_CONFIG} className="aspect-auto h-64 w-full">
      <AreaChart data={traffic.series} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} />
        <XAxis dataKey="date" tickFormatter={fmtDay} tickLine={false} axisLine={false} minTickGap={24} />
        <YAxis tickLine={false} axisLine={false} width={40} allowDecimals={false} />
        <ChartTooltip content={<ChartTooltipContent labelFormatter={label} />} />
        <ChartLegend content={<ChartLegendContent className="flex-wrap gap-x-4 gap-y-1" />} />
        {Object.keys(GROUP_CONFIG).map((key) => (
          <Area
            key={key}
            dataKey={key}
            type="monotone"
            stackId="sources"
            stroke={`var(--color-${key})`}
            fill={`var(--color-${key})`}
            fillOpacity={0.35}
            strokeWidth={1.5}
          />
        ))}
      </AreaChart>
    </ChartContainer>
  );
}

export default function SourcesSection({ traffic, granularity }) {
  if (!traffic) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect GA4 (see Setup below) to see where visitors come from, including ChatGPT, Perplexity and other AI
        assistants.
      </p>
    );
  }
  const totalSessions = traffic.current.sessions || 0;
  const share = (row) => (totalSessions > 0 ? row.sessions / totalSessions : 0);

  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs font-medium text-muted-foreground">
          {granularity === "week" ? "Weekly" : "Daily"} visits by source
        </p>
        <SourcesOverTime traffic={traffic} granularity={granularity} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">By channel</p>
          <DataTable
            rowKey={(r) => r.name}
            rows={traffic.channels}
            columns={[
              {
                key: "name",
                label: "Channel",
                render: (r) => (
                  <span className={r.name === "AI assistants" ? "font-medium text-primary" : undefined}>{r.name}</span>
                ),
              },
              { key: "bar", label: "Share", render: (r) => <ShareBar value={share(r)} />, className: "w-1/4" },
              { key: "share", label: "%", align: "right", render: (r) => fmtPct(share(r), 0) },
              { key: "sessions", label: "Visits", align: "right", render: (r) => fmtNum(r.sessions) },
              {
                key: "engaged",
                label: "Engaged",
                align: "right",
                render: (r) => (r.sessions > 0 ? fmtPct(r.engaged / r.sessions, 0) : "—"),
              },
              { key: "delta", label: "Δ", align: "right", render: (r) => <Delta value={change(r.sessions, r.prevSessions)} /> },
            ]}
          />
        </div>
        <div className="min-w-0 space-y-2">
          <p className="text-xs font-medium text-muted-foreground">Top sources</p>
          <DataTable
            rowKey={(r) => r.name}
            rows={traffic.sources}
            columns={[
              { key: "name", label: "Source", className: "break-all" },
              { key: "sessions", label: "Visits", align: "right", render: (r) => fmtNum(r.sessions) },
              {
                key: "engaged",
                label: "Engaged",
                align: "right",
                render: (r) => (r.sessions > 0 ? fmtPct(r.engaged / r.sessions, 0) : "—"),
              },
              { key: "delta", label: "Δ", align: "right", render: (r) => <Delta value={change(r.sessions, r.prevSessions)} /> },
            ]}
          />
          <p className="text-[11px] text-muted-foreground">
            &quot;(direct)&quot; means the visit arrived without a referrer: typed or bookmarked visits, links opened from
            apps and email, your own team, and some bots. A low engaged share usually points to the last two.
          </p>
        </div>
      </div>
    </div>
  );
}
