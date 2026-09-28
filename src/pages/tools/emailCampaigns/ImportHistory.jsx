import React, { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { ErrorLine, Loading, Section, fmtDate } from "./ui";

export default function ImportHistory({ companyId, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    supabase
      .from("email_lead_imports")
      .select("id, file_name, mode, status, input_count, kept_count, added_count, removed_from_campaign, error, created_at")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data, error }) => (error ? setErr(error.message) : setRows(data || [])));
  }, [companyId, refreshKey]);

  return (
    <Section title="Push history" description="Newest first. The top row is what's going out now.">
      {err ? (
        <ErrorLine>{err}</ErrorLine>
      ) : !rows ? (
        <Loading />
      ) : !rows.length ? (
        <p className="text-sm text-muted-foreground">No lists pushed yet.</p>
      ) : (
        <div className="overflow-x-auto rounded-md border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">When</th><th className="px-3 py-2 font-medium">File</th><th className="px-3 py-2 font-medium">Mode</th><th className="px-3 py-2 font-medium text-right">Rows</th><th className="px-3 py-2 font-medium text-right">Added</th><th className="px-3 py-2 font-medium text-right">Removed old</th><th className="px-3 py-2 font-medium">Status</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-border">
                  <td className="px-3 py-1.5 text-xs whitespace-nowrap">{fmtDate(r.created_at)}</td>
                  <td className="px-3 py-1.5 max-w-[16rem] truncate">{r.file_name || "—"}</td>
                  <td className="px-3 py-1.5 text-xs">{r.mode}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.input_count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.added_count}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.removed_from_campaign}</td>
                  <td className={`px-3 py-1.5 text-xs ${r.status === "failed" ? "text-destructive" : ""}`} title={r.error || undefined}>
                    {r.status}
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
