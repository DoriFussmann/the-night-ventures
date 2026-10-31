import React, { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Section, Loading, ErrorLine } from "../emailCampaigns/ui";
import { instantly } from "../emailCampaigns/instantlyApi";

const fmt = (v) => (v == null ? "—" : Number(v).toLocaleString());

// Everything between Audience Build and a sent email: the Instantly campaign,
// its one step, the copy, healthy mailboxes, tracking webhooks, active status.
// Each failing row has its fix right there.
export default function Connection({ companyId, connection, capacity, onChanged, onReload }) {
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");

  const run = async (key, fn) => {
    setBusy(key);
    setErr("");
    try {
      await fn();
      await onReload();
      await onChanged?.();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy("");
    }
  };

  const checks = connection?.checks || [];
  const failing = checks.filter((c) => !c.ok);
  const done = Boolean(connection?.ok);
  const live = connection?.capacity;
  const capacityDiffers = live?.inboxes > 0 && capacity && live.perDay !== capacity.need;

  const fix = (c) => {
    switch (c.fix) {
      case "company-data":
        return (
          <Link className="text-xs underline" to={`/company/${companyId}/company-data`}>
            Choose it in Company Intelligence → Email Campaigns
          </Link>
        );
      case "copy":
        return (
          <Link className="text-xs underline" to={`/company/${companyId}/email-campaigns`}>
            Write it in Email Campaigns → Email copy
          </Link>
        );
      case "webhooks":
        return (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => run("hooks", () => instantly("webhook-register", companyId))}>
            {busy === "hooks" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Connect tracking
          </Button>
        );
      case "activate":
        return (
          <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!!busy || failing.some((f) => ["single_step", "copy"].includes(f.id))} onClick={() => run("activate", () => instantly("status", companyId, { status: "activate" }))}>
            {busy === "activate" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
            Activate in Instantly
          </Button>
        );
      case "vercel":
        return <span className="text-xs text-muted-foreground">Vercel → Settings → Environment Variables, then redeploy</span>;
      case "instantly":
        return <span className="text-xs text-muted-foreground">Fix in Instantly → Email Accounts</span>;
      default:
        return null;
    }
  };

  const summary = !connection
    ? "Checking…"
    : done
      ? `${connection.campaign?.name} · active · ${live?.inboxes} healthy inbox${live?.inboxes === 1 ? "" : "es"}, ${fmt(live?.perDay)}/day · tracking on`
      : `${failing.length} to fix: ${failing.map((c) => c.label.toLowerCase()).join(", ")}`;

  return (
    <Section
      key={`conn-${done}`}
      title="Instantly connection"
      description="The campaign that sends the email. Pushing needs the campaign, one step and synced copy; the rest keeps sending healthy and tracked."
      summary={summary}
      collapsible
      defaultOpen={!done}
      done={done}
      actions={
        <Button size="sm" variant="outline" onClick={() => run("reload", async () => {})} disabled={!!busy}>
          <RefreshCw className="mr-1.5 h-4 w-4" /> Re-check
        </Button>
      }
    >
      {!connection ? (
        <Loading label="Checking Instantly…" />
      ) : (
        <div className="space-y-4">
          <ul className="divide-y divide-border rounded-md border border-border">
            {checks.map((c) => (
              <li key={c.id} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-3 py-2">
                {c.ok ? (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                ) : (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm">{c.label}</p>
                  {c.detail && <p className={`text-xs ${c.ok ? "text-muted-foreground" : "text-amber-700"}`}>{c.detail}</p>}
                </div>
                {!c.ok && fix(c)}
              </li>
            ))}
          </ul>

          {live && live.totalInboxes > 0 && (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <span>
                Instantly can send <span className="font-medium tabular-nums">{fmt(live.perDay)}</span>/day: {live.inboxes}
                {live.totalInboxes !== live.inboxes ? ` of ${live.totalInboxes}` : ""} healthy inbox{live.inboxes === 1 ? "" : "es"} ·{" "}
                {fmt(live.accountTotal)} account limit
                {live.campaignCap ? ` · campaign limit ${fmt(live.campaignCap)}` : ""}.
              </span>
              {capacityDiffers && (
                <>
                  <span className="text-amber-700">Audience Build plans for {fmt(capacity.need)}/day.</span>
                  <Button size="sm" variant="outline" className="h-7 px-2 text-xs" disabled={!!busy} onClick={() => run("cap", () => instantly("sync-capacity", companyId))}>
                    {busy === "cap" ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}
                    Use Instantly&apos;s numbers ({live.inboxes} × {live.perInbox})
                  </Button>
                </>
              )}
            </div>
          )}
          <ErrorLine>{err}</ErrorLine>
        </div>
      )}
    </Section>
  );
}
