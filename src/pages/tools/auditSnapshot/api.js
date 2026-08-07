import { supabase } from '@/lib/supabase'

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  if (!token) throw new Error('Not signed in')
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  }
}

export async function listSnapshots(companyId) {
  const headers = await authHeaders()
  const res = await fetch(
    `/api/audit-snapshot?companyId=${encodeURIComponent(companyId)}`,
    { headers }
  )
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to load snapshots')
  return data
}

/** Run a single audit source panel. */
export async function runPanel({ companyId, panel, siteUrl, sampleUrl }) {
  const headers = await authHeaders()
  const res = await fetch('/api/audit-snapshot', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'runPanel',
      companyId,
      panel,
      siteUrl,
      sampleUrl,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || `Failed to run ${panel}`)
  return data
}

/** Persist a completed multi-panel snapshot. */
export async function persistSnapshot({
  companyId,
  siteUrl,
  sampleUrl,
  results,
}) {
  const headers = await authHeaders()
  const res = await fetch('/api/audit-snapshot', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      action: 'persist',
      companyId,
      siteUrl,
      sampleUrl,
      results,
    }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to save snapshot')
  return data
}

/** @deprecated Prefer runPanel + persistSnapshot for progressive UI. */
export async function runSnapshot(args) {
  return persistSnapshot(args)
}
