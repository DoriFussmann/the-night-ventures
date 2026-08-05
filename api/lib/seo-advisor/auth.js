import { createClient } from '@supabase/supabase-js'

function resolveSupabaseUrl() {
  const primary = process.env.SUPABASE_URL
  const fallback = process.env.VITE_SUPABASE_URL
  if (primary && !/YOUR_PROJECT|your-project/i.test(primary)) return primary
  return fallback || primary
}

function resolveAnonKey() {
  return process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY || ''
}

function serviceRoleLooksValid(key) {
  if (!key || typeof key !== 'string') return false
  if (/your-service-role|YOUR_|change-me|placeholder/i.test(key)) return false
  // Real Supabase service role JWTs are long; reject short stubs.
  return key.length > 80
}

export function createServiceClient() {
  const supabaseUrl = resolveSupabaseUrl()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!supabaseUrl || !serviceRoleLooksValid(serviceKey)) {
    const err = new Error('Missing Supabase server configuration')
    err.statusCode = 500
    throw err
  }
  return createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getBearerToken(req) {
  const header = req.headers?.authorization || req.headers?.Authorization || ''
  if (typeof header !== 'string') return null
  if (!header.startsWith('Bearer ')) return null
  const token = header.slice(7).trim()
  return token || null
}

/**
 * Verify the caller's JWT. Prefer service-role DB access when configured;
 * otherwise use the user JWT + anon key (RLS), matching the rest of the app.
 */
export async function requireAuth(req) {
  const token = getBearerToken(req)
  if (!token) {
    const err = new Error('Unauthorized')
    err.statusCode = 401
    throw err
  }

  const supabaseUrl = resolveSupabaseUrl()
  const anonKey = resolveAnonKey()
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const useService = serviceRoleLooksValid(serviceKey)

  if (!supabaseUrl || (!useService && !anonKey)) {
    const err = new Error('Missing Supabase server configuration')
    err.statusCode = 500
    throw err
  }

  const authClient = createClient(supabaseUrl, useService ? serviceKey : anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  })

  const {
    data: { user },
    error,
  } = await authClient.auth.getUser(token)

  if (error || !user) {
    const err = new Error('Unauthorized')
    err.statusCode = 401
    throw err
  }

  const supabase = useService
    ? createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : createClient(supabaseUrl, anonKey, {
        global: { headers: { Authorization: `Bearer ${token}` } },
        auth: { persistSession: false, autoRefreshToken: false },
      })

  return { user, supabase, token, usingServiceRole: useService }
}

export function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function handleOptions(req, res, methods = 'GET, POST, PATCH, OPTIONS') {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', methods)
    res.setHeader(
      'Access-Control-Allow-Headers',
      'Content-Type, Authorization'
    )
    res.end()
    return true
  }
  return false
}

export function parseBody(req) {
  if (req.body == null) return {}
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body)
    } catch {
      return {}
    }
  }
  return req.body
}
