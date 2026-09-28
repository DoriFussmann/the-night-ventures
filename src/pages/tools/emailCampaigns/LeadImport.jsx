import React, { useMemo, useState } from "react";
import { CheckCircle2, Upload } from "lucide-react";
import Papa from "papaparse";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { smartlead } from "./smartleadApi";
import { cleanLeads, OUTPUT_FIELDS } from "./cleanLeads";
import { leadsMissingVariables, validateCopy } from "./validateCopy";
import { ErrorLine, Loading, Section, num } from "./ui";

const PUSH_CHUNK = 2000; // leads per server call (server batches 400 to SmartLead)

// Upload → clean → check (DNC, already pushed, copy variables) → push.
// Default mode is Replace: existing campaign leads are removed first so the
// newest list is what goes out (LIFO). Leads that replied are kept.
export default function LeadImport({ companyId, sequences, currentLeadCount, onDone }) {
  const [fileName, setFileName] = useState("");
  const [rows, setRows] = useState(null);
  const [includePersonal, setIncludePersonal] = useState(false);
  const [parseErr, setParseErr] = useState("");
  const [checking, setChecking] = useState(false);
  const [blocked, setBlocked] = useState(null); // { dnc:Set, existing:Set }
  const [mode, setMode] = useState("replace");
  const [skipIncomplete, setSkipIncomplete] = useState(true);
  const [ackUnsupported, setAckUnsupported] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [progress, setProgress] = useState(null); // { phase, removed, pushed, total }
  const [pushErr, setPushErr] = useState("");
  const [result, setResult] = useState(null);

  const reset = () => {
    setRows(null);
    setBlocked(null);
    setParseErr("");
    setPushErr("");
    setResult(null);
    setConfirming(false);
    setAckUnsupported(false);
  };

  const handleFile = (file) => {
    if (!file) return;
    reset();
    setFileName(file.name);
    setChecking(true);
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      complete: async (res) => {
        try {
          setRows(res.data);
          // Check every email in the file once; cleaning options only narrow it.
          const all = cleanLeads(res.data, { includePersonal: true }).leads.map((l) => l.email);
          const d = await smartlead("precheck", companyId, { emails: all });
          setBlocked({ dnc: new Set(d.dnc), existing: new Set(d.existing) });
        } catch (err) {
          setParseErr(err?.message || "Could not check the file");
        } finally {
          setChecking(false);
        }
      },
      error: (err) => {
        setParseErr(err?.message || "Could not read the file");
        setChecking(false);
      },
    });
  };

  const prepared = useMemo(() => {
    if (!rows || !blocked) return null;
    const cleaned = cleanLeads(rows, { includePersonal });
    const afterDnc = cleaned.leads.filter((l) => !blocked.dnc.has(l.email));
    const fresh = afterDnc.filter((l) => !blocked.existing.has(l.email));
    const validation = validateCopy(sequences, fresh);
    const incomplete = leadsMissingVariables(sequences, fresh);
    const incompleteSet = new Set(incomplete.map((l) => l.email));
    const final = skipIncomplete ? fresh.filter((l) => !incompleteSet.has(l.email)) : fresh;
    return {
      stats: cleaned.stats,
      dncCount: cleaned.leads.length - afterDnc.length,
      existingCount: afterDnc.length - fresh.length,
      validation,
      incompleteCount: incomplete.length,
      unsupported: validation.variables.filter((v) => !v.supported),
      final,
    };
  }, [rows, blocked, includePersonal, sequences, skipIncomplete]);

  const canPush =
    prepared && prepared.final.length > 0 && (!prepared.unsupported.length || ackUnsupported) && !progress;

  const runPush = async () => {
    setConfirming(false);
    setPushErr("");
    setResult(null);
    const leads = prepared.final;
    let importId = null;
    try {
      setProgress({ phase: "Starting", removed: 0, pushed: 0, total: leads.length });
      ({ importId } = await smartlead("import-start", companyId, {
        mode,
        fileName,
        inputCount: prepared.stats.input,
        keptCount: leads.length,
        stats: {
          clean: prepared.stats,
          dnc_removed: prepared.dncCount,
          already_pushed_removed: prepared.existingCount,
          incomplete_removed: skipIncomplete ? prepared.incompleteCount : 0,
        },
      }));

      let removed = 0;
      if (mode === "replace") {
        let kept = 0;
        for (let guard = 0; guard < 500; guard++) {
          setProgress((p) => ({ ...p, phase: "Removing current campaign leads", removed }));
          const r = await smartlead("clear-batch", companyId, { importId, offset: kept });
          removed += r.removed;
          kept += r.kept;
          if (r.remaining <= 0 || r.stuck) break;
        }
      }

      const agg = {};
      for (let i = 0; i < leads.length; i += PUSH_CHUNK) {
        setProgress((p) => ({ ...p, phase: "Pushing new leads", removed, pushed: i }));
        const part = leads.slice(i, i + PUSH_CHUNK);
        const r = await smartlead("leads-import", companyId, {
          importId,
          leads: part,
          final: i + PUSH_CHUNK >= leads.length,
        });
        for (const [k, v] of Object.entries(r)) agg[k] = (agg[k] || 0) + (Number(v) || 0);
      }
      setResult({ ...agg, removed });
      setRows(null);
      setBlocked(null);
      onDone?.();
    } catch (err) {
      setPushErr(err?.message || "Push failed");
      if (importId) smartlead("import-fail", companyId, { importId, error: err?.message }).catch(() => {});
    } finally {
      setProgress(null);
    }
  };

  const preview = prepared?.final.slice(0, 50) || [];

  return (
    <Section
      title="Push a new lead list"
      description="Drop the AudienceLab CSV. It's cleaned, checked against the Do Not Contact list and everyone pushed before, validated against the copy, then pushed."
    >
      <div className="space-y-4">
        <div
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => {
            e.preventDefault();
            handleFile(e.dataTransfer?.files?.[0]);
          }}
          className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-4 py-6 text-center"
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            Drag a CSV here, or{" "}
            <label className="cursor-pointer font-medium text-primary underline">
              choose a file
              <input
                type="file"
                accept=".csv,text/csv"
                className="hidden"
                onChange={(e) => {
                  handleFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
            </label>
          </p>
          {fileName && <p className="text-xs text-muted-foreground">{fileName}</p>}
        </div>

        {checking && <Loading label="Cleaning and checking…" />}
        <ErrorLine>{parseErr}</ErrorLine>

        {prepared && (
          <div className="space-y-4">
            <table className="w-full max-w-md text-sm">
              <tbody className="[&_td]:py-0.5 [&_td:last-child]:text-right [&_td:last-child]:tabular-nums">
                <tr><td>Rows in file</td><td>{prepared.stats.input}</td></tr>
                <tr className="text-muted-foreground"><td>− no email</td><td>{prepared.stats.dropped_no_email}</td></tr>
                <tr className="text-muted-foreground"><td>− personal email only</td><td>{prepared.stats.dropped_personal}</td></tr>
                <tr className="text-muted-foreground"><td>− duplicates in file</td><td>{prepared.stats.duplicates_removed}</td></tr>
                <tr className="text-muted-foreground"><td>− on Do Not Contact</td><td>{prepared.dncCount}</td></tr>
                <tr className="text-muted-foreground"><td>− already pushed before</td><td>{prepared.existingCount}</td></tr>
                {skipIncomplete && (
                  <tr className="text-muted-foreground"><td>− missing copy variables</td><td>{prepared.incompleteCount}</td></tr>
                )}
                <tr className="border-t border-border font-semibold"><td className="pt-1">Ready to push</td><td className="pt-1">{prepared.final.length}</td></tr>
              </tbody>
            </table>

            <div className="flex flex-wrap gap-x-6 gap-y-2">
              <div className="flex items-center gap-2">
                <Switch id="incl_personal" checked={includePersonal} onCheckedChange={setIncludePersonal} />
                <Label htmlFor="incl_personal" className="text-sm font-normal">Include personal emails</Label>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="skip_incomplete" checked={skipIncomplete} onCheckedChange={setSkipIncomplete} />
                <Label htmlFor="skip_incomplete" className="text-sm font-normal">Skip leads missing copy variables</Label>
              </div>
            </div>

            {prepared.validation.variables.length > 0 && (
              <div className="rounded-md border border-border px-3 py-2.5 space-y-1.5">
                <p className="text-xs font-medium">Copy variables vs. this list</p>
                <ul className="space-y-0.5 text-sm">
                  {prepared.validation.variables.map((v) => (
                    <li key={v.name} className={!v.supported ? "text-destructive" : v.missing ? "text-orange-700" : "text-muted-foreground"}>
                      <span className="font-mono">{`{{${v.name}}}`}</span>{" "}
                      {!v.supported
                        ? "— this list never provides it; it'll render blank for everyone"
                        : v.missing
                          ? `— blank for ${v.missing} of ${v.total}`
                          : "— filled for all"}
                    </li>
                  ))}
                </ul>
                {prepared.unsupported.length > 0 && (
                  <label className="flex items-center gap-2 pt-1 text-sm">
                    <Checkbox checked={ackUnsupported} onCheckedChange={(v) => setAckUnsupported(Boolean(v))} />
                    I know — push anyway
                  </label>
                )}
              </div>
            )}

            <details className="rounded-md border border-border">
              <summary className="cursor-pointer px-3 py-2 text-sm text-muted-foreground">
                Preview (first {preview.length} of {prepared.final.length})
              </summary>
              <div className="max-h-96 overflow-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
                    <tr>{OUTPUT_FIELDS.map((f) => <th key={f} className="whitespace-nowrap px-2 py-1.5 font-medium">{f}</th>)}</tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className="border-t border-border">
                        {OUTPUT_FIELDS.map((f) => <td key={f} className="max-w-[16rem] truncate whitespace-nowrap px-2 py-1">{row[f]}</td>)}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>

            <div className="space-y-2">
              <p className="text-xs font-medium">How to push</p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant={mode === "replace" ? "default" : "outline"} onClick={() => setMode("replace")}>
                  Replace current leads
                </Button>
                <Button size="sm" variant={mode === "append" ? "default" : "outline"} onClick={() => setMode("append")}>
                  Add to current leads
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {mode === "replace"
                  ? `Removes the ${currentLeadCount.toLocaleString()} leads now in the campaign — including mid-sequence follow-ups — except anyone who replied, then adds this list. Newest list goes out first.`
                  : "Adds this list behind the existing queue. SmartLead sends older leads first."}
              </p>
            </div>

            {!confirming ? (
              <Button size="sm" disabled={!canPush} onClick={() => setConfirming(true)}>
                Push {prepared.final.length.toLocaleString()} leads
              </Button>
            ) : (
              <div className="space-y-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-3">
                <p className="text-sm">
                  {mode === "replace"
                    ? `Remove current leads (except repliers) and push ${prepared.final.length.toLocaleString()} new ones?`
                    : `Add ${prepared.final.length.toLocaleString()} leads to the campaign?`}{" "}
                  Campaign status doesn't change.
                </p>
                <div className="flex gap-2">
                  <Button size="sm" onClick={runPush}>Confirm</Button>
                  <Button size="sm" variant="outline" onClick={() => setConfirming(false)}>Cancel</Button>
                </div>
              </div>
            )}
          </div>
        )}

        {progress && (
          <Loading
            label={`${progress.phase}… ${progress.removed ? `${progress.removed.toLocaleString()} removed · ` : ""}${progress.pushed.toLocaleString()} / ${progress.total.toLocaleString()} pushed`}
          />
        )}
        <ErrorLine>{pushErr}</ErrorLine>
        {result && (
          <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            <span>
              Done. {result.removed ? `Removed ${result.removed.toLocaleString()} old leads. ` : ""}
              Added {num(result.added)}; SmartLead rejected {num(result.invalid)} invalid, {num(result.blocked_by_provider)} blocked,{" "}
              {num(result.already_in_campaign) + num(result.duplicates)} duplicates.
              {num(result.skipped_dnc) + num(result.skipped_existing) > 0 &&
                ` Server skipped ${num(result.skipped_dnc) + num(result.skipped_existing)} more (DNC / already pushed).`}
            </span>
          </div>
        )}
      </div>
    </Section>
  );
}

