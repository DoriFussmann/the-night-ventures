import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarCheck, Check, ExternalLink, Loader2, RotateCcw, Undo2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { heroPreviewUrl } from "../articleGeneration/heroImageStorage";

function wordCount(text) {
  return String(text || "")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .split(/\s+/)
    .filter(Boolean).length;
}

function formatDay(day) {
  if (!day) return "";
  return new Date(`${day}T12:00:00Z`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

/** Review of a written draft: read it, open it to edit, approve, schedule. */
export default function DraftPanel({ companyId, brief, draft, busy, onApprove, onUnapprove, onRedo, onScheduleOne }) {
  const [heroUrl, setHeroUrl] = useState("");
  const [showBody, setShowBody] = useState(false);

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
  const words = wordCount(draft.body);
  const noHero = !draft.hero_storage_path;

  return (
    <div className="space-y-3">
      <div className="flex gap-3">
        {heroUrl ? <img src={heroUrl} alt="" className="h-20 w-36 shrink-0 rounded object-cover" /> : null}
        <div className="min-w-0 space-y-1">
          <p className="text-sm font-medium text-foreground">{draft.title}</p>
          <p className="text-xs text-muted-foreground">{draft.description}</p>
          <p className="text-[11px] text-muted-foreground">
            /articles/{draft.slug}/ · {words.toLocaleString()} words
          </p>
        </div>
      </div>

      {noHero && (
        <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          No hero image yet. Add one in the Articles library before approving; the site needs it to publish.
        </p>
      )}

      <div>
        <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setShowBody((v) => !v)}>
          {showBody ? "Hide the article" : "Read the article here"}
        </button>
        {showBody && (
          <pre className="mt-2 max-h-[28rem] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 font-sans text-xs leading-relaxed text-foreground">
            {draft.body}
          </pre>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3">
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm">
            <Link to={`/company/${companyId}/articles?slug=${encodeURIComponent(draft.slug)}`}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Edit in Articles
            </Link>
          </Button>
          {brief.status === "generated" && (
            <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onRedo}>
              <RotateCcw className="mr-1 h-3.5 w-3.5" /> Rewrite from brief
            </Button>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {brief.status === "generated" && (
            <Button type="button" size="sm" disabled={busy || noHero} onClick={onApprove}>
              <Check className="mr-1 h-3.5 w-3.5" /> Approve
            </Button>
          )}
          {brief.status === "approved" && (
            <>
              <Button type="button" variant="ghost" size="sm" disabled={busy} onClick={onUnapprove}>
                <Undo2 className="mr-1 h-3.5 w-3.5" /> Unapprove
              </Button>
              {!brief.batch_label && (
                <Button type="button" size="sm" disabled={busy} onClick={onScheduleOne}>
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <CalendarCheck className="mr-1 h-3.5 w-3.5" />}
                  Schedule (next workday)
                </Button>
              )}
              {brief.batch_label && <span className="text-[11px] text-muted-foreground">Approved · schedule the week above</span>}
            </>
          )}
          {brief.status === "scheduled" && (
            <span className="text-xs text-foreground">Publishes {formatDay(brief.publish_on)}</span>
          )}
          {brief.status === "published" && <span className="text-xs text-emerald-700">Live</span>}
        </div>
      </div>
    </div>
  );
}
