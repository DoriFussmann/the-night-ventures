// Stock image sourcing: provider order, judge gate, and failure isolation.
// Run: node scripts/test-image-sourcing.mjs
import assert from 'node:assert/strict'
import { judgeApi } from '../lib/image-sourcing/judge.js'
import { findStockImage } from '../lib/image-sourcing/run.js'

const TINY_JPEG = Buffer.from(
  '/9j/2wBDAAYEBAUEBAYFBQUGBgYHCQ4JCQgICRINDQoOFRIWFhUSFBQXGiEcFxgfGRQUHScdHyIjJSUlFhwpLCgkKyEkJST/2wBDAQYGBgkICREJCREkGBQYJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCQkJCT/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAf/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFAEBAAAAAAAAAAAAAAAAAAAABf/EABQRAQAAAAAAAAAAAAAAAAAAAAD/2gAMAwEAAhEDEQA/AIIARHv/2Q==',
  'base64'
)

const savedEnv = {}
const ENV_KEYS = [
  'ANTHROPIC_API_KEY',
  'UNSPLASH_ACCESS_KEY',
  'SHUTTERSTOCK_API_TOKEN',
  'SHUTTERSTOCK_SUBSCRIPTION_ID',
  'IMAGE_STOCK_ORDER',
  'IMAGE_STOCK_MIN_SCORE',
]
for (const key of ENV_KEYS) savedEnv[key] = process.env[key]

const originalFetch = globalThis.fetch
const originalBuild = judgeApi.buildQueries
const originalJudge = judgeApi.judgeCandidates

let passed = 0
function check(name, fn) {
  return Promise.resolve()
    .then(fn)
    .then(() => {
      passed++
      console.log('✓', name)
    })
}

function resetEnv(overrides) {
  for (const key of ENV_KEYS) delete process.env[key]
  process.env.ANTHROPIC_API_KEY = 'test-anthropic-key-value'
  process.env.IMAGE_STOCK_MIN_SCORE = '7'
  process.env.IMAGE_STOCK_ORDER = 'unsplash,shutterstock'
  Object.assign(process.env, overrides)
}

function unsplashPhoto(id, photographer = 'Ada Lovelace') {
  return {
    id,
    alt_description: `scene ${id}`,
    urls: {
      small: `https://images.example/thumb-${id}.jpg`,
      raw: `https://images.example/raw-${id}`,
    },
    links: {
      html: `https://unsplash.com/photos/${id}`,
      download_location: `https://api.unsplash.com/photos/${id}/download`,
    },
    user: { name: photographer, links: { html: `https://unsplash.com/@${id}` } },
  }
}

function shutterstockImage(id) {
  return {
    id,
    description: `scene ${id}`,
    assets: { preview_1000: { url: `https://images.example/ss-${id}.jpg` } },
  }
}

function routeFetch(handler) {
  globalThis.fetch = async (url, opts) => handler(String(url), opts || {})
}

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => TINY_JPEG.buffer.slice(TINY_JPEG.byteOffset, TINY_JPEG.byteOffset + TINY_JPEG.byteLength),
  }
}

function jpegResponse() {
  return {
    ok: true,
    status: 200,
    json: async () => ({}),
    arrayBuffer: async () =>
      TINY_JPEG.buffer.slice(TINY_JPEG.byteOffset, TINY_JPEG.byteOffset + TINY_JPEG.byteLength),
  }
}

function acceptFirst() {
  judgeApi.buildQueries = async () => ({ queries: ['desk lamp', 'office lamp'] })
  judgeApi.judgeCandidates = async () => ({
    accepted: true,
    bestIndex: 0,
    score: 9,
    reason: 'matches the topic',
    altText: 'A desk lamp',
  })
}

