import { requireAuth } from '../seo-advisor/auth.js'
import {
  commitFiles,
  createOctokit,
  githubErrorMessage,
  readDestination,
} from '../wire-internal-links/github.js'
import { fetchJsonFile, readCorePackage } from '../contract/projectContract.js'
import { classifyCoreCompat } from '../contract/coreContract.js'
import {
  bumpCoreLock,
  bumpCorePin,
  evaluateChecks,
  parseCorePin,
  pickLatestTag,
  planCoreUpdate,
  readLockedCore,
} from './plan.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

// The project's lockfile: root package-lock.json (npm workspaces keep one lock
// at the root), else one next to the package.json that pins seo-core.
async function readProjectLock(octokit, dest, pkgPath) {
  const root = await fetchJsonFile(octokit, dest, 'package-lock.json')
  if (root) return root
  const dir = String(pkgPath || '').includes('/') ? pkgPath.slice(0, pkgPath.lastIndexOf('/')) : ''
  return dir ? fetchJsonFile(octokit, dest, `${dir}/package-lock.json`) : null
}

// Resolve the latest seo-core tag for the repo named in the project's pin,
// using the same token (same owner). Returns { name, version, sha } or null.
async function resolveLatestCore(octokit, coreOwner, coreRepo) {
  const { data } = await octokit.repos.listTags({
    owner: coreOwner,
    repo: coreRepo,
    per_page: 100,
  })
  return pickLatestTag(data)
}


// How long one Apply click waits for the preview build before handing back.
// The function may run 300 s; leave headroom for the GitHub calls around it.
const PREVIEW_WAIT_MS = 240_000
const PREVIEW_POLL_MS = 10_000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function updateBranchName(version) {
  return `core-update/v${version}`
}

async function findOpenUpdatePr(octokit, dest, branchName) {
  const { data } = await octokit.pulls.list({
    owner: dest.owner,
    repo: dest.repo,
    state: 'open',
    base: dest.targetBranch,
    head: `${dest.owner}:${branchName}`,
    per_page: 5,
  })
  return (data || [])[0] || null
}

async function deleteBranchQuietly(octokit, dest, branchName) {
  try {
    await octokit.git.deleteRef({ owner: dest.owner, repo: dest.repo, ref: `heads/${branchName}` })
  } catch {
    // not there, or already gone
  }
}

async function readChecks(octokit, dest, sha) {
  const [{ data: combined }, { data: checks }] = await Promise.all([
    octokit.repos.getCombinedStatusForRef({ owner: dest.owner, repo: dest.repo, ref: sha, per_page: 100 }),
    octokit.checks
      .listForRef({ owner: dest.owner, repo: dest.repo, ref: sha, per_page: 100 })
      .catch(() => ({ data: { check_runs: [] } })),
  ])
  return evaluateChecks({ statuses: combined?.statuses || [], checkRuns: checks?.check_runs || [] })
}

/** Poll the update branch's checks until they settle or the wait runs out. */
export async function waitForPreview(octokit, dest, sha, { timeoutMs = PREVIEW_WAIT_MS, pollMs = PREVIEW_POLL_MS } = {}) {
  const deadline = Date.now() + timeoutMs
  let verdict = await readChecks(octokit, dest, sha)
  while (verdict.state === 'pending' && Date.now() + pollMs < deadline) {
    await sleep(pollMs)
    verdict = await readChecks(octokit, dest, sha)
  }
  return verdict
}

