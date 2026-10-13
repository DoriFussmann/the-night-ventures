import React, { useState } from "react";
import { DataTable, PageLink, Segmented } from "./parts";
import { fmtNum, fmtPosition, shortUrl } from "./format";

const VIEWS = [
  { value: "top", label: "Top pages" },
  { value: "gainers", label: "Winning" },
  { value: "losers", label: "Losing" },
  { value: "queries", label: "Top queries" },
];

function signed(n) {
  if (!n) return "0";
  return `${n > 0 ? "+" : "−"}${fmtNum(Math.abs(n))}`;
}

const pageColumns = [
  { key: "page", label: "Page", render: (r) => <PageLink url={r.page}>{shortUrl(r.page)}</PageLink> },
  { key: "clicks", label: "Clicks", align: "right", render: (r) => fmtNum(r.clicks) },
  {
    key: "delta",
    label: "Δ clicks",
    align: "right",
    render: (r) => (
      <span className={r.delta > 0 ? "text-emerald-700 dark:text-emerald-300" : r.delta < 0 ? "text-destructive" : ""}>
        {signed(r.delta)}
      </span>
    ),
  },
  { key: "impressions", label: "Impr.", align: "right", render: (r) => fmtNum(r.impressions) },
  { key: "position", label: "Pos.", align: "right", render: (r) => fmtPosition(r.position) },
];

const queryColumns = [
  { key: "query", label: "Query", className: "break-words" },
  { key: "clicks", label: "Clicks", align: "right", render: (r) => fmtNum(r.clicks) },
  { key: "impressions", label: "Impr.", align: "right", render: (r) => fmtNum(r.impressions) },
  { key: "position", label: "Pos.", align: "right", render: (r) => fmtPosition(r.position) },
];

export default function PagesSection({ pages }) {
  const sources = [
    pages?.gsc ? { value: "gsc", label: "Google" } : null,
    pages?.bing ? { value: "bing", label: "Bing" } : null,
  ].filter(Boolean);
  const [source, setSource] = useState(sources[0]?.value || "gsc");
  const [view, setView] = useState("top");

  if (!sources.length) {
    return (
      <p className="text-sm text-muted-foreground">
        Connect Search Console or Bing Webmaster (see Setup below) to see your winning and losing pages.
      </p>
    );
  }
  const data = pages[source] || pages[sources[0].value];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {sources.length > 1 ? (
          <Segmented label="Search engine" value={source} onChange={setSource} options={sources} />
        ) : null}
        <Segmented label="View" value={view} onChange={setView} options={VIEWS} />
      </div>
      {source === "bing" ? (
        <p className="text-[11px] text-muted-foreground">Bing reports pages and queries in weekly buckets.</p>
      ) : null}
      {view === "queries" ? (
        <DataTable rowKey={(r) => r.query} rows={data.queries} columns={queryColumns} />
      ) : (
        <DataTable rowKey={(r) => r.page} rows={data[view]} columns={pageColumns} />
      )}
    </div>
  );
}
