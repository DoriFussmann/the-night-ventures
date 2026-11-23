/**
 * Hot takes bank: the parts with no server or database in them, shared by the
 * page and the tests. The requests to Claude are in ./hotTakes.js.
 */
export const TAKE_KINDS = ['Opinion', 'Method', 'Framework', 'Term', 'Experience', 'About the company']

const norm = (s) => String(s || '').replace(/\s+/g, ' ').trim()

/** True when the brief's hot takes field already holds this take. */
export function hasTake(current, take) {
  const t = norm(take)
  return Boolean(t) && norm(current).includes(t)
}

/** The field with one more take at the end, as its own paragraph. Never added twice. */
export function appendTake(current, take) {
  const cur = String(current || '').trim()
  const t = String(take || '').trim()
  if (!t || hasTake(cur, t)) return cur
  return cur ? `${cur}\n\n${t}` : t
}

/** The next free code: the bank's letter (or the company's initial) and the next number, as R066. */
export function nextCode(takes, companyName = '') {
  let prefix = ''
  let max = 0
  for (const t of takes || []) {
    const m = /^([A-Za-z]+)(\d+)$/.exec(String(t.code || ''))
    if (!m) continue
    if (!prefix) prefix = m[1].toUpperCase()
    if (m[1].toUpperCase() === prefix) max = Math.max(max, Number(m[2]))
  }
  if (!prefix) prefix = (String(companyName).trim()[0] || 'T').toUpperCase()
  return `${prefix}${String(max + 1).padStart(3, '0')}`
}

/**
 * Rows of an import file (a JSON array) as bank rows. A row needs a code and a
 * take. A row that names another company is left out and counted, so one
 * company's bank cannot be loaded into another by mistake.
 */
export function parseImport(text, companyName = '') {
  let rows
  try {
    rows = JSON.parse(text)
  } catch {
    throw new Error('The file is not valid JSON')
  }
  if (!Array.isArray(rows)) throw new Error('The file must hold a list of takes')
  const out = []
  const seen = new Set()
  let otherCompany = 0
  let incomplete = 0
  for (const r of rows) {
    const company = norm(r?.company)
    if (company && companyName && company.toLowerCase() !== norm(companyName).toLowerCase()) {
      otherCompany += 1
      continue
    }
    const code = norm(r?.code || r?.id)
    const take = String(r?.take || '').trim()
    if (!code || !take || seen.has(code)) {
      incomplete += 1
      continue
    }
    seen.add(code)
    out.push({
      code,
      topic: norm(r.topic),
      kind: TAKE_KINDS.includes(norm(r.kind)) ? norm(r.kind) : 'Opinion',
      take,
      original: String(r.original || '').trim(),
      source: String(r.source || '').trim(),
      note: String(r.note || '').trim(),
      status: r.status === 'dropped' ? 'dropped' : 'active',
    })
  }
  return { rows: out, otherCompany, incomplete }
}

/** Takes grouped by topic, topics in the order they first appear. */
export function groupByTopic(takes) {
  const map = new Map()
  for (const t of takes || []) {
    const key = t.topic || 'No topic'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(t)
  }
  return [...map.entries()].map(([topic, items]) => ({ topic, items }))
}

const words = (s) => norm(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, '').split(' ').filter(Boolean)

function bigrams(w) {
  const out = new Set()
  for (let i = 0; i < w.length - 1; i += 1) out.add(`${w[i]} ${w[i + 1]}`)
  return out
}

/** How alike two takes are, 0 to 1, by the word pairs they share. */
export function similarity(a, b) {
  const wa = words(a)
  const wb = words(b)
  if (!wa.length || !wb.length) return 0
  if (wa.join(' ') === wb.join(' ')) return 1
  const ba = bigrams(wa)
  const bb = bigrams(wb)
  if (!ba.size || !bb.size) return 0
  let shared = 0
  for (const g of ba) if (bb.has(g)) shared += 1
  return (2 * shared) / (ba.size + bb.size)
}

export const DUPLICATE_AT = 0.8

/**
 * The take in the bank that this text repeats, dropped takes included, or null.
 * A repeat is the same words, one text sitting whole inside the other, or
 * wording that is at least 80% alike. A take's original wording counts too:
 * text the take was made from is already in the bank.
 */
export function findDuplicate(text, takes) {
  const t = words(text).join(' ')
  if (!t) return null
  let best = null
  let bestScore = 0
  for (const k of takes || []) {
    const other = words(k.take).join(' ')
    if (!other) continue
    if (other === t) return k
    const [short, long] = other.length < t.length ? [other, t] : [t, other]
    const original = words(k.original).join(' ')
    const inside = (short.length >= 40 && long.includes(short)) || (t.length >= 40 && original.includes(t))
    const score = inside ? 1 : similarity(text, k.take)
    if (score > bestScore) {
      best = k
      bestScore = score
    }
  }
  return bestScore >= DUPLICATE_AT ? best : null
}

const MIN_TAKE = 40

/**
 * The separate takes in a brief's hot takes field: paragraphs, and the bullets
 * of a bulleted paragraph. Headings and short labels are left out.
 */
export function splitTakes(text) {
  const out = []
  for (const block of String(text || '').split(/\n\s*\n/)) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean)
    const bullets = lines.filter((l) => /^[-*•]\s+/.test(l))
    const parts = bullets.length >= 2 || (bullets.length === 1 && lines.length <= 2) ? lines : [lines.join(' ')]
    for (const p of parts) {
      const take = p.replace(/^[-*•]\s+/, '').trim()
      if (take.length >= MIN_TAKE && !take.endsWith(':') && !out.includes(take)) out.push(take)
    }
  }
  return out
}

/** The takes in the field that the bank does not hold yet. */
export function takesNotInBank(text, takes) {
  return splitTakes(text).filter((t) => !findDuplicate(t, takes))
}
