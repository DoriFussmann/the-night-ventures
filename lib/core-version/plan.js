// seo-core version update planning (build step 6).
//
// Pure logic for the version panel: what version is a project on, what's the
// latest seo-core tag, is an update available, and is it safe to apply with one
// click. Per DL-3: additive = minor bump (safe, one-click green), breaking =
// major bump (amber "migration required", must be done per-project in Cursor
// first). This module has no I/O so it is fully unit-testable.

import { compareSemver, parseSemver } from '../contract/coreContract.js'

// Parse a seo-core dependency pin into its parts.
// Handles: github:Owner/seo-core#v0.3.0 | Owner/seo-core#0.3.0 |
// github:Owner/seo-core#semver:^0.3.0 | ^0.3.0 (npm range, owner/repo unknown).
export function parseCorePin(spec) {
  const raw = String(spec || '')
  const hashIdx = raw.indexOf('#')
  const frag = hashIdx >= 0 ? raw.slice(hashIdx + 1).replace(/^semver:/i, '') : raw
  const vMatch = frag.match(/(\d+\.\d+\.\d+)/)
  const version = vMatch ? vMatch[1] : null

  let owner = null
  let repo = null
  const path = (hashIdx >= 0 ? raw.slice(0, hashIdx) : raw).replace(/^github:/i, '')
  const orMatch = path.match(/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+?)(?:\.git)?$/)
  if (orMatch) {
    owner = orMatch[1]
    repo = orMatch[2]
  }
  return { spec: raw, owner, repo, version }
}

// Given the repo's tag list ([{name}] from the GitHub API), return the highest
// semver tag as { name, version }, or null if none parse.
export function pickLatestTag(tags) {
  const list = Array.isArray(tags) ? tags : []
  let best = null
  for (const t of list) {
    const name = typeof t === 'string' ? t : t?.name
    if (!parseSemver(name)) continue
    if (!best || compareSemver(name, best.name) > 0) {
      best = {
        name: String(name),
        version: parseSemver(name) ? String(name).replace(/^v/i, '') : null,
        sha: (typeof t === 'object' && t?.commit?.sha) || null,
      }
    }
  }
  return best
}

// Replace the version in a seo-core dependency VALUE, preserving owner/repo and
// the github: / semver form. Surgical — does not touch anything else.
function bumpSpecVersion(spec, newVersion) {
  const v = String(newVersion || '').replace(/^v/i, '')
  const raw = String(spec || '')
  if (raw.includes('#')) {
    return `${raw.slice(0, raw.indexOf('#'))}#v${v}`
  }
  const op = (raw.match(/^[~^]?/) || [''])[0]
  return `${op}${v}`
}

// Surgically bump the seo-core pin inside raw package.json text. Returns
// { content, changed }. Preserves formatting; only the version token changes.
export function bumpCorePin(pkgRaw, newVersion) {
  const src = String(pkgRaw || '')
  const re = /("seo-core"\s*:\s*")([^"]*)(")/
  const m = src.match(re)
  if (!m) return { content: src, changed: false }
  const nextVal = bumpSpecVersion(m[2], newVersion)
  if (nextVal === m[2]) return { content: src, changed: false }
  const content = src.replace(re, `$1${nextVal}$3`)
  return { content, changed: content !== src }
}

// Decide update availability + safety from current vs latest version strings.
// Returns { updateAvailable, kind, severity, canOneClick, current, latest }.
//   kind:     'none' | 'minor' | 'major'
//   severity: 'none' | 'green' | 'amber'
//   canOneClick: true only for a green (minor/patch) update.
export function planCoreUpdate({ current, latest }) {
  const cur = parseSemver(current)
  const lat = parseSemver(latest)
  const base = { current: current || null, latest: latest || null }
  if (!lat || !cur) {
    return { ...base, updateAvailable: false, kind: 'none', severity: 'none', canOneClick: false }
  }
  if (compareSemver(latest, current) <= 0) {
    return { ...base, updateAvailable: false, kind: 'none', severity: 'none', canOneClick: false }
  }
  const isMajor = lat.major > cur.major
  return {
    ...base,
    updateAvailable: true,
    kind: isMajor ? 'major' : 'minor',
    severity: isMajor ? 'amber' : 'green',
    canOneClick: !isMajor,
  }
}

// --- lockfile ----------------------------------------------------------------
//
// seo-core is installed from a GitHub tag. For git dependencies npm keeps
// installing the commit recorded in package-lock.json even after package.json
// asks for a newer tag, and it does so silently. Bumping package.json alone
// therefore changes nothing on the live site. These helpers read the version
// that is actually installed and move the lockfile in the same commit.

const LOCK_NODE = 'node_modules/seo-core'

// Installed seo-core per package-lock.json: { version, resolved } or null when
// the lockfile has no seo-core entry (or is not valid JSON).
export function readLockedCore(lockRaw) {
  try {
    const lock = JSON.parse(String(lockRaw || ''))
    const node = lock?.packages?.[LOCK_NODE]
    if (!node || !node.version) return null
    return { version: String(node.version), resolved: String(node.resolved || '') }
  } catch {
    return null
  }
}

// Surgically point the lockfile at a new seo-core tag. Edits only:
//   - the "node_modules/seo-core" entry's "version" and the commit after '#'
//     in its "resolved" URL;
//   - every declared "seo-core" spec in workspace entries (e.g. "#v0.8.1").
// Preserves formatting. Returns { content, changed, error }.
export function bumpCoreLock(lockRaw, { version, sha }) {
  const src = String(lockRaw || '')
  const v = String(version || '').replace(/^v/i, '')
  const commit = String(sha || '').trim()
  if (!parseSemver(v)) return { content: src, changed: false, error: 'invalid version' }
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) {
    return { content: src, changed: false, error: 'missing tag commit sha' }
  }

  const head = src.indexOf(`"${LOCK_NODE}": {`)
  if (head === -1) return { content: src, changed: false, error: 'no seo-core entry in lockfile' }
  const end = src.indexOf('\n    }', head)
  if (end === -1) return { content: src, changed: false, error: 'unrecognized lockfile layout' }

  let block = src.slice(head, end)
  const versionRe = /("version"\s*:\s*")[^"]*(")/
  const resolvedRe = /("resolved"\s*:\s*"[^"#]*#)[0-9a-f]+(")/i
  if (!versionRe.test(block) || !resolvedRe.test(block)) {
    return { content: src, changed: false, error: 'seo-core lock entry is not a git install' }
  }
  block = block.replace(versionRe, `$1${v}$2`).replace(resolvedRe, `$1${commit}$2`)

  let content = src.slice(0, head) + block + src.slice(end)
  content = content.replace(/("seo-core"\s*:\s*")([^"]*)(")/g, (m, a, spec, z) =>
    spec.includes('#') || /^[~^]?\d/.test(spec) ? `${a}${bumpSpecVersion(spec, v)}${z}` : m
  )
  return { content, changed: content !== src, error: null }
}
