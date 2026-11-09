// Downloadable audit reports (Markdown): the full audit and the recommended
// actions. Pure string builders + a browser download helper.

import { CATEGORIES, SEVERITY_LABELS } from '../../../../lib/audit/categories.js'
import { SECTIONS, SECTION_ORDER, KIND_LABELS, EFFORT_LABELS } from '../../../../lib/audit/catalog.js'
import { METRIC_LABELS } from './metrics.js'

const SEVERITY_RANK = { critical: 0, high: 1, medium: 2, low: 3 }
const ENGINE_LABELS = { chat_gpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity' }

/** Markdown table cell: one line, pipes escaped. */
function cell(v) {
  if (v == null || v === '') return '—'
  return String(v).replace(/\r?\n+/g, ' ').replace(/\|/g, '\\|').trim()
}

/** @param {string[]} headers @param {any[][]} rows */
function table(headers, rows) {
  if (!rows.length) return ''
  return [
    `| ${headers.map(cell).join(' | ')} |`,
    `| ${headers.map(() => '---').join(' | ')} |`,
    ...rows.map((r) => `| ${r.map(cell).join(' | ')} |`),
  ].join('\n')
}

function isoDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '' : d.toISOString().slice(0, 16).replace('T', ' ') + ' UTC'
}

function money(v) {
  const n = Number(v) || 0
  return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`
}

/** @param {string} url */
function pathOf(url) {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

function slug(s) {
  return String(s || 'audit')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60)
}

/** Category-specific tables, mirroring what the page shows. */
function categoryTables(categoryId, m) {
  const out = []
  if (categoryId === 'schema' && m.typeCounts && Object.keys(m.typeCounts).length) {
    out.push(
      '### Schema types found',
      table(
        ['Type', 'Pages'],
        Object.entries(m.typeCounts).sort((a, b) => Number(b[1]) - Number(a[1]))
      )
    )
  }
  if (categoryId === 'clusters' && m.clusters?.length) {
    out.push(
      '### Clusters',
      table(
        ['Pillar', 'Pillar page', 'Articles', 'Pillar → articles', 'Articles → pillar', 'Sibling links', 'Unpublished planned'],
        m.clusters.map((r) => [r.keyword, r.pillarUrl || 'Not published', r.articles, r.pillarLinksOut, r.linksBack, r.siblingLinked, r.plannedUnpublished || 0])
      )
    )
  }
  if (categoryId === 'speed' && m.pages?.length) {
    out.push(
      '### Pages tested (mobile)',
      table(
        ['Template', 'Page', 'Perf', 'SEO', 'A11y', 'Lab LCP', 'Lab CLS'],
        m.pages.map((p) =>
          p.error
            ? [p.kind, p.url, `Error: ${p.error}`, '', '', '', '']
            : [
                p.kind,
                p.url,
                p.performance,
                p.seo,
                p.accessibility,
                p.labLcpMs != null ? `${(p.labLcpMs / 1000).toFixed(1)} s` : '',
                p.labCls != null ? Number(p.labCls).toFixed(2) : '',
              ]
        )
      )
    )
  }
  if (categoryId === 'authority' && m.competitors?.length) {
    out.push(
      '### You vs competitors (Moz)',
      table(
        ['Site', 'Domain', 'DA', 'Linking roots', 'Spam %'],
        [
          ['You', m.target, m.domainAuthority, m.linkingRootDomains, m.spamScore],
          ...m.competitors.map((c) =>
            c.error ? [c.name, c.domain, c.error, '', ''] : [c.name, c.domain, c.domainAuthority, c.linkingRootDomains, c.spamScore]
          ),
        ]
      )
    )
  }
  if (categoryId === 'aeo_readiness') {
    const kinds = { ai_search: 'AI search', ai_user: 'AI live fetch', search: 'Search engine', ai_training: 'AI training' }
    if (m.bots?.length) {
      out.push(
        `### Crawler access (training policy: ${m.trainingPolicy || 'allow'} · llms.txt: ${m.llmsTxt || '—'})`,
        table(
          ['Crawler', 'Kind', 'robots.txt', 'Server response', 'Visits (30 days)', 'Last visit'],
          m.bots.map((b) => [
            b.bot,
            kinds[b.kind] || b.kind,
            b.robots,
            b.serverNote || (b.httpStatus ? `HTTP ${b.httpStatus}` : 'robots token only'),
            m.aiVisits30d === '—' ? '—' : b.visits30d,
            b.lastVisit ? String(b.lastVisit).slice(0, 10) : '',
          ])
        )
      )
    }
    if (m.pages?.length) {
      out.push(
        '### Article and pillar structure',
        table(
          ['Page', 'Kind', 'Words in HTML', 'Answer-first', 'Question headings', 'Lists / tables', 'Date', 'Snippet block'],
          m.pages.map((p) => [
            p.url,
            p.kind,
            p.words,
            p.sections ? `${p.answerFirst} / ${p.sections}` : '',
            p.sections ? `${p.questions} / ${p.sections}` : '',
            p.listsTables,
            p.hasDate ? 'Yes' : 'No',
            p.snippetBlocked ? 'Yes' : 'No',
          ])
        )
      )
    }
  }
  if (categoryId === 'ai_visibility') {
    const engines = Object.keys(ENGINE_LABELS)
    if (m.models) {
      out.push(
        '### Models used',
        table(['Engine', 'Model'], engines.map((e) => [ENGINE_LABELS[e], m.models[e]]))
      )
    }
    if (m.matrix?.length) {
      const mark = (c) => {
        if (!c) return '—'
        if (c.error) return 'Error'
        const base = c.cited ? 'Cited' : c.mentioned ? 'Named' : 'Absent'
        return c.competitorsNamed?.length ? `${base} (+${c.competitorsNamed.join(', ')})` : base
      }
      out.push(
        '### Answers by question and engine',
        table(
          ['Intent', 'Question', ...engines.map((e) => ENGINE_LABELS[e])],
          m.matrix.map((r) => [r.intent, r.prompt, ...engines.map((e) => mark(r.cells?.[e]))])
        )
      )
    }
    if (m.shareOfVoiceRows?.length) {
      out.push(
        `### Share of voice (answers naming each brand, of ${m.buyerAnswers ?? '—'})`,
        table(['Brand', 'Answers'], m.shareOfVoiceRows.map((r) => [r.name, r.count]))
      )
    }
    if (m.topSources?.length) {
      out.push(
        '### Sources AI trusts (most-cited domains)',
        table(
          ['Domain', 'Citations', 'Note'],
          m.topSources.map((s) => [s.domain, s.count, s.self ? 'Your site' : s.competitor ? `Competitor: ${s.competitor}` : 'Placement target'])
        )
      )
    }
    if (m.google?.length) {
      const g = (v) => (!v ? '—' : !v.present ? 'None shown' : v.cited ? 'Cited' : 'Not cited')
      out.push(
        '### Google AI on core keywords',
        table(
          ['Keyword', 'AI Overview', 'AI Mode', 'Organic rank', 'Competitors cited'],
          m.google.map((r) =>
            r.error
              ? [r.keyword, `Error: ${r.error}`, '', '', '']
              : [
                  r.keyword,
                  g(r.overview),
                  g(r.aiMode),
                  r.overview?.organicPosition,
                  [...new Set([...(r.overview?.competitorsCited || []), ...(r.aiMode?.competitorsCited || [])])].join(', '),
                ]
          )
        )
      )
    }
    if (m.matrix?.length) {
      const answers = []
      for (const r of m.matrix) {
        for (const e of engines) {
          const c = r.cells?.[e]
          if (!c || c.error || !c.excerpt) continue
          answers.push(
            `**${ENGINE_LABELS[e]} · ${r.prompt}**\n\n> ${c.excerpt.replace(/\n+/g, ' ')}${
              c.sources?.length ? `\n\nSources: ${c.sources.join(', ')}` : ''
            }`
          )
        }
      }
      if (answers.length) out.push('### Answer excerpts', answers.join('\n\n'))
    }
  }
  return out.filter(Boolean)
}

