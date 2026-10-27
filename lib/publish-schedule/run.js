/**
 * The scheduled publisher: publish one scheduled draft to the company's site,
 * then wire links, record review notes and mark everything Live.
 *
 * Every outside call goes through `deps`, so tests can run without GitHub,
 * Supabase storage or the model.
 */
import Anthropic from '@anthropic-ai/sdk'
import { Octokit } from '@octokit/rest'
import { serializeArticleMarkdown, articleFilename } from '../../src/pages/tools/articleGeneration/serializeArticleMarkdown.js'
import { commitArticle, mergePublishBranch, readDestination } from '../publish-to-site/handler.js'
import { checkProjectContract } from '../contract/projectContract.js'
import { loadLiveArticles } from '../wire-internal-links/github.js'
import { wireLinksOnSite } from '../wire-internal-links/handler.js'
import { proposeWtsUpdate } from '../article-updates/wtsCheck.js'
import { WTS_END, WTS_START, replaceWtsSection } from '../article-updates/wts.js'
import { applyCoveragePublished, siteBaseFromDomain } from './coverage.js'
import { figureConflicts } from './figures.js'
import {
  MAX_ATTEMPTS,
  STALE_DRAFT_DAYS,
  dueItems,
  normalizeSettings,
  openItems,
  todayIn,
} from './plan.js'

const DEFAULT_AUTHOR = 'dori-fussmann'

export const defaultDeps = {
  readDestination,
  async checkContract(dest) {
    return checkProjectContract(new Octokit({ auth: dest.token }), dest)
  },
  commitArticle,
  mergePublishBranch,
  wireLinksOnSite,
  async loadLiveArticles(dest) {
    return loadLiveArticles(new Octokit({ auth: dest.token }), dest)
  },
  async refreshWts(args) {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) return null
    return proposeWtsUpdate({ anthropic: new Anthropic({ apiKey }), ...args })
  },
}

function wtsParagraph(body) {
  const source = String(body || '')
  const a = source.indexOf(WTS_START)
  const b = source.indexOf(WTS_END)
  if (a === -1 || b <= a) return ''
  return source.slice(a + WTS_START.length, b).trim()
}

/** Markdown file for one generated_articles row, dated `day`. */
export function articleFromRow(row, day) {
  const frontmatter = {
    title: row.title,
    h1: row.h1,
    description: row.description,
    slug: row.slug,
    date: day,
    updatedDate: day,
    author: DEFAULT_AUTHOR,
    category: row.category,
    tags: row.tags,
    imageAlt: row.image_alt,
    keywords: row.keywords,
    faqs: row.faqs,
    pillarKeyword: row.pillar_keyword,
    supportingKeyword: row.supporting_keyword,
    articleType: row.type,
    targetKeyword: row.target_keyword,
    externalLinks: Array.isArray(row.external_links) ? row.external_links : [],
    image: `../../assets/articles/${row.slug}.png`,
  }
  return {
    frontmatter,
    article: {
      filename: articleFilename(frontmatter),
      content: serializeArticleMarkdown(frontmatter, row.body, { draft: false }),
      storagePath: row.hero_storage_path || `${row.company_id}/${row.slug}.png`,
    },
  }
}

function firstProblem(result) {
  const err = (result?.errors || [])[0]
  if (err?.message) return err.message
  const skip = (result?.skipped || [])[0]
  if (skip?.message) return skip.message
  return 'Publish did not complete'
}

async function update(supabase, table, id, patch) {
  const { error } = await supabase.from(table).update(patch).eq('id', id)
  if (error) throw new Error(error.message || `Failed to update ${table}`)
}

/**
 * Publish one item now. Throws with a readable message on failure; the caller
 * records attempts.
 * @returns {{ url: string, notes: object[], wired: number, refreshed: boolean }}
 */
