/**
 * Keyword tree store: content_coverage.pillars is the single source of truth
 * for Core (pillar) and Supporting keywords.
 *
 *   pillars: [{ slug, keyword, pillarArticle?, supporting: [{ slug, keyword, plannedArticles }] }]
 *
 * Every write goes through mutateCoverage(), which retries on concurrent
 * updates, then mirrors the tree to company_profiles.core_keywords
 * ([{ keyword, supporting: [string] }]) so legacy readers stay correct.
 *
 * Pure helpers at the top are also imported by the browser bundle.
 */

export function slugifyKeyword(value) {
  const base = String(value || '')
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return base || 'untitled'
}

export function keywordLabel(item) {
  if (!item) return ''
  if (typeof item === 'string') return item.trim()
  return String(item.keyword || item.term || item.name || '').trim()
}

function slugOf(item) {
  return slugifyKeyword(item?.slug || keywordLabel(item))
}

function cleanKeyword(value) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
}

function finiteOrNull(value) {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export function normalizeCoveragePillars(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object')
}

function supportingList(pillar) {
  return Array.isArray(pillar?.supporting)
    ? pillar.supporting.filter((item) => item && typeof item === 'object')
    : []
}

function matchesLabel(raw, slug, label) {
  const value = String(raw || '').trim()
  if (!value) return false
  return slugifyKeyword(value) === slug || value.toLowerCase() === label.toLowerCase()
}

/** Supporting keyword has content: planned articles or a generated article. */
export function isSupportingLocked(supporting, articles = [], pillar) {
  const planned = Array.isArray(supporting?.plannedArticles)
    ? supporting.plannedArticles
    : []
  if (planned.length > 0) return true
  const slug = slugOf(supporting)
  const label = keywordLabel(supporting)
  const pillarSlug = slugOf(pillar)
  const pillarLabel = keywordLabel(pillar)
  return (articles || []).some((row) => {
    if (!matchesLabel(row?.supporting_keyword, slug, label)) return false
    const rawPillar = String(row?.pillar_keyword || '').trim()
    if (!rawPillar) return true
    return matchesLabel(rawPillar, pillarSlug, pillarLabel)
  })
}

/**
 * Core keyword has content: a planned pillar article, a generated article
 * under it, or any locked supporting keyword.
 */
export function isPillarLocked(pillar, articles = []) {
  if (pillar?.pillarArticle && typeof pillar.pillarArticle === 'object') return true
  const slug = slugOf(pillar)
  const label = keywordLabel(pillar)
  const hasArticle = (articles || []).some((row) =>
    matchesLabel(row?.pillar_keyword, slug, label)
  )
  if (hasArticle) return true
  return supportingList(pillar).some((item) => isSupportingLocked(item, articles, pillar))
}

export async function loadGeneratedArticles(supabase, companyId) {
  const { data, error } = await supabase
    .from('generated_articles')
    .select('pillar_keyword, supporting_keyword')
    .eq('company_id', companyId)
  if (error) throw error
  return data || []
}

async function loadCoverageRow(supabase, companyId) {
  const { data, error } = await supabase
    .from('content_coverage')
    .select('id, pillars, updated_at')
    .eq('company_id', companyId)
    .maybeSingle()
  if (error) throw error
  return data || null
}

export async function loadCoverageState(supabase, companyId) {
  const [row, articles] = await Promise.all([
    loadCoverageRow(supabase, companyId),
    loadGeneratedArticles(supabase, companyId),
  ])
  return {
    coverageId: row?.id || null,
    updatedAt: row?.updated_at || null,
    pillars: normalizeCoveragePillars(row?.pillars),
    articles,
  }
}

function serializeMetrics(item) {
  return {
    searchVolume: finiteOrNull(item?.searchVolume),
    difficulty: finiteOrNull(item?.difficulty),
  }
}

/** Client-facing tree with lock flags. */
export function serializeTree(pillars, articles = []) {
  return normalizeCoveragePillars(pillars).map((pillar) => ({
    slug: slugOf(pillar),
    keyword: keywordLabel(pillar),
    locked: isPillarLocked(pillar, articles),
    ...serializeMetrics(pillar),
    supporting: supportingList(pillar).map((item) => ({
      slug: slugOf(item),
      keyword: keywordLabel(item),
      locked: isSupportingLocked(item, articles, pillar),
      ...serializeMetrics(item),
    })),
  }))
}

export function serializeCoverageState(state) {
  const pillars = serializeTree(state?.pillars, state?.articles)
  return { pillars, count: pillars.length }
}

export function findCoveragePillar(pillars, slugOrKeyword) {
  const slug = slugifyKeyword(slugOrKeyword)
  if (!slug || slug === 'untitled') return null
  return (
    normalizeCoveragePillars(pillars).find(
      (pillar) => slugOf(pillar) === slug || slugifyKeyword(pillar.keyword) === slug
    ) || null
  )
}

/** Where (if anywhere) a keyword already lives in the tree. */
export function locateKeyword(pillars, keyword) {
  const slug = slugifyKeyword(keyword)
  for (const pillar of normalizeCoveragePillars(pillars)) {
    if (slugOf(pillar) === slug) {
      return { type: 'core', core: keywordLabel(pillar) }
    }
    for (const item of supportingList(pillar)) {
      if (slugOf(item) === slug) {
        return { type: 'supporting', core: keywordLabel(pillar), keyword: keywordLabel(item) }
      }
    }
  }
  return null
}

export function toCoreKeywordsMirror(pillars) {
  return normalizeCoveragePillars(pillars)
    .map((pillar) => ({
      keyword: keywordLabel(pillar),
      supporting: supportingList(pillar).map(keywordLabel).filter(Boolean),
    }))
    .filter((pillar) => pillar.keyword)
}

function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.statusCode = status
  Object.assign(err, extra)
  return err
}

