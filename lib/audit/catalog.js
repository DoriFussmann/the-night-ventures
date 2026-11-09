// Audit check catalog: one entry per logical check. Plain data + small predicates,
// shared by the server and the Audit page. No I/O.
//
// Separation of concerns:
//   runner   = the data-collection unit that evaluates the check (audit_runs.category)
//   section  = where the check sits in the SEO & AEO framework (A–L), for reading
//   score    = which readiness score it counts toward (null = shown, never scored)
// A check maps to one or more issue check ids (tiered variants such as *_poor /
// *_needs_improvement). Its result is derived from the latest run of its runner:
// no new data collection is needed to score, and old runs re-score the same way.
//
// kind:
//   confirmed       verified directly (fetched, parsed, measured)
//   risk            inferred / likely problem, lower confidence
//   recommendation  improvement, not a defect (low weight)
//   experimental    emerging practice, shown but never scored (e.g. llms.txt)
//   info            context only, never scored

export const CATALOG_VERSION = 1

export const SCORES = [
  { id: 'crawl_index', label: 'Crawlability & Indexability', short: 'Crawl & Index', weight: 25 },
  { id: 'technical', label: 'Technical SEO', short: 'Technical SEO', weight: 20 },
  { id: 'performance', label: 'Performance', short: 'Performance', weight: 20 },
  { id: 'structured_data', label: 'Structured Data', short: 'Structured Data', weight: 15 },
  { id: 'ai_readiness', label: 'AI Readiness', short: 'AI Readiness', weight: 20 },
]

export const SECTIONS = {
  A: 'Crawling & discoverability',
  B: 'Indexability & search access',
  C: 'On-page technical SEO',
  D: 'Structured data',
  E: 'Performance & Core Web Vitals',
  F: 'JavaScript & rendering',
  G: 'AI crawler access',
  H: 'AI readability',
  I: 'AI search visibility',
  J: 'Infrastructure & security',
  K: 'Mobile & accessibility',
  L: 'International SEO',
  content: 'Content & clusters (outside the technical audit)',
  authority: 'Authority (outside the technical audit)',
}

export const SECTION_ORDER = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'J', 'K', 'L', 'I', 'content', 'authority']

export const KIND_LABELS = {
  confirmed: 'Confirmed',
  risk: 'Potential risk',
  recommendation: 'Recommendation',
  experimental: 'Experimental',
  info: 'Info',
}

export const EFFORT_LABELS = { low: 'Low effort', medium: 'Medium effort', high: 'High effort' }

const warnIncludes = (m, text) => Array.isArray(m?.warnings) && m.warnings.some((w) => String(w).includes(text))

/** @typedef {{ id: string, issueIds: string[], runner: string|null, section: string, score: string|null,
 *   kind: string, severity: string, effort: string, label: string, why: string, verify: string,
 *   fix?: string, since?: string, tested?: (m: any) => true|string, applies?: (m: any) => boolean }} CheckDef */

/** @param {Partial<CheckDef> & { id: string }} def @returns {CheckDef} */
function check(def) {
  return { issueIds: [def.id], kind: 'confirmed', effort: 'low', ...def }
}

