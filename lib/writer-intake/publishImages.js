// Publish-time handling of inline images kept from a writer's document.
// A draft body references them as ![alt](tnv-image:<companyId>/…); the
// published markdown references the committed copies next to the hero:
// site/src/assets/articles/<slug>-2.png, -3.png, … (relative to the article).

import { tnvImageRefs } from './markdown.js'

export const INLINE_ASSETS_DIR = 'site/src/assets/articles'
const RELATIVE_FROM_ARTICLE = '../../assets/articles'
const EXT_RE = /\.(png|jpe?g|webp|gif)$/i

function extOf(path) {
  const match = String(path || '').match(EXT_RE)
  if (!match) return ''
  const ext = match[1].toLowerCase()
  return ext === 'jpeg' ? 'jpg' : ext
}

export function isAllowedImagePath(path, companyId) {
  const value = String(path || '')
  return (
    Boolean(companyId) &&
    value.startsWith(`${companyId}/`) &&
    !value.includes('..') &&
    !value.includes('//') &&
    Boolean(extOf(value))
  )
}

/**
 * @param {string} markdown
 * @param {{ companyId: string, slug: string, download: (path: string) => Promise<string|null> }} opts
 *   download returns base64 or null.
 * @returns {Promise<{ markdown: string, files: Array<{ path: string, base64: string }>, error?: string }>}
 */
export async function resolveInlineImages(markdown, { companyId, slug, download }) {
  const refs = tnvImageRefs(markdown)
  if (refs.length === 0) return { markdown: String(markdown || ''), files: [] }

  const byPath = new Map()
  const files = []
  for (const ref of refs) {
    if (byPath.has(ref.path)) continue
    if (!isAllowedImagePath(ref.path, companyId)) {
      return { markdown, files: [], error: `Inline image ${ref.path} is not one of this company's images.` }
    }
    const base64 = await download(ref.path)
    if (!base64) {
      return { markdown, files: [], error: `Inline image ${ref.path} could not be loaded from storage.` }
    }
    const filename = `${slug}-${files.length + 2}.${extOf(ref.path)}`
    files.push({ path: `${INLINE_ASSETS_DIR}/${filename}`, base64 })
    byPath.set(ref.path, `${RELATIVE_FROM_ARTICLE}/${filename}`)
  }

  let out = String(markdown || '')
  for (const ref of refs) {
    out = out.split(ref.match).join(`![${ref.alt}](${byPath.get(ref.path)})`)
  }
  return { markdown: out, files }
}
