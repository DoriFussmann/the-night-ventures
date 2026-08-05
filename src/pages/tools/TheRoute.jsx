import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { Info, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import WorkflowStepper, {
  nextWorkflowStatus,
} from "@/components/WorkflowStepper";

const ROUTE_STEPS = [
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
      if (["pending", "in-progress", "done"].includes(parsed?.[step.id])) {
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

export default function TheRoute() {
  const { companyId } = useParams();
  const [statuses, setStatuses] = useState(() => readStatuses(companyId));
  const [expandedId, setExpandedId] = useState(null);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);

  useEffect(() => {
    setStatuses(readStatuses(companyId));
    setExpandedId(null);
  }, [companyId]);

  const doneCount = useMemo(
    () => ROUTE_STEPS.filter((step) => statuses[step.id] === "done").length,
    [statuses]
  );

  const expandedStep = useMemo(
    () => ROUTE_STEPS.find((step) => step.id === expandedId) || null,
    [expandedId]
  );

  const cycleStatus = (stepId) => {
    setStatuses((prev) => {
      const next = { ...prev, [stepId]: nextWorkflowStatus(prev[stepId] || "pending") };
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
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xs text-foreground mb-1">The Route</h1>
          <p className="text-sm text-muted-foreground">
            Cluster workflow — {doneCount} of {ROUTE_STEPS.length} done
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmResetOpen(true)}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </Button>
      </div>

      <WorkflowStepper
        steps={ROUTE_STEPS}
        statuses={statuses}
        onCycleStatus={cycleStatus}
        selectedId={expandedId}
        renderStepAction={(step, { selected }) => (
          <button
            type="button"
            title={selected ? "Hide details" : "Show details"}
            aria-label={selected ? "Hide details" : "Show details"}
            aria-expanded={selected}
            onClick={(event) => toggleExpanded(step.id, event)}
            className={`mt-0.5 rounded p-1 text-muted-foreground hover:bg-background hover:text-foreground ${
              selected ? "bg-background text-foreground" : ""
            }`}
          >
            <Info className="h-3.5 w-3.5" />
          </button>
        )}
      />

      {expandedStep && (
        <div className="rounded-lg border border-border bg-muted/30 px-4 py-3">
          <p className="text-sm font-medium text-foreground mb-1">{expandedStep.name}</p>
          <p className="text-xs text-muted-foreground leading-relaxed">
            {expandedStep.description}
          </p>
        </div>
      )}

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
    </div>
  );
}
