import { checkJsonLd } from '../jsonld.js'
import { apexDomain, originFromUrl } from '../domain.js'

const FETCH_HEADERS = {
  Accept: 'text/html,application/xhtml+xml,text/plain,application/xml,*/*',
  'User-Agent': 'TheNightVentures-AuditSnapshot/1.0',
}

async function fetchText(url, signal) {
  const res = await fetch(url, {
    method: 'GET',
    signal,
    headers: FETCH_HEADERS,
    redirect: 'follow',
  })
  const text = await res.text()
  return { res, text, finalUrl: res.url || url }
}

function metaContent(html, nameOrProp, attr = 'name') {
  const re = new RegExp(
    `<meta[^>]+${attr}\\s*=\\s*["']${nameOrProp}["'][^>]*content\\s*=\\s*["']([^"']*)["'][^>]*>`,
    'i'
  )
  const re2 = new RegExp(
    `<meta[^>]+content\\s*=\\s*["']([^"']*)["'][^>]*${attr}\\s*=\\s*["']${nameOrProp}["'][^>]*>`,
    'i'
  )
  const m = html.match(re) || html.match(re2)
  return m ? String(m[1] || '').trim() : null
}

function tagContent(html, tag) {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i')
  const m = html.match(re)
  return m ? String(m[1] || '').replace(/\s+/g, ' ').trim() : null
}

function linkHref(html, rel) {
  const re = new RegExp(
    `<link[^>]+rel\\s*=\\s*["']${rel}["'][^>]*href\\s*=\\s*["']([^"']+)["'][^>]*>`,
    'i'
  )
  const re2 = new RegExp(
    `<link[^>]+href\\s*=\\s*["']([^"']+)["'][^>]*rel\\s*=\\s*["']${rel}["'][^>]*>`,
    'i'
  )
  const m = html.match(re) || html.match(re2)
  return m ? String(m[1] || '').trim() : null
}

function checkCanonical(canonical, siteUrl) {
  if (!canonical) {
    return { pass: false, finding: 'canonical: missing' }
  }
  const apex = apexDomain(siteUrl)
  let host = ''
  try {
    host = apexDomain(canonical.startsWith('http') ? canonical : `https://${canonical}`)
  } catch {
    host = ''
  }
  if (!host) {
    return { pass: false, finding: `canonical: present but unparseable (${canonical})` }
  }
  if (host !== apex) {
    return {
      pass: false,
      finding: `canonical: points to ${host}, expected ${apex}`,
    }
  }
  return { pass: true, finding: `canonical: present and matches domain (${canonical})` }
}

function checkTitle(title) {
  if (!title) return { pass: false, finding: 'title: missing' }
  const len = title.length
  if (len < 10) {
    return { pass: false, finding: `title: ${len} characters — too short` }
  }
  if (len > 70) {
    return {
      pass: false,
      finding: `title: ${len} characters — longer than ~60–70 recommended`,
    }
  }
  return { pass: true, finding: `title: ${len} characters — in range ("${title.slice(0, 60)}${len > 60 ? '…' : ''}")` }
}

function checkDescription(desc) {
  if (!desc) return { pass: false, finding: 'description: missing' }
  const len = desc.length
  if (len < 50) {
    return { pass: false, finding: `description: ${len} characters — too short` }
  }
  if (len > 170) {
    return {
      pass: false,
      finding: `description: ${len} characters — longer than ~155–160 recommended`,
    }
  }
  return { pass: true, finding: `description: ${len} characters — in range` }
}

function checkRobotsMeta(robots) {
  if (!robots) {
    return {
      pass: true,
      finding: 'robots meta: absent (defaults to index,follow — OK)',
    }
  }
  const lower = robots.toLowerCase()
  if (lower.includes('noindex')) {
    return { pass: false, finding: `robots meta: "${robots}" — blocks indexing` }
  }
  return { pass: true, finding: `robots meta: "${robots}" — OK` }
}

function checkOgTags(html) {
  const ogTitle = metaContent(html, 'og:title', 'property')
  const ogDesc = metaContent(html, 'og:description', 'property')
  const ogImage = metaContent(html, 'og:image', 'property')
  const ogUrl = metaContent(html, 'og:url', 'property')
  const present = [ogTitle, ogDesc, ogImage, ogUrl].filter(Boolean).length
  if (present === 0) {
    return { pass: false, finding: 'OG tags: none of og:title/description/image/url present' }
  }
  if (present < 3) {
    return {
      pass: false,
      finding: `OG tags: ${present}/4 core tags present (title=${Boolean(ogTitle)}, description=${Boolean(ogDesc)}, image=${Boolean(ogImage)}, url=${Boolean(ogUrl)})`,
    }
  }
  return {
    pass: true,
    finding: `OG tags: ${present}/4 core tags present`,
  }
}

function countLocTags(xml) {
  const matches = String(xml || '').match(/<loc\b[^>]*>[\s\S]*?<\/loc>/gi) || []
  return matches.length
}

