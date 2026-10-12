/**
 * Self-test for SEO Advisor data loop (auth → chat SSE → tools → keyword recommendations → reload).
 * Usage: node scripts/test-seo-advisor.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { createClient } from '@supabase/supabase-js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  const text = fs.readFileSync(filePath, 'utf8')
  for (const line of text.split(/\r?\n/)) {
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
loadEnvFile(path.join(root, '.env'))

function resolveSupabaseUrl() {
  const primary = process.env.SUPABASE_URL
  const fallback = process.env.VITE_SUPABASE_URL
  if (primary && !/YOUR_PROJECT|your-project/i.test(primary)) return primary
  return fallback || primary
}

const supabaseUrl = resolveSupabaseUrl()
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
const anonKey = process.env.VITE_SUPABASE_ANON_KEY

if (!supabaseUrl || !serviceKey || !anonKey) {
  console.error('Missing Supabase env (URL / service role / anon)')
  process.exit(1)
}
console.log('Supabase URL:', supabaseUrl)

function serviceRoleLooksValid(key) {
  if (!key || typeof key !== 'string') return false
  if (/your-service-role|YOUR_|change-me|placeholder/i.test(key)) return false
  return key.length > 80
}

const useService = serviceRoleLooksValid(serviceKey)
const admin = useService
  ? createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null

async function getAccessToken() {
  if (useService) {
    const { data, error } = await admin.auth.admin.listUsers({ page: 1, perPage: 5 })
    if (error) throw error
    const user = data?.users?.[0]
    if (!user?.email) throw new Error('No auth users found to mint a test token')

    const { data: linkData, error: linkError } = await admin.auth.admin.generateLink({
      type: 'magiclink',
      email: user.email,
    })
    if (linkError) throw linkError

    const tokenHash = linkData?.properties?.hashed_token
    if (!tokenHash) throw new Error('generateLink did not return hashed_token')

    const anon = createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const { data: otpData, error: otpError } = await anon.auth.verifyOtp({
      token_hash: tokenHash,
      type: 'email',
    })
    if (otpError) throw otpError
    const accessToken = otpData?.session?.access_token
    if (!accessToken) throw new Error('Failed to obtain access token')
    return { accessToken, email: user.email }
  }

  const email = process.env.SEO_ADVISOR_TEST_EMAIL
  const password = process.env.SEO_ADVISOR_TEST_PASSWORD
  if (!email || !password) {
    throw new Error(
      'SUPABASE_SERVICE_ROLE_KEY is a placeholder. Set a real service role key, or set SEO_ADVISOR_TEST_EMAIL + SEO_ADVISOR_TEST_PASSWORD for password login.'
    )
  }
  const anon = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data, error } = await anon.auth.signInWithPassword({ email, password })
  if (error) throw error
  return { accessToken: data.session.access_token, email }
}

async function main() {
  console.log('=== SEO AI Advisor self-test ===')
  console.log(
    useService
      ? 'DB auth: service role'
      : 'DB auth: user JWT + anon (service role key is placeholder)'
  )

  const { accessToken, email } = await getAccessToken()
  console.log(`✓ Auth token minted for ${email}`)

  const authed = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const { error: tableError } = await authed.from('chat_sessions').select('id').limit(1)
  if (tableError) {
    console.error('chat_sessions missing or inaccessible:', tableError.message)
    console.error('Apply supabase/migrations/018_industries_chat_insights.sql (+ 019).')
    process.exit(1)
  }
  console.log('✓ chat_sessions table reachable')

  const { data: companies, error: companyError } = await authed
    .from('companies')
    .select('id, name')
    .limit(1)
  if (companyError) throw companyError
  const company = companies?.[0]
  if (!company) {
    console.error('No companies in DB — create one first')
    process.exit(1)
  }
  console.log(`✓ Using company ${company.name} (${company.id})`)

  const providers = {
    SEMRUSH_API_KEY: Boolean(process.env.SEMRUSH_API_KEY),
    DATAFORSEO_LOGIN: Boolean(process.env.DATAFORSEO_LOGIN),
    DATAFORSEO_PASSWORD: Boolean(process.env.DATAFORSEO_PASSWORD),
    MOZ_API_TOKEN: Boolean(process.env.MOZ_API_TOKEN),
    ANTHROPIC_API_KEY: Boolean(process.env.ANTHROPIC_API_KEY),
  }
  console.log('Env provider flags:', providers)

  // Direct provider smoke (normalized shape, graceful failure)
  const { dataforseoTools } = await import(
    pathToFileURL(path.join(root, 'lib/seo-advisor/providers/dataforseo.js')).href
  )
  const { semrushTools } = await import(
    pathToFileURL(path.join(root, 'lib/seo-advisor/providers/semrush.js')).href
  )

  const dfs = await dataforseoTools.keywordData({ keyword: 'seo tools' })
  console.log(
    dfs.available
      ? `✓ DataForSEO keyword_data returned ${dfs.keywords?.length || 0} rows`
      : `○ DataForSEO unavailable: ${dfs.reason}`
  )

  const sm = await semrushTools.domainOverview({ domain: 'semrush.com' })
  console.log(
    sm.available
      ? `✓ Semrush domain_overview ok (organicKeywords=${sm.metrics?.organicKeywords})`
      : `○ Semrush unavailable: ${sm.reason}`
  )

  const base = process.env.SEO_ADVISOR_TEST_BASE || 'http://localhost:5173'
  const message =
    "Based on Company Intelligence, which 2 Core keywords should we own? Pull real search volume and difficulty, then recommend your strongest pick with recommend_keyword."

  console.log(`→ POST ${base}/api/seo-advisor-chat …`)
  const res = await fetch(`${base}/api/seo-advisor-chat`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ companyId: company.id, message }),
  })

  if (!res.ok) {
    const errBody = await res.text()
    console.error('Chat HTTP', res.status, errBody)
    process.exit(1)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let sessionId = null
  let toolStarts = 0
  let toolEnds = 0
  let recommendations = 0
  let textLen = 0
  let done = null

  while (true) {
    const { done: eof, value } = await reader.read()
    if (eof) break
    buffer += decoder.decode(value, { stream: true })
    let sep
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      let event = 'message'
      const dataLines = []
      for (const line of chunk.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim())
      }
      if (!dataLines.length) continue
      const data = JSON.parse(dataLines.join('\n'))
      if (event === 'session') sessionId = data.id
      if (event === 'tool_start') toolStarts += 1
      if (event === 'tool_end') toolEnds += 1
      if (event === 'recommendation') recommendations += 1
      if (event === 'text_delta') textLen += (data.text || '').length
      if (event === 'done') done = data
      if (event === 'error') console.error('SSE error:', data)
    }
  }

  console.log('SSE summary:', {
    sessionId,
    toolStarts,
    toolEnds,
    recommendations,
    textLen,
    done,
  })

  if (!sessionId) {
    console.error('✗ No session id from stream')
    process.exit(1)
  }
  if (toolStarts < 1) {
    console.error('✗ Expected at least one tool_start')
    process.exit(1)
  }
  console.log(`✓ Tool calls observed (${toolStarts} start / ${toolEnds} end)`)

  // Reload session
  const reload = await fetch(
    `${base}/api/seo-advisor-sessions?companyId=${encodeURIComponent(company.id)}&sessionId=${encodeURIComponent(sessionId)}`,
    { headers: { Authorization: `Bearer ${accessToken}` } }
  )
  const reloadData = await reload.json()
  if (!reload.ok) {
    console.error('✗ Reload failed', reloadData)
    process.exit(1)
  }
  const msgCount = reloadData.messages?.length || 0
  console.log(`✓ Reloaded session: ${msgCount} messages`)

  if (msgCount < 2) {
    console.error('✗ Expected persisted messages')
    process.exit(1)
  }

  const hasToolMsg = (reloadData.messages || []).some((m) => m.role === 'tool')
  if (!hasToolMsg) {
    console.error('✗ Expected tool messages in history')
    process.exit(1)
  }
  console.log('✓ Tool results persisted in chat_messages')

  if (recommendations < 1) {
    console.warn('○ No keyword recommendation this turn (model may have held back)')
  } else {
    console.log(`✓ ${recommendations} keyword recommendation card(s) streamed`)
  }

  const realProviderData = dfs.available || sm.available
  if (!realProviderData) {
    console.warn(
      '○ No live Semrush/DataForSEO data — add SEMRUSH_API_KEY and/or DATAFORSEO_* to .env.local'
    )
  } else {
    console.log('✓ At least one SEO provider returned live data')
  }

  console.log('=== Self-test finished ===')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
