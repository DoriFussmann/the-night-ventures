export const WTS_START = '<!-- WHERE-THINGS-STAND:START -->'
export const WTS_END = '<!-- WHERE-THINGS-STAND:END -->'

function countOccurrences(source, token) {
  if (!token) return 0
  let count = 0
  let idx = 0
  const text = String(source || '')
  while (idx < text.length) {
    const found = text.indexOf(token, idx)
    if (found === -1) break
    count += 1
    idx = found + token.length
  }
  return count
}

/**
 * Replace only the inner content between WTS markers. Markers and everything
 * else in the file are left untouched.
 */
export function replaceWtsSection(raw, newParagraph) {
  const source = String(raw || '')
  const paragraph = String(newParagraph || '').trim()
  if (!paragraph) {
    return { ok: false, error: 'proposed paragraph is empty' }
  }

  const startCount = countOccurrences(source, WTS_START)
  const endCount = countOccurrences(source, WTS_END)
  if (startCount !== 1 || endCount !== 1) {
    return {
      ok: false,
      error:
        startCount === 0 || endCount === 0
          ? 'Could not find WHERE-THINGS-STAND markers in the live markdown'
          : 'WHERE-THINGS-STAND markers are not unique in the live markdown',
    }
  }

  const startIdx = source.indexOf(WTS_START)
  const endIdx = source.indexOf(WTS_END)
  if (endIdx <= startIdx) {
    return {
      ok: false,
      error: 'WHERE-THINGS-STAND markers are out of order',
    }
  }

  const before = source.slice(0, startIdx + WTS_START.length)
  const after = source.slice(endIdx)
  const content = `${before}\n${paragraph}\n${after}`
  return { ok: true, content, changed: content !== source }
}

/**
 * Surgical `updatedDate` bump in frontmatter. Does not re-serialize YAML.
 * If the key is missing, insert it immediately after `date:` when present.
 */
export function bumpUpdatedDate(raw, isoDate) {
  const source = String(raw || '')
  const date = String(isoDate || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return source

  if (/^updatedDate:\s*.*$/m.test(source)) {
    return source.replace(/^updatedDate:\s*.*$/m, `updatedDate: ${date}`)
  }

  if (/^date:\s*.*$/m.test(source)) {
    return source.replace(/^(date:\s*.*)$/m, `$1\nupdatedDate: ${date}`)
  }

  return source
}
