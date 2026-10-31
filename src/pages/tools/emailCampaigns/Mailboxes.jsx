import React, { useEffect, useState } from "react";
import { instantly } from "./instantlyApi";
import { ErrorLine, Loading, Section } from "./ui";

// Per-mailbox health for the campaign's sending accounts: connection status,
// warmup, today's sends vs daily limit.
export default function Mailboxes({ companyId }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    instantly("mailboxes", companyId)
      .then(setData)
      .catch((e) => setErr(e.message));
  }, [companyId]);

  const rows = data?.mailboxes || [];
  const cap = data?.capacity;
  const bad = rows.filter((r) => !r.healthy).length;

  return (
    <Section
      title="Mailbox health"
      description={
        data
          ? `${rows.length} mailbox${rows.length === 1 ? "" : "es"} · ${cap?.perDay?.toLocaleString() ?? 0} emails/day${
              cap?.campaignCap ? ` (campaign limit ${cap.campaignCap})` : ""
            }${bad ? ` · ${bad} need attention` : rows.length ? " · all healthy" : ""}`
          : undefined
      }
    >
      {err ? (
        <ErrorLine>{err}</ErrorLine>
      ) : !data ? (
        <Loading />
      ) : !rows.length ? (
        <p className="text-sm text-destructive">No sending accounts on this campaign — add them in Instantly. It can't send.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">Mailbox</th>
                <th className="px-3 py-2 text-right font-medium">Sent today</th>
                <th className="px-3 py-2 font-medium">Warmup</th>
                <th className="px-3 py-2 text-right font-medium">Warmup score</th>
                <th className="px-3 py-2 font-medium">Issues</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.email || i} className="border-t border-border">
                  <td className="break-all px-3 py-1.5">{r.email}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">
                    {r.sentToday} / {r.limit || "—"}
                  </td>
                  <td className="px-3 py-1.5 text-xs">{r.warmup}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.score == null ? "—" : r.score}</td>
                  <td className={`px-3 py-1.5 text-xs ${r.issues.length ? "text-destructive" : "text-emerald-700"}`}>
                    {r.issues.length ? r.issues.join(", ") : "OK"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Section>
  );
}
