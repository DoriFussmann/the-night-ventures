import { useState } from "react";
import { AlertTriangle, ImageOff, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { intakeSelectionPatch } from "./composeState";

const FIT_LABEL = { strong: "Strong fit", partial: "Partial fit", weak: "Weak fit" };
const ROLE_LABEL = { hero: "Hero", inline: "In article", exclude: "Leave out" };

function Conflicts({ conflicts }) {
  const list = Array.isArray(conflicts) ? conflicts : [];
  if (list.length === 0) return null;
  return (
    <ul className="mt-1 space-y-1">
      {list.map((conflict, i) => (
        <li
          key={i}
          className={`flex gap-1.5 text-xs ${conflict.blocking ? "text-destructive" : "text-amber-700 dark:text-amber-400"}`}
        >
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          <span>{conflict.message}</span>
        </li>
      ))}
    </ul>
  );
}

function BriefRow({ label, value, limit }) {
  if (!value) return null;
  return (
    <div className="grid gap-0.5 sm:grid-cols-[140px_1fr]">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words">
        {value}
        {limit ? (
          <span className="ml-2 text-xs text-muted-foreground tabular-nums">
            {value.length} chars (needs {limit})
          </span>
        ) : null}
      </dd>
    </div>
  );
}

export default function WriterIntakePanel({ state, dispatch, onAnalyze, disabled = false }) {
  const [showRemoved, setShowRemoved] = useState(false);
  const intake = state.intake;
  const locked = Boolean(disabled);

  if (state.intakeStatus === "running") {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" />
        Reading the brief, checking the images and matching your keywords… usually 20–60 seconds.
      </p>
    );
  }

  if (!intake) {
    return (
      <div className="space-y-2">
        {state.intakeError && <p className="text-sm text-destructive">{state.intakeError}</p>}
        <p className="text-sm text-muted-foreground">
          Separates the writer&apos;s brief from the article, checks the images, and matches the article to
          your Company Intelligence keywords.
        </p>
        <Button type="button" size="sm" disabled={locked} onClick={onAnalyze}>
          {state.intakeError ? "Try again" : "Read brief & match keywords"}
        </Button>
      </div>
    );
  }

  const brief = intake.brief || {};
  const writer = intake.writerKeyword;
  const options = Array.isArray(intake.options) ? intake.options : [];
  const images = Array.isArray(intake.images) ? intake.images : [];
  const previews = new Map((state.writerImages || []).map((img) => [img.n, img.preview]));
  const choices = state.imageChoices || {};

  function choose(selection) {
    if (locked) return;
    dispatch({ type: "patch", patch: intakeSelectionPatch(intake, selection) });
  }

  function setRole(n, role) {
    if (locked) return;
    const next = { ...choices, [n]: role };
    // One hero at most: the previous hero goes into the article.
    if (role === "hero") {
      for (const key of Object.keys(next)) {
        if (Number(key) !== n && next[key] === "hero") next[key] = "inline";
      }
    }
    dispatch({ type: "patch", patch: { imageChoices: next } });
  }

  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">From the writer</h3>
        <dl className="space-y-1.5">
          <BriefRow label="Writer keyword" value={brief.keyword} />
          <BriefRow label="Target page" value={brief.targetUrl} />
          <BriefRow label="Meta title" value={brief.metaTitle} limit="55–60" />
          <BriefRow label="Meta description" value={brief.metaDescription} limit="140–160" />
          <BriefRow label="Notes" value={brief.notes} />
        </dl>
        {writer && (
          <div className="rounded-md border border-border px-3 py-2 text-sm">
            <p>
              <span className="font-medium">&ldquo;{writer.targetKeyword}&rdquo;</span>{" "}
              {writer.inMap ? "is in your keyword map." : "is not in your keyword map."}
              {writer.verdict ? ` ${writer.verdict}` : ""}
            </p>
            <Conflicts conflicts={writer.conflicts} />
          </div>
        )}
        {intake.briefText?.length > 0 && (
          <div className="text-xs text-muted-foreground">
            {intake.briefText.length} block{intake.briefText.length === 1 ? "" : "s"} of brief and metadata removed
            from the article.{" "}
            <button type="button" className="underline" onClick={() => setShowRemoved((v) => !v)}>
              {showRemoved ? "Hide" : "Show"}
            </button>
            {state.sourceBeforeIntake && !locked && (
              <>
                {" · "}
                <button
                  type="button"
                  className="underline"
                  onClick={() =>
                    dispatch({
                      type: "patch",
                      patch: { sourceArticle: state.sourceBeforeIntake, sourceBeforeIntake: "" },
                    })
                  }
                >
                  Restore them
                </button>
              </>
            )}
            {showRemoved && (
              <pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-xs">
                {intake.briefText.join("\n\n")}
              </pre>
            )}
          </div>
        )}
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Keyword — from your Company Intelligence
        </h3>
        {options.length === 0 && (
          <p className="text-sm text-muted-foreground">
            No keyword in your map fits this article well. Choose one manually, or add a supporting keyword in
            Company Intelligence and read the brief again.
          </p>
        )}
        <div className="space-y-2" role="radiogroup" aria-label="Keyword">
          {options.map((option, i) => {
            const selected = state.selectedOption === i;
            return (
              <button
                key={`${option.targetKeyword}-${i}`}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={locked}
                onClick={() => choose(i)}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  selected ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
                }`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">{option.targetKeyword}</span>
                  <Badge variant={option.fit === "strong" ? "default" : "secondary"} className="font-normal">
                    {FIT_LABEL[option.fit] || option.fit}
                  </Badge>
                  {option.blocked && (
                    <Badge variant="destructive" className="font-normal">
                      Conflict
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  {option.pillarKeyword} › {option.supportingKeyword} · {option.articleType}
                </p>
                {option.reason && <p className="mt-1 text-sm">{option.reason}</p>}
                {option.changes && (
                  <p className="text-xs text-muted-foreground">Rewrite: {option.changes}</p>
                )}
                <Conflicts conflicts={option.conflicts} />
              </button>
            );
          })}
          <button
            type="button"
            role="radio"
            aria-checked={state.selectedOption === "manual"}
            disabled={locked}
            onClick={() => choose("manual")}
            className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
              state.selectedOption === "manual" ? "border-primary bg-primary/5" : "border-border hover:bg-muted/50"
            }`}
          >
            Choose manually <span className="text-xs text-muted-foreground">— pick in Targeting above</span>
          </button>
        </div>
      </section>

      {images.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Images</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {images.map((img) => {
              const role = choices[img.n] || img.role;
              const preview = previews.get(img.n);
              return (
                <div key={img.n} className="space-y-2 rounded-md border border-border p-2">
                  {preview ? (
                    <img
                      src={preview}
                      alt={img.alt || `Writer image ${img.n}`}
                      className={`aspect-video w-full rounded object-cover ${role === "exclude" ? "opacity-40" : ""}`}
                    />
                  ) : (
                    <div className="flex aspect-video items-center justify-center rounded bg-muted text-muted-foreground">
                      <ImageOff className="h-5 w-5" />
                    </div>
                  )}
                  <div className="flex flex-wrap gap-1" role="radiogroup" aria-label={`Image ${img.n}`}>
                    {["hero", "inline", "exclude"].map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={role === value ? "default" : "outline"}
                        className="h-7 px-2 text-xs"
                        disabled={locked || !preview}
                        onClick={() => setRole(img.n, value)}
                      >
                        {ROLE_LABEL[value]}
                      </Button>
                    ))}
                  </div>
                  {img.reason && <p className="text-xs text-muted-foreground">{img.reason}</p>}
                  {img.hasText && role !== "exclude" && (
                    <p className="text-xs text-amber-700 dark:text-amber-400">
                      Has text on it{img.textOnImage ? `: “${img.textOnImage}”` : ""}. Check it still matches the
                      final title.
                    </p>
                  )}
                </div>
              );
            })}
          </div>
        </section>
      )}

      <div>
        <Button type="button" size="sm" variant="outline" disabled={locked} onClick={onAnalyze}>
          Read again
        </Button>
      </div>
    </div>
  );
}
