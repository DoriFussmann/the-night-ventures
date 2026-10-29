import React, { useEffect, useMemo, useState } from "react";
import { Check, Sparkles, Gauge, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Section, Loading, ErrorLine, fmtDate } from "../emailCampaigns/ui";
import { audienceBuild } from "./api";
import {
  EMPLOYEE_BANDS,
  EMPTY_FILTERS,
  REVENUE_BANDS,
  impactLayers,
} from "../../../../lib/audience-build/filters.js";
import { coverage } from "../../../../lib/audience-build/logic.js";

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

function countsFor(list) {
  const m = new Map();
  for (const x of list || []) m.set(String(x.value).toLowerCase(), x.count);
  return m;
}

function FieldLabel({ label, known, reason }) {
  return (
    <div className="mb-1.5">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium">{label}</span>
        {known != null && <span className="text-xs text-muted-foreground">{known}% of people have this</span>}
      </div>
      {reason && <p className="text-xs text-muted-foreground">Claude: {reason}</p>}
    </div>
  );
}

// All options as toggle chips; counts from the audience makeup when known.
function ToggleChips({ options, value, onChange, counts }) {
  const selected = new Set(value);
  return (
    <div className="flex flex-wrap gap-1.5">
      {options.map((opt) => {
        const on = selected.has(opt);
        const n = counts?.get(String(opt).toLowerCase());
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(on ? value.filter((v) => v !== opt) : [...value, opt].sort((a, b) => options.indexOf(a) - options.indexOf(b)))}
            className={`rounded-full border px-2.5 py-0.5 text-xs transition-colors ${
              on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-muted"
            }`}
          >
            {opt}
            {n != null && <span className={`ml-1 tabular-nums ${on ? "opacity-80" : "text-muted-foreground"}`}>{n}</span>}
          </button>
        );
      })}
    </div>
  );
}

