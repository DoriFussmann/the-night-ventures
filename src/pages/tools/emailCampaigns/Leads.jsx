import React, { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { smartlead } from "./smartleadApi";
import { ErrorLine, Loading, Section, fmtDate } from "./ui";

const PAGE = 50;

function Pager({ offset, total, onChange }) {
  return (
    <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
      <span className="tabular-nums">
        {total ? `${offset + 1}–${Math.min(offset + PAGE, total)} of ${total.toLocaleString()}` : "0"}
      </span>
      <div className="flex gap-2">
        <Button size="sm" variant="outline" disabled={offset === 0} onClick={() => onChange(Math.max(0, offset - PAGE))}>Previous</Button>
        <Button size="sm" variant="outline" disabled={offset + PAGE >= total} onClick={() => onChange(offset + PAGE)}>Next</Button>
      </div>
    </div>
  );
}

// Leads currently inside the SmartLead campaign, with per-lead status.
function InCampaign({ companyId, refreshKey }) {
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setErr("");
    smartlead("leads", companyId, { offset, limit: PAGE })
      .then((d) => !cancelled && setData(d))
      .catch((e) => !cancelled && setErr(e.message));
    return () => {
      cancelled = true;
    };
  }, [companyId, offset, refreshKey]);

  if (err) return <ErrorLine>{err}</ErrorLine>;
  if (!data) return <Loading />;
  const list = Array.isArray(data?.data) ? data.data : [];
  const total = Number(data?.total_leads) || 0;
  return (
    <div className="space-y-3">
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
            <tr><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Added</th></tr>
          </thead>
          <tbody>
            {list.map((row, i) => {
              const lead = row.lead || row;
              return (
                <tr key={lead.id || i} className="border-t border-border">
                  <td className="px-3 py-1.5 break-all">{lead.email}</td>
                  <td className="px-3 py-1.5">{[lead.first_name, lead.last_name].filter(Boolean).join(" ") || "—"}</td>
                  <td className="px-3 py-1.5">{lead.company_name || "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{row.status || "—"}</td>
                  <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmtDate(row.created_at)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <Pager offset={offset} total={total} onChange={setOffset} />
    </div>
  );
}

// Everyone we've ever pushed for this company (our DB) — searchable.
function AllPushed({ companyId, refreshKey }) {
  const [offset, setOffset] = useState(0);
  const [q, setQ] = useState("");
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    let query = supabase
      .from("email_leads")
      .select("email, first_name, last_name, company_name, job_title, created_at", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .range(offset, offset + PAGE - 1);
    const term = q.trim().replace(/[%,()]/g, "");
    if (term) query = query.or(`email.ilike.%${term}%,company_name.ilike.%${term}%,last_name.ilike.%${term}%`);
    const { data, error, count } = await query;
    if (error) setErr(error.message);
    else {
      setRows(data || []);
      setTotal(count || 0);
    }
  }, [companyId, offset, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  return (
    <div className="space-y-3">
      <Input
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOffset(0);
        }}
        placeholder="Search email, company, last name"
        className="max-w-sm"
      />
      <ErrorLine>{err}</ErrorLine>
      {rows === null ? (
        <Loading />
      ) : (
        <>
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Name</th><th className="px-3 py-2 font-medium">Title</th><th className="px-3 py-2 font-medium">Company</th><th className="px-3 py-2 font-medium">Pushed</th></tr>
              </thead>
              <tbody>
                {rows.map((l) => (
                  <tr key={l.email} className="border-t border-border">
                    <td className="px-3 py-1.5 break-all">{l.email}</td>
                    <td className="px-3 py-1.5">{[l.first_name, l.last_name].filter(Boolean).join(" ") || "—"}</td>
                    <td className="px-3 py-1.5">{l.job_title || "—"}</td>
                    <td className="px-3 py-1.5">{l.company_name || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmtDate(l.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager offset={offset} total={total} onChange={setOffset} />
        </>
      )}
    </div>
  );
}

export default function Leads({ companyId, refreshKey }) {
  const [tab, setTab] = useState("campaign");
  return (
    <Section
      collapsible
      defaultOpen={false}
      title="Leads"
      description={
        tab === "campaign"
          ? "What's in the SmartLead campaign right now."
          : "Everyone ever pushed for this company. Nobody here is pushed again."
      }
      actions={
        <>
          <Button size="sm" variant={tab === "campaign" ? "default" : "outline"} onClick={() => setTab("campaign")}>In campaign</Button>
          <Button size="sm" variant={tab === "all" ? "default" : "outline"} onClick={() => setTab("all")}>All pushed</Button>
        </>
      }
    >
      {tab === "campaign" ? (
        <InCampaign companyId={companyId} refreshKey={refreshKey} />
      ) : (
        <AllPushed companyId={companyId} refreshKey={refreshKey} />
      )}
    </Section>
  );
}
