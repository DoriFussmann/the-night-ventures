// AEO Readiness category: can AI crawlers reach the site (robots.txt + what the
// server actually returns per bot user agent), are pages allowed in AI snippets,
// is the text in the raw HTML, and is content shaped to be quoted.
// Pure: classifiers + buildAeoIssues(pages, workspace) -> { issues, metrics }.

import { makeIssue, dedupeIssues } from '../issues.js'

const CATEGORY = 'aeo_readiness'

/**
 * Crawlers checked. `ua` = a user agent we fetch the homepage with (null = robots.txt token only).
 * kind: ai_search (indexes for an AI answer engine), ai_user (live fetch for a person's question),
 * search (classic engine that feeds AI answers), ai_training (collects training data).
 * `engine` links to AI Visibility's engines.
 */
export const AEO_BOTS = [
  { bot: 'OAI-SearchBot', kind: 'ai_search', engine: 'chat_gpt', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot' },
  { bot: 'ChatGPT-User', kind: 'ai_user', engine: 'chat_gpt', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot' },
  { bot: 'Claude-SearchBot', kind: 'ai_search', engine: 'claude', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +Claude-SearchBot@anthropic.com)' },
  { bot: 'Claude-User', kind: 'ai_user', engine: 'claude', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +Claude-User@anthropic.com)' },
  { bot: 'PerplexityBot', kind: 'ai_search', engine: 'perplexity', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)' },
  { bot: 'Perplexity-User', kind: 'ai_user', engine: 'perplexity', ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)' },
  { bot: 'Googlebot', kind: 'search', engine: 'gemini', ua: null },
  { bot: 'Bingbot', kind: 'search', engine: null, ua: null },
  { bot: 'GPTBot', kind: 'ai_training', engine: null, ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot' },
  { bot: 'ClaudeBot', kind: 'ai_training', engine: null, ua: 'Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)' },
  { bot: 'Google-Extended', kind: 'ai_training', engine: null, ua: null },
  { bot: 'Applebot-Extended', kind: 'ai_training', engine: null, ua: null },
  { bot: 'CCBot', kind: 'ai_training', engine: null, ua: 'CCBot/2.0 (https://commoncrawl.org/faq/)' },
]

export const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'

export const KIND_LABELS = {
  ai_search: 'AI search',
  ai_user: 'AI live fetch',
  search: 'Search engine',
  ai_training: 'AI training',
}

/** Article/pillar thresholds. */
export const THIN_WORDS = 200
export const ANSWER_MAX_WORDS = 100
const MIN_SECTIONS_FOR_STRUCTURE = 3
const MIN_SECTIONS_FOR_QUESTIONS = 4
const QUESTION_SHARE_MIN = 0.25
const LISTS_WORDS_MIN = 700
const VISIT_DAYS = 30

const CHALLENGE_RE =
  /(just a moment\.\.\.|cf-chl|challenge-platform|attention required! \| cloudflare|vercel security checkpoint|captcha|access denied|request blocked)/i

/**
 * Was a bot fetch blocked by the server/CDN?
 * @param {{ status?: number, ok?: boolean, error?: string|null, text?: string }} res
 * @returns {{ status: number|null, blocked: boolean, reason: string }}
 */
export function classifyFetch(res) {
  if (!res || res.error) return { status: null, blocked: false, reason: res?.error || 'no response' }
  const status = Number(res.status) || null
  if ([401, 403, 406, 429, 503].includes(status)) return { status, blocked: true, reason: `HTTP ${status}` }
  // Challenge / block pages are short; real homepages are not.
  const text = String(res.text || '')
  if (status && status < 400 && text.length < 15000 && CHALLENGE_RE.test(text)) {
    return { status, blocked: true, reason: 'Challenge or block page' }
  }
  return { status, blocked: false, reason: status ? `HTTP ${status}` : 'unknown' }
}

/** Page facts AEO keeps per page (small: no headings text, no links). */
export function projectAeoFacts(f) {
  return {
    robots: { nosnippet: Boolean(f.robots?.nosnippet), maxSnippet: f.robots?.maxSnippet ?? null, noindex: Boolean(f.robots?.noindex) },
    dataNosnippetCount: f.dataNosnippetCount || 0,
    mainWordCount: f.mainWordCount || 0,
    sections: (f.sections || []).map((s) => ({ q: Boolean(s.isQuestion), b: s.firstBlock, w: s.answerWords || 0 })),
    listCount: f.listCount || 0,
    tableCount: f.tableCount || 0,
    hasDate: Boolean((f.timeElements || []).some((t) => t.date) || f.metaDates?.published || f.metaDates?.modified),
  }
}

/** Section opens with a quotable answer: a short paragraph, a list or a table. */
export function isAnswerFirst(section) {
  if (section.b === 'list' || section.b === 'table') return true
  return section.b === 'p' && section.w > 0 && section.w <= ANSWER_MAX_WORDS
}

/** Structure facts for one article/pillar page. */
export function pageStructure(facts) {
  const sections = facts.sections || []
  const answerFirst = sections.filter(isAnswerFirst).length
  const questions = sections.filter((s) => s.q).length
  return {
    words: facts.mainWordCount,
    sections: sections.length,
    answerFirst,
    questions,
    buried: sections.length >= MIN_SECTIONS_FOR_STRUCTURE && answerFirst < sections.length / 2,
    fewQuestions: sections.length >= MIN_SECTIONS_FOR_QUESTIONS && questions / sections.length < QUESTION_SHARE_MIN,
    noListsTables: facts.mainWordCount > LISTS_WORDS_MIN && facts.listCount === 0 && facts.tableCount === 0,
    thin: facts.mainWordCount < THIN_WORDS,
  }
}

function snippetBlocked(facts) {
  return Boolean(facts.robots?.nosnippet) || facts.robots?.maxSnippet === 0
}

/**
 * @param {Array<{ url: string, kind: string, facts: any, error?: string }>} pages
 * @param {{ site: any }} ws  site: { robots, fetches, browser, llmsTxt, visits, policy }
 */
export function buildAeoIssues(pages, ws) {
  const site = ws?.site || {}
  const issues = []
  const policy = site.policy || 'allow'
  const robotsBots = site.robots?.ok ? site.robots.bots || {} : null
  const visits = site.visits || { tracking: false, byBot: {} }
  const recentVisit = (bot) => Boolean(visits.byBot?.[bot]?.hits)

  const botRows = AEO_BOTS.map((b) => {
    const robots = robotsBots ? robotsBots[b.bot]?.status || 'allowed' : 'unknown'
    const fetch = b.ua ? site.fetches?.[b.bot] || null : null
    const serverBlocked = Boolean(fetch?.blocked) && Boolean(site.browser?.ok) && !recentVisit(b.bot)
    return {
      bot: b.bot,
      kind: b.kind,
      engine: b.engine,
      robots,
      httpStatus: fetch?.status ?? null,
      serverBlocked,
      serverNote: fetch?.blocked ? fetch.reason : null,
      lastVisit: visits.byBot?.[b.bot]?.lastHitAt || null,
      visits30d: visits.byBot?.[b.bot]?.hits || 0,
    }
  })

  for (const r of botRows) {
    const blockedRobots = r.robots === 'blocked'
    if (blockedRobots && (r.kind === 'ai_search' || r.kind === 'ai_user')) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_search_bot_blocked_robots',
          severity: 'critical',
          title: 'An AI search crawler is blocked in robots.txt',
          detail: `${r.bot} (${KIND_LABELS[r.kind]}) is disallowed from /. Its answers can't use or cite your pages.`,
          target: r.bot,
          evidence: { bot: r.bot, kind: r.kind },
          fixHint: `Remove the Disallow: / rule that applies to ${r.bot} in robots.txt (check User-agent: * too).`,
        })
      )
    } else if (blockedRobots && r.kind === 'search') {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'search_engine_blocked_robots',
          severity: 'critical',
          title: 'A search engine crawler is blocked in robots.txt',
          detail: `${r.bot} is disallowed from /. ${r.bot === 'Googlebot' ? 'Google AI Overviews and AI Mode' : 'Copilot and ChatGPT search'} rely on its index.`,
          target: r.bot,
          evidence: { bot: r.bot },
          fixHint: `Remove the Disallow: / rule that applies to ${r.bot}.`,
        })
      )
    } else if (r.kind === 'ai_training' && policy !== 'any' && r.robots !== 'unknown') {
      const mismatch = (policy === 'allow' && blockedRobots) || (policy === 'block' && !blockedRobots)
      if (mismatch) {
        issues.push(
          makeIssue({
            category: CATEGORY,
            checkId: 'training_bot_policy_mismatch',
            severity: 'medium',
            title: 'A training crawler does not match your AI training policy',
            detail: `${r.bot} is ${blockedRobots ? 'blocked' : 'allowed'} in robots.txt; your policy is "${policy}".`,
            target: r.bot,
            evidence: { bot: r.bot, policy, robots: r.robots },
            fixHint:
              policy === 'allow'
                ? `Remove the Disallow rule for ${r.bot}, or change the policy in Company Intelligence.`
                : `Add "User-agent: ${r.bot}" with "Disallow: /" to robots.txt, or change the policy.`,
          })
        )
      }
    }

    if (!blockedRobots && r.serverBlocked && r.kind !== 'ai_training') {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'ai_bot_blocked_server',
          severity: 'high',
          title: 'An AI crawler is blocked by the server or CDN',
          detail: `robots.txt allows ${r.bot}, but its user agent got ${r.serverNote} while a normal browser got HTTP ${site.browser?.status}. Some firewalls also reject bots they can't verify, so confirm in your CDN settings.`,
          target: r.bot,
          evidence: { bot: r.bot, status: r.httpStatus, reason: r.serverNote },
          fixHint:
            'In Cloudflare (Security → Bots / AI Crawl Control) or the Vercel Firewall, allow verified AI search and live-fetch crawlers.',
        })
      )
    }
  }

  if (visits.tracking) {
    const aiVisits = botRows.filter((r) => r.kind === 'ai_search' || r.kind === 'ai_user').reduce((n, r) => n + r.visits30d, 0)
    if (aiVisits === 0) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'no_ai_bot_visits',
          severity: 'medium',
          title: `No AI search crawler visits in the last ${VISIT_DAYS} days`,
          detail: 'Crawler tracking is connected, but no AI search or live-fetch bot was logged.',
          target: 'visits',
          fixHint: 'Check the access table above; if nothing is blocked, submit the sitemap in Bing Webmaster Tools and earn links so crawlers discover the site.',
        })
      )
    }
  }

  if (site.llmsTxt && !site.llmsTxt.ok) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'llms_txt_missing',
        severity: 'low',
        title: 'No llms.txt',
        detail: `/llms.txt returned ${site.llmsTxt.status ? `HTTP ${site.llmsTxt.status}` : site.llmsTxt.error || 'nothing'}.`,
        target: 'llms',
        fixHint: 'Publish /llms.txt listing your key pages with one-line descriptions. Low impact: no major engine has confirmed using it.',
      })
    )
  }

  // --- Pages
  const ok = pages.filter((p) => p.facts)
  const pageRows = []
  for (const p of ok) {
    const f = p.facts
    if (snippetBlocked(f) && !f.robots.noindex) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'page_blocks_snippets',
          severity: 'high',
          title: 'Page blocks AI snippets',
          detail: f.robots.nosnippet ? 'nosnippet is set (meta robots or X-Robots-Tag).' : 'max-snippet:0 is set.',
          url: p.url,
          evidence: { robots: f.robots },
          fixHint: 'Remove nosnippet / max-snippet:0; pages with them are excluded from AI Overviews and AI Mode.',
        })
      )
    }
    if (f.dataNosnippetCount > 0) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'content_data_nosnippet',
          severity: 'medium',
          title: 'Content hidden from snippets (data-nosnippet)',
          detail: `${f.dataNosnippetCount} element(s) marked data-nosnippet.`,
          url: p.url,
          fixHint: 'Remove data-nosnippet from content you want quoted.',
        })
      )
    }
    if (p.kind !== 'article' && p.kind !== 'pillar') continue
    const s = pageStructure(f)
    pageRows.push({
      url: p.url,
      kind: p.kind,
      words: s.words,
      sections: s.sections,
      answerFirst: s.answerFirst,
      questions: s.questions,
      listsTables: f.listCount + f.tableCount,
      hasDate: f.hasDate,
      snippetBlocked: snippetBlocked(f) || f.dataNosnippetCount > 0,
    })
    if (s.thin) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'thin_html_text',
          severity: 'high',
          title: `Under ${THIN_WORDS} words of text in the raw HTML`,
          detail: `${s.words} words found without running JavaScript. Most AI crawlers don't run JavaScript.`,
          url: p.url,
          evidence: { words: s.words },
          fixHint: 'Render the article body server-side (static HTML), not in client-side JavaScript.',
        })
      )
      continue
    }
    if (s.buried) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'answers_buried',
          severity: 'medium',
          title: 'Sections do not open with a direct answer',
          detail: `${s.answerFirst} of ${s.sections} sections open with a short paragraph (≤ ${ANSWER_MAX_WORDS} words), list or table.`,
          url: p.url,
          evidence: { sections: s.sections, answerFirst: s.answerFirst },
          fixHint: 'Open each section with a one-to-three-sentence direct answer, then expand.',
        })
      )
    }
    if (s.fewQuestions) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'few_question_headings',
          severity: 'low',
          title: 'Few question-style headings',
          detail: `${s.questions} of ${s.sections} headings are phrased as questions.`,
          url: p.url,
          fixHint: 'Phrase key H2s the way buyers ask (e.g. "How long does a seed round take?").',
        })
      )
    }
    if (s.noListsTables) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'no_lists_tables',
          severity: 'low',
          title: 'Long article with no lists or tables',
          detail: `${s.words} words, no list or table.`,
          url: p.url,
          fixHint: 'Add a list or comparison table where content is steps, options or criteria; AI answers lift them directly.',
        })
      )
    }
    if (p.kind === 'article' && !f.hasDate) {
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: 'no_visible_date',
          severity: 'low',
          title: 'No visible publish or update date',
          detail: 'No <time> element and no article:published_time / modified_time meta.',
          url: p.url,
          fixHint: 'Show "Updated <date>" in a <time datetime> element; AI engines weigh freshness.',
        })
      )
    }
  }

  // --- Metrics
  const aiSearch = botRows.filter((r) => r.kind === 'ai_search' || r.kind === 'ai_user')
  const structured = pageRows.filter((r) => r.sections >= MIN_SECTIONS_FOR_STRUCTURE && r.words >= THIN_WORDS)
  const answerFirstPages = structured.filter((r) => r.answerFirst >= r.sections / 2).length
  const warnings = []
  if (!site.robots?.ok) warnings.push(`robots.txt not read (${site.robots?.error || 'unavailable'}) — crawlers treat a missing file as allow-all.`)
  if (!site.browser?.ok) warnings.push('The homepage did not load for a normal browser, so server-block checks were skipped.')
  if (!visits.tracking) warnings.push('Crawler tracking is not connected in Analytics — real AI crawler visits are not checked.')
  const failed = pages.length - ok.length

  return {
    issues: dedupeIssues(issues),
    metrics: {
      aiSearchAllowed: `${aiSearch.filter((r) => r.robots !== 'blocked' && !r.serverBlocked).length} / ${aiSearch.length}`,
      botsBlockedByServer: botRows.filter((r) => r.serverBlocked && r.robots !== 'blocked').length,
      snippetBlockedPages: ok.filter((p) => snippetBlocked(p.facts) || p.facts.dataNosnippetCount > 0).length,
      thinHtmlPages: pageRows.filter((r) => r.words < THIN_WORDS).length,
      answerFirstShare: structured.length ? `${Math.round((answerFirstPages / structured.length) * 100)}%` : '—',
      aiVisits30d: visits.tracking ? aiSearch.reduce((n, r) => n + r.visits30d, 0) : '—',
      pagesChecked: ok.length,
      pagesFailed: failed,
      trainingPolicy: policy,
      llmsTxt: site.llmsTxt?.ok ? 'present' : 'missing',
      bots: botRows,
      pages: pageRows.slice(0, 150),
      warnings,
    },
  }
}
