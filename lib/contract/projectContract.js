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

// Fetch and parse the project's package.json from the target branch.
// Returns { spec, version } (version may be null) or throws on fetch/parse failure.
export async function getProjectCoreVersion(octokit, dest) {
  const { data } = await octokit.repos.getContent({
    owner: dest.owner,
    repo: dest.repo,
    path: 'package.json',
    ref: dest.targetBranch,
  })
  if (Array.isArray(data) || !data?.content) {
    throw new Error('package.json not found at repository root')
  }
  const raw = Buffer.from(String(data.content).replace(/\n/g, ''), 'base64').toString('utf8')
  let pkg
  try {
    pkg = JSON.parse(raw)
  } catch {
    throw new Error('package.json is not valid JSON')
  }
  return extractCoreVersion(pkg)
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
