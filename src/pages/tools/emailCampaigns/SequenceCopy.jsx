import React, { useEffect, useMemo, useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { smartlead } from "./smartleadApi";
import { ErrorLine, Section } from "./ui";
import { toSafeHtml } from "./richText";
import {
  SAMPLE_LEAD,
  extractVariables,
  fromSmartleadLead,
  renderText,
  resolveVar,
  sequenceSteps,
} from "./validateCopy";

function Highlighted({ text }) {
  const parts = String(text).split(/(\{\{\s*[a-zA-Z0-9_]+\s*\}\})/g);
  return parts.map((p, i) =>
    /^\{\{/.test(p) ? (
      <span key={i} className="rounded bg-sky-50 px-0.5 font-mono text-[0.85em] text-sky-800">
        {p}
      </span>
    ) : (
      <React.Fragment key={i}>{p}</React.Fragment>
    )
  );
}

// Email-like rendering of the sanitized HTML: lists, bold, links, spacing.
const EMAIL_BODY_CLASS = [
  "max-w-[70ch] text-sm leading-relaxed text-foreground/90",
  "[&_p]:my-2 [&_div]:min-h-[1em] [&_p:first-child]:mt-0",
  "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5 [&_li]:my-0.5",
  "[&_b]:font-semibold [&_strong]:font-semibold [&_i]:italic [&_em]:italic [&_u]:underline",
  "[&_a]:text-primary [&_a]:underline [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
  "[&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:font-semibold [&_hr]:my-3 [&_hr]:border-border",
  "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_table]:my-2 [&_table]:border-collapse",
  "[&_.tnv-var]:rounded [&_.tnv-var]:bg-sky-50 [&_.tnv-var]:px-0.5 [&_.tnv-var]:font-mono [&_.tnv-var]:text-[0.85em] [&_.tnv-var]:text-sky-800",
  "[&_.tnv-missing]:rounded [&_.tnv-missing]:bg-red-50 [&_.tnv-missing]:px-0.5 [&_.tnv-missing]:font-mono [&_.tnv-missing]:text-[0.85em] [&_.tnv-missing]:text-red-700",
].join(" ");

// Flatten steps (and A/B variants) into the emails a lead would receive.
// Follow-ups with no subject reply in-thread, so they reuse "Re: <previous>".
function buildEmails(sequences) {
  const out = [];
  let day = 0;
  let lastSubject = "";
  sequenceSteps(sequences).forEach((step, i) => {
    const delay = Number(step.seq_delay_details?.delay_in_days ?? step.delay_in_days ?? 0) || 0;
    if (i > 0) day += delay;
    const variants = step.sequence_variants?.length
      ? step.sequence_variants.map((v, j) => ({ subject: v.subject, body: v.email_body, label: v.variant_label || String.fromCharCode(65 + j) }))
      : [{ subject: step.subject, body: step.email_body, label: null }];
    const stepNo = step.seq_number || i + 1;
    variants.forEach((v) => {
      const threaded = !String(v.subject || "").trim();
      out.push({
        key: `${step.id || i}-${v.label || ""}`,
        step: stepNo,
        day,
        delay: i === 0 ? null : delay,
        label: v.label,
        rawSubject: v.subject,
        subjectForSend: threaded ? (lastSubject ? `Re: ${lastSubject}` : "(no subject)") : v.subject,
        threaded,
        body: v.body,
      });
    });
    const first = variants.find((v) => String(v.subject || "").trim());
    if (first) lastSubject = first.subject;
  });
  return out;
}

function emailHtmlForTest(e, lead, leadLabel) {
  const body = toSafeHtml(e.body, { resolve: (n) => resolveVar(n, lead), forEmail: true });
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#111">
<div style="margin-bottom:16px;padding:8px 10px;background:#f1f5f9;color:#475569;font-size:12px">
Test of step ${e.step}${e.label ? ` (variant ${e.label})` : ""} · day ${e.day} · previewed as ${leadLabel}.
Red [brackets] = variable with no value for this lead.</div>
${body}</div>`;
}

export default function SequenceCopy({ companyId, sequences }) {
  const emails = useMemo(() => buildEmails(sequences), [sequences]);
  const vars = extractVariables(sequences);
  const stepCount = sequenceSteps(sequences).length;

  const [mode, setMode] = useState("preview"); // preview | template
  const [leadKey, setLeadKey] = useState("sample");
  const [campaignLeads, setCampaignLeads] = useState(null);
  const [leadsErr, setLeadsErr] = useState("");
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState("");
  const [sendErr, setSendErr] = useState("");

  // A few real leads from the campaign to preview against.
  useEffect(() => {
    smartlead("leads", companyId, { offset: 0, limit: 25 })
      .then((d) => setCampaignLeads((Array.isArray(d?.data) ? d.data : []).map(fromSmartleadLead).filter((l) => l.email)))
      .catch((e) => setLeadsErr(e.message));
  }, [companyId]);

  const lead = leadKey === "sample" ? SAMPLE_LEAD : campaignLeads?.find((l) => l.email === leadKey) || SAMPLE_LEAD;
  const leadLabel =
    leadKey === "sample"
      ? "a sample lead"
      : `${[lead.first_name, lead.last_name].filter(Boolean).join(" ") || lead.email} (${lead.email})`;

  const sendTest = async () => {
    setSending(true);
    setSendErr("");
    setSendMsg("");
    try {
      const payload = emails.map((e) => ({
        subject: `Step ${e.step}${e.label ? e.label : ""}: ${renderText(e.subjectForSend, lead)}`,
        html: emailHtmlForTest(e, lead, leadLabel),
      }));
      const r = await smartlead("send-test", companyId, { emails: payload });
      setSendMsg(`Sent ${r.sent} test email${r.sent === 1 ? "" : "s"} to ${r.to.join(", ")}.`);
    } catch (e) {
      setSendErr(e.message);
    } finally {
      setSending(false);
    }
  };

  return (
    <Section
      collapsible
      defaultOpen={false}
      title="Sequence & copy"
      description={
        vars.length
          ? `${stepCount} step${stepCount === 1 ? "" : "s"} · uses ${vars.map((v) => `{{${v}}}`).join(", ")}`
          : `${stepCount} step${stepCount === 1 ? "" : "s"} · no personalization variables`
      }
    >
      {!emails.length ? (
        <p className="text-sm text-muted-foreground">This campaign has no sequence steps yet.</p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant={mode === "preview" ? "default" : "outline"} onClick={() => setMode("preview")}>
              Preview
            </Button>
            <Button size="sm" variant={mode === "template" ? "default" : "outline"} onClick={() => setMode("template")}>
              Template
            </Button>
            {mode === "preview" && (
              <Select value={leadKey} onValueChange={setLeadKey}>
                <SelectTrigger className="h-8 w-72">
                  <SelectValue placeholder="Preview as…" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="sample">Sample lead (Jane Doe, Acme Inc)</SelectItem>
                  {(campaignLeads || []).map((l) => (
                    <SelectItem key={l.email} value={l.email}>
                      {[l.first_name, l.last_name].filter(Boolean).join(" ") || l.email}
                      {l.company_name ? ` · ${l.company_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Button size="sm" variant="outline" className="ml-auto" onClick={sendTest} disabled={sending}>
              {sending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Send className="mr-1.5 h-4 w-4" />}
              Send test ({emails.length} email{emails.length === 1 ? "" : "s"})
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            The test goes to the reply-alert address(es) set in Vercel, as {leadLabel}. It's sent via Resend, so it
            checks the copy and formatting — not how SmartLead's mailboxes land in the inbox.
          </p>
          {leadsErr && <p className="text-xs text-muted-foreground">Couldn't load campaign leads for preview: {leadsErr}</p>}
          {sendMsg && <p className="text-sm text-emerald-700">{sendMsg}</p>}
          <ErrorLine>{sendErr}</ErrorLine>

          <ol className="space-y-3">
            {emails.map((e) => {
              const preview = mode === "preview";
              const html = preview
                ? toSafeHtml(e.body, { resolve: (n) => resolveVar(n, lead) })
                : toSafeHtml(e.body);
              return (
                <li key={e.key} className="space-y-2 rounded-md border border-border px-4 py-3">
                  <p className="text-xs text-muted-foreground">
                    Step {e.step}
                    {e.label ? ` · variant ${e.label}` : ""} · {e.delay === null ? "day 0" : `day ${e.day} (+${e.delay}d)`}
                  </p>
                  <p className="text-sm font-medium">
                    {preview ? (
                      renderText(e.subjectForSend, lead)
                    ) : e.threaded ? (
                      <span className="text-muted-foreground">(same thread — no subject)</span>
                    ) : (
                      <Highlighted text={e.rawSubject} />
                    )}
                  </p>
                  {html ? (
                    <div className={EMAIL_BODY_CLASS} dangerouslySetInnerHTML={{ __html: html }} />
                  ) : (
                    <p className="text-sm text-muted-foreground">(empty body)</p>
                  )}
                </li>
              );
            })}
          </ol>
        </div>
      )}
    </Section>
  );
}
