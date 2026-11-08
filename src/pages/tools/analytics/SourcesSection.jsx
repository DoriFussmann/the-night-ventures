import React from "react";
import { Area, AreaChart, CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";
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

function FocusCard({ group, traffic }) {
  const cur = traffic.groups?.current?.[group] || { sessions: 0, engaged: 0 };
  const prev = traffic.groups?.previous?.[group] || { sessions: 0, engaged: 0 };
  const total = traffic.current.sessions || 0;
  const config = { [group]: GROUP_CONFIG[group] };
  return (
    <div className="min-w-0 space-y-2 rounded-md border border-border p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium">{GROUP_CONFIG[group].label}</p>
        <p className="text-[11px] text-muted-foreground">
          {total > 0 ? `${fmtPct(cur.sessions / total, 0)} of visits` : "—"}
        </p>
      </div>
      <div className="flex flex-wrap items-baseline gap-1.5">
        <p className="text-2xl font-semibold tabular-nums">{fmtNum(cur.sessions)}</p>
        <Delta value={change(cur.sessions, prev.sessions)} />
        <p className="text-[11px] text-muted-foreground">
          visits · {cur.sessions > 0 ? `${fmtPct(cur.engaged / cur.sessions, 0)} engaged` : "no visits"}
        </p>
      </div>
      <ChartContainer config={config} className="aspect-auto h-12 w-full">
        <LineChart data={traffic.series} margin={{ top: 2, right: 2, bottom: 2, left: 2 }}>
          <Line dataKey={group} type="monotone" stroke={`var(--color-${group})`} strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ChartContainer>
    </div>
  );
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
      <div className="grid gap-3 md:grid-cols-2">
        <FocusCard group="organic" traffic={traffic} />
        <FocusCard group="ai" traffic={traffic} />
      </div>

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
