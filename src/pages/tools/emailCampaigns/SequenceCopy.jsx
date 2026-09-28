import React from "react";
import { Section } from "./ui";
import { toSafeHtml } from "./richText";
import { extractVariables, sequenceSteps } from "./validateCopy";

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
].join(" ");

function Email({ subject, body, label }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-medium text-muted-foreground">Variant {label}</p>}
      <p className="text-sm font-medium">
        {subject ? <Highlighted text={subject} /> : <span className="text-muted-foreground">(same thread — no subject)</span>}
      </p>
      {String(body || "").trim() ? (
        <div className={EMAIL_BODY_CLASS} dangerouslySetInnerHTML={{ __html: toSafeHtml(body) }} />
      ) : (
        <p className="text-sm text-muted-foreground">(empty body)</p>
      )}
    </div>
  );
}

export default function SequenceCopy({ sequences }) {
  const steps = sequenceSteps(sequences);
  const vars = extractVariables(sequences);
  let day = 0;

  return (
    <Section
      collapsible
      defaultOpen={false}
      title="Sequence & copy"
      description={
        vars.length
          ? `${steps.length} step${steps.length === 1 ? "" : "s"} · uses ${vars.map((v) => `{{${v}}}`).join(", ")}`
          : `${steps.length} step${steps.length === 1 ? "" : "s"} · no personalization variables`
      }
    >
      {!steps.length ? (
        <p className="text-sm text-muted-foreground">This campaign has no sequence steps yet.</p>
      ) : (
        <ol className="space-y-3">
          {steps.map((step, i) => {
            const delay = Number(step.seq_delay_details?.delay_in_days ?? step.delay_in_days ?? 0) || 0;
            day += i === 0 ? 0 : delay;
            const variants = step.sequence_variants || [];
            return (
              <li key={step.id || i} className="rounded-md border border-border px-4 py-3 space-y-3">
                <p className="text-xs text-muted-foreground">
                  Step {step.seq_number || i + 1} · {i === 0 ? "day 0" : `day ${day} (+${delay}d)`}
                </p>
                {variants.length ? (
                  <div className="space-y-4">
                    {variants.map((v, j) => (
                      <Email key={v.id || j} subject={v.subject} body={v.email_body} label={v.variant_label || String.fromCharCode(65 + j)} />
                    ))}
                  </div>
                ) : (
                  <Email subject={step.subject} body={step.email_body} />
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Section>
  );
}
