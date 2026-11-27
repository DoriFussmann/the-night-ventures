// Reads a public web page as plain text, for the cards of the Fan-Out summary.
// The addresses come from ChatGPT's citations, so they are not trusted: only public http(s) pages are fetched,
// and what comes back is treated as text to read, never as instructions.

const PRIVATE_HOST = /^(localhost|.*\.local|.*\.internal|0\.0\.0\.0|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?|\[?f[cd][0-9a-f]{2}:)/i

export function readableUrl(url) {
  try {
    const u = new URL(String(url || ''))
    if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname) || !u.hostname.includes('.')) return ''
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return ''
  }
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Number(n) || 32))

/** HTML to readable text: headings and table rows keep their own lines, so a comparison table stays recognizable. */
export function htmlToText(html, max = 7000) {
  const body = String(html || '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(script|style|noscript|svg|nav|footer|header|form|iframe)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<h([1-6])\b[^>]*>/gi, (m, n) => `\n${'#'.repeat(Number(n))} `)
    .replace(/<\/(td|th)>/gi, ' | ')
    .replace(/<(br|\/p|\/div|\/li|\/tr|\/h[1-6]|\/section|\/article)\b[^>]*>/gi, '\n')
    .replace(/<li\b[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, ' ')
  return decode(body).replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

/**
 * One page, read. Never throws: a page that cannot be read comes back as { ok: false, error }, and the card says so.
 * @returns {Promise<{ url: string, ok: boolean, title: string, text: string, modified: string, error: string }>}
 */
export async function readPage(url, { timeoutMs = 12000, max = 7000 } = {}) {
  const safe = readableUrl(url)
  if (!safe) return { url: String(url || ''), ok: false, title: '', text: '', modified: '', error: 'not a public web address' }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(safe, { signal: ctrl.signal, redirect: 'follow', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TNV-FanOut/1.0; +https://www.thenightventures.com)', Accept: 'text/html,application/xhtml+xml' } })
    if (!res.ok) return { url: safe, ok: false, title: '', text: '', modified: '', error: `the site answered ${res.status}` }
    if (!/html|text\/plain/i.test(res.headers.get('content-type') || '')) return { url: safe, ok: false, title: '', text: '', modified: '', error: 'not a web page' }
    const html = (await res.text()).slice(0, 1_500_000)
    const title = decode((/<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 160)
    const modified = /(?:dateModified|article:modified_time|datePublished|article:published_time)["'\s:=>]+(?:content=)?["']?(\d{4}-\d{2}-\d{2})/i.exec(html)?.[1] || ''
    const text = htmlToText(html, max)
    if (text.length < 200) return { url: safe, ok: false, title, text: '', modified, error: 'the page has no readable text (it may need a browser to load)' }
    return { url: safe, ok: true, title, text, modified, error: '' }
  } catch (err) {
    return { url: safe, ok: false, title: '', text: '', modified: '', error: err?.name === 'AbortError' ? 'the site took too long to answer' : 'the site could not be reached' }
  } finally {
    clearTimeout(timer)
  }
}
