import React, { useEffect, useState } from "react";
import { smartlead } from "./smartleadApi";
import { ErrorLine, Loading, Section, num } from "./ui";

function reputation(w) {
  const r = w?.warmup_reputation ?? w?.reputation;
  if (r === undefined || r === null || r === "") return null;
  return parseFloat(String(r).replace("%", ""));
}

// Per-mailbox health: connection, daily capacity, warmup reputation.
export default function Mailboxes({ companyId }) {
  const [list, setList] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    smartlead("mailboxes", companyId)
      .then((d) => setList(Array.isArray(d) ? d : d?.data || d?.email_accounts || []))
      .catch((e) => setErr(e.message));
  }, [companyId]);

  const rows = (list || []).map((m) => {
    const a = m.email_account || m;
    const w = a.warmup_details || {};
    const rep = reputation(w);
    const smtpOk = a.is_smtp_success !== false;
    const imapOk = a.is_imap_success !== false;
    const issues = [];
    if (!smtpOk) issues.push("SMTP failing");
    if (!imapOk) issues.push("IMAP failing — replies may be missed");
    if (rep !== null && rep < 90) issues.push(`reputation ${rep}%`);
    if (String(w.status || "").toUpperCase() !== "ACTIVE") issues.push("warmup off");
    return {
      email: a.from_email || a.email || a.username,
      limit: num(a.message_per_day),
      sentToday: num(a.daily_sent_count),
      warmup: w.status || "—",
      rep,
      issues,
    };
  });
  const capacity = rows.reduce((s, r) => s + r.limit, 0);
  const bad = rows.filter((r) => r.issues.length).length;

  return (
    <Section
      title="Mailbox health"
      description={
        list
          ? `${rows.length} mailbox${rows.length === 1 ? "" : "es"} · ${capacity.toLocaleString()} emails/day capacity${bad ? ` · ${bad} need attention` : " · all healthy"}`
          : undefined
      }
    >
      {err ? (
        <ErrorLine>{err}</ErrorLine>
      ) : !list ? (
        <Loading />
      ) : !rows.length ? (
        <p className="text-sm text-destructive">No mailboxes attached — this campaign can't send.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Mailbox</th><th className="px-3 py-2 font-medium text-right">Sent today</th><th className="px-3 py-2 font-medium">Warmup</th><th className="px-3 py-2 font-medium text-right">Reputation</th><th className="px-3 py-2 font-medium">Issues</th></tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.email || i} className="border-t border-border">
                  <td className="px-3 py-1.5 break-all">{r.email}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.sentToday} / {r.limit || "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{r.warmup}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.rep === null ? "—" : `${r.rep}%`}</td>
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
