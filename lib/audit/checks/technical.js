// Technical & Infrastructure category: on-page technical implementation (lang,
// viewport, duplicate head tags, social metadata, image alt, mixed content),
// international SEO (hreflang) and infrastructure (TLS, HSTS and security headers,
// compression, response time, asset caching).
// Pure: extractTechnicalFacts(html, ...) per page; buildTechnicalIssues(pages, ws).

import { makeIssue, dedupeIssues } from '../issues.js'
import { parseAttrs, normalizeUrl } from '../pageFacts.js'

const CATEGORY = 'technical'

export const TTFB_GOOD_MS = 800
export const TLS_WARN_DAYS = 30
export const TLS_URGENT_DAYS = 14
const ASSET_CACHE_MIN_SECONDS = 7 * 24 * 3600
const MAX_SAMPLES = 5

function tagsOf(html, name) {
  const re = new RegExp(`<${name}\\b[^>]*>`, 'gi')
  return String(html || '').match(re) || []
}

function metaMap(html) {
  const out = []
  for (const tag of tagsOf(html, 'meta')) {
    const a = parseAttrs(tag)
    const key = String(a.name || a.property || a['http-equiv'] || (a.charset != null ? 'charset' : '')).toLowerCase()
    if (key) out.push({ key, content: String(a.content ?? a.charset ?? '') })
  }
  return out
}

function headOf(html) {
  const m = String(html || '').match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)
  return m ? m[1] : String(html || '')
}

/** Valid BCP 47-ish hreflang value (language[-script][-region]) or x-default. */
export function isValidHreflang(value) {
  const v = String(value || '').trim()
  return v.toLowerCase() === 'x-default' || /^[a-z]{2,3}(-[A-Za-z]{4})?(-([A-Za-z]{2}|\d{3}))?$/i.test(v)
}

/**
 * Technical facts for one HTML page.
 * @param {string} html
 * @param {{ url: string }} ctx
 */
