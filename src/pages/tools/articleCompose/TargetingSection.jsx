import { useRef } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  ARTICLE_TYPES,
  parseAllowedBrands,
  suggestSourceText,
  targetingErrors,
} from "./composeState";
import { suggestTargetKeyword } from "./suggestTargetKeyword";
import { findCannibalization } from "./cannibalization";

function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export default function TargetingSection({
  mode,
  companyId,
  pillars,
  coverageLoading,
  coverageError,
  state,
  dispatch,
  disabled = false,
}) {
  const locked = Boolean(disabled);
  const errors = targetingErrors(state, mode);
  const showWordCount = mode !== "modify" || state.expandLength;
  const brands = parseAllowedBrands(state.allowedBrandsText);
  const checkToken = useRef(0);
  const selectedPillar =
    pillars.find(
      (pillar) => String(pillar?.keyword || "").trim() === state.pillarKeyword
    ) || null;
  const clusters = (
    Array.isArray(selectedPillar?.supporting) ? selectedPillar.supporting : []
  ).filter((item) => String(item?.keyword || "").trim());
  const canSuggest = Boolean(state.pillarKeyword && state.clusterKeyword);

  async function onSuggest() {
    if (!canSuggest || state.suggesting) return;
    dispatch({
      type: "patch",
      patch: { suggesting: true, suggestError: "", suggestions: [] },
    });
    try {
      const suggestions = await suggestTargetKeyword({
        text: suggestSourceText(mode, state),
        pillarKeyword: state.pillarKeyword,
        supportingKeyword: state.clusterKeyword,
      });
      dispatch({
        type: "patch",
        patch: { suggesting: false, suggestions },
      });
    } catch (err) {
      dispatch({
        type: "patch",
        patch: {
          suggesting: false,
          suggestError: err?.message || "Failed to suggest target keywords",
        },
      });
    }
  }

  async function checkTargetKeyword(rawKeyword) {
    const keyword = String(rawKeyword || "").trim();
    if (!keyword) {
      dispatch({
        type: "patch",
        patch: { cannibalization: [], cannibalizationError: "" },
      });
      return;
    }
    const token = checkToken.current + 1;
    checkToken.current = token;
    try {
      const matches = await findCannibalization({
        companyId,
        pillars,
        targetKeyword: keyword,
        pillarKeyword: state.pillarKeyword,
        supportingKeyword: state.clusterKeyword,
        articleType: state.articleType,
        excludeId: state.draftId,
      });
      if (checkToken.current !== token) return;
      dispatch({
        type: "patch",
        patch: { cannibalization: matches, cannibalizationError: "" },
      });
    } catch (err) {
      if (checkToken.current !== token) return;
      dispatch({
        type: "patch",
        patch: {
          cannibalization: [],
          cannibalizationError: err?.message || "Could not check existing articles",
        },
      });
    }
  }

  return (
    <section className="rounded-lg border border-border bg-card px-4 py-4 space-y-4">
      <div>
        <h2 className="text-sm font-medium text-foreground">Targeting</h2>
        <p className="text-xs text-muted-foreground">
          Pillar, cluster, and target keyword are required before the article can be created.
        </p>
      </div>

      {coverageLoading && (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading pillars from coverage…
        </div>
      )}
      {coverageError && (
        <p className="text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-md px-3 py-2">
          {coverageError}
        </p>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="compose-pillar">Pillar keyword</Label>
          <Select
            value={state.pillarKeyword || undefined}
            onValueChange={(value) =>
              dispatch({ type: "setPillar", pillarKeyword: value })
            }
            disabled={locked || coverageLoading || pillars.length === 0}
          >
            <SelectTrigger id="compose-pillar">
              <SelectValue placeholder="Select a pillar" />
            </SelectTrigger>
            <SelectContent>
              {pillars.map((pillar) => {
                const keyword = String(pillar?.keyword || "").trim();
                if (!keyword) return null;
                return (
                  <SelectItem key={pillar.slug || keyword} value={keyword}>
                    {keyword}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <FieldError message={errors.pillarKeyword} />
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="compose-cluster">Cluster keyword</Label>
          <Select
            value={state.clusterKeyword || undefined}
            onValueChange={(value) =>
              dispatch({ type: "patch", patch: { clusterKeyword: value } })
            }
            disabled={locked || !selectedPillar || clusters.length === 0}
          >
            <SelectTrigger id="compose-cluster">
              <SelectValue
                placeholder={
                  selectedPillar ? "Select a cluster" : "Choose a pillar first"
                }
              />
            </SelectTrigger>
            <SelectContent>
              {clusters.map((cluster) => {
                const keyword = String(cluster.keyword || "").trim();
                return (
                  <SelectItem key={cluster.slug || keyword} value={keyword}>
                    {keyword}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          <FieldError message={errors.clusterKeyword} />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="compose-target">Target keyword</Label>
        <div className="flex gap-2">
          <Input
            id="compose-target"
            value={state.targetKeyword}
            onChange={(event) =>
              dispatch({
                type: "patch",
                patch: {
                  targetKeyword: event.target.value,
                  cannibalization: [],
                  cannibalizationError: "",
                },
              })
            }
            onBlur={(event) => checkTargetKeyword(event.target.value)}
            placeholder="Long-tail query this article should rank for"
            disabled={locked}
          />
          <Button
            type="button"
            variant="outline"
            onClick={onSuggest}
            disabled={locked || !canSuggest || state.suggesting}
          >
            {state.suggesting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Suggest
          </Button>
        </div>
        <FieldError message={errors.targetKeyword} />
        {state.suggestError && (
          <p className="text-xs text-destructive">{state.suggestError}</p>
        )}
        {state.suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {state.suggestions.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                disabled={locked}
                onClick={() => {
                  dispatch({
                    type: "patch",
                    patch: { targetKeyword: suggestion },
                  });
                  checkTargetKeyword(suggestion);
                }}
              >
                <Badge variant="outline" className="cursor-pointer font-normal">
                  {suggestion}
                </Badge>
              </button>
            ))}
          </div>
        )}
        {state.cannibalizationError && (
          <p className="text-xs text-destructive">{state.cannibalizationError}</p>
        )}
        {state.cannibalization.length > 0 && (
          <div className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 space-y-1">
            <p className="font-medium">
              {state.cannibalization.some((match) => match.blocking)
                ? "This keyword overlaps an existing article. Publishing will ask you to confirm."
                : "This keyword is close to an existing article."}
            </p>
            <ul className="space-y-1">
              {state.cannibalization.map((match, index) => (
                <li key={`${match.where}-${match.slug || match.title}-${index}`}>
                  {match.title} · {match.status} · {match.where} — {match.message}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="compose-type">Article type</Label>
          <Select
            value={state.articleType}
            onValueChange={(value) =>
              dispatch({ type: "patch", patch: { articleType: value } })
            }
            disabled={locked}
          >
            <SelectTrigger id="compose-type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {ARTICLE_TYPES.map((type) => (
                <SelectItem key={type.value} value={type.value}>
                  {type.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {showWordCount && (
          <div className="space-y-1.5">
            <Label htmlFor="compose-words">Word count</Label>
            <Input
              id="compose-words"
              type="number"
              min={600}
              max={4000}
              value={state.wordCount}
              onChange={(event) =>
                dispatch({
                  type: "patch",
                  patch: { wordCount: event.target.value },
                })
              }
              disabled={locked}
            />
            <FieldError message={errors.wordCount} />
          </div>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="compose-cta">CTA angle</Label>
        <Textarea
          id="compose-cta"
          value={state.ctaAngle}
          onChange={(event) =>
            dispatch({ type: "patch", patch: { ctaAngle: event.target.value } })
          }
          placeholder="Optional. How the article should earn the call to action."
          rows={3}
          disabled={locked}
        />
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="compose-brands">Allowed brands</Label>
        <Input
          id="compose-brands"
          value={state.allowedBrandsText}
          onChange={(event) =>
            dispatch({
              type: "patch",
              patch: { allowedBrandsText: event.target.value },
            })
          }
          placeholder="Optional. Comma-separated brand names."
          disabled={locked}
        />
        {brands.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {brands.map((brand) => (
              <Badge key={brand} variant="secondary" className="font-normal">
                {brand}
              </Badge>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
