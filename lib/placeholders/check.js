// Placeholder checker: runs a placeholder manifest against one site's files.
//
// Plain-JS port of seo-core's src/placeholders/check.ts (seo-core ships
// TypeScript, which the Vercel functions here do not compile). Keep the two in
// step: same statuses, same rules per check kind. The manifest itself is NOT
// copied by hand — TNV reads blueprint.json from seo-core's latest tag
// (manifest.js), with blueprint.json here only as an offline fallback.
//
// Statuses: placeholder (template content still there), replaced, review
// (template text gone, a person must confirm), unknown (could not check).

import { createHash } from 'node:crypto'

const MAX_FINDINGS = 50
const MAX_DETAIL = 140

/** Glob → RegExp over "/"-separated paths. Supports `**`, `*` and `?`. */
export function globToRegExp(glob) {
  let out = ''
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        out += '(?:.*/)?'
        i += 2
      } else {
        out += '.*'
        i += 1
      }
    } else if (c === '*') out += '[^/]*'
    else if (c === '?') out += '[^/]'
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  }
  return new RegExp(`^${out}$`)
}

const asList = (value) => (Array.isArray(value) ? value : [value])

function matchFiles(all, patterns, exclude = []) {
  const include = asList(patterns).map(globToRegExp)
  const skip = exclude.map(globToRegExp)
  return all.filter((p) => include.some((re) => re.test(p)) && !skip.some((re) => re.test(p))).sort()
}

const toText = (content) => (typeof content === 'string' ? content : Buffer.from(content).toString('utf8'))

function clip(text) {
  const flat = String(text).replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DETAIL ? `${flat.slice(0, MAX_DETAIL - 1)}…` : flat
}

