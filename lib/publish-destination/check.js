// Publish Destination connection check. Runs the same access TNV needs to
// publish, step by step, and says exactly what to fix when a step fails.
// It writes nothing visible: the write probe creates an unreferenced git blob
// (no branch, no commit, no deploy) and the pull-request probe asks GitHub for
// a PR it is guaranteed to refuse (head = base).

import { ownerRepoIssue, tokenEnvName, tokenKeyIssue } from './tokenKey.js'

const API = 'https://api.github.com'
const TIMEOUT_MS = 12000
const EXPIRY_WARN_DAYS = 14
const DAY_MS = 24 * 60 * 60 * 1000

export const CHECK_STEPS = [
  { id: 'fields', label: 'Fields filled in correctly' },
  { id: 'variable', label: 'Token variable found in TNV' },
  { id: 'token', label: 'GitHub accepts the token' },
  { id: 'repo', label: 'Repo reachable with this token' },
  { id: 'contents', label: 'Can write files (Contents)' },
  { id: 'pulls', label: 'Can open pull requests' },
  { id: 'expiry', label: 'Token expiry' },
]

/**
 * Parse GitHub's token expiry header ("2026-11-15 00:00:00 UTC" or "... -0700").
 * @param {string | null} raw
 * @returns {Date | null}
 */
