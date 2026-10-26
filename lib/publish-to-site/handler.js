import { Octokit } from '@octokit/rest'
import { requireAuth } from '../seo-advisor/auth.js'
import { checkProjectContract } from '../contract/projectContract.js'
import { demoteArticleMarkdownH1 } from '../demoteBodyH1.js'
import { parseFrontmatter } from '../frontmatter.js'
import { blockingOverlaps, summarizeOverlaps, findKeywordOverlaps } from '../keyword-overlap.js'
import { loadLiveArticles } from '../wire-internal-links/github.js'
import {
  CONTENT_CONFIG_PATHS,
  TEAM_CONTENT_DIR,
  resolveArticleAuthor,
  teamDirFromContentConfig,
  teamSlugsFromListing,
} from './author.js'

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
const PUBLISH_BRANCH_RE = /^publish\/\d{4}-\d{2}-\d{2}-\d{4}$/
const COMPANY_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const HERO_BUCKET = 'article-heroes'

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

export function readDestination(body) {
  const owner = String(body.owner || '').trim()
  const repo = String(body.repo || '').trim()
  const tokenKey = String(body.tokenKey || body.github_token_key || '')
    .trim()
    .toUpperCase()
  const targetBranch = String(body.branch || 'main').trim() || 'main'

  if (!owner || !repo || !tokenKey) {
    return { error: 'owner, repo, and tokenKey are required', status: 400 }
  }
  if (!OWNER_REPO_RE.test(owner) || !OWNER_REPO_RE.test(repo)) {
    return { error: 'owner or repo is invalid', status: 400 }
  }
  if (!TOKEN_KEY_RE.test(tokenKey)) {
    return {
      error: 'tokenKey is invalid (use A–Z, 0–9, underscore; e.g. HEYRUPERT)',
      status: 400,
    }
  }

  const token = process.env[`GITHUB_TOKEN_${tokenKey}`]
  if (!token) {
    console.error(`Missing GITHUB_TOKEN_${tokenKey}`)
    return { error: `GITHUB_TOKEN_${tokenKey} is not set`, status: 500 }
  }

  return { owner, repo, tokenKey, targetBranch, token }
}

function readPublishBranch(body) {
  const name = String(body.publishBranch || '').trim()
  if (!name) return { name: null }
  if (!PUBLISH_BRANCH_RE.test(name)) {
    return { error: 'publishBranch is invalid', status: 400 }
  }
  return { name }
}

function evaluateArticle(item) {
  const mdParsed = parseSlugFilename(item?.filename, 'md')
  if (!mdParsed) {
    return {
      error: {
        filename: String(item?.filename || ''),
        message: 'Invalid markdown filename (expected {slug}.md)',
      },
    }
  }

  const content = String(item?.content || '')
  if (!content.trim()) {
    return {
      skipped: {
        filename: mdParsed.filename,
        reason: 'missing_body',
        message: 'No article content — skipped',
      },
    }
  }

  return {
    draft: {
      slug: mdParsed.slug,
      mdPath: `${ARTICLE_CONTENT_DIR}/${mdParsed.filename}`,
      markdown: content,
    },
  }
}

function heroPathForSlug(companyId, slug, requested) {
  const canonical = `${companyId}/${slug}.png`
  const cleaned = String(requested || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '')
  if (!cleaned) return canonical
  const re = new RegExp(
    `^${companyId}/${slug}\\.(png|jpe?g|webp|gif)$`,
    'i'
  )
  if (!re.test(cleaned)) return canonical
  return cleaned
}

function extFromPath(path) {
  const ext = String(path || '')
    .split('.')
    .pop()
    .toLowerCase()
  if (ext === 'jpeg') return 'jpg'
  return ext || 'png'
}

async function resolveHeroImage(supabase, item, { companyId, slug }) {
  const imgParsed = parseSlugFilename(item?.image?.filename, 'image')
  const imageBase64 = stripDataUrl(
    item?.image?.contentBase64 || item?.image?.b64_json
  )
  if (imgParsed && imgParsed.slug === slug && imageBase64) {
    return {
      imagePath: `${ARTICLE_ASSETS_DIR}/${imgParsed.filename}`,
      imageBase64,
    }
  }

  if (!supabase || !COMPANY_ID_RE.test(String(companyId || ''))) {
    return null
  }

  const objectPath = heroPathForSlug(
    companyId,
    slug,
    item?.storagePath || item?.image?.storagePath
  )
  const { data, error } = await supabase.storage
    .from(HERO_BUCKET)
    .download(objectPath)
  if (error || !data) return null

  const buf = Buffer.from(await data.arrayBuffer())
  if (!buf.length) return null
  const ext = extFromPath(objectPath)
  return {
    imagePath: `${ARTICLE_ASSETS_DIR}/${slug}.${ext}`,
    imageBase64: buf.toString('base64'),
  }
}

