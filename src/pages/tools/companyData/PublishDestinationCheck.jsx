import React, { useEffect, useState } from "react";
import { AlertTriangle, Check, Loader2, Minus, PlugZap, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { checkPublishDestination } from "./publishDestinationApi";

const STATUS = {
  ok: { icon: Check, className: "text-emerald-600 dark:text-emerald-400", word: "Passed" },
  warn: { icon: AlertTriangle, className: "text-amber-600 dark:text-amber-400", word: "Warning" },
  fail: { icon: X, className: "text-destructive", word: "Failed" },
  skip: { icon: Minus, className: "text-muted-foreground", word: "Not checked" },
};

/**
 * Check Connection button and step-by-step result for the Publish Destination dialog.
 * Checks the values currently typed in the dialog, saved or not.
 * @param {{ owner: string, repo: string, tokenKey: string, disabled?: boolean }} props
 */
export default function PublishDestinationCheck({ owner, repo, tokenKey, disabled = false }) {
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");

  // A result only describes the values it was run on.
  useEffect(() => {
    setResult(null);
    setError("");
  }, [owner, repo, tokenKey]);

  const ready = owner.trim() && repo.trim() && tokenKey.trim();

  const runCheck = async () => {
    setChecking(true);
    setError("");
    setResult(null);
    try {
      setResult(await checkPublishDestination({ owner, repo, tokenKey }));
    } catch (err) {
      setError(err?.message || "Connection check failed");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-sm font-medium text-foreground">Check Connection</p>
          <p className="text-xs text-muted-foreground">
            Tests these values against GitHub. Changes nothing in the repo.
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={runCheck}
          disabled={disabled || checking || !ready}
        >
          {checking ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          ) : (
            <PlugZap className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {checking ? "Checking…" : "Check Connection"}
        </Button>
      </div>

      {!ready && !result ? (
        <p className="text-xs text-muted-foreground">Fill in all three fields to run the check.</p>
      ) : null}

      <div aria-live="polite">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {result ? (
          <div className="space-y-2">
            <p
              className={cn(
                "text-sm font-medium",
                result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-destructive"
              )}
            >
              {result.ok ? "Connected. You can save and publish." : "Not connected yet. Fix the first red line."}
            </p>
            <ul className="divide-y divide-border rounded-md border border-border">
              {result.steps.map((s) => {
                const meta = STATUS[s.status] || STATUS.skip;
                const Icon = meta.icon;
                return (
                  <li key={s.id} className="flex items-start gap-2 px-3 py-2">
                    <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", meta.className)} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <p className="text-xs font-medium text-foreground">
                        {s.label}
                        <span className="sr-only">: {meta.word}</span>
                      </p>
                      {s.detail ? (
                        <p className="break-words text-xs text-muted-foreground">{s.detail}</p>
                      ) : null}
                      {s.fix && (s.status === "fail" || s.status === "warn") ? (
                        <p className="mt-1 break-words text-xs text-foreground">
                          <span className="font-medium">Fix: </span>
                          {s.fix}
                        </p>
                      ) : null}
                    </div>
                  </li>
                );
              })}
            </ul>
          </div>
        ) : null}
      </div>
    </div>
  );
}
