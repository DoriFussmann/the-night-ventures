// Tests for the seo-core version panel engine (build step 6a).
// Run: node scripts/test-core-version.mjs
import assert from 'node:assert/strict'
import { bumpCoreLock, bumpCorePin, parseCorePin, pickLatestTag, planCoreUpdate, readLockedCore } from '../lib/core-version/plan.js'
import { buildStatus, applyUpdate } from '../lib/core-version/handler.js'

let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log('✓', name)
}

// --- parseCorePin -----------------------------------------------------------
await check('parseCorePin: github tag pin', () => {
  assert.deepEqual(parseCorePin('github:DoriFussmann/seo-core#v0.3.0'), {
    spec: 'github:DoriFussmann/seo-core#v0.3.0',
    owner: 'DoriFussmann',
    repo: 'seo-core',
    version: '0.3.0',
  })
})
await check('parseCorePin: npm range (no owner/repo)', () => {
  const p = parseCorePin('^0.4.0')
  assert.equal(p.version, '0.4.0')
  assert.equal(p.owner, null)
})

// --- pickLatestTag ----------------------------------------------------------
await check('pickLatestTag: highest semver wins', () => {
  const best = pickLatestTag([{ name: 'v0.2.0' }, { name: 'v0.4.0' }, { name: 'v0.3.1' }, { name: 'notes' }])
  assert.equal(best.name, 'v0.4.0')
  assert.equal(best.version, '0.4.0')
})
await check('pickLatestTag: none parse -> null', () => {
  assert.equal(pickLatestTag([{ name: 'latest' }, { name: 'stable' }]), null)
})

// --- bumpCorePin ------------------------------------------------------------
await check('bumpCorePin: github pin, preserves owner/repo + formatting', () => {
  const pkg = `{\n  "dependencies": {\n    "seo-core": "github:DoriFussmann/seo-core#v0.3.0",\n    "astro": "^5.0.0"\n  }\n}`
  const r = bumpCorePin(pkg, '0.4.0')
  assert.equal(r.changed, true)
  assert.ok(r.content.includes('"seo-core": "github:DoriFussmann/seo-core#v0.4.0"'))
  assert.ok(r.content.includes('"astro": "^5.0.0"'))
})
await check('bumpCorePin: npm range keeps caret', () => {
  const r = bumpCorePin(`{"dependencies":{"seo-core":"^0.3.0"}}`, '0.4.0')
  assert.ok(r.content.includes('"seo-core":"^0.4.0"'))
})
await check('bumpCorePin: no seo-core dep -> unchanged', () => {
  const r = bumpCorePin(`{"dependencies":{"astro":"^5.0.0"}}`, '0.4.0')
  assert.equal(r.changed, false)
})

// --- planCoreUpdate ---------------------------------------------------------
await check('planCoreUpdate: minor update is green + one-click', () => {
  const p = planCoreUpdate({ current: '0.3.0', latest: '0.4.0' })
  assert.deepEqual([p.updateAvailable, p.kind, p.severity, p.canOneClick], [true, 'minor', 'green', true])
})
await check('planCoreUpdate: major update is amber, NOT one-click', () => {
  const p = planCoreUpdate({ current: '0.4.0', latest: '1.0.0' })
  assert.deepEqual([p.updateAvailable, p.kind, p.severity, p.canOneClick], [true, 'major', 'amber', false])
})
await check('planCoreUpdate: already latest -> none', () => {
  const p = planCoreUpdate({ current: '0.4.0', latest: '0.4.0' })
  assert.equal(p.updateAvailable, false)
})

// --- mock GitHub for handler service functions ------------------------------
const dest = { owner: 'DoriFussmann', repo: 'album-amicorum', targetBranch: 'main' }