function metricFields(input, source) {
  const out = { addedAt: new Date().toISOString() }
  const searchVolume = finiteOrNull(input?.searchVolume ?? input?.search_volume)
  const difficulty = finiteOrNull(input?.difficulty)
  if (searchVolume != null) out.searchVolume = searchVolume
  if (difficulty != null) out.difficulty = difficulty
  if (source) out.source = String(source)
  return out
}

/* ------------------------------------------------------------------ */
/* Pure tree operations (no I/O) — exported for tests.                 */
/* ------------------------------------------------------------------ */

export function applyAddCore(pillars, input, { source } = {}) {
  const keyword = cleanKeyword(input?.keyword)
  if (!keyword) throw httpError(400, 'keyword is required')
  const existing = locateKeyword(pillars, keyword)
  if (existing) {
    throw httpError(
      409,
      existing.type === 'core'
        ? `“${keyword}” is already a Core keyword.`
        : `“${keyword}” is already a Supporting keyword under “${existing.core}”.`,
      { code: 'duplicate', existing }
    )
  }
  const pillar = {
    slug: slugifyKeyword(keyword),
    keyword,
    supporting: [],
    ...metricFields(input, source),
  }
  return { pillars: [...normalizeCoveragePillars(pillars), pillar], added: pillar }
}

export function applyAddSupporting(pillars, input, { source } = {}) {
  const keyword = cleanKeyword(input?.keyword)
  if (!keyword) throw httpError(400, 'keyword is required')
  const list = normalizeCoveragePillars(pillars)
  const parent = findCoveragePillar(list, input?.core || input?.coreSlug)
  if (!parent) {
    throw httpError(404, `Core keyword “${input?.core || input?.coreSlug || ''}” not found.`, {
      code: 'core_not_found',
    })
  }
  const existing = locateKeyword(list, keyword)
  if (existing) {
    throw httpError(
      409,
      existing.type === 'core'
        ? `“${keyword}” is already a Core keyword.`
        : `“${keyword}” is already a Supporting keyword under “${existing.core}”.`,
      { code: 'duplicate', existing }
    )
  }
  const item = {
    slug: slugifyKeyword(keyword),
    keyword,
    plannedArticles: [],
    ...metricFields(input, source),
  }
  const next = list.map((pillar) =>
    pillar === parent ? { ...pillar, supporting: [...supportingList(pillar), item] } : pillar
  )
  return { pillars: next, added: item, core: keywordLabel(parent) }
}

export function applyRemoveCore(pillars, input, articles = []) {
  const list = normalizeCoveragePillars(pillars)
  const target = findCoveragePillar(list, input?.core || input?.slug || input?.keyword)
  if (!target) throw httpError(404, 'Core keyword not found.')
  if (isPillarLocked(target, articles)) {
    throw httpError(
      409,
      `“${keywordLabel(target)}” has content (articles or planned articles) and can’t be removed.`,
      { code: 'locked' }
    )
  }
  return { pillars: list.filter((pillar) => pillar !== target), removed: keywordLabel(target) }
}

