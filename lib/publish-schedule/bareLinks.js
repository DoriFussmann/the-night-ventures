/**
 * The writer sometimes leaves an own-site address in plain brackets
 * ("book at [heyrupert.com/book-call/]") instead of a link. Turn each such
 * bracket into a real markdown link to the site path, keeping its text.
 *
 * Matches only brackets not already followed by "(" (a link) or ":" (a
 * reference definition), whose whole text is an own-domain address or a
 * site path like "/book-call/". Other brackets ("[city]", "[X fund]") are
 * left alone, as is anything inside code.
 */
export function linkBareSiteBrackets(body, domain = '') {
  const host = String(domain || '')
    .trim()
    .replace(/^https?:\/\//i, '')
    .replace(/^www\./i, '')
    .replace(/\/.*$/, '')
    .toLowerCase()
  const hostRe = host ? host.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : null
  const own = hostRe ? new RegExp(`^(?:https?://)?(?:www\\.)?${hostRe}(/[^\\s\\]]*)?$`, 'i') : null
  const parts = String(body || '').split(/(```[\s\S]*?```|`[^`\n]*`)/)
  let changed = 0
  const out = parts.map((part, i) => {
    if (i % 2 === 1) return part
    return part.replace(/(^|[^!\]])\[([^\]\n]{1,120})\](?![(:[])/g, (all, lead, text) => {
      const t = text.trim()
      let path = null
      const m = own ? t.match(own) : null
      if (m) path = m[1] || '/'
      else if (/^\/[a-z0-9][a-z0-9\-/]*$/i.test(t)) path = t
      if (!path) return all
      if (!path.endsWith('/') && !/\.[a-z0-9]{2,5}$/i.test(path)) path += '/'
      changed += 1
      return `${lead}[${t}](${path})`
    })
  })
  return { body: out.join(''), changed }
}
