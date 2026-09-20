// Shared frontmatter handling for TNV tools.
//
// DL-8: TNV must parse frontmatter with a REAL YAML parser, not regex. This
// module is the single place that turns a markdown document's frontmatter into
// structured data. Line-by-line regex parsing silently mis-reads valid YAML
// (flow-style arrays, comments, quoting variants, anchors), which is exactly
// how drift and bad wiring creep in. js-yaml is used with the JSON schema so
// that dates stay strings (no Date coercion) and no unsafe/legacy YAML 1.1
// types resolve — matching the string-in/string-out contract the tools expect.
//
// Note on the WRITE side: the link-wiring tools deliberately do surgical,
// diff-minimal string edits of individual frontmatter blocks and never
// re-serialize the whole thing (re-serializing reorders keys and blows up git
// diffs). That is correct and stays. This module governs READING only.

import yaml from 'js-yaml'

// Isolate the frontmatter block from a markdown document WITHOUT interpreting
// it. This is not YAML parsing — it just finds the `---` fenced block so the
// raw YAML text and the raw body can be handed to callers (the write path needs
// the verbatim text to do surgical block replacement). `ok` is false when no
// valid fence pair exists.
export function splitFrontmatter(raw) {
  const text = String(raw || '').replace(/^\uFEFF/, '')
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n)?([\s\S]*)$/)
  if (!match) return { yaml: '', body: text, ok: false }
  return { yaml: match[1], body: match[2] || '', ok: true }
}

// Parse an isolated YAML frontmatter block with a real parser. Throws on
// malformed YAML (callers decide whether to refuse or degrade). Returns a plain
// object; an empty block is `{}`. A non-mapping top level (a bare scalar or a
// list) is treated as malformed — frontmatter must be a mapping.
export function parseYaml(yamlText) {
  const data = yaml.load(String(yamlText || ''), { schema: yaml.JSON_SCHEMA })
  if (data == null) return {}
  if (typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('frontmatter is not a YAML mapping')
  }
  return data
}

// Split + parse in one step. Never throws. On malformed YAML returns
// `ok:false` with the error attached, so a bad document is refused rather than
// silently mis-parsed. `ok:false` with `error:null` means there was no
// frontmatter fence at all.
export function parseFrontmatter(raw) {
  const split = splitFrontmatter(raw)
  if (!split.ok) {
    return { data: {}, body: split.body, yaml: '', ok: false, error: null }
  }
  try {
    const data = parseYaml(split.yaml)
    return { data, body: split.body, yaml: split.yaml, ok: true, error: null }
  } catch (err) {
    return { data: {}, body: split.body, yaml: split.yaml, ok: false, error: err }
  }
}