export async function publishItem({ supabase, schedule, item, now = new Date(), deps = defaultDeps }) {
  const settings = normalizeSettings(schedule.settings)
  const day = todayIn(settings.timezone, now)

  const { data: row, error: rowError } = await supabase
    .from('generated_articles')
    .select('*')
    .eq('id', item.generated_article_id)
    .maybeSingle()
  if (rowError) throw new Error(rowError.message || 'Failed to load the draft')
  if (!row) throw new Error('The draft for this article no longer exists')

  const [{ data: company }, { data: profile }] = await Promise.all([
    supabase
      .from('companies')
      .select('github_owner, github_repo, github_token_key')
      .eq('id', schedule.company_id)
      .maybeSingle(),
    supabase.from('company_profiles').select('domain').eq('company_id', schedule.company_id).maybeSingle(),
  ])
  const dest = deps.readDestination({
    owner: company?.github_owner,
    repo: company?.github_repo,
    tokenKey: company?.github_token_key,
    branch: 'main',
  })
  if (dest.error) throw new Error(`Publish destination: ${dest.error}`)

  // Freshness: a draft that waited too long gets its Where Things Stand checked.
  let body = String(row.body || '')
  let refreshed = false
  const createdDay = String(row.created_at || row.updated_at || '').slice(0, 10)
  const ageDays = createdDay
    ? Math.round((Date.parse(`${day}T00:00:00Z`) - Date.parse(`${createdDay}T00:00:00Z`)) / 86400000)
    : 0
  const siteBase = siteBaseFromDomain(profile?.domain)
  const url = siteBase ? `${siteBase}/articles/${row.slug}/` : ''
  if (ageDays > STALE_DRAFT_DAYS) {
    const currentParagraph = wtsParagraph(body)
    if (currentParagraph) {
      try {
        const wts = await deps.refreshWts({
          publishedUrl: url || `https://example.com/articles/${row.slug}/`,
          targetKeyword: row.target_keyword || row.title,
          pillarKeyword: row.pillar_keyword,
          currentParagraph,
        })
        if (wts?.updateWarranted && wts.proposedParagraph) {
          const replaced = replaceWtsSection(body, wts.proposedParagraph)
          if (replaced.ok) {
            body = replaced.content
            refreshed = replaced.changed
          }
        }
      } catch (err) {
        console.error('publish-schedule WTS refresh failed:', err?.message || err)
      }
    }
  }

  const contract = await deps.checkContract(dest)
  if (!contract.ok) throw new Error(contract.body?.error || 'The site’s seo-core version is not supported')

  const { article, frontmatter } = articleFromRow({ ...row, body }, day)
  const committed = await deps.commitArticle({
    dest,
    supabase,
    article,
    companyId: schedule.company_id,
  })
  if (!committed.ok || !(committed.committed || []).length) throw new Error(firstProblem(committed))
  try {
    await deps.mergePublishBranch(dest, committed.branch)
  } catch (err) {
    throw new Error(`Merge failed: ${err?.response?.data?.message || err?.message || 'unknown error'}`)
  }

  const notes = []
  let wired = 0
  try {
    const result = await deps.wireLinksOnSite({ dest, supabase, companyId: schedule.company_id })
    wired = result?.updated || 0
  } catch (err) {
    notes.push({ kind: 'links', message: `Published, but internal links were not wired: ${err?.message || err}. Run Wire internal links.` })
  }
  try {
    const live = await deps.loadLiveArticles(dest)
    notes.push(...figureConflicts(body, live, { slug: row.slug }))
  } catch {
    // advisory only
  }

  const publishedAt = now.toISOString()
  await update(supabase, 'generated_articles', row.id, {
    status: 'published',
    published_at: publishedAt,
    published_url: url || null,
    date: day,
    updated_date: day,
    draft: false,
    ...(refreshed ? { body } : {}),
    updated_at: publishedAt,
  })

  const { data: coverage } = await supabase
    .from('content_coverage')
    .select('pillars')
    .eq('company_id', schedule.company_id)
    .maybeSingle()
  const applied = applyCoveragePublished(coverage?.pillars, {
    pillarKeyword: row.pillar_keyword,
    supportingKeyword: row.supporting_keyword,
    successes: [{ targetKeyword: row.target_keyword, title: row.title, frontmatter }],
    publishedUrl: url,
    now: publishedAt,
  })
  if (applied.updated > 0) {
    const { error } = await supabase
      .from('content_coverage')
      .upsert(
        { company_id: schedule.company_id, pillars: applied.pillars, updated_at: publishedAt },
        { onConflict: 'company_id' }
      )
    if (error) notes.push({ kind: 'map', message: `Published, but the keyword map was not updated: ${error.message}` })
  } else if (applied.warning) {
    notes.push({ kind: 'map', message: applied.warning })
  }
  if (refreshed) notes.push({ kind: 'freshness', message: 'Where Things Stand was refreshed before publishing (the draft was over 14 days old).' })

  return { url, notes, wired, refreshed }
}

