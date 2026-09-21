import React, { useMemo } from "react";
import { Check, ExternalLink, X } from "lucide-react";

export function formatElapsed(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds || 0));
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${String(m).padStart(2, "0")}:${String(r).padStart(2, "0")}`;
}

export function liveArticleUrl(domain, slug) {
  const raw = String(domain || "").trim();
  const s = String(slug || "").trim();
  if (!raw || !s) return "";
  let host = raw.replace(/^https?:\/\//i, "").replace(/^www\./i, "");
  host = host.split("/")[0].split("?")[0].split("#")[0].replace(/\.$/, "");
  if (!host) return "";
  return `https://www.${host}/articles/${s}/`;
}

export function topicsFromArticles(articles = []) {
  return (Array.isArray(articles) ? articles : [])
    .map((article) => ({
      title: String(article?.title || "").trim(),
      targetKeyword: String(article?.targetKeyword || "").trim(),
      type: String(article?.type || "").trim(),
    }))
    .filter((topic) => topic.title || topic.targetKeyword);
}

export function articlesFromJobs(jobs = [], planned = []) {
  return (Array.isArray(jobs) ? jobs : []).map((job) => {
    const plannedArticle = planned[job.index] || {};
    return {
      title:
        job.frontmatter?.title ||
        job.title ||
        plannedArticle.title ||
        "(untitled)",
      targetKeyword:
        plannedArticle.targetKeyword ||
        job.frontmatter?.targetKeyword ||
        "",
      type: job.type || plannedArticle.type || "",
      slug: String(job.frontmatter?.slug || "").trim(),
      heroReady: job.image?.status === "done",
      written: job.status === "done" && Boolean(job.markdown),
      error: job.error || job.image?.error || "",
    };
  });
}