/** Compact one-line evidence: "key: value; key: a, b". */
function evidenceLine(evidence) {
  if (!evidence || typeof evidence !== 'object') return ''
  const parts = []
  for (const [k, v] of Object.entries(evidence)) {
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) continue
    const val = Array.isArray(v)
      ? v.map((x) => (typeof x === 'object' ? JSON.stringify(x) : String(x))).join(', ')
      : typeof v === 'object'
        ? JSON.stringify(v)
        : String(v)
    parts.push(`${k}: ${val.replace(/\s+/g, ' ').slice(0, 300)}`)
  }
  return parts.join('; ')
}

/** @param {any[]} issues */
function groupedIssues(issues) {
  const map = new Map()
  for (const i of issues) {
    const g = map.get(i.check_id) || { title: i.title, severity: i.severity, fixHint: i.fix_hint || '', items: [] }
    if (SEVERITY_RANK[i.severity] < SEVERITY_RANK[g.severity]) g.severity = i.severity
    if (!g.fixHint && i.fix_hint) g.fixHint = i.fix_hint
    g.items.push(i)
    map.set(i.check_id, g)
  }
  return [...map.values()].sort(
    (a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] || b.items.length - a.items.length
  )
}

/**
 * One data source's section (headings start at ##).
 * @param {{ meta: { id: string, label: string, description?: string, paid?: boolean }, entry: any }} input
 */