// Keyword-overlap gate (cannibalization). Runs only when an article goes live
// for the first time: drafts and edits to an article already live on the
// target branch are not blocked. Returns blocking findings ([] when clear).
async function liveKeywordOverlaps(octokit, dest, slug, markdown) {
  const candidate = parseFrontmatter(markdown).data || {}
  if (candidate.draft === true) return []
  const live = await loadLiveArticles(octokit, dest)
  const current = live.find((article) => article.slug === slug)
  if (current && current.data.draft !== true) return []
  const existing = live
    .filter((article) => article.data.draft !== true)
    .map((article) => ({ ...article.data, slug: article.slug, where: dest.targetBranch }))
  return blockingOverlaps(
    findKeywordOverlaps(
      {
        slug,
        title: candidate.title,
        targetKeyword: candidate.targetKeyword,
        pillarKeyword: candidate.pillarKeyword,
        supportingKeyword: candidate.supportingKeyword,
        articleType: candidate.articleType,
      },
      existing
    )
  )
}

function commitResult({
  branch = null,
  committed = [],
  skipped = [],
  errors = [],
}) {
  return {
    ok: errors.length === 0,
    step: 'commit',
    branch,
    mergeCommitSha: null,
    mergeStrategy: MERGE_VIA_API ? 'merge' : 'open-pr',
    committed,
    skipped,
    errors,
  }
}

async function siteTeamSlugs(octokit, { owner, repo, targetBranch }, dir = TEAM_CONTENT_DIR) {
  try {
    const { data } = await octokit.repos.getContent({
      owner,
      repo,
      path: dir,
      ref: targetBranch,
    })
    return teamSlugsFromListing(data)
  } catch (err) {
    if (err?.status === 404) return []
    throw err
  }
}

/** The author collection folder, read from the site's content config. */
async function siteTeamDir(octokit, { owner, repo, targetBranch }) {
  for (const path of CONTENT_CONFIG_PATHS) {
    try {
      const { data } = await octokit.repos.getContent({ owner, repo, path, ref: targetBranch })
      const text = Buffer.from(String(data?.content || ''), 'base64').toString('utf8')
      return teamDirFromContentConfig(text)
    } catch (err) {
      if (err?.status === 404) continue
      throw err
    }
  }
  return TEAM_CONTENT_DIR
}

