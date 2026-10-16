export const KNOWN_BOTS = [
  'Googlebot',
  'Google-Extended',
  'GPTBot',
  'OAI-SearchBot',
  'ChatGPT-User',
  'PerplexityBot',
  'Perplexity-User',
  'ClaudeBot',
  'Claude-User',
  'Claude-SearchBot',
  'Applebot-Extended',
  'CCBot',
  'Bingbot',
]

/**
 * Parse robots.txt into groups: [{ userAgents: string[], rules: [{ type, path }] }]
 */
export function parseRobotsTxt(text) {
  const groups = []
  let current = null

  const lines = String(text || '').split(/\r?\n/)
  for (const rawLine of lines) {
    const line = rawLine.replace(/#.*$/, '').trim()
    if (!line) continue

    const colon = line.indexOf(':')
    if (colon === -1) continue

    const field = line.slice(0, colon).trim().toLowerCase()
    const value = line.slice(colon + 1).trim()

    if (field === 'user-agent') {
      const ua = value
      // Consecutive User-agent lines share one rule block.
      if (current && current.rules.length === 0) {
        current.userAgents.push(ua)
      } else {
        current = { userAgents: [ua], rules: [] }
        groups.push(current)
      }
      continue
    }

    if (!current) continue

    if (field === 'allow' || field === 'disallow') {
      current.rules.push({ type: field, path: value })
    }
  }

  return groups
}

function normalizePath(path) {
  if (path == null || path === '') return ''
  return path
}

/**
 * Whether a Disallow rule blocks the whole site for crawling purposes.
 * Treats Disallow: / (and empty Disallow which means allow-all is NOT a block).
 */
function isSiteBlocked(rules) {
  // Empty Disallow means allow all — ignore.
  // Disallow: / means block all paths.
  const hasBlockAll = rules.some(
    (r) => r.type === 'disallow' && normalizePath(r.path) === '/'
  )
  if (!hasBlockAll) return false

  // Allow: / would reopen the site.
  const hasAllowAll = rules.some(
    (r) => r.type === 'allow' && normalizePath(r.path) === '/'
  )
  return !hasAllowAll
}

function matchingGroups(groups, botName) {
  const exact = []
  const wildcard = []
  const botLower = botName.toLowerCase()

  for (const group of groups) {
    for (const ua of group.userAgents) {
      const uaLower = ua.toLowerCase()
      if (uaLower === botLower) {
        exact.push(group)
        break
      }
      if (ua === '*') {
        wildcard.push(group)
      }
    }
  }

  // Specific UA rules take precedence over * when present.
  return exact.length > 0 ? exact : wildcard
}

export function evaluateBotAccess(robotsText) {
  const groups = parseRobotsTxt(robotsText)
  const bots = {}

  for (const bot of KNOWN_BOTS) {
    const matched = matchingGroups(groups, bot)
    if (matched.length === 0) {
      bots[bot] = {
        status: 'allowed',
        reason: 'No matching User-agent rules (default allow)',
        matchedUserAgent: null,
      }
      continue
    }

    // If any matching group blocks the whole site, treat as blocked.
    let blocked = false
    let matchedUa = matched[0]?.userAgents?.[0] || null
    for (const group of matched) {
      if (isSiteBlocked(group.rules)) {
        blocked = true
        matchedUa =
          group.userAgents.find(
            (ua) => ua.toLowerCase() === bot.toLowerCase()
          ) ||
          group.userAgents[0] ||
          matchedUa
        break
      }
    }

    bots[bot] = blocked
      ? {
          status: 'blocked',
          reason: 'Disallow: / for matching User-agent',
          matchedUserAgent: matchedUa,
        }
      : {
          status: 'allowed',
          reason: 'Matching rules do not block /',
          matchedUserAgent: matchedUa,
        }
  }

  return bots
}

function originFromSiteUrl(siteUrl) {
  const u = new URL(siteUrl)
  return `${u.protocol}//${u.host}`
}

/**
 * Fetch robots.txt and evaluate known bots. Soft-fails.
 */
export async function checkBotAccess({ siteUrl, signal }) {
  let robotsUrl
  try {
    robotsUrl = `${originFromSiteUrl(siteUrl)}/robots.txt`
  } catch {
    return { ok: false, error: 'Invalid site URL for robots.txt fetch' }
  }

  try {
    const res = await fetch(robotsUrl, {
      method: 'GET',
      signal,
      headers: {
        Accept: 'text/plain,*/*',
        'User-Agent': 'TheNightVentures-AuditSnapshot/1.0',
      },
      redirect: 'follow',
    })

    if (!res.ok) {
      return {
        ok: false,
        error: `Failed to fetch robots.txt (${res.status})`,
        robotsUrl,
        status: res.status,
      }
    }

    const text = await res.text()
    const bots = evaluateBotAccess(text)

    return {
      ok: true,
      robotsUrl,
      bots,
      rawLength: text.length,
    }
  } catch (err) {
    if (err?.name === 'AbortError') {
      return { ok: false, error: 'robots.txt fetch timed out', robotsUrl }
    }
    return {
      ok: false,
      error: err?.message || 'robots.txt fetch failed',
      robotsUrl,
    }
  }
}
