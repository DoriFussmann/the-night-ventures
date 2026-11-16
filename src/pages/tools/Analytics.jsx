import React, { useCallback, useEffect, useRef, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorLine, Loading, Section } from "@/components/SectionBlocks";
import { getAnalyticsSummary, refreshAnalytics, saveAnalyticsSettings } from "./analytics/api";
import { fmtDate } from "./analytics/format";
import { Segmented } from "./analytics/parts";
import Scorecard from "./analytics/Scorecard";
import TrendCharts from "./analytics/TrendCharts";
import SourcesSection from "./analytics/SourcesSection";
import PagesSection from "./analytics/PagesSection";
import AiSection from "./analytics/AiSection";
import AnswersSection from "./analytics/AnswersSection";
import OpportunitiesSection from "./analytics/OpportunitiesSection";
import SetupSection from "./analytics/SetupSection";

const RANGES = [
  { value: 7, label: "7 days" },
  { value: 28, label: "28 days" },
  { value: 90, label: "90 days" },
];

const VIEWS = [
  { value: "search", label: "Search" },
  { value: "ai", label: "AI" },
  { value: "traffic", label: "Traffic" },
];

const VIEW_NOTE = {
  search: "How you show up in Google and Bing, and what to fix next.",
  ai: "How AI answers name and cite you, and the visits and page reads that follow.",
  traffic: "Every visit to the site, by where it came from.",
};

const SEARCH_OPPORTUNITIES = ["striking", "low_ctr", "decaying", "gap"];
const AI_OPPORTUNITIES = ["ai_gap"];

function needsSetup(summary) {
  const s = summary?.setup;
  if (!s) return false;
  return !s.status?.gsc?.ok || !s.status?.ga4?.ok || !summary.bots?.installed;
}

export default function Analytics() {
  const { companyId } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const view = VIEWS.some((v) => v.value === searchParams.get("view")) ? searchParams.get("view") : "search";
  const setView = (next) => {
    const params = new URLSearchParams(searchParams);
    if (next === "search") params.delete("view");
    else params.set("view", next);
    setSearchParams(params, { replace: true });
  };
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
            Search, AI and traffic — refreshed daily
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
            <ErrorLine>No domain set for this company — add it in AEO Playbook → Company.</ErrorLine>
          ) : null}
          <div className={loading ? "pointer-events-none opacity-60 transition-opacity" : "transition-opacity"} aria-busy={loading}>
            <div className="space-y-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <Segmented label="Analytics view" size="lg" value={view} onChange={setView} options={VIEWS} />
                <p className="text-xs text-muted-foreground">{VIEW_NOTE[view]}</p>
              </div>

              <Scorecard summary={summary} view={view} />

              {view === "search" ? (
                <>
                  <Section title="Trends" description="Each source is shown through its latest complete day.">
                    <TrendCharts summary={summary} view="search" />
                  </Section>

                  <Section title="Pages and queries" description="Top, winning and losing pages vs the previous period.">
                    <PagesSection key={`${companyId}-${days}`} pages={summary.pages} />
                  </Section>

                  <Section title="Search opportunities" description="What to do next to win more search traffic — each opens the right tool.">
                    <OpportunitiesSection
                      key={`${companyId}-${days}-search`}
                      companyId={companyId}
                      opportunities={summary.opportunities}
                      types={SEARCH_OPPORTUNITIES}
                    />
                  </Section>
                </>
              ) : null}

              {view === "ai" ? (
                <>
                  <Section
                    title="Named and cited in AI answers"
                    description="How often AI answers mention your brand, and how often they use your pages as a source."
                  >
                    <AnswersSection answers={summary.ai.answers} companyId={companyId} />
                  </Section>

                  <Section title="Trends" description="Real visits and page reads from AI systems.">
                    <TrendCharts summary={summary} view="ai" />
                  </Section>

                  <Section title="Citations, visits and crawlers" description="Which pages AI systems use, who sends visitors, and which crawlers read the site.">
                    <AiSection summary={summary} onCheckAi={onCheckAi} checkingAi={busy === "ai"} />
                  </Section>

                  <Section title="AI gaps" description="Google AI Overviews that cite others, not you.">
                    <OpportunitiesSection
                      key={`${companyId}-${days}-ai`}
                      companyId={companyId}
                      opportunities={summary.opportunities}
                      types={AI_OPPORTUNITIES}
                    />
                  </Section>
                </>
              ) : null}

              {view === "traffic" ? (
                <>
                  <Section title="Trends" description="Shown through the latest complete day in GA4.">
                    <TrendCharts summary={summary} view="traffic" />
                  </Section>

                  <Section title="Sources over time" description="Where visitors come from and how engaged they are (GA4).">
                    <SourcesSection traffic={summary.traffic} granularity={summary.granularity} />
                  </Section>
                </>
              ) : null}

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
