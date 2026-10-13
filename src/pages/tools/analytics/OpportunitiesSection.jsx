import React, { useState } from "react";
import { Link } from "react-router-dom";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PageLink, Segmented } from "./parts";
import { fmtNum, fmtPosition, shortUrl } from "./format";

const TYPES = [
  { value: "striking", label: "Almost there", hint: "Queries ranking 4–20 with real impressions." },
  { value: "low_ctr", label: "Seen, not clicked", hint: "Top-10 pages whose click rate is under half the usual." },
  { value: "decaying", label: "Decaying", hint: "Pages that lost 30%+ of their clicks." },
  { value: "gap", label: "Content gaps", hint: "Queries you appear for without a page that ranks." },
  { value: "ai_gap", label: "AI gaps", hint: "Google AI Overviews that cite others, not you." },
];

function composeHref(companyId, mode, { query, page }) {
  const qs = new URLSearchParams();
  if (query) qs.set("target", query);
  if (mode === "modify" && page) qs.set("page", page);
  const path = mode === "modify" ? "article-modify" : "article-idea";
  return `/company/${companyId}/${path}${qs.toString() ? `?${qs}` : ""}`;
}

function ActionButtons({ companyId, item }) {
  const small = buttonVariants({ size: "sm", variant: "outline" });
  const primary = buttonVariants({ size: "sm" });
  const articles = item.library ? (
    <Link
      to={`/company/${companyId}/articles?slug=${encodeURIComponent(item.library.slug)}`}
      className={cn(item.action === "meta" ? primary : small, "h-7 px-2 text-xs")}
    >
      Open in Articles
    </Link>
  ) : null;

  if (item.action === "idea") {
    return (
      <Link to={composeHref(companyId, "idea", item)} className={cn(primary, "h-7 px-2 text-xs")}>
        Write article
      </Link>
    );
  }
  return (
    <>
      {item.action === "meta" ? articles : null}
      <Link
        to={composeHref(companyId, "modify", item)}
        className={cn(item.action === "meta" && articles ? small : primary, "h-7 px-2 text-xs")}
      >
        Refresh article
      </Link>
      {item.action !== "meta" ? articles : null}
    </>
  );
}

function Metrics({ m }) {
  const parts = [];
  if (m.impressions != null) parts.push(`${fmtNum(m.impressions)} impr.`);
  if (m.clicks != null) parts.push(`${fmtNum(m.clicks)} clicks`);
  if (m.prevClicks != null) parts.push(`was ${fmtNum(m.prevClicks)}`);
  if (m.position != null) parts.push(`pos. ${fmtPosition(m.position)}`);
  return <span className="tabular-nums">{parts.join(" · ")}</span>;
}

export default function OpportunitiesSection({ companyId, opportunities }) {
  const counts = Object.fromEntries(TYPES.map((t) => [t.value, opportunities?.[t.value]?.length || 0]));
  const first = TYPES.find((t) => counts[t.value] > 0)?.value || "striking";
  const [type, setType] = useState(first);
  const items = opportunities?.[type] || [];
  const meta = TYPES.find((t) => t.value === type);

  return (
    <div className="space-y-3">
      <Segmented
        label="Opportunity type"
        value={type}
        onChange={setType}
        options={TYPES.map((t) => ({ value: t.value, label: `${t.label} (${counts[t.value]})` }))}
      />
      <p className="text-[11px] text-muted-foreground">{meta?.hint}</p>
      {items.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing here for this period.</p>
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((item) => (
            <li
              key={`${item.type}|${item.query || ""}|${item.page || ""}`}
              className="flex flex-wrap items-start gap-3 px-3 py-2.5"
            >
              <div className="min-w-0 flex-1 space-y-0.5">
                {item.query ? <p className="text-sm font-medium break-words">{item.query}</p> : null}
                {item.page ? (
                  <p className="text-xs">
                    <PageLink url={item.page}>{shortUrl(item.page)}</PageLink>
                  </p>
                ) : null}
                <p className="text-xs text-muted-foreground">{item.reason}</p>
                <p className="text-[11px] text-muted-foreground">
                  <Metrics m={item.metrics || {}} />
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <ActionButtons companyId={companyId} item={item} />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
