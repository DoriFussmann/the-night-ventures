import React, { useState } from "react";
import { Loader2, Pause, Play } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CAMPAIGN_STATUS, NOT_SENDING } from "../../../../lib/instantly/mapping.js";
import { instantly } from "./instantlyApi";
import { ErrorLine, Stat, fmtDate } from "./ui";

const STATUS_CLS = {
  1: "bg-emerald-50 text-emerald-700 border-emerald-200",
  2: "bg-orange-50 text-orange-700 border-orange-200",
  3: "bg-slate-100 text-slate-600 border-slate-200",
};

// Campaign identity + pause/resume. The Campaign ID is read-only here — it's
// set in Company Intelligence.
export default function Overview({ companyId, overview, onChanged }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const c = overview.campaign || {};
  const a = overview.analytics || {};
  const status = Number(c.status);
  const isLive = status === 1;
  const canStart = [0, 2, -1, -2].includes(status);

  const setStatus = async (next) => {
    setBusy(next);
    setErr("");
    try {
      await instantly("status", companyId, { status: next });
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  return (
    <section className="space-y-4 rounded-lg border border-border bg-card px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{c.name || "(unnamed campaign)"}</h2>
            <Badge className={STATUS_CLS[status] || "bg-red-50 text-red-700 border-red-200"}>
              {CAMPAIGN_STATUS[status] || `Status ${c.status}`}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Instantly · Campaign ID <span className="font-mono">{overview.campaignId}</span> · created {fmtDate(c.created)}
            {c.dailyLimit ? ` · campaign limit ${c.dailyLimit}/day` : ""} · change the ID in Company Intelligence
          </p>
          {isLive && c.notSending && (
            <p className="text-xs text-amber-700">Not sending right now: {NOT_SENDING[c.notSending] || c.notSending}</p>
          )}
          {c.steps !== 1 && (
            <p className="text-xs text-amber-700">
              The campaign has {c.steps} step{c.steps === 1 ? "" : "s"}. Single touch needs exactly 1 — save the copy
              below to replace them.
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {isLive && (
            <Button size="sm" variant="outline" onClick={() => setStatus("pause")} disabled={!!busy}>
              {busy === "pause" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause className="mr-1.5 h-4 w-4" />}
              Pause
            </Button>
          )}
          {canStart && (
            <Button size="sm" onClick={() => setStatus("activate")} disabled={!!busy || c.steps !== 1} title={c.steps !== 1 ? "Save the email copy first" : undefined}>
              {busy === "activate" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              {status === 2 ? "Resume" : "Activate"}
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Leads in campaign" value={a.leads.toLocaleString()} />
        <Stat label="Contacted" value={a.contacted.toLocaleString()} />
        <Stat label="Completed" value={a.completed.toLocaleString()} />
        <Stat label="Bounced" value={a.bounced.toLocaleString()} tone={a.bounced ? "bad" : undefined} />
        <Stat label="Unsubscribed" value={a.unsubscribed.toLocaleString()} />
      </div>

      <ErrorLine>{err}</ErrorLine>
    </section>
  );
}
