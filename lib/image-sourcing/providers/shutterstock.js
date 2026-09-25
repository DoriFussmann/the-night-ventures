import { fetchWithTimeout } from '../http.js'

const SEARCH_URL = 'https://api.shutterstock.com/v2/images/search'
const LICENSE_URL = 'https://api.shutterstock.com/v2/images/licenses'

function authHeaders() {
  return {
    Authorization: `Bearer ${process.env.SHUTTERSTOCK_API_TOKEN}`,
    Accept: 'application/json',
  }
}

export function isConfigured() {
  return Boolean(
    String(process.env.SHUTTERSTOCK_API_TOKEN || '').trim() &&
      String(process.env.SHUTTERSTOCK_SUBSCRIPTION_ID || '').trim()
  )
}

function mapImage(image) {
  const id = String(image?.id || '')
  const assets = image?.assets || {}
  return {
    id,
    thumbUrl: assets.preview_1000?.url || assets.preview?.url || '',
    description: image?.description || '',
    attribution: {
      provider: 'shutterstock',
      imageId: id,
      sourceUrl: id ? `https://www.shutterstock.com/image-photo/${id}` : '',
    },
  }
}

export async function search(query, excludeIds = []) {
  const excluded = new Set((excludeIds || []).map((id) => String(id)))
  const url = new URL(SEARCH_URL)
  url.searchParams.set('query', String(query || ''))
  url.searchParams.set('orientation', 'horizontal')
  url.searchParams.set('image_type', 'photo')
  url.searchParams.set('license', 'commercial')
  url.searchParams.set('safe', 'true')
  url.searchParams.set('sort', 'relevance')
  url.searchParams.set('per_page', '8')

  const res = await fetchWithTimeout(url, { headers: authHeaders() })
  if (!res.ok) {
    throw new Error(`Shutterstock search failed (${res.status})`)
  }
  const data = await res.json().catch(() => ({}))
  const results = Array.isArray(data?.data) ? data.data : []
  return results.map(mapImage).filter((item) => item.id && !excluded.has(item.id))
}

export async function fetchWinner(candidate) {
  const subscriptionId = String(process.env.SHUTTERSTOCK_SUBSCRIPTION_ID || '').trim()
  if (!candidate?.id) throw new Error('Shutterstock candidate has no id')
  if (!subscriptionId) throw new Error('SHUTTERSTOCK_SUBSCRIPTION_ID missing')

  const url = new URL(LICENSE_URL)
  url.searchParams.set('subscription_id', subscriptionId)
  url.searchParams.set('size', 'huge')

  const res = await fetchWithTimeout(url, {
    method: 'POST',
    headers: {
      ...authHeaders(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ images: [{ image_id: candidate.id }] }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    throw new Error(
      data?.message || `Shutterstock license failed (${res.status})`
    )
  }
  const item = Array.isArray(data?.data) ? data.data[0] : null
  if (item?.error) {
    throw new Error(String(item.error))
  }
  const downloadUrl = item?.download?.url
  if (!downloadUrl) throw new Error('Shutterstock license returned no download URL')

  const fileRes = await fetchWithTimeout(downloadUrl)
  if (!fileRes.ok) {
    throw new Error(`Shutterstock download failed (${fileRes.status})`)
  }
  return Buffer.from(await fileRes.arrayBuffer())
}
