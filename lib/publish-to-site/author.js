// Make an article's `author` point at a team member that exists on the site.
// The site build fails on an author id with no file in site/src/content/team/,
// so publishing keeps the article's author when the site has it and otherwise
// uses the site's first team member (alphabetical).

import { splitFrontmatter, parseYaml } from '../frontmatter.js'

export const TEAM_CONTENT_DIR = 'site/src/content/team'

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
export function resolveArticleAuthor(markdown, teamSlugs) {
  const split = splitFrontmatter(markdown)
  if (!split.ok) return { error: 'Article has no frontmatter' }
  if (!teamSlugs.length) {
    return {
      error: `The site has no team member in ${TEAM_CONTENT_DIR}/ — add one (for example jane-doe.md) before publishing articles.`,
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
