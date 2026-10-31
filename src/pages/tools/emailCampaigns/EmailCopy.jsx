import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Loader2, Save, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { fromInstantlyLead } from "../../../../lib/instantly/mapping.js";
import { instantly } from "./instantlyApi";
import { ErrorLine, Section, fmtDate } from "./ui";
import { toSafeHtml } from "./richText";
import { SAMPLE_LEAD, VARIABLE_MAP, extractVariables, renderText, resolveVar } from "./validateCopy";

// Email-like rendering of the preview: paragraphs, links, variable marks.
const EMAIL_BODY_CLASS = [
  "max-w-[70ch] text-sm leading-relaxed text-foreground/90",
  "[&_a]:text-primary [&_a]:underline",
  "[&_.tnv-var]:rounded [&_.tnv-var]:bg-sky-50 [&_.tnv-var]:px-0.5 [&_.tnv-var]:font-mono [&_.tnv-var]:text-[0.85em] [&_.tnv-var]:text-sky-800",
  "[&_.tnv-missing]:rounded [&_.tnv-missing]:bg-red-50 [&_.tnv-missing]:px-0.5 [&_.tnv-missing]:font-mono [&_.tnv-missing]:text-[0.85em] [&_.tnv-missing]:text-red-700",
].join(" ");

const VARS = Object.keys(VARIABLE_MAP);

