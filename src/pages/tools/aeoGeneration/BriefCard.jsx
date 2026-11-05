import React, { useState } from "react";
import { Check, Loader2, PenLine, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ARTICLE_TYPES,
  CTA_PRIMARY,
  deleteBrief,
  outlineToText,
  suggestOutline,
  textToOutline,
  updateBrief,
} from "./briefs";
import DraftPanel from "./DraftPanel";

const selectClass =
  "h-8 rounded-md border border-input bg-background px-2 text-xs focus:outline-none focus:ring-1 focus:ring-ring";

const REVIEW_STATUSES = new Set(["generated", "approved", "scheduled", "published"]);

const STATUS_STYLE = {
  draft: "border-border bg-muted text-muted-foreground",
  ready: "border-emerald-300 bg-emerald-50 text-emerald-800",
  skipped: "border-border bg-muted text-muted-foreground line-through",
  generated: "border-sky-300 bg-sky-50 text-sky-800",
  approved: "border-emerald-400 bg-emerald-100 text-emerald-900",
  scheduled: "border-violet-300 bg-violet-50 text-violet-800",
  published: "border-emerald-500 bg-emerald-600 text-white",
};

function Field({ label, children, hint }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">{label}</span>
      {children}
      {hint ? <span className="block text-[11px] text-muted-foreground">{hint}</span> : null}
    </label>
  );
}

