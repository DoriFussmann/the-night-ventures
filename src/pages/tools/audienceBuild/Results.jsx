import React, { useEffect, useState } from "react";
import { Section, Loading, ErrorLine, pct } from "../emailCampaigns/ui";
import { audienceBuild } from "./api";

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

// What happened to each pushed list. Sent / replied / bounced / unsubscribed
// come from the Instantly webhook, so they start counting once tracking is on.
export default function Results({ companyId, refreshKey }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    audienceBuild("results", { companyId })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [companyId, refreshKey]);

  const t = data?.totals;
  const summary = t?.pushed
    ? `Last ${data.rows.length} list${data.rows.length === 1 ? "" : "s"}: ${fmt(t.pushed)} pushed · ${fmt(t.sent)} sent · ${fmt(t.replied)} replied (${pct(t.replied, t.sent)}) · ${fmt(t.bounced)} bounced`
    : "Nothing pushed yet";

  return (
    <Section
      title="Results"
      description="Each pushed list and what happened to it. Counts come from Instantly tracking."
      summary={summary}
      collapsible
      defaultOpen={false}
    >
      {err ? (
        <ErrorLine>{err}</ErrorLine>
      ) : !data ? (
        <Loading />
      ) : !data.rows.length ? (
        <p className="text-sm text-muted-foreground">No list pushed yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 text-left font-medium">List</th>
                <th className="px-3 py-2 text-right font-medium">Pushed</th>
                <th className="px-3 py-2 text-right font-medium">Sent</th>
                <th className="px-3 py-2 text-right font-medium">Replied</th>
                <th className="px-3 py-2 text-right font-medium">Bounced</th>
                <th className="px-3 py-2 text-right font-medium">Unsubscribed</th>
              </tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.runId} className="border-t border-border">
                  <td className="px-3 py-2">{r.date}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.pushed)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.sent)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {fmt(r.replied)} <span className="text-xs text-muted-foreground">{pct(r.replied, r.sent)}</span>
                  </td>
                  <td className={`px-3 py-2 text-right tabular-nums ${r.sent && r.bounced / r.sent > 0.03 ? "text-destructive" : ""}`}>
                    {fmt(r.bounced)}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{fmt(r.unsubscribed)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
