// Key metrics per data source, shared by the page and the downloadable report.

/** Metrics shown per category: [metrics key, label]. */
export const METRIC_LABELS = {
  crawl: [
    ['pagesCrawled', 'Pages crawled'],
    ['indexablePages', 'Indexable pages'],
    ['nonIndexablePages', 'Non-indexable'],
    ['sitemapUrlCount', 'Sitemap URLs'],
    ['maxClickDepth', 'Max click depth'],
    ['onpageScore', 'DataForSEO on-page score'],
  ],
  schema: [
    ['pagesChecked', 'Pages checked'],
    ['pagesWithJsonLd', 'Pages with JSON-LD'],
    ['articlePages', 'Article pages'],
    ['articlesWithSchema', 'Articles with Article schema'],
  ],
  clusters: [
    ['clusterCount', 'Clusters'],
    ['pillarsPublished', 'Pillars published'],
    ['articleCount', 'Supporting articles'],
    ['pillarLinkCoverage', 'Pillar → article links %'],
    ['backLinkCoverage', 'Article → pillar links %'],
    ['pagesChecked', 'Pages checked'],
  ],
  speed: [
    ['homePerformance', 'Home · mobile perf'],
    ['pillarPerformance', 'Pillar · mobile perf'],
    ['articlePerformance', 'Article · mobile perf'],
    ['fieldLcp', 'Real-user LCP (p75)'],
    ['fieldInp', 'Real-user INP (p75)'],
    ['fieldCls', 'Real-user CLS (p75)'],
  ],
  authority: [
    ['domainAuthority', 'Domain Authority'],
    ['competitorMedianDa', 'Competitor median DA'],
    ['linkingRootDomains', 'Linking root domains'],
    ['competitorMedianRoots', 'Competitor median roots'],
    ['spamScore', 'Spam Score %'],
    ['pageAuthority', 'Home Page Authority'],
  ],
  aeo_readiness: [
    ['aiSearchAllowed', 'AI search bots allowed'],
    ['botsBlockedByServer', 'Bots blocked by server'],
    ['snippetBlockedPages', 'Pages blocking snippets'],
    ['thinHtmlPages', 'Thin-HTML articles'],
    ['answerFirstShare', 'Answer-first articles'],
    ['aiVisits30d', 'AI crawler visits (30d)'],
  ],
  technical: [
    ['pagesChecked', 'Pages checked'],
    ['ttfbMs', 'Median TTFB (ms)'],
    ['compression', 'Compression'],
    ['tlsDaysLeft', 'Certificate days left'],
    ['hreflangPages', 'Pages with hreflang'],
    ['assetsChecked', 'Assets checked'],
  ],
  ai_visibility: [
    ['shareOfVoice', 'Share of voice'],
    ['citedShare', 'Answers citing you'],
    ['enginesNaming', 'Engines naming you'],
    ['brandRecognized', 'Engines that know the brand'],
    ['aioCited', 'AI Overviews citing you'],
    ['aiModeCited', 'AI Mode citing you'],
  ],
}
