// Assert every check-article-update rewrite in vercel.json is in ACTION_ROUTES.
// Run: node scripts/test-route-parity.mjs
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ACTION_ROUTES } from '../lib/actionRoutes.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const vercel = JSON.parse(readFileSync(join(root, 'vercel.json'), 'utf8'))
const destinationPrefix = '/api/check-article-update?action='

const routed = (Array.isArray(vercel.rewrites) ? vercel.rewrites : []).filter(
  (rule) => String(rule?.destination || '').startsWith(destinationPrefix)
)

assert.ok(routed.length > 0, 'no check-article-update rewrites in vercel.json')

for (const rule of routed) {
  const action = new URL(rule.destination, 'http://localhost').searchParams.get('action')
  const name = String(rule.source || '').replace(/^\/api\//, '').replace(/\/$/, '')
  assert.equal(
    ACTION_ROUTES[name],
    action,
    `${rule.source} action "${action}" is missing from ACTION_ROUTES`
  )
}

console.log(`✓ ${routed.length} rewrite pairs match ACTION_ROUTES`)
