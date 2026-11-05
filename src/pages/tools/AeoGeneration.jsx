import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Loader2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { loadPlaybook } from "./aeoPlaybook/api";
import { createBriefs, loadBriefs, nextMonday } from "./aeoGeneration/briefs";
import BriefCard from "./aeoGeneration/BriefCard";
import { rankNextUp } from "../../../lib/aeo/nextUp.js";

const BATCH_SIZE = 5;
const DONE = new Set(["published"]);

export default function AeoGeneration() {
  const { companyId } = useParams();
  const [data, setData] = useState(null);
  const [briefs, setBriefs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [mode, setMode] = useState("batch");
  const [creating, setCreating] = useState(false);
  const [showAll, setShowAll] = useState(false);

  const reload = useCallback(async () => {
    if (!companyId) return;
    setError("");
    try {
      const [pb, b] = await Promise.all([loadPlaybook(companyId), loadBriefs(companyId)]);
      setData(pb);
      setBriefs(b);
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
  const openBriefs = briefs.filter((b) => !DONE.has(b.status));
  const batches = openBriefs.reduce((m, b) => {
    const key = b.batch_label || "Single articles";
    m.set(key, [...(m.get(key) || []), b]);
    return m;
  }, new Map());

  const onCreate = async () => {
    setCreating(true);
    setError("");
    try {
      const label = mode === "batch" ? `Week of ${nextMonday()}` : "";
      await createBriefs(companyId, suggested, data, { batchLabel: label });
      await reload();
    } catch (err) {
      setError(err?.message || "Could not create briefs");
    } finally {
      setCreating(false);
    }
  };

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
          What to write next, from the content map. Create a brief, add your key points, mark it ready. Drafting,
          approval and publishing from a ready brief come in the next update.
        </p>
      </div>

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
                  {mode === "batch" ? `Create ${suggested.length} briefs` : "Create brief"}
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

          {[...batches.entries()].map(([label, list]) => (
            <section key={label} className="space-y-2">
              <h2 className="text-sm font-medium text-foreground">
                {label}{" "}
                <span className="text-xs font-normal text-muted-foreground">
                  · {list.filter((b) => b.status === "ready").length}/{list.length} ready
                </span>
              </h2>
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
