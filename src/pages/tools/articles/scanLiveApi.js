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

export async function scanLiveArticles(companyId) {
  const headers = await authHeaders()
  const res = await fetch('/api/scan-live-articles', {
    method: 'POST',
    headers,
    body: JSON.stringify({ companyId }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to scan live articles')
  return data
}

/**
 * Copy every live article's content into the library (the live site is the
 * source of truth). apply=false returns what would change without writing.
 */
export async function syncLibraryFromLive(companyId, { apply = true } = {}) {
  const headers = await authHeaders()
  const res = await fetch('/api/sync-from-live', {
    method: 'POST',
    headers,
    body: JSON.stringify({ companyId, apply }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Failed to sync from the live site')
  return data
}