export async function buildStatus(octokit, dest) {
  const pkg = await readCorePackage(octokit, dest)
  const info = pkg ? pkg.dep : null
  const declared = info?.version || null
  // What the site really builds with is the lockfile's version; package.json
  // alone can claim a newer one without ever installing it.
  const lockFile = await readProjectLock(octokit, dest, pkg?.path)
  const locked = lockFile ? readLockedCore(lockFile.raw)?.version || null : null
  const current = locked || declared
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
    declared,
    locked,
    lockMismatch: Boolean(locked && declared && locked !== declared),
    latest: latest?.version || null,
    latestTag: latest?.name || null,
    latestSha: latest?.sha || null,
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

  const branchName = updateBranchName(status.latest)

  // Resume: an earlier click (or an older TNV) may have opened the update PR
  // already. Finish that one instead of committing the bump a second time.
  let pr = await findOpenUpdatePr(octokit, dest, branchName)

  if (!pr) {
    const pkg = await readCorePackage(octokit, dest)
    if (!pkg || !pkg.raw) {
      return { status: 400, body: { ok: false, step: 'apply', error: 'Could not locate the package.json that pins seo-core.', ...status } }
    }
    const bumped = bumpCorePin(pkg.raw, status.latest)

    // Move the lockfile in the same commit, or the site keeps the old version.
    const lockFile = await readProjectLock(octokit, dest, pkg.path)
    let lockBump = null
    if (lockFile && readLockedCore(lockFile.raw)) {
      lockBump = bumpCoreLock(lockFile.raw, { version: status.latest, sha: status.latestSha })
      if (lockBump.error) {
        return {
          status: 422,
          body: {
            ok: false,
            step: 'apply',
            code: 'lockfile_update_failed',
            error: `Could not update ${lockFile.path} (${lockBump.error}); not merging, because package.json alone would not change the installed version.`,
            ...status,
          },
        }
      }
    }

    if (!bumped.changed && !lockBump?.changed) {
      return { status: 200, body: { ok: false, step: 'apply', reason: 'no-change', ...status } }
    }

    // Pre-merge gate: the new package.json must be valid JSON and its pin
    // must now resolve to the target version. Refuse to ship a broken manifest.
    let verifyOk = false
    try {
      const parsed = JSON.parse(bumped.content)
      const deps = { ...(parsed.dependencies || {}), ...(parsed.devDependencies || {}) }
      const pin = parseCorePin(deps['seo-core'] || '')
      verifyOk = pin.version === status.latest
    } catch {
      verifyOk = false
    }
    if (verifyOk && lockBump?.changed) {
      const lockedAfter = readLockedCore(lockBump.content)
      verifyOk =
        lockedAfter?.version === status.latest &&
        lockedAfter.resolved.endsWith(`#${status.latestSha}`)
    }
    if (!verifyOk) {
      return {
        status: 422,
        body: { ok: false, step: 'apply', code: 'audit_failed', error: 'Bumped package.json or lockfile failed validation; not merging.', ...status },
      }
    }

    const files = []
    if (bumped.changed) files.push({ path: pkg.path, content: bumped.content, slug: pkg.path })
    if (lockBump?.changed) files.push({ path: lockFile.path, content: lockBump.content, slug: lockFile.path })

    // A leftover branch with no open PR (closed by hand, or a crashed run)
    // would block createRef: start it fresh from the live branch.
    await deleteBranchQuietly(octokit, dest, branchName)
    await commitFiles(octokit, dest, files, { message: `Update seo-core to v${status.latest}`, branchName })
    const { data: created } = await octokit.pulls.create({
      owner: dest.owner,
      repo: dest.repo,
      head: branchName,
      base: dest.targetBranch,
      title: `Update seo-core to v${status.latest}`,
      body: `Bumps seo-core from v${status.current} to v${status.latest}. TNV merges this once the site's preview build passes.`,
    })
    pr = created
  }

  // Preview gate: merge only when the site's own preview build is green.
  const verdict = await waitForPreview(octokit, dest, pr.head.sha)
  const base = {
    step: 'apply',
    branch: branchName,
    pullRequestUrl: pr.html_url || null,
    updatedTo: status.latest,
    previous: status.current,
    ...status,
  }

  if (verdict.state === 'failure') {
    return {
      status: 200,
      body: {
        ...base,
        ok: false,
        merged: false,
        code: 'preview_failed',
        failedChecks: verdict.failed,
        error: `The preview build failed (${verdict.failed.join(', ')}), so v${status.latest} was not merged. The live site is unchanged. Details: ${pr.html_url}`,
      },
    }
  }
  if (verdict.state !== 'success') {
    return {
      status: 200,
      body: {
        ...base,
        ok: false,
        merged: false,
        code: 'preview_pending',
        error: `The preview build is still running. Click Apply again in a minute to finish the update. Nothing is live yet.`,
      },
    }
  }

  const { data: merge } = await octokit.pulls.merge({
    owner: dest.owner,
    repo: dest.repo,
    pull_number: pr.number,
    merge_method: 'squash',
    commit_title: `Update seo-core to v${status.latest} (#${pr.number})`,
  })
  await deleteBranchQuietly(octokit, dest, branchName)

  return {
    status: 200,
    body: {
      ...base,
      ok: true,
      merged: true,
      mergeCommitSha: merge?.sha || null,
      mergeStrategy: 'pr-merged-after-preview',
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
