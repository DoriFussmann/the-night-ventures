import fs from 'node:fs'
import path from 'node:path'
import { createClient } from '@supabase/supabase-js'
import { runAuditPanel, resolveSiteUrl, resolveSampleUrl, resolveCompanyContext, PANEL_IDS } from '../lib/audit-snapshot/runPanel.js'

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

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..')
loadEnvFile(path.join(root, '.env'))
loadEnvFile(path.join(root, '.env.local'))

const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing Supabase env')
  process.exit(1)
}

const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: companies, error } = await sb.from('companies').select('id, name').order('name')
if (error) {
  console.error(error)
  process.exit(1)
}

const targets = (companies || []).filter((c) => /rupert|closing/i.test(c.name))
if (targets.length === 0) {
  console.error('No Rupert / Closing Day Ready companies found')
  console.log(companies)
  process.exit(1)
}

const { error: colErr } = await sb.from('audit_snapshots').select('id, results, site_url').limit(1)
console.log('RESULTS_COLUMN', colErr ? `MISSING: ${colErr.message}` : 'ok')
console.log('ENV', {
  SEMRUSH: Boolean(process.env.SEMRUSH_API_KEY),
  PAGESPEED: Boolean(process.env.GOOGLE_PAGESPEED_API_KEY),
  MOZ: Boolean(process.env.MOZ_API_TOKEN),
  DFS: Boolean(process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD),
})

const onlyPanels = (process.argv[2] || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean)
const panels = onlyPanels.length ? onlyPanels : PANEL_IDS

for (const company of targets) {
  console.log('\n==========', company.name, '==========')
  const { siteUrl } = await resolveSiteUrl(sb, company.id)
  const sample = await resolveSampleUrl(sb, company.id)
  const context = await resolveCompanyContext(sb, company.id)
  console.log('siteUrl', siteUrl)
  console.log('sample', sample)
  console.log('productName', context.productName)
  console.log('coreKeywords', context.coreKeywords)

  const results = {}
  for (const panel of panels) {
    const started = Date.now()
    process.stdout.write(`→ ${panel} ... `)
    const result = await runAuditPanel({
      panel,
      siteUrl,
      sampleUrl: sample.sampleUrl,
      productName: context.productName,
      companyName: company.name || null,
      coreKeywords: context.coreKeywords,
    })
    results[panel] = result
    const ms = Date.now() - started
    if (panel === 'moz') {
      console.log(
        result.ok ? 'ok' : 'FAIL',
        `${ms}ms`,
        '| stale=',
        result.stale?.isStale,
        '| target=',
        result.target,
        '| title=',
        JSON.stringify(result.metrics?.title || null),
        '| last_crawled=',
        result.metrics?.lastCrawled || null,
        result.ok ? '' : `| error=${result.error}`
      )
      if (result.stale?.reasons) console.log('  reasons:', result.stale.reasons)
    } else if (panel === 'technical') {
      console.log(result.ok ? 'ok' : 'FAIL', `${ms}ms`)
      for (const check of result.checks || []) {
        console.log(`  ${check.pass ? 'PASS' : 'FAIL'} ${check.finding}`)
      }
    } else if (panel === 'semrush') {
      console.log(
        result.ok ? 'ok' : 'FAIL',
        `${ms}ms`,
        '| keywords=',
        result.metrics?.organicKeywords,
        '| traffic=',
        result.metrics?.organicTraffic,
        '| rank=',
        result.metrics?.rank,
        result.ok ? '' : `| error=${result.error}`
      )
    } else {
      console.log(
        result.ok ? 'ok' : 'FAIL',
        `${ms}ms`,
        result.ok ? '' : `| error=${result.error}`
      )
    }
  }

  // Persist if results column exists
  if (!colErr) {
    const row = {
      company_id: company.id,
      run_at: new Date().toISOString(),
      site_url: siteUrl,
      sample_url: sample.sampleUrl,
      results,
      pagespeed_mobile: results.pagespeed?.mobile || null,
      pagespeed_desktop: results.pagespeed?.desktop || null,
      bot_access: results.semrush?.botAccess || null,
      jsonld_check: results.technical?.jsonld || null,
    }
    const { data: inserted, error: insertError } = await sb
      .from('audit_snapshots')
      .insert(row)
      .select('id, run_at')
      .single()
    if (insertError) console.log('PERSIST FAIL', insertError.message)
    else console.log('PERSISTED', inserted.id, inserted.run_at)
  }
}

console.log('\nDone.')
