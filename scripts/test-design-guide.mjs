// Design preset guide round-trip, accent contrast, and imagery parsing.
// Run: node scripts/test-design-guide.mjs
import assert from 'node:assert/strict'
import { relativeLuminance } from '../src/lib/design/contrast.js'
import { TEMPLATES } from '../src/lib/design/templates.js'
import { applyBrand, defaultWordmark } from '../src/lib/design/applyBrand.js'
import { buildDesignGuide } from '../src/lib/design/buildDesignGuide.js'
import {
  getImageryContext,
  parseDesignTokens,
} from '../src/lib/design/getImageryContext.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log('✓', name)
}

check('every preset guide fence round-trips to identical JSON', () => {
  assert.equal(TEMPLATES.length, 6)
  for (const template of TEMPLATES) {
    const guide = buildDesignGuide(template, { brandName: 'Acme Labs' })
    const parsed = parseDesignTokens(guide)
    assert.deepEqual(parsed, template, template.template)
    assert.match(guide, new RegExp(`^# Design Guide — Acme Labs\\n`))
    assert.match(guide, /```tokens\n/)
  }
})

check('applyBrand warns when accent fails 4.5:1 on background and surface', () => {
  const slate = TEMPLATES.find((item) => item.template === 'slate')
  const failing = applyBrand(slate, { accent: '#F3F1EA' })
  assert.ok(
    failing.warnings.some((line) => line.startsWith('Accent on background')),
    failing.warnings.join(' | ')
  )
  assert.ok(
    failing.warnings.some((line) => line.startsWith('Accent on surface')),
    failing.warnings.join(' | ')
  )

  const passing = applyBrand(slate, { accent: '#0B7560' })
  assert.deepEqual(
    passing.warnings.filter((line) => line.includes('contrast is')),
    []
  )
})

check('applyBrand darkens accent in light mode and lightens it in dark mode', () => {
  const slate = TEMPLATES.find((item) => item.template === 'slate')
  const midnight = TEMPLATES.find((item) => item.template === 'midnight')
  const light = applyBrand(slate, { accent: '#1463F0' })
  const dark = applyBrand(midnight, { accent: '#5AA8FF' })
  assert.equal(light.tokens.colors.focus, '#1463F0')
  assert.equal(light.tokens.colors.accentFg, '#FFFFFF')
  assert.ok(
    relativeLuminance(light.tokens.colors.accentHover) <
      relativeLuminance(light.tokens.colors.accent)
  )
  assert.ok(
    relativeLuminance(dark.tokens.colors.accentHover) >
      relativeLuminance(dark.tokens.colors.accent)
  )
  assert.equal(dark.tokens.colors.accentFg, dark.tokens.colors.bg)
})

check('wordmark defaults split on the first space', () => {
  assert.deepEqual(defaultWordmark('Acme Labs'), {
    wordmarkPrimary: 'Acme',
    wordmarkAccent: 'Labs',
  })
  assert.deepEqual(defaultWordmark('Acme'), {
    wordmarkPrimary: 'Acme',
    wordmarkAccent: '',
  })
  const slate = TEMPLATES.find((item) => item.template === 'slate')
  const applied = applyBrand(slate, { productName: 'Northwind Goods' })
  assert.equal(applied.tokens.brand.wordmarkPrimary, 'Northwind')
  assert.equal(applied.tokens.brand.wordmarkAccent, 'Goods')
})

check('getImageryContext reads a real guide and rejects empty input', () => {
  const slate = TEMPLATES.find((item) => item.template === 'slate')
  const guide = buildDesignGuide(slate, { brandName: 'Acme Labs' })
  const brief = getImageryContext(guide)
  assert.match(brief, /Treatment: natural-crisp/)
  assert.match(brief, /Documentary photography/)
  assert.match(brief, /Avoid: Stock-photo/)
  assert.match(brief, /fg #26313A/)
  assert.match(brief, /bg #F3F1EA/)
  assert.match(brief, /accent #0B7560/)
  assert.match(brief, /highlight #E8603F/)
  assert.equal(getImageryContext(''), '')
  assert.equal(getImageryContext('   '), '')
  assert.equal(getImageryContext('no fence here'), '')
  assert.equal(getImageryContext('```tokens\nnot-json\n```'), '')
})

console.log(`\n${passed} passed`)
