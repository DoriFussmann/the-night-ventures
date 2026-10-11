import React, { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import { ImagePlus, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cropImageTo16x9 } from "../aiImage/cropImage";
import { heroPreviewUrl } from "../articleGeneration/heroImageStorage";
import {
  DEFAULT_PUBLISH_BRANCH,
  formatPublishProgress,
  isPublishDestinationMapped,
} from "../articleGeneration/publishToSite";
import { commitLibraryArticle } from "./commitLibraryArticle";

function asStringList(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => String(item ?? "")).filter(Boolean);
}

function asFaqList(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((item) => item && typeof item === "object");
}

function asSourceList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => item && typeof item === "object")
    .map((item) => ({
      url: String(item.url || "").trim(),
      note: String(item.note || "").trim(),
    }))
    .filter((item) => item.url || item.note);
}

function bodyForReader(body) {
  return String(body || "")
    .replace(/<!--\s*WHERE-THINGS-STAND:START\s*-->\s*/gi, "")
    .replace(/<!--\s*WHERE-THINGS-STAND:END\s*-->\s*/gi, "")
    .trim();
}

function formFromArticle(article) {
  return {
    title: article?.title || "",
    h1: article?.h1 || "",
    description: article?.description || "",
    category: article?.category || "",
    image_alt: article?.image_alt || "",
    tags: asStringList(article?.tags).join(", "),
    keywords: asStringList(article?.keywords).join(", "),
    body: article?.body || "",
  };
}

const markdownComponents = {
  h1: ({ children }) => (
    <h1 className="text-2xl font-semibold tracking-tight text-foreground mt-2 mb-4">
      {children}
    </h1>
  ),
  h2: ({ children }) => (
    <h2 className="text-xl font-semibold tracking-tight text-foreground mt-9 mb-3 pb-2 border-b border-border/60">
      {children}
    </h2>
  ),
  h3: ({ children }) => (
    <h3 className="text-lg font-medium text-foreground mt-6 mb-2">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-4 text-xs leading-[1.75] text-foreground/90">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-4 ml-5 list-disc space-y-1.5 text-xs leading-[1.7] text-foreground/90">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-4 ml-5 list-decimal space-y-1.5 text-xs leading-[1.7] text-foreground/90">
      {children}
    </ol>
  ),
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  strong: ({ children }) => (
    <strong className="font-semibold text-foreground">{children}</strong>
  ),
  em: ({ children }) => <em className="italic">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-4 border-l-2 border-border pl-4 text-muted-foreground italic">
      {children}
    </blockquote>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      className="underline underline-offset-2 text-foreground hover:text-foreground/80"
      target="_blank"
      rel="noreferrer"
    >
      {children}
    </a>
  ),
  hr: () => <hr className="my-8 border-border" />,
};

