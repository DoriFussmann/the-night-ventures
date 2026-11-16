import React from "react";
import { Tile } from "./parts";
import { fmtNum, fmtPct, fmtPosition, fmtDay } from "./format";

function through(block) {
  return block?.window?.current?.to ? `through ${fmtDay(block.window.current.to)}` : "Not connected";
}

const rel = (current, previous) => (previous > 0 ? (current - previous) / previous : null);

function SearchTiles({ summary }) {
  const { gsc, bing, traffic } = summary;
  const organic = traffic?.groups?.current?.organic;
  const prevOrganic = traffic?.groups?.previous?.organic;
  return (
    <>
      <Tile label="Google clicks" value={gsc ? fmtNum(gsc.current.clicks) : null} delta={gsc?.change.clicks} sub={through(gsc)} />
      <Tile label="Impressions" value={gsc ? fmtNum(gsc.current.impressions) : null} delta={gsc?.change.impressions} sub="Google" />
      <Tile label="CTR" value={gsc ? fmtPct(gsc.current.ctr) : null} delta={gsc?.change.ctr} sub="Google" />
      <Tile
        label="Avg position"
        value={gsc ? fmtPosition(gsc.current.position) : null}
        delta={gsc?.change.position}
        invert
        absolute
        sub="Google · lower is better"
      />
      <Tile label="Bing clicks" value={bing ? fmtNum(bing.current.clicks) : null} delta={bing?.change.clicks} sub={through(bing)} />
      <Tile
        label="Organic search visits"
        value={organic ? fmtNum(organic.sessions) : null}
        delta={organic ? rel(organic.sessions, prevOrganic?.sessions || 0) : null}
        sub={
          !traffic
            ? "GA4 not connected"
            : organic.sessions > 0
              ? `GA4 · ${fmtPct(organic.engaged / organic.sessions, 0)} engaged`
              : "GA4 · all search engines"
        }
      />
    </>
  );
}

function AiTiles({ summary }) {
  const { traffic, bots, ai } = summary;
  const a = ai.answers;
  const shown = ai.checks.filter((c) => !c.error && c.has_ai_overview);
  const overviewCited = shown.filter((c) => c.cited).length;
  const pagesCited = (ai.citations || []).filter((c) => c.evidence.includes("cited")).length;
  const tested = a ? `${a.engine} · ${fmtNum(a.tested)} test prompts` : "Run Prompt Tests";
  return (
    <>
      <Tile
        label="Named in answers"
        value={a ? fmtPct(a.named / a.tested, 0) : null}
        delta={a?.compare ? rel(a.compare.named.now, a.compare.named.before) : null}
        sub={a ? `${fmtNum(a.named)} of ${fmtNum(a.tested)} prompts · ${a.engine}` : tested}
      />
      <Tile
        label="Cited as a source"
        value={a ? fmtPct(a.cited / a.tested, 0) : null}
        delta={a?.compare ? rel(a.compare.cited.now, a.compare.cited.before) : null}
        sub={a ? `${fmtNum(a.cited)} of ${fmtNum(a.tested)} prompts · ${a.engine}` : tested}
      />
      <Tile label="Pages cited" value={fmtNum(pagesCited)} sub="in any AI answer we tested" />
      <Tile
        label="AI Overviews citing you"
        value={ai.checks.length ? `${overviewCited} of ${shown.length}` : null}
        sub={ai.checks.length ? `${ai.checks.length} keywords checked · Google` : "Not checked yet"}
      />
      <Tile
        label="AI-assistant visits"
        value={traffic ? fmtNum(traffic.current.aiSessions) : null}
        delta={traffic?.change.aiSessions}
        sub={
          traffic && traffic.current.sessions > 0
            ? `${fmtPct(traffic.current.aiSessions / traffic.current.sessions)} of visits`
            : "GA4 not connected"
        }
      />
      <Tile
        label="Live reads"
        value={bots.installed ? fmtNum(bots.current.liveReads) : null}
        delta={bots.installed ? bots.change.liveReads : null}
        sub={bots.installed ? "opened to answer someone" : "Tracking not installed"}
      />
      <Tile
        label="AI crawler hits"
        value={bots.installed ? fmtNum(bots.current.aiHits) : null}
        delta={bots.installed ? bots.change.aiHits : null}
        sub={bots.installed ? "all AI crawlers · incl. today" : "Tracking not installed"}
      />
    </>
  );
}

const CHANNELS = [
  ["organic", "Organic search"],
  ["ai", "AI assistants"],
  ["direct", "Direct"],
  ["referral", "Referral"],
  ["social", "Social"],
];

function TrafficTiles({ summary }) {
  const { traffic } = summary;
  const total = traffic?.current.sessions || 0;
  return (
    <>
      <Tile
        label="Visits"
        value={traffic ? fmtNum(traffic.current.sessions) : null}
        delta={traffic?.change.sessions}
        sub={traffic ? `GA4 ${through(traffic)}` : "GA4 not connected"}
      />
      <Tile
        label="Engaged"
        value={traffic ? fmtPct(traffic.current.engagedRate, 0) : null}
        sub={
          traffic?.previous?.engagedRate != null ? `was ${fmtPct(traffic.previous.engagedRate, 0)} before` : "share of visits"
        }
      />
      {CHANNELS.map(([key, label]) => {
        const cur = traffic?.groups?.current?.[key];
        const prev = traffic?.groups?.previous?.[key];
        return (
          <Tile
            key={key}
            label={label}
            value={cur ? fmtNum(cur.sessions) : null}
            delta={cur ? rel(cur.sessions, prev?.sessions || 0) : null}
            sub={cur && total > 0 ? `${fmtPct(cur.sessions / total, 0)} of visits` : "GA4"}
          />
        );
      })}
    </>
  );
}

const GRID = {
  search: "sm:grid-cols-3 xl:grid-cols-6",
  ai: "sm:grid-cols-4 xl:grid-cols-7",
  traffic: "sm:grid-cols-4 xl:grid-cols-7",
};

/** The cards on top; one set per view. */
export default function Scorecard({ summary, view }) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${GRID[view] || GRID.search}`}>
      {view === "ai" ? <AiTiles summary={summary} /> : view === "traffic" ? <TrafficTiles summary={summary} /> : <SearchTiles summary={summary} />}
    </div>
  );
}
