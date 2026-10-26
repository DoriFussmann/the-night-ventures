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

/** Numbers that read as statistics: 42%, $4.1 million, 3x, 1 in 5, 2,300 founders. */
export function countStatistics(body) {
  const main = String(body || '').split(/^## Where Things Stand/m)[0]
  const patterns = [
    /\b\d+(?:\.\d+)?\s?%/g,
    /\$\s?\d[\d,.]*\s?(?:k|m|bn|b|million|billion|thousand)?\b/gi,
    /\b\d+(?:\.\d+)?x\b/gi,
    /\b\d+\s+(?:in|out of)\s+\d+\b/gi,
  ]
  return patterns.reduce((n, re) => n + (main.match(re) || []).length, 0)
}

export function claimSourceErrors(body, claimSources) {
  const stats = countStatistics(body)
  if (stats > 0 && normalizeClaimSources(claimSources).length === 0) {
    return [
      `The body contains ${stats} statistic${stats === 1 ? '' : 's'} but claimSources is empty. Add { url, claim } for each from a page you opened, or rewrite those sentences without the numbers.`,
    ]
  }
  return []
}

async function defaultCheckUrl(url) {
  const attempt = async (method) => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 6000)
    try {
      const res = await fetch(url, {
        method,
        redirect: 'follow',
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TNV-link-check/1.0)' },
      })
      return res.status
    } finally {
      clearTimeout(timer)
    }
  }
  try {
    let status = await attempt('HEAD')
    // Many sites refuse HEAD; confirm with GET before calling it broken.
    if (status >= 400) status = await attempt('GET')
    // 401/403/429 usually mean bot protection on a page that exists.
    return status < 400 || status === 401 || status === 403 || status === 429
  } catch {
    return false
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
  const checks = await Promise.all(unique.map((c) => checkUrl(c.url).catch(() => false)))
  const externalLinks = []
  unique.forEach((c, i) => {
    if (!checks[i]) {
      dropped.push({ url: c.url, reason: 'did not load' })
      return
    }
    externalLinks.push({
      label: (c.label || hostOf(c.url)).slice(0, 140),
      url: c.url,
      addedAt: today,
      kind: c.kind,
    })
  })
  return { externalLinks, dropped }
}
