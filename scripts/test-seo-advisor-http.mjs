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

const url = process.env.VITE_SUPABASE_URL
const anon = process.env.VITE_SUPABASE_ANON_KEY
const sb = createClient(url, anon, {
  auth: { persistSession: false, autoRefreshToken: false },
})

const email = `seo.advisor.test.${Date.now()}@gmail.com`
const password = `TestPass_${Math.random().toString(36).slice(2)}9!`
const { data, error } = await sb.auth.signUp({ email, password })
if (error) {
  console.error('signup failed:', error.message)
  process.exit(1)
}
if (!data.session?.access_token) {
  console.error('signup ok but no session (email confirm required?)')
  process.exit(1)
}

const token = data.session.access_token
const { data: companies, error: cErr } = await sb
  .from('companies')
  .select('id, name')
  .limit(1)
if (cErr) {
  console.error('companies:', cErr.message)
  process.exit(1)
}
const company = companies?.[0]
if (!company) {
  console.error('No companies visible to new user')
  process.exit(1)
}

const { error: tErr } = await sb.from('chat_sessions').select('id').limit(1)
if (tErr) {
  console.error('chat_sessions:', tErr.message)
  console.error('Apply migration 018 first')
  process.exit(1)
}

const base = 'http://localhost:5173'
console.log('Company:', company.name, company.id)
console.log('→ streaming chat…')

const res = await fetch(`${base}/api/seo-advisor-chat`, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    companyId: company.id,
    message:
      "Which Core keyword should this company own first? Check volume and difficulty, then recommend it with recommend_keyword.",
  }),
})

console.log('HTTP', res.status, res.headers.get('content-type'))
if (!res.ok) {
  console.error(await res.text())
  process.exit(1)
}

let sessionId = null
let toolStarts = 0
let recommendations = 0
let textLen = 0
let buffer = ''
const reader = res.body.getReader()
const decoder = new TextDecoder()
while (true) {
  const { done, value } = await reader.read()
  if (done) break
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
    const payload = JSON.parse(dataLines.join('\n'))
    if (event === 'session') sessionId = payload.id
    if (event === 'tool_start') toolStarts += 1
    if (event === 'recommendation') recommendations += 1
    if (event === 'text_delta') textLen += (payload.text || '').length
    if (event === 'error') console.error('sse error', payload)
    if (event === 'done') console.log('done', payload)
  }
}

console.log({ sessionId, toolStarts, recommendations, textLen })
if (!sessionId || toolStarts < 1) process.exit(1)

const reload = await fetch(
  `${base}/api/seo-advisor-sessions?companyId=${company.id}&sessionId=${sessionId}`,
  { headers: { Authorization: `Bearer ${token}` } }
)
const reloadData = await reload.json()
console.log('reload', reload.status, {
  messages: reloadData.messages?.length,
  toolMsgs: reloadData.messages?.filter((m) => m.role === 'tool').length,
})
if (!reload.ok || (reloadData.messages?.length || 0) < 2) process.exit(1)
console.log('✓ HTTP e2e loop ok')
