const EXPECTED_TYPES = [
  { key: 'Organization', aliases: ['Organization'] },
  { key: 'Article', aliases: ['Article', 'BlogPosting'] },
  { key: 'Person', aliases: ['Person'] },
  { key: 'BreadcrumbList', aliases: ['BreadcrumbList'] },
]

function collectTypes(node, out = new Set()) {
  if (!node) return out
  if (Array.isArray(node)) {
    for (const item of node) collectTypes(item, out)
    return out
  }
  if (typeof node !== 'object') return out

  const typeVal = node['@type']
  if (typeof typeVal === 'string') {
    out.add(typeVal)
  } else if (Array.isArray(typeVal)) {
    for (const t of typeVal) {
      if (typeof t === 'string') out.add(t)
    }
  }

  if (node['@graph']) collectTypes(node['@graph'], out)

  return out
}

function extractJsonLdBlocks(html) {
  const blocks = []
  const re =
    /<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  let match
  while ((match = re.exec(html)) !== null) {
    const raw = String(match[1] || '').trim()
    if (raw) blocks.push(raw)
  }
  return blocks
}

/**
 * Fetch a page and validate JSON-LD script tags.
 * Soft-fails at the top level; per-block parse errors are recorded.
 */
export async function checkJsonLd({ sampleUrl, signal }) {
  if (!sampleUrl) {
    return {
      ok: false,
      error: 'No sample URL available for JSON-LD check',
      expectedTypes: EXPECTED_TYPES.map((t) => t.key),
    }
  }

  try {
    const res = await fetch(sampleUrl, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'text/html,application/xhtml+xml',
        'User-Agent': 'TheNightVentures-AuditSnapshot/1.0',
      },
      redirect: 'follow',
    })

    if (!res.ok) {
      return {
        ok: false,
        error: `Failed to fetch sample URL (${res.status})`,
        sampleUrl,
        status: res.status,
        expectedTypes: EXPECTED_TYPES.map((t) => t.key),
      }
    }

    const html = await res.text()
    const rawBlocks = extractJsonLdBlocks(html)
    const blocks = []
    const foundTypes = new Set()
    let parseFailures = 0

    for (let i = 0; i < rawBlocks.length; i += 1) {
      const raw = rawBlocks[i]
      try {
        const parsed = JSON.parse(raw)
        const types = [...collectTypes(parsed)]
        for (const t of types) foundTypes.add(t)
        blocks.push({ index: i, validJson: true, types })
      } catch (err) {
        parseFailures += 1
        blocks.push({
          index: i,
          validJson: false,
          error: err?.message || 'Invalid JSON',
          types: [],
        })
      }
    }

    const types = {}
    for (const expected of EXPECTED_TYPES) {
      const present = expected.aliases.some((alias) => foundTypes.has(alias))
      types[expected.key] = {
        present,
        matchedAs: expected.aliases.find((a) => foundTypes.has(a)) || null,
      }
    }

    return {
      ok: true,
      sampleUrl,
      blockCount: rawBlocks.length,
      parseFailures,
      allBlocksValidJson: rawBlocks.length > 0 && parseFailures === 0,
      foundTypes: [...foundTypes].sort(),
      types,
      blocks,
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return {
        ok: false,
        error: 'JSON-LD fetch timed out',
        sampleUrl,
        expectedTypes: EXPECTED_TYPES.map((t) => t.key),
      }
    }
    return {
      ok: false,
      error: err?.message || 'JSON-LD check failed',
      sampleUrl,
      expectedTypes: EXPECTED_TYPES.map((t) => t.key),
    }
  }
}

export { EXPECTED_TYPES }
