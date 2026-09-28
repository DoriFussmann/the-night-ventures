export function yamlEscape(value) {
  const text = String(value ?? '')
  if (
    text === '' ||
    /[:#{}[\],&*?|>!%@`]/.test(text) ||
    /^\s|\s$/.test(text) ||
    text.includes('\n') ||
    text.includes('"') ||
    /^(true|false|null|yes|no|on|off)$/i.test(text)
  ) {
    return `"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')}"`
  }
  return text
}

export function todayIso(now = new Date()) {
  const y = now.getFullYear()
  const m = String(now.getMonth() + 1).padStart(2, '0')
  const d = String(now.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

export function renderExternalLinksYaml(links) {
  const list = Array.isArray(links) ? links.filter((l) => l?.url) : []
  if (list.length === 0) return 'externalLinks: []'
  const lines = ['externalLinks:']
  for (const link of list) {
    lines.push(`  - label: ${yamlEscape(link.label || link.url)}`)
    lines.push(`    url: ${yamlEscape(link.url)}`)
    lines.push(`    addedAt: ${yamlEscape(link.addedAt || todayIso())}`)
    if (link.kind) lines.push(`    kind: ${yamlEscape(link.kind)}`)
  }
  return lines.join('\n')
}
