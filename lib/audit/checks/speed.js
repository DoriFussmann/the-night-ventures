// Speed category: PageSpeed Insights (mobile) on one page per template
// (home, pillar, article) plus the origin's real-user Core Web Vitals (CrUX).
// Pure: takes PSI results, returns { issues, metrics }.

import { makeIssue, dedupeIssues } from '../issues.js'

const CATEGORY = 'speed'

/** Template kinds tested, in order. One URL each. */
export const SPEED_TEMPLATES = ['home', 'pillar', 'article']

/** Google's Core Web Vitals thresholds (good ≤ first, poor > second). */
export const CWV_THRESHOLDS = {
  lcp: { good: 2500, poor: 4000 },
  inp: { good: 200, poor: 500 },
  cls: { good: 0.1, poor: 0.25 },
}

const CWV_LABELS = {
  lcp: 'Largest Contentful Paint',
  inp: 'Interaction to Next Paint',
  cls: 'Cumulative Layout Shift',
}

const CWV_FIX = {
  lcp: 'Serve the hero image in a modern format at the rendered size, preload it, and cut render-blocking CSS/JS above the fold.',
  inp: 'Break up long JavaScript tasks, defer third-party scripts, and keep event handlers light.',
  cls: 'Set width/height on images and embeds, reserve space for late content, and avoid injecting banners above existing content.',
}

/**
 * Pick one URL per template from the audit URL list.
 * @param {Array<{ url: string, kind: string }>} entries
 * @returns {Array<{ url: string, kind: string }>}
 */
export function pickSpeedTargets(entries) {
  const out = []
  for (const kind of SPEED_TEMPLATES) {
    const hit = (entries || []).find((e) => e.kind === kind)
    if (hit) out.push({ url: hit.url, kind })
  }
  return out
}

/** CrUX percentile → comparable number (CLS arrives ×100 from the API). */
function fieldValue(metricKey, block) {
  const p = Number(block?.percentile)
  if (!Number.isFinite(p)) return null
  return metricKey === 'cls' ? p / 100 : p
}

/** good | needs_improvement | poor | null */
export function rateVital(metricKey, value) {
  const t = CWV_THRESHOLDS[metricKey]
  if (!t || value == null || !Number.isFinite(value)) return null
  if (value <= t.good) return 'good'
  if (value <= t.poor) return 'needs_improvement'
  return 'poor'
}

/** Pull LCP/INP/CLS numbers from a CrUX block ({ metrics: { lcp, inp, cls } }). */
export function fieldVitals(crux) {
  const m = crux?.metrics
  if (!m) return null
  const out = {
    lcp: fieldValue('lcp', m.lcp),
    inp: fieldValue('inp', m.inp),
    cls: fieldValue('cls', m.cls),
  }
  return out.lcp == null && out.inp == null && out.cls == null ? null : out
}

function formatVital(metricKey, value) {
  if (value == null) return '—'
  if (metricKey === 'cls') return value.toFixed(2)
  if (metricKey === 'lcp') return `${(value / 1000).toFixed(1)} s`
  return `${Math.round(value)} ms`
}

function vitalIssues(vitals, { url, prefix, who }) {
  const issues = []
  for (const key of ['lcp', 'inp', 'cls']) {
    const rating = rateVital(key, vitals[key])
    if (rating !== 'poor' && rating !== 'needs_improvement') continue
    const poor = rating === 'poor'
    const t = CWV_THRESHOLDS[key]
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: `${prefix}${key}_${poor ? 'poor' : 'needs_improvement'}`,
        severity: poor ? 'high' : 'medium',
        title: `${who} ${CWV_LABELS[key]} ${poor ? 'is poor' : 'needs improvement'}`,
        detail: `p75 ${formatVital(key, vitals[key])} (good ≤ ${formatVital(key, t.good)}, poor > ${formatVital(key, t.poor)}).`,
        url,
        target: url ? '' : `origin:${key}`,
        evidence: { metric: key, value: vitals[key], rating },
        fixHint: CWV_FIX[key],
      })
    )
  }
  return issues
}

/**
 * @param {object} input
 * @param {Array<{ url: string, kind: string, result: any }>} input.pages  PSI mobile result per template page
 * @returns {{ issues: any[], metrics: Record<string, any> }}
 */
