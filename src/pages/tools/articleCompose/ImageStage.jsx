import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { signedHeroUrl } from "../articleGeneration/heroImageStorage";
import {
  generateHeroForArticle,
  loadCompanyPositioning,
} from "../articleGeneration/singleArticle";
import { saveHeroOnDraft } from "./draftRecord";

export default function ImageStage({ companyId, state, dispatch }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [previewSrc, setPreviewSrc] = useState("");
  const attribution = state.heroSource?.attribution;

  useEffect(() => {
    let cancelled = false;
    const path = String(state.heroStoragePath || "").trim();
    if (!path) return undefined;
    signedHeroUrl(path).then((url) => {
      if (!cancelled && url) setPreviewSrc(url);
    });
    return () => {
      cancelled = true;
    };
  }, [state.heroStoragePath]);

  async function run({ excludePrevious = false } = {}) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const positioning = await loadCompanyPositioning(companyId);
      const previousId = String(state.heroSource?.sourceId || "").trim();
      const result = await generateHeroForArticle({
        companyId,
        article: {
          title: state.frontmatter?.title || "",
          type: state.articleType,
          targetKeyword: state.targetKeyword,
          searchIntent: "",
        },
        frontmatter: state.frontmatter,
        styleContext: positioning.imageryContext,
        excludeIds: excludePrevious && previousId ? [previousId] : [],
      });
      const storagePath = String(result?.storagePath || "").trim();
      if (!storagePath) throw new Error("Hero image was not saved.");
      const heroSource = {
        source: result.meta?.source || "",
        sourceId: result.meta?.sourceId ?? null,
        attribution: result.meta?.attribution ?? null,
      };
      await saveHeroOnDraft({
        companyId,
        draftId: state.draftId,
        storagePath,
        heroSource,
      });
      if (result.previewSrc) setPreviewSrc(result.previewSrc);
      dispatch({
        type: "patch",
        patch: {
          heroStoragePath: storagePath,
          heroSource,
        },
      });
    } catch (err) {
      setError(err?.message || "Image generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      {busy && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Finding a hero image…
        </p>
      )}
      {error && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {error}
        </p>
      )}
      {previewSrc && (
        <img
          src={previewSrc}
          alt={state.frontmatter?.imageAlt || "Hero preview"}
          className="w-full max-w-xl rounded-md border border-border"
        />
      )}
      {state.heroSource?.source === "writer" && (
        <p className="text-xs text-muted-foreground">The writer&apos;s image. Regenerate to replace it.</p>
      )}
      {attribution && (
        <p className="text-xs text-muted-foreground">
          {attribution.photographer ? (
            <>
              Photo by{" "}
              {attribution.photographerUrl ? (
                <a
                  href={attribution.photographerUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="underline underline-offset-2"
                >
                  {attribution.photographer}
                </a>
              ) : (
                attribution.photographer
              )}
            </>
          ) : (
            "Attribution"
          )}
          {attribution.sourceUrl ? (
            <>
              {" "}
              ·{" "}
              <a
                href={attribution.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="underline underline-offset-2"
              >
                Source
              </a>
            </>
          ) : null}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        {!state.heroStoragePath && !busy && (
          <Button type="button" onClick={() => run()}>
            Generate image
          </Button>
        )}
        {state.heroStoragePath && (
          <Button type="button" variant="outline" disabled={busy} onClick={() => run({ excludePrevious: true })}>
            Regenerate image
          </Button>
        )}
      </div>
    </div>
  );
}
