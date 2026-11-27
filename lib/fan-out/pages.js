// Reads a public web page as plain text, for the cards of the Fan-Out summary.
// The addresses come from ChatGPT's citations, so nothing about them is trusted: only public http(s) pages are
// fetched, every redirect is checked again, the name must resolve to a public address, the download is cut at
// a fixed size, and what comes back is text to read, never instructions.

import { lookup } from 'node:dns/promises'
import { isIP } from 'node:net'

const MAX_BYTES = 300_000
const MAX_HOPS = 3

/** Private, loopback, link-local, carrier-grade NAT, benchmark and multicast ranges: never fetched. */
export function privateAddress(ip) {
  const v = isIP(ip)
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number)
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 192 && b === 0) || (a === 198 && (b === 18 || b === 19))
  }
  if (v === 6) {
    const x = ip.toLowerCase()
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(x)
    if (mapped) return privateAddress(mapped[1])
    return x === '::' || x === '::1' || /^f[cd]/.test(x) || /^fe[89ab]/.test(x) || x.startsWith('ff') || x.startsWith('::ffff:') || x.startsWith('64:ff9b:')
  }
  return true // not an address at all
}

const LOCAL_NAME = /^(localhost|.*\.localhost|.*\.local|.*\.internal|.*\.lan|.*\.home|.*\.corp)$/i

/** The address cleaned up, or "" when it is not a public web address by its form alone. */
export function readableUrl(url) {
  try {
    const u = new URL(String(url || ''))
    const host = u.hostname.replace(/^\[|\]$/g, '')
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return ''
    if (isIP(host) ? privateAddress(host) : LOCAL_NAME.test(host) || !host.includes('.')) return ''
    u.hash = ''
    for (const k of [...u.searchParams.keys()]) if (/^utm_/i.test(k)) u.searchParams.delete(k)
    return u.toString()
  } catch {
    return ''
  }
}

/** True when the name resolves only to public addresses. A name that points at a private address is refused. */
async function resolvesPublic(url) {
  const host = new URL(url).hostname.replace(/^\[|\]$/g, '')
  if (isIP(host)) return !privateAddress(host)
  try {
    const found = await lookup(host, { all: true })
    return found.length > 0 && found.every((a) => !privateAddress(a.address))
  } catch {
    return false
  }
}

const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (m, n) => String.fromCodePoint(Math.min(Number(n) || 32, 0x10ffff)))

const SKIP = ['script', 'style', 'noscript', 'svg', 'nav', 'footer', 'header', 'form', 'iframe', 'template']

/** Removes whole elements (script, style, nav …) in one pass over the text, so a broken page cannot slow it down. */
function dropElements(html) {
  const lower = html.toLowerCase()
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = lower.indexOf('<', i)
    if (lt === -1) { out += html.slice(i); break }
    out += html.slice(i, lt)
    const tag = SKIP.find((t) => lower.startsWith(t, lt + 1) && /[\s>/]/.test(lower[lt + 1 + t.length] || '>'))
    if (!tag) { out += '<'; i = lt + 1; continue }
    const close = lower.indexOf(`</${tag}`, lt)
    if (close === -1) break // never closed: the rest of the page is inside it
    const end = lower.indexOf('>', close)
    i = end === -1 ? html.length : end + 1
    out += ' '
  }
  return out
}

const BREAK_AFTER = new Set(['br', '/p', '/div', '/li', '/tr', '/h1', '/h2', '/h3', '/h4', '/h5', '/h6', '/section', '/article'])