export function buildSpeedIssues({ pages }) {
  const issues = []
  const tested = (pages || []).filter((p) => p.result?.ok)
  const failed = (pages || []).filter((p) => !p.result?.ok)

  // Site level: origin CrUX (same for every page; take the first that has it).
  const originBlock = tested.map((p) => p.result.coreWebVitals?.origin).find((o) => fieldVitals(o))
  const origin = fieldVitals(originBlock)
  if (origin) {
    issues.push(...vitalIssues(origin, { url: null, prefix: 'cwv_', who: 'Real-user' }))
  } else if (tested.length) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'no_field_data',
        severity: 'low',
        title: 'No real-user Core Web Vitals data',
        detail: 'Chrome UX Report has too little traffic for this origin; scores below are lab-only.',
        target: 'origin',
        fixHint: 'Nothing to fix directly — field data appears once the site has enough Chrome traffic.',
      })
    )
  }

  const pageRows = []
  for (const page of pages || []) {
    const r = page.result
    if (!r?.ok) {
      pageRows.push({ url: page.url, kind: page.kind, error: r?.error || 'PageSpeed failed' })
      continue
    }
    const performance = r.scores?.performance ?? null
    const lab = r.coreWebVitals?.lab || {}
    const urlField = fieldVitals(r.coreWebVitals?.url)
    pageRows.push({
      url: page.url,
      kind: page.kind,
      performance,
      seo: r.scores?.seo ?? null,
      accessibility: r.scores?.accessibility ?? null,
      labLcpMs: lab.lcpMs ?? null,
      labCls: lab.cls ?? null,
      field: urlField,
    })

    if (typeof performance === 'number' && performance < 90) {
      const poor = performance < 50
      issues.push(
        makeIssue({
          category: CATEGORY,
          checkId: poor ? 'performance_score_poor' : 'performance_score_needs_work',
          severity: poor ? 'high' : 'medium',
          title: poor ? 'Mobile performance score is poor (< 50)' : 'Mobile performance score below 90',
          detail: `${page.kind} template scored ${performance}/100 on mobile.`,
          url: page.url,
          evidence: { performance, kind: page.kind },
          fixHint: 'Open the page in PageSpeed Insights and work the "Opportunities" list top-down.',
        })
      )
    }

    // URL-level real-user data, when Chrome has enough traffic for this page.
    if (urlField) {
      issues.push(...vitalIssues(urlField, { url: page.url, prefix: 'page_cwv_', who: 'Page real-user' }))
    } else if (!origin) {
      // Lab-only fallback when Chrome has no real-user data at all
      // (throttled mobile; lower severity than field data).
      if (rateVital('lcp', lab.lcpMs) === 'poor') {
        issues.push(
          makeIssue({
            category: CATEGORY,
            checkId: 'lab_lcp_slow',
            severity: 'medium',
            title: 'Lab LCP over 4 s on mobile',
            detail: `${page.kind} template: LCP ${formatVital('lcp', lab.lcpMs)} in the Lighthouse lab run.`,
            url: page.url,
            evidence: { lcpMs: lab.lcpMs },
            fixHint: CWV_FIX.lcp,
          })
        )
      }
      if (rateVital('cls', lab.cls) === 'poor') {
        issues.push(
          makeIssue({
            category: CATEGORY,
            checkId: 'lab_cls_high',
            severity: 'medium',
            title: 'Lab CLS over 0.25',
            detail: `${page.kind} template: CLS ${formatVital('cls', lab.cls)} in the Lighthouse lab run.`,
            url: page.url,
            evidence: { cls: lab.cls },
            fixHint: CWV_FIX.cls,
          })
        )
      }
    }
  }

  for (const page of failed) {
    issues.push(
      makeIssue({
        category: CATEGORY,
        checkId: 'pagespeed_failed',
        severity: 'low',
        title: 'PageSpeed could not test this page',
        detail: String(page.result?.error || 'PageSpeed failed'),
        url: page.url,
        fixHint: 'Check the page loads publicly without auth or bot blocking, then re-run.',
      })
    )
  }

  const perfByKind = Object.fromEntries(pageRows.map((p) => [p.kind, p.performance ?? null]))
  const metrics = {
    pagesChecked: tested.length,
    pagesFailed: failed.length,
    homePerformance: perfByKind.home ?? null,
    pillarPerformance: perfByKind.pillar ?? null,
    articlePerformance: perfByKind.article ?? null,
    fieldLcp: origin ? formatVital('lcp', origin.lcp) : null,
    fieldInp: origin ? formatVital('inp', origin.inp) : null,
    fieldCls: origin ? formatVital('cls', origin.cls) : null,
    hasFieldData: Boolean(origin),
    pages: pageRows,
  }
  if (!tested.length && failed.length) {
    metrics.warnings = ['PageSpeed failed on every page tested — the score reflects that only.']
  }
  return { issues: dedupeIssues(issues), metrics }
}
