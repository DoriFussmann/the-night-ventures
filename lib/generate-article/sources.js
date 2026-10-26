/**
 * Sources for generated articles: the writer lists a URL for every fact
 * (claimSources) and for the Where Things Stand paragraph. This module
 * checks the URLs and turns them into frontmatter externalLinks.
 */

const BLOCKED_HOSTS = [
  'pinterest.com',
  'facebook.com',
  'twitter.com',
  'x.com',
  'reddit.com',
  'quora.com',
  'youtube.com',
  'tiktok.com',
  'instagram.com',
]

function text(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim()
}

export function normalizeClaimSources(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({ url: text(item.url), claim: text(item.claim || item.note) }))
    .filter((item) => /^https?:\/\//i.test(item.url))
}

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, '')
  } catch {
    return ''
  }
}

const STAT_PATTERNS = [
  /\b\d+(?:\.\d+)?\s?%/g,
  /\$\s?\d[\d,.]*\s?(?:k|m|bn|b|million|billion|thousand)?\b/gi,
  /\b\d+(?:\.\d+)?x\b/gi,
  /\b\d+\s+(?:in|out of)\s+\d+\b/gi,
]

/** Statistic strings in the main body (Where Things Stand has its own sources). */
export function findStatistics(body) {
  const main = String(body || '').split(/^## Where Things Stand/m)[0]
  const out = []
  for (const re of STAT_PATTERNS) for (const m of main.match(re) || []) out.push(m.trim())
  return out
}

/** Numbers that read as statistics: 42%, $4.1 million, 3x, 1 in 5. */
export function countStatistics(body) {
  return findStatistics(body).length
}

/** Digits of a statistic, for matching it against a claim ("$4.1 million" → "4.1"). */
function statCore(stat) {
  return (String(stat).match(/\d[\d,]*(?:\.\d+)?/g) || []).map((d) => d.replace(/,/g, ''))
}

/**
 * Every statistic in the body must appear in one of the claimSources claims.
 * Returns validation errors naming the uncovered ones.
 */
export function claimSourceErrors(body, claimSources) {
  const stats = findStatistics(body)
  if (stats.length === 0) return []
  const claims = normalizeClaimSources(claimSources).map((c) => c.claim.replace(/,/g, ''))
  if (claims.length === 0) {
    return [
      `The body contains ${stats.length} statistic${stats.length === 1 ? '' : 's'} but claimSources is empty. Add { url, claim } for each from a page you opened, or rewrite those sentences without the numbers.`,
    ]
  }
  const uncovered = [...new Set(stats.filter((stat) => {
    const cores = statCore(stat)
    return !claims.some((claim) => cores.every((core) => claim.includes(core)))
  }))]
  if (uncovered.length === 0) return []
  return [
    `These statistics in the body have no matching entry in claimSources: ${uncovered.join(', ')}. Add a source for each (the claim must contain the number), or rewrite those sentences without the numbers.`,
  ]
}

function pageTitle(html) {
  const m = String(html || '').match(/<title[^>]*>([\s\S]*?)<\/title>/i)
  if (!m) return ''
  return m[1]
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&[a-z]+;|&#\d+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 140)
}

/** Load a source: does it resolve, and what is its page title? */
async function defaultCheckUrl(url) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TNV-link-check/1.0)' },
    })
    // 401/403/429 usually mean bot protection on a page that exists.
    const ok = res.status < 400 || res.status === 401 || res.status === 403 || res.status === 429
    let title = ''
    if (res.ok && /html/i.test(res.headers.get('content-type') || '')) {
      title = pageTitle((await res.text()).slice(0, 60000))
    }
    return { ok, title }
  } catch {
    return { ok: false, title: '' }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Build externalLinks from claim + Where Things Stand sources.
 * @returns { externalLinks: [{ label, url, addedAt, kind }], dropped: [{ url, reason }] }
 */
export async function sourcesToExternalLinks(
  { claimSources = [], whereThingsStandSources = [] },
  { checkUrl = defaultCheckUrl, ownHost = '', today = new Date().toISOString().slice(0, 10) } = {}
) {
  const candidates = [
    ...normalizeClaimSources(claimSources).map((s) => ({ url: s.url, label: s.claim, kind: 'claim' })),
    ...normalizeClaimSources(whereThingsStandSources).map((s) => ({
      url: s.url,
      label: s.claim,
      kind: 'where-things-stand',
    })),
  ]
  const seen = new Set()
  const unique = []
  const dropped = []
  for (const c of candidates) {
    const key = c.url.replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    const host = hostOf(c.url)
    if (!host) {
      dropped.push({ url: c.url, reason: 'invalid URL' })
      continue
    }
    if (BLOCKED_HOSTS.some((b) => host === b || host.endsWith(`.${b}`))) {
      dropped.push({ url: c.url, reason: 'social or forum site' })
      continue
    }
    if (ownHost && (host === ownHost || host.endsWith(`.${ownHost}`))) {
      dropped.push({ url: c.url, reason: 'own site' })
      continue
    }
    unique.push(c)
  }
  const checks = await Promise.all(
    unique.map((c) =>
      Promise.resolve(checkUrl(c.url))
        .then((r) => (typeof r === 'object' && r ? r : { ok: Boolean(r), title: '' }))
        .catch(() => ({ ok: false, title: '' }))
    )
  )
  const externalLinks = []
  unique.forEach((c, i) => {
    if (!checks[i].ok) {
      dropped.push({ url: c.url, reason: 'did not load' })
      return
    }
    externalLinks.push({
      // The page's own title reads as a citation; the claim text does not.
      label: (checks[i].title || hostOf(c.url)).slice(0, 140),
      url: c.url,
      addedAt: today,
      kind: c.kind,
    })
  })
  return { externalLinks, dropped }
}
