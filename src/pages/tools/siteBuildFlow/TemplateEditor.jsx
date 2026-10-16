import React, { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { newTemplateKey, saveTemplate } from "./template";

function move(list, index, delta) {
  const target = index + delta;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

function MoveButtons({ index, count, onMove, label }) {
  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onMove(-1)}
        disabled={index === 0}
        aria-label={`Move ${label} up`}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="h-8 w-8"
        onClick={() => onMove(1)}
        disabled={index === count - 1}
        aria-label={`Move ${label} down`}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </Button>
    </>
  );
}

/**
 * Edits the checklist template shared by every company: phases and their
 * items (title, description), add / delete / reorder. Existing items keep
 * their prompts and links untouched.
 */
export default function TemplateEditor({ template, onCancel, onSaved }) {
  const [draft, setDraft] = useState(() => structuredClone(template));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const takenKeys = useMemo(() => {
    const keys = new Set();
    for (const stage of draft) {
      keys.add(stage.stage_key);
      for (const item of stage.items) keys.add(item.item_key);
    }
    return keys;
  }, [draft]);

  const updateStage = (stageIndex, patch) =>
    setDraft((prev) => prev.map((stage, i) => (i === stageIndex ? { ...stage, ...patch } : stage)));

  const updateItem = (stageIndex, itemIndex, patch) =>
    setDraft((prev) =>
      prev.map((stage, i) =>
        i === stageIndex
          ? { ...stage, items: stage.items.map((item, j) => (j === itemIndex ? { ...item, ...patch } : item)) }
          : stage
      )
    );

  const addStage = () =>
    setDraft((prev) => [...prev, { stage_key: newTemplateKey("phase", takenKeys), name: "", items: [] }]);

  const deleteStage = (stageIndex) => {
    const stage = draft[stageIndex];
    const label = stage.name.trim() || "this phase";
    if (!window.confirm(`Delete "${label}" and its ${stage.items.length} item(s) for every company?`)) return;
    setDraft((prev) => prev.filter((_, i) => i !== stageIndex));
  };

  const addItem = (stageIndex) =>
    updateStage(stageIndex, {
      items: [
        ...draft[stageIndex].items,
        {
          item_key: newTemplateKey("item", takenKeys),
          title: "",
          description: "",
          prompts: [],
          link_to: null,
          link_label: null,
        },
      ],
    });

  const deleteItem = (stageIndex, itemIndex) => {
    const label = draft[stageIndex].items[itemIndex].title.trim() || "this item";
    if (!window.confirm(`Delete "${label}" for every company?`)) return;
    updateStage(stageIndex, { items: draft[stageIndex].items.filter((_, j) => j !== itemIndex) });
  };

  const handleSave = async () => {
    if (draft.length === 0) {
      setError("Keep at least one phase.");
      return;
    }
    if (draft.some((stage) => !stage.name.trim())) {
      setError("Every phase needs a name.");
      return;
    }
    if (draft.some((stage) => stage.items.some((item) => !item.title.trim()))) {
      setError("Every item needs a title.");
      return;
    }
    setSaving(true);
    setError("");
    try {
      await saveTemplate(draft);
      onSaved();
    } catch (err) {
      setError(err?.message || "Failed to save the checklist");
      setSaving(false);
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-3rem)] flex-col">
      <div className="sticky top-0 z-20 border-b border-border bg-background/95 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xs text-foreground mb-0.5">Edit checklist</h1>
            <p className="text-xs text-muted-foreground">
              Changes apply to every company. Status and notes stay on items that are kept.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button type="button" variant="outline" size="sm" onClick={onCancel} disabled={saving}>
              Cancel
            </Button>
            <Button type="button" size="sm" onClick={handleSave} disabled={saving}>
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
          <p role="alert" className="mt-2 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>

      <div className="space-y-4 pt-4">
        {draft.map((stage, stageIndex) => (
          <section
            key={stage.stage_key}
            className="space-y-3 rounded-[14px] border border-border bg-card p-4"
            aria-label={stage.name || "New phase"}
          >
            <div className="flex flex-wrap items-end gap-2">
              <div className="min-w-[200px] flex-1 space-y-1.5">
                <Label htmlFor={`phase-${stage.stage_key}`} className="text-xs">
                  Phase {stageIndex + 1}
                </Label>
                <Input
                  id={`phase-${stage.stage_key}`}
                  value={stage.name}
                  onChange={(event) => updateStage(stageIndex, { name: event.target.value })}
                  placeholder="Phase name"
                />
              </div>
              <div className="flex items-center">
                <MoveButtons
                  index={stageIndex}
                  count={draft.length}
                  label={stage.name || "phase"}
                  onMove={(delta) => setDraft((prev) => move(prev, stageIndex, delta))}
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-destructive"
                  onClick={() => deleteStage(stageIndex)}
                  aria-label={`Delete phase ${stage.name || ""}`.trim()}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              {stage.items.length === 0 && (
                <p className="text-xs text-muted-foreground">No items in this phase yet.</p>
              )}
              {stage.items.map((item, itemIndex) => (
                <div key={item.item_key} className="space-y-2 rounded-md border border-border bg-background p-3">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[200px] flex-1 space-y-1.5">
                      <Label htmlFor={`title-${item.item_key}`} className="text-xs">
                        Item {itemIndex + 1} title
                      </Label>
                      <Input
                        id={`title-${item.item_key}`}
                        value={item.title}
                        onChange={(event) => updateItem(stageIndex, itemIndex, { title: event.target.value })}
                        placeholder="Item title"
                      />
                    </div>
                    <div className="flex items-center">
                      <MoveButtons
                        index={itemIndex}
                        count={stage.items.length}
                        label={item.title || "item"}
                        onMove={(delta) => updateStage(stageIndex, { items: move(stage.items, itemIndex, delta) })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive"
                        onClick={() => deleteItem(stageIndex, itemIndex)}
                        aria-label={`Delete item ${item.title || ""}`.trim()}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor={`description-${item.item_key}`} className="text-xs">
                      Description
                    </Label>
                    <Textarea
                      id={`description-${item.item_key}`}
                      value={item.description}
                      onChange={(event) => updateItem(stageIndex, itemIndex, { description: event.target.value })}
                      placeholder="What to do (Markdown supported)"
                      rows={3}
                    />
                  </div>
                  {(item.prompts?.length > 0 || item.link_to) && (
                    <p className="text-[11px] text-muted-foreground">
                      Keeps its {item.prompts?.length ? `${item.prompts.length} copy prompt(s)` : ""}
                      {item.prompts?.length && item.link_to ? " and " : ""}
                      {item.link_to ? "link" : ""}.
                    </p>
                  )}
                </div>
              ))}
            </div>

            <Button type="button" variant="outline" size="sm" onClick={() => addItem(stageIndex)}>
              <Plus className="h-3.5 w-3.5" />
              Add item
            </Button>
          </section>
        ))}

        <Button type="button" variant="outline" onClick={addStage}>
          <Plus className="h-4 w-4" />
          Add phase
        </Button>
      </div>
    </div>
  );
}
