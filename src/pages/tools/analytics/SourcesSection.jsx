import React from "react";
import { DataTable, Delta } from "./parts";
import { fmtNum, fmtPct } from "./format";

function ShareBar({ value }) {
  const pct = Math.max(0, Math.min(1, Number(value) || 0));
  return (
    <div className="h-1.5 w-full min-w-[60px] rounded bg-muted" aria-hidden="true">
      <div className="h-1.5 rounded bg-primary" style={{ width: `${pct * 100}%` }} />
    </div>
  );
}

function change(row) {
  return row.prevSessions > 0 ? (row.sessions - row.prevSessions) / row.prevSessions : null;
}

export default function SourcesSection({ traffic }) {
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
            { key: "sessions", label: "Sessions", align: "right", render: (r) => fmtNum(r.sessions) },
            { key: "delta", label: "Δ", align: "right", render: (r) => <Delta value={change(r)} /> },
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
            { key: "sessions", label: "Sessions", align: "right", render: (r) => fmtNum(r.sessions) },
            {
              key: "engaged",
              label: "Engaged",
              align: "right",
              render: (r) => (r.sessions > 0 ? fmtPct(r.engaged / r.sessions, 0) : "—"),
            },
            { key: "delta", label: "Δ", align: "right", render: (r) => <Delta value={change(r)} /> },
          ]}
        />
      </div>
    </div>
  );
}
