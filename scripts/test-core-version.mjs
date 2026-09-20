// Tests for the seo-core version panel engine (build step 6a).
// Run: node scripts/test-core-version.mjs
import assert from 'node:assert/strict'
import { bumpCorePin, parseCorePin, pickLatestTag, planCoreUpdate } from '../lib/core-version/plan.js'
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

function makeOcto({ pkg, tags }) {
  const calls = { commits: 0, merges: 0, committedContent: null }
  return {
    calls,
    repos: {
      getContent: async ({ path }) => {
        if (path === 'package.json') return { data: { content: Buffer.from(pkg).toString('base64'), sha: 'PKGSHA' } }
        throw new Error('unexpected path ' + path)
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
        return { data: { sha: 'BLOBSHA' } }
      },
      createTree: async () => ({ data: { sha: 'NEWTREE' } }),
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

await check('status: reports current, latest, and a green update', async () => {
  const octo = makeOcto({ pkg: pkgAt('0.3.0'), tags: [{ name: 'v0.3.0' }, { name: 'v0.4.0' }] })
  const s = await buildStatus(octo, dest)
  assert.equal(s.current, '0.3.0')
  assert.equal(s.latest, '0.4.0')
  assert.equal(s.severity, 'green')
  assert.equal(s.canOneClick, true)
  assert.equal(s.core.repo, 'seo-core')
})

await check('apply: green update commits + merges the pin bump', async () => {
  const octo = makeOcto({ pkg: pkgAt('0.3.0'), tags: [{ name: 'v0.3.0' }, { name: 'v0.4.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, true)
  assert.equal(r.body.updatedTo, '0.4.0')
  assert.equal(octo.calls.commits, 1)
  assert.equal(octo.calls.merges, 1)
  assert.ok(octo.calls.committedContent.includes('#v0.4.0'), 'committed package.json carries new pin')
})

await check('apply: major update is refused (409 migration_required), no commit', async () => {
  const octo = makeOcto({ pkg: pkgAt('0.4.0'), tags: [{ name: 'v0.4.0' }, { name: 'v1.0.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'migration_required')
  assert.equal(octo.calls.commits, 0)
  assert.equal(octo.calls.merges, 0)
})

await check('apply: already up-to-date does nothing', async () => {
  const octo = makeOcto({ pkg: pkgAt('0.4.0'), tags: [{ name: 'v0.4.0' }] })
  const r = await applyUpdate(octo, dest)
  assert.equal(r.status, 200)
  assert.equal(r.body.ok, false)
  assert.equal(r.body.reason, 'up-to-date')
  assert.equal(octo.calls.commits, 0)
})

console.log(`\nAll ${passed} core-version assertions passed.`)
