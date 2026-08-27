import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { serpResults } from './serp.js'

export const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000
export const DEFAULT_CANDIDATE_LIMIT = 3

const MODULE_DIR = fileURLToPath(new URL('.', import.meta.url))
const SOURCES_FILE = join(MODULE_DIR, 'sources.json')

function cacheDir() {
  if (process.env.VERCEL) return join(tmpdir(), 'tnv-serp-cache')
  return join(process.cwd(), '.cache', 'serp')
}

export function loadSources() {
  if (!existsSync(SOURCES_FILE)) return { allow: [], deny: [] }
  try {
    return JSON.parse(readFileSync(SOURCES_FILE, 'utf8'))
  } catch {
    return { allow: [], deny: [] }
  }
}

function safeSlug(value) {
  return (
    String(value || '')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || 'article'
  )
}

function cachePath(slug, host) {
  const key = [safeSlug(host), safeSlug(slug)].filter(Boolean).join('__')
  return join(cacheDir(), `${key || safeSlug(slug)}.json`)
}

function readCache(slug, host) {
  const path = cachePath(slug, host)
  if (!existsSync(path)) return null
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'))
    if (Date.now() - new Date(json.fetchedAt).getTime() > CACHE_TTL_MS) {
      return null
    }
    return json
  } catch {
    return null
  }
}

function writeCache(slug, host, items) {
  mkdirSync(cacheDir(), { recursive: true })
  writeFileSync(
    cachePath(slug, host),
    JSON.stringify(
      { slug, host, fetchedAt: new Date().toISOString(), items },
      null,
      2
    )
  )
}

export function ownHost(siteUrl) {
  try {
    return new URL(String(siteUrl || '')).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function domainOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return ''
  }
}

function tokens(phrase) {
  return String(phrase || '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 3)
}

function relevant(item, keyword) {
  const hay = `${item.title || ''} ${item.description || ''}`.toLowerCase()
  const parts = tokens(keyword)
  if (!parts.length) return true
  return parts.some((t) => hay.includes(t))
}

function bodyUrls(body) {
  const urls = []
  const re = /https?:\/\/[^\s)\]>"]+/g
  let match
  while ((match = re.exec(String(body || '')))) {
    urls.push(match[0].replace(/[.,;]+$/, ''))
  }
  return urls
}

async function headOk(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 10000)
  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      redirect: 'follow',
    })
    return res.status === 200
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

function normalizeArticle(input) {
  const data = input?.data && typeof input.data === 'object' ? input.data : {}
  const slug = String(input?.slug || data.slug || '').trim()
  return {
    slug,
    title: String(input?.title || data.title || slug),
    targetKeyword: String(
      input?.targetKeyword || data.targetKeyword || ''
    ),
    pillarKeyword: String(
      input?.pillarKeyword || data.pillarKeyword || ''
    ),
    body: String(input?.body || ''),
    externalLinks: Array.isArray(input?.externalLinks)
      ? input.externalLinks
      : Array.isArray(data.externalLinks)
        ? data.externalLinks
        : [],
  }
}

function mergeSources(base, extra) {
  const allow = [
    ...(base.allow || []),
    ...((extra && extra.allow) || []),
  ]
  const deny = [
    ...(base.deny || []),
    ...((extra && extra.deny) || []),
  ]
  return { allow, deny }
}

function preferAuthoritative(pool, allow, seeded) {
  const seedUrls = new Set(seeded.map((item) => item.url).filter(Boolean))
  const seededPart = []
  const preferred = []
  const rest = []
  for (const item of pool) {
    if (seedUrls.has(item.url)) {
      if (seededPart.every((s) => s.url !== item.url)) seededPart.push(item)
      continue
    }
    const domain = (item.domain || domainOf(item.url || '')).replace(/^www\./, '')
    if (allow.size && allow.has(domain)) preferred.push(item)
    else rest.push(item)
  }
  return [...seededPart, ...preferred, ...rest]
}

export function countUncachedSerpCalls(articles, siteUrl) {
  const host = ownHost(siteUrl)
  return (Array.isArray(articles) ? articles : [])
    .map((item) => normalizeArticle(item))
    .filter((article) => article.slug && !readCache(article.slug, host)).length
}

/**
 * Propose external source URLs for one or more articles.
 * Does not write files or commit. SERP responses are cached per slug (+ host) with a 30-day TTL.
 */
export async function searchExternalLinks({
  articles,
  siteUrl,
  sources,
  limit = DEFAULT_CANDIDATE_LIMIT,
  onProgress,
} = {}) {
  const loaded = mergeSources(loadSources(), sources)
  const deny = new Set((loaded.deny || []).map((d) => d.replace(/^www\./, '')))
  const allow = new Set((loaded.allow || []).map((d) => d.replace(/^www\./, '')))
  const host = ownHost(siteUrl)
  const list = (Array.isArray(articles) ? articles : [])
    .map(normalizeArticle)
    .filter((article) => article.slug)
  const cap = Math.max(1, Number(limit) || DEFAULT_CANDIDATE_LIMIT)
  const rows = []

  let i = 0
  for (const article of list) {
    i += 1
    onProgress?.(`Searching ${i} of ${list.length}: ${article.slug}`)
    const targetKeyword = String(
      article.targetKeyword || article.title || ''
    )
    const pillarKeyword = String(article.pillarKeyword || '')
    const query =
      `${targetKeyword} ${pillarKeyword} guide OR resource OR statistics`.trim()

    const seeded = []
    for (const link of article.externalLinks) {
      const url = String(link?.url || '').trim()
      if (!url) continue
      seeded.push({
        title: String(link.label || link.title || url),
        url,
        domain: domainOf(url),
      })
    }
    for (const url of bodyUrls(article.body)) {
      seeded.push({ title: url, url, domain: domainOf(url) })
    }

    const cached = readCache(article.slug, host)
    let serpItems = cached?.items ?? []
    let available = true
    let reason
    const fromCache = Boolean(cached)

    if (!cached) {
      const result = await serpResults({ keyword: query, depth: 10 })
      if (!result.available) {
        available = false
        reason = result.reason
      } else {
        serpItems = result.items || []
        writeCache(article.slug, host, serpItems)
      }
    }

    const pool = preferAuthoritative(
      [...seeded, ...serpItems],
      allow,
      seeded
    )
    const picked = []
    const seen = new Set()
    for (const item of pool) {
      if (!item.url) continue
      const domain = (item.domain || domainOf(item.url)).replace(/^www\./, '')
      if (!domain || domain === host || deny.has(domain)) continue
      if (seen.has(domain)) continue
      if (!relevant(item, `${targetKeyword} ${pillarKeyword}`)) continue
      const ok = await headOk(item.url)
      if (!ok) continue
      seen.add(domain)
      const title = String(item.title || item.url)
      picked.push({ label: title, title, url: item.url, domain })
      if (picked.length >= cap) break
    }

    rows.push({
      slug: article.slug,
      title: article.title,
      query,
      available,
      reason,
      fromCache,
      candidates: picked,
    })
  }

  return { siteUrl: String(siteUrl || ''), ownHost: host, rows }
}