export function parseTokenExpiry(raw) {
  const value = String(raw || '').trim()
  if (!value) return null
  const m = value.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})\s*(UTC|Z|[+-]\d{2}:?\d{2})?$/i)
  if (m) {
    const zone = !m[3] || /^(utc|z)$/i.test(m[3]) ? 'Z' : m[3].replace(/^([+-]\d{2})(\d{2})$/, '$1:$2')
    const date = new Date(`${m[1]}T${m[2]}${zone}`)
    return Number.isNaN(date.getTime()) ? null : date
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function formatDate(date) {
  return date.toISOString().slice(0, 10)
}

function looksSet(value) {
  return String(value || '').trim().length >= 8
}

function configuredLabels(env) {
  return Object.keys(env)
    .filter((key) => /^GITHUB_TOKEN_[A-Z0-9_]+$/.test(key) && looksSet(env[key]))
    .map((key) => key.replace(/^GITHUB_TOKEN_/, ''))
    .sort()
}

async function github(fetchImpl, token, path, { method = 'GET', body } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS)
  try {
    const res = await fetchImpl(`${API}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'the-night-ventures',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    })
    const data = await res.json().catch(() => ({}))
    return {
      status: res.status,
      data,
      expiry: res.headers.get('github-authentication-token-expiration'),
    }
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error('GitHub did not answer within 12 seconds. Try again.')
    throw err
  } finally {
    clearTimeout(timer)
  }
}

function step(id, status, detail, fix = '') {
  const meta = CHECK_STEPS.find((s) => s.id === id)
  return { id, label: meta?.label || id, status, detail, fix }
}

function finish(steps) {
  const done = new Set(steps.map((s) => s.id))
  const rest = CHECK_STEPS.filter((s) => !done.has(s.id)).map((s) =>
    step(s.id, 'skip', 'Not checked — fix the step above first.')
  )
  const all = [...steps, ...rest]
  return { ok: all.every((s) => s.status === 'ok' || s.status === 'warn'), steps: all }
}

/**
 * @param {{
 *   owner: string, repo: string, tokenKey: string,
 *   env?: Record<string, string | undefined>,
 *   fetchImpl?: typeof fetch,
 *   now?: Date,
 * }} input
 * @returns {Promise<{ ok: boolean, steps: Array<{ id: string, label: string, status: 'ok'|'warn'|'fail'|'skip', detail: string, fix: string }> }>}
 */
export async function checkPublishDestination({
  owner,
  repo,
  tokenKey,
  env = process.env,
  fetchImpl = fetch,
  now = new Date(),
}) {
  const steps = []
  const o = String(owner || '').trim()
  const r = String(repo || '').trim()
  const key = String(tokenKey || '').trim().toUpperCase()

  // 1. Fields
  const missing = [!o && 'GitHub owner', !r && 'GitHub repo', !key && 'GitHub token key'].filter(Boolean)
  const fieldIssue =
    (missing.length && `Missing: ${missing.join(', ')}.`) ||
    ownerRepoIssue('owner', o) ||
    ownerRepoIssue('repo', r) ||
    tokenKeyIssue(key)
  if (fieldIssue) {
    steps.push(step('fields', 'fail', fieldIssue, 'Correct the field, then run the check again.'))
    return finish(steps)
  }
  steps.push(step('fields', 'ok', `${o}/${r}, label ${key}`))

  // 2. Env var
  const envName = tokenEnvName(key)
  const token = String(env[envName] || '').trim()
  if (!looksSet(token)) {
    const labels = configuredLabels(env)
    steps.push(
      step(
        'variable',
        'fail',
        `TNV has no ${envName}.${labels.length ? ` Labels TNV can see: ${labels.join(', ')}.` : ''}`,
        `Either the label here does not match the Vercel variable (it must be exactly ${envName}), or the variable was added but TNV was not redeployed. Fix the name in Vercel or here, then Deployments → latest → ⋯ → Redeploy.`
      )
    )
    return finish(steps)
  }
  steps.push(step('variable', 'ok', `${envName} is set`))

  // 3. Token valid
  const auth = await github(fetchImpl, token, '/rate_limit')
  let expiryRaw = auth.expiry
  if (auth.status === 401) {
    steps.push(
      step(
        'token',
        'fail',
        'GitHub rejected the token.',
        `It expired, was deleted on GitHub, or was copied incompletely. Create a new token (Part 1), replace the value of ${envName} in Vercel, and redeploy TNV.`
      )
    )
    return finish(steps)
  }
  if (auth.status >= 400) {
    steps.push(step('token', 'fail', auth.data?.message || `GitHub answered ${auth.status}.`, 'Try again in a minute.'))
    return finish(steps)
  }
  steps.push(step('token', 'ok', 'Token is valid'))

  // 4. Repo reachable
  const repoPath = `/repos/${encodeURIComponent(o)}/${encodeURIComponent(r)}`
  const repoRes = await github(fetchImpl, token, repoPath)
  expiryRaw = expiryRaw || repoRes.expiry
  if (repoRes.status === 404 || repoRes.status === 403) {
    steps.push(
      step(
        'repo',
        'fail',
        `GitHub can't see ${o}/${r} with this token.`,
        'Check three things: owner and repo are spelled exactly as in the repo URL; the token\'s Repository access includes this repo; the token\'s Resource owner is the account or organization that owns the repo. Change the token on GitHub (no need to create a new one), then run the check again.'
      )
    )
    return finish(steps)
  }
  if (repoRes.status >= 400) {
    steps.push(step('repo', 'fail', repoRes.data?.message || `GitHub answered ${repoRes.status}.`, 'Try again in a minute.'))
    return finish(steps)
  }
  if (repoRes.data?.archived) {
    steps.push(step('repo', 'fail', `${o}/${r} is archived and read-only.`, 'Unarchive it on GitHub, or point this company at the live repo.'))
    return finish(steps)
  }
  const branch = String(repoRes.data?.default_branch || 'main')
  steps.push(step('repo', 'ok', `${o}/${r} found (default branch ${branch})`))

  // 5. Contents write — an unreferenced blob: no branch, commit or deploy.
  const blob = await github(fetchImpl, token, `${repoPath}/git/blobs`, {
    method: 'POST',
    body: { content: 'TNV connection check', encoding: 'utf-8' },
  })
  if (blob.status === 403 || blob.status === 404) {
    steps.push(
      step(
        'contents',
        'fail',
        'The token can read the repo but not write to it.',
        'On GitHub, edit the token → Repository permissions → Contents: Read and write → Update. No new token needed.'
      )
    )
    return finish(steps)
  }
  if (blob.status >= 400) {
    steps.push(step('contents', 'fail', blob.data?.message || `GitHub answered ${blob.status}.`, 'Try again in a minute.'))
    return finish(steps)
  }
  steps.push(step('contents', 'ok', 'Write access confirmed (nothing was changed in the repo)'))

  // 6. Pull requests — head = base is always refused with 422 when allowed.
  const pr = await github(fetchImpl, token, `${repoPath}/pulls`, {
    method: 'POST',
    body: { title: 'TNV connection check', head: branch, base: branch },
  })
  if (pr.status === 422) {
    steps.push(step('pulls', 'ok', 'Pull request access confirmed (no pull request was opened)'))
  } else if (pr.status === 403 || pr.status === 404) {
    steps.push(
      step(
        'pulls',
        'fail',
        'The token cannot open pull requests, which publishing uses.',
        'On GitHub, edit the token → Repository permissions → Pull requests: Read and write → Update.'
      )
    )
    return finish(steps)
  } else if (pr.status === 201 && pr.data?.number) {
    await github(fetchImpl, token, `${repoPath}/pulls/${pr.data.number}`, {
      method: 'PATCH',
      body: { state: 'closed' },
    })
    steps.push(step('pulls', 'ok', `Pull request access confirmed (test PR #${pr.data.number} was closed)`))
  } else {
    steps.push(
      step('pulls', 'warn', `Could not confirm (GitHub answered ${pr.status}).`, 'Make sure the token has Pull requests: Read and write.')
    )
  }

  // 7. Expiry
  const expiry = parseTokenExpiry(expiryRaw)
  if (!expiry) {
    steps.push(step('expiry', 'ok', 'No expiry date'))
  } else {
    const days = Math.floor((expiry.getTime() - now.getTime()) / DAY_MS)
    if (days < EXPIRY_WARN_DAYS) {
      steps.push(
        step(
          'expiry',
          'warn',
          `Expires ${formatDate(expiry)} (${Math.max(days, 0)} day${days === 1 ? '' : 's'} left).`,
          `Before then: on GitHub, regenerate the token, paste the new value into ${envName} in Vercel, and redeploy TNV.`
        )
      )
    } else {
      steps.push(step('expiry', 'ok', `Expires ${formatDate(expiry)} (${days} days left)`))
    }
  }

  return finish(steps)
}