function sourceMarkdown({ meta, entry }) {
  const latest = entry.latest || {}
  const m = latest.metrics || {}
  const issues = entry.issues || []
  const metricLabels = METRIC_LABELS[meta.id] || []
  const lines = [
    `## ${meta.label}`,
    '',
    [
      `Run: ${isoDate(latest.finished_at || latest.started_at)}`,
      entry.previous ? `Compared with: ${isoDate(entry.previous.started_at)}` : 'First run (baseline)',
      meta.paid ? `Cost: ${money(latest.cost_usd)}` : '',
    ]
      .filter(Boolean)
      .join(' · '),
    '',
    meta.description || '',
    '',
    `${issues.length} open issue(s)` +
      (entry.diffCounts ? ` · ${entry.diffCounts.new} new, ${entry.diffCounts.persisting} persisting, ${entry.diffCounts.fixed} fixed` : '') +
      (entry.accepted?.length ? ` · ${entry.accepted.length} accepted` : ''),
  ]

  if (metricLabels.length) {
    lines.push('', '### Key metrics', '', table(['Metric', 'Value'], metricLabels.map(([key, label]) => [label, m[key]])))
  }

  const extra = categoryTables(meta.id, m)
  if (extra.length) lines.push('', '### Details', '', extra.join('\n\n').replace(/^### /gm, '#### '))

  if (m.warnings?.length) lines.push('', '### Notes', '', ...m.warnings.map((w) => `- ${w}`))

  lines.push('', '### Issues')
  if (!issues.length) {
    lines.push('', 'No open issues.')
  } else {
    for (const g of groupedIssues(issues)) {
      lines.push('', `#### ${SEVERITY_LABELS[g.severity] || g.severity}: ${g.title} (${g.items.length})`)
      if (g.fixHint) lines.push('', `**Fix:** ${g.fixHint}`)
      lines.push('')
      for (const i of g.items) {
        const where = i.url ? `${pathOf(i.url)} — ` : ''
        const tag = i.diff === 'new' ? ' **[new]**' : ''
        lines.push(`- ${where}${i.detail || i.title}${tag}`)
        const ev = evidenceLine(i.evidence)
        if (ev) lines.push(`    - Evidence: ${ev}`)
      }
    }
  }

  if (entry.fixed?.length) {
    lines.push('', '### Fixed since the previous run', '', ...entry.fixed.map((i) => `- ${i.title}${i.url ? ` — ${pathOf(i.url)}` : ''}`))
  }
  if (entry.accepted?.length) {
    lines.push('', '### Accepted (excluded from the score)', '', ...entry.accepted.map((i) => `- ${i.title}${i.url ? ` — ${pathOf(i.url)}` : ''}`))
  }
  return lines.join('\n')
}

const STATUS_WORDS = { fail: 'Fail', warning: 'Warning', pass: 'Pass', not_tested: 'Not tested', na: 'N/A' }
const TIER_TITLES = {
  fix_first: 'Fix first',
  next: 'Fix next',
  improve: 'Improvements & experiments',
  outside: 'Content, AI visibility & authority (not in the scores)',
}

function finish(lines) {
  return lines.join('\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

function header(company, title) {
  return [
    `# ${company?.name ? `${company.name} — ` : ''}${title}`,
    '',
    [company?.siteUrl ? `Site: ${company.siteUrl}` : '', `Generated: ${isoDate(new Date().toISOString())}`].filter(Boolean).join(' · '),
  ]
}

function scoreLines(readiness) {
  const prev = readiness.previous
  const delta = (now, before) =>
    typeof now === 'number' && typeof before === 'number' && now !== before ? ` (${now > before ? '+' : ''}${now - before})` : ''
  return [
    `**Website readiness: ${readiness.overall ?? '—'}/100${delta(readiness.overall, prev?.overall)}** · ${readiness.checksTested} of ${readiness.checksTotal} checks tested` +
      (readiness.overallCapped ? ' · capped by a critical issue' : ''),
    '',
    table(
      ['Score', 'Value', 'Checks tested', 'Fails', 'Warnings'],
      readiness.scores.map((s) => [
        s.label,
        s.score == null ? '—' : `${s.score}${delta(s.score, prev?.scores?.[s.id])}`,
        `${s.checksTested}/${s.checksTotal}`,
        s.fails,
        s.warnings,
      ])
    ),
  ]
}

function actionLines(actions) {
  const lines = []
  for (const tier of Object.keys(TIER_TITLES)) {
    const items = actions.filter((a) => a.tier === tier)
    if (!items.length) continue
    lines.push('', `## ${TIER_TITLES[tier]} (${items.length})`)
    items.forEach((a, n) => {
      const where = a.siteWide ? 'Site-wide' : `${a.affected} page${a.affected === 1 ? '' : 's'}`
      lines.push(
        '',
        `### ${n + 1}. ${a.title || a.label}`,
        '',
        `${SEVERITY_LABELS[a.severity] || a.severity} · ${KIND_LABELS[a.kind] || a.kind} · ${SECTIONS[a.section] || a.section} · ${where} · ${EFFORT_LABELS[a.effort] || a.effort}`
      )
      if (a.detail) lines.push('', a.detail)
      lines.push('', `- **Why it matters:** ${a.why}`)
      if (a.fix) lines.push(`- **Fix:** ${a.fix}`)
      lines.push(`- **How to verify:** ${a.verify}`)
      if (a.urls?.length) {
        lines.push('', ...a.urls.map((u) => `- ${u}`))
        if (a.affected > a.urls.length) lines.push(`- …and ${a.affected - a.urls.length} more`)
      }
    })
  }
  return lines
}

/** Recommended actions only, in priority order. */
export function buildActionsMarkdown({ company, readiness }) {
  const actions = readiness?.actions || []
  const lines = [...header(company, 'Recommended actions')]
  if (readiness) lines.push('', ...scoreLines(readiness))
  if (!actions.length) lines.push('', 'Nothing to fix in the checks that ran.')
  else lines.push(...actionLines(actions))
  return finish(lines)
}

/** The full audit: scores, actions, every check by section, then each data source's details. */
export function buildAuditMarkdown({ company, readiness, categories }) {
  const lines = [...header(company, 'SEO & AEO audit')]
  if (readiness) {
    lines.push('', ...scoreLines(readiness))
    if (readiness.actions?.length) lines.push('', '# Recommended actions', ...actionLines(readiness.actions))
    lines.push('', '# All checks by section')
    for (const section of SECTION_ORDER) {
      const rows = (readiness.checks || []).filter((c) => c.section === section)
      if (!rows.length) continue
      lines.push(
        '',
        `## ${/^[A-L]$/.test(section) ? `${section} · ` : ''}${SECTIONS[section]}`,
        '',
        table(
          ['Check', 'Result', 'Detail'],
          rows.map((c) => [
            c.label,
            STATUS_WORDS[c.status] || c.status,
            c.status === 'fail' || c.status === 'warning'
              ? `${c.siteWide ? 'Site-wide' : `${c.affected} page(s)`}${c.detail ? ` — ${c.detail}` : ''}`
              : c.status === 'pass'
                ? ''
                : c.reason,
          ])
        )
      )
    }
  }
  const sources = CATEGORIES.filter((c) => categories?.[c.id]?.latest)
  if (sources.length) {
    lines.push('', '# Data sources')
    for (const meta of sources) lines.push('', sourceMarkdown({ meta, entry: categories[meta.id] }))
  }
  return finish(lines)
}

/** e.g. "rupert-audit-2026-11-09.md" */
export function reportFilename(company, kind) {
  return `${slug(company?.name)}-${kind}-${new Date().toISOString().slice(0, 10)}.md`
}

/** Trigger a browser download. */
export function downloadFile(filename, content, type) {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