async function ensurePublishBranch(octokit, { owner, repo, targetBranch, publishBranch }) {
  if (publishBranch) {
    await octokit.git.getRef({
      owner,
      repo,
      ref: `heads/${publishBranch}`,
    })
    return publishBranch
  }

  const { data: baseRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${targetBranch}`,
  })
  const name = publishBranchName()
  await octokit.git.createRef({
    owner,
    repo,
    ref: `refs/heads/${name}`,
    sha: baseRef.object.sha,
  })
  return name
}

async function commitFilesToBranch(octokit, { owner, repo, branchName, file }) {
  const { data: headRef } = await octokit.git.getRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
  })
  const parentSha = headRef.object.sha
  const { data: parentCommit } = await octokit.git.getCommit({
    owner,
    repo,
    commit_sha: parentSha,
  })

  const { data: mdBlob } = await octokit.git.createBlob({
    owner,
    repo,
    content: file.markdown,
    encoding: 'utf-8',
  })
  const { data: imageBlob } = await octokit.git.createBlob({
    owner,
    repo,
    content: file.imageBase64,
    encoding: 'base64',
  })

  const { data: newTree } = await octokit.git.createTree({
    owner,
    repo,
    base_tree: parentCommit.tree.sha,
    tree: [
      { path: file.mdPath, mode: '100644', type: 'blob', sha: mdBlob.sha },
      { path: file.imagePath, mode: '100644', type: 'blob', sha: imageBlob.sha },
    ],
  })

  const { data: newCommit } = await octokit.git.createCommit({
    owner,
    repo,
    message: `Publish article: ${file.slug}`,
    tree: newTree.sha,
    parents: [parentSha],
  })

  await octokit.git.updateRef({
    owner,
    repo,
    ref: `heads/${branchName}`,
    sha: newCommit.sha,
  })

  return newCommit.sha
}

async function handleCommit(req, res, body, dest, supabase) {
  if (Array.isArray(body.articles) && body.articles.length > 1) {
    return json(res, 400, {
      error:
        'Send one article per request (step=commit). Cluster publish must be incremental.',
    })
  }

  const article =
    body.article && typeof body.article === 'object'
      ? body.article
      : Array.isArray(body.articles)
        ? body.articles[0]
        : null
  if (!article || typeof article !== 'object') {
    return json(res, 400, { error: 'article is required' })
  }

  const requested = readPublishBranch(body)
  if (requested.error) {
    return json(res, requested.status, { error: requested.error })
  }

  const result = await commitArticle({
    dest,
    supabase,
    article,
    companyId: String(body.companyId || '').trim(),
    publishBranch: requested.name,
    overwrite: body.overwrite === true,
    allowOverlap: body.allowOverlap === true,
  })
  return json(res, 200, result)
}

/**
 * Commit one article (markdown + hero) to a publish branch. Shared by the
 * browser publish route and the scheduled publisher.
 * @returns commitResult shape: { ok, branch, committed, skipped, errors }
 */
export async function commitArticle({
  dest,
  supabase,
  article,
  companyId = '',
  publishBranch = null,
  overwrite = false,
  allowOverlap = false,
}) {
  const requestedBranch = publishBranch
  const octokit = new Octokit({ auth: dest.token })
  const { owner, repo, targetBranch } = dest
  const evaluated = evaluateArticle(article)

  if (evaluated.error) {
    return commitResult({ branch: requestedBranch, errors: [evaluated.error] })
  }
  if (evaluated.skipped) {
    return commitResult({ branch: requestedBranch, skipped: [evaluated.skipped] })
  }

  const hero = await resolveHeroImage(supabase, article, {
    companyId,
    slug: evaluated.draft.slug,
  })
  if (!hero) {
    return commitResult({
      branch: requestedBranch,
      skipped: [
        {
          filename: `${evaluated.draft.slug}.md`,
          reason: 'missing_hero',
          message: 'No hero image — skipped (schema requires image)',
        },
      ],
    })
  }

  const file = {
    slug: evaluated.draft.slug,
    mdPath: evaluated.draft.mdPath,
    markdown: demoteArticleMarkdownH1(evaluated.draft.markdown),
    imagePath: hero.imagePath,
    imageBase64: hero.imageBase64,
  }
  // Library CMS commits (edit / publish a drafted article already on the site)
  // pass overwrite: true. Generation flows omit it and keep the no-clobber guard.
  try {
    const existsOnTarget = overwrite
      ? false
      : await pathExists(octokit, { owner, repo, path: file.mdPath, ref: targetBranch })
    if (existsOnTarget) {
      return commitResult({
        branch: requestedBranch,
        skipped: [
          {
            filename: `${file.slug}.md`,
            reason: 'already_exists',
            message: `${file.mdPath} already exists on ${targetBranch} — not overwritten`,
          },
        ],
      })
    }
    if (requestedBranch && !overwrite) {
      const existsOnPublish = await pathExists(octokit, {
        owner,
        repo,
        path: file.mdPath,
        ref: requestedBranch,
      })
      if (existsOnPublish) {
        return commitResult({
          branch: requestedBranch,
          skipped: [
            {
              filename: `${file.slug}.md`,
              reason: 'already_exists',
              message: `${file.mdPath} already exists on ${requestedBranch} — not overwritten`,
            },
          ],
        })
      }
    }
  } catch (err) {
    return commitResult({
      branch: requestedBranch,
      errors: [
        {
          filename: `${file.slug}.md`,
          message: `Failed checking existing files: ${githubErrorMessage(err)}`,
        },
      ],
    })
  }

  if (allowOverlap !== true) {
    let overlaps
    try {
      overlaps = await liveKeywordOverlaps(octokit, dest, file.slug, file.markdown)
    } catch (err) {
      return commitResult({
        branch: requestedBranch,
        errors: [
          {
            filename: `${file.slug}.md`,
            message: `Failed checking keyword overlap: ${githubErrorMessage(err)}`,
          },
        ],
      })
    }
    if (overlaps.length) {
      return commitResult({
        branch: requestedBranch,
        skipped: [
          {
            filename: `${file.slug}.md`,
            reason: 'keyword_overlap',
            message: `${summarizeOverlaps(overlaps)} Merge or retarget it, or publish anyway.`,
            overlaps,
          },
        ],
      })
    }
  }

  try {
    const teamDir = await siteTeamDir(octokit, dest)
    const resolved = resolveArticleAuthor(
      file.markdown,
      await siteTeamSlugs(octokit, dest, teamDir),
      teamDir
    )
    if (resolved.error) {
      return commitResult({
        branch: requestedBranch,
        errors: [{ filename: `${file.slug}.md`, message: resolved.error }],
      })
    }
    file.markdown = resolved.markdown
  } catch (err) {
    return commitResult({
      branch: requestedBranch,
      errors: [
        {
          filename: `${file.slug}.md`,
          message: `Failed reading the site's team members: ${githubErrorMessage(err)}`,
        },
      ],
    })
  }

  let branchName = requestedBranch
  try {
    branchName = await ensurePublishBranch(octokit, {
      owner,
      repo,
      targetBranch,
      publishBranch: requestedBranch,
    })
    await commitFilesToBranch(octokit, { owner, repo, branchName, file })
  } catch (err) {
    console.error('publish-to-site commit error:', err)
    return commitResult({
      branch: branchName,
      errors: [{ filename: `${file.slug}.md`, message: githubErrorMessage(err) }],
    })
  }

  return commitResult({
    branch: branchName,
    committed: [
      { path: file.mdPath, slug: file.slug },
      { path: file.imagePath, slug: file.slug },
    ],
  })
}

