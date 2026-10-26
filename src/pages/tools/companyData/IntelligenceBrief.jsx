import React from "react";
import { Check, ChevronDown, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  ARCHIVED_FIELDS,
  INTELLIGENCE_GROUPS,
  SEO_GROUP_ID,
  VISIBLE_BASIC_FIELDS,
  archivedWithContent,
  basicProgress,
  groupProgress,
  intelligenceFieldFilled,
} from "./intelligenceFields";
import {
  formatSeoAuthority,
  seoControlsStatus,
} from "../../../../lib/seo-advisor/seoControls.js";

function ProgressMark({ filled, total }) {
  return (
    <span className="text-xs tabular-nums text-muted-foreground">
      {filled}/{total}
    </span>
  );
}

function SectionButton({ number, title, filled, total, open, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      className={`flex min-w-0 flex-col gap-1 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent/40 ${
        open ? "bg-accent" : "bg-card"
      }`}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="text-[11px] tabular-nums text-muted-foreground">{number}</span>
        <span className="flex shrink-0 items-center gap-1.5">
          <ProgressMark filled={filled} total={total} />
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${
              open ? "rotate-180" : ""
            }`}
          />
        </span>
      </span>
      <span className="text-sm font-medium leading-snug text-foreground">{title}</span>
    </button>
  );
}

function FieldLabel({ field, filled }) {
  return (
    <div className="mb-1.5 flex items-start justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{field.label}</h3>
          {field.required ? (
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Required
            </span>
          ) : null}
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

function SeoControlsHeader({ fields, seoAuthority }) {
  const status = seoControlsStatus(fields);
  const authority = formatSeoAuthority(seoAuthority);
  return (
    <div className="space-y-1.5 rounded-md bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
      <p className="text-sm text-foreground">
        {status.requiredDone} of {status.requiredTotal} required fields done.
        {status.ready
          ? " The SEO Advisor is unlocked."
          : " The SEO Advisor unlocks when all required fields are done."}
      </p>
      <p>
        These answers decide which keywords the company targets and what each
        article says. Use “Download SEO brief” to complete them with another AI,
        then drop the file back here.
      </p>
      <p>
        <span className="font-medium text-foreground">Domain strength:</span>{" "}
        {authority || "Not checked yet. The SEO Advisor fills this in automatically."}
      </p>
    </div>
  );
}

function ArchivedFields({ fields, onFieldChange, open, onToggle }) {
  const withContent = archivedWithContent(fields);
  return (
    <div className="rounded-lg border border-dashed border-border">
      <button
        type="button"
        onClick={() => onToggle?.(!open)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left text-sm text-muted-foreground hover:text-foreground"
      >
        <span>
          {open ? "Hide archived fields" : "Show archived fields"}
          <span className="ml-2 text-xs">
            ({withContent.length} of {ARCHIVED_FIELDS.length} have content)
          </span>
        </span>
        <ChevronDown
          className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-5 border-t border-border px-4 py-4">
          <p className="text-xs text-muted-foreground">
            Retired fields. They are not shown in the brief and not used by the
            SEO Advisor or article generation. Their content is kept so nothing
            is lost.
          </p>
          {ARCHIVED_FIELDS.map((field) => (
            <div key={field.key}>
              <h3 className="mb-1.5 text-sm font-medium text-muted-foreground">{field.label}</h3>
              <Textarea
                value={fields[field.key] || ""}
                onChange={(e) => onFieldChange(field.key, e.target.value)}
                rows={3}
                className="min-h-[72px]"
              />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export default function IntelligenceBrief({
  companyName,
  onCompanyNameChange,
  fields,
  onFieldChange,
  socialLinks,
  onSocialChange,
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
  seoAuthority = null,
  archivedOpen = false,
  onToggleArchived,
}) {
  const ctx = { fields, companyName };
  const basic = basicProgress(ctx);
  const identityOpen = openGroups.identity === true;
  const sectionButtons = [
    {
      id: "identity",
      number: "00",
      title: "Basics",
      filled: basic.filled,
      total: basic.total,
    },
    ...INTELLIGENCE_GROUPS.map((group) => {
      const progress = groupProgress(group, ctx);
      return {
        id: group.id,
        number: group.number,
        title: group.title,
        filled: progress.filled,
        total: progress.total,
      };
    }),
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {sectionButtons.map((section) => (
          <SectionButton
            key={section.id}
            number={section.number}
            title={section.title}
            filled={section.filled}
            total={section.total}
            open={openGroups[section.id] === true}
            onClick={() => onToggleGroup(section.id, openGroups[section.id] !== true)}
          />
        ))}
      </div>

      {identityOpen ? (
        <div className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2.5">
            <h2 className="text-sm font-medium text-foreground">
              <span className="mr-3 text-[11px] tabular-nums text-muted-foreground">00</span>
              Basics
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:grid-cols-2">
            {VISIBLE_BASIC_FIELDS.map((field) => {
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
                      {(socialLinks || []).length === 0 ? (
                        <p className="text-sm text-muted-foreground">None added.</p>
                      ) : null}
                    </div>
                  </div>
                );
              }

              if (field.kind === "team") {
                return (
                  <div key={field.id} className="sm:col-span-2">
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
        </div>
      ) : null}

      {INTELLIGENCE_GROUPS.map((group) => {
        const open = openGroups[group.id] === true;
        if (!open) return null;
        return (
          <div key={group.id} className="rounded-lg border border-border">
            <div className="border-b border-border px-4 py-2.5">
              <h2 className="text-sm font-medium text-foreground">
                <span className="mr-3 text-[11px] tabular-nums text-muted-foreground">
                  {group.number}
                </span>
                {group.title}
              </h2>
            </div>
            <div className="space-y-6 px-4 py-5">
                {group.id === SEO_GROUP_ID ? (
                  <SeoControlsHeader fields={fields} seoAuthority={seoAuthority} />
                ) : null}
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
                  if (field.seo && field.rows === 1) {
                    return (
                      <div key={field.id}>
                        <FieldLabel field={field} filled={filled} />
                        <Input
                          value={fields[field.key] || ""}
                          onChange={(e) => onFieldChange(field.key, e.target.value)}
                        />
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
          </div>
        );
      })}

      <ArchivedFields
        fields={fields}
        onFieldChange={onFieldChange}
        open={archivedOpen}
        onToggle={onToggleArchived}
      />

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
                  Pillar keywords, publishing & leftover data
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
              Pillar keywords and their supporting keywords live here, along
              with publishing and leftover fields. They are not part of the
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