// files: { "<repo path>": "<file contents>" }. Missing path => 404 (like GitHub).
function makeOcto({ files, tags }) {
  const calls = { commits: 0, merges: 0, committedContent: null, committedPaths: [], committedByPath: {} }
  return {
    calls,
    repos: {
      getContent: async ({ path }) => {
        if (Object.prototype.hasOwnProperty.call(files, path)) {
          return { data: { content: Buffer.from(files[path]).toString('base64'), sha: path + '-SHA' } }
        }
        const err = new Error('Not Found')
        err.status = 404
        throw err
      },
      listTags: async () => ({ data: tags }),
      merge: async () => {
        calls.merges++
        return { data: { sha: 'MERGESHA' } }
      },
    },
    git: {
      getRef: async () => ({ data: { object: { sha: 'BASESHA' } } }),
      getCommit: async () => ({ data: { tree: { sha: 'TREESHA' } } }),
      createRef: async () => ({ data: {} }),
      createBlob: async ({ content }) => {
        calls.committedContent = content
        calls.committedBlobs = [...(calls.committedBlobs || []), content]
        return { data: { sha: 'BLOBSHA' } }
      },
      createTree: async ({ tree }) => {
        for (const t of tree || []) calls.committedPaths.push(t.path)
        return { data: { sha: 'NEWTREE' } }
      },
      createCommit: async () => {
        calls.commits++
        return { data: { sha: 'NEWCOMMIT' } }
      },
      updateRef: async () => ({ data: {} }),
      deleteRef: async () => ({ data: {} }),
    },
  }
}

const pkgAt = (v) => `{\n  "dependencies": {\n    "seo-core": "github:DoriFussmann/seo-core#v${v}"\n  }\n}`
// Root manifest of a workspaces monorepo: no deps, seo-core lives in site/.
const rootWorkspacePkg = `{\n  "name": "proj",\n  "private": true,\n  "workspaces": ["site"]\n}`
// Convenience builders for the two repo shapes.
const rootRepo = (v) => ({ 'package.json': pkgAt(v) })
const workspaceRepo = (v) => ({ 'package.json': rootWorkspacePkg, 'site/package.json': pkgAt(v) })

await check('status: reports current, latest, and a green update', async () => {
  const octo = makeOcto({ files: rootRepo('0.3.0'), tags: [{ name: 'v0.3.0' }, { name: 'v0.4.0' }] })
  const s = await buildStatus(octo, dest)
  assert.equal(s.current, '0.3.0')
  assert.equal(s.latest, '0.4.0')
  assert.equal(s.severity, 'green')
  assert.equal(s.canOneClick, true)
  assert.equal(s.core.repo, 'seo-core')
})

