import { fetchWithTimeout } from '../http.js'

const SEARCH_URL = 'https://api.unsplash.com/search/photos'

function authHeaders() {
  return {
    Authorization: `Client-ID ${process.env.UNSPLASH_ACCESS_KEY}`,
    'Accept-Version': 'v1',
  }
}

export function isConfigured() {
  return Boolean(String(process.env.UNSPLASH_ACCESS_KEY || '').trim())
}

function mapPhoto(photo) {
  const user = photo?.user || {}
  const links = photo?.links || {}
  const profile = String(user?.links?.html || '').trim()
  const photographerUrl = profile
    ? `${profile}${profile.includes('?') ? '&' : '?'}utm_source=the_night_ventures&utm_medium=referral`
    : ''
  return {
    id: String(photo?.id || ''),
    thumbUrl: photo?.urls?.small || '',
    description: photo?.alt_description || photo?.description || '',
    raw: photo?.urls?.raw || '',
    downloadLocation: links.download_location || '',
    attribution: {
      provider: 'unsplash',
      photographer: user?.name || '',
      photographerUrl,
      sourceUrl: links.html || '',
    },
  }
}

export async function search(query, excludeIds = []) {
  const excluded = new Set((excludeIds || []).map((id) => String(id)))
  const url = new URL(SEARCH_URL)
  url.searchParams.set('query', String(query || ''))
  url.searchParams.set('orientation', 'landscape')
  url.searchParams.set('per_page', '8')
  url.searchParams.set('content_filter', 'high')

  const res = await fetchWithTimeout(url, { headers: authHeaders() })
  if (!res.ok) {
    throw new Error(`Unsplash search failed (${res.status})`)
  }
  const data = await res.json().catch(() => ({}))
  const results = Array.isArray(data?.results) ? data.results : []
  return results.map(mapPhoto).filter((item) => item.id && !excluded.has(item.id))
}

export async function fetchWinner(candidate) {
  if (!candidate?.raw) throw new Error('Unsplash candidate has no raw URL')
  const url = new URL(candidate.raw)
  url.searchParams.set('w', '1600')
  url.searchParams.set('fm', 'jpg')
  url.searchParams.set('q', '80')

  const res = await fetchWithTimeout(url)
  if (!res.ok) {
    throw new Error(`Unsplash download failed (${res.status})`)
  }
  const bytes = Buffer.from(await res.arrayBuffer())

  if (candidate.downloadLocation) {
    fetchWithTimeout(candidate.downloadLocation, { headers: authHeaders() }).catch(() => {})
  }

  return bytes
}
