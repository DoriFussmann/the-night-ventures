import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, Mail, AlertTriangle, Upload, CheckCircle2 } from "lucide-react";
import Papa from "papaparse";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { smartlead } from "./emailCampaigns/smartleadApi";
import { cleanLeads, OUTPUT_FIELDS } from "./emailCampaigns/cleanLeads";

const VIEWS = [
  { id: "campaign", label: "Summary", needsCampaign: true },
  { id: "sequences", label: "Sequence & Copy", needsCampaign: true },
  { id: "leads", label: "Leads", needsCampaign: true },
  { id: "analytics", label: "Performance", needsCampaign: true },
  { id: "email-accounts", label: "Mailboxes", needsCampaign: true },
  { id: "campaigns", label: "All Campaigns", needsCampaign: false },
];

function stripHtml(html) {
  return String(html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function statusBadgeClass(status) {
  const v = String(status || "").toUpperCase();
  if (v === "START" || v === "ACTIVE" || v === "INPROGRESS")
    return "bg-emerald-50 text-emerald-700 border-emerald-200";
  if (v === "PAUSED") return "bg-orange-50 text-orange-700 border-orange-200";
  if (v === "STOPPED" || v === "COMPLETED")
    return "bg-slate-100 text-slate-600 border-slate-200";
  return "bg-muted text-muted-foreground border-border";
}

function KeyVal({ label, value, mono = false }) {
  if (value === undefined || value === null || value === "") return null;
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
        {label}
      </p>
      <p className={`text-sm text-foreground break-words ${mono ? "font-mono" : ""}`}>
        {String(value)}
      </p>
    </div>
  );
}

function RawJson({ data }) {
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-xs text-muted-foreground">
        Raw data
      </summary>
      <pre className="mt-2 max-h-80 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
        {JSON.stringify(data, null, 2)}
      </pre>
    </details>
  );
}

function SummaryView({ data }) {
  const c = Array.isArray(data) ? data[0] : data || {};
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <h3 className="text-base font-medium">{c.name || "(unnamed campaign)"}</h3>
        {c.status && (
          <Badge className={statusBadgeClass(c.status)}>{c.status}</Badge>
        )}
      </div>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <KeyVal label="Campaign ID" value={c.id} mono />
        <KeyVal label="Status" value={c.status} />
        <KeyVal label="Created" value={c.created_at} />
        <KeyVal label="Max leads / day" value={c.max_leads_per_day} />
        <KeyVal label="Track opens" value={c.track_settings ? "configured" : undefined} />
        <KeyVal label="Parent / client" value={c.client_id} />
      </div>
      <RawJson data={data} />
    </div>
  );
}

