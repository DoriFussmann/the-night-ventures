import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowRight } from "lucide-react";
import { supabase } from "@/lib/supabase";

async function countRows(table, companyId) {
  const { count, error } = await supabase
    .from(table)
    .select("id", { count: "exact", head: true })
    .eq("company_id", companyId);
  if (error) throw error;
  return count || 0;
}

/**
 * The AEO Playbook box on Company Intelligence: links to the playbook editor,
 * which holds everything articles say about the company.
 */
export default function AeoPlaybookBox({ companyId }) {
  const [state, setState] = useState({ loading: true, error: "", counts: null });

  useEffect(() => {
    let cancelled = false;
    if (!companyId) return undefined;
    (async () => {
      try {
        const [{ data: pb, error: pbError }, personas, prompts, groups, pillars] = await Promise.all([
          supabase.from("aeo_playbook").select("brand_facts, icp").eq("company_id", companyId).maybeSingle(),
          countRows("aeo_personas", companyId),
          countRows("aeo_prompts", companyId),
          countRows("aeo_prompt_groups", companyId),
          countRows("aeo_pillars", companyId),
        ]);
        if (pbError) throw pbError;
        const facts = pb?.brand_facts || {};
        const brandFilled = ["offer", "customer", "problem", "difference", "proof", "conversion"].filter((k) =>
          String(facts[k] || "").trim()
        ).length;
        if (!cancelled)
          setState({ loading: false, error: "", counts: { brandFilled, icp: Boolean(pb?.icp), personas, prompts, groups, pillars } });
      } catch (err) {
        if (!cancelled) setState({ loading: false, error: err?.message || "Could not load", counts: null });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const base = `/company/${companyId}/aeo-playbook`;
  const c = state.counts;
  const tiles = [
    { tab: "brand", title: "Brand Facts", detail: c ? `${c.brandFilled}/6 areas` : "—" },
    { tab: "personas", title: "ICP & Personas", detail: c ? `${c.icp ? "ICP set" : "No ICP"} · ${c.personas} personas` : "—" },
    { tab: "prompts", title: "Prompts", detail: c ? `${c.prompts} prompts` : "—" },
    { tab: "map", title: "Content Map", detail: c ? `${c.pillars} pillars · ${c.groups} groups` : "—" },
  ];

  return (
    <section className="mb-4 rounded-lg border border-sky-200 bg-sky-50/40 p-4">
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-medium text-foreground">
            AEO Playbook
          </h2>
          <p className="mt-0.5 max-w-3xl text-xs text-muted-foreground">
            The source of truth for content: Brand Facts, ICP and personas, prompts, and the content map. Article writing, the
            AI-visibility audit and internal links all read from here.
          </p>
        </div>
        <Link to={base} className="inline-flex items-center gap-1 text-xs font-medium text-sky-800 hover:underline">
          Open AEO Playbook <ArrowRight className="h-3 w-3" />
        </Link>
      </div>
      {state.error ? (
        <p className="text-xs text-muted-foreground">
          Not set up yet ({state.error}). Run migration 075_aeo_playbook.sql in Supabase.
        </p>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {tiles.map((t) => (
            <Link
              key={t.tab}
              to={`${base}?tab=${t.tab}`}
              className="rounded-md border border-border bg-card px-3 py-2.5 transition-colors hover:bg-accent/40"
            >
              <span className="block text-sm font-medium text-foreground">{t.title}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground">{state.loading ? "Loading…" : t.detail}</span>
            </Link>
          ))}
        </div>
      )}
    </section>
  );
}
