import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, PenLine, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPlaybook } from "./aeoPlaybook/api";
import { createBriefs, loadBriefs, nextFreeBatchLabel } from "./aeoGeneration/briefs";
import BriefCard from "./aeoGeneration/BriefCard";
import SchedulePanel from "./aeoGeneration/SchedulePanel";
import {
  approveBrief,
  generateDraft,
  loadDrafts,
  loadTakenDays,
  todayHere,
  loadWriterContext,
  resetToReady,
  scheduleBriefs,
  syncPublished,
  unapproveBrief,
} from "./aeoGeneration/draft";
import { rankNextUp } from "../../../lib/aeo/nextUp.js";

const BATCH_SIZE = 5;
const DONE = new Set(["published"]);

function ElapsedTime({ since }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const secs = Math.max(0, Math.round((now - since) / 1000));
  return <span className="ml-auto tabular-nums text-sky-700">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</span>;
}

export default function AeoGeneration() {
  const { companyId } = useParams();
  const [data, setData] = useState(null);
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("batch");
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [drafts, setDrafts] = useState(new Map());
  const [busy, setBusy] = useState(false);
  const [genStatus, setGenStatus] = useState({});
  const [note, setNote] = useState("");
  const [taken, setTaken] = useState([]);
  const [progress, setProgress] = useState(null);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setError("");
    try {
      const [pb, first] = await Promise.all([loadPlaybook(companyId), loadBriefs(companyId)]);
      const groupsById = new Map(pb.groups.map((g) => [g.id, g]));
      const changed = await syncPublished(companyId, first, groupsById).catch(() => 0);
      const b = changed ? await loadBriefs(companyId) : first;
      const fresh = changed ? await loadPlaybook(companyId) : pb;
      setData(fresh);
      setBriefs(b);
      setDrafts(await loadDrafts(b.map((x) => x.generated_article_id).filter(Boolean)));
      setTaken(await loadTakenDays(companyId).catch(() => []));
    } catch (err) {
      setError(
        /aeo_briefs|topic_name|primary_keyword/.test(err?.message || "")
          ? `${err.message}. Run migration 076_aeo_briefs.sql in Supabase first.`
          : err?.message || "Failed to load"
      );
    } finally {
      setLoading(false);
    }
  }, [companyId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const ranked = useMemo(() => {
    if (!data) return [];
    const exclude = new Set(briefs.map((b) => b.group_id));
    return rankNextUp({ ...data, excludeGroupIds: exclude });
  }, [data, briefs]);

  const lookups = useMemo(() => {
    if (!data) return null;
    return {
      groupById: new Map(data.groups.map((g) => [g.id, g])),
      pillarById: new Map(data.pillars.map((p) => [p.id, p])),
      personasById: new Map(data.personas.map((p) => [p.id, p])),
      promptsByGroup: data.prompts.reduce((m, p) => {
        if (p.group_id) m.set(p.group_id, [...(m.get(p.group_id) || []), p]);
        return m;
      }, new Map()),
    };
  }, [data]);

  const suggested = ranked.slice(0, mode === "batch" ? BATCH_SIZE : 1);
  // Stable order: briefs in one batch share created_at, so tie-break on the
  // group code; otherwise cards swap places on every save.
  const openBriefs = briefs
    .filter((b) => !DONE.has(b.status))
    .sort(
      (a, b) =>
        String(a.created_at).localeCompare(String(b.created_at)) ||
        String(lookups?.groupById.get(a.group_id)?.code || "").localeCompare(String(lookups?.groupById.get(b.group_id)?.code || ""))
    );
  const batches = openBriefs.reduce((m, b) => {
    const key = b.batch_label || "Single articles";
    m.set(key, [...(m.get(key) || []), b]);
    return m;
  }, new Map());

  const onCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const label = mode === "batch" ? nextFreeBatchLabel(briefs) : "";
      await createBriefs(companyId, suggested, data, { batchLabel: label });
      await reload();
    } catch (err) {
      setError(err?.message || "Could not create briefs");
    } finally {
      setCreating(false);
    }
  };

  const run = async (fn) => {
    setBusy(true);
    setError("");
    setNote("");
    try {
      await fn();
    } catch (err) {
      setError(err?.message || "Something went wrong");
    } finally {
      setBusy(false);
      setGenStatus({});
      setProgress(null);
      await reload();
    }
  };

  const writeDrafts = (list) =>
    run(async () => {
      const writer = { positioning: await loadWriterContext(companyId, data.playbook.brand_facts), brandFacts: data.playbook.brand_facts };
      const context = [];
      const problems = [];
      for (let i = 0; i < list.length; i += 1) {
        const brief = list[i];
        const group = lookups.groupById.get(brief.group_id);
        const label = list.length > 1 ? `${i + 1} of ${list.length}: ` : "";
        const batch = brief.batch_label || "Single articles";
        const started = Date.now();
        setProgress({ batch, text: `Article ${i + 1} of ${list.length} · ${brief.title} · starting…`, started });
        try {
          const res = await generateDraft({
            companyId,
            brief,
            group,
            pillar: lookups.pillarById.get(group?.pillar_id),
            prompts: lookups.promptsByGroup.get(brief.group_id) || [],
            writer,
            batchContext: context,
            onStatus: (msg) => {
              setGenStatus((m) => ({ ...m, [brief.id]: `${label}${msg}` }));
              setProgress({ batch, text: `Article ${i + 1} of ${list.length} · ${brief.title} · ${msg}`, started });
            },
          });
          context.push({ title: res.row.title, slug: res.row.slug, type: res.row.type, targetKeyword: res.row.target_keyword, oneLinerSummary: res.row.description });
          setProgress({ batch, text: `Article ${i + 1} of ${list.length} done: ${res.row.title}`, started });
          if (res.heroMissing) problems.push(`"${res.row.title}": no hero image; add one in Articles.`);
        } catch (err) {
          problems.push(`"${brief.title}": ${err?.message || "writing failed"}`);
        }
      }
      setNote(problems.length ? `Done, with problems: ${problems.join(" ")}` : `Wrote ${list.length} draft${list.length === 1 ? "" : "s"}. Read and approve below.`);
    });

  const schedule = (list, start) =>
    run(async () => {
      const placed = await scheduleBriefs({
        companyId,
        briefs: list,
        groupsById: lookups.groupById,
        pillarsById: lookups.pillarById,
        draftsById: drafts,
        start,
      });
      setNote(`Scheduled: ${placed.map((p) => `${p.day} · ${p.brief.title}`).join(" | ")}`);
    });

  return (
    <div className="space-y-5">
      <div>
        <Link
          to={`/company/${companyId}/aeo-playbook`}
          className="mb-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-3 w-3" /> AEO Playbook
        </Link>
        <h1 className="flex items-center gap-2 text-lg font-medium text-foreground">
          AEO Generation
          <span className="rounded border border-emerald-300 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider text-emerald-800">
            New
          </span>
        </h1>
        <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
          What to write next, from the content map. Create briefs, add your key points and mark them ready; write the
          drafts, review and approve them, then pick a start day and schedule: one article goes live per workday.
        </p>
      </div>

      {note && <p className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground">{note}</p>}
      {error && (
        <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </p>
      ) : data && lookups ? (
        <>
          <section className="space-y-3 rounded-lg border border-border bg-card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-medium text-foreground">Next up</h2>
                <p className="text-xs text-muted-foreground">{ranked.length} prompt groups without an article or brief.</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="inline-flex rounded-md border border-border p-0.5 text-xs">
                  {[
                    ["single", "Single"],
                    ["batch", `Weekly batch of ${BATCH_SIZE}`],
                  ].map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setMode(value)}
                      className={`rounded px-2 py-1 ${mode === value ? "bg-foreground text-background" : "text-muted-foreground"}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <Button type="button" size="sm" disabled={creating || !suggested.length} onClick={onCreate}>
                  {creating ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                  {mode === "batch" ? `Create ${suggested.length} briefs · ${nextFreeBatchLabel(briefs)}` : "Create brief"}
                </Button>
              </div>
            </div>
            <ol className="space-y-1.5">
              {(showAll ? ranked : ranked.slice(0, Math.max(suggested.length, 10))).map((item, i) => (
                <li
                  key={item.group.id}
                  className={`flex items-baseline gap-3 rounded-md px-2 py-1.5 text-sm ${i < suggested.length ? "bg-emerald-50/60" : ""}`}
                >
                  <span className="w-6 shrink-0 text-right text-xs text-muted-foreground">{item.rank}</span>
                  <span className="min-w-0">
                    <span className="text-foreground">{item.group.name}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {item.group.code} · {item.reason} · {item.stats.count} prompts
                    </span>
                  </span>
                </li>
              ))}
            </ol>
            {ranked.length > 10 && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowAll((v) => !v)}>
                {showAll ? "Show fewer" : `Show all ${ranked.length}`}
              </button>
            )}
          </section>

          <SchedulePanel
            approved={openBriefs
              .filter((b) => b.status === "approved")
              .map((b) => {
                const pillar = lookups.pillarById.get(lookups.groupById.get(b.group_id)?.pillar_id);
                return { ...b, warn: pillar && !pillar.hub_path ? "topic page not built yet" : "" };
              })}
            today={todayHere()}
            taken={taken}
            busy={busy}
            onSchedule={schedule}
          />

          {[...batches.entries()].map(([label, list]) => (
            <section key={label} className="space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-medium text-foreground">
                  {label}{" "}
                  <span className="text-xs font-normal text-muted-foreground">
                    · {list.filter((b) => b.status === "ready").length} ready · {list.filter((b) => b.status === "generated").length} to review ·{" "}
                    {list.filter((b) => b.status === "approved").length} approved · {list.filter((b) => b.status === "scheduled").length} scheduled
                  </span>
                </h2>
                <div className="flex gap-2">
                  {list.some((b) => b.status === "ready") && (
                    <Button type="button" variant="outline" size="sm" disabled={busy} onClick={() => writeDrafts(list.filter((b) => b.status === "ready"))}>
                      {busy ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <PenLine className="mr-1.5 h-3.5 w-3.5" />}
                      Write {list.filter((b) => b.status === "ready").length} ready draft{list.filter((b) => b.status === "ready").length === 1 ? "" : "s"}
                    </Button>
                  )}
                </div>
              </div>
              {progress?.batch === label && (
                <p className="flex items-center gap-2 rounded-md bg-sky-50 px-3 py-2 text-xs text-sky-900">
                  <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  {progress.text}
                  <ElapsedTime since={progress.started} />
                </p>
              )}
              <div className="space-y-2">
                {list.map((b) => {
                  const group = lookups.groupById.get(b.group_id);
                  if (!group) return null;
                  return (
                    <BriefCard
                      key={b.id}
                      companyId={companyId}
                      brief={b}
                      group={group}
                      pillar={lookups.pillarById.get(group.pillar_id)}
                      prompts={lookups.promptsByGroup.get(group.id) || []}
                      personasById={lookups.personasById}
                      onChanged={reload}
                      onError={setError}
                      draft={drafts.get(b.generated_article_id)}
                      busy={busy}
                      genStatus={genStatus[b.id]}
                      onGenerate={() => writeDrafts([b])}
                      onApprove={() => run(() => approveBrief(b))}
                      onUnapprove={() => run(() => unapproveBrief(b))}
                      onRedo={() => {
                        if (window.confirm("Write this article again from the brief? The current draft stays in the Articles library.")) {
                          run(() => resetToReady(b, group));
                        }
                      }}
                    />
                  );
                })}
              </div>
            </section>
          ))}
        </>
      ) : null}
    </div>
  );
}