export default function BriefCard({
  companyId,
  brief,
  group,
  pillar,
  prompts,
  personasById,
  onChanged,
  onError,
  draft,
  busy,
  genStatus,
  onGenerate,
  onApprove,
  onUnapprove,
  onRedo,
  onScheduleOne,
}) {
  const [title, setTitle] = useState(brief.title);
  const [keyword, setKeyword] = useState(brief.primary_keyword);
  const [angle, setAngle] = useState(brief.angle);
  const [outlineText, setOutlineText] = useState(outlineToText(brief.outline));
  const [keyPoints, setKeyPoints] = useState(brief.key_points);
  const [tool, setTool] = useState(brief.cta?.tool || "");
  const [suggesting, setSuggesting] = useState(false);
  const [open, setOpen] = useState(brief.status === "draft" || brief.status === "generated");
  const [cardError, setCardError] = useState("");

  const save = async (values) => {
    try {
      await updateBrief(brief.id, values);
      onChanged?.();
    } catch (err) {
      onError?.(err?.message || "Save failed");
    }
  };
  const saveIfChanged = (key, value, original) => {
    if (value !== original) save({ [key]: value });
  };

  const onSuggest = async () => {
    if (outlineText.trim() && !window.confirm("Replace the current title, angle and outline with a new suggestion?")) return;
    setSuggesting(true);
    setCardError("");
    try {
      const s = await suggestOutline({ companyId, groupId: group.id, primaryKeyword: keyword });
      setTitle(s.title || title);
      setAngle(s.angle);
      setOutlineText(outlineToText(s.outline));
      await save({ title: s.title || title, angle: s.angle, article_type: s.articleType, outline: s.outline });
    } catch (err) {
      setCardError(err?.message || "Could not suggest an outline");
    } finally {
      setSuggesting(false);
    }
  };

  const outline = textToOutline(outlineText);
  const readyProblems = [
    !title.trim() && "a title",
    !keyword.trim() && "a primary keyword",
    outline.length < 3 && "an outline with 3+ sections",
    !pillar?.topic_name && "the pillar's site topic name (AEO Playbook › Content Map)",
  ].filter(Boolean);

  const remove = async () => {
    if (!window.confirm(`Delete the brief for "${group.name}"? The prompt group goes back into Next up.`)) return;
    try {
      await deleteBrief(brief.id);
      onChanged?.();
    } catch (err) {
      onError?.(err?.message || "Delete failed");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-card">
      <button
        type="button"
        className="flex w-full items-start justify-between gap-3 p-3 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title || group.name}</p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {group.code} · {pillar?.name || "No pillar"} · {prompts.length} prompts · keyword: {keyword || "—"}
          </p>
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[brief.status] || STATUS_STYLE.draft}`}>
          {brief.status}
        </span>
      </button>

      {open && REVIEW_STATUSES.has(brief.status) && (
        <div className="border-t border-border p-3">
          <DraftPanel
            companyId={companyId}
            brief={brief}
            draft={draft}
            busy={busy}
            onApprove={onApprove}
            onUnapprove={onUnapprove}
            onRedo={onRedo}
            onScheduleOne={onScheduleOne}
          />
        </div>
      )}

      {open && !REVIEW_STATUSES.has(brief.status) && (
        <div className="space-y-3 border-t border-border p-3">
          <details className="rounded-md bg-muted/40 px-3 py-2 text-xs">
            <summary className="cursor-pointer text-muted-foreground">Prompts this article answers ({prompts.length})</summary>
            <ul className="mt-2 space-y-1">
              {prompts.map((p) => (
                <li key={p.id}>
                  <span className="text-muted-foreground">
                    {personasById.get(p.persona_id)?.code || "—"} · {p.intent_tier} ·
                  </span>{" "}
                  {p.prompt}
                </li>
              ))}
            </ul>
          </details>

          <div className="flex flex-wrap items-center gap-3 rounded-md border border-dashed border-border px-3 py-2">
            <Button type="button" variant="outline" size="sm" disabled={suggesting} onClick={onSuggest}>
              {suggesting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
              {suggesting ? "Writing a suggestion… (about 30 seconds)" : "Suggest title, angle and outline"}
            </Button>
            <span className="text-[11px] text-muted-foreground">Fills the three fields below from the prompts and Brand Facts. Edit freely after.</span>
            {cardError && <span className="w-full text-xs text-destructive">{cardError}</span>}
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Title">
              <Input value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => saveIfChanged("title", title, brief.title)} />
            </Field>
            <Field label="Primary keyword">
              <Input value={keyword} onChange={(e) => setKeyword(e.target.value)} onBlur={() => saveIfChanged("primary_keyword", keyword, brief.primary_keyword)} />
            </Field>
          </div>

          <Field label="Angle" hint="The specific point of view that makes this worth citing.">
            <Input value={angle} onChange={(e) => setAngle(e.target.value)} onBlur={() => saveIfChanged("angle", angle, brief.angle)} />
          </Field>

          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Outline</span>
              <div className="flex items-center gap-2">
                <select
                  className={selectClass}
                  value={brief.article_type}
                  onChange={(e) => save({ article_type: e.target.value })}
                  aria-label="Article type"
                >
                  {ARTICLE_TYPES.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
            </div>
            <Textarea
              rows={10}
              className="font-mono text-xs"
              placeholder={"## Section heading\n- what it must say\n- another point"}
              value={outlineText}
              onChange={(e) => setOutlineText(e.target.value)}
              onBlur={() => {
                const next = textToOutline(outlineText);
                if (JSON.stringify(next) !== JSON.stringify(brief.outline || [])) save({ outline: next });
              }}
            />
          </div>

          <Field label="Your key points" hint="Your expert input: what you'd tell a founder. The writer leads with these.">
            <Textarea
              rows={5}
              value={keyPoints}
              placeholder="e.g. Most founders send too few emails per investor. We see replies after the second follow-up…"
              onChange={(e) => setKeyPoints(e.target.value)}
              onBlur={() => saveIfChanged("key_points", keyPoints, brief.key_points)}
            />
          </Field>

          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Call to action">
              <div className="flex gap-2">
                <select
                  className={selectClass}
                  value={brief.cta?.primary || "consultation"}
                  onChange={(e) => save({ cta: { ...brief.cta, primary: e.target.value } })}
                >
                  {CTA_PRIMARY.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                {brief.cta?.primary === "tool" && (
                  <Input
                    className="h-8 text-xs"
                    placeholder="Tool (optional)"
                    value={tool}
                    onChange={(e) => setTool(e.target.value)}
                    onBlur={() => tool !== (brief.cta?.tool || "") && save({ cta: { ...brief.cta, tool } })}
                  />
                )}
              </div>
            </Field>
            <Field label="Must link to">
              <div className="flex flex-wrap gap-1">
                {(brief.link_targets || []).length === 0 && <span className="text-xs text-muted-foreground">None yet</span>}
                {(brief.link_targets || []).map((l) => (
                  <span key={l.slug} className="inline-flex items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px]">
                    {l.kind === "pillar" ? "★ " : ""}/{l.slug}/
                    <button
                      type="button"
                      aria-label={`Remove ${l.slug}`}
                      onClick={() => save({ link_targets: brief.link_targets.filter((x) => x.slug !== l.slug) })}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            </Field>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={remove}>
                <Trash2 className="mr-1 h-3.5 w-3.5" /> Delete
              </Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => save({ status: brief.status === "skipped" ? "draft" : "skipped" })}>
                {brief.status === "skipped" ? "Unskip" : "Skip"}
              </Button>
            </div>
            {brief.status === "ready" ? (
              <div className="flex items-center gap-2">
                {genStatus && <span className="text-[11px] text-muted-foreground">{genStatus}</span>}
                <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => save({ status: "draft" })}>
                  Back to draft
                </Button>
                <Button type="button" size="sm" disabled={busy} onClick={onGenerate}>
                  {genStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1 h-3.5 w-3.5" />}
                  Write draft
                </Button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                {readyProblems.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">Needs {readyProblems.join(", ")}</span>
                )}
                <Button type="button" size="sm" disabled={readyProblems.length > 0} onClick={() => save({ status: "ready" })}>
                  <Check className="mr-1 h-3.5 w-3.5" /> Mark ready
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
