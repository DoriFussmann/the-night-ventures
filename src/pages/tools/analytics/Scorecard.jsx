import React from "react";
import { Tile } from "./parts";
import { fmtNum, fmtPct, fmtPosition, fmtDay } from "./format";

function through(block) {
  return block?.window?.current?.to ? `through ${fmtDay(block.window.current.to)}` : "Not connected";
}

export default function Scorecard({ summary }) {
  const { gsc, bing, traffic, bots } = summary;
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
      <Tile
        label="Google clicks"
        value={gsc ? fmtNum(gsc.current.clicks) : null}
        delta={gsc?.change.clicks}
        sub={through(gsc)}
      />
      <Tile
        label="Impressions"
        value={gsc ? fmtNum(gsc.current.impressions) : null}
        delta={gsc?.change.impressions}
        sub="Google"
      />
      <Tile label="CTR" value={gsc ? fmtPct(gsc.current.ctr) : null} delta={gsc?.change.ctr} sub="Google" />
      <Tile
        label="Avg position"
        value={gsc ? fmtPosition(gsc.current.position) : null}
        delta={gsc?.change.position}
        invert
        absolute
        sub="Google · lower is better"
      />
      <Tile
        label="Bing clicks"
        value={bing ? fmtNum(bing.current.clicks) : null}
        delta={bing?.change.clicks}
        sub={through(bing)}
      />
      <Tile
        label="Sessions"
        value={traffic ? fmtNum(traffic.current.sessions) : null}
        delta={traffic?.change.sessions}
        sub={traffic ? `GA4 ${through(traffic)}` : "GA4 not connected"}
      />
      <Tile
        label="AI-assistant visits"
        value={traffic ? fmtNum(traffic.current.aiSessions) : null}
        delta={traffic?.change.aiSessions}
        sub={
          traffic && traffic.current.sessions > 0
            ? `${fmtPct(traffic.current.aiSessions / traffic.current.sessions)} of sessions`
            : "ChatGPT, Perplexity, Gemini…"
        }
      />
      <Tile
        label="AI crawler hits"
        value={bots.installed ? fmtNum(bots.current.aiHits) : null}
        delta={bots.installed ? bots.change.aiHits : null}
        sub={bots.installed ? "incl. today" : "Tracking not installed"}
      />
    </div>
  );
}
