// Tests for the seo-core contract-version check (DL-8, build step 5.2).
// Run: node scripts/test-contract.mjs
import assert from 'node:assert/strict'
import {
  classifyCoreCompat,
  compareSemver,
  extractCoreVersion,
  parseSemver,
} from '../lib/contract/coreContract.js'
import { checkProjectContract } from '../lib/contract/projectContract.js'

let passed = 0
const check = async (name, fn) => {
  await fn()
  passed++
  console.log('✓', name)
}

// --- pin extraction across formats ------------------------------------------
await check('git-tag pin #vX.Y.Z', () => {
  assert.deepEqual(extractCoreVersion({ dependencies: { 'seo-core': 'github:DoriFussmann/seo-core#v0.3.0' } }), {
    spec: 'github:DoriFussmann/seo-core#v0.3.0',
    version: '0.3.0',
  })
})
await check('owner/repo#X.Y.Z (no v)', () => {
  assert.equal(extractCoreVersion({ dependencies: { 'seo-core': 'DoriFussmann/seo-core#0.4.0' } }).version, '0.4.0')
})
await check('#semver:^X.Y.Z', () => {
  assert.equal(extractCoreVersion({ dependencies: { 'seo-core': 'github:X/seo-core#semver:^0.2.0' } }).version, '0.2.0')
})
await check('npm range ^X.Y.Z', () => {
  assert.equal(extractCoreVersion({ dependencies: { 'seo-core': '^0.4.0' } }).version, '0.4.0')
})
await check('found in devDependencies', () => {
  assert.equal(extractCoreVersion({ devDependencies: { 'seo-core': 'github:X/seo-core#v0.1.0' } }).version, '0.1.0')
})
await check('no seo-core dep -> null', () => {
  assert.equal(extractCoreVersion({ dependencies: { astro: '^5.0.0' } }), null)
})
await check('unpinned (no version) -> version null', () => {
  assert.equal(extractCoreVersion({ dependencies: { 'seo-core': 'github:X/seo-core' } }).version, null)
})

// --- classification ---------------------------------------------------------
await check('current fleet 0.1.0..0.4.0 compatible', () => {
  for (const v of ['0.1.0', '0.2.0', '0.3.0', '0.4.0']) {
    assert.equal(classifyCoreCompat(v).compatible, true, v)
    assert.equal(classifyCoreCompat(v).severity, 'ok', v)
  }
})
await check('newer minor within major runs but is flagged', () => {
  const c = classifyCoreCompat('0.5.0')
  assert.equal(c.compatible, true)
  assert.equal(c.severity, 'minor_ahead')
})
await check('breaking major is refused', () => {
  const c = classifyCoreCompat('1.0.0')
  assert.equal(c.compatible, false)
  assert.equal(c.severity, 'major_ahead')
})
await check('too-old is refused', () => {
  assert.equal(classifyCoreCompat('0.0.9').compatible, false)
})
await check('undeterminable version is refused', () => {
  assert.equal(classifyCoreCompat(null).compatible, false)
  assert.equal(classifyCoreCompat(null).severity, 'unknown')
})

// --- semver helper ----------------------------------------------------------
await check('semver compare + parse', () => {
  assert.equal(compareSemver('0.3.0', '0.4.0'), -1)
  assert.equal(compareSemver('v0.4.0', '0.4.0'), 0)
  assert.equal(compareSemver('1.0.0', '0.9.9'), 1)
  assert.deepEqual(parseSemver('v0.4.0'), { major: 0, minor: 4, patch: 0 })
})

// --- guard against a mocked GitHub ------------------------------------------
const mockOcto = (pkgObj) => ({
  repos: { getContent: async () => ({ data: { content: Buffer.from(JSON.stringify(pkgObj)).toString('base64') } }) },
})
const dest = { owner: 'DoriFussmann', repo: 'album-amicorum', targetBranch: 'main' }

await check('guard allows a supported project', async () => {
  const r = await checkProjectContract(mockOcto({ dependencies: { 'seo-core': 'github:X/seo-core#v0.4.0' } }), dest)
  assert.equal(r.ok, true)
  assert.equal(r.version, '0.4.0')
})
await check('guard refuses a breaking-major project with 409 + structured body', async () => {
  const r = await checkProjectContract(mockOcto({ dependencies: { 'seo-core': 'github:X/seo-core#v1.0.0' } }), dest)
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
  assert.equal(r.body.code, 'incompatible_core_version')
  assert.equal(r.body.contract.detected, '1.0.0')
  assert.equal(r.body.contract.severity, 'major_ahead')
})
await check('guard refuses a project with no core dependency', async () => {
  const r = await checkProjectContract(mockOcto({ dependencies: { astro: '^5.0.0' } }), dest)
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
})
await check('guard refuses when package.json cannot be read', async () => {
  const throwOcto = {
    repos: {
      getContent: async () => {
        const e = new Error('Not Found')
        e.status = 404
        throw e
      },
    },
  }
  const r = await checkProjectContract(throwOcto, dest)
  assert.equal(r.ok, false)
  assert.equal(r.status, 409)
})

console.log(`\nAll ${passed} contract assertions passed.`)
