// Design contract v3: guide round-trip, contrast, overrides, prompt, imagery parsing.
// Run: node scripts/test-design-guide.mjs
import assert from 'node:assert/strict'
import { contrastRatio, relativeLuminance } from '../src/lib/design/contrast.js'
import { TEMPLATES, TEMPLATE_IDS, DIRECTION_NOTES } from '../src/lib/design/templates.js'
import { applyBrand, applyOverrides, defaultWordmark } from '../src/lib/design/applyBrand.js'
import { buildDesignGuide, VARIANT_SPEC } from '../src/lib/design/buildDesignGuide.js'
import { buildCursorPrompt } from '../src/lib/design/buildCursorPrompt.js'
import { COLOR_KEYS, CONTRAST_PAIRS, ENUMS, GUIDE_FILENAME } from '../src/lib/design/contract.js'
import { FONTS } from '../src/lib/design/fonts.js'
import {
  getImageryContext,
  getImageryPalette,
  parseDesignTokens,
} from '../src/lib/design/getImageryContext.js'

let passed = 0
const check = (name, fn) => {
  fn()
  passed++
  console.log('✓', name)
}

const get = (obj, path) => path.split('.').reduce((acc, key) => acc?.[key], obj)

check('six directions in picker order, each with notes', () => {
  assert.deepEqual(TEMPLATES.map((t) => t.template), TEMPLATE_IDS)
  assert.equal(TEMPLATES.length, 6)
  for (const id of TEMPLATE_IDS) assert.ok(DIRECTION_NOTES[id]?.signatures?.length >= 3, id)
})

