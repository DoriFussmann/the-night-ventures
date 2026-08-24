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
