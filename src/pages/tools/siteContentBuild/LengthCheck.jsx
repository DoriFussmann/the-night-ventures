import React, { useMemo, useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { checkContentLengths } from "./checkLengths";

/** Paste ChatGPT's response; lists every meta / description outside its length rule. */
export default function LengthCheck() {
  const [text, setText] = useState("");
  const report = useMemo(() => (text.trim() ? checkContentLengths(text) : null), [text]);
  const failures = report ? report.results.filter((r) => !r.ok) : [];

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-xs text-foreground">Check lengths</h2>
        <p className="text-sm text-muted-foreground">
          Paste ChatGPT&apos;s full response to see every title and description that would fail
          the build or miss its target. The Cursor prompt fixes these before building; this shows
          you what it will change.
        </p>
      </div>

      <div className="space-y-2">
        <Label htmlFor="length-check-input">ChatGPT&apos;s full response</Label>
        <Textarea
          id="length-check-input"
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-h-[120px] font-mono text-xs"
          placeholder={'=== PAGE: home ===\n```yaml\nroute: "/"\nmeta_title: "..."'}
        />
      </div>

      <div aria-live="polite" className="space-y-2">
        {!report ? null : report.blocks === 0 ? (
          <p className="text-sm text-destructive">
            No &quot;=== PAGE: … ===&quot; or &quot;=== SERVICE: … ===&quot; blocks found. Paste the
            whole response, not only the QA section.
          </p>
        ) : (
          <>
            <p
              className={
                failures.length
                  ? "flex items-center gap-1.5 text-sm text-amber-700 dark:text-amber-300"
                  : "flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-300"
              }
            >
              {failures.length ? (
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
              ) : (
                <Check className="h-4 w-4 shrink-0" aria-hidden="true" />
              )}
              {failures.length
                ? `${failures.length} of ${report.results.length} fields out of range`
                : `All ${report.results.length} fields in range`}
            </p>

            {failures.length ? (
              <div className="overflow-x-auto rounded-md border border-border">
                <table className="w-full min-w-[560px] text-left text-xs">
                  <thead className="bg-muted/50 text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">Where</th>
                      <th scope="col" className="px-3 py-2 font-medium">Field</th>
                      <th scope="col" className="px-3 py-2 font-medium">Length</th>
                      <th scope="col" className="px-3 py-2 font-medium">Text</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {failures.map((r) => (
                      <tr key={`${r.where}-${r.field}`} className="align-top">
                        <td className="whitespace-nowrap px-3 py-2 text-foreground">{r.where}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-mono">{r.field}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="text-destructive">{r.length}</span>
                          <span className="text-muted-foreground"> (want {r.rule}, {r.problem})</span>
                        </td>
                        <td className="px-3 py-2 text-muted-foreground">{r.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {report.missing.length ? (
              <p className="text-xs text-destructive">
                Missing:{" "}
                {report.missing.map((m) => `${m.where} → ${m.field}`).join(", ")}
              </p>
            ) : null}
          </>
        )}
      </div>
    </section>
  );
}
