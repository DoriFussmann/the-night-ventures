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
      best = { name: String(name), version: parseSemver(name) ? String(name).replace(/^v/i, '') : null }
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
