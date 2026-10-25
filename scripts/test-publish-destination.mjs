// Publish Destination: field rules and the connection check against a fake GitHub.
// Run: node scripts/test-publish-destination.mjs
import assert from 'node:assert/strict'
import { ownerRepoIssue, tokenEnvName, tokenKeyIssue } from '../lib/publish-destination/tokenKey.js'
import { checkPublishDestination, parseTokenExpiry } from '../lib/publish-destination/check.js'
import { publishGuideText } from '../lib/publish-destination/guide.js'

// Field rules
assert.equal(tokenKeyIssue(''), null)
assert.equal(tokenKeyIssue('HEYRUPERT'), null)
assert.equal(tokenKeyIssue('album_amicorum'), null, 'lowercase is uppercased on save')
assert.match(tokenKeyIssue('github_pat_11ABCDEF'), /label, not the token/)
assert.match(tokenKeyIssue('ghp_abc123'), /label, not the token/)
assert.match(tokenKeyIssue('GITHUB_TOKEN_HEYRUPERT'), /after GITHUB_TOKEN_/)
assert.match(tokenKeyIssue('HEY-RUPERT'), /capital letters/)
assert.match(tokenKeyIssue('1RUPERT'), /starting with a letter/)
assert.equal(tokenEnvName(' heyrupert '), 'GITHUB_TOKEN_HEYRUPERT')
assert.equal(ownerRepoIssue('owner', 'DoriFussmann'), null)
assert.match(ownerRepoIssue('repo', 'https://github.com/DoriFussmann/hey-rupert'), /not a URL/)
assert.match(ownerRepoIssue('repo', 'DoriFussmann/hey-rupert'), /not a URL/)
assert.match(ownerRepoIssue('owner', 'Dori Fussmann'), /letters, numbers/)

// Expiry header
assert.equal(parseTokenExpiry('2026-11-15 00:00:00 UTC').toISOString(), '2026-11-15T00:00:00.000Z')
assert.equal(parseTokenExpiry('2026-11-15 00:00:00 -0700').toISOString(), '2026-11-15T07:00:00.000Z')
assert.equal(parseTokenExpiry(''), null)
assert.equal(parseTokenExpiry('not a date'), null)

assert.match(publishGuideText(), /^Part 1 — On GitHub/)

// Fake GitHub
function fakeGithub(overrides = {}) {
  const calls = []
  const routes = {
    'GET /rate_limit': { status: 200, body: {}, expiry: '2027-01-01 00:00:00 UTC' },
    'GET /repos/DoriFussmann/hey-rupert': { status: 200, body: { default_branch: 'main' } },
    'POST /repos/DoriFussmann/hey-rupert/git/blobs': { status: 201, body: { sha: 'abc' } },
    'POST /repos/DoriFussmann/hey-rupert/pulls': { status: 422, body: { message: 'Validation Failed' } },
    ...overrides,
  }
  const fetchImpl = async (url, init = {}) => {
    const key = `${init.method || 'GET'} ${new URL(url).pathname}`
    calls.push(key)
    const route = routes[key] || { status: 404, body: { message: 'Not Found' } }
    return {
      status: route.status,
      json: async () => route.body,
      headers: { get: (name) => (name === 'github-authentication-token-expiration' ? route.expiry || null : null) },
    }
  }
  return { fetchImpl, calls }
}

const base = { owner: 'DoriFussmann', repo: 'hey-rupert', tokenKey: 'HEYRUPERT' }
const env = { GITHUB_TOKEN_HEYRUPERT: 'github_pat_xxxxxxxxxxxx', GITHUB_TOKEN_ALBUM: 'github_pat_yyyyyyyyyyyy' }
const now = new Date('2026-10-24T12:00:00Z')
const byId = (result) => Object.fromEntries(result.steps.map((s) => [s.id, s]))

{
  const gh = fakeGithub()
  const result = await checkPublishDestination({ ...base, env, fetchImpl: gh.fetchImpl, now })
  assert.equal(result.ok, true)
  assert.deepEqual(result.steps.map((s) => s.status), ['ok', 'ok', 'ok', 'ok', 'ok', 'ok', 'ok'])
  assert.match(byId(result).expiry.detail, /2027-01-01/)
  assert.ok(!gh.calls.some((c) => c.includes('/git/refs')), 'never creates a branch')
}

{
  const result = await checkPublishDestination({ ...base, tokenKey: 'github_pat_abc', env, fetchImpl: fakeGithub().fetchImpl, now })
  assert.equal(result.ok, false)
  assert.equal(byId(result).fields.status, 'fail')
  assert.equal(byId(result).variable.status, 'skip')
}

{
  const result = await checkPublishDestination({ ...base, tokenKey: 'HEY_RUPERT', env, fetchImpl: fakeGithub().fetchImpl, now })
  const v = byId(result).variable
  assert.equal(v.status, 'fail')
  assert.match(v.detail, /GITHUB_TOKEN_HEY_RUPERT/)
  assert.match(v.detail, /ALBUM, HEYRUPERT/)
  assert.match(v.fix, /Redeploy/)
}

{
  const gh = fakeGithub({ 'GET /rate_limit': { status: 401, body: { message: 'Bad credentials' } } })
  const result = await checkPublishDestination({ ...base, env, fetchImpl: gh.fetchImpl, now })
  assert.equal(byId(result).token.status, 'fail')
  assert.equal(byId(result).repo.status, 'skip')
}

{
  const gh = fakeGithub({ 'GET /repos/DoriFussmann/hey-rupert': { status: 404, body: {} } })
  const result = await checkPublishDestination({ ...base, env, fetchImpl: gh.fetchImpl, now })
  assert.equal(byId(result).repo.status, 'fail')
  assert.match(byId(result).repo.fix, /Resource owner/)
}

{
  const gh = fakeGithub({ 'POST /repos/DoriFussmann/hey-rupert/git/blobs': { status: 403, body: {} } })
  const result = await checkPublishDestination({ ...base, env, fetchImpl: gh.fetchImpl, now })
  assert.equal(byId(result).contents.status, 'fail')
  assert.match(byId(result).contents.fix, /Contents: Read and write/)
}

{
  const gh = fakeGithub({ 'POST /repos/DoriFussmann/hey-rupert/pulls': { status: 403, body: {} } })
  const result = await checkPublishDestination({ ...base, env, fetchImpl: gh.fetchImpl, now })
  assert.equal(byId(result).pulls.status, 'fail')
  assert.equal(result.ok, false)
}

{
  const gh = fakeGithub({ 'GET /rate_limit': { status: 200, body: {}, expiry: '2026-10-30 00:00:00 UTC' } })
  const result = await checkPublishDestination({ ...base, env, fetchImpl: gh.fetchImpl, now })
  assert.equal(byId(result).expiry.status, 'warn')
  assert.equal(result.ok, true, 'a warning does not fail the check')
}

console.log('✓ publish destination')