export function markArticlesPublished(articles = [], publishResult) {
  const committedSlugs = new Set(
    (Array.isArray(publishResult?.committed) ? publishResult.committed : [])
      .map((item) => String(item?.slug || "").trim())
      .filter(Boolean)
  );
  const merged = Boolean(publishResult?.ok);
  const mergeStrategy = publishResult?.mergeStrategy || "";
  return (Array.isArray(articles) ? articles : []).map((article) => {
    const committed =
      article.written &&
      (committedSlugs.size === 0
        ? merged
        : committedSlugs.has(article.slug) || merged);
    return {
      ...article,
      published: Boolean(committed),
      live: Boolean(committed && merged && mergeStrategy !== "open-pr"),
      pullRequest: Boolean(committed && mergeStrategy === "open-pr"),
    };
  });
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`;
}

function Stat({ value, label }) {
  return (
    <div className="rounded-md border border-current/10 bg-background/40 px-3 py-2">
      <p className="text-lg font-semibold leading-none">{value}</p>
      <p className="mt-1 text-[11px] uppercase tracking-wide opacity-70">
        {label}
      </p>
    </div>
  );
}

function articleStatus(article) {
  if (article.live) return "On site · live after rebuild";
  if (article.pullRequest) return "PR opened — not live yet";
  if (article.published) return "Published to the site";
  if (article.written) return "Written, not published";
  return article.error || "Failed to generate";
}

export default function BatchPublishReport({
  groupNoun = "item",
  batch,
  destination,
  siteDomain,
}) {
  const results = Array.isArray(batch?.results) ? batch.results : [];
  const groupsOk = results.filter((item) => item.ok).length;
  const groupsFailed = results.filter((item) => !item.ok).length;
  const allArticles = results.flatMap((item) =>
    Array.isArray(item.articles) ? item.articles : []
  );
  const topicsChosen = results.reduce((sum, item) => {
    const topics = Array.isArray(item.topics) ? item.topics.length : 0;
    return sum + (topics || (Array.isArray(item.articles) ? item.articles.length : 0));
  }, 0);
  const written = allArticles.filter((article) => article.written).length;
  const published = allArticles.filter((article) => article.published).length;
  const live = allArticles.filter((article) => article.live).length;
  const elapsed = formatElapsed(
    Math.floor(((batch?.finishedAt || Date.now()) - (batch?.startedAt || 0)) / 1000)
  );
  const destLabel =
    destination?.owner && destination?.repo
      ? `${destination.owner}/${destination.repo}`
      : "";
  const ok = groupsFailed === 0 && (groupsOk > 0 || batch?.total === 0);

  const headline = useMemo(() => {
    if (batch?.total === 0) {
      return `Nothing to do — every ${groupNoun} is already done.`;
    }
    if (batch?.stopped) {
      return `Stopped — ${plural(groupsOk, groupNoun, `${groupNoun}s`)} finished, ${plural(groupsFailed, "failed", "failed")}.`;
    }
    if (groupsFailed > 0 && groupsOk > 0) {
      return `Finished with issues — ${plural(groupsOk, groupNoun, `${groupNoun}s`)} published.`;
    }
    if (groupsFailed > 0) {
      return `Finished — none of the ${groupNoun}s published.`;
    }
    return `Finished — ${plural(groupsOk, groupNoun, `${groupNoun}s`)} generated and published.`;
  }, [batch?.stopped, batch?.total, groupNoun, groupsFailed, groupsOk]);

  return (
    <div
      className={`text-sm rounded-lg border px-4 py-4 space-y-4 ${
        ok
          ? "border-emerald-200 bg-emerald-50/80 text-emerald-950"
          : "border-amber-200 bg-amber-50 text-amber-950"
      }`}
    >
      <div className="space-y-1">
        <p className="font-medium">Run summary</p>
        <p className="leading-relaxed">{headline}</p>
        <p className="text-xs opacity-80">
          {elapsed}
          {destLabel ? ` · published to ${destLabel}` : ""}
          {live > 0
            ? " · merged to main; pages go live with the next rebuild"
            : ""}
          {batch?.stopped ? " · stopped before every item finished" : ""}
        </p>
      </div>

      {batch?.total > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
          <Stat value={topicsChosen} label="Topics chosen" />
          <Stat value={written} label="Articles written" />
          <Stat value={published} label="Published to site" />
          <Stat value={live} label="On main / going live" />
          <Stat value={groupsFailed} label={`${groupNoun}s failed`} />
        </div>
      )}

      {results.map((item, index) => {
        const topics = Array.isArray(item.topics) ? item.topics : [];
        const articles = Array.isArray(item.articles) ? item.articles : [];
        return (
          <div
            key={`${item.keyword || groupNoun}-${index}`}
            className="rounded-md border border-current/10 bg-background/30 px-3 py-3 space-y-2"
          >
            <div className="flex items-start gap-2">
              {item.ok ? (
                <Check className="h-4 w-4 mt-0.5 shrink-0 text-emerald-700" />
              ) : (
                <X className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
              )}
              <div className="min-w-0">
                <p className="font-medium break-words">
                  {item.keyword || `(untitled ${groupNoun})`}
                </p>
                {item.parentKeyword ? (
                  <p className="text-xs opacity-80">
                    under {item.parentKeyword}
                  </p>
                ) : null}
                {item.error ? (
                  <p className="text-xs text-destructive break-words">
                    {item.error}
                  </p>
                ) : null}
              </div>
            </div>

            {topics.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1">Topics chosen</p>
                <ul className="text-xs space-y-0.5 opacity-90">
                  {topics.map((topic, topicIndex) => (
                    <li key={`${topic.targetKeyword || topic.title}-${topicIndex}`}>
                      {topic.title || topic.targetKeyword}
                      {topic.targetKeyword && topic.title
                        ? ` · ${topic.targetKeyword}`
                        : ""}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {articles.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-1">Articles</p>
                <ul className="space-y-1.5">
                  {articles.map((article, articleIndex) => {
                    const href = article.live
                      ? liveArticleUrl(siteDomain, article.slug)
                      : "";
                    return (
                      <li
                        key={`${article.slug || article.title}-${articleIndex}`}
                        className="text-xs"
                      >
                        <p className="font-medium break-words">
                          {article.title}
                        </p>
                        <p className="opacity-80">
                          {article.targetKeyword
                            ? `${article.targetKeyword} · `
                            : ""}
                          {articleStatus(article)}
                          {article.heroReady ? " · hero image ready" : ""}
                        </p>
                        {href ? (
                          <a
                            href={href}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 underline underline-offset-2"
                          >
                            {href.replace(/^https?:\/\//, "")}
                            <ExternalLink className="h-3 w-3" />
                          </a>
                        ) : article.slug ? (
                          <p className="opacity-70">/articles/{article.slug}/</p>
                        ) : null}
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
