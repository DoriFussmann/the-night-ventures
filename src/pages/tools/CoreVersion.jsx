import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle,
  AlertTriangle,
  BookOpen,
} from 'lucide-react'
import { supabase } from '@/lib/supabase'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { loadCompanyPublishDestination } from './articleGeneration/publishToSite'
import {
  getCoreVersionStatus,
  applyCoreVersionUpdate,
} from './articles/coreVersionApi'

const RUNBOOK_STEPS = [
  {
    num: "0", tag: "Decide", title: "Pick the change type",
    points: [
      "Adding something new/optional → it's a MINOR update.",
      "Changing or removing something that exists → it's a MAJOR update.",
      "Prefer minor. To handle a special case, add an opt-in flag — don't change a shared rule.",
    ],
  },
  {
    num: "1", tag: "Edit", title: "Edit seo-core in Cursor",
    points: [
      "Open the seo-core repo (not a project repo).",
      "Tell Cursor what to add and to keep it minor/additive.",
      "Confirm Cursor says the build is green.",
    ],
  },
  {
    num: "2", tag: "Publish", title: "Bump + tag",
    points: [
      "Minor update → bump the middle number (0.4.0 → 0.5.0).",
      "Major update → bump the first number (0.4.0 → 1.0.0).",
      "Commit, create the matching tag (e.g. v0.5.0), push commit AND tag.",
    ],
  },
  {
    num: "3", tag: "Roll out", title: "Update each site here",
    points: [
      "Open each project → Core Version → Refresh.",
      "Green button → click to update that site.",
      "Amber (no button) → migrate that project in Cursor first.",
      "Do one site at a time.",
    ],
  },
]

const RUNBOOK_TAG_STYLES = {
  Decide: 'bg-amber-500/10 text-amber-700',
  Edit: 'bg-blue-500/10 text-blue-700',
  Publish: 'bg-violet-500/10 text-violet-700',
  'Roll out': 'bg-emerald-500/10 text-emerald-700',
}

function RunbookTag({ tag }) {
  return (
    <span
      className={`shrink-0 rounded px-1.5 py-px text-[10px] font-medium uppercase tracking-wide ${RUNBOOK_TAG_STYLES[tag]}`}
    >
      {tag}
    </span>
  )
}

