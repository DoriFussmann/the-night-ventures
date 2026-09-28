import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { todayIso } from "../../../../lib/wire-internal-links/externalLinksYaml.js";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import ChatMarkdown from "../seoAdvisor/ChatMarkdown";
import { countWords } from "./composeState";
import { reviewFieldErrors } from "./reviewValidation";

function FieldMeter({ label, htmlFor, value, min, max, error, children }) {
  const length = String(value || "").length;
  const ok = max == null ? length >= min : length >= min && length <= max;
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        <span className={`text-xs tabular-nums ${ok ? "text-emerald-700" : "text-destructive"}`}>
          {length} / {max == null ? `≥ ${min}` : `${min}–${max}`}
        </span>
      </div>
      {children}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

export default function ReviewStage({
  mode,
  state,
  dispatch,
  onSave,
  onRegenerate,
  saving,
}) {
  const [tagDraft, setTagDraft] = useState("");
  const [confirmRegen, setConfirmRegen] = useState(false);
  const fm = state.frontmatter || {};
  const errors = reviewFieldErrors(fm, state.body);
  const tags = Array.isArray(fm.tags) ? fm.tags : [];
  const faqs = Array.isArray(fm.faqs) ? fm.faqs : [];
  const externalLinks = Array.isArray(fm.externalLinks) ? fm.externalLinks : [];
  const sources = Array.isArray(state.whereThingsStandSources)
    ? state.whereThingsStandSources
    : [];
  const canRegenerate =
    mode === "idea"
      ? String(state.ideaText || "").trim().length > 0
      : String(state.sourceArticle || "").trim().length > 0;
  const words = countWords(state.body);

  useEffect(() => {
    if (!state.focusSlug) return;
    document.getElementById("compose-review-slug")?.focus();
  }, [state.focusSlug]);

  function patchFrontmatter(partial) {
    dispatch({
      type: "patch",
      patch: {
        dirty: true,
        slugConflict: Object.prototype.hasOwnProperty.call(partial, "slug")
          ? ""
          : state.slugConflict,
        frontmatter: { ...fm, ...partial },
      },
    });
  }

  function addTag(raw) {
    const next = String(raw || "").trim();
    if (!next) return;
    if (tags.some((tag) => tag.toLowerCase() === next.toLowerCase())) {
      setTagDraft("");
      return;
    }
    patchFrontmatter({ tags: [...tags, next] });
    setTagDraft("");
  }

  function addSource(source) {
    const url = String(source?.url || "").trim();
    if (!url) return;
    if (externalLinks.some((link) => link.url === url)) return;
    const note = String(source?.note || "").trim();
    patchFrontmatter({
      externalLinks: [
        ...externalLinks,
        {
          label: note || url,
          url,
          addedAt: todayIso(),
          kind: "wts-source",
        },
      ],
    });
  }

  return (
    <div className="space-y-5">
      {state.slugNote && (
        <p className="text-sm text-sky-900 bg-sky-50 border border-sky-200 rounded-md px-3 py-2">
          {state.slugNote}
        </p>
      )}
      {state.coverageWarning && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {state.coverageWarning}
        </p>
      )}

      <FieldMeter label="Title" htmlFor="compose-review-title" value={fm.title} min={55} max={60} error={errors.title}>
        <Input
          id="compose-review-title"
          value={fm.title || ""}
          onChange={(event) => patchFrontmatter({ title: event.target.value })}
        />
      </FieldMeter>

      <FieldMeter
        label="Description"
        htmlFor="compose-review-description"
        value={fm.description}
        min={140}
        max={160}
        error={errors.description}
      >
        <Textarea
          id="compose-review-description"
          rows={3}
          value={fm.description || ""}
          onChange={(event) => patchFrontmatter({ description: event.target.value })}
        />
      </FieldMeter>

      <div className="space-y-1.5">
        <Label htmlFor="compose-review-slug">Slug</Label>
        <Input
          id="compose-review-slug"
          value={fm.slug || ""}
          onChange={(event) => patchFrontmatter({ slug: event.target.value.trim() })}
          className={errors.slug || state.slugConflict ? "border-destructive" : "border-emerald-600"}
        />
        {(errors.slug || state.slugConflict) && (
          <p className="text-xs text-destructive">{state.slugConflict || errors.slug}</p>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="compose-review-tag">Tags</Label>
          <span className={`text-xs tabular-nums ${errors.tags ? "text-destructive" : "text-emerald-700"}`}>
            {tags.length} / 4–6
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <button
              key={tag}
              type="button"
              className="rounded-full border border-border bg-muted px-2.5 py-1 text-xs"
              onClick={() => patchFrontmatter({ tags: tags.filter((item) => item !== tag) })}
            >
              {tag} ×
            </button>
          ))}
        </div>
        <Input
          id="compose-review-tag"
          value={tagDraft}
          placeholder="Type a tag and press Enter"
          onChange={(event) => setTagDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === ",") {
              event.preventDefault();
              addTag(tagDraft);
            }
          }}
          onBlur={() => addTag(tagDraft)}
        />
        {errors.tags && <p className="text-xs text-destructive">{errors.tags}</p>}
      </div>

      <FieldMeter
        label="Image alt"
        htmlFor="compose-review-alt"
        value={fm.imageAlt}
        min={10}
        error={errors.imageAlt}
      >
        <Input
          id="compose-review-alt"
          value={fm.imageAlt || ""}
          onChange={(event) => patchFrontmatter({ imageAlt: event.target.value })}
        />
      </FieldMeter>

      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label>FAQs</Label>
          <span className={`text-xs tabular-nums ${errors.faqs ? "text-destructive" : "text-emerald-700"}`}>
            {faqs.length} / 2–4
          </span>
        </div>
        {faqs.map((faq, index) => (
          <div key={`faq-${index}`} className="space-y-2 rounded-md border border-border p-3">
            <Input
              value={faq?.question || ""}
              placeholder="Question"
              aria-label={`FAQ ${index + 1} question`}
              onChange={(event) => {
                const next = faqs.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, question: event.target.value } : item
                );
                patchFrontmatter({ faqs: next });
              }}
            />
            <Textarea
              rows={2}
              value={faq?.answer || ""}
              placeholder="Answer"
              aria-label={`FAQ ${index + 1} answer`}
              onChange={(event) => {
                const next = faqs.map((item, itemIndex) =>
                  itemIndex === index ? { ...item, answer: event.target.value } : item
                );
                patchFrontmatter({ faqs: next });
              }}
            />
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                patchFrontmatter({ faqs: faqs.filter((_, itemIndex) => itemIndex !== index) })
              }
            >
              Remove FAQ
            </Button>
          </div>
        ))}
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={faqs.length >= 4}
          onClick={() => patchFrontmatter({ faqs: [...faqs, { question: "", answer: "" }] })}
        >
          Add FAQ
        </Button>
        {errors.faqs && <p className="text-xs text-destructive">{errors.faqs}</p>}
      </div>

      <div className="space-y-2">
        <Label>External links</Label>
        {externalLinks.length === 0 && (
          <p className="text-sm text-muted-foreground">No external links yet.</p>
        )}
        <ul className="space-y-2">
          {externalLinks.map((link) => (
            <li key={link.url} className="flex items-start justify-between gap-3 text-sm">
              <span>
                {link.label || link.url}
                <span className="block text-xs text-muted-foreground break-all">{link.url}</span>
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  patchFrontmatter({
                    externalLinks: externalLinks.filter((item) => item.url !== link.url),
                  })
                }
              >
                Remove
              </Button>
            </li>
          ))}
        </ul>
      </div>

      <div className="space-y-2">
        <Label>Where Things Stand sources</Label>
        {sources.length === 0 && (
          <p className="text-sm text-muted-foreground">No sources were returned.</p>
        )}
        <ul className="space-y-2">
          {sources.map((source) => {
            const url = String(source?.url || "").trim();
            const added = externalLinks.some((link) => link.url === url);
            return (
              <li key={url || source?.note} className="flex items-start justify-between gap-3 text-sm">
                <span>
                  {source?.note || url}
                  <span className="block text-xs text-muted-foreground break-all">{url}</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={!url || added}
                  onClick={() => addSource(source)}
                >
                  {added ? "Added" : "Add to external links"}
                </Button>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Label htmlFor="compose-review-body">Body</Label>
          <span className="text-xs text-muted-foreground tabular-nums">{words.toLocaleString()} words</span>
        </div>
        {mode === "modify" && state.originalSource && (
          <Button
            type="button"
            size="sm"
            variant={state.showOriginal ? "default" : "outline"}
            onClick={() =>
              dispatch({ type: "patch", patch: { showOriginal: !state.showOriginal } })
            }
          >
            Show original
          </Button>
        )}
        <div className={`grid gap-3 ${state.showOriginal && state.originalSource ? "lg:grid-cols-3" : "lg:grid-cols-2"}`}>
          {state.showOriginal && state.originalSource && (
            <Textarea readOnly rows={18} value={state.originalSource} aria-label="Original source" />
          )}
          <Textarea
            id="compose-review-body"
            rows={18}
            value={state.body}
            onChange={(event) =>
              dispatch({
                type: "patch",
                patch: { body: event.target.value, dirty: true },
              })
            }
          />
          <div className="max-h-[28rem] overflow-auto rounded-md border border-border p-3">
            <ChatMarkdown>{state.body}</ChatMarkdown>
          </div>
        </div>
        {Array.isArray(errors.body) &&
          errors.body.map((message) => (
            <p key={message} className="text-xs text-destructive">
              {message}
            </p>
          ))}
      </div>

      {state.dirty && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          Save changes before moving to Image or Publish.
        </p>
      )}
      {!state.dirty && !isReady(errors) && (
        <p className="text-sm text-destructive">
          Fix the fields marked in red before moving to Image or Publish.
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="button" disabled={!state.dirty || saving || state.generating} onClick={onSave}>
          {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Save changes
        </Button>
        {canRegenerate && (
          <Button
            type="button"
            variant="outline"
            disabled={state.generating || saving}
            onClick={() => setConfirmRegen(true)}
          >
            {state.generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Regenerate
          </Button>
        )}
      </div>

      {state.generationError && (
        <div className="space-y-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          <p>{state.generationError}</p>
          {state.validationErrors.length > 0 && (
            <ul className="list-disc pl-5 space-y-1">
              {state.validationErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
        </div>
      )}

      <AlertDialog open={confirmRegen} onOpenChange={setConfirmRegen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regenerate this article?</AlertDialogTitle>
            <AlertDialogDescription>This replaces your edits.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              type="button"
              onClick={() => {
                setConfirmRegen(false);
                onRegenerate();
              }}
            >
              Regenerate
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function isReady(errors) {
  return Object.keys(errors).length === 0;
}