function SequencesView({ data }) {
  const steps = Array.isArray(data) ? data : data?.data || data?.sequences || [];
  if (!steps.length) {
    return (
      <div className="text-sm text-muted-foreground">
        No sequence steps returned. <RawJson data={data} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
      {steps.map((step, i) => {
        const subject = step.subject || step.email_subject || "(no subject)";
        const bodyHtml = step.email_body || step.body || step.email_campaign_body || "";
        const delay =
          step.seq_delay_details?.delay_in_days ??
          step.seq_delay_in_days ??
          step.delay_in_days;
        return (
          <div key={i} className="rounded-lg border border-border bg-card px-4 py-3 space-y-2">
            <div className="flex items-center justify-between gap-3">
              <span className="text-xs font-medium text-muted-foreground">
                Step {step.seq_number || i + 1}
              </span>
              {delay !== undefined && (
                <span className="text-xs text-muted-foreground">
                  wait {delay} day{Number(delay) === 1 ? "" : "s"}
                </span>
              )}
            </div>
            <p className="text-sm font-medium">Subject: {subject}</p>
            <p className="text-sm text-foreground whitespace-pre-wrap">
              {stripHtml(bodyHtml) || "(empty body)"}
            </p>
          </div>
        );
      })}
      <RawJson data={data} />
    </div>
  );
}

function LeadsView({ data }) {
  const list = Array.isArray(data) ? data : data?.data || data?.leads || [];
  const total = data?.total_leads ?? data?.total ?? list.length;
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Showing {list.length} of {total} lead{Number(total) === 1 ? "" : "s"}.
      </p>
      <div className="overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs uppercase tracking-wider text-muted-foreground">
            <tr>
              <th className="px-3 py-2">Email</th>
              <th className="px-3 py-2">Name</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {list.map((row, i) => {
              const lead = row.lead || row;
              const status = row.status || lead.status;
              const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ");
              return (
                <tr key={i} className="border-t border-border">
                  <td className="px-3 py-2 font-mono text-xs break-all">{lead.email}</td>
                  <td className="px-3 py-2">{name || "—"}</td>
                  <td className="px-3 py-2">{lead.company_name || "—"}</td>
                  <td className="px-3 py-2">{status || "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <RawJson data={data} />
    </div>
  );
}

function AnalyticsView({ data }) {
  const a = Array.isArray(data) ? data[0] : data || {};
  const metrics = [
    ["Sent", a.sent_count ?? a.sent],
    ["Opened", a.open_count ?? a.opens ?? a.unique_open_count],
    ["Clicked", a.click_count ?? a.clicks ?? a.unique_click_count],
    ["Replied", a.reply_count ?? a.replies],
    ["Bounced", a.bounce_count ?? a.bounces],
    ["Unsubscribed", a.unsubscribed_count ?? a.unsubscribes],
  ].filter(([, v]) => v !== undefined && v !== null);
  return (
    <div className="space-y-3">
      {metrics.length ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {metrics.map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-card px-3 py-3">
              <p className="text-[11px] uppercase tracking-wider text-muted-foreground font-medium">
                {label}
              </p>
              <p className="text-lg font-semibold">{String(value)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          No standard metrics recognized — see raw data.
        </p>
      )}
      <RawJson data={data} />
    </div>
  );
}

function MailboxesView({ data }) {
  const list = Array.isArray(data) ? data : data?.data || data?.email_accounts || [];
  if (!list.length) {
    return (
      <div className="text-sm text-muted-foreground">
        No mailboxes returned. <RawJson data={data} />
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {list.map((m, i) => {
        const acct = m.email_account || m;
        return (
          <div
            key={i}
            className="flex items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-sm"
          >
            <span className="font-mono text-xs break-all">
              {acct.from_email || acct.email || acct.username || "—"}
            </span>
            <span className="text-xs text-muted-foreground">
              {acct.warmup_details || acct.warmup_status
                ? "warmup on"
                : "warmup off"}
            </span>
          </div>
        );
      })}
      <RawJson data={data} />
    </div>
  );
}

function CampaignsView({ data, onPick }) {
  const list = Array.isArray(data) ? data : data?.data || [];
  return (
    <div className="space-y-2">
      {list.map((c, i) => (
        <button
          key={c.id || i}
          type="button"
          onClick={() => onPick(c.id)}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-2 text-left text-sm hover:bg-accent"
        >
          <span className="truncate">
            <span className="font-mono text-xs text-muted-foreground mr-2">{c.id}</span>
            {c.name || "(unnamed)"}
          </span>
          {c.status && (
            <Badge className={statusBadgeClass(c.status)}>{c.status}</Badge>
          )}
        </button>
      ))}
      <RawJson data={data} />
    </div>
  );
}

function LeadImport({ campaignId }) {
  const [fileName, setFileName] = useState("");
  const [cleaning, setCleaning] = useState(false);
  const [cleanErr, setCleanErr] = useState("");
  const [cleaned, setCleaned] = useState(null); // { leads, stats }
  const [confirming, setConfirming] = useState(false);
  const [pushing, setPushing] = useState(false);
  const [pushErr, setPushErr] = useState("");
  const [pushResult, setPushResult] = useState(null);

  const handleFile = (file) => {
    if (!file) return;
    setFileName(file.name);
    setCleanErr("");
    setCleaned(null);
    setPushResult(null);
    setConfirming(false);
    setCleaning(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: (res) => {
        try {
          setCleaned(cleanLeads(res.data));
        } catch (err) {
          setCleanErr(err?.message || "Could not clean the file");
        } finally {
          setCleaning(false);
        }
      },
      error: (err) => {
        setCleanErr(err?.message || "Could not read the file");
        setCleaning(false);
      },
    });
  };

  const onDrop = (e) => {
    e.preventDefault();
    const file = e.dataTransfer?.files?.[0];
    handleFile(file);
  };

  const runPush = async () => {
    if (!cleaned?.leads?.length) return;
    if (!String(campaignId).trim()) {
      setPushErr("Set a Campaign ID above first.");
      return;
    }
    setPushing(true);
    setPushErr("");
    setPushResult(null);
    try {
      const data = await smartlead("leads-import", {
        campaignId,
        leads: cleaned.leads,
      });
      setPushResult(data);
      setConfirming(false);
    } catch (err) {
      setPushErr(err?.message || "Push failed");
    } finally {
      setPushing(false);
    }
  };

  const preview = cleaned?.leads?.slice(0, 50) || [];

  return (
    <div className="space-y-4 rounded-lg border border-border bg-card px-4 py-4">
      <div>
        <h2 className="text-sm font-medium">Import a lead list</h2>
        <p className="text-xs text-muted-foreground">
          Drop an AudienceLab CSV. Clean keeps only the useful fields, picks the
          best email, and de-dupes. Push imports the leads into the campaign — it
          does <span className="font-medium text-foreground">not</span> start
          sending.
        </p>
      </div>

      <div
        onDragOver={(e) => e.preventDefault()}
        onDrop={onDrop}
        className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-8 text-center"
      >
        <Upload className="h-5 w-5 text-muted-foreground" />
        <p className="text-sm text-muted-foreground">
          Drag a CSV here, or
        </p>
        <label className="cursor-pointer text-sm font-medium text-primary underline">
          choose a file
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => handleFile(e.target.files?.[0])}
          />
        </label>
        {fileName && (
          <p className="text-xs text-muted-foreground">Selected: {fileName}</p>
        )}
      </div>

      {cleaning && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Cleaning…
        </div>
      )}
      {cleanErr && (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {cleanErr}
        </div>
      )}

      {cleaned && !cleaning && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
            <span className="font-medium">{cleaned.stats.kept} leads ready</span>
            <span className="text-muted-foreground">
              {cleaned.stats.business} business · {cleaned.stats.personal} personal
            </span>
            <span className="text-muted-foreground">
              {cleaned.stats.duplicates_removed} dupes removed
            </span>
            <span className="text-muted-foreground">
              {cleaned.stats.dropped_no_email} dropped (no email)
            </span>
          </div>

          <details className="rounded-md border border-border">
            <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
              Preview cleaned data (first {preview.length} of {cleaned.stats.kept})
            </summary>
            <div className="max-h-96 overflow-auto">
              <table className="w-full text-xs">
                <thead className="sticky top-0 bg-muted/70 text-left uppercase tracking-wider text-muted-foreground">
                  <tr>
                    {OUTPUT_FIELDS.map((f) => (
                      <th key={f} className="whitespace-nowrap px-2 py-1.5">
                        {f}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} className="border-t border-border">
                      {OUTPUT_FIELDS.map((f) => (
                        <td key={f} className="whitespace-nowrap px-2 py-1 max-w-[16rem] truncate">
                          {row[f]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {!confirming ? (
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setPushErr("");
                setConfirming(true);
              }}
              disabled={!cleaned.stats.kept}
            >
              Push {cleaned.stats.kept} leads to campaign
            </Button>
          ) : (
            <div className="space-y-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-3">
              <p className="text-sm text-foreground">
                Import {cleaned.stats.kept} leads into campaign{" "}
                <span className="font-mono">{String(campaignId) || "—"}</span>? This
                adds the leads but does not start sending.
              </p>
              <div className="flex gap-2">
                <Button type="button" size="sm" onClick={runPush} disabled={pushing}>
                  {pushing ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Pushing…
                    </>
                  ) : (
                    "Confirm push"
                  )}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => setConfirming(false)}
                  disabled={pushing}
                >
                  Cancel
                </Button>
              </div>
            </div>
          )}

          {pushErr && (
            <div className="flex items-center gap-2 text-sm text-destructive">
              <AlertTriangle className="h-4 w-4" /> {pushErr}
            </div>
          )}
          {pushResult && (
            <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
              <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
              <span>
                Done — added {pushResult.added}, already in campaign{" "}
                {pushResult.already_in_campaign}, duplicates {pushResult.duplicates},
                invalid {pushResult.invalid} (across {pushResult.batches} batch
                {pushResult.batches === 1 ? "" : "es"}).
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function EmailCampaigns() {
  const { companyId } = useParams();
  const [loadingCompany, setLoadingCompany] = useState(true);
  const [companyErr, setCompanyErr] = useState("");
  const [company, setCompany] = useState(null);
  const [campaignId, setCampaignId] = useState("");

  const [view, setView] = useState(null);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState(null);
  const [viewErr, setViewErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!companyId) {
        setLoadingCompany(false);
        return;
      }
      setLoadingCompany(true);
      const { data, error } = await supabase
        .from("companies")
        .select(
          "name, email_campaigns_enabled, email_campaigns_provider, email_campaigns_campaign_id"
        )
        .eq("id", companyId)
        .maybeSingle();
      if (cancelled) return;
      if (error) setCompanyErr(error.message || "Failed to load company");
      else {
        setCompany(data || null);
        setCampaignId(data?.email_campaigns_campaign_id || "");
      }
      setLoadingCompany(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const runView = async (resource) => {
    const meta = VIEWS.find((v) => v.id === resource);
    if (meta?.needsCampaign && !String(campaignId).trim()) {
      setView(resource);
      setResult(null);
      setViewErr("Enter a Campaign ID above first.");
      return;
    }
    setView(resource);
    setRunning(true);
    setViewErr("");
    setResult(null);
    try {
      const data = await smartlead(resource, { campaignId });
      setResult({ resource, data });
    } catch (err) {
      setViewErr(err?.message || "Request failed");
    } finally {
      setRunning(false);
    }
  };

  const pickCampaign = (id) => {
    setCampaignId(String(id || ""));
    runView("campaign");
  };

  const enabled = Boolean(company?.email_campaigns_enabled);
  const providerLabel =
    company?.email_campaigns_provider === "smartlead"
      ? "SmartLead"
      : company?.email_campaigns_provider === "instantly"
        ? "Instantly"
        : "—";

  return (
    <div className="w-full space-y-6 px-6 py-6">
      <div className="space-y-1">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Mail className="h-5 w-5" />
          {company?.name ? `${company.name} — ` : ""}Email Campaigns
        </h1>
        <p className="text-sm text-muted-foreground">
          Read-only view of your SmartLead campaign. Provider: {providerLabel}.
        </p>
      </div>

      {loadingCompany ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : companyErr ? (
        <div className="flex items-center gap-2 text-sm text-destructive">
          <AlertTriangle className="h-4 w-4" /> {companyErr}
        </div>
      ) : !enabled ? (
        <div className="rounded-lg border border-border bg-card/40 px-4 py-6 text-sm text-muted-foreground">
          Email campaigns are turned off for this company. Turn them on in{" "}
          <span className="font-medium text-foreground">
            Company Data → Email Campaigns
          </span>
          .
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <Label htmlFor="campaign_id">Campaign ID</Label>
            <Input
              id="campaign_id"
              value={campaignId}
              onChange={(e) => setCampaignId(e.target.value)}
              placeholder="SmartLead campaign ID"
              className="max-w-xs"
            />
          </div>

          <LeadImport campaignId={campaignId} />

          <div className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <Button
                key={v.id}
                type="button"
                size="sm"
                variant={view === v.id ? "default" : "outline"}
                onClick={() => runView(v.id)}
                disabled={running}
              >
                {v.label}
              </Button>
            ))}
          </div>

          <div className="min-h-[4rem] rounded-lg border border-border bg-card/40 px-4 py-4">
            {running ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading…
              </div>
            ) : viewErr ? (
              <div className="flex items-center gap-2 text-sm text-destructive">
                <AlertTriangle className="h-4 w-4" /> {viewErr}
              </div>
            ) : !result ? (
              <p className="text-sm text-muted-foreground">
                Pick a view above to load campaign data.
              </p>
            ) : result.resource === "campaign" ? (
              <SummaryView data={result.data} />
            ) : result.resource === "sequences" ? (
              <SequencesView data={result.data} />
            ) : result.resource === "leads" ? (
              <LeadsView data={result.data} />
            ) : result.resource === "analytics" ? (
              <AnalyticsView data={result.data} />
            ) : result.resource === "email-accounts" ? (
              <MailboxesView data={result.data} />
            ) : result.resource === "campaigns" ? (
              <CampaignsView data={result.data} onPick={pickCampaign} />
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
