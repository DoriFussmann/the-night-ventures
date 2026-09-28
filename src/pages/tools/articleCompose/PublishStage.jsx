import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import WireInternalLinksPanel from "../articleGeneration/WireInternalLinksPanel";
import {
  formatPublishProgress,
  isPublishDestinationMapped,
  loadCompanyPublishDestination,
} from "../articleGeneration/publishToSite";
import { publishSingleArticle } from "../articleGeneration/singleArticle";
import { markComposedCoveragePublished } from "../articleGeneration/updateCoverageDrafted";
import { loadComposeDraft, markDraftPublished } from "./draftRecord";

export default function PublishStage({ companyId, state, dispatch, onSlugConflict, onStartAnother }) {
  const [destination, setDestination] = useState(null);
  const [destError, setDestError] = useState("");
  const [publishing, setPublishing] = useState(false);
  const sawWire = useRef(false);

  useEffect(() => {
    let cancelled = false;
    loadCompanyPublishDestination(companyId)
      .then((next) => {
        if (!cancelled) setDestination(next);
      })
      .catch((err) => {
        if (!cancelled) setDestError(err?.message || "Failed to load the publish destination");
      });
    return () => {
      cancelled = true;
    };
  }, [companyId]);

  const mapped = isPublishDestinationMapped(destination);
  const alreadyPublished = state.status === "published" && !state.publishDone;

  async function onPublish() {
    if (publishing) return;
    setPublishing(true);
    dispatch({
      type: "patch",
      patch: { publishError: "", publishProgress: "Publishing…", publishDone: false },
    });
    try {
      const row = await loadComposeDraft({ companyId, id: state.draftId });
      if (!row) throw new Error("Draft not found.");
      const result = await publishSingleArticle({
        companyId,
        row,
        onProgress: (progress) => {
          dispatch({
            type: "patch",
            patch: { publishProgress: formatPublishProgress(progress) },
          });
        },
      });
      const publishedUrl = result?.pullRequestUrl || "";
      const marked = await markDraftPublished({
        companyId,
        draftId: state.draftId,
        publishedUrl,
      });
      let coverageWarning = "";
      try {
        const coverage = await markComposedCoveragePublished({
          companyId,
          pillarKeyword: state.pillarKeyword,
          supportingKeyword: state.clusterKeyword,
          slug: row.slug,
          publishedUrl: marked.publishedUrl,
        });
        coverageWarning = coverage.warning || "";
      } catch (err) {
        coverageWarning = err?.message || "Coverage could not be marked published.";
      }
      sawWire.current = false;
      dispatch({
        type: "patch",
        patch: {
          status: "published",
          publishedUrl: marked.publishedUrl,
          publishDone: true,
          wireFinished: false,
          publishError: "",
          publishProgress: "",
          coverageWarning,
          savedSlug: row.slug,
          frontmatter: { ...state.frontmatter, slug: row.slug, draft: false },
        },
      });
    } catch (err) {
      const reason = String(err?.reason || "");
      if (reason === "already_exists") {
        dispatch({
          type: "patch",
          patch: {
            stage: "review",
            publishError: "",
            publishProgress: "",
            slugConflict: "This slug already exists on the site — change it.",
            focusSlug: Number(state.focusSlug || 0) + 1,
          },
        });
        onSlugConflict?.();
        return;
      }
      if (reason === "missing_hero" || /hero image/i.test(String(err?.message || ""))) {
        dispatch({
          type: "patch",
          patch: { stage: "image", publishError: "", publishProgress: "" },
        });
        return;
      }
      dispatch({
        type: "patch",
        patch: {
          publishError: err?.message || "Publish failed",
          publishProgress: "",
        },
      });
    } finally {
      setPublishing(false);
    }
  }

  if (alreadyPublished) {
    return (
      <div className="space-y-3">
        <p className="text-sm font-medium">Already published</p>
        {state.publishedUrl ? (
          <a
            href={state.publishedUrl}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-primary underline underline-offset-2 break-all"
          >
            {state.publishedUrl}
          </a>
        ) : (
          <p className="text-sm text-muted-foreground">This draft is marked published.</p>
        )}
        <Button type="button" variant="outline" onClick={onStartAnother}>
          Start another
        </Button>
      </div>
    );
  }

  if (destError) {
    return <p className="text-sm text-destructive">{destError}</p>;
  }
  if (destination && !mapped) {
    return <p className="text-sm text-muted-foreground">No destination repo set for this company.</p>;
  }

  return (
    <div className="space-y-4">
      {!state.publishDone && (
        <Button type="button" disabled={publishing || !mapped} onClick={onPublish}>
          {publishing && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
          Publish
        </Button>
      )}
      {state.publishProgress && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          {state.publishProgress}
        </p>
      )}
      {state.publishError && (
        <div className="space-y-2">
          <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
            {state.publishError}
          </p>
          <Button type="button" variant="outline" size="sm" disabled={publishing} onClick={onPublish}>
            Retry
          </Button>
        </div>
      )}
      {state.coverageWarning && state.publishDone && (
        <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
          {state.coverageWarning}
        </p>
      )}
      {state.publishDone && destination && (
        <WireInternalLinksPanel
          companyId={companyId}
          destination={destination}
          visible
          autoStart
          onActiveChange={(active) => {
            if (active) sawWire.current = true;
            if (sawWire.current && !active) {
              dispatch({ type: "patch", patch: { wireFinished: true } });
            }
          }}
        />
      )}
      {state.publishDone && state.wireFinished && (
        <div className="space-y-2 rounded-md border border-border p-3 text-sm">
          <p className="font-medium">Published</p>
          {state.publishedUrl && (
            <p>
              Live URL:{" "}
              <a
                href={state.publishedUrl}
                target="_blank"
                rel="noreferrer"
                className="text-primary underline underline-offset-2 break-all"
              >
                {state.publishedUrl}
              </a>
            </p>
          )}
          <p>
            Slug: <span className="font-mono">{state.frontmatter?.slug}</span>
          </p>
          <p>
            Pillar: {state.pillarKeyword}
            {state.clusterKeyword ? ` · Cluster: ${state.clusterKeyword}` : ""}
          </p>
          <Button type="button" variant="outline" onClick={onStartAnother}>
            Start another
          </Button>
        </div>
      )}
    </div>
  );
}
