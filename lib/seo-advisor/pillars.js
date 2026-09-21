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

export function normalizeCoveragePillars(value) {
  if (!Array.isArray(value)) return []
  return value.filter((item) => item && typeof item === 'object')
}

export function isPillarLocked(pillar, articleKeywords = []) {
  const supporting = Array.isArray(pillar?.supporting) ? pillar.supporting : []
  if (supporting.length > 0) return true
  const slug = slugifyKeyword(pillar?.slug || pillar?.keyword)
  const keyword = keywordLabel(pillar).toLowerCase()
  return (articleKeywords || []).some((item) => {
    const raw = String(item || '').trim()
    if (!raw) return false
    return slugifyKeyword(raw) === slug || raw.toLowerCase() === keyword
  })
}

export function lockedSlugsFor(pillars, articleKeywords = []) {
  return normalizeCoveragePillars(pillars)
    .filter((pillar) => isPillarLocked(pillar, articleKeywords))
    .map((pillar) => slugifyKeyword(pillar.slug || pillar.keyword))
}

export async function loadGeneratedArticles(supabase, companyId) {
  const { data, error } = await supabase
    .from('generated_articles')
    .select('pillar_keyword, supporting_keyword')
    .eq('company_id', companyId)
  if (error) throw error
  return data || []
}

export async function loadArticlePillarKeywords(supabase, companyId) {
  const articles = await loadGeneratedArticles(supabase, companyId)
  return articles
    .map((row) => String(row.pillar_keyword || '').trim())
    .filter(Boolean)
}

export function findCoveragePillar(pillars, slugOrKeyword) {
  const slug = slugifyKeyword(slugOrKeyword)
  if (!slug || slug === 'untitled') return null
  return (
    normalizeCoveragePillars(pillars).find((pillar) => {
      const pillarSlug = slugifyKeyword(pillar.slug || pillar.keyword)
      const keywordSlug = slugifyKeyword(pillar.keyword)
      return pillarSlug === slug || keywordSlug === slug
    }) || null
  )
}

export function isSupportingLocked(supporting, articles = [], pillar) {
  const planned = Array.isArray(supporting?.plannedArticles)
    ? supporting.plannedArticles
    : []
  if (planned.length > 0) return true
  const slug = slugifyKeyword(supporting?.slug || supporting?.keyword)
  const keyword = keywordLabel(supporting).toLowerCase()
  const pillarSlug = slugifyKeyword(pillar?.slug || pillar?.keyword)
  const pillarKeyword = keywordLabel(pillar).toLowerCase()
  return (articles || []).some((row) => {
    const raw = String(row?.supporting_keyword || '').trim()
    if (!raw) return false
    const matchSup =
      slugifyKeyword(raw) === slug || raw.toLowerCase() === keyword
    if (!matchSup) return false
    const rawPillar = String(row?.pillar_keyword || '').trim()
    if (!rawPillar) return true
    return (
      slugifyKeyword(rawPillar) === pillarSlug ||
      rawPillar.toLowerCase() === pillarKeyword
    )
  })
}

export function serializeSupporting(supporting, articles = [], pillar) {
  const list = Array.isArray(supporting) ? supporting : []
  return list
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      slug: item.slug || slugifyKeyword(item.keyword),
      keyword: keywordLabel(item),
      plannedArticles: Array.isArray(item.plannedArticles)
        ? item.plannedArticles
        : [],
      locked: isSupportingLocked(item, articles, pillar),
    }))
}

export async function loadCoverageState(supabase, companyId) {
  const [coverageRes, articles] = await Promise.all([
    supabase
      .from('content_coverage')
      .select('id, pillars')
      .eq('company_id', companyId)
      .maybeSingle(),
    loadGeneratedArticles(supabase, companyId),
  ])
  if (coverageRes.error) throw coverageRes.error
  const pillars = normalizeCoveragePillars(coverageRes.data?.pillars)
  const articleKeywords = (articles || [])
    .map((row) => String(row.pillar_keyword || '').trim())
    .filter(Boolean)
  const lockedSlugs = lockedSlugsFor(pillars, articleKeywords)
  return {
    coverageId: coverageRes.data?.id || null,
    pillars,
    lockedSlugs,
    articleKeywords,
    articles,
    count: pillars.length,
  }
}