/** Tags out, in one pass: each "<" is matched with the next ">" once, so no input can make it slow. */
function stripTags(html) {
  let out = ''
  let i = 0
  while (i < html.length) {
    const lt = html.indexOf('<', i)
    if (lt === -1) { out += html.slice(i); break }
    out += html.slice(i, lt)
    const gt = html.indexOf('>', lt)
    if (gt === -1) break // an unclosed tag: nothing readable follows
    const name = (/^<\s*(\/?[a-z0-9]+)/i.exec(html.slice(lt, lt + 16))?.[1] || '').toLowerCase()
    if (/^h[1-6]$/.test(name)) out += `\n${'#'.repeat(Number(name[1]))} `
    else if (name === '/td' || name === '/th') out += ' | '
    else if (name === 'li') out += '- '
    else if (BREAK_AFTER.has(name)) out += '\n'
    else out += ' '
    i = gt + 1
  }
  return out
}

/** Comments out, in one pass. */
function dropComments(html) {
  let out = ''
  let i = 0
  while (i < html.length) {
    const start = html.indexOf('<!--', i)
    if (start === -1) { out += html.slice(i); break }
    out += html.slice(i, start)
    const end = html.indexOf('-->', start + 4)
    if (end === -1) break
    i = end + 3
  }
  return out
}

/** HTML to readable text: headings and table rows keep their own lines, so a comparison table stays recognizable. */
export function htmlToText(html, max = 7000) {
  const body = stripTags(dropElements(dropComments(String(html || '').slice(0, MAX_BYTES))))
  return decode(body).replace(/[ \t\r]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, max)
}

/** The start of a response body, as text: reading stops at MAX_BYTES however large the page is. */
async function readStart(res) {
  const reader = res.body?.getReader?.()
  if (!reader) return (await res.text()).slice(0, MAX_BYTES)
  const chunks = []
  let size = 0
  while (size < MAX_BYTES) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
    size += value.length
  }
  reader.cancel().catch(() => null)
  return new TextDecoder('utf-8', { fatal: false }).decode(Buffer.concat(chunks).subarray(0, MAX_BYTES))
}

/**
 * One page, read. Never throws: a page that cannot be read comes back as { ok: false, error }, and the card says so.
 * @returns {Promise<{ url: string, ok: boolean, title: string, text: string, modified: string, error: string }>}
 */
export async function readPage(url, { timeoutMs = 12000, max = 7000 } = {}) {
  const fail = (at, error) => ({ url: at, ok: false, title: '', text: '', modified: '', error })
  let at = readableUrl(url)
  if (!at) return fail(String(url || ''), 'not a public web address')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    let res = null
    for (let hop = 0; hop <= MAX_HOPS; hop += 1) {
      if (!(await resolvesPublic(at))) return fail(at, 'not a public web address')
      res = await fetch(at, { signal: ctrl.signal, redirect: 'manual', headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TNV-FanOut/1.0)', Accept: 'text/html,application/xhtml+xml' } })
      if (res.status < 300 || res.status >= 400) break
      // A redirect is followed by hand, and its target is checked like the first address.
      const next = readableUrl(new URL(res.headers.get('location') || '', at).toString())
      res.body?.cancel?.().catch(() => null)
      if (!next) return fail(at, 'it redirects to an address that is not public')
      if (hop === MAX_HOPS) return fail(at, 'too many redirects')
      at = next
    }
    if (!res.ok) return fail(at, `the site answered ${res.status}`)
    if (!/html|text\/plain/i.test(res.headers.get('content-type') || '')) return fail(at, 'not a web page')
    const html = await readStart(res)
    const title = decode((/<title[^>]*>([^<]{0,300})/i.exec(html)?.[1] || '').replace(/\s+/g, ' ').trim()).slice(0, 160)
    const modified = /(?:dateModified|article:modified_time|datePublished|article:published_time)["'\s:=>]{1,12}(?:content=)?["']?(\d{4}-\d{2}-\d{2})/i.exec(html)?.[1] || ''
    const text = htmlToText(html, max)
    if (text.length < 200) return { ...fail(at, 'the page has no readable text (it may need a browser to load)'), title, modified }
    return { url: at, ok: true, title, text, modified, error: '' }
  } catch (err) {
    return fail(at, err?.name === 'AbortError' ? 'the site took too long to answer' : 'the site could not be reached')
  } finally {
    clearTimeout(timer)
  }
}
