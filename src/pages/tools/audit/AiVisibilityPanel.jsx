import React, { useCallback, useEffect, useState } from 'react'
import { Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { buttonVariants } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { getAiPrompts, regenerateAiPrompts, removeAiPrompt } from './api'

const TH = 'px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground'
const TD = 'px-3 py-1.5 tabular-nums'
const ENGINES = ['chat_gpt', 'claude', 'gemini', 'perplexity']
const ENGINE_LABELS = { chat_gpt: 'ChatGPT', claude: 'Claude', gemini: 'Gemini', perplexity: 'Perplexity' }
const INTENT_LABELS = { recommendation: 'Recommend', problem: 'Problem', comparison: 'Compare', brand: 'Brand' }

/** @param {string} url */
function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

/** @param {{ cell: any }} props */
function CellMark({ cell }) {
  if (!cell) return <span className="text-muted-foreground">—</span>
  if (cell.error) return <span className="text-red-600 dark:text-red-400" title={cell.error}>error</span>
  const comps = cell.competitorsNamed?.length || 0
  return (
    <span className="inline-flex items-center gap-1.5">
      {cell.cited ? (
        <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300">Cited</span>
      ) : cell.mentioned ? (
        <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">Named</span>
      ) : (
        <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">Absent</span>
      )}
      {comps ? <span className="text-[11px] text-muted-foreground" title={cell.competitorsNamed.join(', ')}>+{comps} comp.</span> : null}
    </span>
  )
}

/** Prompt × engine grid; click a cell for the answer. @param {{ matrix: any[], models: Record<string,string> }} props */
function AnswerGrid({ matrix, models }) {
  const [open, setOpen] = useState(/** @type {{ row: string, engine: string } | null} */ (null))
  if (!matrix?.length) return null
  const openRow = open && matrix.find((r) => r.id === open.row)
  const openCell = openRow?.cells?.[open.engine]
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Answers by question and engine</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className={TH}>Question</th>
              {ENGINES.map((e) => (
                <th key={e} className={TH} title={models?.[e] || ''}>
                  {ENGINE_LABELS[e]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {matrix.map((row) => (
              <tr key={row.id} className={cn('border-t border-border', row.intent === 'brand' && 'bg-accent/30')}>
                <td className={`${TD} max-w-[22rem]`}>
                  <span className="mr-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                    {INTENT_LABELS[row.intent] || row.intent}
                  </span>
                  {row.prompt}
                </td>
                {ENGINES.map((e) => (
                  <td key={e} className={TD}>
                    <button
                      type="button"
                      className={cn(
                        'rounded px-0.5 hover:bg-accent',
                        open?.row === row.id && open?.engine === e && 'ring-1 ring-primary'
                      )}
                      onClick={() => setOpen(open?.row === row.id && open?.engine === e ? null : { row: row.id, engine: e })}
                      aria-label={`${ENGINE_LABELS[e]} answer to: ${row.prompt}`}
                    >
                      <CellMark cell={row.cells?.[e]} />
                    </button>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {openRow && openCell ? (
        <div className="space-y-2 rounded-md border border-border bg-card/40 p-3 text-xs">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium">
              {ENGINE_LABELS[open.engine]} · {openRow.prompt}
            </p>
            <button type="button" onClick={() => setOpen(null)} aria-label="Close answer" className="text-muted-foreground hover:text-foreground">
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {openCell.error ? (
            <p className="text-red-600 dark:text-red-400">{openCell.error}</p>
          ) : (
            <>
              <p className="whitespace-pre-line text-muted-foreground">{openCell.excerpt || '(empty answer)'}</p>
              {openCell.competitorsNamed?.length ? <p>Competitors named: {openCell.competitorsNamed.join(', ')}</p> : null}
              {openCell.sources?.length ? (
                <ul className="flex flex-wrap gap-1.5">
                  {openCell.sources.map((u) => (
                    <li key={u}>
                      <a href={u} target="_blank" rel="noreferrer" className="rounded border border-border px-1.5 py-0.5 hover:underline" title={u}>
                        {hostOf(u)}
                      </a>
                    </li>
                  ))}
                </ul>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </div>
  )
}

/** @param {{ rows: Array<{ name: string, self: boolean, count: number }>, total: number }} props */
function ShareOfVoice({ rows, total }) {
  if (!rows?.length || !total) return null
  const max = Math.max(1, ...rows.map((r) => r.count))
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Share of voice · answers that name each brand (of {total})</h3>
      <ul className="space-y-1">
        {rows.map((r) => (
          <li key={r.name} className="grid grid-cols-[9rem_1fr_2.5rem] items-center gap-2 text-xs">
            <span className={cn('truncate', r.self && 'font-semibold')}>{r.name}</span>
            <span className="h-2 rounded bg-muted">
              <span
                className={cn('block h-2 rounded', r.self ? 'bg-primary' : 'bg-muted-foreground/50')}
                style={{ width: `${(r.count / max) * 100}%` }}
              />
            </span>
            <span className="text-right tabular-nums">{r.count}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

/** @param {{ rows: any[] }} props */
function TopSources({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Sources AI trusts · most-cited domains in buyer answers</h3>
      <ul className="flex flex-wrap gap-1.5">
        {rows.map((s) => (
          <li
            key={s.domain}
            className={cn(
              'rounded border border-border px-1.5 py-0.5 text-[11px]',
              s.self && 'border-primary font-medium',
              s.competitor && 'text-muted-foreground'
            )}
            title={s.competitor ? `Competitor: ${s.competitor}` : s.self ? 'Your site' : 'Placement / outreach target'}
          >
            {s.domain} · {s.count}
          </li>
        ))}
      </ul>
    </div>
  )
}

/** @param {{ v: any }} props */
function GoogleMark({ v }) {
  if (!v) return <span className="text-muted-foreground">—</span>
  if (!v.present) return <span className="text-muted-foreground">None shown</span>
  return v.cited ? (
    <span className="font-medium text-emerald-600 dark:text-emerald-400">Cited</span>
  ) : (
    <span className="text-red-600 dark:text-red-400">Not cited</span>
  )
}

/** @param {{ rows: any[] }} props */
function GoogleTable({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Google AI on core keywords</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className={TH}>Keyword</th>
              <th className={TH}>AI Overview</th>
              <th className={TH}>AI Mode</th>
              <th className={TH}>Organic rank</th>
              <th className={TH}>Competitors cited</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((g) => (
              <tr key={g.keyword} className="border-t border-border">
                <td className={`${TD} font-medium`}>{g.keyword}</td>
                {g.error ? (
                  <td colSpan={4} className={`${TD} text-red-600 dark:text-red-400`}>
                    {g.error}
                  </td>
                ) : (
                  <>
                    <td className={TD}>
                      <GoogleMark v={g.overview} />
                    </td>
                    <td className={TD}>
                      <GoogleMark v={g.aiMode} />
                    </td>
                    <td className={TD}>{g.overview?.organicPosition ?? '—'}</td>
                    <td className={`${TD} text-muted-foreground`}>
                      {[...new Set([...(g.overview?.competitorsCited || []), ...(g.aiMode?.competitorsCited || [])])].join(', ') || '—'}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** Stored prompt set: view, remove, regenerate. @param {{ companyId: string }} props */
function PromptSet({ companyId }) {
  const [prompts, setPrompts] = useState(/** @type {any[] | null} */ (null))
  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const load = useCallback(async () => {
    try {
      const data = await getAiPrompts(companyId)
      setPrompts(data.prompts || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }, [companyId])

  useEffect(() => {
    load()
  }, [load])

  async function act(kind, fn) {
    setBusy(kind)
    setError('')
    setNotice('')
    try {
      const data = await fn()
      setPrompts(data.prompts || [])
      if (kind === 'regen') setNotice('New prompt set saved. The next run starts a new baseline.')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy('')
    }
  }

  const buyerCount = (prompts || []).filter((p) => p.intent !== 'brand').length

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-xs font-semibold">Prompt set · asked on every run</h3>
        <button
          type="button"
          disabled={Boolean(busy)}
          onClick={() => {
            if (window.confirm('Replace all buyer prompts with a new generated set? Results will no longer compare with earlier runs.')) {
              act('regen', () => regenerateAiPrompts(companyId))
            }
          }}
          className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'h-7 text-xs')}
        >
          {busy === 'regen' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
          Regenerate
        </button>
      </div>
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
      {notice ? <p className="text-xs text-muted-foreground">{notice}</p> : null}
      {prompts === null ? (
        <p className="text-xs text-muted-foreground">Loading prompts…</p>
      ) : prompts.length === 0 ? (
        <p className="text-xs text-muted-foreground">No prompts yet — the first run generates them from the AEO Playbook.</p>
      ) : (
        <ol className="space-y-1">
          {prompts.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 rounded border border-border px-2 py-1 text-xs">
              <span>
                <span className="mr-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  {INTENT_LABELS[p.intent] || p.intent}
                </span>
                {p.prompt}
              </span>
              {p.intent !== 'brand' && buyerCount > 3 ? (
                <button
                  type="button"
                  disabled={Boolean(busy)}
                  onClick={() => act(p.id, () => removeAiPrompt(companyId, p.id))}
                  className="shrink-0 text-muted-foreground hover:text-red-600"
                  aria-label={`Remove prompt: ${p.prompt}`}
                >
                  {busy === p.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}

/** AI Visibility tab body (between the metric tiles and the issue list). @param {{ metrics: any, companyId: string }} props */
export default function AiVisibilityPanel({ metrics, companyId }) {
  return (
    <div className="space-y-5">
      <AnswerGrid matrix={metrics?.matrix} models={metrics?.models} />
      <div className="grid gap-5 lg:grid-cols-2">
        <ShareOfVoice rows={metrics?.shareOfVoiceRows} total={metrics?.buyerAnswers} />
        <TopSources rows={metrics?.topSources} />
      </div>
      <GoogleTable rows={metrics?.google} />
      <PromptSet companyId={companyId} />
    </div>
  )
}
