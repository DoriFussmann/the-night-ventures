import { Octokit } from '@octokit/rest'
import { requireAuth } from '../seo-advisor/auth.js'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}

const ARTICLE_CONTENT_DIR = 'site/src/content/articles'
const ARTICLE_ASSETS_DIR = 'site/src/assets/articles'

// Treat main as unprotected and merge via API.
// One-line switch: set to false to open a PR and stop (no merge).
const MERGE_VIA_API = true

const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+$/
const TOKEN_KEY_RE = /^[A-Z][A-Z0-9_]*$/
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function githubErrorMessage(err) {
  const fromResponse = err?.response?.data?.message
  if (fromResponse) return String(fromResponse)
  if (err?.message) return String(err.message)
  return String(err)
}

function publishBranchName(now = new Date()) {
  const y = now.getUTCFullYear()
  const m = String(now.getUTCMonth() + 1).padStart(2, '0')
  const d = String(now.getUTCDate()).padStart(2, '0')
  const hh = String(now.getUTCHours()).padStart(2, '0')
  const mm = String(now.getUTCMinutes()).padStart(2, '0')
  return `publish/${y}-${m}-${d}-${hh}${mm}`
}

function stripDataUrl(b64) {
  const raw = String(b64 || '').trim()
  const comma = raw.indexOf(',')
  if (raw.startsWith('data:') && comma !== -1) return raw.slice(comma + 1)
  return raw.replace(/\s+/g, '')
}

