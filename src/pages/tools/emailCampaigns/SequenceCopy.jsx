import React from "react";
import { Section, stripHtml } from "./ui";
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

function Email({ subject, body, label }) {
  return (
    <div className="space-y-1.5">
      {label && <p className="text-xs font-medium text-muted-foreground">Variant {label}</p>}
      <p className="text-sm font-medium">
        {subject ? <Highlighted text={subject} /> : <span className="text-muted-foreground">(same thread — no subject)</span>}
      </p>
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
        <Highlighted text={stripHtml(body) || "(empty body)"} />
      </p>
    </div>
  );
}

export default function SequenceCopy({ sequences }) {
  const steps = sequenceSteps(sequences);
  const vars = extractVariables(sequences);
  let day = 0;

  return (
    <Section
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
