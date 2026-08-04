import React, { useEffect, useMemo, useState } from "react";
import { Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const STATUSES = ["pending", "in-progress", "done"];

const STATUS_META = {
  pending: {
    label: "Pending",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  "in-progress": {
    label: "In progress",
    className: "bg-orange-50 text-orange-700 border-orange-200",
  },
  done: {
    label: "Done",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
};

export const ROUTE_STEPS = [
  {
    id: "choose-pillar",
    name: "Choose pillar",
    location: "Topic Generator",
    description: "Select the pillar you're working on this session.",
  },
  {
    id: "pillar-article-ready",
    name: "Pillar article ready",
    location: "Topic Generator + Article Generation",
    description: "If missing: Plan Pillar Article, then Article Generation, then Save.",
  },
  {
    id: "choose-supporting-keyword",
    name: "Choose supporting keyword",
    location: "Topic Generator",
    description: "Pick the supporting keyword within the pillar.",
  },
  {
    id: "pull-keyword-data",
    name: "Pull keyword data",
    location: "External (Keyword Slip / Semrush)",
    description: "Get real keyword data for this supporting keyword.",
  },
  {
    id: "plan-cluster",
    name: "Plan Cluster",
    location: "Topic Generator",
    description: "Paste keyword data, generate, review, confirm.",
  },
  {
    id: "save-download-cluster",
    name: "Save & download cluster",
    location: "Topic Generator",
    description: "Download the cluster .md.",
  },
  {
    id: "generate-articles",
    name: "Generate articles",
    location: "Article Generation",
    description: "Drag & drop the .md, select articles, generate.",
  },
  {
    id: "save-to-articles-library",
    name: "Save to Articles library",
    location: "Article Generation",
    description: "Save or Save All.",
  },
  {
    id: "generate-cluster-hero-images",
    name: "Generate cluster hero image(s)",
    location: "Cluster Images",
    description: "Produce hero image(s) for this cluster's articles.",
  },
  {
    id: "publish-in-cms",
    name: "Publish in CMS",
    location: "Rupert CMS",
    description: "Per article: author, image, internal/external links, publish.",
  },
  {
    id: "deploy",
    name: "Deploy",
    location: "Hosting",
    description: "Trigger/confirm the live deploy.",
  },
  {
    id: "mark-published-in-tnv",
    name: "Mark Published in TNV",
    location: "Topic Generator",
    description: "Set status to Published, add the live URL (source of truth).",
  },
];

function storageKey(companyId) {
  return `route-tracker-${companyId}`;
}

function defaultStatuses() {
  return Object.fromEntries(ROUTE_STEPS.map((step) => [step.id, "pending"]));
}

function readStatuses(companyId) {
  if (!companyId) return defaultStatuses();
  try {
    const raw = localStorage.getItem(storageKey(companyId));
    if (!raw) return defaultStatuses();
    const parsed = JSON.parse(raw);
    const next = defaultStatuses();
    for (const step of ROUTE_STEPS) {
      if (STATUSES.includes(parsed?.[step.id])) {
        next[step.id] = parsed[step.id];
      }
    }
    return next;
  } catch {
    return defaultStatuses();
  }
}

function writeStatuses(companyId, statuses) {
  if (!companyId) return;
  try {
    localStorage.setItem(storageKey(companyId), JSON.stringify(statuses));
  } catch (err) {
    console.error("Failed to persist route tracker:", err);
  }
}

function clearStatuses(companyId) {
  if (!companyId) return;
  try {
    localStorage.removeItem(storageKey(companyId));
  } catch (err) {
    console.error("Failed to clear route tracker:", err);
  }
}

function nextStatus(current) {
  const index = STATUSES.indexOf(current);
  return STATUSES[(index + 1) % STATUSES.length];
}

export default function RouteTracker({ open, onOpenChange, companyId }) {
  const [statuses, setStatuses] = useState(() => readStatuses(companyId));
  const [expandedId, setExpandedId] = useState(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setStatuses(readStatuses(companyId));
      setExpandedId(null);
    }
  }, [open, companyId]);

  const doneCount = useMemo(
    () => ROUTE_STEPS.filter((step) => statuses[step.id] === "done").length,
    [statuses]
  );

  const cycleStatus = (stepId) => {
    setStatuses((prev) => {
      const next = { ...prev, [stepId]: nextStatus(prev[stepId] || "pending") };
      writeStatuses(companyId, next);
      return next;
    });
  };

  const toggleExpanded = (stepId, event) => {
    event.stopPropagation();
    setExpandedId((current) => (current === stepId ? null : stepId));
  };

  const handleReset = () => {
    clearStatuses(companyId);
    setStatuses(defaultStatuses());
    setExpandedId(null);
    setConfirmResetOpen(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col gap-0 p-0 overflow-hidden">
          <DialogHeader className="px-6 pt-6 pb-4 border-b border-border shrink-0">
            <DialogTitle>The Route</DialogTitle>
            <DialogDescription>
              Cluster workflow — {doneCount} of {ROUTE_STEPS.length} done
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto px-3 py-2">
            <ul className="space-y-1">
              {ROUTE_STEPS.map((step, index) => {
                const status = statuses[step.id] || "pending";
                const meta = STATUS_META[status] || STATUS_META.pending;
                const expanded = expandedId === step.id;

                return (
                  <li key={step.id}>
                    <div
                      role="button"
                      tabIndex={0}
                      onClick={() => cycleStatus(step.id)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter" || event.key === " ") {
                          event.preventDefault();
                          cycleStatus(step.id);
                        }
                      }}
                      className="w-full flex items-center gap-2 rounded-lg border border-transparent px-2.5 py-2 text-left transition-colors hover:bg-accent hover:border-border cursor-pointer"
                    >
                      <span className="w-5 shrink-0 text-xs tabular-nums text-muted-foreground">
                        {index + 1}
                      </span>
                      <span className="min-w-0 flex-1 flex items-center gap-2">
                        <span className="truncate text-sm text-foreground">{step.name}</span>
                        <span className="shrink-0 inline-flex items-center rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground truncate max-w-[9.5rem]">
                          {step.location}
                        </span>
                      </span>
                      <span
                        className={`shrink-0 inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                      >
                        {meta.label}
                      </span>
                      <button
                        type="button"
                        title={expanded ? "Hide details" : "Show details"}
                        aria-label={expanded ? "Hide details" : "Show details"}
                        aria-expanded={expanded}
                        onClick={(event) => toggleExpanded(step.id, event)}
                        className={`shrink-0 p-1 rounded text-muted-foreground hover:text-foreground hover:bg-background ${
                          expanded ? "text-foreground bg-background" : ""
                        }`}
                      >
                        <Info className="w-3.5 h-3.5" />
                      </button>
                    </div>
                    {expanded && (
                      <p className="px-9 pb-2 text-xs text-muted-foreground leading-relaxed">
                        {step.description}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>

          <DialogFooter className="px-6 py-4 border-t border-border shrink-0 sm:justify-between">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setConfirmResetOpen(true)}
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Refresh
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset all steps for this cluster?</AlertDialogTitle>
            <AlertDialogDescription>
              This sets every step back to Pending for the current company. You
              can start tracking again from the top.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleReset}
            >
              Reset
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