function basenameOnly(name) {
  return String(name || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .pop()
}

function parseSlugFilename(name, kind) {
  const base = basenameOnly(name)
  const re =
    kind === 'md'
      ? /^([a-z0-9]+(?:-[a-z0-9]+)*)\.md$/i
      : /^([a-z0-9]+(?:-[a-z0-9]+)*)\.(png|jpe?g|webp|gif)$/i
  const match = base.match(re)
  if (!match) return null
  const slug = match[1].toLowerCase()
  if (!SLUG_RE.test(slug)) return null
  if (kind === 'md') return { slug, filename: `${slug}.md` }
  const ext = match[2].toLowerCase() === 'jpeg' ? 'jpg' : match[2].toLowerCase()
  return { slug, ext, filename: `${slug}.${ext}` }
}

async function pathExists(octokit, { owner, repo, path, ref }) {
  try {
    await octokit.repos.getContent({ owner, repo, path, ref })
    return true
  } catch (err) {
    if (err?.status === 404) return false
    throw err
  }
}

export async function handlePublishToSite(req, res) {
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
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
  }

  let branchName = null
  let body
  try {
    body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
  } catch {
    return json(res, 400, { error: 'Invalid JSON body' })
  }

  try {
    const owner = String(body.owner || '').trim()
    const repo = String(body.repo || '').trim()
    const tokenKey = String(body.tokenKey || body.github_token_key || '')
      .trim()
      .toUpperCase()
    const targetBranch = String(body.branch || 'main').trim() || 'main'
    const articles = Array.isArray(body.articles) ? body.articles : []

    if (!owner || !repo || !tokenKey) {
      return json(res, 400, {
        error: 'owner, repo, and tokenKey are required',
      })
    }
    if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
      return json(res, 400, { error: 'owner or repo is invalid' })
    }
    if (!TOKEN_KEY_RE.test(tokenKey)) {
      return json(res, 400, {
        error:
          'tokenKey is invalid (use A–Z, 0–9, underscore; e.g. HEYRUPERT)',
      })
    }
    if (articles.length === 0) {
      return json(res, 400, { error: 'articles is required' })
    }

    const token = process.env[`GITHUB_TOKEN_${tokenKey}`]
    if (!token) {
      console.error(`Missing GITHUB_TOKEN_${tokenKey}`)
      return json(res, 500, {
        error: `GITHUB_TOKEN_${tokenKey} is not set`,
      })
    }

    const octokit = new Octokit({ auth: token })
    const skipped = []
    const errors = []
    const toCommit = []

    for (const item of articles) {
      const mdParsed = parseSlugFilename(item?.filename, 'md')
      if (!mdParsed) {
        errors.push({
          filename: String(item?.filename || ''),
          message: 'Invalid markdown filename (expected {slug}.md)',
        })
        continue
      }

      const content = String(item?.content || '')
      if (!content.trim()) {
        skipped.push({
          filename: mdParsed.filename,
          reason: 'missing_body',
          message: 'No article content — skipped',
        })
        continue
      }

      const imgParsed = parseSlugFilename(item?.image?.filename, 'image')
      const imageBase64 = stripDataUrl(
        item?.image?.contentBase64 || item?.image?.b64_json
      )
      if (!imgParsed || imgParsed.slug !== mdParsed.slug || !imageBase64) {
        skipped.push({
          filename: mdParsed.filename,
          reason: 'missing_hero',
          message: 'No hero image — skipped (schema requires image)',
        })
        continue
      }

      const mdPath = `${ARTICLE_CONTENT_DIR}/${mdParsed.filename}`
      const imagePath = `${ARTICLE_ASSETS_DIR}/${imgParsed.filename}`

      try {
        const mdExists = await pathExists(octokit, {
          owner,
          repo,
          path: mdPath,
          ref: targetBranch,
        })
        if (mdExists) {
          skipped.push({
            filename: mdParsed.filename,
            reason: 'already_exists',
            message: `${mdPath} already exists on ${targetBranch} — not overwritten`,
          })
          continue
        }
      } catch (err) {
        errors.push({
          filename: mdParsed.filename,
          message: `Failed checking existing files: ${githubErrorMessage(err)}`,
        })
        continue
      }

      toCommit.push({
        slug: mdParsed.slug,
        mdPath,
        imagePath,
        markdown: content,
        imageBase64,
      })
    }

    if (toCommit.length === 0) {
      return json(res, 200, {
        ok: false,
        branch: null,
        mergeCommitSha: null,
        mergeStrategy: MERGE_VIA_API ? 'merge' : 'open-pr',
        committed: [],
        skipped,
        errors: errors.length
          ? errors
          : [{ message: 'No articles left to publish after skip checks.' }],
      })
    }

    const { data: baseRef } = await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${targetBranch}`,
    })
    const baseSha = baseRef.object.sha
    const { data: baseCommit } = await octokit.git.getCommit({
      owner,
      repo,
      commit_sha: baseSha,
    })

    branchName = publishBranchName()
    await octokit.git.createRef({
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha: baseSha,
    })

    const treeItems = []
    for (const file of toCommit) {
      const { data: mdBlob } = await octokit.git.createBlob({
        owner,
        repo,
        content: file.markdown,
        encoding: 'utf-8',
      })
      treeItems.push({
        path: file.mdPath,
        mode: '100644',
        type: 'blob',
        sha: mdBlob.sha,
      })

      const { data: imageBlob } = await octokit.git.createBlob({
        owner,
        repo,
        content: file.imageBase64,
        encoding: 'base64',
      })
      treeItems.push({
        path: file.imagePath,
        mode: '100644',
        type: 'blob',
        sha: imageBlob.sha,
      })
    }

    const { data: newTree } = await octokit.git.createTree({
      owner,
      repo,
      base_tree: baseCommit.tree.sha,
      tree: treeItems,
    })

    const slugs = toCommit.map((f) => f.slug).join(', ')
    const { data: newCommit } = await octokit.git.createCommit({
      owner,
      repo,
      message: `Publish articles: ${slugs}`,
      tree: newTree.sha,
      parents: [baseSha],
    })

    await octokit.git.updateRef({
      owner,
      repo,
      ref: `heads/${branchName}`,
      sha: newCommit.sha,
    })

    const committed = toCommit.flatMap((file) => [
      { path: file.mdPath, slug: file.slug },
      { path: file.imagePath, slug: file.slug },
    ])

    if (!MERGE_VIA_API) {
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title: `Publish articles (${branchName})`,
        head: branchName,
        base: targetBranch,
        body: `Publishes: ${slugs}`,
      })
      return json(res, 200, {
        ok: true,
        branch: branchName,
        mergeCommitSha: null,
        mergeStrategy: 'open-pr',
        pullRequestUrl: pr.html_url || null,
        committed,
        skipped,
        errors,
      })
    }

    const { data: merge } = await octokit.repos.merge({
      owner,
      repo,
      base: targetBranch,
      head: branchName,
      commit_message: `Merge ${branchName}`,
    })

    return json(res, 200, {
      ok: true,
      branch: branchName,
      mergeCommitSha: merge?.sha || newCommit.sha,
      mergeStrategy: 'merge',
      committed,
      skipped,
      errors,
    })
  } catch (err) {
    console.error('publish-to-site error:', err)
    return json(res, 502, {
      ok: false,
      branch: branchName,
      error: githubErrorMessage(err),
    })
  }
}
