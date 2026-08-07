/** Apex hostname (no protocol, path, or www). */
export function apexDomain(value) {
  let d = String(value || '').trim().toLowerCase()
  d = d.replace(/^https?:\/\//, '').replace(/^www\./, '')
  d = d.split('/')[0].split('?')[0].split('#')[0]
  return d.replace(/\.$/, '')
}

/** Prefer https://www.{apex} as the live site origin used across this build. */
export function wwwSiteUrl(value) {
  const apex = apexDomain(value)
  if (!apex) return null
  return `https://www.${apex}`
}

export function originFromUrl(siteUrl) {
  try {
    const u = new URL(siteUrl)
    return `${u.protocol}//${u.host}`
  } catch {
    return null
  }
}