/** Merge a publish branch into the target branch. Throws on GitHub errors. */
export async function mergePublishBranch(dest, publishBranch) {
  const octokit = new Octokit({ auth: dest.token })
  const { data: merge } = await octokit.repos.merge({
    owner: dest.owner,
    repo: dest.repo,
    base: dest.targetBranch,
    head: publishBranch,
    commit_message: `Merge ${publishBranch}`,
  })
  return { sha: merge?.sha || null }
}

async function handleMerge(req, res, body, dest) {
  const requested = readPublishBranch(body)
  if (requested.error) {
    return json(res, requested.status, { error: requested.error })
  }
  const publishBranch = requested.name
  if (!publishBranch) {
    return json(res, 400, { error: 'publishBranch is required to merge' })
  }

  const octokit = new Octokit({ auth: dest.token })
  const { owner, repo, targetBranch } = dest

  try {
    if (!MERGE_VIA_API) {
      const { data: pr } = await octokit.pulls.create({
        owner,
        repo,
        title: `Publish articles (${publishBranch})`,
        head: publishBranch,
        base: targetBranch,
        body: `Publishes ${publishBranch}`,
      })
      return json(res, 200, {
        ok: true,
        step: 'merge',
        branch: publishBranch,
        mergeCommitSha: null,
        mergeStrategy: 'open-pr',
        pullRequestUrl: pr.html_url || null,
        committed: [],
        skipped: [],
        errors: [],
      })
    }

    const { data: merge } = await octokit.repos.merge({
      owner,
      repo,
      base: targetBranch,
      head: publishBranch,
      commit_message: `Merge ${publishBranch}`,
    })

    return json(res, 200, {
      ok: true,
      step: 'merge',
      branch: publishBranch,
      mergeCommitSha: merge?.sha || null,
      mergeStrategy: 'merge',
      committed: [],
      skipped: [],
      errors: [],
    })
  } catch (err) {
    console.error('publish-to-site merge error:', err)
    return json(res, 502, {
      ok: false,
      step: 'merge',
      branch: publishBranch,
      mergeCommitSha: null,
      error: githubErrorMessage(err),
    })
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

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, {
      error: err.message || 'Unauthorized',
    })
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

  const step = String(body.step || '').trim().toLowerCase()

  // Refuse to publish into a project whose seo-core version TNV can't verify or
  // doesn't support (DL-8). Runs before any write.
  if (step === 'commit' || step === 'merge') {
    const contract = await checkProjectContract(new Octokit({ auth: dest.token }), dest)
    if (!contract.ok) return json(res, contract.status, contract.body)
  }

  if (step === 'commit') {
    return handleCommit(req, res, body, dest, auth.supabase)
  }
  if (step === 'merge') {
    return handleMerge(req, res, body, dest)
  }

  return json(res, 400, {
    error: 'step must be "commit" or "merge"',
  })
}
