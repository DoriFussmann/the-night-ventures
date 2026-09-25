import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
for (const line of fs.readFileSync(path.join(root, '.env.local'), 'utf8').split(/\r?\n/)) {
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
  process.env[key] = val
}

const results = {}

function mark(name, ok, detail) {
  results[name] = { ok, detail }
  console.log(`${ok ? 'OK' : 'FAIL'} ${name}: ${detail}`)
}

const supabaseUrl =
  process.env.SUPABASE_URL && !/YOUR_PROJECT/i.test(process.env.SUPABASE_URL)
    ? process.env.SUPABASE_URL
    : process.env.VITE_SUPABASE_URL

try {
  const sb = createClient(supabaseUrl, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { error } = await sb.from('companies').select('id').limit(1)
  mark('VITE_SUPABASE_URL+ANON', !error, error?.message || 'anon query ok')
} catch (e) {
  mark('VITE_SUPABASE_URL+ANON', false, e.message)
}

try {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
  if (key.length < 80 || /your-|placeholder/i.test(key)) {
    mark('SUPABASE_SERVICE_ROLE_KEY', false, 'missing/placeholder')
  } else {
    const sb = createClient(supabaseUrl, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { error } = await sb.from('chat_sessions').select('id').limit(1)
    mark('SUPABASE_SERVICE_ROLE_KEY', !error, error?.message || 'service query ok')
  }
} catch (e) {
  mark('SUPABASE_SERVICE_ROLE_KEY', false, e.message)
}

mark(
  'ANTHROPIC_API_KEY',
  Boolean(process.env.ANTHROPIC_API_KEY) && process.env.ANTHROPIC_API_KEY.length > 20,
  process.env.ANTHROPIC_API_KEY ? `len=${process.env.ANTHROPIC_API_KEY.length}` : 'missing'
)

mark(
  'UNSPLASH_ACCESS_KEY',
  Boolean(process.env.UNSPLASH_ACCESS_KEY) && process.env.UNSPLASH_ACCESS_KEY.length > 10,
  process.env.UNSPLASH_ACCESS_KEY ? `len=${process.env.UNSPLASH_ACCESS_KEY.length}` : 'missing'
)

mark(
  'SHUTTERSTOCK_API_TOKEN',
  Boolean(process.env.SHUTTERSTOCK_API_TOKEN) && process.env.SHUTTERSTOCK_API_TOKEN.length > 10,
  process.env.SHUTTERSTOCK_API_TOKEN ? `len=${process.env.SHUTTERSTOCK_API_TOKEN.length}` : 'missing'
)

mark(
  'SHUTTERSTOCK_SUBSCRIPTION_ID',
  Boolean(String(process.env.SHUTTERSTOCK_SUBSCRIPTION_ID || '').trim()),
  process.env.SHUTTERSTOCK_SUBSCRIPTION_ID ? 'set' : 'missing'
)

const { semrushTools } = await import(
  pathToFileURL(path.join(root, 'lib/seo-advisor/providers/semrush.js')).href
)
const { dataforseoTools } = await import(
  pathToFileURL(path.join(root, 'lib/seo-advisor/providers/dataforseo.js')).href
)
const { mozTools } = await import(
  pathToFileURL(path.join(root, 'lib/seo-advisor/providers/moz.js')).href
)

const sm = await semrushTools.domainOverview({ domain: 'semrush.com' })
mark('SEMRUSH_API_KEY', sm.available, sm.available ? 'live' : sm.reason)

const dfs = await dataforseoTools.keywordData({ keyword: 'seo' })
mark(
  'DATAFORSEO_LOGIN+PASSWORD',
  dfs.available,
  dfs.available ? 'live' : dfs.reason
)

const moz = await mozTools.domainMetrics({ domain: 'moz.com' })
mark('MOZ_API_TOKEN', moz.available, moz.available ? 'live' : moz.reason)
