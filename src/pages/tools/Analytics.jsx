import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorLine, Loading, Section } from "./emailCampaigns/ui";
import { getAnalyticsSummary, refreshAnalytics, saveAnalyticsSettings } from "./analytics/api";
import { fmtDate } from "./analytics/format";
import { Segmented } from "./analytics/parts";
import Scorecard from "./analytics/Scorecard";
import TrendCharts from "./analytics/TrendCharts";
import SourcesSection from "./analytics/SourcesSection";
import PagesSection from "./analytics/PagesSection";
import AiSection from "./analytics/AiSection";
import OpportunitiesSection from "./analytics/OpportunitiesSection";
import SetupSection from "./analytics/SetupSection";

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 28, label: "28 days" },
  { value: 90, label: "90 days" },
];

function needsSetup(summary) {
  const s = summary?.setup;
  if (!s) return false;
  return !s.status?.gsc?.ok || !s.status?.ga4?.ok || !summary.bots?.installed;
}

export default function Analytics() {
  const { companyId } = useParams();
  const [days, setDays] = useState(28);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(""); // "" | "refresh" | "ai" | "save"
  const [actionError, setActionError] = useState("");
  const [notice, setNotice] = useState("");
  const requestId = useRef(0);

  const load = useCallback(async () => {
    if (!companyId) return;
    const id = ++requestId.current;
    setLoading(true);
    setError("");
    try {
      const data = await getAnalyticsSummary(companyId, days);
      if (id === requestId.current) setSummary(data);
    } catch (err) {
      if (id === requestId.current) setError(err?.message || "Failed to load analytics");
    } finally {
      if (id === requestId.current) setLoading(false);
    }
  }, [companyId, days]);

  useEffect(() => {
    load();
  }, [load]);

  async function runAction(kind, fn, successMessage) {
    setBusy(kind);
    setActionError("");
    setNotice("");
    try {
      await fn();
      setNotice(successMessage);
      await load();
    } catch (err) {
      setActionError(err?.message || "Something went wrong");
    } finally {
      setBusy("");
    }
  }

  const onRefresh = () =>
    runAction("refresh", () => refreshAnalytics(companyId), "Data refreshed.");
  const onCheckAi = () =>
    runAction("ai", () => refreshAnalytics(companyId, { ai: true }), "AI visibility checked.");
  const onSaveOverrides = (overrides) =>
    runAction("save", () => saveAnalyticsSettings(companyId, overrides), "Saved — click Refresh to pull with the new settings.");

  return (
    <div className="space-y-6 pb-16">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold tracking-tight">Analytics</h1>
          <p className="text-sm text-muted-foreground">
            Traffic, sources, winning pages and AI visibility — refreshed daily
            {summary?.setup?.syncedAt ? ` · last refresh ${fmtDate(summary.setup.syncedAt)}` : ""}.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Segmented label="Date range" value={days} onChange={setDays} options={RANGES} />
          <Button type="button" size="sm" variant="outline" onClick={onRefresh} disabled={Boolean(busy) || !summary}>
            {busy === "refresh" ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            )}
            {busy === "refresh" ? "Refreshing…" : "Refresh"}
          </Button>
        </div>
      </header>

      {busy === "refresh" || busy === "ai" ? (
        <p className="text-xs text-muted-foreground">This can take a minute or two on the first run.</p>
      ) : null}
      {actionError ? <ErrorLine>{actionError}</ErrorLine> : null}
      {notice ? <p className="text-xs text-emerald-700 dark:text-emerald-300">{notice}</p> : null}

      {loading && !summary ? (
        <Loading />
      ) : error && !summary ? (
        <ErrorLine>{error}</ErrorLine>
      ) : summary ? (
        <>
          {error ? <ErrorLine>{error}</ErrorLine> : null}
          {!summary.domain ? (
            <ErrorLine>No domain set for this company — add it in Company Intelligence.</ErrorLine>
          ) : null}
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
            <div className="space-y-6">
              <Scorecard summary={summary} />

              <Section title="Trend" description="Each source is shown through its latest complete day.">
                <TrendCharts summary={summary} />
              </Section>

              <Section title="Sources" description="Where visitors come from (GA4).">
                <SourcesSection traffic={summary.traffic} />
              </Section>

              <Section title="Pages" description="Top, winning and losing pages vs the previous period.">
                <PagesSection key={`${companyId}-${days}`} pages={summary.pages} />
              </Section>

              <Section title="AI visibility" description="AI-assistant traffic, AI Overview citations, mentions and AI crawlers.">
                <AiSection summary={summary} onCheckAi={onCheckAi} checkingAi={busy === "ai"} />
              </Section>

              <Section title="Opportunities" description="What to do next to win more traffic — each opens the right tool.">
                <OpportunitiesSection
                  key={`${companyId}-${days}`}
                  companyId={companyId}
                  opportunities={summary.opportunities}
                />
              </Section>

              <Section
                title="Setup"
                description="Connections, property overrides and AI crawler tracking."
                collapsible
                defaultOpen={needsSetup(summary)}
              >
                <SetupSection
                  setup={summary.setup}
                  domain={summary.domain}
                  botsInstalled={summary.bots.installed}
                  onSaveOverrides={onSaveOverrides}
                  saving={busy === "save"}
                />
              </Section>
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}
