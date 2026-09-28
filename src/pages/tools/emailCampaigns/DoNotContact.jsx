import React, { useCallback, useEffect, useState } from "react";
import { Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { smartlead } from "./smartleadApi";
import { ErrorLine, Loading, Section, fmtDate } from "./ui";

const EMAIL_RE = /[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi;

// Source of truth lives in our DB; entries are also pushed to SmartLead's
// global block list. Unsubscribes from the webhook land here automatically.
export default function DoNotContact({ companyId, refreshKey }) {
  const [rows, setRows] = useState(null);
  const [total, setTotal] = useState(0);
  const [q, setQ] = useState("");
  const [input, setInput] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");

  const load = useCallback(async () => {
    let query = supabase
      .from("email_dnc")
      .select("id, email, source, note, synced_to_provider, created_at", { count: "exact" })
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(200);
    const term = q.trim().replace(/[%,()]/g, "");
    if (term) query = query.ilike("email", `%${term}%`);
    const { data, error, count } = await query;
    if (error) setErr(error.message);
    else {
      setRows(data || []);
      setTotal(count || 0);
    }
  }, [companyId, q]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load, refreshKey]);

  const add = async () => {
    const emails = [...new Set((input.match(EMAIL_RE) || []).map((e) => e.toLowerCase()))];
    if (!emails.length) {
      setErr("No email addresses found.");
      return;
    }
    setAdding(true);
    setErr("");
    setMsg("");
    try {
      const r = await smartlead("dnc-add", companyId, { emails, note });
      setMsg(
        `Added ${r.added}.` + (r.synced ? " Blocked in SmartLead too." : ` Not synced to SmartLead: ${r.syncError}`)
      );
      setInput("");
      setNote("");
      load();
    } catch (e) {
      setErr(e.message);
    } finally {
      setAdding(false);
    }
  };

  const remove = async (row) => {
    if (!window.confirm(`Remove ${row.email} from Do Not Contact?`)) return;
    const { error } = await supabase.from("email_dnc").delete().eq("id", row.id);
    if (error) setErr(error.message);
    else load();
  };

  return (
    <Section
      title={`Do Not Contact (${total.toLocaleString()})`}
      description="Checked before every push and blocked in SmartLead. Unsubscribes are added automatically once reply notifications are connected."
    >
      <div className="space-y-4">
        <div className="grid gap-2 sm:grid-cols-[1fr_16rem_auto] sm:items-start">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Paste one or more emails"
            rows={2}
          />
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Reason (optional)" />
          <Button size="sm" onClick={add} disabled={adding || !input.trim()}>
            {adding && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Add
          </Button>
        </div>
        {msg && <p className="text-sm text-emerald-700">{msg}</p>}
        <ErrorLine>{err}</ErrorLine>

        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="max-w-sm" />
        {rows === null ? (
          <Loading />
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">Empty.</p>
        ) : (
          <div className="max-h-96 overflow-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-muted text-left text-xs text-muted-foreground">
                <tr><th className="px-3 py-2 font-medium">Email</th><th className="px-3 py-2 font-medium">Source</th><th className="px-3 py-2 font-medium">Reason</th><th className="px-3 py-2 font-medium">Added</th><th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-border">
                    <td className="px-3 py-1.5 break-all">
                      {r.email}
                      {!r.synced_to_provider && <span className="ml-2 text-xs text-orange-700">not in SmartLead</span>}
                    </td>
                    <td className="px-3 py-1.5 text-xs">{r.source}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{r.note || "—"}</td>
                    <td className="px-3 py-1.5 text-xs text-muted-foreground">{fmtDate(r.created_at)}</td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={() => remove(r)} className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Remove ${r.email}`}>
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}