export function extractTechnicalFacts(html, { url }) {
  const source = String(html || '')
  const head = headOf(source)
  const metas = metaMap(head)
  const metaValues = (key) => metas.filter((m) => m.key === key).map((m) => m.content)

  const htmlTag = source.match(/<html\b[^>]*>/i)
  const lang = htmlTag ? String(parseAttrs(htmlTag[0]).lang || '').trim() : ''

  const viewport = metaValues('viewport')[0] || ''
  const titleCount = (head.match(/<title\b/gi) || []).length
  const descriptionCount = metaValues('description').length

  const canonicals = []
  const hreflang = []
  for (const tag of tagsOf(head, 'link')) {
    const a = parseAttrs(tag)
    const rel = String(a.rel || '').toLowerCase().split(/\s+/)
    if (rel.includes('canonical') && a.href) canonicals.push(normalizeUrl(a.href, url) || a.href)
    if (rel.includes('alternate') && a.hreflang && a.href) {
      hreflang.push({ lang: String(a.hreflang).trim(), href: normalizeUrl(a.href, url) || a.href })
    }
  }

  const og = {
    title: Boolean(metaValues('og:title')[0]),
    description: Boolean(metaValues('og:description')[0]),
    image: Boolean(metaValues('og:image')[0]),
    url: Boolean(metaValues('og:url')[0]),
  }
  const twitterCard = Boolean(metaValues('twitter:card')[0])

  let imagesMissingAlt = 0
  let images = 0
  for (const tag of tagsOf(source, 'img')) {
    const a = parseAttrs(tag)
    if (String(a['aria-hidden']).toLowerCase() === 'true' || String(a.role).toLowerCase() === 'presentation') continue
    images += 1
    if (!Object.prototype.hasOwnProperty.call(a, 'alt')) imagesMissingAlt += 1
  }

  const isHttps = /^https:/i.test(url)
  const mixed = { active: [], passive: [] }
  if (isHttps) {
    const scan = (name, attr, bucket, filter) => {
      for (const tag of tagsOf(source, name)) {
        const a = parseAttrs(tag)
        if (filter && !filter(a)) continue
        const value = String(a[attr] || '')
        if (/^http:\/\//i.test(value) && mixed[bucket].length < MAX_SAMPLES) mixed[bucket].push(value.slice(0, 200))
      }
    }
    scan('script', 'src', 'active')
    scan('iframe', 'src', 'active')
    scan('link', 'href', 'active', (a) => String(a.rel || '').toLowerCase().includes('stylesheet'))
    scan('img', 'src', 'passive')
    scan('source', 'src', 'passive')
    scan('video', 'src', 'passive')
    scan('audio', 'src', 'passive')
  }

  const assets = []
  for (const tag of tagsOf(head, 'link')) {
    const a = parseAttrs(tag)
    if (String(a.rel || '').toLowerCase().includes('stylesheet') && a.href) assets.push(normalizeUrl(a.href, url) || a.href)
  }
  for (const tag of tagsOf(source, 'script')) {
    const a = parseAttrs(tag)
    if (a.src) assets.push(normalizeUrl(a.src, url) || a.src)
  }

  return {
    lang,
    viewport,
    titleCount,
    descriptionCount,
    canonicals: [...new Set(canonicals)],
    canonicalTagCount: canonicals.length,
    hreflang,
    og,
    twitterCard,
    images,
    imagesMissingAlt,
    mixed,
    assets: assets.filter((a) => /^https?:\/\//i.test(a)).slice(0, 10),
  }
}

/** Seconds of browser caching from a Cache-Control value (0 when none). */
export function cacheSeconds(cacheControl) {
  const v = String(cacheControl || '').toLowerCase()
  if (!v || /no-store|no-cache/.test(v)) return 0
  if (v.includes('immutable')) return Number.MAX_SAFE_INTEGER
  const m = v.match(/(?:^|[,\s])max-age=(\d+)/)
  return m ? Number(m[1]) : 0
}

function sameUrl(a, b) {
  const norm = (u) => String(u || '').replace(/[#?].*$/, '').replace(/\/+$/, '').toLowerCase()
  return norm(a) === norm(b)
}

/**
 * @param {Array<{ url: string, kind?: string, status?: number, error?: string|null, facts: any }>} pages
 * @param {{ site?: any }} workspace
 * @returns {{ issues: any[], metrics: Record<string, any> }}
 */
export function buildTechnicalIssues(pages, workspace = {}) {
  const issues = []
  const add = (input) => issues.push(makeIssue({ category: CATEGORY, ...input }))
  const ok = (pages || []).filter((p) => p.facts)
  const site = workspace.site || {}

  // ---- page level
  let hreflangPages = 0
  const hreflangMap = new Map()
  for (const page of ok) {
    const f = page.facts
    const url = page.url
    if (!f.lang) {
      add({ checkId: 'lang_missing', severity: 'medium', title: 'No language declared (<html lang>)', url,
        fixHint: 'Set lang on the <html> element, e.g. <html lang="en">.' })
    }
    if (!/width\s*=\s*device-width/i.test(f.viewport)) {
      add({ checkId: 'viewport_missing', severity: 'high', title: 'No mobile viewport meta tag', url,
        detail: f.viewport ? `viewport is "${f.viewport}"` : '',
        fixHint: 'Add <meta name="viewport" content="width=device-width, initial-scale=1">.' })
    }
    if (f.titleCount > 1 || f.descriptionCount > 1) {
      add({ checkId: 'duplicate_head_tags', severity: 'medium', title: 'Several <title> or meta description tags', url,
        detail: `${f.titleCount} title, ${f.descriptionCount} description tag(s).`,
        fixHint: 'Render exactly one <title> and one meta description per page.' })
    }
    if (f.canonicals.length > 1) {
      add({ checkId: 'canonical_conflict', severity: 'high', title: 'Conflicting canonical tags', url,
        detail: f.canonicals.slice(0, 3).join(' · '), evidence: { canonicals: f.canonicals.slice(0, 5) },
        fixHint: 'Keep one canonical link; search engines may ignore all of them when they disagree.' })
    }
    if (!f.og.title || !f.og.image) {
      const missing = [!f.og.title && 'og:title', !f.og.description && 'og:description', !f.og.image && 'og:image'].filter(Boolean)
      add({ checkId: 'social_meta_missing', severity: 'low', title: 'Open Graph tags missing', url,
        detail: `Missing ${missing.join(', ')}.`,
        fixHint: 'Add og:title, og:description and og:image so shared links and some AI previews render correctly.' })
    }
    if (f.imagesMissingAlt > 0) {
      add({ checkId: 'img_alt_missing', severity: 'low', title: 'Images without an alt attribute', url,
        detail: `${f.imagesMissingAlt} of ${f.images} image(s).`,
        fixHint: 'Give every content image an alt text; use alt="" for purely decorative images.' })
    }
    if (f.mixed.active.length || f.mixed.passive.length) {
      const active = f.mixed.active.length > 0
      add({ checkId: 'mixed_content', severity: active ? 'high' : 'medium',
        title: active ? 'HTTPS page loads scripts/styles over HTTP' : 'HTTPS page loads media over HTTP', url,
        detail: [...f.mixed.active, ...f.mixed.passive].slice(0, 3).join(' · '),
        evidence: { active: f.mixed.active, passive: f.mixed.passive },
        fixHint: 'Serve every resource over https://; browsers block active mixed content.' })
    }
    if (f.hreflang.length) {
      hreflangPages += 1
      hreflangMap.set(url, f)
    }
  }

  // ---- hreflang (only when the site uses it)
  for (const [url, f] of hreflangMap) {
    const invalid = f.hreflang.filter((h) => !isValidHreflang(h.lang))
    if (invalid.length) {
      add({ checkId: 'hreflang_invalid', severity: 'medium', title: 'Invalid hreflang codes', url,
        detail: invalid.slice(0, 3).map((h) => h.lang).join(', '),
        fixHint: 'Use ISO 639-1 language codes with optional ISO 3166-1 region, e.g. en, en-GB, or x-default.' })
    }
    if (!f.hreflang.some((h) => sameUrl(h.href, url))) {
      add({ checkId: 'hreflang_no_self', severity: 'medium', title: 'hreflang set has no self-reference', url,
        fixHint: 'Each page should list itself in its own hreflang set.' })
    }
    if (f.canonicals.length && !f.canonicals.some((c) => sameUrl(c, url))) {
      add({ checkId: 'hreflang_on_non_canonical', severity: 'medium', title: 'hreflang on a page that canonicalizes elsewhere', url,
        fixHint: 'Put hreflang only on canonical URLs; point alternates at canonical URLs.' })
    }
    for (const alt of f.hreflang) {
      if (sameUrl(alt.href, url)) continue
      const target = [...hreflangMap.entries()].find(([u]) => sameUrl(u, alt.href))
      if (target && !target[1].hreflang.some((h) => sameUrl(h.href, url))) {
        add({ checkId: 'hreflang_not_reciprocal', severity: 'medium', title: 'hreflang alternate does not link back', url,
          detail: `${alt.lang} → ${alt.href}`,
          fixHint: 'Alternates must reference each other; one-way hreflang is ignored.' })
        break
      }
    }
  }

  // ---- site level
  const home = site.home || {}
  if (home.ok) {
    const h = home.headers || {}
    if (!h['strict-transport-security']) {
      add({ checkId: 'hsts_missing', severity: 'medium', title: 'No HSTS header', target: 'site:hsts',
        fixHint: 'Send Strict-Transport-Security: max-age=31536000; includeSubDomains (on Vercel it is on by default for custom domains).' })
    }
    const missingHeaders = []
    if (String(h['x-content-type-options'] || '').toLowerCase() !== 'nosniff') missingHeaders.push('X-Content-Type-Options: nosniff')
    if (!h['x-frame-options'] && !/frame-ancestors/i.test(String(h['content-security-policy'] || ''))) missingHeaders.push('X-Frame-Options or CSP frame-ancestors')
    if (!h['referrer-policy']) missingHeaders.push('Referrer-Policy')
    if (missingHeaders.length) {
      add({ checkId: 'security_headers_missing', severity: 'low', title: 'Recommended security headers missing', target: 'site:security-headers',
        detail: missingHeaders.join(' · '), evidence: { missing: missingHeaders },
        fixHint: 'Add the headers in vercel.json → headers (applies to every route).' })
    }
    if (!/\b(br|gzip|zstd|deflate)\b/i.test(String(h['content-encoding'] || ''))) {
      add({ checkId: 'compression_missing', severity: 'medium', title: 'HTML is not compressed', target: 'site:compression',
        fixHint: 'Enable gzip or Brotli on the server/CDN (Vercel compresses automatically).' })
    }
  }
  if (Number.isFinite(site.ttfbMs) && site.ttfbMs > TTFB_GOOD_MS) {
    add({ checkId: 'ttfb_slow', severity: site.ttfbMs > 1800 ? 'high' : 'medium', title: 'Slow server response (TTFB)', target: 'site:ttfb',
      detail: `Median ${site.ttfbMs} ms over ${site.ttfbSamples || 0} request(s) from our server (good ≤ ${TTFB_GOOD_MS} ms).`,
      evidence: { ttfbMs: site.ttfbMs, samples: site.ttfbSamples },
      fixHint: 'Serve HTML from a CDN/edge cache (static or ISR) instead of rendering per request.' })
  }
  if (site.tls?.ok && Number.isFinite(site.tls.daysLeft) && site.tls.daysLeft < TLS_WARN_DAYS) {
    add({ checkId: 'tls_expiring', severity: site.tls.daysLeft < TLS_URGENT_DAYS ? 'high' : 'medium',
      title: 'SSL certificate expires soon', target: 'site:tls',
      detail: `Expires in ${site.tls.daysLeft} day(s) (${site.tls.validTo}).`,
      fixHint: 'Renew the certificate or check that automatic renewal is working.' })
  }
  const shortCache = (site.assets || []).filter((a) => a.ok && cacheSeconds(a.cacheControl) < ASSET_CACHE_MIN_SECONDS)
  if (shortCache.length) {
    add({ checkId: 'asset_cache_short', severity: 'low', title: 'Static assets cached for less than 7 days', target: 'site:asset-cache',
      detail: shortCache.slice(0, 3).map((a) => `${a.url.split('/').pop()} (${a.cacheControl || 'no Cache-Control'})`).join(' · '),
      fixHint: 'Serve fingerprinted CSS/JS with Cache-Control: public, max-age=31536000, immutable.' })
  }

  const pagesFailed = (pages || []).length - ok.length
  return {
    issues: dedupeIssues(issues),
    metrics: {
      pagesChecked: ok.length,
      pagesFailed,
      hreflangPages,
      homeLoaded: Boolean(home.ok),
      ttfbMs: Number.isFinite(site.ttfbMs) ? site.ttfbMs : null,
      ttfbSamples: site.ttfbSamples || 0,
      tlsDaysLeft: site.tls?.ok ? site.tls.daysLeft : null,
      tlsIssuer: site.tls?.issuer || null,
      tlsChecked: Boolean(site.tls?.ok),
      compression: home.headers?.['content-encoding'] || null,
      hsts: Boolean(home.headers?.['strict-transport-security']),
      assetsChecked: (site.assets || []).filter((a) => a.ok).length,
      warnings: [
        ...(!home.ok ? ['The homepage did not load, so header and compression checks were skipped.'] : []),
        ...(!site.tls?.ok ? [`TLS certificate not read (${site.tls?.error || 'unavailable'}).`] : []),
      ],
    },
  }
}