// The single outbound email. Written here, saved in TNV, and written to the
// Instantly campaign as its only step (single touch: no follow-ups).
export default function EmailCopy({ companyId, copy, liveCopy, inSync, syncedAt, onSaved }) {
  const initial = copy || liveCopy || { subject: "", body: "" };
  const [subject, setSubject] = useState(initial.subject);
  const [body, setBody] = useState(initial.body);
  const [saving, setSaving] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");
  const [err, setErr] = useState("");
  const [leadKey, setLeadKey] = useState("sample");
  const [campaignLeads, setCampaignLeads] = useState([]);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const bodyRef = useRef(null);
  const lastField = useRef("body");

  useEffect(() => {
    const next = copy || liveCopy || { subject: "", body: "" };
    setSubject(next.subject);
    setBody(next.body);
  }, [copy, liveCopy]);

  // A few real leads from the campaign to preview against.
  useEffect(() => {
    instantly("leads", companyId, { limit: 25 })
      .then((d) => setCampaignLeads((d?.items || []).map(fromInstantlyLead).filter((l) => l.email)))
      .catch(() => setCampaignLeads([]));
  }, [companyId]);

  const draft = useMemo(() => ({ subject, body }), [subject, body]);
  const vars = extractVariables(draft);
  const unknown = vars.filter((v) => !VARIABLE_MAP[v]);
  const dirty = subject !== (copy?.subject || "") || body !== (copy?.body || "");
  const lead = leadKey === "sample" ? SAMPLE_LEAD : campaignLeads.find((l) => l.email === leadKey) || SAMPLE_LEAD;
  const leadLabel =
    leadKey === "sample" ? "a sample lead" : `${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email} (${lead.email})`;

  const insertVar = (name) => {
    const token = `{{${name}}}`;
    if (lastField.current === "subject") {
      setSubject((s) => `${s}${s && !s.endsWith(" ") ? " " : ""}${token}`);
      return;
    }
    const el = bodyRef.current;
    const start = el?.selectionStart ?? body.length;
    const end = el?.selectionEnd ?? body.length;
    setBody(body.slice(0, start) + token + body.slice(end));
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  const save = async () => {
    setSaving(true);
    setErr("");
    setSaveMsg("");
    try {
      const r = await instantly("copy-save", companyId, { subject, body });
      if (r.synced) setSaveMsg("Saved and synced to Instantly.");
      else setErr(`Saved in TNV, but Instantly wasn't updated: ${r.syncError}`);
      await onSaved?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setSending(true);
    setErr("");
    setSendMsg("");
    try {
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">
<div style="margin-bottom:16px;padding:8px 10px;background:#f1f5f9;color:#475569;font-size:12px">
Test, previewed as ${leadLabel}. Red [brackets] = variable with no value for this lead.</div>
${toSafeHtml(body, { resolve: (n) => resolveVar(n, lead), forEmail: true })}</div>`;
      const r = await instantly("send-test", companyId, { emails: [{ subject: renderText(subject, lead), html }] });
      setSendMsg(`Sent a test to ${r.to.join(", ")}.`);
    } catch (e) {
      setErr(e.message);
    } finally {
      setSending(false);
    }
  };

  const status = !copy
    ? liveCopy
      ? "Loaded from Instantly — save to keep it in TNV"
      : "No email yet"
    : inSync
      ? `In sync with Instantly${syncedAt ? ` · saved ${fmtDate(syncedAt)}` : ""}`
      : "Instantly differs from this copy — save to sync";

  return (
    <Section
      collapsible
      defaultOpen={!copy || !inSync}
      done={Boolean(copy && inSync)}
      title="Email copy"
      summary={copy ? `${copy.subject} · ${status}` : status}
      description="Single touch: one email, no follow-ups. Saving writes it to the Instantly campaign as its only step."
    >
      <div className="grid gap-5 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="copy_subject">Subject</Label>
            <Input
              id="copy_subject"
              value={subject}
              onFocus={() => (lastField.current = "subject")}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="Quick question, {{first_name}}"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="copy_body">Body</Label>
            <Textarea
              id="copy_body"
              ref={bodyRef}
              value={body}
              onFocus={() => (lastField.current = "body")}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-[260px] font-mono text-[13px]"
              placeholder={"Hi {{first_name}},\n\n…"}
            />
            <p className="text-xs text-muted-foreground">Plain text. A blank line starts a new paragraph.</p>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {VARS.map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => insertVar(v)}
                className="rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground hover:bg-accent"
              >
                {`{{${v}}}`}
              </button>
            ))}
          </div>
          {unknown.length > 0 && (
            <p className="text-xs text-destructive">
              {unknown.map((v) => `{{${v}}}`).join(", ")} — no lead source fills {unknown.length === 1 ? "this" : "these"}; it
              will render blank.
            </p>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" onClick={save} disabled={saving || !subject.trim() || !body.trim() || (!dirty && inSync)}>
              {saving ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
              {saving ? "Saving…" : "Save & sync to Instantly"}
            </Button>
            <Button size="sm" variant="outline" onClick={sendTest} disabled={sending || !body.trim()}>
              {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              Send test
            </Button>
            <span className={`text-xs ${copy && inSync && !dirty ? "text-emerald-700" : "text-muted-foreground"}`}>
              {copy && inSync && !dirty && <CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />}
              {dirty ? "Unsaved changes" : status}
            </span>
          </div>
          {saveMsg && <p className="text-sm text-emerald-700">{saveMsg}</p>}
          {sendMsg && <p className="text-sm text-emerald-700">{sendMsg}</p>}
          <ErrorLine>{err}</ErrorLine>
          <p className="text-xs text-muted-foreground">
            The test goes to the reply-alert address(es) set in Vercel via Resend: it checks copy and formatting, not how
            Instantly&apos;s mailboxes land in the inbox.
          </p>
        </div>

        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <Label>Preview</Label>
            <Select value={leadKey} onValueChange={setLeadKey}>
              <SelectTrigger className="h-8 w-64">
                <SelectValue placeholder="Preview as…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="sample">Sample lead (Jane Doe, Acme Inc)</SelectItem>
                {campaignLeads.map((l) => (
                  <SelectItem key={l.email} value={l.email}>
                    {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.email}
                    {l.company_name ? ` · ${l.company_name}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2 rounded-md border border-border px-4 py-3">
            <p className="text-sm font-medium">{renderText(subject, lead) || <span className="text-muted-foreground">(no subject)</span>}</p>
            {body.trim() ? (
              <div className={EMAIL_BODY_CLASS} dangerouslySetInnerHTML={{ __html: toSafeHtml(body, { resolve: (n) => resolveVar(n, lead) }) }} />
            ) : (
              <p className="text-sm text-muted-foreground">(empty body)</p>
            )}
          </div>
        </div>
      </div>
    </Section>
  );
}
