/**
 * Contract check for every endpoint in lib/seo-advisor/registry.js.
 *
 * Makes one tiny REAL call per endpoint and validates the response shape the
 * registry depends on. Catches vendor API drift (renamed fields, retired
 * endpoints, changed auth) before the Advisor silently degrades.
 *
 * Costs a few cents of API credit per run. Run weekly (see
 * .github/workflows/seo-advisor-contracts.yml) and after editing the registry.
 *
 *   node scripts/check-seo-advisor-contracts.mjs            # all endpoints
 *   node scripts/check-seo-advisor-contracts.mjs semrush    # one provider
 *
 * Exit 1 if any endpoint fails its contract or any provider's docs review is overdue.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const f of ['.env.local', '.env']) {
  const p = path.join(root, f)
  if (!fs.existsSync(p)) continue
  for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
    const eq = line.indexOf('=')
    if (!line || line.trim().startsWith('#') || eq === -1) continue
    const k = line.slice(0, eq).trim()
    const v = line.slice(eq + 1).trim().replace(/^["']|["']$/g, '')
    if (process.env[k] === undefined) process.env[k] = v
  }
}

const { ENDPOINTS, PROVIDERS, docsAgeDays, isDocsStale, DOCS_STALE_AFTER_DAYS } = await import(
  pathToFileURL(path.join(root, 'lib/seo-advisor/registry.js')).href
)

const only = process.argv[2]
let failed = 0

console.log('Docs review')
for (const p of Object.values(PROVIDERS)) {
  if (only && p.id !== only) continue
  const stale = isDocsStale(p)
  if (stale) failed += 1
  console.log(
    `  ${stale ? '✗' : '✓'} ${p.name.padEnd(11)} verified ${p.docsVerifiedAt} (${docsAgeDays(p)}d, limit ${DOCS_STALE_AFTER_DAYS}d)  ${p.docsUrl}`
  )
}

console.log('\nEndpoint contracts')
for (const e of ENDPOINTS) {
  if (only && e.provider !== only) continue
  const started = Date.now()
  let status
  try {
    const r = await e.run(e.probe.args)
    if (r?.available === false) status = `✗ unavailable: ${r.reason}`
    else if (!e.probe.check(r)) status = '✗ shape changed — response no longer matches registry expectations'
    else {
      e.compact(r)
      e.metrics(r)
      status = '✓'
    }
  } catch (err) {
    status = `✗ threw: ${err.message}`
  }
  if (status !== '✓') failed += 1
  console.log(`  ${status.startsWith('✓') ? '✓' : '✗'} ${e.id.padEnd(34)} ${String(Date.now() - started).padStart(5)}ms  ${status === '✓' ? '' : status.slice(2)}`)
}

console.log(failed ? `\n${failed} problem(s). See docs/SEO_ADVISOR.md → "Keeping the endpoint map true".` : '\nAll contracts hold.')
process.exit(failed ? 1 : 0)
