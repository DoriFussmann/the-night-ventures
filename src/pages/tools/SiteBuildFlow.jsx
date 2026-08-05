import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { ChevronDown, ListChecks, Plus, RefreshCw, Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import WorkflowStepper, {
  nextWorkflowStatus,
} from "@/components/WorkflowStepper";

const STAGES = [
  {
    id: "infra-build",
    name: "Infra Build",
    location: "Cursor / repo",
  },
  {
    id: "design-build",
    name: "Design Build",
    location: "Cursor / repo",
  },
  {
    id: "deployment-infra",
    name: "Deployment & Infrastructure",
    location: "Vercel / Supabase",
  },
  {
    id: "make-it-specific",
    name: "Make It Specific",
    location: "TNV Company Data + Specific Prompt + Cursor",
  },
  {
    id: "seed-content",
    name: "Seed Content",
    location: "TNV Topic Generator + Article Generation",
  },
  {
    id: "full-site-content-build",
    name: "Full Site Content Build",
    location: "TNV Site Content Build + Cursor",
  },
  {
    id: "live-wiring-qa",
    name: "Live Wiring & Post-Launch QA",
    location: "External dashboards",
  },
];

const PREDEFINED_ITEMS = {
  "infra-build": [
    {
      item_key: "init-cursor-git",
      label: "Open a new Cursor project / repo and initialize git",
    },
    {
      item_key: "run-infra-scaffold-prompt",
      label: "Paste the Infra Scaffold Prompt into Cursor and run it",
    },
    {
      item_key: "build-zero-errors",
      label: "npm run build completes with zero errors",
    },
    {
      item_key: "dev-pages-render",
      label: "npm run dev renders home, article, and team pages correctly",
    },
    {
      item_key: "view-source-meta",
      label:
        "View-source spot check: title, meta description, canonical, OG tags present",
    },
    {
      item_key: "json-ld-present",
      label:
        "JSON-LD present: Organization, BlogPosting, Person, BreadcrumbList",
    },
    {
      item_key: "discovery-files-present",
      label:
        "llms.txt, sitemap-index.xml, robots.txt, rss.xml all present and populated",
    },
    {
      item_key: "drafts-no-live-route",
      label: "Draft articles produce zero live route",
    },
    {
      item_key: "cms-e2e-tested",
      label:
        "CMS tested end-to-end: fake image path rejected, short alt text rejected, Generate blocked with visible reason when required fields missing, oversized file rejected clearly, editing an existing article doesn't duplicate it, invalid internal/external links flagged, Dashboard counts verified by hand",
    },
    {
      item_key: "placeholder-grep-clean",
      label:
        "Repo-wide grep for placeholder text returns nothing outside the identity config file",
    },
  ],
  "design-build": [
    {
      item_key: "design-guide-complete",
      label: "Design Guide.md placed in project root and complete, not placeholder",
    },
    {
      item_key: "run-design-system-prompt",
      label:
        "Paste the Design System Prompt into Cursor and run it (only after Infra Build stage fully passes)",
    },
    {
      item_key: "build-still-zero-errors",
      label: "npm run build still completes with zero errors",
    },
    {
      item_key: "hard-boundaries-untouched",
      label:
        "Hard boundaries confirmed untouched: JSON-LD, meta tags, heading structure identical to pre-design",
    },
    {
      item_key: "visual-pass-guide",
      label: "Visual pass completed against Design Guide's component direction",
    },
    {
      item_key: "hero-copy-updated",
      label: "Hero copy updated from Design Guide, if provided",
    },
    {
      item_key: "lighthouse-90-plus",
      label:
        "Lighthouse: Performance, Accessibility, Best Practices, SEO all score 90+",
    },
    {
      item_key: "a11y-baseline",
      label:
        "Accessibility baseline confirmed: contrast ratios, visible focus states, 44x44 tap targets, readable at 200% zoom",
    },
  ],
  "deployment-infra": [
    {
      item_key: "vercel-site-linked",
      label: "Vercel project created and linked to the site repo",
    },
    {
      item_key: "cms-hosting-set",
      label: "CMS hosting set up, or confirmed local-only by design",
    },
    {
      item_key: "vercel-env-vars",
      label:
        "Environment variables set in Vercel: ANTHROPIC_API_KEY, Supabase URL/keys, any others required",
    },
    {
      item_key: "supabase-project-created",
      label: "Supabase project created",
    },
    {
      item_key: "migrations-run",
      label: "SQL Editor: all migrations run in order with no errors",
    },
    {
      item_key: "rls-verified",
      label: "RLS policies verified on all pipeline tables",
    },
    {
      item_key: "production-deploy-ok",
      label: "Production build deploys successfully and the live URL loads",
    },
    {
      item_key: "custom-domain-ssl",
      label: "Custom domain connected and SSL active",
    },
  ],
  "make-it-specific": [
    {
      item_key: "company-data-populated",
      label:
        "Company Data populated in TNV: positioning, keyword architecture, competitors, services/products, team, Design Guidelines abstract",
    },
    {
      item_key: "specific-prompt-audit",
      label: "Specific Prompt audit (Tab 1) run in Cursor against the live repo",
    },
    {
      item_key: "personalize-prompt-generated",
      label:
        "Audit report pasted into Specific Prompt Tab 2, Personalize Prompt generated",
    },
    {
      item_key: "zero-needs-input",
      label: "Zero [NEEDS INPUT] markers remain in the generated prompt",
    },
    {
      item_key: "fill-prompt-run",
      label: "Fill prompt run in Cursor",
    },
    {
      item_key: "severity-items-resolved",
      label: "Every highest-severity audit item resolved with an explicit decision",
    },
    {
      item_key: "template-grep-clean",
      label:
        "Repo-wide grep for template leftovers returns zero hits outside legitimate editorial content",
    },
    {
      item_key: "homepage-services-reviewed",
      label:
        "Homepage and services reviewed live: real positioning, no template instruction text",
    },
  ],
  "seed-content": [
    {
      item_key: "two-pillars-generated",
      label: "At least 2 pillar articles planned and generated",
    },
    {
      item_key: "cluster-per-pillar",
      label: "At least 1 supporting cluster generated under each seeded pillar",
    },
    {
      item_key: "hero-images-generated",
      label: "Cluster/pillar hero images generated",
    },
    {
      item_key: "cms-publish-each-article",
      label: "Each article published through the CMS: author, image, links set",
    },
    {
      item_key: "deployed",
      label: "Deployed",
    },
    {
      item_key: "marked-published-with-url",
      label:
        "Each article marked Published in Topic Generator with its live URL",
    },
  ],
  "full-site-content-build": [
    {
      item_key: "page-selection-reviewed",
      label:
        "Page selection reviewed: Testimonials and Legal pages deliberately included or excluded, not left at default without a decision",
    },
    {
      item_key: "company-data-confirmed-current",
      label:
        "Company Data confirmed current before generating (positioning, services, team, Design Guidelines abstract) — regenerate the prompt if any changed since Make It Specific",
    },
    {
      item_key: "prompt-reviewed-before-cursor",
      label:
        "Generated prompt reviewed before running in Cursor — no contradictory or ambiguous instructions (e.g. check Contact page method, any soft 'if feasible' language) resolved to an explicit decision first",
    },
    {
      item_key: "full-site-prompt-run",
      label: "Prompt run in Cursor",
    },
    {
      item_key: "build-clean-pages-render",
      label:
        "Build completes clean, all new routes render (About, Services, Contact, and any others enabled)",
    },
    {
      item_key: "nav-footer-updated",
      label:
        "Nav and footer updated with all new page links, confirmed working",
    },
    {
      item_key: "image-placeholder-checklist",
      label:
        "Image placeholder checklist extracted from Cursor's report — one concrete sourcing task per placeholder",
    },
    {
      item_key: "no-fabricated-content-spot-check",
      label:
        "No fabricated testimonials, metrics, or legal text present anywhere in generated pages — spot-checked directly, not just trusted from Cursor's report",
    },
    {
      item_key: "deployed-full-content",
      label: "Deployed — site live with full real content end-to-end",
    },
  ],
  "live-wiring-qa": [
    {
      item_key: "gsc-verified",
      label: "Google Search Console verified (Domain property)",
    },
    {
      item_key: "bing-verified",
      label: "Bing Webmaster Tools verified",
    },
    {
      item_key: "analytics-receiving",
      label: "Analytics installed and confirmed receiving data",
    },
    {
      item_key: "sitemap-submitted",
      label: "Sitemap submitted in GSC and Bing",
    },
    {
      item_key: "speed-scores-recorded",
      label:
        "PageSpeed Insights / GTmetrix / Lighthouse run on live URLs, scores recorded",
    },
    {
      item_key: "trimmed-seo-baseline",
      label:
        "Trimmed SEO baseline check run (Semrush snapshot, robots/canonical/schema spot-check)",
    },
    {
      item_key: "gsc-security-clean",
      label: "GSC Security Issues and Manual Actions confirmed clean",
    },
    {
      item_key: "rank-tracking-set",
      label: "Rank tracking set up",
    },
    {
      item_key: "contact-method-reviewed",
      label:
        "Contact page method reviewed: confirm mailto vs. form-service choice was intentional, not a silent Cursor default, and that any form service (Formspree/Netlify Forms) is properly configured if used.",
    },
  ],
};

function defaultStageStatuses() {
  return Object.fromEntries(STAGES.map((stage) => [stage.id, "pending"]));
}

function ChecklistItemRow({
  item,
  expanded,
  onToggleExpand,
  onToggleStatus,
  onSaveDetails,
  onDelete,
}) {
  const [note, setNote] = useState(item.note || "");
  const [proofUrl, setProofUrl] = useState(item.proof_url || "");
  const done = item.status === "done";

  useEffect(() => {
    setNote(item.note || "");
    setProofUrl(item.proof_url || "");
  }, [item.id, item.note, item.proof_url]);

  const saveIfChanged = () => {
    const nextNote = note.trim() || null;
    const nextProof = proofUrl.trim() || null;
    const prevNote = item.note || null;
    const prevProof = item.proof_url || null;
    if (nextNote === prevNote && nextProof === prevProof) return;
    onSaveDetails(item.id, { note: nextNote, proof_url: nextProof });
  };

  return (
    <div className="rounded-lg border border-border bg-background">
      <div className="flex items-start gap-3 px-3 py-2.5">
        <Checkbox
          checked={done}
          onCheckedChange={() => onToggleStatus(item)}
          className="mt-0.5"
          aria-label={done ? "Mark pending" : "Mark done"}
        />
        <button
          type="button"
          onClick={() => onToggleExpand(item.id)}
          className="min-w-0 flex-1 text-left"
        >
          <span
            className={`text-sm leading-snug ${
              done ? "text-muted-foreground line-through" : "text-foreground"
            }`}
          >
            {item.label}
          </span>
          {(item.note || item.proof_url) && !expanded && (
            <span className="mt-1 block truncate text-xs text-muted-foreground">
              {item.note ? "Has note" : ""}
              {item.note && item.proof_url ? " · " : ""}
              {item.proof_url ? "Has proof URL" : ""}
            </span>
          )}
        </button>
        <button
          type="button"
          title={expanded ? "Collapse details" : "Add note / proof"}
          aria-expanded={expanded}
          onClick={() => onToggleExpand(item.id)}
          className={`rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground ${
            expanded ? "bg-accent text-foreground" : ""
          }`}
        >
          <ChevronDown
            className={`h-4 w-4 transition-transform ${expanded ? "rotate-180" : ""}`}
          />
        </button>
        {item.is_custom && (
          <button
            type="button"
            title="Delete custom item"
            aria-label="Delete custom item"
            onClick={() => onDelete(item)}
            className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {expanded && (
        <div className="space-y-3 border-t border-border px-3 py-3">
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor={`note-${item.id}`}>
              Note
            </label>
            <Textarea
              id={`note-${item.id}`}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onBlur={saveIfChanged}
              rows={2}
              placeholder="Optional note…"
              className="text-sm"
            />
          </div>
          <div className="space-y-1.5">
            <label
              className="text-xs font-medium text-muted-foreground"
              htmlFor={`proof-${item.id}`}
            >
              Proof URL
            </label>
            <Input
              id={`proof-${item.id}`}
              value={proofUrl}
              onChange={(e) => setProofUrl(e.target.value)}
              onBlur={saveIfChanged}
              placeholder="https://…"
              className="text-sm"
            />
          </div>
        </div>
      )}
    </div>
  );
}

export default function SiteBuildFlow() {
  const { companyId } = useParams();
  const [stageStatuses, setStageStatuses] = useState(defaultStageStatuses);
  const [itemsByStage, setItemsByStage] = useState({});
  const [selectedStageKey, setSelectedStageKey] = useState(STAGES[0].id);
  const [expandedItemId, setExpandedItemId] = useState(null);
  const [newItemLabel, setNewItemLabel] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [adding, setAdding] = useState(false);
  const [confirmResetOpen, setConfirmResetOpen] = useState(false);
  const [confirmDeleteItem, setConfirmDeleteItem] = useState(null);
  const [resetting, setResetting] = useState(false);

  const loadAndSeed = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [stagesResult, itemsResult] = await Promise.all([
      supabase
        .from("site_build_stages")
        .select("stage_key, status, updated_at")
        .eq("company_id", companyId),
      supabase
        .from("site_build_checklist_items")
        .select(
          "id, company_id, stage_key, item_key, label, status, note, proof_url, is_custom, sort_order, created_at, updated_at"
        )
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);

    if (stagesResult.error || itemsResult.error) {
      const message =
        stagesResult.error?.message ||
        itemsResult.error?.message ||
        "Failed to load Site Build Flow";
      console.error(stagesResult.error || itemsResult.error);
      setError(message);
      setLoading(false);
      return;
    }

    const existingStages = stagesResult.data || [];
    const existingItems = itemsResult.data || [];

    const missingStageRows = STAGES.filter(
      (stage) => !existingStages.some((row) => row.stage_key === stage.id)
    ).map((stage) => ({
      company_id: companyId,
      stage_key: stage.id,
      status: "pending",
    }));

    if (missingStageRows.length > 0) {
      const { error: stageInsertError } = await supabase
        .from("site_build_stages")
        .insert(missingStageRows);
      if (stageInsertError) {
        console.error(stageInsertError);
        setError(stageInsertError.message || "Failed to initialize stages");
        setLoading(false);
        return;
      }
    }

    const itemsPresentByStage = new Set(existingItems.map((item) => item.stage_key));
    const seedRows = [];
    for (const stage of STAGES) {
      if (itemsPresentByStage.has(stage.id)) continue;
      const predefined = PREDEFINED_ITEMS[stage.id] || [];
      predefined.forEach((entry, index) => {
        seedRows.push({
          company_id: companyId,
          stage_key: stage.id,
          item_key: entry.item_key,
          label: entry.label,
          status: "pending",
          note: null,
          proof_url: null,
          is_custom: false,
          sort_order: index,
        });
      });
    }

    let seededItems = [];
    if (seedRows.length > 0) {
      const { data: inserted, error: seedError } = await supabase
        .from("site_build_checklist_items")
        .insert(seedRows)
        .select(
          "id, company_id, stage_key, item_key, label, status, note, proof_url, is_custom, sort_order, created_at, updated_at"
        );
      if (seedError) {
        console.error(seedError);
        setError(seedError.message || "Failed to seed checklist items");
        setLoading(false);
        return;
      }
      seededItems = inserted || [];
    }

    const stageMap = defaultStageStatuses();
    for (const row of existingStages) {
      if (stageMap[row.stage_key] !== undefined) {
        stageMap[row.stage_key] = row.status || "pending";
      }
    }
    // Newly inserted stages stay pending (already in defaultStageStatuses).

    const allItems = [...existingItems, ...seededItems];
    const grouped = Object.fromEntries(STAGES.map((stage) => [stage.id, []]));
    for (const item of allItems) {
      if (!grouped[item.stage_key]) grouped[item.stage_key] = [];
      grouped[item.stage_key].push(item);
    }
    for (const stageKey of Object.keys(grouped)) {
      grouped[stageKey].sort((a, b) => {
        if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
        return String(a.created_at).localeCompare(String(b.created_at));
      });
    }

    setStageStatuses(stageMap);
    setItemsByStage(grouped);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    setSelectedStageKey(STAGES[0].id);
    setExpandedItemId(null);
    setNewItemLabel("");
    loadAndSeed();
  }, [loadAndSeed]);

  const selectedStage = useMemo(
    () => STAGES.find((stage) => stage.id === selectedStageKey) || STAGES[0],
    [selectedStageKey]
  );

  const selectedItems = itemsByStage[selectedStageKey] || [];
  const selectedDoneCount = selectedItems.filter((item) => item.status === "done").length;
  const selectedStageIndex = STAGES.findIndex((stage) => stage.id === selectedStageKey) + 1;

  const doneStageCount = useMemo(
    () => STAGES.filter((stage) => stageStatuses[stage.id] === "done").length,
    [stageStatuses]
  );

  const cycleStageStatus = async (stageKey) => {
    if (!companyId) return;
    const previous = stageStatuses[stageKey] || "pending";
    const next = nextWorkflowStatus(previous);

    setStageStatuses((prev) => ({ ...prev, [stageKey]: next }));
    setSelectedStageKey(stageKey);

    const { error: updateError } = await supabase
      .from("site_build_stages")
      .upsert(
        {
          company_id: companyId,
          stage_key: stageKey,
          status: next,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "company_id,stage_key" }
      );

    if (updateError) {
      console.error(updateError);
      setStageStatuses((prev) => ({ ...prev, [stageKey]: previous }));
      setError(updateError.message || "Failed to update stage status");
    }
  };

  const selectStageChecklist = (stageKey, event) => {
    event.stopPropagation();
    setSelectedStageKey(stageKey);
    setExpandedItemId(null);
  };

  const toggleItemStatus = async (item) => {
    if (!companyId) return;
    const previous = item.status;
    const next = previous === "done" ? "pending" : "done";
    const updatedAt = new Date().toISOString();

    setItemsByStage((prev) => ({
      ...prev,
      [item.stage_key]: (prev[item.stage_key] || []).map((row) =>
        row.id === item.id ? { ...row, status: next, updated_at: updatedAt } : row
      ),
    }));

    const { error: updateError } = await supabase
      .from("site_build_checklist_items")
      .update({ status: next, updated_at: updatedAt })
      .eq("id", item.id)
      .eq("company_id", companyId);

    if (updateError) {
      console.error(updateError);
      setItemsByStage((prev) => ({
        ...prev,
        [item.stage_key]: (prev[item.stage_key] || []).map((row) =>
          row.id === item.id ? { ...row, status: previous } : row
        ),
      }));
      setError(updateError.message || "Failed to update checklist item");
    }
  };

  const saveItemDetails = async (itemId, { note, proof_url }) => {
    if (!companyId) return;
    const updatedAt = new Date().toISOString();
    let previous = null;

    setItemsByStage((prev) => {
      const next = { ...prev };
      for (const stageKey of Object.keys(next)) {
        next[stageKey] = (next[stageKey] || []).map((row) => {
          if (row.id !== itemId) return row;
          previous = row;
          return { ...row, note, proof_url, updated_at: updatedAt };
        });
      }
      return next;
    });

    const { error: updateError } = await supabase
      .from("site_build_checklist_items")
      .update({ note, proof_url, updated_at: updatedAt })
      .eq("id", itemId)
      .eq("company_id", companyId);

    if (updateError) {
      console.error(updateError);
      if (previous) {
        setItemsByStage((prev) => ({
          ...prev,
          [previous.stage_key]: (prev[previous.stage_key] || []).map((row) =>
            row.id === itemId ? previous : row
          ),
        }));
      }
      setError(updateError.message || "Failed to save note/proof");
    }
  };

  const handleAddItem = async (event) => {
    event.preventDefault();
    if (!companyId || adding) return;

    const label = newItemLabel.trim();
    if (!label) return;

    setAdding(true);
    setError("");

    const stageItems = itemsByStage[selectedStageKey] || [];
    const maxSort = stageItems.reduce(
      (max, row) => Math.max(max, row.sort_order ?? 0),
      -1
    );

    const { data, error: insertError } = await supabase
      .from("site_build_checklist_items")
      .insert({
        company_id: companyId,
        stage_key: selectedStageKey,
        item_key: null,
        label,
        status: "pending",
        note: null,
        proof_url: null,
        is_custom: true,
        sort_order: maxSort + 1,
      })
      .select(
        "id, company_id, stage_key, item_key, label, status, note, proof_url, is_custom, sort_order, created_at, updated_at"
      )
      .single();

    if (insertError) {
      console.error(insertError);
      setError(insertError.message || "Failed to add item");
      setAdding(false);
      return;
    }

    setItemsByStage((prev) => ({
      ...prev,
      [selectedStageKey]: [...(prev[selectedStageKey] || []), data],
    }));
    setNewItemLabel("");
    setAdding(false);
  };

  const handleDeleteItem = async () => {
    const item = confirmDeleteItem;
    if (!item || !companyId) return;

    setError("");
    const { error: deleteError } = await supabase
      .from("site_build_checklist_items")
      .delete()
      .eq("id", item.id)
      .eq("company_id", companyId)
      .eq("is_custom", true);

    if (deleteError) {
      console.error(deleteError);
      setError(deleteError.message || "Failed to delete item");
      setConfirmDeleteItem(null);
      return;
    }

    setItemsByStage((prev) => ({
      ...prev,
      [item.stage_key]: (prev[item.stage_key] || []).filter((row) => row.id !== item.id),
    }));
    if (expandedItemId === item.id) setExpandedItemId(null);
    setConfirmDeleteItem(null);
  };

  const handleReset = async () => {
    if (!companyId || resetting) return;

    setResetting(true);
    setError("");
    const updatedAt = new Date().toISOString();

    const stagePayload = STAGES.map((stage) => ({
      company_id: companyId,
      stage_key: stage.id,
      status: "pending",
      updated_at: updatedAt,
    }));

    const [stagesUpdate, itemsUpdate] = await Promise.all([
      supabase
        .from("site_build_stages")
        .upsert(stagePayload, { onConflict: "company_id,stage_key" }),
      supabase
        .from("site_build_checklist_items")
        .update({
          status: "pending",
          note: null,
          proof_url: null,
          updated_at: updatedAt,
        })
        .eq("company_id", companyId),
    ]);

    if (stagesUpdate.error || itemsUpdate.error) {
      console.error(stagesUpdate.error || itemsUpdate.error);
      setError(
        stagesUpdate.error?.message ||
          itemsUpdate.error?.message ||
          "Failed to reset flow"
      );
      setResetting(false);
      return;
    }

    setStageStatuses(defaultStageStatuses());
    setItemsByStage((prev) => {
      const next = {};
      for (const stageKey of Object.keys(prev)) {
        next[stageKey] = (prev[stageKey] || []).map((row) => ({
          ...row,
          status: "pending",
          note: null,
          proof_url: null,
          updated_at: updatedAt,
        }));
      }
      return next;
    });
    setExpandedItemId(null);
    setSelectedStageKey(STAGES[0].id);
    setConfirmResetOpen(false);
    setResetting(false);
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-xs text-foreground mb-1">Site Build Flow</h1>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xs text-foreground mb-1">Site Build Flow</h1>
          <p className="text-sm text-muted-foreground">
            Template → live — {doneStageCount} of {STAGES.length} stages done
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => setConfirmResetOpen(true)}
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Reset This Flow
        </Button>
      </div>

      {error && (
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      <WorkflowStepper
        steps={STAGES}
        statuses={stageStatuses}
        onCycleStatus={cycleStageStatus}
        selectedId={selectedStageKey}
        stepWidthClassName="w-44"
        renderStepAction={(step, { selected }) => (
          <button
            type="button"
            title="View checklist"
            aria-label={`View checklist for ${step.name}`}
            aria-pressed={selected}
            onClick={(event) => selectStageChecklist(step.id, event)}
            className={`mt-0.5 inline-flex items-center gap-1 rounded px-1.5 py-1 text-[10px] font-medium text-muted-foreground hover:bg-background hover:text-foreground ${
              selected ? "bg-background text-foreground" : ""
            }`}
          >
            <ListChecks className="h-3.5 w-3.5" />
            Checklist
          </button>
        )}
      />

      <div className="space-y-4 rounded-lg border border-border bg-muted/20 p-4">
        <div>
          <h2 className="text-sm font-medium text-foreground">
            Stage {selectedStageIndex} Checklist — {selectedStage.name}
          </h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            ({selectedDoneCount} of {selectedItems.length} checked) ·{" "}
            {selectedStage.location}
          </p>
        </div>

        <div className="space-y-2">
          {selectedItems.length === 0 ? (
            <p className="text-sm text-muted-foreground py-2">No checklist items yet.</p>
          ) : (
            selectedItems.map((item) => (
              <ChecklistItemRow
                key={item.id}
                item={item}
                expanded={expandedItemId === item.id}
                onToggleExpand={(id) =>
                  setExpandedItemId((current) => (current === id ? null : id))
                }
                onToggleStatus={toggleItemStatus}
                onSaveDetails={saveItemDetails}
                onDelete={(row) => setConfirmDeleteItem(row)}
              />
            ))
          )}
        </div>

        <form onSubmit={handleAddItem} className="flex items-center gap-2 pt-1">
          <Input
            value={newItemLabel}
            onChange={(e) => setNewItemLabel(e.target.value)}
            placeholder="Add a custom checklist item…"
            className="text-sm"
          />
          <Button type="submit" size="sm" disabled={adding || !newItemLabel.trim()}>
            <Plus className="w-3.5 h-3.5" />
            Add item
          </Button>
        </form>
      </div>

      <AlertDialog open={confirmResetOpen} onOpenChange={setConfirmResetOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset this Site Build Flow?</AlertDialogTitle>
            <AlertDialogDescription>
              This sets all 7 stages back to Pending and clears every checklist
              item to pending with empty notes and proof URLs for this company.
              Custom items are kept but reset. Use this when starting a genuinely
              new site build.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={resetting}
              onClick={(event) => {
                event.preventDefault();
                handleReset();
              }}
            >
              {resetting ? "Resetting…" : "Reset This Flow"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={Boolean(confirmDeleteItem)}
        onOpenChange={(open) => {
          if (!open) setConfirmDeleteItem(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete custom checklist item?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes “{confirmDeleteItem?.label}” permanently. Predefined
              items cannot be deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(event) => {
                event.preventDefault();
                handleDeleteItem();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
