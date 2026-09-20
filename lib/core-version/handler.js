import { requireAuth } from '../seo-advisor/auth.js'
import {
  commitFiles,
  createOctokit,
  githubErrorMessage,
  mergeBranch,
  readDestination,
} from '../wire-internal-links/github.js'
import { getProjectCoreVersion, readCorePackage } from '../contract/projectContract.js'
import { classifyCoreCompat } from '../contract/coreContract.js'
import { bumpCorePin, parseCorePin, pickLatestTag, planCoreUpdate } from './plan.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// Resolve the latest seo-core tag for the repo named in the project's pin,
// using the same token (same owner). Returns { name, version } or null.
async function resolveLatestCore(octokit, coreOwner, coreRepo) {
  const { data } = await octokit.repos.listTags({
    owner: coreOwner,
    repo: coreRepo,
    per_page: 100,
  })
  return pickLatestTag(data)
}

export async function buildStatus(octokit, dest) {
  const info = await getProjectCoreVersion(octokit, dest)
  const current = info?.version || null
  const pin = parseCorePin(info?.spec || '')
  const coreOwner = pin.owner || dest.owner
  const coreRepo = pin.repo || 'seo-core'

  let latest = null
  try {
    latest = await resolveLatestCore(octokit, coreOwner, coreRepo)
  } catch {
    // Tag lookup failed (permissions / repo name) — surface current only.
    latest = null
  }

  const plan = planCoreUpdate({ current, latest: latest?.version || null })
  return {
    project: { owner: dest.owner, repo: dest.repo, branch: dest.targetBranch },
    core: { owner: coreOwner, repo: coreRepo },
    current,
    latest: latest?.version || null,
    latestTag: latest?.name || null,
    ...plan,
    compat: current ? classifyCoreCompat(current) : null,
  }
}

export async function applyUpdate(octokit, dest) {
  const status = await buildStatus(octokit, dest)

  if (!status.updateAvailable) {
    return { status: 200, body: { ok: false, step: 'apply', reason: 'up-to-date', ...status } }
  }
  // Server-side safety gate: only additive (green/minor) updates are one-click.
  // Breaking (major) updates require a per-project migration in Cursor first.
  if (!status.canOneClick) {
    return {
      status: 409,
      body: {
        ok: false,
        step: 'apply',
        code: 'migration_required',
        error: `seo-core v${status.latest} is a breaking (major) update from v${status.current}. Migrate this project in Cursor first, then adopt.`,
        ...status,
      },
    }
  }

  const pkg = await readCorePackage(octokit, dest)
  if (!pkg || !pkg.raw) {
    return { status: 400, body: { ok: false, step: 'apply', error: 'Could not locate the package.json that pins seo-core.', ...status } }
  }
  const bumped = bumpCorePin(pkg.raw, status.latest)
  if (!bumped.changed) {
    return { status: 200, body: { ok: false, step: 'apply', reason: 'no-change', ...status } }
  }

  // Pre-merge audit gate: the new package.json must be valid JSON and its pin
  // must now resolve to the target version. Refuse to merge a broken manifest.
  let verifyOk = false
  try {
    const parsed = JSON.parse(bumped.content)
    const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }
    const pin = parseCorePin(deps['seo-core'] || '')
    verifyOk = pin.version === status.latest
  } catch {
    verifyOk = false
  }
  if (!verifyOk) {
    return {
      status: 422,
      body: { ok: false, step: 'apply', code: 'audit_failed', error: 'Bumped package.json failed validation; not merging.', ...status },
    }
  }

  const committed = await commitFiles(
    octokit,
    dest,
    [{ path: pkg.path, content: bumped.content, slug: pkg.path }],
    { message: `Update seo-core to v${status.latest}`, branchName: `core-update/v${status.latest}` }
  )
  const merge = await mergeBranch(
    octokit,
    dest,
    committed.branchName,
    `Update seo-core to v${status.latest}`
  )

  return {
    status: 200,
    body: {
      ok: true,
      step: 'apply',
      branch: committed.branchName,
      mergeCommitSha: merge?.sha || committed.newCommit.sha,
      updatedTo: status.latest,
      previous: status.current,
      ...status,
    },
  }
}

export async function handleCoreVersion(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.end()
  }
  if (req.method !== 'POST') {
    return json(res, 405, { error: 'Method not allowed' })
  }

  try {
    await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }

  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  const dest = readDestination(body)
  if (dest.error) {
    return json(res, dest.status, { error: dest.error })
  }

  const step = String(body.step || 'status').trim().toLowerCase()
  if (step !== 'status' && step !== 'apply') {
    return json(res, 400, { error: 'step must be "status" or "apply"' })
  }

  const octokit = createOctokit(dest)
  try {
    if (step === 'status') {
      const status = await buildStatus(octokit, dest)
      return json(res, 200, { ok: true, step: 'status', ...status })
    }
    const result = await applyUpdate(octokit, dest)
    return json(res, result.status, result.body)
  } catch (err) {
    console.error('core-version error:', err)
    return json(res, err.statusCode || 502, { ok: false, error: githubErrorMessage(err) })
  }
}
