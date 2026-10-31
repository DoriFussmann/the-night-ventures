import React, { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { instantly } from "./instantlyApi";
import { ErrorLine, Loading, Section, Stat, pct } from "./ui";

const RANGES = [
  { id: 1, label: "24h" },
  { id: 7, label: "7 days" },
  { id: 30, label: "30 days" },
  { id: "all", label: "All time" },
];

// Both the all-time numbers and the ranges come normalized from the server
// (lib/instantly/mapping.js normalizeAnalytics).

export default function Analytics({ companyId, allTime }) {
  const [range, setRange] = useState(7);
  const [cache, setCache] = useState({});
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (range === "all" || cache[range]) return;
    let cancelled = false;
    setLoading(true);
    setErr("");
    instantly("analytics-range", companyId, { days: range })
      .then((d) => !cancelled && setCache((c) => ({ ...c, [range]: d })))
      .catch((e) => !cancelled && setErr(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [range, companyId, cache]);

  const data = range === "all" ? allTime : cache[range];
  const m = data || null;

  return (
    <Section
      title="Performance"
      description="Unique opens, clicks and replies. Rates are against emails sent in the period."
      actions={RANGES.map((r) => (
        <Button key={r.id} size="sm" variant={range === r.id ? "default" : "outline"} onClick={() => setRange(r.id)}>
          {r.label}
        </Button>
      ))}
    >
      {loading ? (
        <Loading />
      ) : err ? (
        <ErrorLine>{err}</ErrorLine>
      ) : !m ? (
        <p className="text-sm text-muted-foreground">No data.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Stat label="Sent" value={m.sent.toLocaleString()} />
          <Stat label="Opened" value={m.opened.toLocaleString()} sub={pct(m.opened, m.sent)} />
          <Stat label="Clicked" value={m.clicked.toLocaleString()} sub={pct(m.clicked, m.sent)} />
          <Stat label="Replied" value={m.replied.toLocaleString()} sub={pct(m.replied, m.sent)} tone={m.replied ? "good" : undefined} />
          <Stat
            label="Bounced"
            value={m.bounced.toLocaleString()}
            sub={pct(m.bounced, m.sent)}
            tone={m.sent && m.bounced / m.sent > 0.03 ? "bad" : undefined}
          />
          <Stat label="Unsubscribed" value={m.unsubscribed.toLocaleString()} sub={pct(m.unsubscribed, m.sent)} />
        </div>
      )}
    </Section>
  );
}
