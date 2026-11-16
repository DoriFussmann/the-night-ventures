import React from "react";
import { Link } from "react-router-dom";
import { DataTable, Pill } from "./parts";
import { fmtDate, fmtNum, fmtPct } from "./format";

// Outcome of one prompt, best case over its runs. Order = best to worst.
const OUTCOME = {
  Named: { color: "bg-emerald-500", hint: "The answer names your brand." },
  "Cited, not named": { color: "bg-sky-500", hint: "One of your pages is a source, but the answer does not name you." },
  "Retrieved, not cited": { color: "bg-amber-500", hint: "The AI found one of your pages in its search and did not use it." },
  Absent: { color: "bg-muted-foreground/50", hint: "The AI searched the web and you did not come up." },
  "No search": { color: "bg-muted-foreground/20", hint: "The AI answered from memory, without searching." },
};

function OutcomeBar({ outcomes, tested }) {
  return (
    <div className="space-y-2">
      <div
        className="flex h-3 w-full overflow-hidden rounded bg-muted"
        role="img"
        aria-label={outcomes.map((o) => `${o.label}: ${o.prompts} of ${tested} prompts`).join(". ")}
      >
        {outcomes
          .filter((o) => o.prompts > 0)
          .map((o) => (
            <div
              key={o.label}
              className={`${OUTCOME[o.label].color} border-r border-background last:border-0`}
              style={{ width: `${(o.prompts / tested) * 100}%` }}
              title={`${o.label}: ${o.prompts} of ${tested}`}
            />
          ))}
      </div>
      <ul className="grid gap-x-4 gap-y-1 text-[11px] sm:grid-cols-2 lg:grid-cols-5">
        {outcomes.map((o) => (
          <li key={o.label} className="flex items-start gap-1.5" title={OUTCOME[o.label].hint}>
            <span className={`mt-1 h-2 w-2 shrink-0 rounded-[2px] ${OUTCOME[o.label].color}`} aria-hidden="true" />
            <span>
              <span className="font-medium tabular-nums">{fmtNum(o.prompts)}</span>{" "}
              <span className="text-muted-foreground">
                {o.label} · {fmtPct(o.prompts / tested, 0)}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function CountBar({ n, max, strong }) {
  return (
    <span className="flex items-center gap-2">
      <span className="h-1.5 w-full min-w-[60px] rounded bg-muted" aria-hidden="true">
        <span className={`block h-1.5 rounded ${strong ? "bg-primary" : "bg-muted-foreground/50"}`} style={{ width: `${max > 0 ? (n / max) * 100 : 0}%` }} />
      </span>
    </span>
  );
}

function Change({ now, before, prompts }) {
  if (now === before) return <span className="text-muted-foreground">no change</span>;
  const up = now > before;
  return (
    <span className={up ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
      {before} → {now} of {prompts}
    </span>
  );
}

/** "Named and cited in AI answers" — from Prompt Tests. */
export default function AnswersSection({ answers, companyId }) {
  const testsHref = `/company/${companyId}/aeo-playbook?tab=tests`;
  if (!answers) {
    return (
      <p className="text-sm text-muted-foreground">
        No prompts have been tested yet. Run them in{" "}
        <Link to={testsHref} className="text-foreground underline underline-offset-2">
          AEO Playbook → Prompt Tests
        </Link>{" "}
        to see how often AI answers name your brand and cite your pages.
      </p>
    );
  }
  const { tested, compare } = answers;
  const maxNamed = Math.max(0, ...answers.brands.map((b) => b.named));
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Named</span> means the answer mentions {answers.ownBrand} in its text.{" "}
          <span className="font-medium text-foreground">Cited</span> means it lists one of your pages as a source. Counted over{" "}
          {fmtNum(tested)} test prompts on {answers.engine}; a prompt counts when any of its runs did it. Last run {fmtDate(answers.lastRun)}.
          {answers.partial ? " Partial: very many runs." : ""}
        </p>
        <OutcomeBar outcomes={answers.outcomes} tested={tested} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <div className="min-w-0 space-y-2">
          <div>
            <h3 className="text-xs font-semibold">Who AI names and cites</h3>
            <p className="text-[11px] text-muted-foreground">You and your tracked competitors over the same {fmtNum(tested)} prompts.</p>
          </div>
          <DataTable
            rowKey={(r) => r.name}
            rows={answers.brands}
            columns={[
              {
                key: "name",
                label: "Brand",
                render: (r) => (
                  <span className={r.own ? "font-semibold" : undefined}>
                    {r.name} {r.own ? <Pill tone="info">You</Pill> : null}
                  </span>
                ),
              },
              { key: "bar", label: "Named", className: "w-1/4", render: (r) => <CountBar n={r.named} max={maxNamed} strong={r.own} /> },
              {
                key: "named",
                label: "Prompts",
                hint: "Prompts where the answer names the brand.",
                align: "right",
                render: (r) => `${fmtNum(r.named)} · ${fmtPct(r.named / tested, 0)}`,
              },
              {
                key: "cited",
                label: "Cited",
                hint: "Prompts where the answer lists one of the brand's pages as a source.",
                align: "right",
                render: (r) => `${fmtNum(r.cited)} · ${fmtPct(r.cited / tested, 0)}`,
              },
            ]}
          />
        </div>

        <div className="min-w-0 space-y-2">
          <div>
            <h3 className="text-xs font-semibold">Test cycles</h3>
            <p className="text-[11px] text-muted-foreground">
              {compare ? (
                <>
                  Change on the {fmtNum(compare.prompts)} prompts tested more than once: named{" "}
                  <Change now={compare.named.now} before={compare.named.before} prompts={compare.prompts} />, cited{" "}
                  <Change now={compare.cited.now} before={compare.cited.before} prompts={compare.prompts} />.
                </>
              ) : (
                "No prompt has been tested twice yet, so there is no change to show. It appears after the next cycle on the same prompts."
              )}
            </p>
          </div>
          <DataTable
            rowKey={(r) => r.id}
            rows={answers.cycles}
            columns={[
              { key: "at", label: "Run", render: (r) => fmtDate(r.at) },
              { key: "set", label: "Prompt set", hint: "Baseline is the full prompt set; DM codes are Decision Moments. Different sets are not comparable with each other." },
              { key: "prompts", label: "Prompts", align: "right", render: (r) => fmtNum(r.prompts) },
              { key: "named", label: "Named", align: "right", render: (r) => `${fmtNum(r.named)} · ${fmtPct(r.named / r.prompts, 0)}` },
              { key: "cited", label: "Cited", align: "right", render: (r) => `${fmtNum(r.cited)} · ${fmtPct(r.cited / r.prompts, 0)}` },
            ]}
          />
        </div>
      </div>

      <p className="text-[11px] text-muted-foreground">
        These are prompts we test, not real conversations. Per-prompt results are in{" "}
        <Link to={testsHref} className="text-foreground underline underline-offset-2">
          Prompt Tests
        </Link>
        .
      </p>
    </div>
  );
}
