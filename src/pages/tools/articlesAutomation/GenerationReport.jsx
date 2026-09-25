import React from "react";
import { Check, X } from "lucide-react";

function providerLabel(provider) {
  if (provider === "unsplash") return "Unsplash";
  if (provider === "shutterstock") return "Shutterstock";
  if (provider === "openai") return "OpenAI";
  return provider ? String(provider) : "Stock";
}

export function imageNote(image) {
  const status = image?.status;
  if (status === "failed") return "hero image failed";
  if (status !== "done") return null;
  if (image.source === "unsplash") {
    const name = image.attribution?.photographer;
    return name
      ? `hero image ready · Unsplash (Photo by ${name})`
      : "hero image ready · Unsplash";
  }
  if (image.source === "shutterstock") return "hero image ready · Shutterstock";
  return "hero image ready · generated";
}

export function imageTrailNote(image) {
  const trail = Array.isArray(image?.trail) ? image.trail : [];
  const unused = trail.filter((entry) => entry && entry.outcome !== "used");
  if (unused.length === 0) return "";
  return unused
    .map((entry) => {
      const name = providerLabel(entry.provider);
      if (entry.outcome === "no_fit") {
        const score = entry.score != null ? ` (score ${entry.score})` : "";
        return `${name}: no fit${score}`;
      }
      if (entry.outcome === "not_configured") return `${name}: not configured`;
      if (entry.outcome === "no_results") return `${name}: no results`;
      if (entry.outcome === "judge_error") return `${name}: judge error`;
      if (entry.outcome === "error") return `${name}: error`;
      if (entry.outcome === "skipped") {
        return entry.reason ? `${name}: skipped (${entry.reason})` : `${name}: skipped`;
      }
      return `${name}: ${entry.outcome}`;
    })
    .join(", ");
}

export default function GenerationReport({
  title,
  summary,
  destinationLabel,
  jobs = [],
  publishResult,
}) {
  const committed = Array.isArray(publishResult?.committed)
    ? publishResult.committed
    : [];
  const skipped = Array.isArray(publishResult?.skipped)
    ? publishResult.skipped
    : [];
  const errors = Array.isArray(publishResult?.errors) ? publishResult.errors : [];
  const ok = Boolean(publishResult?.ok);

  return (
    <div
      className={`text-sm rounded-lg border px-4 py-4 space-y-3 ${
        ok
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
          : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <div className="space-y-1">
        <p className="font-medium">{title}</p>
        {summary ? <p className="leading-relaxed">{summary}</p> : null}
        {destinationLabel ? (
          <p className="text-xs opacity-80">{destinationLabel}</p>
        ) : null}
      </div>

      {jobs.length > 0 && (
        <div>
          <p className="font-medium mb-1.5">What was generated</p>
          <ul className="space-y-1.5">
            {jobs.map((job) => {
              const generated = job.status === "done";
              const img = imageNote(job.image);
              return (
                <li
                  key={`report-${job.index}`}
                  className="flex items-start gap-2"
                >
                  {generated ? (
                    <Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-700" />
                  ) : (
                    <X className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
                  )}
                  <div className="min-w-0">
                    <p className="font-medium break-words">
                      {job.frontmatter?.title || job.title}
                    </p>
                    <p className="text-xs opacity-80">
                      {generated
                        ? `Ready${img ? ` · ${img}` : ""}`
                        : job.error || "Failed to generate"}
                    </p>
                    {imageTrailNote(job.image) ? (
                      <p className="text-xs opacity-60">{imageTrailNote(job.image)}</p>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {ok && committed.length > 0 && (
        <p className="text-xs opacity-80">
          {committed.length} file{committed.length === 1 ? "" : "s"} committed
          to the site
          {publishResult.branch ? (
            <>
              {" "}
              from{" "}
              <span className="font-mono">{publishResult.branch}</span>
            </>
          ) : null}
          .
        </p>
      )}

      {skipped.length > 0 && (
        <div>
          <p className="font-medium">Not published</p>
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            {skipped.map((item, i) => (
              <li key={`${item.filename || "skipped"}-${i}`}>
                {item.filename ? `${item.filename}: ` : ""}
                {item.message || item.reason || "Skipped"}
              </li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <div>
          <p className="font-medium">Problems</p>
          <ul className="list-disc pl-5 text-xs space-y-0.5">
            {errors.map((item, i) => (
              <li key={`${item.filename || "error"}-${i}`}>
                {item.filename ? `${item.filename}: ` : ""}
                {item.message || String(item)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
