// lib/article-updates/rewrite-run.js
//
// Slice 4b — run layer for the random-section improvement.
//   - readRewriteOpts / pickSectionItems        (audit: select + recommend, no LLM)
//   - proposeRewrites                            (LLM via injected callModel + guardrails)
//   - buildRewriteCommitPlan                     (deterministic, re-guardrailed, one-per-article)
//
// Hybrid contract (confirmed):
//   - additive options: the model returns ONLY the new 1-2 sentences; we append
//     them as a new paragraph, so the original body is kept byte-for-byte and no
//     existing sentence can be silently altered.
//   - wordsmithing: the model returns the FULL revised section; guardrails allow
//     at most one changed sentence.
// Every proposal is guardrailed; failures are dropped, never surfaced/committed.

import {
  parseSections,
  pickRandomSection,
  sectionMenu,
  buildRewritePrompt,
  checkGuardrails,
  applyRewriteToBody,
  ADDITIVE_OPTIONS,
} from './rewrite.js'
import { splitMarkdown, todayIso } from '../wire-internal-links/plan.js'
import { bumpUpdatedDate } from './wts.js'

export const REWRITE_DEFAULTS = {
  batchSize: 5,
  excludeBuckets: ['0-14'],
  threshold: 30, // rank hard-exclude threshold (handled in the handler)
  maxCommit: 5,
}

export function readRewriteOpts(body = {}) {
  const out = { ...REWRITE_DEFAULTS }
  if (Number.isFinite(Number(body.batchSize)) && Number(body.batchSize) > 0) {
    out.batchSize = Math.min(Number(body.batchSize), 25)
  }
  if (Array.isArray(body.excludeBuckets)) out.excludeBuckets = body.excludeBuckets.map(String)
  if (Number.isFinite(Number(body.rankThreshold)) && Number(body.rankThreshold) > 0) {
    out.threshold = Math.min(Number(body.rankThreshold), 100)
  }
  if (Number.isFinite(Number(body.maxCommit)) && Number(body.maxCommit) > 0) {
    out.maxCommit = Math.min(Number(body.maxCommit), 10)
  }
  return out
}

function normHeading(text) {
  return String(text || '').trim().toLowerCase().replace(/\s+/g, ' ')
}

function liveMap(liveArticles) {
  return new Map((Array.isArray(liveArticles) ? liveArticles : []).map((a) => [a.slug, a]))
}

/** Strip fences / wrapping quotes / stray preamble from a model text reply. */
export function cleanModelText(raw) {
  let s = String(raw || '').trim()
  s = s.replace(/^```[a-z]*\s*/i, '').replace(/\s*```$/i, '').trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  return s
}

/** additive => append cleaned model text as a new paragraph; else full replace. */
export function spliceProposal(originalText, rawModelOutput, additive) {
  const cleaned = cleanModelText(rawModelOutput)
  if (additive) return `${String(originalText).replace(/\s+$/, '')}\n\n${cleaned}`
  return cleaned
}

/** Audit: for each eligible slug, pick one random section + recommend an option. */
export function pickSectionItems(liveArticles, eligibleSlugs, rankBySlug = {}, { rng } = {}) {
  const live = liveMap(liveArticles)
  const items = []
  const noSection = []
  for (const slug of Array.isArray(eligibleSlugs) ? eligibleSlugs : []) {
    const article = live.get(slug)
    if (!article) continue
    const section = pickRandomSection(article.body, rng || Math.random)
    if (!section) {
      noSection.push(slug)
      continue
    }
    const { recommended, menu } = sectionMenu(section)
    items.push({
      slug,
      path: article.path,
      title: String(article?.data?.title || slug),
      heading: section.heading,
      sectionText: section.text,
      recommended,
      menu,
      position: rankBySlug[slug]?.position ?? null,
    })
  }
  return { items, noSection }
}

