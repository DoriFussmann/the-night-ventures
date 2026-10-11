// seo-core contract compatibility (DL-8).
//
// TNV writes article content into project repos that consume `seo-core` as a
// pinned git-tag dependency. A project can be pinned to a different core version
// than the one TNV was built and tested against. Per DL-3 the compatibility
// axis is the MAJOR version: additive changes are minor bumps (safe to read),
// breaking changes are major bumps (require per-project migration). If a project
// jumps to a breaking core before TNV is updated, TNV must REFUSE to run rather
// than silently mis-parse or mis-write against a schema it doesn't understand.
//
// This module is the single source of truth for what TNV supports. Bump these
// constants when TNV is validated against a new core.

// Highest core MAJOR TNV understands. All projects are currently in the 0.x
// line, where minors are additive by DL-3, so any 0.x is read-compatible.
export const SUPPORTED_CORE_MAJOR = 0

// Oldest core still expected in the fleet. Below this, refuse (project should
// be migrated forward).
export const MIN_SUPPORTED_CORE = '0.1.0'

// Highest core TNV has actually been tested against. Versions above this within
// the supported major are allowed (additive-only) but flagged so step 6's
// version panel can surface "TNV not yet verified against vX".
export const MAX_VERIFIED_CORE = '0.9.0'

// --- semver (small, dependency-free; tags are clean X.Y.Z) --------------------

export function parseSemver(input) {
  const raw = String(input == null ? '' : input).trim().replace(/^v/i, '')
  const m = raw.match(/^(\d+)\.(\d+)\.(\d+)/)
  if (!m) return null
  return { major: Number(m[1]), minor: Number(m[2]), patch: Number(m[3]) }
}

// -1 if a<b, 0 if equal, 1 if a>b. Non-parseable sorts as lowest.
export function compareSemver(a, b) {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa && !pb) return 0
  if (!pa) return -1
  if (!pb) return 1
  if (pa.major !== pb.major) return pa.major < pb.major ? -1 : 1
  if (pa.minor !== pb.minor) return pa.minor < pb.minor ? -1 : 1
  if (pa.patch !== pb.patch) return pa.patch < pb.patch ? -1 : 1
  return 0
}

// --- pin extraction -----------------------------------------------------------

// Pull the pinned seo-core version out of a parsed package.json. Handles the
// git-tag pin (`github:Owner/seo-core#v0.3.0`, `Owner/seo-core#0.3.0`,
// `...#semver:^0.3.0`) and a plain npm range (`^0.3.0`) if the package is ever
// published. Returns { spec, version } where version is a clean X.Y.Z, or null
// when no seo-core dependency (or no determinable version) is found.
export function extractCoreVersion(pkgJson) {
  if (!pkgJson || typeof pkgJson !== 'object') return null
  const buckets = [pkgJson.dependencies, pkgJson.devDependencies, pkgJson.optionalDependencies]
  let spec = null
  for (const deps of buckets) {
    if (!deps || typeof deps !== 'object') continue
    for (const [name, value] of Object.entries(deps)) {
      const val = String(value || '')
      if (name === 'seo-core' || /[/:]seo-core(?:#|$|\.git)/.test(val) || val.includes('seo-core#')) {
        spec = val
        break
      }
    }
    if (spec) break
  }
  if (!spec) return null

  // Prefer the fragment after '#', dropping an optional `semver:` prefix.
  const hashIdx = spec.indexOf('#')
  const candidate = hashIdx >= 0 ? spec.slice(hashIdx + 1).replace(/^semver:/i, '') : spec
  const m = candidate.match(/(\d+\.\d+\.\d+)/)
  return { spec, version: m ? m[1] : null }
}

// --- classification -----------------------------------------------------------

export const SUPPORTED_SUMMARY = {
  major: SUPPORTED_CORE_MAJOR,
  min: MIN_SUPPORTED_CORE,
  maxVerified: MAX_VERIFIED_CORE,
}

// Decide whether TNV may operate on a project pinned to `version`.
// Returns { compatible, severity, reason, version, supported }.
//   severity: 'ok' | 'minor_ahead' | 'major_ahead' | 'behind' | 'unknown'
// Only `compatible:false` blocks execution. 'minor_ahead' runs but is flagged.
export function classifyCoreCompat(version) {
  const supported = SUPPORTED_SUMMARY
  const parsed = parseSemver(version)
  if (!parsed) {
    return {
      compatible: false,
      severity: 'unknown',
      reason: `Could not determine the project's seo-core version${version ? ` (got "${version}")` : ''}. TNV refuses to run against an unverifiable core.`,
      version: version || null,
      supported,
    }
  }
  if (parsed.major > SUPPORTED_CORE_MAJOR) {
    return {
      compatible: false,
      severity: 'major_ahead',
      reason: `Project is on seo-core v${version}, a breaking (major) version ahead of what TNV supports (major ${SUPPORTED_CORE_MAJOR}, verified through v${MAX_VERIFIED_CORE}). Migration required — update TNV before running tools against this project.`,
      version,
      supported,
    }
  }
  if (parsed.major < SUPPORTED_CORE_MAJOR) {
    return {
      compatible: false,
      severity: 'behind',
      reason: `Project is on seo-core v${version}, below TNV's supported major ${SUPPORTED_CORE_MAJOR}. Migrate the project forward before running TNV tools.`,
      version,
      supported,
    }
  }
  // Same major. Additive minors are read-compatible.
  if (compareSemver(version, MIN_SUPPORTED_CORE) < 0) {
    return {
      compatible: false,
      severity: 'behind',
      reason: `Project is on seo-core v${version}, older than TNV's minimum supported v${MIN_SUPPORTED_CORE}. Migrate the project forward.`,
      version,
      supported,
    }
  }
  if (compareSemver(version, MAX_VERIFIED_CORE) > 0) {
    return {
      compatible: true,
      severity: 'minor_ahead',
      reason: `Project is on seo-core v${version}, newer than the version TNV has been verified against (v${MAX_VERIFIED_CORE}). Additive-only, so tools will run, but consider updating TNV's verified baseline.`,
      version,
      supported,
    }
  }
  return { compatible: true, severity: 'ok', reason: `seo-core v${version} is supported.`, version, supported }
}