export default function ArticleCmsDialog({
  article,
  companyId,
  destination,
  open,
  badges,
  deleting,
  onOpenChange,
  onDelete,
  onUpdated,
}) {
  const fileRef = useRef(null);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState(null);
  const [heroUrl, setHeroUrl] = useState("");
  const [heroLoading, setHeroLoading] = useState(false);
  const [pendingHero, setPendingHero] = useState(null);
  const [replacingImage, setReplacingImage] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [error, setError] = useState("");
  const [note, setNote] = useState("");

  const destinationMapped = isPublishDestinationMapped(destination);
  const display = editing && form ? { ...article, ...form, body: form.body } : article;
  const previewSrc = pendingHero?.src || heroUrl;
  const isPublished = article?.status === "published";

  useEffect(() => {
    if (!open) return;
    setEditing(false);
    setForm(null);
    setPendingHero(null);
    setError("");
    setNote("");
    setProgress(null);
  }, [open, article?.id]);

  useEffect(() => {
    if (!open || !article) {
      setHeroUrl("");
      return;
    }
    let cancelled = false;
    setHeroLoading(true);
    heroPreviewUrl(companyId, article)
      .then((url) => {
        if (!cancelled) setHeroUrl(url);
      })
      .finally(() => {
        if (!cancelled) setHeroLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, companyId, article?.id, article?.hero_storage_path, article?.slug]);

  const startEdit = () => {
    setForm(formFromArticle(article));
    setEditing(true);
    setError("");
    setNote("");
  };

  const cancelEdit = () => {
    setEditing(false);
    setForm(null);
    setPendingHero(null);
    setError("");
  };

  const updateField = (key, value) => {
    setForm((prev) => ({ ...(prev || formFromArticle(article)), [key]: value }));
  };

  const pickReplacement = async (file) => {
    if (!file) return;
    setReplacingImage(true);
    setError("");
    try {
      const dataUrl = await readFileAsDataUrl(file);
      const cropped = await cropImageTo16x9(dataUrl);
      const src = `data:image/png;base64,${cropped.b64_json}`;
      setPendingHero({ src, b64: cropped.b64_json });
      if (!editing) startEdit();
    } catch (err) {
      setError(err?.message || "Failed to read replacement image");
    } finally {
      setReplacingImage(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const runCommit = async (mode) => {
    if (busy || !article) return;
    setBusy(true);
    setError("");
    setNote("");
    setProgress(null);
    try {
      const { row, asDraft } = await commitLibraryArticle({
        companyId,
        destination,
        article,
        form: editing ? form : null,
        heroB64: pendingHero?.b64 || null,
        mode,
        onProgress: setProgress,
      });
      onUpdated?.(row);
      setPendingHero(null);
      setEditing(false);
      setForm(null);
      setNote(
        asDraft
          ? `Saved and committed as a draft to ${destination.owner}/${destination.repo}.`
          : `Published to ${destination.owner}/${destination.repo} (${DEFAULT_PUBLISH_BRANCH}).`
      );
    } catch (err) {
      setError(err?.message || "Commit failed");
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (busy) return;
        onOpenChange(next);
      }}
    >
      <DialogContent className="max-w-3xl max-h-[90vh] h-[90vh] overflow-hidden flex flex-col gap-0 p-0 min-h-0">
        {article && (
          <>
            <div className="shrink-0 border-b border-border px-6 pt-6 pb-4 pr-14">
              <DialogHeader className="space-y-2 text-left">
                {editing ? (
                  <div className="space-y-2">
                    <Input
                      value={form?.title || ""}
                      onChange={(e) => updateField("title", e.target.value)}
                      placeholder="Title"
                      disabled={busy}
                    />
                    <Input
                      value={form?.h1 || ""}
                      onChange={(e) => updateField("h1", e.target.value)}
                      placeholder="H1 (optional, 20–70 chars, different from the title; empty = derived)"
                      disabled={busy}
                    />
                    <Textarea
                      value={form?.description || ""}
                      onChange={(e) => updateField("description", e.target.value)}
                      placeholder="Description"
                      className="min-h-[72px]"
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <>
                    <DialogTitle className="text-xl leading-snug font-semibold tracking-tight">
                      {article.title || "(untitled)"}
                    </DialogTitle>
                    {article.h1 && (
                      <p className="text-xs text-muted-foreground">H1: {article.h1}</p>
                    )}
                    {article.description && (
                      <DialogDescription className="text-sm leading-relaxed text-muted-foreground">
                        {article.description}
                      </DialogDescription>
                    )}
                  </>
                )}
              </DialogHeader>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                {badges}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="ml-auto text-destructive hover:text-destructive"
                  disabled={deleting || busy}
                  onClick={onDelete}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                  Delete
                </Button>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
              <div className="border-b border-border px-6 py-4 space-y-3">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
                      Images
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={busy || replacingImage}
                      onClick={() => fileRef.current?.click()}
                    >
                      {replacingImage ? (
                        <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                      ) : (
                        <ImagePlus className="h-3.5 w-3.5 mr-1.5" />
                      )}
                      {previewSrc ? "Replace image" : "Add image"}
                    </Button>
                    <input
                      ref={fileRef}
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      className="hidden"
                      onChange={(e) => pickReplacement(e.target.files?.[0])}
                    />
                  </div>
                  <div className="overflow-hidden rounded-lg border border-border bg-muted/30">
                    {heroLoading && !previewSrc ? (
                      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                        Loading hero image…
                      </div>
                    ) : previewSrc ? (
                      <img
                        src={previewSrc}
                        alt={display?.image_alt || article.title || "Hero image"}
                        className="aspect-video w-full object-cover"
                      />
                    ) : (
                      <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">
                        No hero image on this article.
                      </div>
                    )}
                  </div>
                  {pendingHero ? (
                    <p className="text-xs text-muted-foreground">
                      Replacement ready — Save or Publish to commit it to the site.
                    </p>
                  ) : null}
                  {editing ? (
                    <div className="space-y-1">
                      <Label htmlFor="article-image-alt" className="text-xs">
                        Image alt
                      </Label>
                      <Input
                        id="article-image-alt"
                        value={form?.image_alt || ""}
                        onChange={(e) => updateField("image_alt", e.target.value)}
                        disabled={busy}
                      />
                    </div>
                  ) : article.image_alt ? (
                    <p className="text-xs text-muted-foreground">
                      {article.image_alt}
                    </p>
                  ) : null}
                </div>

                {editing ? (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <Field
                      label="category"
                      value={form?.category || ""}
                      onChange={(value) => updateField("category", value)}
                      disabled={busy}
                    />
                    <ReadOnlyField label="slug" value={article.slug} mono />
                    <Field
                      label="tags"
                      value={form?.tags || ""}
                      onChange={(value) => updateField("tags", value)}
                      disabled={busy}
                    />
                    <Field
                      label="keywords"
                      value={form?.keywords || ""}
                      onChange={(value) => updateField("keywords", value)}
                      disabled={busy}
                    />
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                      <ReadOnlyField label="slug" value={article.slug} mono />
                      <ReadOnlyField label="category" value={article.category} />
                      <ReadOnlyField label="date" value={article.date} />
                      <ReadOnlyField
                        label="updatedDate"
                        value={article.updated_date}
                      />
                      <ReadOnlyField label="author" value={article.author} />
                      <ReadOnlyField
                        label="pillarKeyword"
                        value={article.pillar_keyword}
                      />
                      <ReadOnlyField
                        label="supportingKeyword"
                        value={article.supporting_keyword}
                      />
                      <ReadOnlyField label="articleType" value={article.type} />
                      <ReadOnlyField
                        label="targetKeyword"
                        value={article.target_keyword}
                      />
                      <ReadOnlyField
                        label="publishedAt"
                        value={
                          article.published_at
                            ? String(article.published_at).slice(0, 10)
                            : null
                        }
                      />
                      <ReadOnlyField
                        label="publishedUrl"
                        value={article.published_url}
                      />
                    </div>
                    <div className="space-y-2 text-sm">
                      <ListField label="tags" items={asStringList(article.tags)} />
                      <ListField
                        label="keywords"
                        items={asStringList(article.keywords)}
                      />
                    </div>
                    {asFaqList(article.faqs).length > 0 && (
                      <div className="text-sm">
                        <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">
                          faqs
                        </p>
                        <div className="space-y-2">
                          {asFaqList(article.faqs).map((faq, i) => (
                            <div key={`faq-${i}`}>
                              <p className="font-medium text-foreground">
                                {faq.question || "—"}
                              </p>
                              <p className="mt-0.5 text-muted-foreground">
                                {faq.answer || "—"}
                              </p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                )}
              </div>

              <div className="px-6 py-6 bg-[linear-gradient(180deg,hsl(var(--muted)/0.35)_0%,transparent_120px)]">
                <article className="mx-auto max-w-2xl">
                  {editing ? (
                    <div className="space-y-1">
                      <Label htmlFor="article-body" className="text-xs">
                        Body
                      </Label>
                      <Textarea
                        id="article-body"
                        value={form?.body || ""}
                        onChange={(e) => updateField("body", e.target.value)}
                        className="min-h-[28rem] font-mono text-xs"
                        disabled={busy}
                      />
                    </div>
                  ) : (
                    <>
                      <ReactMarkdown components={markdownComponents}>
                        {bodyForReader(article.body)}
                      </ReactMarkdown>
                      {asSourceList(article.where_things_stand_sources).length >
                        0 && (
                        <section className="mt-10 pt-6 border-t border-border">
                          <h2 className="text-xl font-semibold tracking-tight text-foreground mb-4">
                            Sources
                          </h2>
                          <ul className="space-y-2 text-sm">
                            {asSourceList(
                              article.where_things_stand_sources
                            ).map((source, i) => (
                              <li key={`article-source-${i}`}>
                                <p className="font-medium text-foreground">
                                  {source.note || "Source"}
                                </p>
                                {source.url ? (
                                  <a
                                    href={source.url}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="mt-0.5 block break-all text-xs underline underline-offset-2 text-muted-foreground hover:text-foreground"
                                  >
                                    {source.url}
                                  </a>
                                ) : null}
                              </li>
                            ))}
                          </ul>
                        </section>
                      )}
                    </>
                  )}
                </article>
              </div>
            </div>

            <div className="shrink-0 border-t border-border px-6 py-3 space-y-2">
              {error ? (
                <p className="text-sm text-destructive">{error}</p>
              ) : null}
              {note ? (
                <p className="text-sm text-foreground">{note}</p>
              ) : null}
              {!destinationMapped ? (
                <p className="text-xs text-muted-foreground">
                  Set Publish Destination in Company Data to save or publish.
                </p>
              ) : null}
              <div className="flex flex-wrap items-center gap-2">
                {editing ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={busy}
                    onClick={cancelEdit}
                  >
                    Cancel
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={startEdit}
                  >
                    <Pencil className="h-3.5 w-3.5 mr-1.5" />
                    Edit
                  </Button>
                )}
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !destinationMapped}
                  onClick={() => runCommit("save")}
                >
                  {busy ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <Upload className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  {busy ? formatPublishProgress(progress) : "Save"}
                </Button>
                {!isPublished || editing ? (
                  <Button
                    type="button"
                    size="sm"
                    disabled={busy || !destinationMapped}
                    onClick={() => runCommit("publish")}
                  >
                    {busy ? (
                      <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                    ) : null}
                    Publish
                  </Button>
                ) : null}
              </div>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, value, onChange, disabled }) {
  return (
    <div className="space-y-1">
      <Label className="text-[11px] uppercase tracking-wide text-muted-foreground">
        {label}
      </Label>
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
      />
    </div>
  );
}

function ReadOnlyField({ label, value, mono }) {
  const display =
    value != null && String(value).trim() !== "" ? String(value) : null;
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      <div
        className={`text-foreground break-words ${mono ? "font-mono text-xs" : ""}`}
      >
        {display || <span className="text-muted-foreground">—</span>}
      </div>
    </div>
  );
}

function ListField({ label, items }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground mb-0.5">
        {label}
      </p>
      {items.length === 0 ? (
        <p className="text-muted-foreground">—</p>
      ) : (
        <p className="text-foreground break-words">{items.join(", ")}</p>
      )}
    </div>
  );
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("Failed to read image file"));
    reader.readAsDataURL(file);
  });
}
