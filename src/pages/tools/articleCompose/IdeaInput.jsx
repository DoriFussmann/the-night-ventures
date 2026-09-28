import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  IDEA_TEXT_MAX,
  KEY_POINT_LIMIT,
  KEY_POINT_MAX,
  ideaInputErrors,
} from "./composeState";

function FieldError({ message }) {
  if (!message) return null;
  return <p className="text-xs text-destructive">{message}</p>;
}

export default function IdeaInput({ state, dispatch, disabled = false }) {
  const errors = ideaInputErrors(state);
  const points = Array.isArray(state.keyPoints) ? state.keyPoints : [""];
  const locked = Boolean(disabled);

  function setPoint(index, value) {
    const next = points.map((point, pointIndex) =>
      pointIndex === index ? value : point
    );
    dispatch({ type: "patch", patch: { keyPoints: next } });
  }

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="compose-idea">What do you want to say</Label>
          <span className="text-xs text-muted-foreground tabular-nums">
            {String(state.ideaText || "").length.toLocaleString()} /{" "}
            {IDEA_TEXT_MAX.toLocaleString()}
          </span>
        </div>
        <Textarea
          id="compose-idea"
          value={state.ideaText}
          maxLength={IDEA_TEXT_MAX}
          rows={8}
          disabled={locked}
          onChange={(event) =>
            dispatch({
              type: "patch",
              patch: { ideaText: event.target.value },
            })
          }
          placeholder="The point of the article, in your own words."
        />
        <FieldError message={errors.ideaText} />
      </div>

      <div className="space-y-2">
        <Label>Key points to emphasize</Label>
        {points.map((point, index) => (
          <div key={index} className="flex gap-2">
            <Input
              value={point}
              maxLength={KEY_POINT_MAX}
              disabled={locked}
              aria-label={`Key point ${index + 1}`}
              onChange={(event) => setPoint(index, event.target.value)}
              placeholder="One point the article should make"
            />
            <Button
              type="button"
              variant="outline"
              disabled={locked || points.length <= 1}
              onClick={() =>
                dispatch({
                  type: "patch",
                  patch: {
                    keyPoints: points.filter((_, pointIndex) => pointIndex !== index),
                  },
                })
              }
            >
              Remove
            </Button>
          </div>
        ))}
        <FieldError message={errors.keyPoints} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={locked || points.length >= KEY_POINT_LIMIT}
          onClick={() =>
            dispatch({
              type: "patch",
              patch: { keyPoints: [...points, ""] },
            })
          }
        >
          Add key point
        </Button>
      </div>
    </div>
  );
}
