import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import { BookOpen, Check, ExternalLink, ImageIcon, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { heroPreviewUrl } from "../articleGeneration/heroImageStorage";

function cleanBody(text) {
  return String(text || "").replace(/<!--[\s\S]*?-->/g, "");
}

function wordCount(text) {
  return cleanBody(text).split(/\s+/).filter(Boolean).length;
}

export function formatDay(day) {
  if (!day) return "";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });
}

/** e.g. "Mon, Nov 10, 2026 · 8:00 AM PST", in the viewer's timezone. */
export function formatPublishAt(date) {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const day = date.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit", timeZoneName: "short" });
  return `${day} · ${time}`;
}

const md = {
  h1: (p) => <h1 className="mb-3 mt-6 text-xl font-semibold text-foreground" {...p} />,
  h2: (p) => <h2 className="mb-2 mt-6 text-lg font-semibold text-foreground" {...p} />,
  h3: (p) => <h3 className="mb-2 mt-4 text-base font-semibold text-foreground" {...p} />,
  p: (p) => <p className="mb-3 leading-relaxed" {...p} />,
  ul: (p) => <ul className="mb-3 list-disc space-y-1 pl-5" {...p} />,
  ol: (p) => <ol className="mb-3 list-decimal space-y-1 pl-5" {...p} />,
  a: (p) => <a className="text-sky-700 underline" target="_blank" rel="noreferrer" {...p} />,
  blockquote: (p) => <blockquote className="mb-3 border-l-2 border-border pl-3 italic" {...p} />,
  table: (p) => <table className="mb-3 w-full border-collapse text-xs" {...p} />,
  th: (p) => <th className="border border-border px-2 py-1 text-left" {...p} />,
  td: (p) => <td className="border border-border px-2 py-1" {...p} />,
};

/** Draft summary on the card, with the full review in a modal. */
export default function DraftPanel({ companyId, brief, draft, publishAt, busy, onApprove, onUnapprove, onRedo, onNewImage }) {
  const [heroUrl, setHeroUrl] = useState("");
  const [open, setOpen] = useState(false);
  const [imgNote, setImgNote] = useState("");
  const [imgBusy, setImgBusy] = useState(false);
  const [imgError, setImgError] = useState("");

  const newImage = async () => {
    setImgBusy(true);
    setImgError("");
    try {
      await onNewImage(imgNote.trim());
      setImgNote("");
    } catch (err) {
      setImgError(err?.message || "Image failed");
    } finally {
      setImgBusy(false);
    }
  };

  useEffect(() => {
    let alive = true;
    if (draft?.hero_storage_path) {
      heroPreviewUrl(companyId, draft)
        .then((url) => alive && setHeroUrl(url || ""))
        .catch(() => {});
    }
    return () => {
      alive = false;
    };
  }, [companyId, draft]);

  if (!draft) {
    return <p className="text-xs text-muted-foreground">The draft for this brief was not found in the Articles library.</p>;
  }
  const noHero = !draft.hero_storage_path;
  const words = wordCount(draft.body);

  const actions = (
    <>
      <Button asChild variant="outline" size="sm">
        <Link to={`/company/${companyId}/articles?slug=${encodeURIComponent(draft.slug)}`}>
          <ExternalLink className="mr-1 h-3.5 w-3.5" /> Edit in Articles
        </Link>
      </Button>
      {brief.status === "generated" && (
        <>
          <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); onRedo(); }}>
            <RotateCcw className="mr-1 h-3.5 w-3.5" /> Rewrite from brief
          </Button>
          <Button type="button" size="sm" disabled={busy || noHero} onClick={() => { setOpen(false); onApprove(); }}>
            <Check className="mr-1 h-3.5 w-3.5" /> Approve
          </Button>
        </>
      )}
      {brief.status === "approved" && (
        <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={() => { setOpen(false); onUnapprove(); }}>
          <Undo2 className="mr-1 h-3.5 w-3.5" /> Unapprove
        </Button>
      )}
    </>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-3 sm:flex-row">
        {heroUrl ? <img src={heroUrl} alt="" className="h-20 w-36 shrink-0 rounded object-cover" /> : null}
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-foreground">{draft.title}</p>
          <p className="text-xs text-muted-foreground">{draft.description}</p>
          <p className="text-[11px] text-muted-foreground">
            /articles/{draft.slug}/ · {words.toLocaleString()} words
            {brief.status === "approved" ? " · approved, waiting to be scheduled" : ""}
            {brief.status === "scheduled"
              ? ` · publishes ${publishAt ? formatPublishAt(publishAt) : formatDay(brief.publish_on)}`
              : ""}
            {brief.status === "published" ? " · live" : ""}
          </p>
        </div>
        <Button type="button" size="sm" variant={brief.status === "generated" ? "default" : "outline"} onClick={() => setOpen(true)}>
          <BookOpen className="mr-1 h-3.5 w-3.5" /> {brief.status === "generated" ? "Review" : "Read"}
        </Button>
      </div>

      {noHero && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No hero image yet. Add one in the Articles library before approving; the site needs it to publish.
        </p>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] max-w-3xl flex-col gap-0 p-0">
          <DialogHeader className="border-b border-border px-6 py-4">
            <DialogTitle className="text-base">{draft.title}</DialogTitle>
            <p className="text-xs text-muted-foreground">
              /articles/{draft.slug}/ · {words.toLocaleString()} words · keyword: {brief.primary_keyword}
            </p>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto px-6 py-4 text-sm text-foreground">
            {heroUrl ? <img src={heroUrl} alt="" className={`mb-2 w-full rounded object-cover ${imgBusy ? "opacity-40" : ""}`} /> : null}
            {brief.status !== "scheduled" && brief.status !== "published" && (
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <Input
                  className="h-8 flex-1 text-xs"
                  placeholder="Optional direction, e.g. 'a printed investor list and a red pen, morning light'"
                  value={imgNote}
                  disabled={imgBusy}
                  onChange={(e) => setImgNote(e.target.value)}
                />
                <Button type="button" variant="outline" size="sm" disabled={imgBusy || busy} onClick={newImage}>
                  {imgBusy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1 h-3.5 w-3.5" />}
                  {imgBusy ? "Making a new image… (about a minute)" : "New image"}
                </Button>
                {imgError && <span className="w-full text-xs text-destructive">{imgError}</span>}
              </div>
            )}
            <p className="mb-4 text-muted-foreground">{draft.description}</p>
            <ReactMarkdown components={md}>{cleanBody(draft.body)}</ReactMarkdown>
          </div>
          <DialogFooter className="flex flex-wrap gap-2 border-t border-border px-6 py-3 sm:justify-between">{actions}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