export function serializeCoverageState(state) {
  return {
    pillars: (state.pillars || []).map((pillar) => ({
      slug: pillar.slug || slugifyKeyword(pillar.keyword),
      keyword: keywordLabel(pillar),
      supporting: serializeSupporting(
        pillar.supporting,
        state.articles,
        pillar
      ),
      locked: (state.lockedSlugs || []).includes(
        slugifyKeyword(pillar.slug || pillar.keyword)
      ),
    })),
    lockedSlugs: state.lockedSlugs || [],
    count: (state.pillars || []).length,
  }
}

export async function appendProposedPillars(supabase, companyId, proposed = []) {
  const state = await loadCoverageState(supabase, companyId)
  const existing = [...state.pillars]
  const seen = new Set(
    existing.map((pillar) => slugifyKeyword(pillar.slug || pillar.keyword))
  )
  const lockedSet = new Set(state.lockedSlugs)

  for (const item of Array.isArray(proposed) ? proposed : []) {
    const keyword = keywordLabel(item)
    if (!keyword) continue
    const slug = slugifyKeyword(item.slug || keyword)
    if (seen.has(slug)) continue
    if (lockedSet.has(slug)) continue
    existing.push({
      slug,
      keyword,
      supporting: [],
    })
    seen.add(slug)
  }

  const now = new Date().toISOString()
  if (state.coverageId) {
    const { error } = await supabase
      .from('content_coverage')
      .update({ pillars: existing, updated_at: now })
      .eq('company_id', companyId)
    if (error) throw error
  } else {
    const { error } = await supabase.from('content_coverage').insert({
      company_id: companyId,
      pillars: existing,
      updated_at: now,
    })
    if (error) throw error
  }

  const coreKeywords = existing
    .map((pillar) => keywordLabel(pillar))
    .filter(Boolean)
    .filter(
      (keyword, index, list) =>
        list.findIndex((item) => slugifyKeyword(item) === slugifyKeyword(keyword)) ===
        index
    )

  const { data: profile, error: profileError } = await supabase
    .from('company_profiles')
    .select('company_id')
    .eq('company_id', companyId)
    .maybeSingle()
  if (profileError) throw profileError
  if (profile) {
    const { error: updateError } = await supabase
      .from('company_profiles')
      .update({ core_keywords: coreKeywords })
      .eq('company_id', companyId)
    if (updateError) throw updateError
  }

  return {
    pillars: existing,
    lockedSlugs: state.lockedSlugs,
    coreKeywords,
    count: existing.length,
  }
}

export async function appendProposedClusters(
  supabase,
  companyId,
  pillarSlug,
  proposed = []
) {
  const state = await loadCoverageState(supabase, companyId)
  if (!state.coverageId) {
    const err = new Error('No content coverage found for this company')
    err.statusCode = 404
    throw err
  }

  const index = state.pillars.findIndex((pillar) => {
    const slug = slugifyKeyword(pillar.slug || pillar.keyword)
    const keywordSlug = slugifyKeyword(pillar.keyword)
    const needle = slugifyKeyword(pillarSlug)
    return slug === needle || keywordSlug === needle
  })
  if (index < 0) {
    const err = new Error('Pillar not found')
    err.statusCode = 404
    throw err
  }

  const pillar = state.pillars[index]
  const supporting = Array.isArray(pillar.supporting) ? [...pillar.supporting] : []
  const seen = new Set(
    supporting.map((item) => slugifyKeyword(item.slug || item.keyword))
  )
  const lockedSupportingSlugs = supporting
    .filter((item) => isSupportingLocked(item, state.articles, pillar))
    .map((item) => slugifyKeyword(item.slug || item.keyword))
  const lockedSet = new Set(lockedSupportingSlugs)

  for (const item of Array.isArray(proposed) ? proposed : []) {
    const keyword = keywordLabel(item)
    if (!keyword) continue
    const slug = slugifyKeyword(item.slug || keyword)
    if (seen.has(slug) || lockedSet.has(slug)) continue
    supporting.push({
      slug,
      keyword,
      plannedArticles: [],
    })
    seen.add(slug)
  }

  const nextPillar = { ...pillar, supporting }
  const nextPillars = state.pillars.map((row, i) => (i === index ? nextPillar : row))
  const { error } = await supabase
    .from('content_coverage')
    .update({
      pillars: nextPillars,
      updated_at: new Date().toISOString(),
    })
    .eq('company_id', companyId)
  if (error) throw error

  return {
    pillar: nextPillar,
    lockedSupportingSlugs,
    supportingCount: supporting.length,
  }
}
