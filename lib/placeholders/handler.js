// POST /api/site-placeholders — live placeholder status of a company's site.
//
// Reads the site straight from its Publish Destination repo (target branch),
// runs the placeholder manifest from seo-core's latest tag against it, and
// returns one status per item. Read-only: nothing is written to the repo.
// The browser stores the result (site_placeholder_scans) with the sign-offs.

import { readFile } from 'node:fs/promises'
import { requireAuth } from '../seo-advisor/auth.js'
import { createOctokit, githubErrorMessage, readDestination } from '../wire-internal-links/github.js'
import { readCorePackage } from '../contract/projectContract.js'
import { parseCorePin, pickLatestTag } from '../core-version/plan.js'
import { checkPlaceholders } from './check.js'

const MANIFEST_PATH = 'src/placeholders/blueprint.json'
const FETCH_CONCURRENCY = 8
const MAX_BLOB_BYTES = 5 * 1024 * 1024

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

export function isManifest(value) {
  return Boolean(value && value.version === 1 && Array.isArray(value.checks) && value.checks.every((c) => c && c.id && c.kind))
}

async function bundledManifest() {
  const raw = await readFile(new URL('./blueprint.json', import.meta.url), 'utf8')
  return JSON.parse(raw)
}

/**
 * The manifest from seo-core's latest tag (one list for every site, whatever
 * version it pins), else the copy bundled with TNV.
 * @returns {Promise<{ manifest: object, source: string }>}
 */
export async function loadManifest(octokit, { owner, repo }) {
  try {
    const { data: tags } = await octokit.repos.listTags({ owner, repo, per_page: 100 })
    const latest = pickLatestTag(tags)
    if (latest) {
      const { data } = await octokit.repos.getContent({ owner, repo, path: MANIFEST_PATH, ref: latest.name })
      const raw = Buffer.from(String(data?.content || '').replace(/\n/g, ''), 'base64').toString('utf8')
      const manifest = JSON.parse(raw)
      if (isManifest(manifest)) return { manifest, source: `${repo} ${latest.name}` }
    }
  } catch {
    // Tag without the manifest (pre-1.3.0), no access, or offline: fall back.
  }
  return { manifest: await bundledManifest(), source: 'bundled with TNV' }
}

async function mapPool(items, limit, fn) {
  let i = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++
      await fn(items[idx], idx)
    }
  })
  await Promise.all(workers)
}

/**
 * A SiteFiles reader over one GitHub tree, rooted at the site folder.
 * `tree` = entries from git.getTree(recursive) for the whole repo.
 */
export function githubSiteFiles(octokit, dest, tree, siteRoot) {
  const prefix = siteRoot ? `${siteRoot.replace(/\/+$/, '')}/` : ''
  const blobs = new Map()
  for (const entry of tree) {
    if (entry.type !== 'blob' || !entry.path.startsWith(prefix)) continue
    blobs.set(entry.path.slice(prefix.length), { sha: entry.sha, size: entry.size ?? 0 })
  }
  const cache = new Map()

  const fetchBlob = (path) => {
    const blob = blobs.get(path)
    if (!blob) return Promise.resolve(null)
    if (blob.size > MAX_BLOB_BYTES) return Promise.resolve(null)
    if (!cache.has(path)) {
      cache.set(
        path,
        octokit.git
          .getBlob({ owner: dest.owner, repo: dest.repo, file_sha: blob.sha })
          .then(({ data }) => Buffer.from(String(data?.content || '').replace(/\n/g, ''), data?.encoding === 'utf-8' ? 'utf8' : 'base64'))
      )
    }
    return cache.get(path)
  }

  return {
    list: () => [...blobs.keys()],
    read: (path) => fetchBlob(path),
    prefetch: (paths) => mapPool(paths, FETCH_CONCURRENCY, (p) => fetchBlob(p)),
  }
}

function siteRootOf(pkgPath, tree) {
  const path = String(pkgPath || '')
  if (path.includes('/')) return path.slice(0, path.lastIndexOf('/'))
  if (path) return ''
  // No seo-core pin found: the blueprint convention is site/.
  return tree.some((e) => e.path === 'site/package.json') ? 'site' : ''
}

/** Scan one destination. Exported for tests (pass a fake octokit). */
export async function scanSitePlaceholders(octokit, dest) {
  const { data: branch } = await octokit.repos.getBranch({ owner: dest.owner, repo: dest.repo, branch: dest.targetBranch })
  const commitSha = branch?.commit?.sha
  const treeSha = branch?.commit?.commit?.tree?.sha || commitSha
  const { data: treeData } = await octokit.git.getTree({ owner: dest.owner, repo: dest.repo, tree_sha: treeSha, recursive: 'true' })
  const tree = Array.isArray(treeData?.tree) ? treeData.tree : []

  let pkg = null
  try {
    pkg = await readCorePackage(octokit, dest)
  } catch {
    pkg = null
  }
  const siteRoot = siteRootOf(pkg?.path, tree)
  const pin = parseCorePin(pkg?.dep?.spec || '')
  const { manifest, source } = await loadManifest(octokit, {
    owner: pin.owner || dest.owner,
    repo: pin.repo || 'seo-core',
  })

  const report = await checkPlaceholders(githubSiteFiles(octokit, dest, tree, siteRoot), manifest)
  return {
    project: { owner: dest.owner, repo: dest.repo, branch: dest.targetBranch },
    commitSha: commitSha || null,
    siteRoot,
    coreVersion: pkg?.dep?.version || null,
    manifestSource: source,
    treeTruncated: Boolean(treeData?.truncated),
    scannedAt: new Date().toISOString(),
    report,
  }
}

export async function handleSitePlaceholders(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
    return res.end()
  }
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

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
  if (dest.error) return json(res, dest.status, { error: dest.error })

  try {
    const result = await scanSitePlaceholders(createOctokit(dest), dest)
    return json(res, 200, { ok: true, ...result })
  } catch (err) {
    console.error('site-placeholders error:', err)
    return json(res, err.statusCode || err.status || 502, { ok: false, error: githubErrorMessage(err) })
  }
}