check('every direction satisfies the contract shape and enums', () => {
  for (const t of TEMPLATES) {
    assert.equal(t.version, 3, t.template)
    for (const [key] of COLOR_KEYS) assert.match(t.colors[key], /^#[0-9A-F]{6}$/, `${t.template} colors.${key}`)
    for (const [path, values] of Object.entries(ENUMS)) {
      assert.ok(values.includes(get(t, path)), `${t.template} ${path}=${get(t, path)}`)
    }
    for (const role of ['display', 'body']) {
      const font = t.type[role]
      assert.ok(Object.values(FONTS).some((f) => f.family === font.family && f.package === font.package), `${t.template} ${role}`)
      assert.ok(font.imports.length > 0)
    }
    for (const group of ['header', 'hero', 'heroOverlay', 'card', 'rhythm', 'texture', 'hover', 'portrait', 'eyebrowMark']) {
      assert.ok(VARIANT_SPEC[group][t.variants[group]], `${t.template} spec for ${group}`)
    }
    assert.deepEqual(t.overrides, { forceInter: false, forceNoBold: false })
  }
})

check('every direction passes all contrast pairs at 4.5:1', () => {
  for (const t of TEMPLATES) {
    for (const [fg, bg] of CONTRAST_PAIRS) {
      const ratio = contrastRatio(t.colors[fg], t.colors[bg])
      assert.ok(ratio >= 4.5, `${t.template} ${fg}/${bg} = ${ratio.toFixed(2)}`)
    }
    assert.deepEqual(applyBrand(t).warnings, [], t.template)
  }
})

check('every guide fence round-trips to identical JSON', () => {
  for (const template of TEMPLATES) {
    const guide = buildDesignGuide(template, { brandName: 'Acme Labs' })
    assert.deepEqual(parseDesignTokens(guide), template, template.template)
    assert.match(guide, /^# Design Guide — Acme Labs\n/)
    assert.match(guide, /```tokens\n/)
    assert.ok(guide.includes(GUIDE_FILENAME))
  }
})

check('guide and prompt are deterministic', () => {
  const t = TEMPLATES[0]
  assert.equal(buildDesignGuide(t, { brandName: 'X' }), buildDesignGuide(t, { brandName: 'X' }))
  assert.equal(buildCursorPrompt(t), buildCursorPrompt(t))
})

check('Force Inter swaps both fonts to Inter', () => {
  for (const t of TEMPLATES) {
    const { tokens } = applyBrand(t, { forceInter: true })
    assert.equal(tokens.type.display.family, 'Inter Variable')
    assert.equal(tokens.type.body.family, 'Inter Variable')
    assert.equal(tokens.overrides.forceInter, true)
    const prompt = buildCursorPrompt(tokens)
    assert.match(prompt, /npm install @fontsource-variable\/inter\. Import/)
    assert.doesNotMatch(prompt, /playfair|fraunces|jetbrains|young-serif|instrument-serif|montserrat|inter-tight/)
    assert.match(buildDesignGuide(tokens), /Force Inter is ON/)
  }
})

check('Force no bold caps every weight at 500 and leaves the original untouched', () => {
  for (const t of TEMPLATES) {
    const { tokens } = applyBrand(t, { forceNoBold: true })
    for (const key of ['headingWeight', 'uiWeight', 'strongWeight']) assert.ok(tokens.type[key] <= 500, `${t.template} ${key}`)
    assert.ok(tokens.type.bodyWeight <= 400)
    assert.equal(tokens.overrides.forceNoBold, true)
    assert.match(buildDesignGuide(tokens), /Force no bold is ON/)
  }
  const alpine = TEMPLATES.find((t) => t.template === 'alpine')
  assert.equal(alpine.type.headingWeight, 700)
  const both = applyOverrides(JSON.parse(JSON.stringify(alpine)), { forceInter: true, forceNoBold: true })
  assert.equal(both.type.display.family, 'Inter Variable')
  assert.equal(both.type.headingWeight, 500)
})

check('both overrides off by default', () => {
  for (const t of TEMPLATES) {
    const { tokens } = applyBrand(t)
    assert.deepEqual(tokens.overrides, { forceInter: false, forceNoBold: false })
    assert.deepEqual(tokens.type, t.type)
  }
})

check('accent override derives a text-safe accentInk and warns on bad accents', () => {
  const pristine = TEMPLATES.find((t) => t.template === 'pristine')
  const pale = applyBrand(pristine, { accent: '#FFD84D' })
  assert.ok(contrastRatio(pale.tokens.colors.accentInk, pale.tokens.colors.bg) >= 4.5)
  assert.ok(contrastRatio(pale.tokens.colors.accentFg, pale.tokens.colors.accent) >= 4.5)
  const kinetic = TEMPLATES.find((t) => t.template === 'kinetic')
  const dark = applyBrand(kinetic, { accent: '#5AA8FF' })
  assert.ok(relativeLuminance(dark.tokens.colors.accentHover) > relativeLuminance(dark.tokens.colors.accent))
  assert.equal(dark.tokens.colors.accentFg, kinetic.colors.bg)
  const invalid = applyBrand(pristine, { accent: 'nope' })
  assert.ok(invalid.warnings.includes('Accent must be a 6-digit hex color.'))
})

check('wordmark defaults split on the first space', () => {
  assert.deepEqual(defaultWordmark('Acme Labs'), { wordmarkPrimary: 'Acme', wordmarkAccent: 'Labs' })
  assert.deepEqual(defaultWordmark('Acme'), { wordmarkPrimary: 'Acme', wordmarkAccent: '' })
  const applied = applyBrand(TEMPLATES[0], { productName: 'Northwind Goods' })
  assert.equal(applied.tokens.brand.wordmarkPrimary, 'Northwind')
  assert.equal(applied.tokens.brand.wordmarkAccent, 'Goods')
})

check('Cursor prompt names the file, packages, imports and guardrails', () => {
  for (const t of TEMPLATES) {
    const prompt = buildCursorPrompt(t)
    assert.ok(prompt.includes(GUIDE_FILENAME))
    assert.ok(prompt.includes(t.type.display.package))
    for (const imp of t.type.display.imports) assert.ok(prompt.includes(`"${imp}"`))
    assert.match(prompt, /Do not touch/)
    assert.match(prompt, /seo-core/)
    assert.match(prompt, /npm run build/)
  }
})

check('getImageryContext reads a v3 guide and rejects empty input', () => {
  const alpine = TEMPLATES.find((t) => t.template === 'alpine')
  const guide = buildDesignGuide(alpine, { brandName: 'Acme Labs' })
  const brief = getImageryContext(guide)
  assert.match(brief, /Treatment: editorial-landscape/)
  assert.match(brief, /Avoid: Stock-photo/)
  assert.match(brief, /accent #F97A1F/)
  assert.deepEqual(getImageryPalette(guide), { fg: '#171D26', bg: '#F8FAFC', accent: '#F97A1F', highlight: '#F97A1F' })
  assert.equal(getImageryContext(''), '')
  assert.equal(getImageryContext('no fence here'), '')
  assert.equal(getImageryContext('```tokens\nnot-json\n```'), '')
})

console.log(`\n${passed} passed`)
