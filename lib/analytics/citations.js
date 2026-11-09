// "Where AI cites you": one row per page of the site, merging every piece of
// evidence that an AI system used it. Pure.
//   clicked  — visits from an AI assistant landed on the page (GA4)
//   read     — an AI assistant fetched the page live to answer someone (crawler tracking)
//   cited    — the page was a source in an AI answer: audit buyer questions
//              (ChatGPT, Claude, Gemini, Perplexity), DataForSEO LLM mentions,
//              Google AI Overview checks

import { apexDomain } from '../audit-snapshot/domain.js'

/** Live-fetch crawlers → assistant name. */
export const LIVE_FETCHERS = {
  'ChatGPT-User': 'ChatGPT',
  'Claude-User': 'Claude',
  'Perplexity-User': 'Perplexity',
  'MistralAI-User': 'Mistral',
  'Meta-ExternalFetcher': 'Meta AI',
}

export const AUDIT_ENGINE_LABELS = { chat_gpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity' }
const MENTION_PLATFORM_LABELS = { chat_gpt: 'ChatGPT', google: 'Google AI Overview' }
const MAX_QUESTIONS = 6

/** "https://www.x.com/" or "x.com" → "https://www.x.com" (null when unusable). */
export function siteOrigin(domain) {
  const raw = String(domain || '').trim()
  if (!raw) return null
  try {
    const u = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`)
    return `${u.protocol}//${u.hostname.toLowerCase()}`
  } catch {
    return null
  }
}

/**
 * Site path for a URL or path on the company's domain; null for other sites.
 * Drops query strings (utm_source=…), fragments and trailing slashes.
 */
export function sitePath(value, apex) {
  const raw = String(value || '').trim()
  if (!raw || raw === '(not set)') return null
  let path = raw
  if (/^https?:\/\//i.test(raw)) {
    let u
    try {
      u = new URL(raw)
    } catch {
      return null
    }
    const host = apexDomain(u.hostname)
    if (!apex || !(host === apex || host.endsWith(`.${apex}`))) return null
    path = u.pathname
  }
  if (!path.startsWith('/')) return null
  path = path.split(/[?#\]\s]/)[0].replace(/\/{2,}/g, '/')
  if (path.length > 1) path = path.replace(/\/+$/, '')
  return path || '/'
}

/**
 * @param {{
 *   domain: string,
 *   aiLanding?: Array<{ page: string, sessions: number, assistants: Record<string, number> }>,
 *   liveReads?: Array<{ bot: string, path: string, hits: number, last_hit_at?: string }>,
 *   auditRun?: { started_at: string, metrics?: { matrix?: any[] } } | null,
 *   mentions?: Array<{ platform: string, checkedAt: string|null, items: Array<{ question: string, urls: string[] }> }>,
 *   aioChecks?: Array<{ keyword: string, checked_at: string, cited_urls?: string[], cited?: boolean }>,
 * }} input
 */
export function buildAiCitations(input) {
  const apex = apexDomain(input.domain || '')
  const origin = siteOrigin(input.domain)
  const rows = new Map()
  const row = (path) => {
    if (!rows.has(path)) {
      rows.set(path, { path, assistants: new Set(), visits: 0, liveReads: 0, cited: 0, questions: [], lastSeen: null })
    }
    return rows.get(path)
  }
  const seen = (r, at) => {
    if (at && (!r.lastSeen || String(at) > r.lastSeen)) r.lastSeen = String(at)
  }
  const addQuestion = (r, question, source, brand = false) => {
    const q = String(question || '').trim()
    if (!q) return
    const existing = r.questions.find((x) => x.question === q)
    if (existing) {
      if (!existing.sources.includes(source)) existing.sources.push(source)
    } else if (r.questions.length < MAX_QUESTIONS) {
      r.questions.push({ question: q, sources: [source], brand })
    }
  }

  for (const landing of input.aiLanding || []) {
    const path = sitePath(landing.page, apex)
    if (!path) continue
    const r = row(path)
    r.visits += Number(landing.sessions) || 0
    for (const name of Object.keys(landing.assistants || {})) r.assistants.add(name)
  }

  for (const read of input.liveReads || []) {
    const assistant = LIVE_FETCHERS[read.bot]
    const path = sitePath(read.path, apex)
    if (!assistant || !path || /\.(txt|xml|png|jpe?g|svg|ico|webp|css|js|json|md)$/i.test(path)) continue
    const r = row(path)
    r.liveReads += Number(read.hits) || 0
    r.assistants.add(assistant)
    seen(r, read.last_hit_at)
  }

  const runAt = input.auditRun?.started_at || null
  for (const prompt of input.auditRun?.metrics?.matrix || []) {
    for (const [engine, cell] of Object.entries(prompt.cells || {})) {
      if (!cell || cell.error) continue
      const label = AUDIT_ENGINE_LABELS[engine] || engine
      const paths = new Set((cell.sources || []).map((u) => sitePath(u, apex)).filter(Boolean))
      for (const path of paths) {
        const r = row(path)
        r.cited += 1
        r.assistants.add(label)
        addQuestion(r, prompt.prompt, label, prompt.intent === 'brand')
        seen(r, runAt)
      }
    }
  }

  for (const m of input.mentions || []) {
    const label = MENTION_PLATFORM_LABELS[m.platform] || m.platform
    for (const item of m.items || []) {
      const paths = new Set((item.urls || []).map((u) => sitePath(u, apex)).filter(Boolean))
      for (const path of paths) {
        const r = row(path)
        r.cited += 1
        r.assistants.add(label)
        addQuestion(r, item.question, label)
        seen(r, m.checkedAt)
      }
    }
  }

  for (const check of input.aioChecks || []) {
    const paths = new Set((check.cited_urls || []).map((u) => sitePath(u, apex)).filter(Boolean))
    for (const path of paths) {
      const r = row(path)
      r.cited += 1
      r.assistants.add('Google AI Overview')
      addQuestion(r, check.keyword, 'Google AI Overview')
      seen(r, check.checked_at)
    }
  }

  return [...rows.values()]
    .map((r) => ({
      path: r.path,
      url: origin ? `${origin}${r.path}` : r.path,
      assistants: [...r.assistants].sort(),
      visits: r.visits,
      liveReads: r.liveReads,
      cited: r.cited,
      questions: [...r.questions].sort((a, b) => Number(a.brand) - Number(b.brand)),
      lastSeen: r.lastSeen,
      evidence: [r.cited > 0 && 'cited', r.liveReads > 0 && 'read', r.visits > 0 && 'clicked'].filter(Boolean),
    }))
    .sort((a, b) => b.cited * 3 + b.liveReads * 2 + b.visits - (a.cited * 3 + a.liveReads * 2 + a.visits) || a.path.localeCompare(b.path))
}
