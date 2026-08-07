/**
 * Live verify: pull filtered keyword data for a supporting keyword via DataForSEO.
 *
 * Usage (repo root, with .env.local DATAFORSEO_* + optional ANTHROPIC_API_KEY):
 *   node scripts/verify-pull-keyword-data.mjs "angel investors for startups"
 *   node scripts/verify-pull-keyword-data.mjs "angel investors for startups" --pillar "fundraising"
 */
import fs from 'node:fs'
import path from 'node:path'
import { pullKeywordData } from '../lib/pull-keyword-data/run.js'

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const i = line.indexOf('=')
    if (i === -1) continue
    const k = line.slice(0, i).trim()
    let v = line.slice(i + 1).trim()
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1)
    }
    if (process.env[k] === undefined) process.env[k] = v
  }
}

const root = path.resolve(
  path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')),
  '..'
)
loadEnvFile(path.join(root, '.env'))
loadEnvFile(path.join(root, '.env.local'))

const args = process.argv.slice(2).filter((a) => a !== '--')
let pillarKeyword = ''
const pillarIdx = args.indexOf('--pillar')
if (pillarIdx !== -1) {
  pillarKeyword = String(args[pillarIdx + 1] || '').trim()
  args.splice(pillarIdx, 2)
}
const keyword = String(args[0] || 'angel investors for startups').trim()
const audienceFilter =
  process.env.VERIFY_AUDIENCE ||
  'Startup founders raising seed or Series A capital who want expert-managed investor outreach — not investors looking to invest, not real estate, not personal loans/grants.'

if (!process.env.DATAFORSEO_LOGIN || !process.env.DATAFORSEO_PASSWORD) {
  console.error('Missing DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD')
  process.exit(1)
}

console.log('ENV', {
  DFS: true,
  ANTHROPIC: Boolean(process.env.ANTHROPIC_API_KEY),
})
console.log('keyword', keyword)
console.log('pillarKeyword', pillarKeyword || '(none)')
console.log('audienceFilter', audienceFilter.slice(0, 120) + (audienceFilter.length > 120 ? '…' : ''))

const result = await pullKeywordData({
  keyword,
  pillarKeyword,
  audienceFilter,
})

console.log('\n--- meta ---')
console.log(JSON.stringify(result.meta, null, 2))
console.log('\n--- text (textarea fill) ---')
console.log(result.text)
console.log('\n--- first 8 rows ---')
console.log(result.rows.slice(0, 8))

if (!result.text.includes('DFS Comp Index')) {
  console.error('FAIL: missing DFS Comp Index header')
  process.exit(1)
}
if (result.rows.length === 0) {
  console.error('FAIL: no filtered rows')
  process.exit(1)
}
console.log('\nOK: pulled', result.rows.length, 'filtered keywords')
