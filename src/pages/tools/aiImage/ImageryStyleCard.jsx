import React, { useState } from "react";
import { Loader2, Pencil } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  IMAGERY_COLOR_KEYS,
  IMAGERY_COLOR_LABELS,
  invalidImageryColors,
  readImageryStyle,
  writeImageryStyle,
} from "@/lib/design/imageryStyle";
import { normalizeHex } from "@/lib/design/hex";

/**
 * The company's imagery style (direction, treatment, avoid, palette) used by
 * every image generator. Shows a summary; edits save to company_profiles.design_guide_raw.
 * @param {{ companyId: string, guideRaw: string, onSaved: (guideRaw: string) => void }} props
 */
export default function ImageryStyleCard({ companyId, guideRaw, onSaved }) {
  const current = readImageryStyle(guideRaw);
  const isSet = Boolean(current.direction.trim() || current.treatment.trim() || current.avoid.trim());
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const startEdit = () => {
    setDraft(readImageryStyle(guideRaw));
    setError("");
    setEditing(true);
  };

  const setField = (key, value) => setDraft((d) => ({ ...d, [key]: value }));
  const setColor = (key, value) => setDraft((d) => ({ ...d, colors: { ...d.colors, [key]: value } }));
  const badColors = invalidImageryColors(draft);

  const save = async () => {
    if (badColors.length) {
      setError(`Use hex colours like #1A1A1A (${badColors.map((k) => IMAGERY_COLOR_LABELS[k]).join(", ")}).`);
      return;
    }
    setSaving(true);
    setError("");
    const next = writeImageryStyle(guideRaw, draft);
    const { error: saveError } = await supabase
      .from("company_profiles")
      .upsert(
        { company_id: companyId, design_guide_raw: next, updated_at: new Date().toISOString() },
        { onConflict: "company_id" }
      );
    setSaving(false);
    if (saveError) {
      setError(saveError.message || "Failed to save");
      return;
    }
    setEditing(false);
    onSaved(next);
  };

  if (!editing) {
    return (
      <div className={`flex items-start justify-between gap-3 rounded-lg border p-4 ${isSet ? "border-border" : "border-dashed border-border"}`}>
        <div className="min-w-0 space-y-1">
          <p className="text-xs font-medium text-muted-foreground">Imagery style</p>
          {isSet ? (
            <>
              <p className="text-sm text-foreground">
                {[current.treatment, current.direction].filter((v) => v.trim()).join(" — ")}
              </p>
              {current.avoid.trim() ? <p className="text-xs text-muted-foreground">Avoid: {current.avoid}</p> : null}
              <div className="flex gap-1.5 pt-1" aria-label="Palette">
                {IMAGERY_COLOR_KEYS.map((key) =>
                  normalizeHex(current.colors[key]) ? (
                    <span
                      key={key}
                      title={`${IMAGERY_COLOR_LABELS[key]} ${current.colors[key]}`}
                      className="h-4 w-4 rounded border border-border"
                      style={{ backgroundColor: normalizeHex(current.colors[key]) }}
                    />
                  ) : null
                )}
              </div>
            </>
          ) : (
            <p className="text-sm text-foreground">Not set — generated images won't follow a brand style.</p>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" onClick={startEdit} className="shrink-0">
          <Pencil className="h-3.5 w-3.5" aria-hidden="true" />
          {isSet ? "Edit" : "Set style"}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-4">
      <p className="text-xs font-medium text-muted-foreground">Imagery style</p>
      <div className="space-y-1.5">
        <Label htmlFor="imagery-treatment">Treatment</Label>
        <Input
          id="imagery-treatment"
          value={draft.treatment}
          onChange={(e) => setField("treatment", e.target.value)}
          placeholder="e.g. Clean editorial photography, soft natural light"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="imagery-direction">Direction</Label>
        <Textarea
          id="imagery-direction"
          rows={3}
          value={draft.direction}
          onChange={(e) => setField("direction", e.target.value)}
          placeholder="Subjects, composition and mood"
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="imagery-avoid">Avoid</Label>
        <Textarea
          id="imagery-avoid"
          rows={2}
          value={draft.avoid}
          onChange={(e) => setField("avoid", e.target.value)}
          placeholder="e.g. Stock-photo handshakes, text in images"
        />
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {IMAGERY_COLOR_KEYS.map((key) => {
          const hex = normalizeHex(draft.colors[key]);
          return (
            <div key={key} className="space-y-1.5">
              <Label htmlFor={`imagery-color-${key}`}>{IMAGERY_COLOR_LABELS[key]}</Label>
              <div className="flex items-center gap-1.5">
                <input
                  type="color"
                  aria-label={`${IMAGERY_COLOR_LABELS[key]} colour picker`}
                  value={hex || "#000000"}
                  onChange={(e) => setColor(key, e.target.value.toUpperCase())}
                  className="h-9 w-9 shrink-0 cursor-pointer rounded border border-border bg-transparent p-0.5"
                />
                <Input
                  id={`imagery-color-${key}`}
                  value={draft.colors[key]}
                  onChange={(e) => setColor(key, e.target.value)}
                  placeholder="#000000"
                  aria-invalid={badColors.includes(key)}
                />
              </div>
            </div>
          );
        })}
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
      <div className="flex gap-2">
        <Button type="button" size="sm" onClick={save} disabled={saving}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
          Save
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