export function applyRemoveSupporting(pillars, input, articles = []) {
  const list = normalizeCoveragePillars(pillars)
  const parent = findCoveragePillar(list, input?.core || input?.coreSlug)
  if (!parent) throw httpError(404, 'Core keyword not found.')
  const slug = slugifyKeyword(input?.slug || input?.keyword)
  const target = supportingList(parent).find((item) => slugOf(item) === slug)
  if (!target) throw httpError(404, 'Supporting keyword not found.')
  if (isSupportingLocked(target, articles, parent)) {
    throw httpError(
      409,
      `“${keywordLabel(target)}” has content (articles or planned articles) and can’t be removed.`,
      { code: 'locked' }
    )
  }
  const next = list.map((pillar) =>
    pillar === parent
      ? { ...pillar, supporting: supportingList(pillar).filter((item) => item !== target) }
      : pillar
  )
  return { pillars: next, removed: keywordLabel(target) }
}

/**
 * Replace the whole tree from an edited list (Company Intelligence form).
 * Existing entries are matched by slug so their data (pillarArticle,
 * plannedArticles, metrics) is preserved. Locked entries that the edit
 * dropped are kept and reported in keptLocked.
 *
 * @param input [{ keyword, supporting: [string | { keyword }] }]
 */
export function applyReplaceTree(pillars, input, articles = [], { source } = {}) {
  const current = normalizeCoveragePillars(pillars)
  const bySlug = new Map(current.map((pillar) => [slugOf(pillar), pillar]))
  const usedSlugs = new Set()
  const keptLocked = []
  const skipped = []
  const next = []

  const rows = (Array.isArray(input) ? input : [])
    .map((row) => ({
      keyword: cleanKeyword(keywordLabel(row)),
      supporting: (Array.isArray(row?.supporting) ? row.supporting : [])
        .map((item) => cleanKeyword(keywordLabel(item)))
        .filter(Boolean),
    }))
    .filter((row) => row.keyword)

  // Reserve every slug a locked supporting keyword occupies so nothing
  // else can claim it.
  const lockedSupportingOwner = new Map()
  for (const pillar of current) {
    for (const item of supportingList(pillar)) {
      if (isSupportingLocked(item, articles, pillar)) {
        lockedSupportingOwner.set(slugOf(item), slugOf(pillar))
      }
    }
  }
  const lockedCoreSlugs = new Set(
    current.filter((pillar) => isPillarLocked(pillar, articles)).map(slugOf)
  )

  for (const row of rows) {
    const slug = slugifyKeyword(row.keyword)
    if (usedSlugs.has(slug)) {
      skipped.push(row.keyword)
      continue
    }
    const owner = lockedSupportingOwner.get(slug)
    if (owner) {
      skipped.push(row.keyword)
      continue
    }
    usedSlugs.add(slug)
    const prev = bySlug.get(slug)
    const prevSupporting = supportingList(prev)
    const prevBySlug = new Map(prevSupporting.map((item) => [slugOf(item), item]))
    const supporting = []

    for (const label of row.supporting) {
      const supSlug = slugifyKeyword(label)
      if (usedSlugs.has(supSlug) || supSlug === slug || lockedCoreSlugs.has(supSlug)) {
        skipped.push(label)
        continue
      }
      const lockedOwner = lockedSupportingOwner.get(supSlug)
      if (lockedOwner && lockedOwner !== slug) {
        skipped.push(label)
        continue
      }
      usedSlugs.add(supSlug)
      const existingItem = prevBySlug.get(supSlug)
      supporting.push(
        existingItem
          ? { ...existingItem, keyword: label }
          : { slug: supSlug, keyword: label, plannedArticles: [], ...metricFields({}, source) }
      )
    }

    // Keep locked supporting keywords the edit dropped.
    for (const item of prevSupporting) {
      const supSlug = slugOf(item)
      if (usedSlugs.has(supSlug)) continue
      if (isSupportingLocked(item, articles, prev)) {
        usedSlugs.add(supSlug)
        supporting.push(item)
        keptLocked.push(keywordLabel(item))
      }
    }

    next.push(
      prev
        ? { ...prev, keyword: row.keyword, supporting }
        : { slug, keyword: row.keyword, supporting, ...metricFields({}, source) }
    )
  }

  // Keep locked Core keywords the edit dropped (with their locked children).
  for (const pillar of current) {
    const slug = slugOf(pillar)
    if (usedSlugs.has(slug)) continue
    if (!isPillarLocked(pillar, articles)) continue
    usedSlugs.add(slug)
    const supporting = supportingList(pillar).filter((item) => {
      const supSlug = slugOf(item)
      if (usedSlugs.has(supSlug)) return false
      if (!isSupportingLocked(item, articles, pillar)) return false
      usedSlugs.add(supSlug)
      return true
    })
    next.push({ ...pillar, supporting })
    keptLocked.push(keywordLabel(pillar))
  }

  return { pillars: next, keptLocked, skipped }
}

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

