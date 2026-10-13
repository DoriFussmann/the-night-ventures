import React from "react";
import { Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DataTable, Delta, PageLink, Pill } from "./parts";
import { fmtDate, fmtNum, fmtPct, shortUrl } from "./format";

function Sub({ title, description, actions, children }) {
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-xs font-semibold">{title}</h3>
          {description ? <p className="text-[11px] text-muted-foreground">{description}</p> : null}
        </div>
        {actions}
      </div>
      {children}
    </div>
  );
}

function sessionsChange(r) {
  return r.prevSessions > 0 ? (r.sessions - r.prevSessions) / r.prevSessions : null;
}

function YesNo({ value }) {
  if (value == null) return <span className="text-muted-foreground">—</span>;
  return <Pill tone={value ? "good" : "bad"}>{value ? "Yes" : "No"}</Pill>;
}

const PLATFORM_LABEL = { chat_gpt: "ChatGPT answers", google: "Google AI Overviews" };

export default function AiSection({ summary, onCheckAi, checkingAi }) {
  const { traffic, ai, bots, setup } = summary;
  const assistants = traffic?.assistants?.filter((a) => a.sessions > 0 || a.prevSessions > 0) || [];

  return (
    <div className="space-y-8">
      <div className="grid gap-6 lg:grid-cols-2">
        <Sub title="Visits from AI assistants" description="Real people clicking through from an AI answer (GA4).">
          {traffic ? (
            <DataTable
              rowKey={(r) => r.name}
              rows={assistants}
              empty="No AI-assistant visits in this period."
              columns={[
                { key: "name", label: "Assistant" },
                { key: "sessions", label: "Visits", align: "right", render: (r) => fmtNum(r.sessions) },
                {
                  key: "engaged",
                  label: "Engaged",
                  align: "right",
                  render: (r) => (r.sessions > 0 ? fmtPct(r.engaged / r.sessions, 0) : "—"),
                },
                { key: "delta", label: "Δ", align: "right", render: (r) => <Delta value={sessionsChange(r)} /> },
              ]}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Needs GA4 — see Setup.</p>
          )}
        </Sub>
        <Sub title="Pages AI assistants send people to" description="Your pages that AI answers link to.">
          {traffic ? (
            <DataTable
              rowKey={(r) => r.page}
              rows={traffic.aiLanding}
              empty="No AI-assistant landings in this period."
              columns={[
                { key: "page", label: "Landing page", className: "break-all" },
                { key: "sessions", label: "Visits", align: "right", render: (r) => fmtNum(r.sessions) },
                {
                  key: "assistants",
                  label: "From",
                  render: (r) =>
                    Object.entries(r.assistants)
                      .sort((a, b) => b[1] - a[1])
                      .map(([name]) => name)
                      .join(", "),
                },
              ]}
            />
          ) : (
            <p className="text-xs text-muted-foreground">Needs GA4 — see Setup.</p>
          )}
        </Sub>
      </div>

      <Sub
        title="Google AI Overviews — are you cited?"
        description={
          ai.checks.length
            ? `Weekly check of your core keywords (US, desktop). Last run ${fmtDate(setup.aiCheckedAt)}.`
            : summary.keywordCount
              ? "Not checked yet. Runs weekly; you can run it now."
              : "Add core keywords in the Advisor / Company Intelligence first."
        }
        actions={
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={onCheckAi}
            disabled={checkingAi || !setup.dataforseoConfigured || !summary.keywordCount}
            title="Runs paid DataForSEO checks for up to 20 keywords"
          >
            {checkingAi ? (
              <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
            ) : (
              <Sparkles className="mr-1.5 h-3.5 w-3.5" />
            )}
            {checkingAi ? "Checking…" : "Check AI now"}
          </Button>
        }
      >
        <DataTable
          rowKey={(r) => r.keyword}
          rows={ai.checks}
          empty="No AI visibility checks yet."
          columns={[
            { key: "keyword", label: "Keyword", className: "break-words" },
            {
              key: "aio",
              label: "AI Overview",
              render: (r) =>
                r.error ? (
                  <Pill tone="warn">Check failed</Pill>
                ) : (
                  <Pill tone={r.has_ai_overview ? "info" : "muted"}>{r.has_ai_overview ? "Shown" : "None"}</Pill>
                ),
            },
            {
              key: "cited",
              label: "You cited",
              render: (r) =>
                r.error || !r.has_ai_overview ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <span className="inline-flex items-center gap-1">
                    <YesNo value={r.cited} />
                    {r.previouslyCited != null && r.previouslyCited !== r.cited ? (
                      <span className="text-[10px] text-muted-foreground">{r.cited ? "new" : "lost"}</span>
                    ) : null}
                  </span>
                ),
            },
            {
              key: "rank",
              label: "Google rank",
              align: "right",
              render: (r) => (r.organic_position ? `#${r.organic_position}` : <span className="text-muted-foreground">not top 10</span>),
            },
            {
              key: "who",
              label: "Cited instead",
              render: (r) => {
                const rivals = Array.isArray(r.competitors_cited) ? r.competitors_cited : [];
                const others = Array.isArray(r.cited_domains) ? r.cited_domains.slice(0, 3) : [];
                if (!rivals.length && !others.length) return <span className="text-muted-foreground">—</span>;
                return (
                  <span className="break-words">
                    {rivals.length ? <span className="font-medium">{rivals.join(", ")}</span> : null}
                    {rivals.length && others.length ? " · " : null}
                    {others.join(", ")}
                  </span>
                );
              },
            },
          ]}
        />
      </Sub>

      <Sub title="Mentions in AI answers" description="Questions where an AI answer cites your domain (DataForSEO LLM Mentions, US).">
        <div className="grid gap-3 md:grid-cols-2">
          {ai.mentions.map((m) => (
            <div key={m.platform} className="space-y-2 rounded-md border border-border p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="text-xs font-medium">{PLATFORM_LABEL[m.platform]}</p>
                <p className="text-lg font-semibold tabular-nums">
                  {m.error ? "—" : m.totalCount == null ? "—" : fmtNum(m.totalCount)}
                  {m.totalCount != null && m.previousCount != null && m.previousCount > 0 ? (
                    <Delta className="ml-1.5" value={(m.totalCount - m.previousCount) / m.previousCount} />
                  ) : null}
                </p>
              </div>
              {m.error ? <p className="text-[11px] text-destructive">{m.error}</p> : null}
              {m.items.length ? (
                <ul className="space-y-1">
                  {m.items.slice(0, 5).map((item) => (
                    <li key={item.question} className="text-[11px]">
                      <span className="line-clamp-2">{item.question}</span>
                      {item.urls?.[0] ? (
                        <PageLink url={item.urls[0]}>
                          <span className="text-muted-foreground">{shortUrl(item.urls[0])}</span>
                        </PageLink>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-[11px] text-muted-foreground">
                  {m.checkedAt ? "No mentions found yet." : "Not checked yet."}
                </p>
              )}
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Microsoft Copilot citations are only in Bing Webmaster Tools → AI Performance (no API yet).
        </p>
      </Sub>

      <Sub
        title="AI crawlers reading your site"
        description={
          bots.installed
            ? `Server-side hits reported by the site. Last hit ${fmtDate(bots.lastHitAt)}.`
            : "Install the crawler tracking snippet (Setup below) to see GPTBot, ClaudeBot, PerplexityBot and live ChatGPT fetches."
        }
      >
        {bots.installed ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <DataTable
              rowKey={(r) => r.bot}
              rows={bots.byBot}
              columns={[
                { key: "bot", label: "Crawler" },
                { key: "kind", label: "Type", render: (r) => <Pill tone={r.kind === "search" ? "muted" : "info"}>{r.kindLabel}</Pill> },
                { key: "hits", label: "Hits", align: "right", render: (r) => fmtNum(r.hits) },
                { key: "pages", label: "Pages", align: "right", render: (r) => fmtNum(r.pages) },
                {
                  key: "delta",
                  label: "Δ",
                  align: "right",
                  render: (r) => <Delta value={r.prevHits > 0 ? (r.hits - r.prevHits) / r.prevHits : null} />,
                },
              ]}
            />
            <DataTable
              rowKey={(r) => r.path}
              rows={bots.topPaths}
              columns={[
                { key: "path", label: "Most-read path", className: "break-all" },
                { key: "aiHits", label: "AI hits", align: "right", render: (r) => fmtNum(r.aiHits) },
                { key: "hits", label: "All", align: "right", render: (r) => fmtNum(r.hits) },
              ]}
            />
          </div>
        ) : null}
      </Sub>
    </div>
  );
}
