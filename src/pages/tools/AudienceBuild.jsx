import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Check, Crosshair, RefreshCw, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Section, Loading, ErrorLine, Stat, fmtDate } from "./emailCampaigns/ui";
import { audienceBuild } from "./audienceBuild/api";
import IcpFilters from "./audienceBuild/IcpFilters";
import TodaysLeads from "./audienceBuild/TodaysLeads";
import { attachCounts } from "../../../lib/audience-build/logic.js";

const AUTO_COUNT_TOP = 5;

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

const COVERAGE = {
  covers: { label: "Covers need", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  partial: { label: "Partial", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  short: { label: "Short", cls: "bg-red-50 text-red-700 border-red-200" },
  unknown: { label: "—", cls: "bg-muted text-muted-foreground border-border" },
};

function CoverageBadge({ coverage }) {
  if (!coverage) return <span className="text-xs text-muted-foreground">not counted</span>;
  const c = COVERAGE[coverage.status] || COVERAGE.unknown;
  return (
    <span className={`inline-flex items-center whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-medium ${c.cls}`}>
      {c.label}
      {coverage.ratio != null && <span className="ml-1 tabular-nums opacity-80">{coverage.ratio}×</span>}
    </span>
  );
}

function Notice({ children }) {
  return (
    <div className="rounded-lg border border-border bg-card/40 px-4 py-4 text-sm text-muted-foreground">{children}</div>
  );
}

function Capacity({ companyId, capacity, onSaved, done }) {
  const [inboxes, setInboxes] = useState(String(capacity?.inboxes ?? 1));
  const [cap, setCap] = useState(String(capacity?.cap ?? 30));
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");
  const need = (Number(inboxes) || 0) * (Number(cap) || 0);
  const multiplier = capacity?.multiplier ?? 3;
  const dirty = String(capacity?.inboxes) !== inboxes || String(capacity?.cap) !== cap;

  const save = async () => {
    setSaving(true);
    setErr("");
    try {
      await audienceBuild("save-capacity", { companyId, inboxes: Number(inboxes), dailyCap: Number(cap) });
      onSaved();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      title="Sending capacity"
      description="Single touch: every email goes to a new lead, so leads needed per day = inboxes × daily cap."
      collapsible
      defaultOpen={!done}
      done={done}
      summary={`${capacity?.inboxes} inbox${capacity?.inboxes === 1 ? "" : "es"} × ${capacity?.cap} a day = ${fmt(capacity?.need)} leads/day · target pool ${fmt(capacity?.targetPool)}`}
    >
      <div className="flex flex-wrap items-end gap-4">
        <div className="space-y-1">
          <Label htmlFor="ab-inboxes">Inboxes</Label>
          <Input id="ab-inboxes" type="number" min={1} max={20} className="w-24" value={inboxes} onChange={(e) => setInboxes(e.target.value)} />
        </div>
        <div className="space-y-1">
          <Label htmlFor="ab-cap">Emails per inbox per day</Label>
          <Input id="ab-cap" type="number" min={1} max={200} className="w-24" value={cap} onChange={(e) => setCap(e.target.value)} />
        </div>
        <Button size="sm" onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <div className="ml-auto grid grid-cols-2 gap-3">
          <Stat label="Leads needed / day" value={fmt(need)} />
          <Stat
            label="Target fresh pool / day"
            value={fmt(Math.round(need * multiplier))}
            sub={`${multiplier}× need (set in Admin)`}
          />
        </div>
      </div>
      <div className="mt-2">
        <ErrorLine>{err}</ErrorLine>
      </div>
    </Section>
  );
}

function Makeup({ makeup }) {
  if (!makeup?.seniority?.length) return null;
  const line = (list) => list.slice(0, 3).map((x) => `${x.value} ${x.count}`).join(" · ");
  return (
    <p className="mt-1 text-xs text-muted-foreground">
      Seniority: {line(makeup.seniority)}
      {makeup.department?.length ? <> &nbsp;|&nbsp; Dept: {line(makeup.department)}</> : null}
    </p>
  );
}

function Match({ companyId, status, onChanged, done }) {
  const config = status?.config;
  const lastMatch = config?.last_match || null;
  const savedIds = useMemo(() => (config?.segments || []).map((s) => s.segment_id), [config]);
  const [running, setRunning] = useState(false);
  const [err, setErr] = useState("");
  const [selected, setSelected] = useState(savedIds);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  useEffect(() => setSelected(savedIds), [savedIds]);

  const need = status?.capacity?.need || lastMatch?.need || 0;
  const multiplier = status?.capacity?.multiplier ?? 3;
  const target = Math.round(need * multiplier);
  // Counts fetched on this page: segment_id -> rows | "counting" | { error }.
  const [localCounts, setLocalCounts] = useState({});
  const candidates = useMemo(() => {
    const base = lastMatch?.candidates || [];
    const rows = Object.values(localCounts).filter(Array.isArray).flat();
    if (!rows.length) return base;
    const counted = attachCounts(base, rows, need, multiplier);
    // attachCounts only fills what it was given; keep server-side counts too.
    return counted.map((c, i) => (c.counted ? c : base[i]));
  }, [lastMatch, localCounts, need, multiplier]);

  // Returns fresh people/day for the segment, or null on failure.
  const countOne = useCallback(async (segmentId) => {
    setLocalCounts((m) => ({ ...m, [segmentId]: "counting" }));
    try {
      const rows = await audienceBuild("count", { segmentId });
      setLocalCounts((m) => ({ ...m, [segmentId]: rows.map((r) => ({ ...r, segment_id: segmentId })) }));
      return Number(rows.find((r) => r.days_back === 1)?.reach) || 0;
    } catch (e) {
      setLocalCounts((m) => ({ ...m, [segmentId]: { error: e.message } }));
      return null;
    }
  }, []);

  // After each match, count the top candidates one at a time, best first.
  // Stop as soon as one segment alone covers the target pool: the rest aren't needed.
  const ranAt = lastMatch?.ran_at;
  const [autoStopped, setAutoStopped] = useState(null);
  useEffect(() => {
    if (!ranAt) return undefined;
    let cancelled = false;
    setAutoStopped(null);
    const top = (lastMatch?.candidates || []).slice(0, AUTO_COUNT_TOP);
    (async () => {
      for (const c of top) {
        if (cancelled) return;
        const perDay = c.counted ? c.reach_1d_high : await countOne(c.segment_id);
        if (cancelled) return;
        if (target > 0 && perDay != null && perDay >= target) {
          setAutoStopped(c.topic);
          return;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranAt, countOne, target]);
  const counting = Object.values(localCounts).filter((v) => v === "counting").length;
  const blocked = !status?.taxonomy?.segments || !status?.audienceLabConfigured;

  const run = async () => {
    setRunning(true);
    setErr("");
    setSaveMsg("");
    setLocalCounts({});
    try {
      await audienceBuild("match", { companyId });
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setRunning(false);
    }
  };

  const toggle = (id) =>
    setSelected((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  // Keep the saved order = relevance order, so the best pick is primary.
  const orderedSelection = candidates.map((c) => c.segment_id).filter((id) => selected.includes(id));
  const selectedPerDay = candidates
    .filter((c) => selected.includes(c.segment_id))
    .reduce((sum, c) => sum + (Number(c.reach_1d_high) || 0), 0);
  const dirty = orderedSelection.join(",") !== savedIds.join(",");

  const save = async () => {
    setSaving(true);
    setErr("");
    setSaveMsg("");
    try {
      await audienceBuild("select", { companyId, segmentIds: orderedSelection });
      setSaveMsg("Saved.");
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Section
      collapsible
      defaultOpen={!done}
      done={done}
      summary={(config?.segments || [])
        .map((sg) => `${sg.topic}${sg.role === "primary" ? " (primary)" : ""}`)
        .join(" · ")}
      title="Find the audience"
      description="Claude plans a buyer-side search from Company Intelligence, ranks AudienceLab segments, then counts real high-intent people with a validated business email."
      actions={
        <Button size="sm" onClick={run} disabled={running || blocked}>
          <Search className="mr-1.5 h-4 w-4" />
          {running ? "Working…" : lastMatch ? "Run again" : "Find audiences"}
        </Button>
      }
    >
      {status?.missingFields?.length > 0 && (
        <p className="mb-3 text-sm text-amber-700">
          Matching works best with {status.missingFields.join(", ")} filled in.{" "}
          <Link className="underline" to={`/company/${companyId}/company-data`}>
            Open Company Intelligence
          </Link>
        </p>
      )}
      {running && <Loading label="Planning the search, ranking segments, counting people… about a minute" />}
      <ErrorLine>{err}</ErrorLine>

      {!running && !lastMatch && !err && (
        <p className="text-sm text-muted-foreground">No match yet. Run it to see the best AudienceLab segments for this company.</p>
      )}

      {!running && lastMatch && (
        <div className="space-y-4">
          <div className="text-sm">
            <span className="text-muted-foreground">Buyer: </span>
            {lastMatch.buyer_summary || "—"}
            <span className="ml-2 text-xs text-muted-foreground">
              · ran {fmtDate(lastMatch.ran_at)} · {lastMatch.retrieved} candidates reviewed
            </span>
          </div>

          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs text-muted-foreground">
                <tr>
                  <th className="w-10 px-3 py-2" />
                  <th className="px-3 py-2 text-left font-medium">Segment</th>
                  <th className="px-3 py-2 text-right font-medium">Relevance</th>
                  <th className="px-3 py-2 text-right font-medium">High intent, 7 days</th>
                  <th className="px-3 py-2 text-right font-medium">Fresh / day</th>
                  <th className="px-3 py-2 text-left font-medium">vs {fmt(need)}/day need</th>
                </tr>
              </thead>
              <tbody>
                {candidates.map((c) => (
                  <tr key={c.segment_id} className="border-t border-border align-top">
                    <td className="px-3 py-2.5">
                      <Checkbox
                        checked={selected.includes(c.segment_id)}
                        onCheckedChange={() => toggle(c.segment_id)}
                        aria-label={`Select ${c.topic}`}
                      />
                    </td>
                    <td className="px-3 py-2.5">
                      <div className="font-medium">
                        {c.topic}
                        {c.name_match && (
                          <span className="ml-1.5 rounded border border-border px-1 py-0.5 text-[10px] font-normal text-muted-foreground">
                            competitor
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {[c.category, c.subcategory].filter(Boolean).join(" › ")} · {c.segment_id}
                      </div>
                      {c.reason && <p className="mt-1 text-xs">{c.reason}</p>}
                      <Makeup makeup={c.makeup} />
                      {localCounts[c.segment_id]?.error && (
                        <p className="mt-1 text-xs text-destructive">Count failed: {localCounts[c.segment_id].error}</p>
                      )}
                    </td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{c.relevance}/10</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(c.reach_7d_high)}</td>
                    <td className="px-3 py-2.5 text-right tabular-nums">{fmt(c.reach_1d_high)}</td>
                    <td className="px-3 py-2.5">
                      {c.counted ? (
                        <CoverageBadge coverage={c.coverage} />
                      ) : localCounts[c.segment_id] === "counting" ? (
                        <span className="text-xs text-muted-foreground">counting…</span>
                      ) : (
                        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => countOne(c.segment_id)}>
                          Count
                        </Button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <Button size="sm" onClick={save} disabled={saving || !dirty}>
              <Check className="mr-1.5 h-4 w-4" />
              {saving ? "Saving…" : "Save Selection"}
            </Button>
            <span className="text-sm text-muted-foreground">
              {orderedSelection.length} selected · ~{fmt(selectedPerDay)} fresh people/day before overlap and ICP filters
              {need ? ` · need ${fmt(need)}, target ${fmt(target)}` : ""}
            </span>
            {saveMsg && <span className="text-sm text-emerald-700">{saveMsg}</span>}
          </div>
          <p className="text-xs text-muted-foreground">
            {counting > 0 && <>Counting (about 30 seconds per segment)… </>}
            {autoStopped && <>Stopped counting: {autoStopped} alone covers the target. </>}
            Counts: high intent only, business email with a validation status. The top 5 are counted one by one, best
            first, stopping once one segment covers the target; use Count for any other. The first
            selected segment (highest relevance) is the primary. ICP filters in the next step will lower these numbers.
          </p>

          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">How the search was planned</summary>
            <p className="mt-2">
              <span className="font-medium text-foreground">Phrases:</span> {(lastMatch.phrases || []).join(", ")}
            </p>
            <p className="mt-1">
              <span className="font-medium text-foreground">Names:</span> {(lastMatch.names || []).join(", ") || "—"}
            </p>
          </details>
        </div>
      )}
    </Section>
  );
}

export default function AudienceBuild() {
  const { companyId } = useParams();
  const [status, setStatus] = useState(null);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    setErr("");
    try {
      setStatus(await audienceBuild("status", { companyId }));
    } catch (e) {
      setErr(e.message);
    }
  }, [companyId]);

  useEffect(() => {
    setStatus(null);
    load();
  }, [load]);

  // A step is "done" once its result is saved; done steps start collapsed.
  // Keys include the flag so a step collapses the moment it completes.
  const steps = {
    segments: Boolean(status?.config?.segments?.length),
    filters: Boolean(status?.config?.filters?.approved),
  };
  steps.capacity = steps.segments;

  let body;
  if (err) body = <ErrorLine>{err}</ErrorLine>;
  else if (!status) body = <Loading />;
  else
    body = (
      <div className="space-y-5">
        {!status.audienceLabConfigured && (
          <Notice>
            AudienceLab isn't connected. Add <code>AUDIENCELAB_API_KEY</code> in Vercel → Settings → Environment
            Variables, then redeploy.
          </Notice>
        )}
        <Capacity
          key={`${status.capacity?.inboxes}-${status.capacity?.cap}-${steps.capacity}`}
          companyId={companyId}
          capacity={status.capacity}
          onSaved={load}
          done={steps.capacity}
        />
        {!status.taxonomy?.segments && (
          <Notice>
            The AudienceLab taxonomy hasn't been synced yet. Run it once in{" "}
            <Link className="underline" to="/admin">
              Admin → AudienceLab taxonomy
            </Link>
            ; it then refreshes weekly on its own.
          </Notice>
        )}
        <Match key={`match-${steps.segments}`} companyId={companyId} status={status} onChanged={load} done={steps.segments} />
        <IcpFilters key={`icp-${steps.filters}`} companyId={companyId} status={status} onChanged={load} done={steps.filters} />
        <TodaysLeads companyId={companyId} status={status} />
      </div>
    );

  return (
    <div className="mx-auto w-full max-w-6xl space-y-5 px-6 py-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          <Crosshair className="h-5 w-5" />
          {status?.company?.name ? `${status.company.name} — ` : ""}Audience Build
        </h1>
        {status && (
          <Button size="sm" variant="outline" onClick={load}>
            <RefreshCw className="mr-1.5 h-4 w-4" /> Refresh
          </Button>
        )}
      </div>
      {body}
    </div>
  );
}