const MAX_ATTEMPTS = 4

async function mirrorToProfile(supabase, companyId, pillars) {
  const { error } = await supabase
    .from('company_profiles')
    .update({ core_keywords: toCoreKeywordsMirror(pillars) })
    .eq('company_id', companyId)
  if (error) console.error('core_keywords mirror failed:', error)
}

/**
 * Read-modify-write content_coverage.pillars with optimistic concurrency
 * on updated_at. `mutate(pillars, articles)` returns { pillars, ...extra }.
 */
export async function mutateCoverage(supabase, companyId, mutate) {
  const articles = await loadGeneratedArticles(supabase, companyId)

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const row = await loadCoverageRow(supabase, companyId)
    const current = normalizeCoveragePillars(row?.pillars)
    const result = mutate(current, articles)
    const nextPillars = result.pillars
    const now = new Date().toISOString()

    if (row) {
      let query = supabase
        .from('content_coverage')
        .update({ pillars: nextPillars, updated_at: now })
        .eq('company_id', companyId)
      query = row.updated_at ? query.eq('updated_at', row.updated_at) : query
      const { data, error } = await query.select('id')
      if (error) throw error
      if (!data || data.length === 0) continue // someone else wrote; retry
    } else {
      const { error } = await supabase
        .from('content_coverage')
        .insert({ company_id: companyId, pillars: nextPillars, updated_at: now })
      if (error) {
        if (error.code === '23505') continue // created concurrently; retry
        throw error
      }
    }

    await mirrorToProfile(supabase, companyId, nextPillars)
    return { ...result, tree: serializeTree(nextPillars, articles) }
  }

  throw httpError(409, 'Keywords were changed by someone else at the same time. Try again.')
}

export async function loadTree(supabase, companyId) {
  const state = await loadCoverageState(supabase, companyId)
  return serializeTree(state.pillars, state.articles)
}

export const keywordStore = {
  load: loadTree,
  addCore: (supabase, companyId, input, opts) =>
    mutateCoverage(supabase, companyId, (pillars) => applyAddCore(pillars, input, opts)),
  addSupporting: (supabase, companyId, input, opts) =>
    mutateCoverage(supabase, companyId, (pillars) => applyAddSupporting(pillars, input, opts)),
  removeCore: (supabase, companyId, input) =>
    mutateCoverage(supabase, companyId, (pillars, articles) =>
      applyRemoveCore(pillars, input, articles)
    ),
  removeSupporting: (supabase, companyId, input) =>
    mutateCoverage(supabase, companyId, (pillars, articles) =>
      applyRemoveSupporting(pillars, input, articles)
    ),
  /**
   * opts.expected: the tree the editor started from ([{ keyword, supporting }]).
   * If the stored tree has changed since (e.g. a keyword was added in the
   * Advisor), refuse instead of silently overwriting it.
   */
  replaceTree: (supabase, companyId, input, opts = {}) =>
    mutateCoverage(supabase, companyId, (pillars, articles) => {
      if (
        Array.isArray(opts.expected) &&
        JSON.stringify(toCoreKeywordsMirror(pillars)) !== JSON.stringify(opts.expected)
      ) {
        throw httpError(
          409,
          'Pillar keywords were changed elsewhere (for example in the SEO Advisor) since this page loaded. Reload to get the latest, then edit again.',
          { code: 'stale' }
        )
      }
      return applyReplaceTree(pillars, input, articles, opts)
    }),
}