/**
 * Publish one item and record the outcome on its row (and the schedule).
 * Never throws for publish errors.
 */
export async function publishAndRecord({ supabase, schedule, item, now = new Date(), deps = defaultDeps }) {
  await update(supabase, 'publish_schedule_items', item.id, {
    status: 'publishing',
    updated_at: now.toISOString(),
  })
  try {
    const result = await publishItem({ supabase, schedule, item, now, deps })
    await update(supabase, 'publish_schedule_items', item.id, {
      status: 'published',
      published_url: result.url || null,
      published_at: now.toISOString(),
      publish_on: todayIn(normalizeSettings(schedule.settings).timezone, now),
      last_error: null,
      notes: result.notes,
      updated_at: now.toISOString(),
    })
    await finishIfDone(supabase, schedule)
    return { ok: true, itemId: item.id, ...result }
  } catch (err) {
    const attempts = (item.attempts || 0) + 1
    const message = String(err?.message || err || 'Publish failed')
    await update(supabase, 'publish_schedule_items', item.id, {
      status: attempts >= MAX_ATTEMPTS ? 'failed' : 'scheduled',
      attempts,
      last_error: message,
      updated_at: now.toISOString(),
    })
    return { ok: false, itemId: item.id, error: message, attempts }
  }
}

async function finishIfDone(supabase, schedule) {
  const { data } = await supabase
    .from('publish_schedule_items')
    .select('id, status, publish_on, position')
    .eq('schedule_id', schedule.id)
  if (openItems(data || []).length === 0) {
    await update(supabase, 'publish_schedules', schedule.id, {
      status: 'done',
      updated_at: new Date().toISOString(),
    })
  }
}

/**
 * The daily run: everything due today, one article per site.
 * @returns {{ checked: number, published: object[], failed: object[] }}
 */
export async function runPublishDue({ supabase, now = new Date(), deps = defaultDeps }) {
  const { data: schedules, error } = await supabase
    .from('publish_schedules')
    .select('*')
    .eq('status', 'active')
  if (error) throw new Error(error.message || 'Failed to load schedules')
  if (!schedules?.length) return { checked: 0, published: [], failed: [] }

  const ids = schedules.map((s) => s.id)
  const { data: items, error: itemsError } = await supabase
    .from('publish_schedule_items')
    .select('*')
    .in('schedule_id', ids)
  if (itemsError) throw new Error(itemsError.message || 'Failed to load schedule items')

  // One article per site per day: companies that already published today.
  const publishedToday = new Set()
  for (const schedule of schedules) {
    const today = todayIn(normalizeSettings(schedule.settings).timezone, now)
    const hit = (items || []).some(
      (item) =>
        item.status === 'published' &&
        item.company_id === schedule.company_id &&
        item.published_at &&
        todayIn(normalizeSettings(schedule.settings).timezone, new Date(item.published_at)) === today
    )
    if (hit) publishedToday.add(schedule.company_id)
  }

  const due = dueItems(schedules, items || [], { now, publishedToday })
  const published = []
  const failed = []
  for (const { schedule, item } of due) {
    const result = await publishAndRecord({ supabase, schedule, item, now, deps })
    ;(result.ok ? published : failed).push(result)
  }
  return { checked: schedules.length, published, failed }
}
