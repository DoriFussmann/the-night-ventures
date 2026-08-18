import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ChevronDown, Copy, Download, Loader2 } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  STAGES,
  PREDEFINED_ITEMS,
  STATUS_META,
  nextStatus,
  resolveItemLink,
} from "./siteBuildFlow/seedData";
import {
  SITE_BUILD_FLOW_MARKDOWN_FILENAME,
  buildSiteBuildFlowMarkdown,
  downloadMarkdown,
} from "./siteBuildFlow/buildFlowMarkdown";

const STAGE_SELECT =
  "company_id, stage_key, order_index, status, updated_at";
const ITEM_SELECT =
  "id, company_id, stage_key, item_key, title, description, prompts, status, note, sort_order, created_at, updated_at";

function cloneState(state) {
  return structuredClone(state);
}

function normalizeForCompare(state) {
  if (!state) return null;
  const stages = [...(state.stages || [])]
    .map((s) => ({
      stage_key: s.stage_key,
      order_index: s.order_index,
      status: s.status || "open",
    }))
    .sort((a, b) => a.order_index - b.order_index || a.stage_key.localeCompare(b.stage_key));
  const items = [...(state.items || [])]
    .map((i) => ({
      stage_key: i.stage_key,
      item_key: i.item_key,
      title: i.title,
      description: i.description || "",
      prompts: i.prompts || [],
      status: i.status || "open",
      note: i.note ?? null,
      sort_order: i.sort_order,
    }))
    .sort(
      (a, b) =>
        a.stage_key.localeCompare(b.stage_key) ||
        a.sort_order - b.sort_order ||
        a.item_key.localeCompare(b.item_key)
    );
  return JSON.stringify({ stages, items });
}

function applyStageDoneIfAllItemsDone(stages, items, stageKey) {
  const stageItems = items.filter((item) => item.stage_key === stageKey);
  if (
    stageItems.length === 0 ||
    !stageItems.every((item) => (item.status || "open") === "done")
  ) {
    return stages;
  }
  return stages.map((stage) =>
    stage.stage_key === stageKey && (stage.status || "open") !== "done"
      ? { ...stage, status: "done" }
      : stage
  );
}

function syncAllStagesDoneFromItems(stages, items) {
  let next = stages;
  for (const stage of stages) {
    next = applyStageDoneIfAllItemsDone(next, items, stage.stage_key);
  }
  return next;
}

function StatusBadge({ status, onCycle }) {
  const meta = STATUS_META[status] || STATUS_META.open;
  return (
    <button
      type="button"
      onClick={(event) => {
        event.stopPropagation();
        onCycle();
      }}
      className={cn(
        "inline-flex shrink-0 items-center rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors hover:opacity-90",
        meta.className
      )}
      title="Click to cycle status"
    >
      {meta.label}
    </button>
  );
}

function PromptBlock({ label, text }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Copy failed:", err);
    }
  };

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-foreground">{label}</p>
        <Button type="button" variant="outline" size="sm" onClick={handleCopy}>
          <Copy className="h-3.5 w-3.5" />
          {copied ? "Copied" : "Copy"}
        </Button>
      </div>
      <pre className="max-h-48 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-xs whitespace-pre-wrap break-words text-foreground/90">
        {text}
      </pre>
    </div>
  );
}

