import { useEffect, useReducer, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import TargetingSection from "./articleCompose/TargetingSection";
import IdeaInput from "./articleCompose/IdeaInput";
import ModifySource from "./articleCompose/ModifySource";
import ReviewStage from "./articleCompose/ReviewStage";
import ImageStage from "./articleCompose/ImageStage";
import PublishStage from "./articleCompose/PublishStage";
import { useCoverage } from "./articleCompose/useCoverage";
import { generateIdeaArticle } from "./articleCompose/generateIdea";
import { generateModifyArticle } from "./articleCompose/generateModify";
import {
  composePatchFromRow,
  loadComposeDraft,
  saveComposeEdits,
  SlugTakenError,
} from "./articleCompose/draftRecord";
import { isReviewValid } from "./articleCompose/reviewValidation";
import {
  composeReducer,
  ideaInputErrors,
  initialComposeState,
  isIdeaInputValid,
  isModifyInputValid,
  isTargetingValid,
  modifyInputErrors,
  targetingErrors,
} from "./articleCompose/composeState";

const STAGES = [
  { id: "input", label: "Input" },
  { id: "generate", label: "Generate" },
  { id: "review", label: "Review" },
  { id: "image", label: "Image" },
  { id: "publish", label: "Publish" },
];

export default function ArticleCompose({ mode }) {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const draftParam = searchParams.get("draft") || "";
  const { pillars, loading, error } = useCoverage(companyId);
  const [state, dispatch] = useReducer(composeReducer, initialComposeState);
  const [elapsed, setElapsed] = useState(0);
  const [saving, setSaving] = useState(false);
  const skipLoad = useRef("");
  const isIdea = mode === "idea";
  const inputErrors = isIdea ? ideaInputErrors(state) : modifyInputErrors(state);
  const errors = {
    ...targetingErrors(state, mode),
    ...inputErrors,
  };
  const targetingValid = isTargetingValid(state, mode);
  const inputValid = isIdea ? isIdeaInputValid(state) : isModifyInputValid(state);
  const canCreate = targetingValid && inputValid && !state.generating;
  const reviewReady =
    Boolean(state.frontmatter) &&
    !state.dirty &&
    state.status !== "published" &&
    isReviewValid(state.frontmatter, state.body);

  useEffect(() => {
    if (!state.generating) {
      setElapsed(0);
      return undefined;
    }
    const started = Date.now();
    setElapsed(0);
    const id = window.setInterval(() => {
      setElapsed(Math.floor((Date.now() - started) / 1000));
    }, 1000);
    return () => window.clearInterval(id);
  }, [state.generating]);

  useEffect(() => {
    if (!companyId || !draftParam) return undefined;
    if (skipLoad.current === draftParam) return undefined;
    let cancelled = false;
    skipLoad.current = draftParam;
    dispatch({ type: "patch", patch: { resumeLoading: true, resumeError: "" } });
    loadComposeDraft({ companyId, id: draftParam })
      .then((row) => {
        if (cancelled) return;
        if (!row) {
          dispatch({
            type: "patch",
            patch: { resumeLoading: false, resumeError: "Draft not found." },
          });
          return;
        }
        dispatch({ type: "hydrate", patch: composePatchFromRow(row) });
      })
      .catch((err) => {
        if (cancelled) return;
        skipLoad.current = "";
        dispatch({
          type: "patch",
          patch: {
            resumeLoading: false,
            resumeError: err?.message || "Failed to load the draft",
          },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [companyId, draftParam]);

  function rememberDraft(id) {
    skipLoad.current = id;
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set("draft", id);
        return next;
      },
      { replace: true }
    );
  }

  async function runGeneration({ replace = false } = {}) {
    dispatch({
      type: "patch",
      patch: { generating: true, generationError: "", validationErrors: [] },
    });
    try {
      const existingDraftId = replace ? state.draftId : "";
      const result = isIdea
        ? await generateIdeaArticle({ companyId, state, existingDraftId })
        : await generateModifyArticle({ companyId, state, existingDraftId });
      rememberDraft(result.draftId);
      dispatch({
        type: "patch",
        patch: {
          generating: false,
          stage: "review",
          draftId: result.draftId,
          savedSlug: result.frontmatter?.slug || "",
          frontmatter: result.frontmatter,
          body: result.body,
          whereThingsStandSources: result.whereThingsStandSources,
          slugNote: result.slugNote,
          coverageWarning: result.coverageWarning,
          generationError: "",
          validationErrors: [],
          dirty: false,
          status: "drafted",
          slugConflict: "",
          publishDone: false,
          wireFinished: false,
          originalSource: isIdea ? state.originalSource : state.sourceArticle,
        },
      });
    } catch (err) {
      dispatch({
        type: "patch",
        patch: {
          generating: false,
          generationError: err?.message || "Generation failed",
          validationErrors: Array.isArray(err?.validationErrors) ? err.validationErrors : [],
        },
      });
    }
  }

  async function onSave() {
    if (!state.dirty || saving) return;
    setSaving(true);
    try {
      const saved = await saveComposeEdits({
        companyId,
        draftId: state.draftId,
        previousSlug: state.savedSlug,
        pillarKeyword: state.pillarKeyword,
        supportingKeyword: state.clusterKeyword,
        type: state.articleType,
        targetKeyword: state.targetKeyword,
        frontmatter: state.frontmatter,
        body: state.body,
        whereThingsStandSources: state.whereThingsStandSources,
        source: isIdea ? "idea" : "modify",
      });
      dispatch({
        type: "patch",
        patch: {
          dirty: false,
          savedSlug: saved.row.slug,
          slugConflict: "",
          coverageWarning: saved.coverageWarning,
          frontmatter: { ...state.frontmatter, slug: saved.row.slug },
        },
      });
    } catch (err) {
      if (err instanceof SlugTakenError) {
        dispatch({
          type: "patch",
          patch: { slugConflict: err.message, focusSlug: state.focusSlug + 1 },
        });
      } else {
        dispatch({
          type: "patch",
          patch: { generationError: err?.message || "Failed to save changes" },
        });
      }
    } finally {
      setSaving(false);
    }
  }

  function startAnother() {
    skipLoad.current = "";
    dispatch({ type: "reset" });
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete("draft");
        return next;
      },
      { replace: true }
    );
  }

  function stageEnabled(stageId) {
    if (state.generating || state.resumeLoading) return false;
    if (state.status === "published") return stageId === "publish";
    if (stageId === "input") return true;
    if (stageId === "review") return Boolean(state.frontmatter);
    if (stageId === "image" || stageId === "publish") return reviewReady;
    return false;
  }

  return (
    <div className="space-y-6 pb-24">
      <div>
        <h1 className="text-xs text-foreground mb-1">
          {isIdea ? "Article Idea" : "Article Modify"}
        </h1>
        <p className="text-sm text-muted-foreground">
          {isIdea
            ? "Turn a rough idea into a targeted article. Set the pillar, cluster, and keyword first."
            : "Restructure an existing article around a pillar, cluster, and target keyword."}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card px-4 py-4">
        <div className="flex flex-wrap gap-2">
          {STAGES.map((stage) => {
            const active = state.stage === stage.id;
            const enabled = stageEnabled(stage.id);
            return (
              <Button
                key={stage.id}
                type="button"
                size="sm"
                variant={active ? "default" : "outline"}
                disabled={!enabled}
                onClick={() => enabled && dispatch({ type: "patch", patch: { stage: stage.id } })}
              >
                {stage.label}
              </Button>
            );
          })}
        </div>
      </div>

      {state.resumeLoading && (
        <p className="text-sm text-muted-foreground flex items-center gap-2">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading draft…
        </p>
      )}
      {state.resumeError && <p className="text-sm text-destructive">{state.resumeError}</p>}

      <TargetingSection
        mode={mode}
        companyId={companyId}
        pillars={pillars}
        coverageLoading={loading}
        coverageError={error}
        state={state}
        dispatch={dispatch}
        disabled={state.generating || state.stage !== "input"}
      />

      {state.stage === "review" && state.frontmatter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Review</CardTitle>
          </CardHeader>
          <CardContent>
            <ReviewStage
              mode={mode}
              state={state}
              dispatch={dispatch}
              saving={saving}
              onSave={onSave}
              onRegenerate={() => runGeneration({ replace: true })}
            />
          </CardContent>
        </Card>
      )}

      {state.stage === "image" && state.frontmatter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Image</CardTitle>
          </CardHeader>
          <CardContent>
            <ImageStage companyId={companyId} state={state} dispatch={dispatch} />
          </CardContent>
        </Card>
      )}

      {state.stage === "publish" && state.frontmatter && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Publish</CardTitle>
          </CardHeader>
          <CardContent>
            <PublishStage
              companyId={companyId}
              state={state}
              dispatch={dispatch}
              onStartAnother={startAnother}
            />
          </CardContent>
        </Card>
      )}

      {isIdea && state.stage === "input" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Idea</CardTitle>
          </CardHeader>
          <CardContent>
            <IdeaInput state={state} dispatch={dispatch} disabled={state.generating} />
          </CardContent>
        </Card>
      )}

      {!isIdea && state.stage === "input" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Source article</CardTitle>
          </CardHeader>
          <CardContent>
            <ModifySource
              companyId={companyId}
              state={state}
              dispatch={dispatch}
              disabled={state.generating}
            />
          </CardContent>
        </Card>
      )}

      {state.stage === "input" && (
        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" disabled={!canCreate} onClick={() => runGeneration()}>
            {state.generating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            {isIdea ? "Creation Help" : "Adjust / Modify"}
          </Button>
          {state.generating && (
            <p className="text-sm text-muted-foreground">{elapsed}s · Usually 1–3 minutes</p>
          )}
          {!state.generating && !canCreate && (
            <p className="text-xs text-muted-foreground">{Object.values(errors).join(" ")}</p>
          )}
        </div>
      )}

      {state.stage === "input" && state.generationError && (
        <div className="space-y-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          <p>{state.generationError}</p>
          {state.validationErrors.length > 0 && (
            <ul className="list-disc pl-5 space-y-1">
              {state.validationErrors.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          )}
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={state.generating}
            onClick={() => runGeneration()}
          >
            Retry
          </Button>
        </div>
      )}
    </div>
  );
}
