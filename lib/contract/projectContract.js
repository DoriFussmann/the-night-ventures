// Runtime guard: before a TNV tool touches a project repo, verify the project's
// pinned seo-core version is one TNV can safely operate against (DL-8). Reads
// package.json from the target branch over the GitHub API and classifies it.

import { classifyCoreCompat, extractCoreVersion } from './coreContract.js'

export class ContractError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'ContractError'
    this.statusCode = 409
    this.code = 'incompatible_core_version'
    this.details = details
  }
}

// Fetch one JSON file from the target branch. Returns { path, raw, sha } or
// null when the file doesn't exist (404). Re-throws other errors.
// Files over 1 MB come back from the contents API without inline content, so
// those are read through the git blob API instead (lockfiles can be large).
export async function fetchJsonFile(octokit, dest, path) {
  try {
    const { data } = await octokit.repos.getContent({
      owner: dest.owner,
      repo: dest.repo,
      path,
      ref: dest.targetBranch,
    })
    if (Array.isArray(data)) return null
    let content = data?.content
    if (!content && data?.sha && data?.type === 'file' && octokit.git?.getBlob) {
      const { data: blob } = await octokit.git.getBlob({
        owner: dest.owner,
        repo: dest.repo,
        file_sha: data.sha,
      })
      content = blob?.content
    }
    if (!content) return null
    const raw = Buffer.from(String(content).replace(/\n/g, ''), 'base64').toString('utf8')
    return { path, raw, sha: data.sha }
  } catch (err) {
    if (err?.status === 404 || err?.statusCode === 404) return null
    throw err
  }
}

// Locate the package.json that actually declares the seo-core dependency and
// return { path, raw, sha, dep } where dep = { spec, version }. Projects here
// are npm-workspaces monorepos: the Astro app (and its seo-core dep) lives in
// the `site/` workspace, not the repo root. So we look at the root first, then
// each declared workspace, then `site/` as a known-convention fallback.
export async function readCorePackage(octokit, dest) {
  const root = await fetchJsonFile(octokit, dest, 'package.json')

  // Fast path: seo-core pinned right in the root manifest.
  if (root) {
    try {
      const dep = extractCoreVersion(JSON.parse(root.raw))
      if (dep && dep.version) return { ...root, dep }
    } catch {
      throw new Error('root package.json is not valid JSON')
    }
  }

  // Derive workspace package.json paths from the root manifest (plain dirs
  // only; globbed workspaces like "packages/*" are skipped), plus `site/`.
  const wsPaths = new Set()
  if (root) {
    try {
      const pkg = JSON.parse(root.raw)
      const ws = Array.isArray(pkg.workspaces) ? pkg.workspaces : pkg.workspaces?.packages || []
      for (const w of ws) {
        if (typeof w === 'string' && !/[*?{}[\]]/.test(w)) {
          wsPaths.add(`${w.replace(/\/+$/, '')}/package.json`)
        }
      }
    } catch {
      /* handled above */
    }
  }
  wsPaths.add('site/package.json')

  const candidates = []
  for (const p of wsPaths) {
    const f = await fetchJsonFile(octokit, dest, p)
    if (f) candidates.push(f)
  }

  // Prefer a candidate with a real version; fall back to one that at least has
  // a seo-core entry (so an unpinned dep is reported rather than "not found").
  let firstWithDep = null
  for (const c of candidates) {
    let dep
    try {
      dep = extractCoreVersion(JSON.parse(c.raw))
    } catch {
      continue
    }
    if (dep && dep.version) return { ...c, dep }
    if (dep && !firstWithDep) firstWithDep = { ...c, dep }
  }
  if (firstWithDep) return firstWithDep
  if (root) {
    // Root existed but no seo-core anywhere — report the root spec (likely null).
    try {
      return { ...root, dep: extractCoreVersion(JSON.parse(root.raw)) }
    } catch {
      return null
    }
  }
  return null
}

// Back-compat wrapper: just the { spec, version } (or null). Used by the
// contract guard. Now workspace-aware via readCorePackage.
export async function getProjectCoreVersion(octokit, dest) {
  const pkg = await readCorePackage(octokit, dest)
  return pkg ? pkg.dep : null
}

// Throwing form (useful programmatically / for step 6). Returns
// { version, spec, compat } when the project is compatible; throws ContractError
// otherwise. A failure to read/parse package.json is itself a refusal: TNV will
// not run against a project whose core version it cannot verify.
export async function assertProjectContract(octokit, dest) {
  let info
  try {
    info = await getProjectCoreVersion(octokit, dest)
  } catch (err) {
    throw new ContractError(
      `Could not verify seo-core version for ${dest.owner}/${dest.repo}@${dest.targetBranch}: ${err.message}. TNV refuses to run against an unverifiable project.`,
      { severity: 'unknown' }
    )
  }
  if (!info || !info.version) {
    throw new ContractError(
      `No pinned seo-core version found in ${dest.owner}/${dest.repo}. TNV tools require a core-based project with a pinned seo-core dependency.`,
      { severity: 'unknown', spec: info?.spec || null }
    )
  }
  const compat = classifyCoreCompat(info.version)
  if (!compat.compatible) {
    throw new ContractError(compat.reason, {
      severity: compat.severity,
      version: compat.version,
      spec: info.spec,
      supported: compat.supported,
    })
  }
  return { version: info.version, spec: info.spec, compat }
}

// Non-throwing form for HTTP handlers. Returns either
//   { ok: true, version, spec, compat }                    (run the tool)
// or
//   { ok: false, status, body }                            (send this response)
// so handlers refuse with a structured 409 in two lines.
export async function checkProjectContract(octokit, dest) {
  try {
    const result = await assertProjectContract(octokit, dest)
    return { ok: true, ...result }
  } catch (err) {
    if (err instanceof ContractError) {
      return {
        ok: false,
        status: err.statusCode,
        body: {
          ok: false,
          error: err.message,
          code: err.code,
          contract: {
            detected: err.details?.version || null,
            spec: err.details?.spec || null,
            severity: err.details?.severity || 'unknown',
            supported: err.details?.supported || null,
          },
        },
      }
    }
    // Unexpected error reading the repo — surface as a bad-gateway refusal.
    return {
      ok: false,
      status: 502,
      body: { ok: false, error: `Contract check failed: ${err.message}`, code: 'contract_check_error' },
    }
  }
}
