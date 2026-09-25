import { judgeApi } from './judge.js'
import { normalizeToJpeg } from './normalize.js'
import * as unsplash from './providers/unsplash.js'
import * as shutterstock from './providers/shutterstock.js'

const PROVIDERS = {
  unsplash,
  shutterstock,
}

const SKIP_AFTER_MS = 35000

function providerOrder() {
  const raw = String(process.env.IMAGE_STOCK_ORDER || 'unsplash,shutterstock')
  return raw
    .split(',')
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean)
}

function record(trail, entry) {
  trail.push(entry)
  const bits = [`[image-sourcing] ${entry.provider} ${entry.outcome}`]
  if (entry.reason) bits.push(entry.reason)
  if (entry.score != null) bits.push(`score=${entry.score}`)
  const line = bits.join(' ')
  if (entry.outcome === 'error' || entry.outcome === 'judge_error') {
    console.error(line)
  } else {
    console.info(line)
  }
}

async function gatherCandidates(provider, queries, excludeIds) {
  const first = await provider.search(queries[0] || '', excludeIds)
  let merged = first.filter((item) => item?.thumbUrl)
  if (merged.length < 3 && queries[1]) {
    const second = await provider.search(queries[1], excludeIds)
    const seen = new Set(merged.map((item) => item.id))
    for (const item of second) {
      if (!item?.thumbUrl || !item.id || seen.has(item.id)) continue
      seen.add(item.id)
      merged.push(item)
    }
  }
  return merged.slice(0, 8)
}

export async function findStockImage({
  title,
  description,
  keyword,
  articleType,
  styleContext,
  excludeIds = [],
} = {}) {
  const started = Date.now()
  const trail = []
  const order = providerOrder()
  const article = {
    title: String(title || '').trim(),
    description: String(description || '').trim(),
    keyword: String(keyword || '').trim(),
    articleType: String(articleType || '').trim(),
  }
  const excluded = (Array.isArray(excludeIds) ? excludeIds : [])
    .map((id) => String(id))
    .filter(Boolean)

  if (!String(process.env.ANTHROPIC_API_KEY || '').trim()) {
    for (const name of order) {
      if (!PROVIDERS[name]) continue
      record(trail, {
        provider: name,
        outcome: 'skipped',
        reason: 'ANTHROPIC_API_KEY missing',
      })
    }
    return { found: false, trail }
  }

  let queries = []
  try {
    const built = await judgeApi.buildQueries(article)
    queries = Array.isArray(built?.queries) ? built.queries.filter(Boolean) : []
  } catch (err) {
    console.error('[image-sourcing] query generation failed:', err?.message || err)
  }
  if (queries.length === 0) {
    const fallback = article.keyword || article.title
    if (fallback) queries = [fallback]
  }

  for (const name of order) {
    const provider = PROVIDERS[name]
    if (!provider) continue

    if (Date.now() - started > SKIP_AFTER_MS) {
      record(trail, { provider: name, outcome: 'skipped', reason: 'time_budget' })
      continue
    }

    if (!provider.isConfigured()) {
      record(trail, { provider: name, outcome: 'not_configured' })
      continue
    }

    try {
      const candidates = await gatherCandidates(provider, queries, excluded)
      if (candidates.length === 0) {
        record(trail, { provider: name, outcome: 'no_results' })
        continue
      }

      let verdict
      try {
        verdict = await judgeApi.judgeCandidates({
          article,
          styleContext: String(styleContext || ''),
          candidates: candidates.map((item) => ({
            id: item.id,
            thumbUrl: item.thumbUrl,
            description: item.description || '',
          })),
        })
      } catch (err) {
        record(trail, {
          provider: name,
          outcome: 'judge_error',
          reason: err?.message || 'judge failed',
        })
        continue
      }

      if (!verdict?.accepted) {
        record(trail, {
          provider: name,
          outcome: 'no_fit',
          score: verdict?.score,
          reason: verdict?.reason || '',
        })
        continue
      }

      const winner = candidates[verdict.bestIndex]
      const bytes = await provider.fetchWinner(winner)
      const b64_json = await normalizeToJpeg(bytes)
      record(trail, { provider: name, outcome: 'used', score: verdict.score })
      return {
        found: true,
        b64_json,
        mime: 'image/jpeg',
        source: name,
        sourceId: winner.id,
        attribution: winner.attribution || null,
        altText: verdict.altText || '',
        trail,
      }
    } catch (err) {
      record(trail, {
        provider: name,
        outcome: 'error',
        reason: err?.message || 'provider failed',
      })
    }
  }

  return { found: false, trail }
}