/** @type {CheckDef[]} */
export const CHECKS = [
  // ---------------------------------------------------------------- A · crawl
  check({ id: 'page_error_status', issueIds: ['page_error_status', 'sitemap_url_error'], runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'high',
    label: 'Crawled pages return 200', why: 'Pages that return 4xx/5xx cannot be indexed or cited and waste crawl budget.', verify: 'Re-run Crawl; the URLs return 200 or are removed from links and the sitemap.' }),
  check({ id: 'soft_404', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'high',
    label: 'No soft 404s', why: 'Pages that say "not found" with a 200 status confuse search engines and get dropped.', verify: 'Re-run Crawl; the pages return a real 404/410 or real content.' }),
  check({ id: 'redirect_loop', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'high',
    label: 'No redirect loops', why: 'A loop never resolves: crawlers and visitors cannot reach the page.', verify: 'Open the URL; it resolves in one hop.' }),
  check({ id: 'redirect_chain', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'medium',
    label: 'No redirect chains', why: 'Each extra hop costs crawl budget and slows the page.', verify: 'Re-run Crawl; every redirect reaches its target in one hop.' }),
  check({ id: 'broken_internal_link', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'high',
    tested: (m) => (m?.brokenLinksAvailable === false ? 'The crawl provider returned no link data' : true),
    label: 'No broken internal links', why: 'Broken links strand crawlers and leak link equity.', verify: 'Re-run Crawl; no internal link returns 4xx/5xx.' }),
  check({ id: 'internal_link_to_redirect', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'medium',
    label: 'Internal links point at final URLs', why: 'Linking to redirects adds a hop on every crawl.', verify: 'Re-run Crawl; internal links use the final URL.' }),
  check({ id: 'orphan_page', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'medium', kind: 'risk',
    label: 'No orphan pages', why: 'Pages with no internal links are found late or not at all.', verify: 'Re-run Crawl; each page has at least one internal link.' }),
  check({ id: 'deep_page', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'low', kind: 'recommendation',
    label: 'Important pages within 3 clicks', why: 'Deep pages are crawled less often and look less important.', verify: 'Re-run Crawl; click depth ≤ 3.' }),
  check({ id: 'trailing_slash_inconsistent', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'medium',
    label: 'One URL form per page (trailing slash)', why: 'Two URL forms split signals and create duplicates.', verify: 'Both forms resolve to one canonical URL.' }),
  check({ id: 'alternate_host_not_redirected', runner: 'crawl', section: 'A', score: 'crawl_index', severity: 'medium',
    label: 'www / non-www redirect to one host', why: 'Two live hosts create a duplicate of the whole site.', verify: 'The other host 301-redirects to the main one.' }),

  // ---------------------------------------------------------------- J · infrastructure (crawl-based)
  check({ id: 'ssl_invalid', runner: 'crawl', section: 'J', score: 'technical', severity: 'critical',
    label: 'Valid SSL certificate', why: 'Browsers and crawlers refuse or warn on an invalid certificate.', verify: 'The site loads over HTTPS with no certificate warning.' }),
  check({ id: 'http_not_redirected', runner: 'crawl', section: 'J', score: 'technical', severity: 'high',
    label: 'HTTP redirects to HTTPS', why: 'An HTTP copy of the site splits signals and is insecure.', verify: 'http:// 301-redirects to https://.' }),

  // ---------------------------------------------------------------- B · indexability
  check({ id: 'canonical_missing', runner: 'crawl', section: 'B', score: 'crawl_index', severity: 'medium',
    label: 'Indexable pages declare a canonical', why: 'Without a canonical, search engines guess which URL to index.', verify: 'View source; each page has one self-referencing canonical.' }),
  check({ id: 'sitemap_url_non_indexable', runner: 'crawl', section: 'B', score: 'crawl_index', severity: 'high',
    label: 'Sitemap lists only indexable URLs', why: 'Non-indexable URLs in the sitemap send mixed signals and waste crawls.', verify: 'Re-run Crawl; every sitemap URL is indexable.' }),
  check({ id: 'sitemap_url_canonicalized', runner: 'crawl', section: 'B', score: 'crawl_index', severity: 'high',
    label: 'Sitemap URLs are their own canonical', why: 'Listing URLs that canonicalize elsewhere contradicts the sitemap.', verify: 'Re-run Crawl; sitemap URLs are self-canonical.' }),
  check({ id: 'not_in_sitemap', runner: 'crawl', section: 'B', score: 'crawl_index', severity: 'low', kind: 'recommendation',
    label: 'Indexable pages are in the sitemap', why: 'The sitemap is how new and updated pages are discovered quickly.', verify: 'Re-run Crawl; indexable pages appear in the sitemap.' }),
  check({ id: 'search_engine_blocked_robots', runner: 'aeo_readiness', section: 'B', score: 'crawl_index', severity: 'critical',
    label: 'robots.txt allows Googlebot and Bingbot', why: 'Blocking search engines removes the site from search and from AI answers built on search.', verify: 'robots.txt has no Disallow: / for Googlebot or Bingbot.' }),
  check({ id: 'page_blocks_snippets', runner: 'aeo_readiness', section: 'B', score: 'ai_readiness', severity: 'high',
    label: 'Pages allow snippets (no nosnippet / max-snippet:0)', why: 'Snippet controls stop search results and AI answers from quoting the page.', verify: 'View source and headers; no nosnippet or max-snippet:0.' }),
  check({ id: 'content_data_nosnippet', runner: 'aeo_readiness', section: 'B', score: 'ai_readiness', severity: 'medium', kind: 'risk',
    label: 'Main content is not marked data-nosnippet', why: 'data-nosnippet hides that text from snippets and AI answers.', verify: 'No data-nosnippet on main content.' }),

  // ---------------------------------------------------------------- C · on-page technical
  check({ id: 'title_missing', runner: 'crawl', section: 'C', score: 'technical', severity: 'high',
    label: 'Every page has a title', why: 'The title is the main label in search results and AI source lists.', verify: 'View source; each page has one non-empty <title>.' }),
  check({ id: 'title_duplicate', runner: 'crawl', section: 'C', score: 'technical', severity: 'medium',
    label: 'Titles are unique', why: 'Duplicate titles make pages look interchangeable.', verify: 'Re-run Crawl; no two indexable pages share a title.' }),
  check({ id: 'title_too_long', runner: 'crawl', section: 'C', score: 'technical', severity: 'low', kind: 'recommendation',
    label: 'Titles fit in results', why: 'Long titles are truncated in results.', verify: 'Titles are about 60 characters or fewer.' }),
  check({ id: 'description_missing', runner: 'crawl', section: 'C', score: 'technical', severity: 'medium',
    label: 'Every page has a meta description', why: 'Without one, engines write their own snippet.', verify: 'View source; each page has a meta description.' }),
  check({ id: 'description_duplicate', runner: 'crawl', section: 'C', score: 'technical', severity: 'medium',
    label: 'Meta descriptions are unique', why: 'Duplicates weaken the snippet for each page.', verify: 'Re-run Crawl; descriptions are unique.' }),
  check({ id: 'description_length', runner: 'crawl', section: 'C', score: 'technical', severity: 'low', kind: 'recommendation',
    label: 'Meta descriptions are a usable length', why: 'Very short or long descriptions are rewritten or truncated.', verify: 'About 70–160 characters.' }),
  check({ id: 'h1_missing', runner: 'crawl', section: 'C', score: 'technical', severity: 'medium',
    label: 'Every page has an H1', why: 'The H1 states what the page is about to crawlers and readers.', verify: 'View source; one H1 per page.' }),
  check({ id: 'h1_multiple', runner: 'crawl', section: 'C', score: 'technical', severity: 'low', kind: 'recommendation',
    label: 'One H1 per page', why: 'Several H1s blur the page topic.', verify: 'View source; exactly one H1.' }),

  // ---------------------------------------------------------------- D · structured data
  check({ id: 'jsonld_invalid', runner: 'schema', section: 'D', score: 'structured_data', severity: 'high',
    label: 'JSON-LD parses', why: 'Invalid JSON-LD is ignored entirely.', verify: 'Schema.org validator shows no syntax errors.' }),
  check({ id: 'jsonld_missing', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium',
    label: 'Pages carry JSON-LD', why: 'Structured data is how machines identify the page, its author and its publisher.', verify: 'Each page has a JSON-LD block.' }),
  check({ id: 'organization_missing', runner: 'schema', section: 'D', score: 'structured_data', severity: 'high',
    label: 'Organization schema present', why: 'Organization schema is the machine-readable identity of the business.', verify: 'Homepage JSON-LD includes Organization.' }),
  check({ id: 'organization_no_logo', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium',
    label: 'Organization has a logo', why: 'The logo is used in knowledge panels and source attributions.', verify: 'Organization.logo points to a raster image.' }),
  check({ id: 'organization_no_sameas', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', kind: 'risk',
    label: 'Organization links its profiles (sameAs)', why: 'sameAs ties the site to the same entity elsewhere, which helps disambiguation.', verify: 'Organization.sameAs lists official profiles.' }),
  check({ id: 'website_schema_missing', runner: 'schema', section: 'D', score: 'structured_data', severity: 'low', kind: 'recommendation',
    label: 'WebSite schema present', why: 'WebSite schema names the site and its publisher.', verify: 'Homepage JSON-LD includes WebSite.' }),
  check({ id: 'breadcrumb_missing', runner: 'schema', section: 'D', score: 'structured_data', severity: 'low', kind: 'recommendation',
    label: 'Breadcrumbs marked up', why: 'BreadcrumbList shows where a page sits in the site.', verify: 'Inner pages include BreadcrumbList.' }),
  check({ id: 'article_schema_missing', runner: 'schema', section: 'D', score: 'structured_data', severity: 'high',
    applies: (m) => Number(m?.articlePages) > 0,
    label: 'Articles carry Article/BlogPosting schema', why: 'Article schema exposes headline, author and dates to search and AI systems.', verify: 'Article pages include BlogPosting JSON-LD.' }),
  check({ id: 'article_missing_headline', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Article schema has a headline', why: 'Required property for Article rich results.', verify: 'BlogPosting.headline is set.' }),
  check({ id: 'article_missing_author', runner: 'schema', section: 'D', score: 'structured_data', severity: 'high', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Article schema names an author', why: 'Authorship is a core trust signal for search and AI.', verify: 'BlogPosting.author is a Person.' }),
  check({ id: 'article_missing_date_published', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Article schema has datePublished', why: 'Dates tell systems how current the content is.', verify: 'BlogPosting.datePublished is set.' }),
  check({ id: 'article_missing_date_modified', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Article schema has dateModified', why: 'Freshness is read from dateModified.', verify: 'BlogPosting.dateModified is set.' }),
  check({ id: 'article_missing_image', runner: 'schema', section: 'D', score: 'structured_data', severity: 'low', kind: 'recommendation', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Article schema has an image', why: 'Required for some rich results.', verify: 'BlogPosting.image is set.' }),
  check({ id: 'author_not_person', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Authors are Person entities', why: 'A Person author can be linked to a real profile.', verify: 'author.@type is Person.' }),
  check({ id: 'author_no_profile', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', kind: 'risk', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Authors link to a profile', why: 'A profile URL connects the author entity across the web.', verify: 'author.url or sameAs is set.' }),
  check({ id: 'schema_date_mismatch', runner: 'schema', section: 'D', score: 'structured_data', severity: 'medium', applies: (m) => Number(m?.articlesWithSchema) > 0,
    label: 'Schema dates match the visible dates', why: 'Conflicting dates undermine trust in both.', verify: 'Visible and JSON-LD dates agree.' }),
  check({ id: 'faq_schema_missing', runner: 'schema', section: 'D', score: null, severity: 'low', kind: 'experimental',
    label: 'FAQ sections marked up', why: 'FAQPage markup helps machines read Q&A, though Google shows FAQ rich results only for a few sites.', verify: 'Pages with an FAQ include FAQPage.' }),

  // ---------------------------------------------------------------- E · performance
  ...['lcp', 'inp', 'cls'].map((metric) =>
    check({ id: `cwv_${metric}`, issueIds: [`cwv_${metric}_poor`, `cwv_${metric}_needs_improvement`], runner: 'speed', section: 'E', score: 'performance',
      severity: 'high', effort: 'medium',
      tested: (m) => (m?.hasFieldData ? true : 'Not enough real-user Chrome traffic for field data'),
      label: `Real-user ${metric.toUpperCase()} is good`, why: 'Core Web Vitals from real Chrome users are what Google uses for page experience.',
      verify: 'PageSpeed Insights "Discover what your real users are experiencing" shows Good (28-day lag).' })
  ),
  ...['lcp', 'inp', 'cls'].map((metric) =>
    check({ id: `page_cwv_${metric}`, issueIds: [`page_cwv_${metric}_poor`, `page_cwv_${metric}_needs_improvement`], runner: 'speed', section: 'E', score: 'performance',
      severity: 'high', effort: 'medium',
      tested: (m) => ((m?.pages || []).some((p) => p.field) ? true : 'No page has its own real-user data'),
      label: `Page-level ${metric.toUpperCase()} is good`, why: 'Individual templates can be slow even when the site average is fine.',
      verify: 'PageSpeed Insights for that URL shows Good field data.' })
  ),
  check({ id: 'performance_score', issueIds: ['performance_score_poor', 'performance_score_needs_work'], runner: 'speed', section: 'E', score: 'performance',
    severity: 'medium', effort: 'medium', kind: 'risk',
    tested: (m) => (Number(m?.pagesChecked) > 0 ? true : 'PageSpeed did not return results'),
    label: 'Mobile Lighthouse performance ≥ 90', why: 'Lab score flags render-blocking resources, heavy JS and unoptimized images.', verify: 'PageSpeed Insights mobile performance ≥ 90.' }),
  check({ id: 'lab_lcp', issueIds: ['lab_lcp_slow'], runner: 'speed', section: 'E', score: 'performance', severity: 'medium', effort: 'medium', kind: 'risk',
    tested: (m) => (m?.hasFieldData ? 'Field data available; lab LCP not used' : true),
    label: 'Lab LCP under 4 s', why: 'Used only when real-user data is missing.', verify: 'Lighthouse LCP < 4 s on mobile.' }),
  check({ id: 'lab_cls', issueIds: ['lab_cls_high'], runner: 'speed', section: 'E', score: 'performance', severity: 'medium', effort: 'medium', kind: 'risk',
    tested: (m) => (m?.hasFieldData ? 'Field data available; lab CLS not used' : true),
    label: 'Lab CLS under 0.25', why: 'Used only when real-user data is missing.', verify: 'Lighthouse CLS < 0.25.' }),
  check({ id: 'no_field_data', runner: 'speed', section: 'E', score: null, severity: 'low', kind: 'info',
    label: 'Real-user Core Web Vitals available', why: 'Chrome publishes field data only above a traffic threshold.', verify: 'PageSpeed Insights shows field data.' }),
  check({ id: 'pagespeed_failed', runner: 'speed', section: 'E', score: null, severity: 'low', kind: 'info',
    label: 'PageSpeed could test every template', why: 'A failed test usually means bot blocking or an auth wall.', verify: 'Re-run Speed.' }),

  // ---------------------------------------------------------------- F · rendering
  check({ id: 'thin_html_text', runner: 'aeo_readiness', section: 'F', score: 'ai_readiness', severity: 'high',
    label: 'Content is in the raw HTML', why: 'Most AI crawlers do not run JavaScript; text that only appears after rendering is invisible to them.', verify: 'curl the page; the article text is in the response.' }),

  // ---------------------------------------------------------------- G · AI crawler access
  check({ id: 'ai_search_bot_blocked_robots', runner: 'aeo_readiness', section: 'G', score: 'ai_readiness', severity: 'critical',
    label: 'robots.txt allows AI search and answer bots', why: 'OAI-SearchBot, Claude-SearchBot, PerplexityBot and the *-User fetchers decide whether you can be cited at all.', verify: 'robots.txt has no Disallow for those user agents.' }),
  check({ id: 'ai_bot_blocked_server', runner: 'aeo_readiness', section: 'G', score: 'ai_readiness', severity: 'high',
    tested: (m) => (warnIncludes(m, 'server-block checks were skipped') ? 'The homepage did not load for a normal browser' : true),
    label: 'Server/CDN serves AI bots', why: 'A WAF or bot challenge can block AI crawlers even when robots.txt allows them.', verify: 'Fetching with each bot user agent returns 200, not a challenge page.' }),
  check({ id: 'training_bot_policy_mismatch', runner: 'aeo_readiness', section: 'G', score: 'ai_readiness', severity: 'medium', kind: 'recommendation',
    applies: (m) => m?.trainingPolicy !== 'any',
    label: 'Training-bot rules match your policy', why: 'Training crawlers (GPTBot, ClaudeBot, Google-Extended, CCBot) are separate from search bots; rules should match the stance you chose.', verify: 'robots.txt rules for training bots match AEO Playbook → Company → AI training crawlers.' }),

  // ---------------------------------------------------------------- H · AI readability
  check({ id: 'answers_buried', runner: 'aeo_readiness', section: 'H', score: null, severity: 'medium', kind: 'experimental',
    label: 'Sections lead with the answer', why: 'Answer-first paragraphs are easier to quote; this is a content practice, not a technical defect.', verify: 'The first paragraph under each heading answers it.' }),
  check({ id: 'few_question_headings', runner: 'aeo_readiness', section: 'H', score: null, severity: 'low', kind: 'experimental',
    label: 'Headings phrased as questions', why: 'Question headings mirror how people ask AI assistants.', verify: 'A quarter or more of H2/H3 are questions.' }),
  check({ id: 'no_lists_tables', runner: 'aeo_readiness', section: 'H', score: null, severity: 'low', kind: 'experimental',
    label: 'Long articles use lists or tables', why: 'Structured blocks are extracted more reliably.', verify: 'Long articles contain at least one list or table.' }),
  check({ id: 'no_visible_date', runner: 'aeo_readiness', section: 'H', score: 'ai_readiness', severity: 'low', kind: 'recommendation',
    label: 'Articles show a visible date', why: 'Systems prefer content they can date.', verify: 'A <time> element with a date is visible.' }),
  check({ id: 'llms_txt_missing', runner: 'aeo_readiness', section: 'H', score: null, severity: 'low', kind: 'experimental',
    label: 'llms.txt present', why: 'An emerging convention; no AI system is confirmed to rely on it for ranking.', verify: '/llms.txt returns plain text.' }),

  // ---------------------------------------------------------------- I · AI visibility (measured, not scored)
  check({ id: 'no_ai_bot_visits', runner: 'aeo_readiness', section: 'I', score: null, severity: 'medium', kind: 'info',
    tested: (m) => (m?.aiVisits30d === '—' ? 'Crawler tracking is not installed (Analytics → Setup)' : true),
    label: 'AI crawlers are visiting', why: 'Real visits prove AI systems can and do read the site.', verify: 'Analytics → AI crawlers shows recent hits.' }),
  ...[
    ['ai_invisible', 'critical', 'Named in buyer answers'],
    ['ai_never_cited', 'high', 'Cited as a source in buyer answers'],
    ['ai_engine_absent', 'high', 'Named by every AI engine'],
    ['ai_brand_unrecognized', 'high', 'AI engines recognize the brand'],
    ['ai_competitor_ahead', 'high', 'Not out-named by competitors'],
    ['ai_low_share_of_voice', 'medium', 'Healthy share of voice'],
    ['aio_not_cited', 'medium', 'Cited in Google AI Overviews'],
    ['ai_mode_not_cited', 'medium', 'Cited in Google AI Mode'],
    ['ai_mentions_none', 'low', 'Mentioned in AI answers (DataForSEO)'],
  ].map(([id, severity, label]) =>
    check({ id, runner: 'ai_visibility', section: 'I', score: null, severity, kind: 'info', label,
      why: 'Measured visibility — an outcome of the technical and content work, not a technical check.',
      verify: 'Re-run AI Visibility.' })
  ),

  // ---------------------------------------------------------------- content & authority (outside the technical audit)
  ...[
    ['pillar_page_missing', 'high'], ['pillar_missing_link_to_article', 'high'], ['article_missing_link_to_pillar', 'high'],
    ['article_no_sibling_links', 'medium'], ['pillar_anchor_off_topic', 'low'], ['generic_anchor_text', 'low'],
    ['cluster_thin', 'medium'], ['planned_articles_unpublished', 'low'], ['member_page_error', 'low'], ['keyword_cannibalization', 'high'],
  ].map(([id, severity]) =>
    check({ id, runner: 'clusters', section: 'content', score: null, severity, kind: 'info', label: id.replace(/_/g, ' '),
      why: 'Content architecture — tracked in Clusters, outside the technical score.', verify: 'Re-run Clusters.' })
  ),
  ...[
    ['domain_authority', ['domain_authority_low', 'domain_authority_very_low'], 'medium'],
    ['linking_roots', ['linking_roots_thin', 'linking_roots_very_thin'], 'medium'],
    ['spam_score', ['spam_score_elevated', 'spam_score_high'], 'high'],
    ['da_below_competitors', ['da_below_competitors'], 'medium'],
    ['roots_below_competitors', ['roots_below_competitors'], 'medium'],
    ['moz_data_stale', ['moz_data_stale'], 'low'],
  ].map(([id, issueIds, severity]) =>
    check({ id, issueIds, runner: 'authority', section: 'authority', score: null, severity, kind: 'info', label: id.replace(/_/g, ' '),
      why: 'Backlink authority — outside the technical audit.', verify: 'Re-run Authority.' })
  ),

  // ---------------------------------------------------------------- Technical & Infrastructure runner
  check({ id: 'lang_missing', runner: 'technical', section: 'C', score: 'technical', severity: 'medium',
    label: 'Language declared on <html>', why: 'The lang attribute tells search engines, screen readers and AI systems which language the page is in.', verify: 'View source; <html lang="…"> is set.' }),
  check({ id: 'duplicate_head_tags', runner: 'technical', section: 'C', score: 'technical', severity: 'medium',
    label: 'One title and one meta description per page', why: 'Duplicate head tags make engines pick one at random.', verify: 'View source; exactly one of each.' }),
  check({ id: 'social_meta_missing', runner: 'technical', section: 'C', score: 'technical', severity: 'low', kind: 'recommendation',
    label: 'Open Graph tags present', why: 'Shared links and some AI previews read og:title, og:description and og:image.', verify: 'Facebook Sharing Debugger / LinkedIn Post Inspector shows title and image.' }),
  check({ id: 'img_alt_missing', runner: 'technical', section: 'C', score: 'technical', severity: 'low',
    label: 'Images have alt attributes', why: 'Alt text describes images to search engines, AI systems and screen readers.', verify: 'Every <img> has an alt attribute (alt="" for decorative).' }),
  check({ id: 'canonical_conflict', runner: 'technical', section: 'B', score: 'crawl_index', severity: 'high',
    label: 'One canonical per page', why: 'When canonical tags disagree, search engines ignore them.', verify: 'View source; a single canonical link.' }),
  check({ id: 'viewport_missing', runner: 'technical', section: 'K', score: 'technical', severity: 'high',
    label: 'Mobile viewport configured', why: 'Google indexes the mobile version; without a viewport the page renders as desktop on phones.', verify: 'View source; meta viewport has width=device-width.' }),
  check({ id: 'mixed_content', runner: 'technical', section: 'J', score: 'technical', severity: 'high',
    label: 'No mixed content', why: 'Browsers block HTTP scripts on HTTPS pages and flag the page as not fully secure.', verify: 'Browser console shows no mixed-content warnings.' }),
  check({ id: 'hsts_missing', runner: 'technical', section: 'J', score: 'technical', severity: 'medium',
    tested: (m) => (m?.homeLoaded ? true : 'The homepage did not load'),
    label: 'HSTS enabled', why: 'HSTS forces HTTPS and removes the insecure first request.', verify: 'Response headers include Strict-Transport-Security.' }),
  check({ id: 'security_headers_missing', runner: 'technical', section: 'J', score: 'technical', severity: 'low', kind: 'recommendation',
    tested: (m) => (m?.homeLoaded ? true : 'The homepage did not load'),
    label: 'Recommended security headers set', why: 'nosniff, frame protection and a referrer policy are low-cost hardening.', verify: 'securityheaders.com grade improves.' }),
  check({ id: 'compression_missing', runner: 'technical', section: 'E', score: 'performance', severity: 'medium',
    tested: (m) => (m?.homeLoaded ? true : 'The homepage did not load'),
    label: 'HTML is compressed', why: 'Compression cuts transfer size several-fold.', verify: 'Response header Content-Encoding is br or gzip.' }),
  check({ id: 'ttfb_slow', runner: 'technical', section: 'E', score: 'performance', severity: 'medium', kind: 'risk', effort: 'medium',
    tested: (m) => (Number(m?.ttfbSamples) > 0 ? true : 'Response time could not be measured'),
    label: 'Fast server response (TTFB ≤ 800 ms)', why: 'Slow first bytes delay everything after them; measured from one region, so treat as indicative.', verify: 'PageSpeed Insights "Server response time" or WebPageTest TTFB.' }),
  check({ id: 'asset_cache_short', runner: 'technical', section: 'E', score: 'performance', severity: 'low', kind: 'recommendation',
    tested: (m) => (Number(m?.assetsChecked) > 0 ? true : 'No same-site CSS/JS found to test'),
    label: 'Static assets cached long-term', why: 'Long caching makes repeat visits fast.', verify: 'CSS/JS respond with a long max-age or immutable.' }),
  check({ id: 'tls_expiring', runner: 'technical', section: 'J', score: 'technical', severity: 'high',
    tested: (m) => (m?.tlsChecked ? true : 'The TLS certificate could not be read'),
    label: 'SSL certificate not about to expire', why: 'An expired certificate takes the site offline for browsers and crawlers.', verify: 'Certificate valid for 30+ more days.' }),
  check({ id: 'hreflang_invalid', runner: 'technical', section: 'L', score: 'technical', severity: 'medium', applies: (m) => Number(m?.hreflangPages) > 0,
    label: 'hreflang codes are valid', why: 'Invalid codes are ignored.', verify: 'Codes look like en, en-GB or x-default.' }),
  check({ id: 'hreflang_no_self', runner: 'technical', section: 'L', score: 'technical', severity: 'medium', applies: (m) => Number(m?.hreflangPages) > 0,
    label: 'hreflang sets include the page itself', why: 'Google expects a self-referencing entry.', verify: 'Each page lists itself in hreflang.' }),
  check({ id: 'hreflang_not_reciprocal', runner: 'technical', section: 'L', score: 'technical', severity: 'medium', applies: (m) => Number(m?.hreflangPages) > 0,
    label: 'hreflang alternates link back', why: 'One-way hreflang is ignored.', verify: 'Each alternate lists the original.' }),
  check({ id: 'hreflang_on_non_canonical', runner: 'technical', section: 'L', score: 'technical', severity: 'medium', applies: (m) => Number(m?.hreflangPages) > 0,
    label: 'hreflang only on canonical URLs', why: 'hreflang on non-canonical pages conflicts with the canonical.', verify: 'Pages with hreflang are self-canonical.' }),

  // ---------------------------------------------------------------- not built yet (counted as Not tested)
  check({ id: 'rendered_vs_raw', runner: null, section: 'F', score: 'technical', severity: 'high', effort: 'high',
    label: 'Rendered DOM matches raw HTML for key content and metadata', why: 'Content or metadata injected only by JavaScript may never be seen by crawlers.', verify: 'Compare raw HTML with the rendered DOM.' }),
  check({ id: 'gsc_index_coverage', runner: null, section: 'B', score: 'crawl_index', severity: 'high', effort: 'medium',
    label: 'Sitemap pages are indexed in Google', why: 'Confirms indexing with Google\'s own data rather than inferring it.', verify: 'Search Console → Pages shows them indexed.' }),
  check({ id: 'mobile_usability', runner: null, section: 'K', score: 'technical', severity: 'medium', effort: 'medium',
    label: 'No mobile layout overflow or tap-target problems', why: 'Google indexes the mobile version first.', verify: 'Lighthouse accessibility and mobile checks pass.' }),
  check({ id: 'entity_consistency', runner: null, section: 'H', score: 'ai_readiness', severity: 'medium', effort: 'medium', kind: 'risk',
    label: 'Organization facts are consistent across pages and schema', why: 'Contradictory names, addresses or offerings confuse entity resolution.', verify: 'Brand facts match across homepage, About and JSON-LD.' }),
]

/** Map issue check id → catalog check id. */
export const ISSUE_TO_CHECK = Object.fromEntries(CHECKS.flatMap((c) => c.issueIds.map((issueId) => [issueId, c.id])))

/** @param {string} id */
export function checkById(id) {
  return CHECKS.find((c) => c.id === id) || null
}
