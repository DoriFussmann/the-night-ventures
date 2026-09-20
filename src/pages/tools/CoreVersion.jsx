import React, { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import {
  Loader2,
  RefreshCw,
  CheckCircle2,
  ArrowUpCircle,
  AlertTriangle,
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
    </div>
  )
}