function extractLocUrls(xml) {
  const urls = []
  const re = /<loc\b[^>]*>([\s\S]*?)<\/loc>/gi
  let m
  while ((m = re.exec(xml)) !== null) {
    const u = String(m[1] || '').trim()
    if (u) urls.push(u)
  }
  return urls
}

function sitemapDomainOk(urls, apex) {
  if (!urls.length) return { ok: false, reason: 'no <loc> URLs found' }
  const bad = urls.filter((u) => {
    const host = apexDomain(u)
    if (!host) return true
    if (host === 'example.com' || host.endsWith('.example.com')) return true
    return host !== apex && !host.endsWith(`.${apex}`)
  })
  if (bad.length === 0) return { ok: true, reason: `all ${urls.length} URLs match ${apex}` }
  return {
    ok: false,
    reason: `${bad.length} URL(s) do not match ${apex} (e.g. ${bad[0]})`,
  }
}

async function checkHomepage({ siteUrl, signal }) {
  try {
    const { res, text, finalUrl } = await fetchText(siteUrl, signal)
    if (!res.ok) {
      return {
        pass: false,
        checks: [
          {
            id: 'homepage_fetch',
            pass: false,
            finding: `homepage: fetch failed (${res.status})`,
          },
        ],
        finalUrl,
      }
    }

    const title = tagContent(text, 'title')
    const description = metaContent(text, 'description', 'name')
    const canonical = linkHref(text, 'canonical')
    const robots = metaContent(text, 'robots', 'name')

    const checks = [
      { id: 'title', ...checkTitle(title) },
      { id: 'description', ...checkDescription(description) },
      { id: 'canonical', ...checkCanonical(canonical, siteUrl) },
      { id: 'og_tags', ...checkOgTags(text) },
      { id: 'robots_meta', ...checkRobotsMeta(robots) },
    ]

    return {
      pass: checks.every((c) => c.pass),
      checks,
      finalUrl,
      extracted: { title, description, canonical, robots },
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return {
      pass: false,
      checks: [
        {
          id: 'homepage_fetch',
          pass: false,
          finding: `homepage: ${err?.message || 'fetch failed'}`,
        },
      ],
    }
  }
}

async function checkSitemap({ siteUrl, signal }) {
  const origin = originFromUrl(siteUrl)
  const apex = apexDomain(siteUrl)
  const indexUrl = `${origin}/sitemap-index.xml`

  try {
    const { res, text } = await fetchText(indexUrl, signal)
    if (!res.ok) {
      return {
        pass: false,
        checks: [
          {
            id: 'sitemap_index',
            pass: false,
            finding: `sitemap-index.xml: failed to resolve (${res.status}) at ${indexUrl}`,
          },
        ],
        sitemapIndexUrl: indexUrl,
      }
    }

    const childSitemaps = extractLocUrls(text)
    const checks = [
      {
        id: 'sitemap_index',
        pass: true,
        finding: `sitemap-index.xml: resolves (${childSitemaps.length} child sitemap URL(s))`,
      },
    ]

    let urlCount = 0
    let domainCheck = { ok: false, reason: 'no sub-sitemap fetched' }
    const sampleChild = childSitemaps[0]

    if (sampleChild) {
      try {
        const child = await fetchText(sampleChild, signal)
        if (child.res.ok) {
          const locs = extractLocUrls(child.text)
          urlCount = locs.length
          domainCheck = sitemapDomainOk(locs.slice(0, 50), apex)
          checks.push({
            id: 'sitemap_urls',
            pass: urlCount > 0,
            finding:
              urlCount > 0
                ? `sub-sitemap: ${urlCount} URL(s) in first child sitemap`
                : 'sub-sitemap: resolved but contained 0 <loc> URLs',
          })
          checks.push({
            id: 'sitemap_domain',
            pass: domainCheck.ok,
            finding: `sitemap domain: ${domainCheck.reason}`,
          })
        } else {
          checks.push({
            id: 'sitemap_urls',
            pass: false,
            finding: `sub-sitemap: failed to fetch child (${child.res.status})`,
          })
        }
      } catch (err) {
        if (err?.name === 'AbortError') throw err
        checks.push({
          id: 'sitemap_urls',
          pass: false,
          finding: `sub-sitemap: ${err?.message || 'fetch failed'}`,
        })
      }
    } else {
      // Index itself may be a urlset
      urlCount = countLocTags(text)
      domainCheck = sitemapDomainOk(extractLocUrls(text).slice(0, 50), apex)
      checks.push({
        id: 'sitemap_urls',
        pass: urlCount > 0,
        finding:
          urlCount > 0
            ? `sitemap-index.xml appears to be a urlset with ${urlCount} URL(s)`
            : 'sitemap-index.xml: no child sitemaps or URL locs found',
      })
      checks.push({
        id: 'sitemap_domain',
        pass: domainCheck.ok,
        finding: `sitemap domain: ${domainCheck.reason}`,
      })
    }

    return {
      pass: checks.every((c) => c.pass),
      checks,
      sitemapIndexUrl: indexUrl,
      childSitemapCount: childSitemaps.length,
      urlCount,
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return {
      pass: false,
      checks: [
        {
          id: 'sitemap_index',
          pass: false,
          finding: `sitemap-index.xml: ${err?.message || 'fetch failed'}`,
        },
      ],
      sitemapIndexUrl: indexUrl,
    }
  }
}

async function checkRobotsTxt({ siteUrl, signal }) {
  const origin = originFromUrl(siteUrl)
  const apex = apexDomain(siteUrl)
  const robotsUrl = `${origin}/robots.txt`
  const expectedSitemap = `${origin}/sitemap-index.xml`

  try {
    const { res, text } = await fetchText(robotsUrl, signal)
    if (!res.ok) {
      return {
        pass: false,
        checks: [
          {
            id: 'robots_fetch',
            pass: false,
            finding: `robots.txt: failed to resolve (${res.status})`,
          },
        ],
        robotsUrl,
      }
    }

    const sitemapLines = String(text)
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^sitemap\s*:/i.test(l))
      .map((l) => l.replace(/^sitemap\s*:\s*/i, '').trim())
      .filter(Boolean)

    const checks = [
      {
        id: 'robots_fetch',
        pass: true,
        finding: `robots.txt: resolves (${text.length} bytes)`,
      },
    ]

    if (sitemapLines.length === 0) {
      checks.push({
        id: 'robots_sitemap',
        pass: false,
        finding: `robots.txt: no Sitemap: directive (expected ${expectedSitemap})`,
      })
    } else {
      const match = sitemapLines.some((u) => {
        const host = apexDomain(u)
        return host === apex || u.replace(/\/+$/, '') === expectedSitemap.replace(/\/+$/, '')
      })
      checks.push({
        id: 'robots_sitemap',
        pass: match,
        finding: match
          ? `robots.txt: references sitemap for ${apex} (${sitemapLines[0]})`
          : `robots.txt: Sitemap URL(s) do not match domain — found ${sitemapLines.join(', ')}`,
      })
    }

    return {
      pass: checks.every((c) => c.pass),
      checks,
      robotsUrl,
      sitemapDirectives: sitemapLines,
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw err
    return {
      pass: false,
      checks: [
        {
          id: 'robots_fetch',
          pass: false,
          finding: `robots.txt: ${err?.message || 'fetch failed'}`,
        },
      ],
      robotsUrl,
    }
  }
}

async function checkArticleJsonLd({ sampleUrl, signal }) {
  const jsonld = await checkJsonLd({ sampleUrl, signal })
  if (!jsonld.ok) {
    return {
      pass: false,
      checks: [
        {
          id: 'jsonld',
          pass: false,
          finding: jsonld.error || 'JSON-LD check failed',
        },
      ],
      jsonld,
    }
  }

  const expected = ['Organization', 'Article', 'Person', 'BreadcrumbList']
  const checks = expected.map((type) => {
    const info = jsonld.types?.[type]
    const present = Boolean(info?.present)
    return {
      id: `jsonld_${type}`,
      pass: present,
      finding: present
        ? `JSON-LD @type ${type}: present${info?.matchedAs && info.matchedAs !== type ? ` (as ${info.matchedAs})` : ''}`
        : `JSON-LD @type ${type}: missing`,
    }
  })

  checks.unshift({
    id: 'jsonld_valid',
    pass: Boolean(jsonld.allBlocksValidJson),
    finding: jsonld.allBlocksValidJson
      ? `JSON-LD: ${jsonld.blockCount} script(s), all valid JSON`
      : `JSON-LD: ${jsonld.parseFailures || 0} parse error(s) across ${jsonld.blockCount || 0} script(s)`,
  })

  return {
    pass: checks.every((c) => c.pass),
    checks,
    jsonld,
  }
}

/**
 * First-party technical checks: homepage meta, sitemap-index, robots.txt, article JSON-LD.
 */
export async function runTechnicalPanel({ siteUrl, sampleUrl, signal }) {
  try {
    const homepage = await checkHomepage({ siteUrl, signal })
    const sitemap = await checkSitemap({ siteUrl, signal })
    const robots = await checkRobotsTxt({ siteUrl, signal })
    const jsonld = await checkArticleJsonLd({ sampleUrl, signal })

    const checks = [
      ...(homepage.checks || []),
      ...(sitemap.checks || []),
      ...(robots.checks || []),
      ...(jsonld.checks || []),
    ]

    return {
      ok: true,
      panel: 'technical',
      siteUrl,
      sampleUrl: sampleUrl || null,
      pass: checks.every((c) => c.pass),
      checks,
      homepage,
      sitemap,
      robots,
      jsonld: jsonld.jsonld || null,
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'Technical checks timed out', panel: 'technical' }
    }
    return {
      ok: false,
      error: err?.message || 'Technical checks failed',
      panel: 'technical',
    }
  }
}
