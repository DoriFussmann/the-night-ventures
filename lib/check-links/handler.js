import { requireAuth } from '../seo-advisor/auth.js'
import { resolveSiteUrl } from '../audit-snapshot/runPanel.js'
import { searchExternalLinks } from '../external-links/search.js'
import { checkProjectContract } from '../contract/projectContract.js'
import {
  MERGE_VIA_API,
  commitFiles,
  createOctokit,
  githubErrorMessage,
  loadLiveArticles,
  mergeBranch,
  readDestination,
} from '../wire-internal-links/github.js'
import {
  MIN_EXTERNAL_LINKS,
  applyExternalLinksToMarkdown,
  applyInternalLinksToMarkdown,
  planDeltas,
  publishedArticles,
  todayIso,
  trimExternalLinks,
} from '../wire-internal-links/plan.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

function titleOf(article) {
  return String(article?.data?.title || article?.slug || '')
}

function externalCount(article) {
  const links = Array.isArray(article?.data?.externalLinks)
    ? article.data.externalLinks
    : []
  return links.filter((link) => link?.url).length
}

function existingExternalUrls(article) {
  const links = Array.isArray(article?.data?.externalLinks)
    ? article.data.externalLinks
    : []
  return new Set(links.map((link) => String(link?.url || '').trim()).filter(Boolean))
}

function existingInternalLinks(article) {
  const links = Array.isArray(article?.data?.internalLinks)
    ? article.data.internalLinks
    : []
  return links.filter((link) => link?.slug)
}

function internalSnapshot(article, proposedItem) {
  const kept = Array.isArray(proposedItem?.kept)
    ? proposedItem.kept
    : existingInternalLinks(article)
  const added = Array.isArray(proposedItem?.added) ? proposedItem.added : []
  const next = Array.isArray(proposedItem?.next)
    ? proposedItem.next
    : [
        ...kept,
        ...added.filter(
          (link) => !kept.some((existing) => existing.slug === link.slug)
        ),
      ]
  return {
    kept,
    added,
    missing: added,
    next,
    currentCount: kept.length,
    desiredCount: next.length,
  }
}

function asExcludeSlugs(body) {
  const raw = Array.isArray(body.excludeSlugs) ? body.excludeSlugs : []
  return new Set(raw.map((slug) => String(slug || '').trim()).filter(Boolean))
}

function asSlugs(body) {
  const raw = Array.isArray(body.slugs) ? body.slugs : []
  return new Set(raw.map((slug) => String(slug || '').trim()).filter(Boolean))
}

function auditLiveArticles(articles) {
  const published = publishedArticles(articles)
  const { proposed } = planDeltas(articles)
  const proposedBySlug = new Map(proposed.map((item) => [item.slug, item]))
  const issues = []
  const healthy = []

  for (const article of published) {
    const internal = internalSnapshot(article, proposedBySlug.get(article.slug))
    const missing = internal.added
    const currentExternal = externalCount(article)
    const shortExternal = currentExternal < MIN_EXTERNAL_LINKS
    const hasInternalIssue = missing.length > 0
    const row = {
      slug: article.slug,
      title: titleOf(article),
      internal,
      external: {
        currentCount: currentExternal,
        needed: MIN_EXTERNAL_LINKS,
        short: shortExternal,
      },
    }
    if (hasInternalIssue || shortExternal) issues.push(row)
    else healthy.push({ slug: article.slug, title: row.title })
  }

  return {
    corpusCount: articles.length,
    publishedCount: published.length,
    issues,
    healthy,
  }
}

function asConfirmedExternal(body) {
  const raw = Array.isArray(body.confirmedExternal)
    ? body.confirmedExternal
    : Array.isArray(body.external)
      ? body.external
      : []
  return raw
    .map((item) => ({
      slug: String(item?.slug || '').trim(),
      links: (Array.isArray(item?.links) ? item.links : [])
        .map((link) => ({
          label: String(link?.label || link?.title || '').trim(),
          url: String(link?.url || '').trim(),
        }))
        .filter((link) => link.url),
    }))
    .filter((item) => item.slug && item.links.length)
}

function buildCheckLinksFiles(articles, confirmedExternal, excludeSlugs) {
  const published = publishedArticles(articles)
  const { proposed, skipped } = planDeltas(articles)
  const bySlug = new Map(articles.map((article) => [article.slug, article]))
  const filesBySlug = new Map()
  const blocked = excludeSlugs instanceof Set ? excludeSlugs : new Set()

  for (const item of proposed) {
    if (blocked.has(item.slug)) {
      skipped.push({
        slug: item.slug,
        title: item.title,
        reason: 'planning_error',
      })
      continue
    }
    const article = bySlug.get(item.slug)
    if (!article) continue
    const applied = applyInternalLinksToMarkdown(article.raw, item.next)
    if (!applied.changed) {
      skipped.push({
        slug: item.slug,
        title: item.title,
        reason: 'unchanged',
      })
      continue
    }
    filesBySlug.set(item.slug, {
      slug: item.slug,
      path: article.path,
      content: applied.content,
      title: item.title,
    })
  }

  const today = todayIso()
  for (const sel of confirmedExternal) {
    if (blocked.has(sel.slug)) continue
    const article = bySlug.get(sel.slug)
    if (!article || article.data?.draft === true) continue
    const existing = Array.isArray(article.data.externalLinks)
      ? article.data.externalLinks
      : []
    const merged = [...existing]
    for (const link of sel.links) {
      if (merged.some((item) => item.url === link.url)) continue
      merged.push({
        label: link.label || link.url,
        url: link.url,
        addedAt: today,
      })
    }
    const next = trimExternalLinks(merged)
    const raw = filesBySlug.get(sel.slug)?.content || article.raw
    const applied = applyExternalLinksToMarkdown(raw, next)
    if (!applied.changed && !filesBySlug.has(sel.slug)) continue
    filesBySlug.set(sel.slug, {
      slug: sel.slug,
      path: article.path,
      content: applied.content,
      title: titleOf(article),
    })
  }

  const written = new Set(filesBySlug.keys())
  const leftoverSkipped = skipped.filter((item) => !written.has(item.slug))

  return {
    publishedCount: published.length,
    corpusCount: articles.length,
    files: [...filesBySlug.values()],
    skipped: leftoverSkipped,
  }
}

