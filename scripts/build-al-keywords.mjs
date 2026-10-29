// Rebuild lib/audience-build/data/al-keywords.json.gz from AudienceLab's
// taxonomy sheet exported as CSV (first tab: Taxonomy ID, Premade, Category,
// Subcategory, Premade Description, Premade Keywords, Audience Type).
// Usage: node scripts/build-al-keywords.mjs path/to/taxonomy.csv
import { readFileSync, writeFileSync } from 'node:fs'
import { gzipSync } from 'node:zlib'
import Papa from 'papaparse'

const file = process.argv[2]
if (!file) {
  console.error('Usage: node scripts/build-al-keywords.mjs path/to/taxonomy.csv')
  process.exit(1)
}

const { data } = Papa.parse(readFileSync(file, 'utf8'), { header: true, skipEmptyLines: true })
const idKey = 'Taxonomy ID'
const kwKey = Object.keys(data[0] || {}).find((k) => /keywords/i.test(k))
if (!kwKey || !(idKey in (data[0] || {}))) {
  console.error(`Expected columns "${idKey}" and "... Keywords"; got: ${Object.keys(data[0] || {}).join(', ')}`)
  process.exit(1)
}

const out = {}
for (const row of data) {
  const id = String(row[idKey] || '').trim()
  const kw = String(row[kwKey] || '').trim()
  if (/^b2[bc]_\d+$/.test(id) && kw) out[id] = kw
}
const sorted = Object.fromEntries(Object.keys(out).sort().map((k) => [k, out[k]]))
const target = new URL('../lib/audience-build/data/al-keywords.json.gz', import.meta.url)
writeFileSync(target, gzipSync(JSON.stringify(sorted)))
console.log(`Wrote ${Object.keys(sorted).length} segments to ${target.pathname}`)