/** Propose (LLM). callModel({ prompt, needsWebSearch }) must resolve to text. */
export async function proposeRewrites(liveArticles, approvedItems, opts = {}, { callModel } = {}) {
  if (typeof callModel !== 'function') throw new Error('callModel is required')
  const live = liveMap(liveArticles)
  const proposals = []
  const dropped = []

  for (const it of Array.isArray(approvedItems) ? approvedItems : []) {
    const slug = String(it?.slug || '').trim()
    const heading = String(it?.heading || '').trim()
    const option = String(it?.option || '').trim()
    if (!slug || !heading) {
      dropped.push({ slug, heading, reason: 'missing-fields' })
      continue
    }
    if (option === 'skip') {
      dropped.push({ slug, heading, reason: 'skipped' })
      continue
    }
    const article = live.get(slug)
    if (!article) {
      dropped.push({ slug, heading, reason: 'not_found' })
      continue
    }
    const section = parseSections(article.body).find(
      (s) => s.eligible && normHeading(s.heading) === normHeading(heading)
    )
    if (!section) {
      dropped.push({ slug, heading, reason: 'section-not-eligible' })
      continue
    }

    const { prompt, needsWebSearch, additive } = buildRewritePrompt({
      section,
      option,
      targetKeyword: article.data?.targetKeyword,
      pillarKeyword: article.data?.pillarKeyword,
    })

    let raw
    try {
      raw = await callModel({ prompt, needsWebSearch })
    } catch (err) {
      dropped.push({ slug, heading, option, reason: 'model-error', message: err?.message })
      continue
    }

    const proposed = spliceProposal(section.text, raw, additive)
    const gr = checkGuardrails({
      original: section.text,
      proposed,
      option,
      targetKeyword: article.data?.targetKeyword,
      pillarKeyword: article.data?.pillarKeyword,
    })
    if (!gr.ok) {
      dropped.push({ slug, heading, option, reason: 'guardrail', failures: gr.failures })
      continue
    }

    proposals.push({
      slug,
      heading,
      option,
      proposedSectionText: proposed,
      added: additive ? cleanModelText(raw) : null,
    })
  }

  return { proposals, dropped }
}

/**
 * Commit plan (deterministic, no LLM). Re-guardrails each approved proposal
 * against the live section, enforces one change per article, rebuilds raw, bumps
 * updatedDate. Rank hard-exclude is applied by the handler before this runs.
 */
export function buildRewriteCommitPlan(liveArticles, approvedItems, opts = {}) {
  const live = liveMap(liveArticles)
  const isoDate = todayIso()
  const files = []
  const skipped = []
  const errors = []
  const doneSlugs = new Set()

  const capped = (Array.isArray(approvedItems) ? approvedItems : []).slice(
    0,
    opts.maxCommit || REWRITE_DEFAULTS.maxCommit
  )

  for (const item of capped) {
    const slug = String(item?.slug || '').trim()
    const heading = String(item?.heading || '').trim()
    const proposed = String(item?.proposedSectionText || '')
    const option = String(item?.option || '').trim()

    if (!slug) continue
    if (doneSlugs.has(slug)) {
      skipped.push({ slug, reason: 'one-per-article', message: 'Only one section change per article per run' })
      continue
    }
    const article = live.get(slug)
    if (!article) {
      skipped.push({ slug, reason: 'not_found' })
      continue
    }
    if (article.data?.draft === true) {
      skipped.push({ slug, reason: 'draft' })
      continue
    }
    const section = parseSections(article.body).find(
      (s) => s.eligible && normHeading(s.heading) === normHeading(heading)
    )
    if (!section) {
      skipped.push({ slug, reason: 'section-not-eligible' })
      continue
    }

    const gr = checkGuardrails({
      original: section.text,
      proposed,
      option,
      targetKeyword: article.data?.targetKeyword,
      pillarKeyword: article.data?.pillarKeyword,
    })
    if (!gr.ok) {
      skipped.push({ slug, reason: 'guardrail', failures: gr.failures })
      continue
    }

    const split = splitMarkdown(article.raw)
    if (!split.ok) {
      errors.push({ slug, message: 'frontmatter split failed' })
      continue
    }
    const newBody = applyRewriteToBody(article.body, section, proposed)
    let content = `---\n${split.yaml}\n---\n${newBody}`
    content = bumpUpdatedDate(content, isoDate)
    if (content === article.raw) {
      skipped.push({ slug, reason: 'unchanged' })
      continue
    }

    doneSlugs.add(slug)
    files.push({
      slug,
      path: article.path,
      content,
      title: String(article?.data?.title || slug),
      heading,
    })
  }

  return { files, skipped, errors, isoDate }
}
