import React from "react";
import { Check, ChevronDown, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  BASIC_FIELDS,
  INTELLIGENCE_GROUPS,
  basicProgress,
  groupProgress,
  intelligenceFieldFilled,
} from "./intelligenceFields";

function ProgressMark({ filled, total }) {
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {filled}/{total}
    </span>
  );
}

function FieldLabel({ field, filled }) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{field.label}</h3>
          {filled ? (
            <Check
              className="h-3.5 w-3.5 shrink-0 text-emerald-600"
              strokeWidth={2.5}
              aria-label="Has content"
            />
          ) : null}
        </div>
        {field.helper ? (
          <p className="mt-0.5 text-xs text-muted-foreground">{field.helper}</p>
        ) : null}
      </div>
    </div>
  );
}

function PreviewLines({ lines, empty }) {
  if (!lines.length) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="space-y-1 text-sm text-foreground">
      {lines.map((line, index) => (
        <li key={index} className="leading-snug">
          {line}
        </li>
      ))}
    </ul>
  );
}

export default function IntelligenceBrief({
  companyName,
  onCompanyNameChange,
  fields,
  onFieldChange,
  socialLinks,
  onSocialChange,
  onAddSocial,
  onRemoveSocial,
  servicesPreview = [],
  competitorsPreview = [],
  teamPreview = [],
  onOpenStructured,
  openGroups,
  onToggleGroup,
  configOpen,
  onToggleConfig,
  configTriggers = [],
}) {
  const ctx = { fields, companyName };
  const basic = basicProgress(ctx);

  return (
    <div className="space-y-1.5">
      <section className="rounded-lg border border-border bg-background">
        <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
          <h2 className="text-sm font-medium text-foreground">Identity</h2>
          <ProgressMark filled={basic.filled} total={basic.total} />
        </div>
        <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
          {BASIC_FIELDS.map((field) => {
            const filled = intelligenceFieldFilled(field, ctx);
            if (field.kind === "social") {
              return (
                <div key={field.id} className="sm:col-span-2">
                  <FieldLabel field={field} filled={filled} />
                  <div className="space-y-2">
                    {(socialLinks || []).map((link, index) => (
                      <div key={index} className="flex items-start gap-2">
                        <Input
                          value={link.label}
                          onChange={(e) =>
                            onSocialChange(index, "label", e.target.value)
                          }
                          placeholder="Label"
                          aria-label={`Social link ${index + 1} label`}
                        />
                        <Input
                          value={link.url}
                          onChange={(e) =>
                            onSocialChange(index, "url", e.target.value)
                          }
                          placeholder="https://"
                          aria-label={`Social link ${index + 1} URL`}
                        />
                        <button
                          type="button"
                          onClick={() => onRemoveSocial(index)}
                          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-destructive"
                          aria-label="Remove social link"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                    <Button type="button" variant="outline" size="sm" onClick={onAddSocial}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Add link
                    </Button>
                  </div>
                </div>
              );
            }

            const value =
              field.kind === "name" ? companyName : fields[field.key] || "";
            const onChange =
              field.kind === "name"
                ? onCompanyNameChange
                : (value) => onFieldChange(field.key, value);

            return (
              <div
                key={field.id}
                className={field.kind === "textarea" ? "sm:col-span-2" : ""}
              >
                <FieldLabel field={field} filled={filled} />
                {field.kind === "textarea" ? (
                  <Textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    rows={field.rows || 3}
                    className="min-h-[72px]"
                  />
                ) : (
                  <Input
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                  />
                )}
              </div>
            );
          })}
        </div>
      </section>

      {INTELLIGENCE_GROUPS.map((group) => {
        const progress = groupProgress(group, ctx);
        const open = openGroups[group.id] === true;
        return (
          <Collapsible
            key={group.id}
            open={open}
            onOpenChange={(next) => onToggleGroup(group.id, next)}
            className="rounded-lg border border-border"
          >
            <div
              className={`flex items-center justify-between gap-3 px-4 py-2.5 ${
                open ? "border-b border-border" : ""
              }`}
            >
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                >
                  <span className="text-[11px] tabular-nums text-muted-foreground">
                    {group.number}
                  </span>
                  <h2 className="text-sm font-medium text-foreground">{group.title}</h2>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      open ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <ProgressMark filled={progress.filled} total={progress.total} />
            </div>
            <CollapsibleContent>
              <div className="space-y-6 px-4 py-5">
                {group.fields.map((field) => {
                  const filled = intelligenceFieldFilled(field, ctx);
                  if (field.kind === "services") {
                    return (
                      <div key={field.id}>
                        <FieldLabel field={field} filled={filled} />
                        <PreviewLines
                          lines={servicesPreview}
                          empty="No offerings recorded yet."
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => onOpenStructured("services")}
                        >
                          Edit offerings
                        </Button>
                      </div>
                    );
                  }
                  if (field.kind === "competitors") {
                    return (
                      <div key={field.id}>
                        <FieldLabel field={field} filled={filled} />
                        <PreviewLines
                          lines={competitorsPreview}
                          empty="No competitors or alternatives recorded yet."
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => onOpenStructured("competitors")}
                        >
                          Edit competitors
                        </Button>
                      </div>
                    );
                  }
                  if (field.kind === "team") {
                    return (
                      <div key={field.id}>
                        <FieldLabel field={field} filled={filled} />
                        <PreviewLines
                          lines={teamPreview}
                          empty="No team or founder notes recorded yet."
                        />
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="mt-3"
                          onClick={() => onOpenStructured("team")}
                        >
                          Edit team
                        </Button>
                      </div>
                    );
                  }
                  return (
                    <div key={field.id}>
                      <FieldLabel field={field} filled={filled} />
                      <Textarea
                        value={fields[field.key] || ""}
                        onChange={(e) => onFieldChange(field.key, e.target.value)}
                        rows={field.rows || 4}
                        className="min-h-[96px]"
                      />
                    </div>
                  );
                })}
              </div>
            </CollapsibleContent>
          </Collapsible>
        );
      })}

      <Collapsible
        open={configOpen}
        onOpenChange={onToggleConfig}
        className="rounded-lg border border-dashed border-border"
      >
        <div className="flex items-center justify-between gap-3 px-4 py-3">
          <CollapsibleTrigger asChild>
            <button type="button" className="flex min-w-0 flex-1 items-center gap-3 text-left">
              <div>
                <p className="text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                  Operations
                </p>
                <h2 className="text-sm font-medium text-foreground">
                  SEO, publishing & leftover data
                </h2>
              </div>
              <ChevronDown
                className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                  configOpen ? "rotate-180" : ""
                }`}
              />
            </button>
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent>
          <div className="border-t border-border px-4 py-4">
            <p className="mb-3 text-xs text-muted-foreground">
              Specialized fields stay available here so SEO, publishing, and
              existing leftover copy are not lost. They are not part of the
              core brief.
            </p>
            <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
              {configTriggers.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={item.onClick}
                  className="flex h-9 w-full items-center justify-between gap-3 rounded-md border border-border px-3 text-left transition-colors hover:bg-muted/50"
                >
                  <span className="text-sm font-medium leading-none">{item.title}</span>
                  {item.filled ? (
                    <Check
                      className="h-3.5 w-3.5 shrink-0 text-emerald-600"
                      strokeWidth={2.5}
                      aria-label="Has content"
                    />
                  ) : null}
                </button>
              ))}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}
