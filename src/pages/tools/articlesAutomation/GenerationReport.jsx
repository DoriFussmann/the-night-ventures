import React from "react";
import { Check, X } from "lucide-react";

function imageNote(image) {
  const status = image?.status;
  if (status === "done") return "hero image ready";
  if (status === "failed") return "hero image failed";
  return null;
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
