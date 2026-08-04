import React from "react";

export const WORKFLOW_STATUSES = ["pending", "in-progress", "done"];

export const WORKFLOW_STATUS_META = {
  pending: {
    label: "Pending",
    className: "bg-slate-100 text-slate-600 border-slate-200",
    dotClassName: "bg-slate-100 border-slate-300 text-slate-600",
  },
  "in-progress": {
    label: "In progress",
    className: "bg-orange-50 text-orange-700 border-orange-200",
    dotClassName: "bg-orange-500 border-orange-500 text-white",
  },
  done: {
    label: "Done",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotClassName: "bg-emerald-500 border-emerald-500 text-white",
  },
};

export function nextWorkflowStatus(current) {
  const index = WORKFLOW_STATUSES.indexOf(current);
  return WORKFLOW_STATUSES[(index + 1) % WORKFLOW_STATUSES.length];
}

/**
 * Horizontal scrollable workflow stepper (shared by The Route and Site Build Flow).
 *
 * @param {object} props
 * @param {{ id: string, name: string, location: string }[]} props.steps
 * @param {Record<string, string>} props.statuses
 * @param {(stepId: string) => void} props.onCycleStatus
 * @param {string | null} [props.selectedId]
 * @param {(step: { id: string, name: string, location: string }, ctx: { selected: boolean }) => React.ReactNode} [props.renderStepAction]
 * @param {string} [props.stepWidthClassName]
 */
export default function WorkflowStepper({
  steps,
  statuses,
  onCycleStatus,
  selectedId = null,
  renderStepAction,
  stepWidthClassName = "w-40",
}) {
  return (
    <div className="overflow-x-auto pb-2">
      <ol className="flex min-w-max items-start">
        {steps.map((step, index) => {
          const status = statuses[step.id] || "pending";
          const meta = WORKFLOW_STATUS_META[status] || WORKFLOW_STATUS_META.pending;
          const selected = selectedId === step.id;
          const isFirst = index === 0;
          const isLast = index === steps.length - 1;

          return (
            <li
              key={step.id}
              className={`flex ${stepWidthClassName} shrink-0 flex-col items-center gap-2`}
            >
              <div className="relative flex w-full items-center justify-center">
                {!isFirst && (
                  <div
                    className="absolute left-0 right-1/2 top-1/2 h-px -translate-y-1/2 bg-border"
                    aria-hidden="true"
                  />
                )}
                {!isLast && (
                  <div
                    className="absolute left-1/2 right-0 top-1/2 h-px -translate-y-1/2 bg-border"
                    aria-hidden="true"
                  />
                )}
                <span
                  className={`relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border-2 text-[11px] font-medium tabular-nums ${meta.dotClassName}`}
                >
                  {index + 1}
                </span>
              </div>

              <div
                role="button"
                tabIndex={0}
                onClick={() => onCycleStatus(step.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    onCycleStatus(step.id);
                  }
                }}
                className={`flex w-full cursor-pointer flex-col items-center gap-1.5 rounded-lg border px-2 py-2 text-center transition-colors hover:border-border hover:bg-accent ${
                  selected ? "border-border bg-accent" : "border-transparent"
                }`}
              >
                <span className="text-sm leading-snug text-foreground">{step.name}</span>
                <span className="inline-flex max-w-full items-center truncate rounded-full border border-border bg-muted/50 px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
                  {step.location}
                </span>
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${meta.className}`}
                >
                  {meta.label}
                </span>
                {typeof renderStepAction === "function"
                  ? renderStepAction(step, { selected })
                  : null}
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