await check('apply: green update commits + merges the pin bump', async () => {
  const octo = makeOcto({ files: rootRepo('0.3.0'), tags: [{ name: 'v0.3.0' }, { name: 'v0.4.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.updatedTo, '0.4.0')
  assert.equal(octo.calls.commits, 1)
  assert.equal(octo.calls.merges, 1)
  assert.ok(octo.calls.committedContent.includes('#v0.4.0'), 'committed package.json carries new pin')
})

await check('apply: major update is refused (409 migration_required), no commit', async () => {
  const octo = makeOcto({ files: rootRepo('0.4.0'), tags: [{ name: 'v0.4.0' }, { name: 'v1.0.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'migration_required')
  assert.equal(octo.calls.commits, 0)
  assert.equal(octo.calls.merges, 0)
})

await check('apply: already up-to-date does nothing', async () => {
  const octo = makeOcto({ files: rootRepo('0.4.0'), tags: [{ name: 'v0.4.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  assert.equal(r.body.reason, 'up-to-date')
  assert.equal(octo.calls.commits, 0)
})

await check('status: workspace monorepo — reads seo-core from site/package.json', async () => {
  const octo = makeOcto({ files: workspaceRepo('0.2.0'), tags: [{ name: 'v0.4.0' }] })
  const s = await buildStatus(octo, dest)
  assert.equal(s.current, '0.2.0')
  assert.equal(s.latest, '0.4.0')
  assert.equal(s.severity, 'green')
})

await check('apply: workspace monorepo — commits the bump to site/package.json', async () => {
  const octo = makeOcto({ files: workspaceRepo('0.2.0'), tags: [{ name: 'v0.4.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.updatedTo, '0.4.0')
  assert.deepEqual(octo.calls.committedPaths, ['site/package.json'])
  assert.ok(octo.calls.committedContent.includes('#v0.4.0'))
})

// --- lockfile: the version that is actually installed -----------------------
const OLD_SHA = '0f0928fe419758eb5edeb8d7882ff87a60be9dc2'
const NEW_SHA = '3e4bb1165d3ab7880a397296b67eb39479538854'
// Shape of a real npm-workspaces lockfile (abridged): seo-core installed at an
// old commit while site/package.json already asks for a newer tag.
const lockAt = (version, sha, spec) => `{
  "name": "proj",
  "lockfileVersion": 3,
  "requires": true,
  "packages": {
    "": {
      "name": "proj",
      "workspaces": [
        "site"
      ]
    },
    "node_modules/seo-core": {
      "version": "${version}",
      "resolved": "git+ssh://git@github.com/DoriFussmann/seo-core.git#${sha}",
      "dependencies": {
        "astro": "^5.12.0"
      }
    },
    "site": {
      "dependencies": {
        "seo-core": "github:DoriFussmann/seo-core#v${spec}"
      }
    }
  }
}
`
const tagsWithSha = [
  { name: 'v0.8.1', commit: { sha: 'aaaaaaa' } },
  { name: 'v0.9.0', commit: { sha: NEW_SHA } },
]

await check('pickLatestTag: carries the tag commit sha', () => {
  assert.equal(pickLatestTag(tagsWithSha).sha, NEW_SHA)
})

await check('readLockedCore: reads installed version, not the declared one', () => {
  assert.equal(readLockedCore(lockAt('0.3.0', OLD_SHA, '0.8.1')).version, '0.3.0')
  assert.equal(readLockedCore('{"packages":{}}'), null)
  assert.equal(readLockedCore('not json'), null)
})

await check('bumpCoreLock: moves version, commit, and workspace spec only', () => {
  const before = lockAt('0.3.0', OLD_SHA, '0.8.1')
  const r = bumpCoreLock(before, { version: '0.9.0', sha: NEW_SHA })
  assert.equal(r.error, null)
  assert.equal(r.content, lockAt('0.9.0', NEW_SHA, '0.9.0'))
  const changed = before.split('\n').filter((line, i) => line !== r.content.split('\n')[i])
  assert.equal(changed.length, 3)
})

await check('bumpCoreLock: refuses without a tag commit sha', () => {
  const r = bumpCoreLock(lockAt('0.3.0', OLD_SHA, '0.8.1'), { version: '0.9.0', sha: null })
  assert.equal(r.changed, false)
  assert.match(r.error, /sha/)
})

const lockedRepo = (declared, locked, sha) => ({
  'package.json': rootWorkspacePkg,
  'site/package.json': pkgAt(declared),
  'package-lock.json': lockAt(locked, sha, declared),
})

await check('status: current is the LOCKED version; mismatch is flagged', async () => {
  const octo = makeOcto({ files: lockedRepo('0.8.1', '0.3.0', OLD_SHA), tags: tagsWithSha })
  const s = await buildStatus(octo, dest)
  assert.equal(s.current, '0.3.0')
  assert.equal(s.declared, '0.8.1')
  assert.equal(s.locked, '0.3.0')
  assert.equal(s.lockMismatch, true)
  assert.equal(s.updateAvailable, true)
})

await check('apply: commits package.json AND lockfile together', async () => {
  const octo = makeOcto({ files: lockedRepo('0.8.1', '0.3.0', OLD_SHA), tags: tagsWithSha })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.deepEqual(octo.calls.committedPaths, ['site/package.json', 'package-lock.json'])
  const [pkgOut, lockOut] = octo.calls.committedBlobs
  assert.ok(pkgOut.includes('#v0.9.0'))
  assert.equal(lockOut, lockAt('0.9.0', NEW_SHA, '0.9.0'))
})

await check('apply: package.json already bumped but lock stuck -> fixes the lock', async () => {
  const octo = makeOcto({ files: lockedRepo('0.9.0', '0.3.0', OLD_SHA), tags: tagsWithSha })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.deepEqual(octo.calls.committedPaths, ['package-lock.json'])
})

await check('apply: tag without commit sha -> refuses, no commit', async () => {
  const octo = makeOcto({
    files: lockedRepo('0.8.1', '0.3.0', OLD_SHA),
    tags: [{ name: 'v0.8.1' }, { name: 'v0.9.0' }],
  })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 422)
  assert.equal(r.body.code, 'lockfile_update_failed')
  assert.equal(octo.calls.commits, 0)
})

await check('apply: lock already correct and pin current -> up-to-date', async () => {
  const octo = makeOcto({ files: lockedRepo('0.9.0', '0.9.0', NEW_SHA), tags: tagsWithSha })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.body.reason, 'up-to-date')
  assert.equal(octo.calls.commits, 0)
})

console.log(`\nAll ${passed} core-version assertions passed.`)