export default function SiteBuildFlow() {
  const { companyId } = useParams();
  const [savedState, setSavedState] = useState(null);
  const [draftState, setDraftState] = useState(null);
  const [activeStageKey, setActiveStageKey] = useState(STAGES[0].stage_key);
  const [expandedItemKey, setExpandedItemKey] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const loadAndSeed = useCallback(async () => {
    if (!companyId) return;

    setLoading(true);
    setError("");

    const [stagesResult, itemsResult] = await Promise.all([
      supabase
        .from("setup_flow_stages")
        .select(STAGE_SELECT)
        .eq("company_id", companyId)
        .order("order_index", { ascending: true }),
      supabase
        .from("setup_flow_items")
        .select(ITEM_SELECT)
        .eq("company_id", companyId)
        .order("sort_order", { ascending: true }),
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

    let stages = stagesResult.data || [];
    let items = itemsResult.data || [];

    if (stages.length === 0 && items.length === 0) {
      const stageRows = STAGES.map((stage) => ({
        company_id: companyId,
        stage_key: stage.stage_key,
        order_index: stage.order_index,
        status: "open",
      }));

      const itemRows = [];
      for (const stage of STAGES) {
        const predefined = PREDEFINED_ITEMS[stage.stage_key] || [];
        predefined.forEach((entry, index) => {
          itemRows.push({
            company_id: companyId,
            stage_key: stage.stage_key,
            item_key: entry.item_key,
            title: entry.title,
            description: entry.description,
            prompts: entry.prompts || [],
            status: "open",
            note: null,
            sort_order: index,
          });
        });
      }

      const { data: insertedStages, error: stageInsertError } = await supabase
        .from("setup_flow_stages")
        .insert(stageRows)
        .select(STAGE_SELECT);

      if (stageInsertError) {
        console.error(stageInsertError);
        setError(stageInsertError.message || "Failed to seed stages");
        setLoading(false);
        return;
      }

      const { data: insertedItems, error: itemInsertError } = await supabase
        .from("setup_flow_items")
        .insert(itemRows)
        .select(ITEM_SELECT);

      if (itemInsertError) {
        console.error(itemInsertError);
        setError(itemInsertError.message || "Failed to seed items");
        setLoading(false);
        return;
      }

      stages = insertedStages || [];
      items = insertedItems || [];
    } else {
      // Insert any stages/items added after the initial seed, and realign order.
      const existingStageKeys = new Set(stages.map((s) => s.stage_key));
      const missingStageRows = STAGES.filter(
        (stage) => !existingStageKeys.has(stage.stage_key)
      ).map((stage) => ({
        company_id: companyId,
        stage_key: stage.stage_key,
        order_index: stage.order_index,
        status: "open",
      }));

      if (missingStageRows.length > 0) {
        const { data: insertedStages, error: missingStageError } = await supabase
          .from("setup_flow_stages")
          .insert(missingStageRows)
          .select(STAGE_SELECT);

        if (missingStageError) {
          console.error(missingStageError);
          setError(missingStageError.message || "Failed to sync new stages");
          setLoading(false);
          return;
        }

        stages = [...stages, ...(insertedStages || [])];
      }

      const orderByKey = new Map(STAGES.map((s) => [s.stage_key, s.order_index]));
      const stageOrderUpdates = stages.filter(
        (stage) =>
          orderByKey.has(stage.stage_key) &&
          stage.order_index !== orderByKey.get(stage.stage_key)
      );
      if (stageOrderUpdates.length > 0) {
        const now = new Date().toISOString();
        const orderResults = await Promise.all(
          stageOrderUpdates.map((stage) =>
            supabase
              .from("setup_flow_stages")
              .update({
                order_index: orderByKey.get(stage.stage_key),
                updated_at: now,
              })
              .eq("company_id", companyId)
              .eq("stage_key", stage.stage_key)
          )
        );
        const orderError = orderResults.find((r) => r.error)?.error;
        if (orderError) {
          console.error(orderError);
          setError(orderError.message || "Failed to update stage order");
          setLoading(false);
          return;
        }

        stages = stages.map((stage) =>
          orderByKey.has(stage.stage_key)
            ? { ...stage, order_index: orderByKey.get(stage.stage_key) }
            : stage
        );
      }

      const allowedStageKeys = new Set(STAGES.map((stage) => stage.stage_key));
      const allowedKeysByStage = new Map(
        STAGES.map((stage) => [
          stage.stage_key,
          new Set(
            (PREDEFINED_ITEMS[stage.stage_key] || []).map((entry) => entry.item_key)
          ),
        ])
      );
      const staleItems = items.filter((item) => {
        const allowed = allowedKeysByStage.get(item.stage_key);
        if (!allowed) return !allowedStageKeys.has(item.stage_key);
        return !allowed.has(item.item_key);
      });
      if (staleItems.length > 0) {
        const staleIds = staleItems.map((item) => item.id);
        const { error: staleError } = await supabase
          .from("setup_flow_items")
          .delete()
          .in("id", staleIds);

        if (staleError) {
          console.error(staleError);
          setError(staleError.message || "Failed to remove retired checklist items");
          setLoading(false);
          return;
        }

        items = items.filter((item) => !staleIds.includes(item.id));
      }

      const staleStages = stages.filter(
        (stage) => !allowedStageKeys.has(stage.stage_key)
      );
      if (staleStages.length > 0) {
        const staleStageKeys = staleStages.map((stage) => stage.stage_key);
        const { error: staleStageError } = await supabase
          .from("setup_flow_stages")
          .delete()
          .eq("company_id", companyId)
          .in("stage_key", staleStageKeys);

        if (staleStageError) {
          console.error(staleStageError);
          setError(staleStageError.message || "Failed to remove retired stages");
          setLoading(false);
          return;
        }

        stages = stages.filter((stage) => allowedStageKeys.has(stage.stage_key));
      }

      const missingRows = [];
      const sortUpdates = [];
      const promptUpdates = [];
      const metaUpdates = [];

      for (const stage of STAGES) {
        const predefined = PREDEFINED_ITEMS[stage.stage_key] || [];
        const byKey = new Map(
          items
            .filter((i) => i.stage_key === stage.stage_key)
            .map((i) => [i.item_key, i])
        );

        predefined.forEach((entry, index) => {
          const existing = byKey.get(entry.item_key);
          if (!existing) {
            missingRows.push({
              company_id: companyId,
              stage_key: stage.stage_key,
              item_key: entry.item_key,
              title: entry.title,
              description: entry.description,
              prompts: entry.prompts || [],
              status: "open",
              note: null,
              sort_order: index,
            });
          } else {
            if (existing.sort_order !== index) {
              sortUpdates.push({ id: existing.id, sort_order: index });
            }
            if (
              existing.title !== entry.title ||
              (existing.description || "") !== (entry.description || "")
            ) {
              metaUpdates.push({
                id: existing.id,
                title: entry.title,
                description: entry.description || "",
              });
            }
            const seedPrompts = entry.prompts || [];
            const existingPrompts = existing.prompts || [];
            if (seedPrompts.length > 0 && existingPrompts.length === 0) {
              promptUpdates.push({ id: existing.id, prompts: seedPrompts });
            }
          }
        });
      }

      if (missingRows.length > 0) {
        const { data: insertedMissing, error: missingError } = await supabase
          .from("setup_flow_items")
          .insert(missingRows)
          .select(ITEM_SELECT);

        if (missingError) {
          console.error(missingError);
          setError(missingError.message || "Failed to sync new checklist items");
          setLoading(false);
          return;
        }

        items = [...items, ...(insertedMissing || [])];
      }

      if (sortUpdates.length > 0) {
        const now = new Date().toISOString();
        const sortResults = await Promise.all(
          sortUpdates.map((u) =>
            supabase
              .from("setup_flow_items")
              .update({ sort_order: u.sort_order, updated_at: now })
              .eq("id", u.id)
          )
        );
        const sortError = sortResults.find((r) => r.error)?.error;
        if (sortError) {
          console.error(sortError);
          setError(sortError.message || "Failed to update item order");
          setLoading(false);
          return;
        }

        const sortById = new Map(sortUpdates.map((u) => [u.id, u.sort_order]));
        items = items.map((item) =>
          sortById.has(item.id)
            ? { ...item, sort_order: sortById.get(item.id) }
            : item
        );
      }

      if (metaUpdates.length > 0) {
        const now = new Date().toISOString();
        const metaResults = await Promise.all(
          metaUpdates.map((u) =>
            supabase
              .from("setup_flow_items")
              .update({
                title: u.title,
                description: u.description,
                updated_at: now,
              })
              .eq("id", u.id)
          )
        );
        const metaError = metaResults.find((r) => r.error)?.error;
        if (metaError) {
          console.error(metaError);
          setError(metaError.message || "Failed to sync checklist item text");
          setLoading(false);
          return;
        }

        const metaById = new Map(metaUpdates.map((u) => [u.id, u]));
        items = items.map((item) =>
          metaById.has(item.id)
            ? {
                ...item,
                title: metaById.get(item.id).title,
                description: metaById.get(item.id).description,
              }
            : item
        );
      }

      if (promptUpdates.length > 0) {
        const now = new Date().toISOString();
        const promptResults = await Promise.all(
          promptUpdates.map((u) =>
            supabase
              .from("setup_flow_items")
              .update({ prompts: u.prompts, updated_at: now })
              .eq("id", u.id)
          )
        );
        const promptError = promptResults.find((r) => r.error)?.error;
        if (promptError) {
          console.error(promptError);
          setError(promptError.message || "Failed to sync checklist prompts");
          setLoading(false);
          return;
        }

        const promptsById = new Map(promptUpdates.map((u) => [u.id, u.prompts]));
        items = items.map((item) =>
          promptsById.has(item.id)
            ? { ...item, prompts: promptsById.get(item.id) }
            : item
        );
      }
    }

    stages = [...stages].sort(
      (a, b) => a.order_index - b.order_index || a.stage_key.localeCompare(b.stage_key)
    );
    items = [...items].sort(
      (a, b) =>
        a.stage_key.localeCompare(b.stage_key) ||
        a.sort_order - b.sort_order ||
        String(a.created_at).localeCompare(String(b.created_at))
    );

    // Promote stages to Done when every item is already Done (covers pre-existing data).
    const syncedStages = syncAllStagesDoneFromItems(stages, items);
    const stagesToPersist = syncedStages.filter((stage) => {
      const prior = stages.find((s) => s.stage_key === stage.stage_key);
      return prior && (prior.status || "open") !== (stage.status || "open");
    });
    if (stagesToPersist.length > 0) {
      const now = new Date().toISOString();
      const persistResults = await Promise.all(
        stagesToPersist.map((stage) =>
          supabase
            .from("setup_flow_stages")
            .update({ status: "done", updated_at: now })
            .eq("company_id", companyId)
            .eq("stage_key", stage.stage_key)
        )
      );
      const persistError = persistResults.find((r) => r.error)?.error;
      if (persistError) {
        console.error(persistError);
        setError(persistError.message || "Failed to sync stage status");
        setLoading(false);
        return;
      }
    }
    stages = syncedStages;

    const next = { stages, items };
    setSavedState(cloneState(next));
    setDraftState(cloneState(next));
    setActiveStageKey(STAGES[0].stage_key);
    setExpandedItemKey(null);
    setLoading(false);
  }, [companyId]);

  useEffect(() => {
    loadAndSeed();
  }, [loadAndSeed]);

  const isDirty = useMemo(
    () =>
      normalizeForCompare(draftState) !== null &&
      normalizeForCompare(draftState) !== normalizeForCompare(savedState),
    [draftState, savedState]
  );

  const activeStage = useMemo(
    () => STAGES.find((s) => s.stage_key === activeStageKey) || STAGES[0],
    [activeStageKey]
  );

  const draftStagesByKey = useMemo(() => {
    const map = {};
    for (const stage of draftState?.stages || []) {
      map[stage.stage_key] = stage;
    }
    return map;
  }, [draftState]);

  const activeItems = useMemo(() => {
    if (!draftState) return [];
    return (draftState.items || [])
      .filter((item) => item.stage_key === activeStageKey)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [draftState, activeStageKey]);

  const cycleStageStatus = (stageKey) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        stages: prev.stages.map((stage) =>
          stage.stage_key === stageKey
            ? { ...stage, status: nextStatus(stage.status || "open") }
            : stage
        ),
      };
    });
  };

  const cycleItemStatus = (stageKey, itemKey) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) =>
        item.stage_key === stageKey && item.item_key === itemKey
          ? { ...item, status: nextStatus(item.status || "open") }
          : item
      );
      return {
        ...prev,
        items,
        stages: applyStageDoneIfAllItemsDone(prev.stages, items, stageKey),
      };
    });
  };

  const markStageAllDone = (stageKey) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((item) =>
        item.stage_key === stageKey ? { ...item, status: "done" } : item
      );
      const stages = prev.stages.map((stage) =>
        stage.stage_key === stageKey ? { ...stage, status: "done" } : stage
      );
      return { ...prev, items, stages };
    });
  };

  const updateItemNote = (stageKey, itemKey, note) => {
    setDraftState((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map((item) =>
          item.stage_key === stageKey && item.item_key === itemKey
            ? { ...item, note }
            : item
        ),
      };
    });
  };

  const handleBackToDefault = () => {
    if (!savedState) return;
    setDraftState(cloneState(savedState));
    setError("");
  };

  const handleDownloadMarkdown = () => {
    if (!draftState) return;
    const markdown = buildSiteBuildFlowMarkdown(STAGES, draftState.items || []);
    downloadMarkdown(SITE_BUILD_FLOW_MARKDOWN_FILENAME, markdown);
  };

  const handleSave = async () => {
    if (!companyId || !draftState) return;

    setSaving(true);
    setError("");

    const now = new Date().toISOString();
    const stageRows = draftState.stages.map((stage) => ({
      company_id: companyId,
      stage_key: stage.stage_key,
      order_index: stage.order_index,
      status: stage.status || "open",
      updated_at: now,
    }));

    const itemRows = draftState.items.map((item) => ({
      company_id: companyId,
      stage_key: item.stage_key,
      item_key: item.item_key,
      title: item.title,
      description: item.description || "",
      prompts: item.prompts || [],
      status: item.status || "open",
      note: item.note ?? null,
      sort_order: item.sort_order,
      updated_at: now,
    }));

    const { error: stageError } = await supabase
      .from("setup_flow_stages")
      .upsert(stageRows, { onConflict: "company_id,stage_key" });

    if (stageError) {
      console.error(stageError);
      setError(stageError.message || "Failed to save stages");
      setSaving(false);
      return;
    }

    const { data: savedItems, error: itemError } = await supabase
      .from("setup_flow_items")
      .upsert(itemRows, { onConflict: "company_id,stage_key,item_key" })
      .select(ITEM_SELECT);

    if (itemError) {
      console.error(itemError);
      setError(itemError.message || "Failed to save items");
      setSaving(false);
      return;
    }

    const next = {
      stages: stageRows,
      items: (savedItems || draftState.items).sort(
        (a, b) =>
          a.stage_key.localeCompare(b.stage_key) ||
          a.sort_order - b.sort_order ||
          a.item_key.localeCompare(b.item_key)
      ),
    };

    setSavedState(cloneState(next));
    setDraftState(cloneState(next));
    setSaving(false);
  };

  if (!companyId) {
    return (
      <div>
        <h1 className="text-xs text-foreground mb-1">Site Build Flow</h1>
        <p className="text-xs text-muted-foreground">Select a company first.</p>
      </div>
    );
  }

  if (loading || !draftState) {
    return (
      <div>
        <h1 className="text-xs text-foreground mb-1">Site Build Flow</h1>
        <div className="mt-4 flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Loading…
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <div className="sticky top-0 z-20 -mx-8 -mt-6 border-b border-border bg-background/95 px-8 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xs text-foreground mb-0.5">Site Build Flow</h1>
            <p className="text-xs text-muted-foreground">
              {activeStage.name} —{" "}
              {activeItems.filter((i) => i.status === "done").length} of{" "}
              {activeItems.length} items done
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isDirty && (
              <span className="text-xs font-medium text-orange-700">
                Unsaved changes
              </span>
            )}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleDownloadMarkdown}
            >
              <Download className="h-3.5 w-3.5" />
              Download .md
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => markStageAllDone(activeStageKey)}
              disabled={
                saving ||
                activeItems.length === 0 ||
                activeItems.every((item) => (item.status || "open") === "done")
              }
            >
              Mark All Done
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={handleBackToDefault}
              disabled={!isDirty || saving}
            >
              Back to Default
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty || saving}
            >
              {saving ? (
                <>
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                "Save"
              )}
            </Button>
          </div>
        </div>
        {error && (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        )}
      </div>

      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 pt-4 lg:grid-cols-[minmax(220px,280px)_1fr]">
        <div className="space-y-2 overflow-y-auto">
          {STAGES.map((stage) => {
            const stageRow = draftStagesByKey[stage.stage_key];
            const status = stageRow?.status || "open";
            const stageItems = (draftState.items || []).filter(
              (item) => item.stage_key === stage.stage_key
            );
            const doneCount = stageItems.filter((i) => i.status === "done").length;
            const selected = activeStageKey === stage.stage_key;

            return (
              <div
                key={stage.stage_key}
                className={cn(
                  "w-full rounded-lg border px-3 py-2.5 text-left transition-colors",
                  selected
                    ? "border-border bg-accent"
                    : "border-border hover:bg-accent/50"
                )}
              >
                <div className="flex items-start justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveStageKey(stage.stage_key);
                      setExpandedItemKey(null);
                    }}
                    className="min-w-0 flex-1 text-left text-sm leading-snug text-foreground"
                  >
                    {stage.name}
                  </button>
                  <StatusBadge
                    status={status}
                    onCycle={() => cycleStageStatus(stage.stage_key)}
                  />
                </div>
                <div className="mt-1.5 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      setActiveStageKey(stage.stage_key);
                      setExpandedItemKey(null);
                    }}
                    className="text-left text-[11px] text-muted-foreground"
                  >
                    ({doneCount} of {stageItems.length} done)
                  </button>
                  {stageItems.length > 0 && doneCount < stageItems.length && (
                    <button
                      type="button"
                      onClick={() => markStageAllDone(stage.stage_key)}
                      className="shrink-0 text-[11px] font-medium text-foreground underline-offset-2 hover:underline"
                    >
                      Mark All Done
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <div className="min-h-0 space-y-2 overflow-y-auto">
          {activeItems.length === 0 ? (
            <p className="text-xs text-muted-foreground">No items in this stage.</p>
          ) : (
            activeItems.map((item) => {
              const expanded = expandedItemKey === item.item_key;
              const noteId = `setup-flow-note-${item.item_key}`;
              const itemLink = resolveItemLink(
                item.stage_key,
                item.item_key,
                companyId
              );

              return (
                <div
                  key={item.item_key}
                  className={cn(
                    "rounded-lg border border-border transition-colors",
                    expanded ? "bg-accent/30" : "hover:bg-accent/40"
                  )}
                >
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() =>
                      setExpandedItemKey(expanded ? null : item.item_key)
                    }
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpandedItemKey(expanded ? null : item.item_key);
                      }
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-3 px-3 py-2 text-left"
                    aria-expanded={expanded}
                  >
                    <div className="flex min-w-0 items-center gap-2">
                      <ChevronDown
                        className={cn(
                          "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform",
                          expanded ? "rotate-0" : "-rotate-90"
                        )}
                      />
                      <span className="truncate text-sm text-foreground">
                        {item.title}
                      </span>
                    </div>
                    <StatusBadge
                      status={item.status || "open"}
                      onCycle={() =>
                        cycleItemStatus(item.stage_key, item.item_key)
                      }
                    />
                  </div>

                  {expanded && (
                    <div className="space-y-4 border-t border-border px-3 py-3">
                      <div className="prose prose-sm max-w-none text-foreground prose-p:my-2">
                        <ReactMarkdown>{item.description || ""}</ReactMarkdown>
                      </div>

                      {itemLink && (
                        <Button asChild variant="outline" size="sm">
                          <Link to={itemLink.to}>{itemLink.label}</Link>
                        </Button>
                      )}

                      {Array.isArray(item.prompts) && item.prompts.length > 0 && (
                        <div className="space-y-3">
                          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Prompts
                          </p>
                          {item.prompts.map((prompt, index) => (
                            <PromptBlock
                              key={`${prompt.label}-${index}`}
                              label={prompt.label}
                              text={prompt.text}
                            />
                          ))}
                        </div>
                      )}

                      <div className="space-y-1.5">
                        <Label htmlFor={noteId} className="text-xs">
                          Notes
                        </Label>
                        <Textarea
                          id={noteId}
                          value={item.note || ""}
                          onChange={(event) =>
                            updateItemNote(
                              item.stage_key,
                              item.item_key,
                              event.target.value
                            )
                          }
                          onClick={(event) => event.stopPropagation()}
                          placeholder="Record what was found or decided…"
                          rows={4}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