async function resolveOwnSiteUrl(supabase, body) {
  const explicit = String(body.siteUrl || '').trim()
  const companyId = String(body.companyId || '').trim()
  if (!companyId && !explicit) return explicit
  try {
    const { siteUrl } = await resolveSiteUrl(supabase, companyId, explicit)
    return siteUrl || explicit
  } catch {
    return explicit
  }
}

export async function handleCheckLinks(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.end()
  }

  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const dest = readDestination(body)
  if (dest.error) {
    return json(res, dest.status, { error: dest.error })
  }

  const step = String(body.step || '').trim().toLowerCase()
  if (!['audit', 'propose-external', 'commit'].includes(step)) {
    return json(res, 400, {
      error: 'step must be "audit", "propose-external", or "commit"',
    })
  }

  const octokit = createOctokit(dest)
  let branchName = null

  try {
    const contract = await checkProjectContract(octokit, dest)
    if (!contract.ok) return json(res, contract.status, contract.body)

    const articles = await loadLiveArticles(octokit, dest)

    if (step === 'audit') {
      const audit = auditLiveArticles(articles)
      return json(res, 200, {
        ok: true,
        step: 'audit',
        corpusCount: audit.corpusCount,
        publishedCount: audit.publishedCount,
        issues: audit.issues,
        healthy: audit.healthy,
      })
    }

    if (step === 'propose-external') {
      const published = publishedArticles(articles)
      const slugFilter = asSlugs(body)
      const short = published.filter((article) => {
        if (externalCount(article) >= MIN_EXTERNAL_LINKS) return false
        if (slugFilter.size && !slugFilter.has(article.slug)) return false
        return true
      })
      if (short.length === 0) {
        return json(res, 200, {
          ok: true,
          step: 'propose-external',
          siteUrl: '',
          rows: [],
        })
      }

      if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
        return json(res, 503, {
          error: 'DATAFORSEO_LOGIN/PASSWORD not configured',
        })
      }

      const siteUrl = await resolveOwnSiteUrl(auth.supabase, body)
      const result = await searchExternalLinks({
        articles: short,
        siteUrl,
        limit: MIN_EXTERNAL_LINKS,
      })
      const bySlug = new Map(short.map((article) => [article.slug, article]))
      const rows = (result.rows || []).map((row) => {
        const article = bySlug.get(row.slug)
        const have = article ? existingExternalUrls(article) : new Set()
        const failed = Boolean(row.error) || row.available === false
        const candidates = failed
          ? []
          : (row.candidates || []).filter(
              (item) => item?.url && !have.has(item.url)
            )
        return {
          slug: row.slug,
          title: row.title,
          query: row.query,
          available: failed ? false : row.available,
          error: failed,
          reason: row.reason,
          fromCache: row.fromCache,
          currentCount: article ? externalCount(article) : 0,
          needed: MIN_EXTERNAL_LINKS,
          candidates,
        }
      })
      return json(res, 200, {
        ok: true,
        step: 'propose-external',
        siteUrl: result.siteUrl,
        ownHost: result.ownHost,
        rows,
      })
    }

    const confirmedExternal = asConfirmedExternal(body)
    const excludeSlugs = asExcludeSlugs(body)
    const plan = buildCheckLinksFiles(articles, confirmedExternal, excludeSlugs)
    if (plan.files.length === 0) {
      return json(res, 200, {
        ok: false,
        step: 'commit',
        branch: null,
        mergeCommitSha: null,
        committed: [],
        skipped: plan.skipped,
        errors: [{ message: 'No link updates to commit.' }],
      })
    }

    const committed = await commitFiles(octokit, dest, plan.files, {
      message: 'Check Links: wire internal and external links',
    })
    branchName = committed.branchName

    if (!MERGE_VIA_API) {
      const { data: pr } = await octokit.pulls.create({
        owner: dest.owner,
        repo: dest.repo,
        title: `Check Links (${branchName})`,
        head: branchName,
        base: dest.targetBranch,
        body: `Updates internal and/or external links on ${plan.files.length} article(s).`,
      })
      return json(res, 200, {
        ok: true,
        step: 'commit',
        branch: branchName,
        mergeCommitSha: null,
        mergeStrategy: 'open-pr',
        pullRequestUrl: pr.html_url || null,
        committed: plan.files.map((file) => ({
          path: file.path,
          slug: file.slug,
        })),
        skipped: plan.skipped,
        errors: [],
      })
    }

    const merge = await mergeBranch(octokit, dest, branchName)
    return json(res, 200, {
      ok: true,
      step: 'commit',
      branch: branchName,
      mergeCommitSha: merge?.sha || committed.newCommit.sha,
      mergeStrategy: 'merge',
      committed: plan.files.map((file) => ({
        path: file.path,
        slug: file.slug,
      })),
      skipped: plan.skipped,
      errors: [],
    })
  } catch (err) {
    console.error('check-links error:', err)
    return json(res, err.statusCode || 502, {
      ok: false,
      branch: branchName,
      error: githubErrorMessage(err),
    })
  }
}
