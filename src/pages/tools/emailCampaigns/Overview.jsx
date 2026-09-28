import React, { useState } from "react";
import { Loader2, Pause, Play, Square } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { smartlead } from "./smartleadApi";
import { ErrorLine, Stat, fmtDate, num, statusBadgeClass } from "./ui";

// Campaign identity + status controls. Campaign ID is read-only here — it's
// set in Company Intelligence.
export default function Overview({ companyId, overview, onChanged }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [confirmStop, setConfirmStop] = useState(false);

  const c = Array.isArray(overview.campaign) ? overview.campaign[0] : overview.campaign || {};
  const status = String(c.status || "").toUpperCase();
  const leadStats = overview.analytics?.campaign_lead_stats || {};
  const isLive = status === "ACTIVE" || status === "START";
  const isFinal = status === "STOPPED" || status === "COMPLETED";

  const setStatus = async (next) => {
    setBusy(next);
    setErr("");
    try {
      await smartlead("status", companyId, { status: next });
      await onChanged();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
      setConfirmStop(false);
    }
  };

  return (
    <section className="rounded-lg border border-border bg-card px-5 py-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-semibold">{c.name || "(unnamed campaign)"}</h2>
            {status && <Badge className={statusBadgeClass(status)}>{status}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            SmartLead · Campaign ID <span className="font-mono">{overview.campaignId}</span> ·
            created {fmtDate(c.created_at)} · change the ID in Company Intelligence
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {isLive && (
            <Button size="sm" variant="outline" onClick={() => setStatus("PAUSED")} disabled={!!busy}>
              {busy === "PAUSED" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Pause className="mr-1.5 h-4 w-4" />}
              Pause
            </Button>
          )}
          {!isLive && !isFinal && (
            <Button size="sm" onClick={() => setStatus("START")} disabled={!!busy}>
              {busy === "START" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Play className="mr-1.5 h-4 w-4" />}
              {status === "PAUSED" ? "Resume" : "Start"}
            </Button>
          )}
          {!isFinal && (
            <Button size="sm" variant="outline" className="text-destructive" onClick={() => setConfirmStop(true)} disabled={!!busy}>
              <Square className="mr-1.5 h-4 w-4" /> Stop
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Leads in campaign" value={overview.leadCount.toLocaleString()} />
        <Stat label="Not started" value={num(leadStats.notStarted).toLocaleString()} sub="queued" />
        <Stat label="In progress" value={num(leadStats.inprogress).toLocaleString()} />
        <Stat label="Completed" value={num(leadStats.completed).toLocaleString()} />
        <Stat label="Blocked" value={num(leadStats.blocked).toLocaleString()} tone={num(leadStats.blocked) ? "bad" : undefined} />
      </div>

      <ErrorLine>{err}</ErrorLine>

      <AlertDialog open={confirmStop} onOpenChange={setConfirmStop}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Stop this campaign permanently?</AlertDialogTitle>
            <AlertDialogDescription>
              SmartLead can't restart a stopped campaign. To stop sending temporarily, use Pause.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                setStatus("STOPPED");
              }}
            >
              {busy === "STOPPED" ? "Stopping…" : "Stop permanently"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
