import React, { useCallback, useEffect, useState } from "react";
import { Download, ExternalLink, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Section, Loading, ErrorLine, fmtDate } from "../emailCampaigns/ui";
import { audienceBuild } from "./api";

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());
const PAGE = 60;

const STATUS = {
  running: { label: "Pulling…", cls: "bg-muted text-muted-foreground border-border" },
  ready: { label: "Ready for review", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  approved: { label: "Approved, not pushed yet", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  expired: { label: "Expired, not sent", cls: "bg-muted text-muted-foreground border-border" },
  pushed: { label: "Pushed to SmartLead", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  failed: { label: "Failed", cls: "bg-red-50 text-red-700 border-red-200" },
};

function Funnel({ counts, need }) {
  if (!counts) return null;
  const removed = [
    counts.emailed_recently ? `${fmt(counts.emailed_recently)} emailed in the last 90 days` : null,
    counts.dnc ? `${fmt(counts.dnc)} on Do Not Contact` : null,
    counts.excluded_domain ? `${fmt(counts.excluded_domain)} excluded domain` : null,
    counts.duplicates ? `${fmt(counts.duplicates)} duplicates` : null,
    counts.no_business_email ? `${fmt(counts.no_business_email)} no business email` : null,
  ].filter(Boolean);
  return (
    <p className="text-sm">
      <span className="font-medium tabular-nums">{fmt(counts.pulled)}</span> pulled
      {removed.length ? <span className="text-muted-foreground"> − {removed.join(" · ")}</span> : null}
      {" → "}
      <span className="font-medium tabular-nums">{fmt(counts.eligible)}</span> eligible, ranked by fit
      {" → "}
      <span className="font-medium tabular-nums">{fmt(counts.selected)}</span> in today&apos;s list
      <span className="text-muted-foreground"> (need {fmt(need)})</span>
    </p>
  );
}

function timeLeft(iso) {
  const ms = Date.parse(iso || "") - Date.now();
  if (!Number.isFinite(ms) || ms <= 0) return "expired";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h ? `${h}h ${m}m left` : `${m}m left`;
}

function PushResult({ result }) {
  if (!result) return null;
  if (result.error) return <ErrorLine>Push failed: {result.error}. Try again.</ErrorLine>;
  const extra = [
    result.recontacts ? `${result.recontacts} re-contacted after 90+ days` : null,
    result.skipped_dnc ? `${result.skipped_dnc} on Do Not Contact` : null,
    result.skipped_recent ? `${result.skipped_recent} emailed in the last 90 days` : null,
    result.already_in_campaign ? `${result.already_in_campaign} already in the campaign` : null,
    result.duplicates ? `${result.duplicates} duplicates` : null,
    result.invalid ? `${result.invalid} invalid` : null,
    result.blocked_by_provider ? `${result.blocked_by_provider} blocked by SmartLead` : null,
  ].filter(Boolean);
  return (
    <p className="text-sm">
      SmartLead added <span className="font-medium tabular-nums">{fmt(result.added)}</span> of {fmt(result.sent)} sent
      {extra.length ? <span className="text-muted-foreground"> · {extra.join(" · ")}</span> : null}
    </p>
  );
}

function FitCell({ c }) {
  const n = Number(c.fit_score);
  const tone = n >= 8 ? "text-emerald-700" : n >= 5 ? "text-foreground" : "text-muted-foreground";
  return (
    <div>
      <span className={`font-medium tabular-nums ${tone}`}>{Number.isFinite(n) ? n : "—"}</span>
      <span className="text-xs text-muted-foreground">/10</span>
      {c.fit_reason && <p className="text-xs text-muted-foreground">{c.fit_reason}</p>}
    </div>
  );
}

// AudienceLab-style headers, so the file drops straight into
// Email Campaigns → Lead import (cleanLeads.js reads these names).
const CSV_COLUMNS = [
  ["FIRST_NAME", "first_name"],
  ["LAST_NAME", "last_name"],
  ["BUSINESS_VERIFIED_EMAILS", "email"],
  ["JOB_TITLE", "job_title"],
  ["HEADLINE", "headline"],
  ["COMPANY_NAME", "company_name"],
  ["COMPANY_DOMAIN", "company_domain"],
  ["COMPANY_INDUSTRY", "industry"],
  ["COMPANY_EMPLOYEE_COUNT", "employee_count"],
  ["COMPANY_REVENUE", "revenue"],
  ["LINKEDIN_URL", "linkedin_url"],
  ["FIT_SCORE", "fit_score"],
  ["FIT_REASON", "fit_reason"],
  ["RANK", "rank"],
];

function toCsv(rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [CSV_COLUMNS.map(([h]) => h).join(","), ...rows.map((r) => CSV_COLUMNS.map(([, k]) => esc(r[k])).join(","))].join("\n");
}

export default function TodaysLeads({ companyId, status, onChanged }) {
  const approvedFilters = status?.config?.filters?.approved;
  const dailyPull = Boolean(status?.config?.daily_pull_enabled);
  const [savingAuto, setSavingAuto] = useState(false);
  const [campaign, setCampaign] = useState(null);
  const need = status?.capacity?.need || 0;
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [pulling, setPulling] = useState(false);
  const [approving, setApproving] = useState(false);
  const [err, setErr] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setData(await audienceBuild("latest-run", { companyId }));
    } catch (e) {
      setErr(e.message);
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    if (approvedFilters) load();
  }, [approvedFilters, load]);

  useEffect(() => {
    if (!approvedFilters) return;
    audienceBuild("campaign-check", { companyId })
      .then(setCampaign)
      .catch((e) => setCampaign({ ok: false, error: e.message }));
  }, [approvedFilters, companyId]);

  const toggleAuto = async (enabled) => {
    setSavingAuto(true);
    setErr("");
    try {
      await audienceBuild("set-daily-pull", { companyId, enabled });
      onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSavingAuto(false);
    }
  };

  if (!approvedFilters) return null;

  const run = data?.run;
  const candidates = data?.candidates || [];
  const editable = run?.status === "ready";
  const pushable = ["ready", "approved"].includes(run?.status) && campaign?.ok !== false;
  const selectedCount = candidates.filter((c) => c.selected).length;
  const shown = showAll ? candidates : candidates.slice(0, Math.max(PAGE, selectedCount + 10));

  const pull = async () => {
    if (run?.status === "approved" && !window.confirm("Today's list is approved. Pull again and replace it?")) return;
    setPulling(true);
    setErr("");
    try {
      await audienceBuild("run-pull", { companyId });
    } catch (e) {
      setErr(e.message);
    } finally {
      await load();
      setPulling(false);
    }
  };

  const toggle = async (c) => {
    setBusyId(c.id);
    setErr("");
    const next = !c.selected;
    setData((d) => ({ ...d, candidates: d.candidates.map((x) => (x.id === c.id ? { ...x, selected: next } : x)) }));
    try {
      const r = await audienceBuild("set-selected", { runId: run.id, candidateId: c.id, selected: next });
      setData((d) => ({ ...d, run: { ...d.run, counts: { ...d.run.counts, selected: r.selected } } }));
    } catch (e) {
      setErr(e.message);
      setData((d) => ({ ...d, candidates: d.candidates.map((x) => (x.id === c.id ? { ...x, selected: !next } : x)) }));
    } finally {
      setBusyId(null);
    }
  };

  const approve = async () => {
    const warn = campaign?.ok && campaign.steps !== 1 ? `\n\nWarning: the SmartLead campaign has ${campaign.steps} steps, not 1.` : "";
    if (!window.confirm(`Push ${selectedCount} people to the SmartLead campaign now?${warn}`)) return;
    setApproving(true);
    setErr("");
    try {
      await audienceBuild("approve-and-push", { runId: run.id });
      await load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setApproving(false);
    }
  };

  const downloadCsv = () => {
    const blob = new Blob([toCsv(candidates.filter((c) => c.selected))], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `leads-${run.run_date}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const st = STATUS[run?.status] || null;

  return (
    <Section
      title="Today's leads"
      description="Builds today's audience from your segments and approved filters (high intent, last day), removes anyone who can't be emailed, has Claude score each person's fit, and picks the top ones for today."
      actions={
        <Button size="sm" variant={run ? "outline" : "default"} onClick={pull} disabled={pulling || run?.status === "pushed"}>
          {pulling ? "Pulling…" : run ? "Pull again" : "Pull today's leads"}
        </Button>
      }
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-md border border-border px-3 py-2">
        <Switch id="ab-daily" checked={dailyPull} onCheckedChange={toggleAuto} disabled={savingAuto} />
        <label htmlFor="ab-daily" className="text-sm">
          Pull automatically every weekday (~5 AM PT) and email me the list
        </label>
        <span className="text-xs text-muted-foreground">
          Nothing is sent until you approve. Unapproved lists expire after 24 hours.
        </span>
      </div>
      {campaign && !campaign.ok && (
        <p className="mb-3 text-sm text-amber-700">SmartLead: {campaign.error}. Pushing is off until that&apos;s fixed.</p>
      )}
      {campaign?.ok && campaign.steps !== 1 && (
        <p className="mb-3 text-sm text-amber-700">
          The SmartLead campaign has {campaign.steps} step{campaign.steps === 1 ? "" : "s"}. Single touch expects exactly 1:
          {campaign.steps === 0 ? " add the email in SmartLead." : " remove the follow-ups in SmartLead."}
        </p>
      )}
      {loading && <Loading />}
      {pulling && <Loading label="Building the audience, removing ineligible people, scoring fit with Claude… about a minute" />}
      <ErrorLine>{err}</ErrorLine>

      {!loading && !pulling && !run && (
        <p className="text-sm text-muted-foreground">No pull yet. Pull today&apos;s leads to see who would be emailed.</p>
      )}

      {!pulling && run && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            {st && <span className={`rounded border px-2 py-0.5 text-xs font-medium ${st.cls}`}>{st.label}</span>}
            <span className="text-sm text-muted-foreground">
              {run.run_date} · {run.trigger === "cron" ? "auto-pull" : "manual pull"} · updated {fmtDate(run.updated_at)}
            </span>
            {["ready", "approved"].includes(run.status) && run.expires_at && (
              <span className="text-sm text-amber-700">
                Approve by {fmtDate(run.expires_at)} ({timeLeft(run.expires_at)})
              </span>
            )}
          </div>
          {run.status === "failed" && <ErrorLine>{run.error || "The pull failed."}</ErrorLine>}
          {run.status === "expired" && (
            <p className="text-sm text-muted-foreground">
              Not approved within 24 hours, so nothing was sent. Pull again, or wait for the next weekday pull.
            </p>
          )}
          {run.status === "pushed" && (
            <p className="text-sm">Pushed to SmartLead {fmtDate(run.pushed_at)}.</p>
          )}
          <PushResult result={run.push_result} />
          <Funnel counts={run.counts} need={run.need || need} />

          {candidates.length > 0 && (
            <div className="overflow-x-auto rounded-md border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/40 text-xs text-muted-foreground">
                  <tr>
                    <th className="w-10 px-3 py-2" />
                    <th className="w-10 px-2 py-2 text-right font-medium">#</th>
                    <th className="px-3 py-2 text-left font-medium">Person</th>
                    <th className="px-3 py-2 text-left font-medium">Company</th>
                    <th className="px-3 py-2 text-left font-medium">Fit</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((c, i) => (
                    <tr
                      key={c.id}
                      className={`border-t border-border align-top ${c.selected ? "" : "opacity-60"} ${
                        i > 0 && shown[i - 1].selected && !c.selected ? "border-t-2 border-t-foreground/30" : ""
                      }`}
                    >
                      <td className="px-3 py-2.5">
                        <Checkbox
                          checked={c.selected}
                          disabled={!editable || busyId === c.id}
                          onCheckedChange={() => toggle(c)}
                          aria-label={`Include ${c.first_name || c.email}`}
                        />
                      </td>
                      <td className="px-2 py-2.5 text-right tabular-nums text-muted-foreground">{c.rank}</td>
                      <td className="px-3 py-2.5">
                        <div className="font-medium">
                          {[c.first_name, c.last_name].filter(Boolean).join(" ") || c.email}
                          {c.linkedin_url && (
                            <a
                              href={c.linkedin_url.startsWith("http") ? c.linkedin_url : `https://${c.linkedin_url}`}
                              target="_blank"
                              rel="noreferrer"
                              className="ml-1.5 inline-flex text-muted-foreground hover:text-foreground"
                              aria-label="LinkedIn"
                            >
                              <ExternalLink className="h-3.5 w-3.5" />
                            </a>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {[c.job_title, c.seniority].filter(Boolean).join(" · ")}
                        </div>
                        <div className="text-xs text-muted-foreground">{c.email}</div>
                      </td>
                      <td className="px-3 py-2.5">
                        <div>{c.company_name || "—"}</div>
                        <div className="text-xs text-muted-foreground">
                          {[c.employee_count && `${c.employee_count} employees`, c.industry].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <FitCell c={c} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {candidates.length > shown.length && (
            <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>
              Show all {fmt(candidates.length)}
            </Button>
          )}

          {candidates.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button size="sm" onClick={approve} disabled={!pushable || approving || !selectedCount}>
                <Send className="mr-1.5 h-4 w-4" />
                {approving ? "Pushing…" : run.status === "approved" ? `Retry Push (${selectedCount})` : `Approve & Push (${selectedCount})`}
              </Button>
              <Button size="sm" variant="outline" onClick={downloadCsv} disabled={!selectedCount}>
                <Download className="mr-1.5 h-4 w-4" /> Download CSV
              </Button>
              {editable && (
                <span className="text-sm text-muted-foreground">
                  Above the line: today&apos;s list. Tick or untick to swap people in or out.
                </span>
              )}
            </div>
          )}
        </div>
      )}
    </Section>
  );
}
