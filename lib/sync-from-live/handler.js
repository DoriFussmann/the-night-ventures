/**
 * Sync from live: make the article library match what is actually published.
 *
 * The live site repo is the source of truth for published articles. Link
 * wiring, Where Things Stand updates, cleanups and hand edits all change the
 * live files after publishing; this copies each live article's frontmatter and
 * body back into generated_articles so the library never shows (or republishes)
 * a stale copy. Live articles missing from the library are added. Nothing is
 * written to the site.
 */
import {
  requireAuth,
  handleOptions,
  parseBody,
  json,
} from '../seo-advisor/auth.js'
import { createOctokit, loadLiveArticles, readDestination } from '../wire-internal-links/github.js'
import { parseFrontmatter } from '../frontmatter.js'

const TYPES = new Set(['comprehensive', 'howto', 'comparison', 'faq', 'flex'])

const str = (value) => (value == null ? '' : String(value)).trim()
const arr = (value) => (Array.isArray(value) ? value : [])

function siteBaseFromDomain(domain) {
  const d = str(domain).replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  return d ? `https://${d}` : ''
}

/** Library columns from one live markdown file. */
export function rowFromLive(raw, slug, { siteBase = '', now = new Date().toISOString() } = {}) {
  const parsed = parseFrontmatter(raw)
  if (!parsed.ok) return null
  const fm = parsed.data || {}
  const type = str(fm.articleType).toLowerCase()
  const draft = fm.draft === true
  return {
    slug,
    title: str(fm.title),
    h1: str(fm.h1) || null,
    description: str(fm.description),
    body: String(parsed.body || '').replace(/^\r?\n/, ''),
    date: str(fm.date) || null,
    updated_date: str(fm.updatedDate) || null,
    author: str(fm.author) || null,
    category: str(fm.category) || null,
    tags: arr(fm.tags).map(str).filter(Boolean),
    keywords: arr(fm.keywords).map(str).filter(Boolean),
    image_alt: str(fm.imageAlt) || null,
    faqs: arr(fm.faqs),
    external_links: arr(fm.externalLinks),
    internal_links: arr(fm.internalLinks),
    pillar_keyword: str(fm.pillarKeyword),
    supporting_keyword: str(fm.supportingKeyword) || null,
    target_keyword: str(fm.targetKeyword),
    type: TYPES.has(type) ? type : 'flex',
    draft,
    status: draft ? 'drafted' : 'published',
    published_url: !draft && siteBase ? `${siteBase}/articles/${slug}/` : null,
    last_synced_at: now,
    updated_at: now,
  }
}

/** Compare a library row with its live version; list fields that differ. */
export function changedFields(row, live) {
  const fields = ['title', 'h1', 'description', 'body', 'updated_date', 'faqs', 'external_links', 'internal_links', 'status']
  return fields.filter((key) => JSON.stringify(row?.[key] ?? null) !== JSON.stringify(live?.[key] ?? null))
}

export async function syncFromLive({ supabase, companyId, apply = false }) {
  const [{ data: company, error: companyError }, { data: profile }] = await Promise.all([
    supabase
      .from('companies')
      .select('github_owner, github_repo, github_token_key')
      .eq('id', companyId)
      .maybeSingle(),
    supabase.from('company_profiles').select('domain').eq('company_id', companyId).maybeSingle(),
  ])
  if (companyError) throw companyError
  const dest = readDestination({
    owner: company?.github_owner,
    repo: company?.github_repo,
    tokenKey: company?.github_token_key,
    branch: 'main',
  })
  if (dest.error) {
    const err = new Error(`Publish destination: ${dest.error}`)
    err.statusCode = dest.status || 400
    throw err
  }

  const live = await loadLiveArticles(createOctokit(dest), dest)
  const { data: rows, error: rowsError } = await supabase
    .from('generated_articles')
    .select('id, slug, title, h1, description, body, updated_date, faqs, external_links, internal_links, status')
    .eq('company_id', companyId)
  if (rowsError) throw rowsError

  const bySlug = new Map((rows || []).map((row) => [row.slug, row]))
  const siteBase = siteBaseFromDomain(profile?.domain)
  const now = new Date().toISOString()
  const report = { liveCount: live.length, updated: [], unchanged: [], added: [], libraryOnly: [], errors: [] }

  for (const article of live) {
    const next = rowFromLive(article.raw, article.slug, { siteBase, now })
    if (!next) {
      report.errors.push({ slug: article.slug, message: 'Could not parse the live file' })
      continue
    }
    const existing = bySlug.get(article.slug)
    bySlug.delete(article.slug)
    if (existing) {
      const changed = changedFields(existing, next)
      if (!changed.length) {
        report.unchanged.push(article.slug)
        if (apply) await supabase.from('generated_articles').update({ last_synced_at: now }).eq('id', existing.id)
        continue
      }
      report.updated.push({ slug: article.slug, fields: changed })
      if (apply) {
        const { slug: _slug, ...patch } = next
        const { error } = await supabase.from('generated_articles').update(patch).eq('id', existing.id)
        if (error) report.errors.push({ slug: article.slug, message: error.message })
      }
    } else {
      report.added.push(article.slug)
      if (apply) {
        const isPillar = next.type === 'comprehensive' && !next.supporting_keyword
        const { error } = await supabase.from('generated_articles').insert({
          ...next,
          company_id: companyId,
          source: isPillar ? 'pillar' : 'cluster',
          published_at: next.status === 'published' ? now : null,
        })
        if (error) report.errors.push({ slug: article.slug, message: error.message })
      }
    }
  }
  // Library rows with no live file: drafts not yet published, or articles
  // removed from the site. Reported only; never deleted here.
  for (const row of bySlug.values()) report.libraryOnly.push({ slug: row.slug, status: row.status })

  return { ok: report.errors.length === 0, applied: apply, ...report }
}

export async function handleSyncFromLive(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return
  res.setHeader('Access-Control-Allow-Origin', '*')
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  try {
    const body = parseBody(req)
    const companyId = str(body.companyId)
    if (!companyId) return json(res, 400, { error: 'companyId is required' })
    const result = await syncFromLive({ supabase: auth.supabase, companyId, apply: body.apply === true })
    return json(res, 200, result)
  } catch (err) {
    console.error('[sync-from-live]', err)
    return json(res, err.statusCode || 502, { error: err.message || 'Failed to sync from the live site' })
  }
}
