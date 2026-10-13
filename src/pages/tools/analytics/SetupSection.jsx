import React, { useEffect, useMemo, useState } from "react";
import { Check, Copy, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pill } from "./parts";
import { fmtDate } from "./format";
import { buildBotMiddleware } from "./botSnippet";

function CopyButton({ text, label = "Copy" }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  async function onCopy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setFailed(false);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setFailed(true);
    }
  }
  return (
    <Button type="button" size="sm" variant="outline" className="h-7 px-2 text-xs" onClick={onCopy}>
      {copied ? <Check className="mr-1 h-3.5 w-3.5" /> : <Copy className="mr-1 h-3.5 w-3.5" />}
      {failed ? "Copy failed" : copied ? "Copied" : label}
    </Button>
  );
}

function StatusRow({ name, state, detail, sub }) {
  const tone = state === "ok" ? "good" : state === "error" ? "bad" : "warn";
  const label = state === "ok" ? "Connected" : state === "error" ? "Error" : "Not set up";
  return (
    <li className="flex flex-wrap items-start gap-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-xs font-medium">{name}</p>
        {detail ? <p className="break-words text-[11px] text-muted-foreground">{detail}</p> : null}
        {sub ? <p className="break-words text-[11px] text-muted-foreground">{sub}</p> : null}
      </div>
      <Pill tone={tone}>{label}</Pill>
    </li>
  );
}

function sourceState(configured, status) {
  if (!configured) return "missing";
  if (!status) return "missing";
  return status.ok ? "ok" : "error";
}

export default function SetupSection({ setup, domain, botsInstalled, onSaveOverrides, saving }) {
  const [form, setForm] = useState(setup.overrides);
  useEffect(() => setForm(setup.overrides), [setup.overrides]);
  const dirty =
    form.gsc !== setup.overrides.gsc || form.ga4 !== setup.overrides.ga4 || form.bing !== setup.overrides.bing;
  const snippet = useMemo(() => buildBotMiddleware(window.location.origin), []);
  const s = setup.status || {};
  const email = setup.serviceAccountEmail;

  return (
    <div className="space-y-6">
      <ul className="divide-y divide-border rounded-md border border-border">
        <StatusRow
          name="Google Search Console"
          state={sourceState(setup.googleConfigured, s.gsc)}
          detail={
            setup.googleConfigured
              ? s.gsc?.message || `Add ${email} as a user on this site's Search Console property, then Refresh.`
              : "Set GOOGLE_SERVICE_ACCOUNT_JSON in Vercel."
          }
          sub={setup.gscProperty ? `Property: ${setup.gscProperty}` : null}
        />
        <StatusRow
          name="Google Analytics 4"
          state={sourceState(setup.googleConfigured, s.ga4)}
          detail={
            setup.googleConfigured
              ? s.ga4?.message || `Add ${email} as a Viewer on this site's GA4 property, then Refresh.`
              : "Set GOOGLE_SERVICE_ACCOUNT_JSON in Vercel."
          }
          sub={setup.ga4Property ? `Property: ${setup.ga4Property}` : null}
        />
        <StatusRow
          name="Bing Webmaster Tools"
          state={sourceState(setup.bingConfigured, s.bing)}
          detail={setup.bingConfigured ? s.bing?.message || "Refresh to connect." : "Set BING_WEBMASTER_API_KEY in Vercel."}
          sub={setup.bingSite ? `Site: ${setup.bingSite}` : null}
        />
        <StatusRow
          name="AI visibility checks (DataForSEO)"
          state={sourceState(setup.dataforseoConfigured, s.ai)}
          detail={
            setup.dataforseoConfigured
              ? s.ai?.message || "Runs weekly on your core keywords."
              : "Set DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD in Vercel."
          }
          sub={setup.aiCheckedAt ? `Last run ${fmtDate(setup.aiCheckedAt)}` : null}
        />
        <StatusRow
          name="AI crawler tracking"
          state={botsInstalled ? "ok" : "missing"}
          detail={botsInstalled ? "Receiving hits from the site." : "Install the snippet below on the site."}
        />
        <StatusRow
          name="Daily automatic refresh"
          state={setup.cronConfigured ? "ok" : "missing"}
          detail={
            setup.cronConfigured
              ? `Runs once a day. Last refresh ${fmtDate(setup.syncedAt)}.`
              : "Set CRON_SECRET in Vercel to enable the daily refresh."
          }
        />
      </ul>

      <form
        className="space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          if (dirty && !saving) onSaveOverrides(form);
        }}
      >
        <div>
          <p className="text-xs font-semibold">Property overrides</p>
          <p className="text-[11px] text-muted-foreground">
            Leave empty to auto-detect from the company domain ({domain || "not set"}).
          </p>
        </div>
        <div className="grid gap-3 md:grid-cols-3">
          <div className="space-y-1">
            <Label htmlFor="ov-gsc" className="text-xs">
              Search Console property
            </Label>
            <Input
              id="ov-gsc"
              value={form.gsc}
              placeholder="sc-domain:example.com"
              onChange={(e) => setForm((f) => ({ ...f, gsc: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ov-ga4" className="text-xs">
              GA4 property ID
            </Label>
            <Input
              id="ov-ga4"
              value={form.ga4}
              placeholder="123456789"
              inputMode="numeric"
              onChange={(e) => setForm((f) => ({ ...f, ga4: e.target.value }))}
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="ov-bing" className="text-xs">
              Bing site URL
            </Label>
            <Input
              id="ov-bing"
              value={form.bing}
              placeholder="https://www.example.com/"
              onChange={(e) => setForm((f) => ({ ...f, bing: e.target.value }))}
            />
          </div>
        </div>
        <Button type="submit" size="sm" disabled={!dirty || saving}>
          {saving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          Save overrides
        </Button>
      </form>

      <div className="space-y-2">
        <div>
          <p className="text-xs font-semibold">AI crawler tracking snippet</p>
          <p className="text-[11px] text-muted-foreground">
            In the site&apos;s repo: save this as <code>middleware.js</code> at the root, add env var{" "}
            <code>TNV_BOT_TOKEN</code> on its Vercel project, then deploy. Only crawler requests are reported; visitors
            are not affected.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <code className="max-w-full truncate rounded bg-muted px-2 py-1 text-[11px]">TNV_BOT_TOKEN={setup.botToken}</code>
          <CopyButton text={setup.botToken} label="Copy token" />
          <CopyButton text={snippet} label="Copy middleware.js" />
        </div>
        <pre className="max-h-64 overflow-auto rounded-md border border-border bg-muted/40 p-3 text-[11px] leading-relaxed">
          {snippet}
        </pre>
      </div>
    </div>
  );
}
