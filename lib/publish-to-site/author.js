// Make an article's `author` point at a team member that exists on the site.
// The site build fails on an author id with no file in site/src/content/team/,
// so publishing keeps the article's author when the site has it and otherwise
// uses the site's first team member (alphabetical).

import { splitFrontmatter, parseYaml } from '../frontmatter.js'

export const TEAM_CONTENT_DIR = 'site/src/content/team'
export const CONTENT_CONFIG_PATHS = [
  'site/src/content.config.ts',
  'site/src/content.config.mjs',
  'site/src/content.config.js',
  'site/src/content/config.ts',
]

/**
 * The folder of the site's author collection, from its content config: the
 * collection built with teamSchema (or named team / authors), via its glob base.
 * Falls back to site/src/content/team.
 */
export function teamDirFromContentConfig(text) {
  const source = String(text || '')
  const blocks = source.split(/(?=\bconst\s+\w+\s*=\s*defineCollection\s*\()/)
  const pick =
    blocks.find((b) => /teamSchema|authorSchema/.test(b)) ||
    blocks.find((b) => /\bconst\s+(team|authors?)\s*=/.test(b))
  const base = pick?.match(/base:\s*["'`]\.?\/?(src\/content\/[\w./-]+?)\/?["'`]/)
  return base ? `site/${base[1]}` : TEAM_CONTENT_DIR
}

/** Team member ids from a GitHub directory listing (`{slug}.md` files). */
export function teamSlugsFromListing(entries) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => entry?.type === 'file' && /^[a-z0-9]+(?:-[a-z0-9]+)*\.md$/i.test(String(entry.name || '')))
    .map((entry) => String(entry.name).replace(/\.md$/i, ''))
    .sort()
}

/**
 * @param {string} markdown full article markdown with frontmatter
 * @param {string[]} teamSlugs ids that exist on the site
 * @returns {{ markdown: string, author: string, changed: boolean } | { error: string }}
 */
export function resolveArticleAuthor(markdown, teamSlugs, teamDir = TEAM_CONTENT_DIR) {
  const split = splitFrontmatter(markdown)
  if (!split.ok) return { error: 'Article has no frontmatter' }
  if (!teamSlugs.length) {
    return {
      error: `The site has no team member in ${teamDir}/ — add one (for example jane-doe.md) before publishing articles.`,
    }
  }

  let current = ''
  try {
    current = String(parseYaml(split.yaml).author ?? '').trim()
  } catch {
    return { error: 'Article frontmatter is not valid YAML' }
  }
  if (teamSlugs.includes(current)) return { markdown, author: current, changed: false }

  const author = teamSlugs[0]
  const line = `author: "${author}"`
  const yaml = /^author:.*$/m.test(split.yaml)
    ? split.yaml.replace(/^author:.*$/m, line)
    : `${split.yaml}\n${line}`
  const eol = markdown.includes('\r\n') ? '\r\n' : '\n'
  return { markdown: `---${eol}${yaml}${eol}---${eol}${split.body}`, author, changed: true }
}
