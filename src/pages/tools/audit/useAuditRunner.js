import { useCallback, useEffect, useRef, useState } from 'react'
import { CATEGORIES, CONNECTIONS, blockingFailures, categoryById } from '../../../../lib/audit/categories.js'
import {
  getAuditState,
  runConnectionCheck,
  startRun,
  stepRun,
  getRun,
  cancelRun,
  setIssuesAccepted,
} from './api'

const STEP_RETRIES = 3

/** @param {number} ms */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function newBatchId() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  // RFC 4122 v4 fallback for older browsers.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
  })
}

/**
 * State + orchestration for the Audit page: connection checks, category runs
 * (stepped until done, resumable after reload), Run all batches, accept/undo.
 * @param {string} companyId
 */
export function useAuditRunner(companyId) {
  const [state, setState] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [connections, setConnections] = useState(
    /** @type {Record<string, { status: string, detail: string }>} */ ({})
  )
  const [liveRuns, setLiveRuns] = useState(/** @type {Record<string, any>} */ ({}))
  const [runErrors, setRunErrors] = useState(/** @type {Record<string, string>} */ ({}))
  const [batch, setBatch] = useState(/** @type {{ categories: string[], index: number } | null} */ (null))
  const [pendingAccept, setPendingAccept] = useState(/** @type {Set<string>} */ (new Set()))

  const mounted = useRef(true)
  const driving = useRef(new Set())
  const resumed = useRef(false)

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  const reload = useCallback(async () => {
    if (!companyId) return null
    try {
      const data = await getAuditState(companyId)
      if (mounted.current) setState(data)
      return data
    } catch (err) {
      if (mounted.current) setError(err?.message || 'Failed to load audit')
      return null
    }
  }, [companyId])

  const checkConnections = useCallback(async () => {
    if (!companyId) return
    setConnections(Object.fromEntries(CONNECTIONS.map((c) => [c.id, { status: 'checking', detail: '' }])))
    await Promise.all(
      CONNECTIONS.map(async (c) => {
        let result
        try {
          result = await runConnectionCheck(companyId, c.id)
        } catch (err) {
          result = { status: 'fail', detail: err?.message || 'Check failed' }
        }
        if (mounted.current) {
          setConnections((prev) => ({
            ...prev,
            [c.id]: { status: result.status, detail: result.detail || '' },
          }))
        }
      })
    )
  }, [companyId])

  /** Step a running run until it ends (or the page unmounts). */
  const drive = useCallback(
    async (run) => {
      if (!run || driving.current.has(run.id)) return run
      driving.current.add(run.id)
      let current = run
      let delay = 0
      let failures = 0
      setLiveRuns((prev) => ({ ...prev, [run.category]: run }))
      try {
        while (mounted.current && current.status === 'running') {
          if (delay) await sleep(delay)
          if (!mounted.current) break
          try {
            const res = await stepRun(companyId, current.id, Number(current.progress?.step) || 0)
            current = res.run
            delay = res.nextDelayMs ?? 0
            failures = 0
          } catch (err) {
            failures += 1
            if (failures > STEP_RETRIES) {
              const label = categoryById(current.category)?.label || current.category
              setRunErrors((prev) => ({
                ...prev,
                [current.category]: `${label}: ${err?.message || 'step failed'} — the run is still open; reload to resume.`,
              }))
              break
            }
            delay = 3000 * failures
            try {
              const fresh = await getRun(companyId, current.id)
              current = fresh.run
            } catch {
              // keep the last known run and retry
            }
          }
          if (mounted.current) setLiveRuns((prev) => ({ ...prev, [current.category]: current }))
        }
      } finally {
        driving.current.delete(run.id)
        if (mounted.current && current.status !== 'running') {
          setLiveRuns((prev) => {
            const next = { ...prev }
            if (next[current.category]?.id === current.id) delete next[current.category]
            return next
          })
          if (current.status === 'error' || current.status === 'skipped') {
            setRunErrors((prev) => ({ ...prev, [current.category]: current.error || current.status }))
          }
        }
      }
      return current
    },
    [companyId]
  )

  /** Run categories in order as one budget batch. */
  const runCategories = useCallback(
    async (categoryIds) => {
      if (!companyId || !categoryIds.length) return
      const batchId = newBatchId()
      setError('')
      setRunErrors((prev) => {
        const next = { ...prev }
        for (const id of categoryIds) delete next[id]
        return next
      })
      setBatch({ categories: categoryIds, index: 0 })
      for (let i = 0; i < categoryIds.length; i += 1) {
        if (!mounted.current) break
        const category = categoryIds[i]
        setBatch({ categories: categoryIds, index: i })
        try {
          const res = await startRun(companyId, category, batchId)
          await drive(res.run)
        } catch (err) {
          setRunErrors((prev) => ({ ...prev, [category]: err?.message || 'Could not start' }))
        }
        await reload()
      }
      if (mounted.current) setBatch(null)
    },
    [companyId, drive, reload]
  )

  /** Category ids blocked by failing connections → connection labels. */
  const blockedBy = useCallback(
    (categoryId) =>
      blockingFailures(categoryId, connections).map(
        (id) => CONNECTIONS.find((c) => c.id === id)?.label || id
      ),
    [connections]
  )

  const connectionsChecking =
    Object.keys(connections).length === 0 ||
    Object.values(connections).some((c) => c.status === 'checking')

  const runnable = useCallback(
    (categoryId) => {
      const meta = categoryById(categoryId)
      return Boolean(
        meta?.implemented &&
          (state?.implemented || []).includes(categoryId) &&
          blockedBy(categoryId).length === 0
      )
    },
    [state, blockedBy]
  )

  const runAll = useCallback(() => {
    const ids = CATEGORIES.map((c) => c.id).filter(runnable)
    return runCategories(ids)
  }, [runnable, runCategories])

  const runOne = useCallback((categoryId) => runCategories([categoryId]), [runCategories])

  const cancel = useCallback(
    async (categoryId) => {
      const run = liveRuns[categoryId]
      if (!run) return
      try {
        await cancelRun(companyId, run.id)
      } catch (err) {
        setError(err?.message || 'Cancel failed')
      }
    },
    [companyId, liveRuns]
  )

  /** Accept or restore a list of issues in one request. */
  const toggleAccepted = useCallback(
    async (issues, accepted) => {
      const list = (issues || []).filter((i) => i?.fingerprint)
      if (!list.length) return
      const keys = list.map((i) => i.fingerprint)
      setPendingAccept((prev) => new Set([...prev, ...keys]))
      try {
        await setIssuesAccepted(companyId, list, accepted)
        await reload()
      } catch (err) {
        setError(err?.message || 'Could not update issues')
      } finally {
        setPendingAccept((prev) => {
          const next = new Set(prev)
          for (const key of keys) next.delete(key)
          return next
        })
      }
    },
    [companyId, reload]
  )

  // Initial load: state + connection checks in parallel; then resume open runs.
  useEffect(() => {
    if (!companyId) return
    resumed.current = false
    setLoading(true)
    setError('')
    checkConnections()
    reload().then(async (data) => {
      if (!mounted.current) return
      setLoading(false)
      if (!data || resumed.current) return
      resumed.current = true
      const open = Object.values(data.categories || {})
        .map((entry) => entry?.running)
        .filter(Boolean)
      for (const run of open) {
        await drive(run)
        await reload()
      }
    })
  }, [companyId, checkConnections, reload, drive])

  return {
    state,
    loading,
    error,
    connections,
    connectionsChecking,
    checkConnections,
    liveRuns,
    runErrors,
    batch,
    busy: Boolean(batch) || Object.keys(liveRuns).length > 0,
    runAll,
    runOne,
    runnable,
    blockedBy,
    cancel,
    toggleAccepted,
    pendingAccept,
  }
}
