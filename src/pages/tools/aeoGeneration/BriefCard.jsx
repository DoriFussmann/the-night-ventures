import React, { useState } from "react";
import { Check, Download, Library, ListPlus, Loader2, PenLine, Plus, Sparkles, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  ARTICLE_TYPES,
  BRIEF_STATUS_LABELS,
  CTA_PRIMARY,
  deleteBrief,
  outlineToText,
  suggestOutline,
  textToOutline,
  updateBrief,
} from "./briefs";
import { downloadBriefMarkdown } from "./briefMarkdown";
import { draftHotTake, matchHotTakes, saveTakeToBank } from "./hotTakes";
import { appendTake, hasTake, takesNotInBank } from "../../../../lib/aeo/hotTakesBank.js";
import DraftPanel, { formatPublishAt } from "./DraftPanel";

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
  bank,
  onBankChanged,
  onChanged,
  onError,
  draft,
  publishAt,
  busy,
  genStatus,
  onGenerate,
  pipelineOpen,
  writing,
  queuePosition,
  onQueue,
  onUnqueue,
  onApprove,
  onUnapprove,
  onRedo,
  onNewImage,
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
  const [found, setFound] = useState(null); // {matches, conflicts}: what "Find in my bank" returned
  const [newTake, setNewTake] = useState(null); // {take, basedOn, why}: a draft, not yet in the field
  const [bankBusy, setBankBusy] = useState("");
  const [bankError, setBankError] = useState("");
  const [bankNote, setBankNote] = useState("");

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

  const askBank = async (what) => {
    setBankBusy(what);
    setBankError("");
    const about = { companyId, groupId: group.id, title, angle, outline };
    try {
      if (what === "match") setFound(await matchHotTakes(about));
      else setNewTake(await draftHotTake({ ...about, current: keyPoints }));
    } catch (err) {
      setBankError(err?.message || "The bank could not be read");
    } finally {
      setBankBusy("");
    }
  };
  // Takes in the field that the bank does not hold yet: typed here, or a draft that was accepted.
  const bankReady = Boolean(bank?.takes) && !bank.missing;
  const unsaved = bankReady ? takesNotInBank(keyPoints, bank.takes) : [];
  const saveToBank = async (take) => {
    setBankBusy(`save:${take}`);
    setBankError("");
    try {
      const res = await saveTakeToBank(companyId, bank.companyName, {
        take,
        original: take,
        topic: pillar?.name || "",
        kind: "Opinion",
        source: `${group.code} · ${title || group.name} (saved from the brief)`,
      });
      setBankNote(res.saved ? `Saved to the bank as ${res.saved}.` : `Already in the bank as ${res.duplicate}; not added again.`);
      await onBankChanged?.();
    } catch (err) {
      setBankError(err?.message || "Could not save to the bank");
    } finally {
      setBankBusy("");
    }
  };
  const addTakes = (texts) => {
    const next = texts.reduce((cur, t) => appendTake(cur, t), keyPoints || "");
    if (next === (keyPoints || "").trim()) return;
    setKeyPoints(next);
    save({ key_points: next });
  };
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
          {queuePosition > 0 || writing ? (
            <p className="mt-0.5 text-xs font-medium text-sky-800 dark:text-sky-300">
              {writing ? "Writing the draft now" : `In draft pipeline · ${queuePosition === 1 ? "next" : `#${queuePosition}`}`}
            </p>
          ) : null}
          {publishAt ? (
            <p className="mt-0.5 text-xs font-medium text-violet-800 dark:text-violet-300">
              Publishes {formatPublishAt(publishAt)}
            </p>
          ) : null}
        </div>
        <span className={`shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${STATUS_STYLE[brief.status] || STATUS_STYLE.draft}`}>
          {BRIEF_STATUS_LABELS[brief.status] || brief.status}
        </span>
      </button>

      {open && REVIEW_STATUSES.has(brief.status) && (
        <div className="border-t border-border p-3">
          <DraftPanel
            companyId={companyId}
            brief={brief}
            draft={draft}
            publishAt={publishAt}
            busy={busy}
            onApprove={onApprove}
            onUnapprove={onUnapprove}
            onRedo={onRedo}
            onNewImage={onNewImage}
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

          <Field label="Your hot takes" hint="Your own position on this topic: what you'd tell a client. The writer leads with these.">
            <Textarea
              rows={5}
              value={keyPoints}
              placeholder="e.g. A first-hand observation from client work that only you could write…"
              onChange={(e) => setKeyPoints(e.target.value)}
              onBlur={() => saveIfChanged("key_points", keyPoints, brief.key_points)}
            />
          </Field>

          <div className="space-y-2 rounded-md border border-dashed border-border px-3 py-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" disabled={Boolean(bankBusy)} onClick={() => askBank("match")}>
                {bankBusy === "match" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Library className="mr-1.5 h-3.5 w-3.5" />}
                {bankBusy === "match" ? "Reading your bank…" : "Find in my bank"}
              </Button>
              <Button type="button" variant="outline" size="sm" disabled={Boolean(bankBusy)} onClick={() => askBank("new")}>
                {bankBusy === "new" ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Sparkles className="mr-1.5 h-3.5 w-3.5" />}
                {bankBusy === "new" ? "Drafting…" : "Draft a new take"}
              </Button>
              <span className="text-[11px] text-muted-foreground">
                What you have already said on this topic, and a new take drafted from your other takes. Nothing is added until you click Add.
              </span>
            </div>
            {bankError && <p className="text-xs text-destructive">{bankError}</p>}
            {bank?.missing && <p className="text-xs text-destructive">Hot takes bank: {bank.missing}</p>}
            {bankNote && <p className="text-xs text-foreground">{bankNote}</p>}

            {unsaved.length > 0 && (
              <details className="space-y-1.5">
                <summary className="cursor-pointer text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  On this brief, not in your bank yet · {unsaved.length}
                </summary>
                <p className="text-[11px] text-muted-foreground">
                  Save only what is your own position. Points Claude wrote from a theme view also show here.
                </p>
                {unsaved.map((t) => (
                  <div key={t} className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5">
                    <p className="min-w-0 flex-1 text-xs text-foreground">{t}</p>
                    <Button type="button" variant="ghost" size="sm" disabled={Boolean(bankBusy)} onClick={() => saveToBank(t)}>
                      {bankBusy === `save:${t}` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Library className="mr-1 h-3.5 w-3.5" />}
                      Save to bank
                    </Button>
                  </div>
                ))}
              </details>
            )}

            {found && found.matches.length === 0 && (
              <p className="text-xs text-muted-foreground">Nothing in your bank speaks to this topic yet.</p>
            )}
            {found && found.matches.length > 0 && (
              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    From your bank · {found.matches.length}
                  </span>
                  <Button type="button" variant="ghost" size="sm" onClick={() => addTakes(found.matches.map((m) => m.take))}>
                    Add all
                  </Button>
                </div>
                {found.conflicts.map((c) => (
                  <p key={c.codes.join("-")} className="rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
                    {c.codes.join(" and ")} disagree: {c.why} Add one, or fix the bank.
                  </p>
                ))}
                {found.matches.map((m) => {
                  const added = hasTake(keyPoints, m.take);
                  return (
                    <div key={m.code} className="flex items-start gap-2 rounded-md border border-border px-2 py-1.5">
                      <div className="min-w-0 flex-1">
                        <p className="text-xs text-foreground">{m.take}</p>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          <span className="font-mono">{m.code}</span> · {m.topic}
                          {m.why ? ` · ${m.why}` : ""}
                          {m.note ? ` · Note: ${m.note}` : ""}
                        </p>
                      </div>
                      <Button type="button" variant="ghost" size="sm" disabled={added} onClick={() => addTakes([m.take])}>
                        {added ? <Check className="mr-1 h-3.5 w-3.5" /> : <Plus className="mr-1 h-3.5 w-3.5" />}
                        {added ? "Added" : "Add"}
                      </Button>
                    </div>
                  );
                })}
              </div>
            )}

            {newTake && !newTake.take && (
              <p className="text-xs text-muted-foreground">No new take drafted{newTake.why ? `: ${newTake.why}` : "."}</p>
            )}
            {newTake && newTake.take && (
              <div className="space-y-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                  New take · a draft, not yet yours
                </span>
                <Textarea rows={3} className="text-xs" value={newTake.take} onChange={(e) => setNewTake({ ...newTake, take: e.target.value })} />
                <p className="text-[11px] text-muted-foreground">
                  {newTake.basedOn.length ? `Built on ${newTake.basedOn.join(", ")}. ` : ""}
                  {newTake.why}
                </p>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      addTakes([newTake.take]);
                      setNewTake(null);
                    }}
                  >
                    <Plus className="mr-1 h-3.5 w-3.5" /> Add to this article
                  </Button>
                  <Button type="button" variant="ghost" size="sm" onClick={() => setNewTake(null)}>
                    Discard
                  </Button>
                </div>
              </div>
            )}
          </div>

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
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  downloadBriefMarkdown({ brief, group, pillar, prompts, personasById, title, keyword, angle, outlineText, keyPoints })
                }
              >
                <Download className="mr-1 h-3.5 w-3.5" /> Download .md
              </Button>
            </div>
            {brief.status === "ready" ? (
              <div className="flex items-center gap-2">
                {genStatus && <span className="text-[11px] text-muted-foreground">{genStatus}</span>}
                {queuePosition > 0 ? (
                  <>
                    <span className="text-[11px] text-muted-foreground">
                      In draft pipeline · {queuePosition === 1 ? "next" : `#${queuePosition}`}
                    </span>
                    <Button type="button" variant="ghost" size="sm" onClick={onUnqueue}>
                      <X className="mr-1 h-3.5 w-3.5" /> Remove from pipeline
                    </Button>
                  </>
                ) : pipelineOpen && !writing ? (
                  <Button type="button" variant="outline" size="sm" onClick={onQueue}>
                    <ListPlus className="mr-1 h-3.5 w-3.5" /> Add to draft pipeline
                  </Button>
                ) : (
                  <>
                    <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => save({ status: "draft" })}>
                      Back to draft
                    </Button>
                    <Button type="button" size="sm" disabled={busy} onClick={onGenerate}>
                      {writing || genStatus ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1 h-3.5 w-3.5" />}
                      Write draft
                    </Button>
                  </>
                )}
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
