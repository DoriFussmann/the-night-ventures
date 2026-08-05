import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile(path.join(root, '.env.local'))

const keys = [
  'ANTHROPIC_API_KEY',
  'SEMRUSH_API_KEY',
  'DATAFORSEO_LOGIN',
  'DATAFORSEO_PASSWORD',
  'MOZ_API_TOKEN',
  'SUPABASE_SERVICE_ROLE_KEY',
  'SUPABASE_URL',
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'SEO_ADVISOR_TEST_EMAIL',
  'SEO_ADVISOR_TEST_PASSWORD',
]

console.log('=== Env check ===')
for (const k of keys) {
  const v = process.env[k]
  if (!v) {
    console.log(`${k}: MISSING`)
    continue
  }
  const placeholder = /your-|YOUR_|placeholder|change-me|YOUR_PROJECT/i.test(v)
  console.log(`${k}: ${placeholder ? 'PLACEHOLDER' : 'set'} (len=${v.length})`)
}

function resolveSupabaseUrl() {
  const primary = process.env.SUPABASE_URL
  const fallback = process.env.VITE_SUPABASE_URL
  if (primary && !/YOUR_PROJECT|your-project/i.test(primary)) return primary
  return fallback || primary
}

function serviceRoleLooksValid(key) {
  if (!key) return false
  if (/your-service-role|YOUR_|change-me|placeholder/i.test(key)) return false
  return key.length > 80
}

const supabaseUrl = resolveSupabaseUrl()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

console.log('\n=== Schema / provider smoke ===')

if (serviceRoleLooksValid(serviceKey)) {
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  for (const table of ['chat_sessions', 'chat_messages', 'insights', 'company_industries']) {
    const { error } = await admin.from(table).select('*').limit(1)
    console.log(`${table}: ${error ? error.message : 'ok'}`)
  }
  const { error: patchErr } = await admin.from('insights').select('profile_patch').limit(1)
  console.log(`insights.profile_patch: ${patchErr ? patchErr.message : 'ok'}`)
} else {
  console.log('Service role still placeholder — skipping schema check via service role')
  console.log('Tables are fine if SQL Editor ran 018+019 successfully.')
}

const { semrushTools } = await import(
  pathToFileURLSafe('../lib/seo-advisor/providers/semrush.js')
)
const { dataforseoTools } = await import(
  pathToFileURLSafe('../lib/seo-advisor/providers/dataforseo.js')
)
const { mozTools } = await import(pathToFileURLSafe('../lib/seo-advisor/providers/moz.js'))

function pathToFileURLSafe(rel) {
  return new URL(rel, import.meta.url).href
}

const sm = await semrushTools.domainOverview({ domain: 'semrush.com' })
console.log(
  sm.available
    ? `Semrush: LIVE (organicKeywords=${sm.metrics?.organicKeywords})`
    : `Semrush: ${sm.reason}`
)

const dfs = await dataforseoTools.keywordData({ keyword: 'seo tools' })
console.log(
  dfs.available
    ? `DataForSEO: LIVE (${dfs.keywords?.length || 0} keywords)`
    : `DataForSEO: ${dfs.reason}`
)

const moz = await mozTools.domainMetrics({ domain: 'moz.com' })
console.log(
  moz.available
    ? `Moz: LIVE (DA=${moz.metrics?.domainAuthority})`
    : `Moz: ${moz.reason}`
)

const readyProviders = [sm.available, dfs.available].filter(Boolean).length
const ready =
  Boolean(process.env.ANTHROPIC_API_KEY) &&
  !/your-|YOUR_/i.test(process.env.ANTHROPIC_API_KEY || '') &&
  readyProviders >= 1

console.log('\n=== Verdict ===')
if (ready) {
  console.log('READY to test in the UI.')
  console.log('Open a company dashboard → SEO AI Advisor → try Pillar Content Strategy.')
} else {
  console.log('Not fully ready yet — fix the failures above first.')
}
if (!serviceRoleLooksValid(serviceKey)) {
  console.log(
    'Note: SUPABASE_SERVICE_ROLE_KEY is still a placeholder. Chat will use user JWT + RLS (works if you are logged in).'
  )
}