function CoreVersionRunbook() {
  const [selectedNum, setSelectedNum] = useState('0')
  const selected =
    RUNBOOK_STEPS.find((step) => step.num === selectedNum) || RUNBOOK_STEPS[0]

  return (
    <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5 space-y-4">
      <header className="space-y-1">
        <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <BookOpen className="h-4 w-4 text-muted-foreground" />
          Runbook — changing seo-core
        </h2>
        <p className="text-sm text-muted-foreground">
          How to make an SEO change once and roll it out to every site.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-[minmax(0,15rem)_1fr]">
        <div className="flex flex-col gap-1.5">
          {RUNBOOK_STEPS.map((step) => {
            const isSelected = step.num === selected.num
            return (
              <button
                key={step.num}
                type="button"
                onClick={() => setSelectedNum(step.num)}
                className={`flex items-center gap-2 rounded-md border px-2.5 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? 'border-border bg-accent text-foreground'
                    : 'border-border text-foreground/80 hover:bg-accent hover:text-foreground'
                }`}
              >
                <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground">
                  {step.num}
                </span>
                <RunbookTag tag={step.tag} />
                <span className="min-w-0 truncate leading-tight">{step.title}</span>
              </button>
            )
          })}
        </div>

        <div className="rounded-md border border-border bg-background/40 p-4 space-y-3">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs text-muted-foreground">{selected.num}</span>
            <RunbookTag tag={selected.tag} />
            <h3 className="text-sm font-semibold leading-tight">{selected.title}</h3>
          </div>
          <ul className="space-y-2 text-sm text-muted-foreground">
            {selected.points.map((point) => (
              <li key={point} className="pl-4 relative">
                <span className="absolute left-0 text-muted-foreground/70">•</span>
                {point}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

function VersionPill({ label, value }) {
  return (
    <div className="space-y-1">
      <p className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</p>
      <Badge variant="secondary" className="text-sm font-mono">
        {value ? `v${value}` : '—'}
      </Badge>
    </div>
  )
}

export default function CoreVersion() {
  const { companyId } = useParams()
  const [companyName, setCompanyName] = useState('')
  const [destination, setDestination] = useState(null)
  const [status, setStatus] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState('')
  const [applyErr, setApplyErr] = useState('')

  const refresh = useCallback(
    async (dest) => {
      const d = dest || destination
      if (!d) return
      setLoading(true)
      setError('')
      try {
        const s = await getCoreVersionStatus({ ...d, companyId })
        setStatus(s)
      } catch (err) {
        setError(err?.message || 'Failed to read version status')
        setStatus(null)
      } finally {
        setLoading(false)
      }
    },
    [destination, companyId]
  )

  useEffect(() => {
    if (!companyId) return
    let cancelled = false
    ;(async () => {
      setLoading(true)
      setError('')
      try {
        const [{ data: company }, dest] = await Promise.all([
          supabase.from('companies').select('name').eq('id', companyId).maybeSingle(),
          loadCompanyPublishDestination(companyId),
        ])
        if (cancelled) return
        setCompanyName(String(company?.name || ''))
        const hasRepo = dest?.owner && dest?.repo && dest?.tokenKey
        if (!hasRepo) {
          setDestination(null)
          setLoading(false)
          return
        }
        setDestination(dest)
        await refresh(dest)
      } catch (err) {
        if (!cancelled) {
          setError(err?.message || 'Failed to load company')
          setLoading(false)
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [companyId])

  const onApply = useCallback(async () => {
    if (!destination) return
    setApplying(true)
    setApplyMsg('')
    setApplyErr('')
    try {
      const res = await applyCoreVersionUpdate({ ...destination, companyId })
      if (res.ok) {
        setApplyMsg(
          `Updated to v${res.updatedTo} (was v${res.previous}). Merged as ${String(res.mergeCommitSha || '').slice(0, 7)}. The site will rebuild on its own.`
        )
      } else {
        setApplyErr(res.error || res.reason || 'Nothing to update')
      }
      await refresh()
    } catch (err) {
      // 409 = breaking major; server refuses the one-click path.
      setApplyErr(err?.message || 'Update failed')
    } finally {
      setApplying(false)
    }
  }, [destination, companyId, refresh])

  const title = companyName ? `${companyName} — Core Version` : 'Core Version'

  return (
    <div className="mx-auto max-w-3xl space-y-6 px-1 pb-16 pt-2">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        <p className="text-sm text-muted-foreground">
          Which shared SEO engine (seo-core) this project runs, and whether a safe
          update is available.
        </p>
      </header>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      {!destination && !loading && !error && (
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            No destination repo is set for this company. Add it in Company Data
            first.
          </AlertDescription>
        </Alert>
      )}

      {destination && (
        <section className="rounded-lg border border-border bg-card/40 p-4 sm:p-5 space-y-5">
          <div className="flex items-center justify-between">
            <div className="text-sm text-muted-foreground font-mono">
              {destination.owner}/{destination.repo}
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => refresh()}
              disabled={loading || applying}
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              <span className="ml-2">Refresh</span>
            </Button>
          </div>

          {loading && !status ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Reading version…
            </div>
          ) : status ? (
            <>
              <div className="flex items-center gap-10">
                <VersionPill label="Current" value={status.current} />
                <VersionPill label="Latest" value={status.latest} />
              </div>

              {!status.updateAvailable && status.current && (
                <div className="flex items-center gap-2 text-sm text-emerald-600">
                  <CheckCircle2 className="h-4 w-4" /> Up to date.
                </div>
              )}

              {status.updateAvailable && status.severity === 'green' && (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm text-emerald-700">
                    <ArrowUpCircle className="h-4 w-4" />
                    Safe update available (additive). One click applies it.
                  </div>
                  <Button
                    onClick={onApply}
                    disabled={applying}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white"
                  >
                    {applying ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" /> Updating…
                      </>
                    ) : (
                      <>Update to v{status.latest}</>
                    )}
                  </Button>
                </div>
              )}

              {status.updateAvailable && status.severity === 'amber' && (
                <Alert className="border-amber-500/50">
                  <AlertTriangle className="h-4 w-4 text-amber-600" />
                  <AlertTitle className="text-amber-700">Migration required</AlertTitle>
                  <AlertDescription>
                    v{status.latest} is a breaking (major) update. It can’t be
                    applied with one click — migrate this project in Cursor first,
                    then come back and adopt it.
                  </AlertDescription>
                </Alert>
              )}
            </>
          ) : null}

          {applyMsg && (
            <Alert className="border-emerald-500/50">
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <AlertDescription>{applyMsg}</AlertDescription>
            </Alert>
          )}
          {applyErr && (
            <Alert variant="destructive">
              <AlertDescription>{applyErr}</AlertDescription>
            </Alert>
          )}
        </section>
      )}

      <CoreVersionRunbook />
    </div>
  )
}
