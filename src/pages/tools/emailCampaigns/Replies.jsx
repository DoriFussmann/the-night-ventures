import React, { useCallback, useEffect, useState } from "react";
import { BellRing, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { instantly } from "./instantlyApi";
import { ErrorLine, Loading, Section, fmtDate } from "./ui";

// Replies arrive via the Instantly webhook (reply_received) → email_replies.
// The same webhook emails a notification and feeds the sidebar badge. The
// connect button also registers sent / bounced / unsubscribed tracking.
export default function Replies({ companyId }) {
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState("");
  const [hook, setHook] = useState({ state: "checking" }); // checking | on | off | error
  const [connecting, setConnecting] = useState(false);
  const [open, setOpen] = useState(null);
  const [dncBusy, setDncBusy] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("email_replies")
      .select("id, lead_email, lead_name, subject, body_text, received_at, read_at")
      .eq("company_id", companyId)
      .order("received_at", { ascending: false })
      .limit(100);
    if (error) setErr(error.message);
    else setRows(data || []);
  }, [companyId]);

  const checkHook = useCallback(async () => {
    try {
      const d = await instantly("webhook-status", companyId);
      setHook({ state: d.missing?.length ? "off" : "on", missing: d.missing || [] });
    } catch (e) {
      setHook({ state: "error", message: e.message });
    }
  }, [companyId]);

  useEffect(() => {
    load();
    checkHook();
  }, [load, checkHook]);

  const connect = async () => {
    setConnecting(true);
    try {
      await instantly("webhook-register", companyId);
      await checkHook();
    } catch (e) {
      setHook({ state: "error", message: e.message });
    } finally {
      setConnecting(false);
    }
  };

  const markRead = async (ids) => {
    if (!ids.length) return;
    const now = new Date().toISOString();
    await supabase.from("email_replies").update({ read_at: now }).in("id", ids);
    setRows((r) => r.map((x) => (ids.includes(x.id) ? { ...x, read_at: now } : x)));
    window.dispatchEvent(new Event("email-replies-read"));
  };

  const toggle = (row) => {
    setOpen(open === row.id ? null : row.id);
    if (!row.read_at) markRead([row.id]);
  };

  const addDnc = async (email) => {
    setDncBusy(email);
    try {
      await instantly("dnc-add", companyId, { emails: [email], note: "Added from reply" });
    } catch (e) {
      setErr(e.message);
    } finally {
      setDncBusy("");
    }
  };

  const unread = (rows || []).filter((r) => !r.read_at);

  return (
    <Section
      collapsible
      defaultOpen={false}
      title={
        <span className="flex items-center gap-2">
          Replies
          {unread.length > 0 && <Badge className="bg-sky-600 text-white border-sky-600">{unread.length} new</Badge>}
        </span>
      }
      description={
        hook.state === "on"
          ? "Live — new replies land here and trigger an email notification."
          : hook.missing?.length
            ? `Not connected: ${hook.missing.join(", ")}. Replies are captured from the moment tracking is connected.`
            : "Replies are captured from the moment tracking is connected."
      }
      actions={
        <>
          {unread.length > 0 && (
            <Button size="sm" variant="outline" onClick={() => markRead(unread.map((r) => r.id))}>
              Mark all read
            </Button>
          )}
          {hook.state !== "on" && hook.state !== "checking" && (
            <Button size="sm" onClick={connect} disabled={connecting}>
              {connecting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <BellRing className="mr-1.5 h-4 w-4" />}
              Connect tracking
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-3">
        {hook.state === "error" && <ErrorLine>Webhook: {hook.message}</ErrorLine>}
        <ErrorLine>{err}</ErrorLine>
        {rows === null ? (
          <Loading />
        ) : !rows.length ? (
          <p className="text-sm text-muted-foreground">No replies yet.</p>
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {rows.map((r) => (
              <li key={r.id}>
                <button type="button" onClick={() => toggle(r)} className="flex w-full items-start gap-3 px-3 py-2 text-left hover:bg-accent">
                  <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${r.read_at ? "bg-transparent" : "bg-sky-600"}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-sm ${r.read_at ? "" : "font-semibold"}`}>
                      {r.lead_name ? `${r.lead_name} · ` : ""}{r.lead_email || "unknown"}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {r.subject || (r.body_text || "").slice(0, 120)}
                    </span>
                  </span>
                  <span className="shrink-0 text-xs text-muted-foreground">{fmtDate(r.received_at)}</span>
                </button>
                {open === r.id && (
                  <div className="space-y-2 px-8 pb-3">
                    <p className="whitespace-pre-wrap text-sm">{r.body_text || "(no text captured)"}</p>
                    {r.lead_email && (
                      <Button size="sm" variant="outline" onClick={() => addDnc(r.lead_email)} disabled={dncBusy === r.lead_email}>
                        Add to Do Not Contact
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </Section>
  );
}
