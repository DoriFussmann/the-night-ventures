import React, { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Check, GitBranch, Loader2, X } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import PublishDestinationGuide from "@/pages/tools/publishDestination/PublishDestinationGuide";
import { checkPublishDestination } from "@/pages/tools/publishDestination/publishDestinationApi";

/**
 * Workspace Admin: the one GitHub token (GITHUB_TOKEN in Vercel) that every
 * company publishes with. Checks it against each company's repo.
 */
export default function GitHubAccessCard({ cardClass }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className={cardClass} onClick={() => setOpen(true)}>
        <div className="flex items-center gap-2">
          <GitBranch className="h-4 w-4 text-muted-foreground" />
          <span className="text-sm font-medium text-foreground">GitHub access</span>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          One workspace token for publishing to every company repo.
        </p>
      </button>
      <GitHubAccessDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function GitHubAccessDialog({ open, onOpenChange }) {
  const [companies, setCompanies] = useState([]);
  const [results, setResults] = useState({});
  const [loadError, setLoadError] = useState("");
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setResults({});
    supabase
      .from("companies")
      .select("id, name, github_owner, github_repo, github_token_key")
      .order("name")
      .then(({ data, error }) => {
        if (error) setLoadError(error.message);
        else setCompanies(data || []);
      });
  }, [open]);

  const checkAll = useCallback(async () => {
    setChecking(true);
    setResults({});
    for (const c of companies) {
      if (!c.github_owner || !c.github_repo) {
        setResults((prev) => ({ ...prev, [c.id]: { status: "skip", text: "No repo set" } }));
        continue;
      }
      try {
        const r = await checkPublishDestination({
          owner: c.github_owner,
          repo: c.github_repo,
          tokenKey: c.github_token_key || "",
        });
        const firstBad = r.steps.find((s) => s.status === "fail") || r.steps.find((s) => s.status === "warn");
        setResults((prev) => ({
          ...prev,
          [c.id]: r.ok
            ? {
                status: firstBad ? "warn" : "ok",
                text: firstBad ? `${firstBad.label}: ${firstBad.detail}` : "Connected",
              }
            : { status: "fail", text: `${firstBad?.label}: ${firstBad?.detail}`, fix: firstBad?.fix },
        }));
      } catch (err) {
        setResults((prev) => ({ ...prev, [c.id]: { status: "fail", text: err?.message || "Check failed" } }));
      }
    }
    setChecking(false);
  }, [companies]);

  const icon = (status) =>
    status === "ok" ? (
      <Check className="h-4 w-4 text-emerald-600" aria-label="Connected" />
    ) : status === "warn" ? (
      <AlertTriangle className="h-4 w-4 text-amber-600" aria-label="Warning" />
    ) : status === "fail" ? (
      <X className="h-4 w-4 text-destructive" aria-label="Failed" />
    ) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>GitHub access</DialogTitle>
          <DialogDescription>
            Every company publishes with one fine-grained token stored in TNV&apos;s Vercel project as
            GITHUB_TOKEN. The token itself never enters the database. A new site only needs its repo added to that
            token on GitHub.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <PublishDestinationGuide />
          <div className="flex items-center justify-between gap-2">
            <p className="text-sm font-medium text-foreground">Company repos</p>
            <Button type="button" size="sm" variant="outline" onClick={checkAll} disabled={checking || !companies.length}>
              {checking ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
              {checking ? "Checking…" : "Check all"}
            </Button>
          </div>
          {loadError ? <p className="text-sm text-destructive">{loadError}</p> : null}
          <ul className="divide-y divide-border rounded-md border border-border" aria-live="polite">
            {companies.map((c) => {
              const r = results[c.id];
              return (
                <li key={c.id} className="flex items-start gap-2 px-3 py-2">
                  <span className="mt-0.5 w-4 shrink-0">{r ? icon(r.status) : null}</span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">
                      {c.name}
                      <span className="ml-2 text-xs text-muted-foreground">
                        {c.github_owner && c.github_repo ? `${c.github_owner}/${c.github_repo}` : "no repo"}
                      </span>
                    </p>
                    {r ? <p className="break-words text-xs text-muted-foreground">{r.text}</p> : null}
                    {r?.fix ? (
                      <p className="mt-0.5 break-words text-xs text-foreground">
                        <span className="font-medium">Fix: </span>
                        {r.fix}
                      </p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </DialogContent>
    </Dialog>
  );
}
