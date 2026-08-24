import React, { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";

export default function ConfirmGate({
  seconds = 10,
  onConfirm,
  onDecline,
  confirmLabel = "Confirm",
  declineLabel = "Decline",
  disabled = false,
}) {
  const [remaining, setRemaining] = useState(seconds);
  const settledRef = useRef(false);
  const onConfirmRef = useRef(onConfirm);
  const onDeclineRef = useRef(onDecline);

  onConfirmRef.current = onConfirm;
  onDeclineRef.current = onDecline;

  const settle = (kind) => {
    if (settledRef.current || disabled) return;
    settledRef.current = true;
    if (kind === "confirm") onConfirmRef.current?.();
    else onDeclineRef.current?.();
  };

  useEffect(() => {
    if (disabled) return undefined;
    const id = window.setInterval(() => {
      setRemaining((n) => {
        if (n <= 1) {
          window.clearInterval(id);
          return 0;
        }
        return n - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [disabled]);

  useEffect(() => {
    if (!disabled && remaining <= 0) settle("confirm");
  }, [remaining, disabled]);

  const pct =
    seconds > 0 ? Math.round(((seconds - remaining) / seconds) * 100) : 100;

  return (
    <div className="rounded-lg border border-border bg-card px-4 py-4 space-y-3">
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm font-medium text-foreground">
          Countdown to Confirm
        </p>
        <p className="text-sm tabular-nums text-muted-foreground">
          {remaining}s
        </p>
      </div>
      <Progress value={pct} className="h-1.5" />
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled}
          onClick={() => settle("confirm")}
        >
          {confirmLabel}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={disabled}
          onClick={() => settle("decline")}
        >
          {declineLabel}
        </Button>
      </div>
    </div>
  );
}