try {
  await check('no stock env → both providers not_configured', async () => {
    resetEnv({})
    acceptFirst()
    routeFetch(() => {
      throw new Error('fetch should not run')
    })
    const result = await findStockImage({ title: 'Lamp repair', description: 'Fix a lamp' })
    assert.equal(result.found, false)
    assert.deepEqual(
      result.trail.map((entry) => ({ provider: entry.provider, outcome: entry.outcome })),
      [
        { provider: 'unsplash', outcome: 'not_configured' },
        { provider: 'shutterstock', outcome: 'not_configured' },
      ]
    )
  })

  await check('Unsplash 401 → error, Shutterstock still used', async () => {
    resetEnv({
      UNSPLASH_ACCESS_KEY: 'unsplash-key',
      SHUTTERSTOCK_API_TOKEN: 'ss-token',
      SHUTTERSTOCK_SUBSCRIPTION_ID: 'sub-1',
    })
    acceptFirst()
    routeFetch((url) => {
      if (url.includes('api.unsplash.com/search')) return jsonResponse(401, { errors: ['unauthorized'] })
      if (url.includes('api.shutterstock.com/v2/images/search')) {
        return jsonResponse(200, { data: [shutterstockImage('ss-9')] })
      }
      if (url.includes('api.shutterstock.com/v2/images/licenses')) {
        return jsonResponse(200, { data: [{ download: { url: 'https://download.example/ss-9.jpg' } }] })
      }
      if (url.includes('download.example/ss-9.jpg')) return jpegResponse()
      throw new Error(`unexpected url ${url}`)
    })
    const result = await findStockImage({ title: 'Lamp repair', description: 'Fix a lamp' })
    assert.equal(result.found, true)
    assert.equal(result.source, 'shutterstock')
    assert.equal(result.sourceId, 'ss-9')
    assert.equal(result.mime, 'image/jpeg')
    assert.ok(result.b64_json)
    assert.equal(result.trail[0].provider, 'unsplash')
    assert.equal(result.trail[0].outcome, 'error')
    assert.match(result.trail[0].reason, /401/)
    assert.equal(result.trail[1].outcome, 'used')
  })

  await check('judge throw → judge_error, next provider tried', async () => {
    resetEnv({
      UNSPLASH_ACCESS_KEY: 'unsplash-key',
      SHUTTERSTOCK_API_TOKEN: 'ss-token',
      SHUTTERSTOCK_SUBSCRIPTION_ID: 'sub-1',
    })
    judgeApi.buildQueries = async () => ({ queries: ['desk lamp'] })
    let calls = 0
    judgeApi.judgeCandidates = async () => {
      calls += 1
      if (calls === 1) throw new Error('judge exploded')
      return { accepted: true, bestIndex: 0, score: 8, reason: 'ok', altText: 'Lamp' }
    }
    routeFetch((url) => {
      if (url.includes('api.unsplash.com/search')) {
        return jsonResponse(200, { results: [unsplashPhoto('u-1')] })
      }
      if (url.includes('api.shutterstock.com/v2/images/search')) {
        return jsonResponse(200, { data: [shutterstockImage('ss-2')] })
      }
      if (url.includes('/licenses')) {
        return jsonResponse(200, { data: [{ download: { url: 'https://download.example/ss-2.jpg' } }] })
      }
      if (url.includes('download.example/ss-2.jpg')) return jpegResponse()
      throw new Error(`unexpected url ${url}`)
    })
    const result = await findStockImage({ title: 'Lamp repair', description: 'Fix a lamp' })
    assert.equal(result.found, true)
    assert.equal(result.source, 'shutterstock')
    assert.equal(result.trail[0].outcome, 'judge_error')
    assert.equal(result.trail[1].outcome, 'used')
  })

  await check('score below threshold → no_fit', async () => {
    resetEnv({ UNSPLASH_ACCESS_KEY: 'unsplash-key' })
    judgeApi.buildQueries = async () => ({ queries: ['desk lamp'] })
    judgeApi.judgeCandidates = async () => ({
      accepted: false,
      bestIndex: 0,
      score: 5,
      reason: 'too generic',
      altText: '',
    })
    routeFetch((url) => {
      if (url.includes('api.unsplash.com/search')) {
        return jsonResponse(200, { results: [unsplashPhoto('u-low')] })
      }
      throw new Error(`unexpected url ${url}`)
    })
    const result = await findStockImage({ title: 'Lamp repair', description: 'Fix a lamp' })
    assert.equal(result.found, false)
    assert.equal(result.trail[0].provider, 'unsplash')
    assert.equal(result.trail[0].outcome, 'no_fit')
    assert.equal(result.trail[0].score, 5)
    assert.equal(result.trail[1].provider, 'shutterstock')
    assert.equal(result.trail[1].outcome, 'not_configured')
  })

  await check('Shutterstock per-item license error continues', async () => {
    resetEnv({
      IMAGE_STOCK_ORDER: 'shutterstock,unsplash',
      UNSPLASH_ACCESS_KEY: 'unsplash-key',
      SHUTTERSTOCK_API_TOKEN: 'ss-token',
      SHUTTERSTOCK_SUBSCRIPTION_ID: 'sub-1',
    })
    acceptFirst()
    routeFetch((url) => {
      if (url.includes('api.shutterstock.com/v2/images/search')) {
        return jsonResponse(200, { data: [shutterstockImage('ss-bad')] })
      }
      if (url.includes('/licenses')) {
        return jsonResponse(200, { data: [{ image_id: 'ss-bad', error: 'Media unavailable' }] })
      }
      if (url.includes('api.unsplash.com/search')) {
        return jsonResponse(200, { results: [unsplashPhoto('u-ok', 'Grace Hopper')] })
      }
      if (url.includes('images.example/raw-u-ok')) return jpegResponse()
      if (url.includes('/download')) return jsonResponse(200, {})
      throw new Error(`unexpected url ${url}`)
    })
    const result = await findStockImage({ title: 'Lamp repair', description: 'Fix a lamp' })
    assert.equal(result.found, true)
    assert.equal(result.source, 'unsplash')
    assert.equal(result.sourceId, 'u-ok')
    assert.equal(result.trail[0].provider, 'shutterstock')
    assert.equal(result.trail[0].outcome, 'error')
    assert.match(result.trail[0].reason, /Media unavailable/)
    assert.equal(result.trail[1].outcome, 'used')
  })

  await check('excludeIds are filtered out', async () => {
    resetEnv({ UNSPLASH_ACCESS_KEY: 'unsplash-key' })
    acceptFirst()
    routeFetch((url) => {
      if (url.includes('api.unsplash.com/search')) {
        return jsonResponse(200, { results: [unsplashPhoto('keep-out'), unsplashPhoto('keep-in')] })
      }
      if (url.includes('images.example/raw-keep-in')) return jpegResponse()
      if (url.includes('/download')) return jsonResponse(200, {})
      throw new Error(`unexpected url ${url}`)
    })
    const result = await findStockImage({
      title: 'Lamp repair',
      description: 'Fix a lamp',
      excludeIds: ['keep-out'],
    })
    assert.equal(result.found, true)
    assert.equal(result.sourceId, 'keep-in')
  })

  await check('unknown provider name is ignored', async () => {
    resetEnv({ IMAGE_STOCK_ORDER: 'flickr,unsplash' })
    acceptFirst()
    routeFetch(() => {
      throw new Error('fetch should not run')
    })
    const result = await findStockImage({ title: 'Lamp repair', description: 'Fix a lamp' })
    assert.equal(result.found, false)
    assert.deepEqual(result.trail, [{ provider: 'unsplash', outcome: 'not_configured' }])
  })

  console.log(`\n${passed} passed`)
} finally {
  globalThis.fetch = originalFetch
  judgeApi.buildQueries = originalBuild
  judgeApi.judgeCandidates = originalJudge
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key]
    else process.env[key] = savedEnv[key]
  }
}