function lineAt(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

async function readText(files, path) {
  const content = await files.read(path)
  return content === null || content === undefined ? null : toText(content)
}

/** SHA-256 hex; SVG line endings normalized to LF (matches the blueprint audit). */
export function templateFileHash(path, content) {
  const bytes = typeof content === 'string' ? Buffer.from(content, 'utf8') : Buffer.from(content)
  const data = path.toLowerCase().endsWith('.svg') ? Buffer.from(bytes.toString('utf8').replace(/\r\n/g, '\n')) : bytes
  return createHash('sha256').update(data).digest('hex')
}

/** YAML `image:` briefs with no `src:` key in the same mapping (line-based). */
export function findImageBriefsWithoutSrc(yaml) {
  const lines = String(yaml).split(/\r?\n/)
  const out = []
  const keyAt = (line) => {
    const m = line.match(/^(\s*)(-\s+)?([A-Za-z0-9_-]+):(?:\s|$)/)
    if (!m) return null
    return { col: m[1].length + (m[2] ? m[2].length : 0), key: m[3], dash: Boolean(m[2]) }
  }
  const indentOf = (line) => line.match(/^\s*/)?.[0].length ?? 0
  const blank = (line) => /^\s*(#.*)?$/.test(line)

  lines.forEach((line, i) => {
    const key = keyAt(line)
    if (!key || key.key !== 'image') return
    const brief = line.replace(/^\s*(-\s+)?image:\s*/, '').trim()
    if (!brief || brief === '|' || brief === '>') return
    const col = key.col
    let hasSrc = false
    if (!key.dash) {
      for (let j = i - 1; j >= 0; j--) {
        const l = lines[j]
        if (blank(l)) continue
        const k = keyAt(l)
        if (k && k.col === col && k.key === 'src') hasSrc = true
        if (k && k.dash && k.col === col) break
        if (indentOf(l) < col) break
      }
    }
    for (let j = i + 1; j < lines.length && !hasSrc; j++) {
      const l = lines[j]
      if (blank(l)) continue
      const k = keyAt(l)
      if (k && k.dash && k.col <= col) break
      if (!k?.dash && indentOf(l) < col) break
      if (k && k.col === col && k.key === 'src') hasSrc = true
    }
    if (!hasSrc) out.push({ line: i + 1, brief })
  })
  return out
}

async function runCheck(check, files, all) {
  const findings = []
  const add = (finding) => {
    if (findings.length < MAX_FINDINGS) findings.push(finding)
  }

  switch (check.kind) {
    case 'markers': {
      const matched = matchFiles(all, check.files, check.exclude)
      if (!matched.length) {
        const status = check.missing ?? 'unknown'
        return { status, findings: status === 'unknown' ? [{ file: asList(check.files).join(', '), detail: 'File not found' }] : [] }
      }
      let hits = 0
      for (const path of matched) {
        const text = await readText(files, path)
        if (text === null) continue
        const seen = new Set()
        for (const marker of check.markers) {
          let from = 0
          for (;;) {
            const at = text.indexOf(marker, from)
            if (at < 0) break
            from = at + marker.length
            const line = lineAt(text, at)
            if (seen.has(line)) continue
            seen.add(line)
            hits++
            add({ file: path, line, detail: clip(text.split(/\r?\n/)[line - 1] ?? marker) })
          }
        }
      }
      findings.sort((a, b) => a.file.localeCompare(b.file) || (a.line ?? 0) - (b.line ?? 0))
      return { status: hits ? 'placeholder' : 'replaced', findings }
    }

    case 'value': {
      const text = all.includes(check.file) ? await readText(files, check.file) : null
      if (text === null) return { status: 'unknown', findings: [{ file: check.file, detail: 'File not found' }] }
      let matchedAny = false
      for (const source of check.patterns) {
        const m = new RegExp(source, 'm').exec(text)
        if (!m) continue
        matchedAny = true
        const value = (m[1] ?? '').trim()
        if (check.placeholders.includes(value)) {
          add({ file: check.file, line: lineAt(text, m.index), detail: value ? `Still "${clip(value)}"` : 'Empty' })
        }
      }
      if (!matchedAny) return { status: 'unknown', findings: [{ file: check.file, detail: 'Setting not found' }] }
      return { status: findings.length ? 'placeholder' : 'replaced', findings }
    }

    case 'exists': {
      for (const path of matchFiles(all, check.files)) add({ file: path, detail: 'Template file still present' })
      return { status: findings.length ? 'placeholder' : 'replaced', findings }
    }

    case 'originals': {
      const raw = all.includes(check.hashes) ? await readText(files, check.hashes) : null
      if (raw === null) return { status: 'unknown', findings: [{ file: check.hashes, detail: 'Template hash list not found' }] }
      let originals
      try {
        originals = JSON.parse(raw)
      } catch {
        return { status: 'unknown', findings: [{ file: check.hashes, detail: 'Template hash list is not valid JSON' }] }
      }
      const byHash = new Map(Object.entries(originals).map(([path, hash]) => [String(hash).toLowerCase(), path]))
      const inDirs = all.filter((p) => check.dirs.some((dir) => p.startsWith(`${dir.replace(/\/+$/, '')}/`))).sort()
      // Readers over a network can fetch these in parallel first.
      if (typeof files.prefetch === 'function') await files.prefetch(inDirs)
      for (const path of inDirs) {
        const content = await files.read(path)
        if (content === null || content === undefined) continue
        const original = byHash.get(templateFileHash(path, content))
        if (original) add({ file: path, detail: original === path ? 'Template original' : `Copy of the template's ${original}` })
      }
      return { status: findings.length ? 'placeholder' : 'replaced', findings }
    }

    case 'imageBriefs': {
      for (const path of matchFiles(all, check.files)) {
        const text = await readText(files, path)
        if (text === null) continue
        for (const { line, brief } of findImageBriefsWithoutSrc(text)) add({ file: path, line, detail: clip(brief) })
      }
      return { status: findings.length ? 'placeholder' : 'replaced', findings }
    }

    default:
      return { status: 'unknown', findings: [{ file: '', detail: `Unknown check kind "${check.kind}" (update TNV)` }] }
  }
}

function count(results) {
  const c = { total: results.length, placeholder: 0, replaced: 0, review: 0, unknown: 0 }
  for (const r of results) c[r.status]++
  return c
}

/**
 * @param {{ list(): string[]|Promise<string[]>, read(path: string): any, prefetch?(paths: string[]): Promise<void> }} files
 * @param {{ version: number, template: string, checks: object[] }} manifest
 */
export async function checkPlaceholders(files, manifest) {
  const all = (await files.list()).map((p) => String(p).replace(/\\/g, '/').replace(/^\.?\/+/, ''))
  const results = []
  for (const check of manifest.checks || []) {
    let outcome
    try {
      outcome = await runCheck(check, files, all)
    } catch (err) {
      outcome = { status: 'unknown', findings: [{ file: '', detail: `Check failed: ${clip(err?.message ?? err)}` }] }
    }
    const review = Boolean(check.review)
    results.push({
      id: check.id,
      label: check.label,
      group: check.group,
      level: check.level ?? 'required',
      review,
      ...(check.help ? { help: check.help } : {}),
      ...(check.steps?.length ? { steps: check.steps } : {}),
      ...(check.prompt ? { prompt: check.prompt } : {}),
      status: outcome.status === 'replaced' && review ? 'review' : outcome.status,
      findings: outcome.findings,
    })
  }
  const required = count(results.filter((r) => r.level === 'required'))
  const suggested = count(results.filter((r) => r.level === 'suggested'))
  return {
    template: manifest.template,
    manifestVersion: manifest.version,
    results,
    required,
    suggested,
    clear: required.placeholder === 0 && required.unknown === 0,
  }
}
