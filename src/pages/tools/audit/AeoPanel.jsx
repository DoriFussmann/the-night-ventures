import React from 'react'
import { cn } from '@/lib/utils'

const TH = 'px-3 py-1.5 text-left text-[11px] font-medium text-muted-foreground'
const TD = 'px-3 py-1.5 tabular-nums'
const KIND_LABELS = { ai_search: 'AI search', ai_user: 'AI live fetch', search: 'Search engine', ai_training: 'AI training' }

/** @param {string} url */
function shortPath(url) {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

/** @param {string | null} iso */
function day(iso) {
  return iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'
}

/** @param {{ row: any, policy: string }} props */
function Verdict({ row, policy }) {
  const blocked = row.robots === 'blocked'
  if (row.kind === 'ai_training') {
    if (policy === 'any') return <span className="text-muted-foreground">Not scored</span>
    const matches = (policy === 'allow') !== blocked
    return matches ? (
      <span className="text-emerald-600 dark:text-emerald-400">Matches policy</span>
    ) : (
      <span className="text-amber-600 dark:text-amber-400">Against policy</span>
    )
  }
  if (blocked) return <span className="font-medium text-red-600 dark:text-red-400">Blocked (robots.txt)</span>
  if (row.serverBlocked) return <span className="font-medium text-red-600 dark:text-red-400">Blocked (server)</span>
  if (row.robots === 'unknown') return <span className="text-muted-foreground">Unknown</span>
  return <span className="text-emerald-600 dark:text-emerald-400">Can crawl</span>
}

/** @param {{ metrics: any }} props */
function BotTable({ metrics }) {
  const rows = metrics?.bots || []
  if (!rows.length) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">
        Crawler access · training policy: {metrics.trainingPolicy || 'allow'} · llms.txt: {metrics.llmsTxt || '—'}
      </h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className={TH}>Crawler</th>
              <th className={TH}>Kind</th>
              <th className={TH}>robots.txt</th>
              <th className={TH} title="Homepage requested with this crawler's user agent">Server response</th>
              <th className={TH}>Visits (30 days)</th>
              <th className={TH}>Last visit</th>
              <th className={TH}>Result</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.bot} className="border-t border-border">
                <td className={`${TD} font-medium`}>{r.bot}</td>
                <td className={`${TD} text-muted-foreground`}>{KIND_LABELS[r.kind] || r.kind}</td>
                <td className={cn(TD, r.robots === 'blocked' && 'text-red-600 dark:text-red-400')}>{r.robots}</td>
                <td className={cn(TD, r.serverNote && 'text-red-600 dark:text-red-400')}>
                  {r.serverNote || (r.httpStatus ? `HTTP ${r.httpStatus}` : 'robots token only')}
                </td>
                <td className={TD}>{metrics.aiVisits30d === '—' ? '—' : r.visits30d}</td>
                <td className={TD}>{day(r.lastVisit)}</td>
                <td className={TD}>
                  <Verdict row={r} policy={metrics.trainingPolicy} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** @param {{ rows: any[] }} props */
function PageTable({ rows }) {
  if (!rows?.length) return null
  return (
    <div className="space-y-2">
      <h3 className="text-xs font-semibold">Article and pillar structure</h3>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-xs">
          <thead className="bg-muted/40">
            <tr>
              <th className={TH}>Page</th>
              <th className={TH}>Kind</th>
              <th className={TH} title="Main-content words in the raw HTML">Words in HTML</th>
              <th className={TH} title="Sections opening with a short paragraph, list or table">Answer-first</th>
              <th className={TH}>Question headings</th>
              <th className={TH}>Lists / tables</th>
              <th className={TH}>Date</th>
              <th className={TH}>Snippet block</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.url} className="border-t border-border">
                <td className={`${TD} max-w-[18rem] truncate`}>
                  <a href={r.url} target="_blank" rel="noreferrer" className="hover:underline" title={r.url}>
                    {shortPath(r.url)}
                  </a>
                </td>
                <td className={`${TD} capitalize`}>{r.kind}</td>
                <td className={cn(TD, r.words < 200 && 'text-red-600 dark:text-red-400')}>{r.words}</td>
                <td className={cn(TD, r.sections >= 3 && r.answerFirst < r.sections / 2 && 'text-amber-600 dark:text-amber-400')}>
                  {r.sections ? `${r.answerFirst} / ${r.sections}` : '—'}
                </td>
                <td className={TD}>{r.sections ? `${r.questions} / ${r.sections}` : '—'}</td>
                <td className={TD}>{r.listsTables}</td>
                <td className={TD}>{r.hasDate ? 'Yes' : 'No'}</td>
                <td className={cn(TD, r.snippetBlocked && 'text-red-600 dark:text-red-400')}>{r.snippetBlocked ? 'Yes' : 'No'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

/** AEO Readiness tab body. @param {{ metrics: any }} props */
export default function AeoPanel({ metrics }) {
  return (
    <div className="space-y-5">
      <BotTable metrics={metrics} />
      <PageTable rows={metrics?.pages} />
    </div>
  )
}
