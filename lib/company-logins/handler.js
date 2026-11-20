// AEO Playbook → Login & Access.
// GET  ?action=list&companyId=…            → logins without passwords (hasPassword flag)
// POST { action: reveal, companyId, id }   → { password }
// POST { action: save, companyId, login }  → saved login (password only changed when sent)
// POST { action: delete, companyId, id }
import { requireAuth, createServiceClient, handleOptions, parseBody, json } from '../seo-advisor/auth.js'
import { encrypt, decrypt } from './crypto.js'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const COLS = 'id, title, username, password_enc, comments, sort, created_at, updated_at'
const MAX = { title: 200, username: 500, password: 2000, comments: 5000 }

function bad(message, statusCode = 400) {
  const err = new Error(message)
  err.statusCode = statusCode
  return err
}

function uuid(v, name) {
  if (typeof v !== 'string' || !UUID.test(v)) throw bad(`Invalid ${name}`)
  return v
}

function text(v, name) {
  const s = v == null ? '' : String(v)
  if (s.length > MAX[name]) throw bad(`${name} is too long`)
  return s
}

function shape(row) {
  const { password_enc, ...rest } = row
  return { ...rest, hasPassword: Boolean(password_enc) }
}

async function list(db, companyId) {
  const { data, error } = await db.from('company_logins').select(COLS).eq('company_id', companyId)
    .order('sort').order('created_at')
  if (error) throw error
  return { logins: (data || []).map(shape) }
}

async function reveal(db, companyId, id) {
  const { data, error } = await db.from('company_logins').select('password_enc')
    .eq('company_id', companyId).eq('id', uuid(id, 'id')).maybeSingle()
  if (error) throw error
  if (!data) throw bad('Login not found', 404)
  return { password: decrypt(data.password_enc) }
}

async function save(db, companyId, login = {}) {
  const row = {
    title: text(login.title, 'title').trim(),
    username: text(login.username, 'username'),
    comments: text(login.comments, 'comments'),
    updated_at: new Date().toISOString(),
  }
  if (!row.title) throw bad('Title is required')
  if (login.password !== undefined) row.password_enc = encrypt(text(login.password, 'password'))
  if (Number.isInteger(login.sort)) row.sort = login.sort

  const q = login.id
    ? db.from('company_logins').update(row).eq('company_id', companyId).eq('id', uuid(login.id, 'id'))
    : db.from('company_logins').insert({ ...row, company_id: companyId })
  const { data, error } = await q.select(COLS).single()
  if (error) throw error
  return { login: shape(data) }
}

async function remove(db, companyId, id) {
  const { error } = await db.from('company_logins').delete().eq('company_id', companyId).eq('id', uuid(id, 'id'))
  if (error) throw error
  return { ok: true }
}

export async function handleCompanyLogins(req, res) {
  if (handleOptions(req, res, 'GET, POST, OPTIONS')) return
  try {
    await requireAuth(req)
    const db = createServiceClient() // table has no RLS policies; service role only
    const url = new URL(req.url || '/', 'http://localhost')
    const body = req.method === 'POST' ? parseBody(req) : {}
    const action = String(url.searchParams.get('action') || body.action || '')
    const companyId = uuid(url.searchParams.get('companyId') || body.companyId, 'companyId')
    res.setHeader('Cache-Control', 'no-store')
    if (req.method === 'GET' && action === 'list') return json(res, 200, await list(db, companyId))
    if (req.method !== 'POST') throw bad('Unknown action', 404)
    if (action === 'reveal') return json(res, 200, await reveal(db, companyId, body.id))
    if (action === 'save') return json(res, 200, await save(db, companyId, body.login))
    if (action === 'delete') return json(res, 200, await remove(db, companyId, body.id))
    throw bad('Unknown action', 404)
  } catch (err) {
    const status = err.statusCode || 500
    return json(res, status, { error: err.message || 'Request failed' })
  }
}