function Chip({ children, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs">
      {children}
      <button type="button" onClick={onRemove} aria-label={`Remove ${children}`} className="text-muted-foreground hover:text-foreground">
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// Selected chips + a dropdown of the remaining allowed values (for long lists).
function PickList({ options, value, onChange, counts, placeholder }) {
  const rest = options
    .filter((o) => !value.includes(o))
    .sort((a, b) => (counts?.get(b) || 0) - (counts?.get(a) || 0) || a.localeCompare(b));
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((v) => (
        <Chip key={v} onRemove={() => onChange(value.filter((x) => x !== v))}>
          {v}
        </Chip>
      ))}
      <select
        className="h-7 rounded-md border border-border bg-background px-2 text-xs"
        value=""
        onChange={(e) => e.target.value && onChange([...value, e.target.value])}
      >
        <option value="">{placeholder}</option>
        {rest.map((o) => (
          <option key={o} value={o}>
            {o}
            {counts?.get(o) ? ` (${counts.get(o)})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}

// Free-text terms: Enter or comma adds.
function TermInput({ value, onChange, placeholder }) {
  const [text, setText] = useState("");
  const add = () => {
    const parts = text
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length >= 2 && !value.some((v) => v.toLowerCase() === s.toLowerCase()));
    if (parts.length) onChange([...value, ...parts]);
    setText("");
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {value.map((v) => (
        <Chip key={v} onRemove={() => onChange(value.filter((x) => x !== v))}>
          {v}
        </Chip>
      ))}
      <Input
        className="h-7 w-56 text-xs"
        value={text}
        placeholder={placeholder}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add();
          }
        }}
        onBlur={add}
      />
    </div>
  );
}

const COVERAGE_CLS = {
  covers: "text-emerald-700",
  partial: "text-amber-700",
  short: "text-red-700",
};

export default function IcpFilters({ companyId, status, onChanged }) {
  const config = status?.config;
  const saved = config?.filters || {};
  const allowed = saved.allowed;
  const makeup = saved.makeup;
  const reasons = saved.reasons || {};
  const need = status?.capacity?.need || 0;
  const multiplier = status?.capacity?.multiplier ?? 3;
  const target = Math.round(need * multiplier);
  const segmentIds = useMemo(() => (config?.segments || []).map((s) => s.segment_id), [config]);
  const stale =
    saved.segment_ids && [...saved.segment_ids].sort().join("+") !== [...segmentIds].sort().join("+");

  const initial = useMemo(
    () => ({ ...EMPTY_FILTERS, ...(saved.approved || saved.draft || status?.profileFilters || {}) }),
    [saved.approved, saved.draft, status?.profileFilters]
  );
  const [filters, setFilters] = useState(initial);
  useEffect(() => setFilters(initial), [initial]);

  const [drafting, setDrafting] = useState(false);
  const [approving, setApproving] = useState(false);
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const [impact, setImpact] = useState(null); // [{ key, label, reach | "counting" | {error} }]

  const set = (k) => (v) => {
    setFilters((f) => ({ ...f, [k]: v }));
    setImpact(null);
    setMsg("");
  };
  const dirty = JSON.stringify(filters) !== JSON.stringify({ ...EMPTY_FILTERS, ...(saved.approved || {}) });

  const draft = async () => {
    setDrafting(true);
    setErr("");
    setMsg("");
    setImpact(null);
    try {
      await audienceBuild("draft-filters", { companyId });
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setDrafting(false);
    }
  };

  const checkImpact = async () => {
    setErr("");
    const layers = impactLayers(filters);
    setImpact(layers.map((l) => ({ key: l.key, label: l.label, reach: "pending" })));
    for (const [i, l] of layers.entries()) {
      setImpact((cur) => cur?.map((row, j) => (j === i ? { ...row, reach: "counting" } : row)));
      try {
        const r = await audienceBuild("count-filters", { companyId, filters: l.filters, daysBack: 1 });
        setImpact((cur) => cur?.map((row, j) => (j === i ? { ...row, reach: r.reach } : row)));
      } catch (e) {
        setImpact((cur) => cur?.map((row, j) => (j === i ? { ...row, reach: { error: e.message } } : row)));
        return;
      }
    }
  };

  const approve = async () => {
    setApproving(true);
    setErr("");
    setMsg("");
    try {
      await audienceBuild("approve-filters", { companyId, filters });
      setMsg("Filters approved and saved to the company's ICP.");
      onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setApproving(false);
    }
  };

  if (!segmentIds.length) return null;

  const counting = impact?.some((r) => r.reach === "counting" || r.reach === "pending");

  return (
    <Section
      title="Who to target"
      description="Filters that keep only buyers: the role that can say yes, at a company that fits. Claude drafts them from Company Intelligence and the real makeup of your selected segments; you edit and approve."
      actions={
        <Button size="sm" variant={allowed ? "outline" : "default"} onClick={draft} disabled={drafting}>
          <Sparkles className="mr-1.5 h-4 w-4" />
          {drafting ? "Drafting…" : allowed ? "Redraft with Claude" : "Draft with Claude"}
        </Button>
      }
    >
      {drafting && <Loading label="Reading the audience makeup and drafting filters… under a minute" />}
      <ErrorLine>{err}</ErrorLine>
      {stale && !drafting && (
        <p className="mb-3 text-sm text-amber-700">Your segment selection changed since this draft. Redraft to use the new makeup.</p>
      )}

      {!allowed && !drafting && (
        <p className="text-sm text-muted-foreground">
          No filters yet. Draft them with Claude; you can change everything before approving.
        </p>
      )}

      {allowed && !drafting && (
        <div className="space-y-5">
          {saved.summary && (
            <p className="text-sm">
              <span className="text-muted-foreground">Keeps: </span>
              {saved.summary}
              {makeup?.reach != null && (
                <span className="ml-2 text-xs text-muted-foreground">
                  · makeup of {fmt(makeup.reach)} high-intent people over 7 days
                </span>
              )}
            </p>
          )}

          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <FieldLabel label="Seniority" known={makeup?.known?.seniority} reason={reasons.seniority} />
              <ToggleChips options={allowed.seniority} value={filters.seniority} onChange={set("seniority")} counts={countsFor(makeup?.seniority)} />
            </div>
            <div>
              <FieldLabel label="Department" known={makeup?.known?.department} reason={reasons.departments} />
              <ToggleChips options={allowed.departments} value={filters.departments} onChange={set("departments")} counts={countsFor(makeup?.department)} />
            </div>
            <div>
              <FieldLabel label="Job titles (include)" known={makeup?.known?.job_title} reason={reasons.titles} />
              <TermInput value={filters.titles} onChange={set("titles")} placeholder="Add a title, Enter" />
              <div className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground">
                Match
                <select
                  className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                  value={filters.title_match}
                  onChange={(e) => set("title_match")(e.target.value)}
                >
                  <option value="semantic">semantic (CEO = Chief Executive Officer)</option>
                  <option value="contains">contains every word</option>
                  <option value="exact">exact title</option>
                </select>
              </div>
            </div>
            <div>
              <FieldLabel label="Job titles (exclude)" reason={reasons.exclude_titles} />
              <TermInput value={filters.exclude_titles} onChange={set("exclude_titles")} placeholder="e.g. student, Enter" />
            </div>
            <div>
              <FieldLabel label="Company employees" known={makeup?.known?.employee_count} reason={reasons.employee_bands} />
              <ToggleChips options={EMPLOYEE_BANDS} value={filters.employee_bands} onChange={set("employee_bands")} counts={countsFor(makeup?.employee_count)} />
            </div>
            <div>
              <FieldLabel label="Company revenue" known={makeup?.known?.revenue} reason={reasons.revenue_bands} />
              <ToggleChips options={REVENUE_BANDS} value={filters.revenue_bands} onChange={set("revenue_bands")} counts={countsFor(makeup?.revenue)} />
            </div>
            <div>
              <FieldLabel label="Industries (include)" known={makeup?.known?.industry} reason={reasons.industries} />
              <PickList options={allowed.industries} value={filters.industries} onChange={set("industries")} counts={countsFor(makeup?.industry)} placeholder="Add industry…" />
            </div>
            <div>
              <FieldLabel label="Industries (exclude)" reason={reasons.exclude_industries} />
              <PickList options={allowed.industries} value={filters.exclude_industries} onChange={set("exclude_industries")} counts={countsFor(makeup?.industry)} placeholder="Exclude industry…" />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            Values in one filter are OR&apos;d; different filters are AND&apos;ed. Include filters drop people whose value is unknown;
            exclude filters keep them. Empty = no filter. Business email with a validation status is always required.
          </p>

          <div className="space-y-2">
            <Button size="sm" variant="outline" onClick={checkImpact} disabled={counting}>
              <Gauge className="mr-1.5 h-4 w-4" />
              {counting ? "Checking…" : "Check impact"}
            </Button>
            {impact && (
              <div className="max-w-xl overflow-hidden rounded-md border border-border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs text-muted-foreground">
                    <tr>
                      <th className="px-3 py-2 text-left font-medium">Adding</th>
                      <th className="px-3 py-2 text-right font-medium">Fresh people / day</th>
                      <th className="px-3 py-2 text-left font-medium">vs target {fmt(target)}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {impact.map((row) => {
                      const n = typeof row.reach === "number" ? row.reach : null;
                      const c = n != null ? coverage(n, need, multiplier) : null;
                      return (
                        <tr key={row.key} className="border-t border-border">
                          <td className="px-3 py-2">{row.label}</td>
                          <td className="px-3 py-2 text-right tabular-nums">
                            {n != null ? fmt(n) : row.reach === "counting" ? "counting…" : row.reach?.error ? "failed" : "…"}
                          </td>
                          <td className={`px-3 py-2 text-xs ${c ? COVERAGE_CLS[c.status] || "" : "text-muted-foreground"}`}>
                            {c ? (c.status === "covers" ? "covers target" : c.status === "partial" ? "covers need, below target" : "below need") : ""}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {impact && (
              <p className="text-xs text-muted-foreground">
                Each row adds its filters to the rows above. Fresh people per day = high intent in the last day, before removing
                anyone already emailed. If the last row is below need, loosen the filters that cost the most (or add segments).
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
            <Button size="sm" onClick={approve} disabled={approving || (!dirty && Boolean(saved.approved))}>
              <Check className="mr-1.5 h-4 w-4" />
              {approving ? "Saving…" : "Approve Filters"}
            </Button>
            {saved.approved_at && !dirty && (
              <span className="text-sm text-muted-foreground">Approved {fmtDate(saved.approved_at)}</span>
            )}
            {dirty && saved.approved && <span className="text-sm text-amber-700">Unsaved changes</span>}
            {msg && <span className="text-sm text-emerald-700">{msg}</span>}
          </div>
        </div>
      )}
    </Section>
  );
}
