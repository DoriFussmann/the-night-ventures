export const GENERATE_ARTICLE_MODEL = 'claude-sonnet-4-6'

export const TASK_INSTRUCTION = `Write the complete article body and all synthesized frontmatter fields for the spec above.

BODY REQUIREMENTS:
- Use the provided keyMessages as the article's argument spine — expand, evidence, and structure them into flowing prose with proper H2/H3 markdown headings; do not simply restate them as a list.
- If Expert Input is present (non-empty) in the spec, treat it as the lead key message: give it spotlight and let it shape the article's distinctive angle, typically as the opening thesis or the first fully developed argument. Continue to cover every other keyMessage with real substance — Expert Input is a primary thread, not the whole article. Integrate it as the author's own informed view; do not label a section "Expert Input" or quote it as an attributed aside. If Expert Input is blank or omitted, ignore this rule and use only the listed keyMessages.
- Target the specified wordCount (+/- 10%).
- Land the ctaAngle naturally within the final 2-3 paragraphs — it must read as genuine, earned advice, never as an ad.
- Do NOT include an 'Where Things Stand' section inline in your normal flow — add it as its own final section, described below.
- Do NOT invent internal links, external links, author names, or images — these are handled separately. Do not write placeholder link text or images into the body.
- When incorporating facts, statistics, or claims found via web search, integrate them fully into the surrounding paragraph's sentence flow — never place a search-derived fact as an isolated single-sentence line separated from its paragraph by blank lines. Every sentence must belong to a paragraph of at least 2-3 sentences. Before finalizing the body, scan for and merge any orphaned single-sentence lines into their adjacent paragraph.

WHERE THINGS STAND SECTION (mandatory, comes after the main body, before any closing note):
- Search the web for genuine news, data, or developments related to this article's topic from the past 45 days.
- Write one grounded paragraph (100-150 words) synthesizing what you find. If you find nothing substantive from the past 45 days, write a brief paragraph noting the topic is stable with no major recent developments, rather than fabricating news.
- This section is entirely search-derived: integrate every fact, statistic, or claim fully into the paragraph's sentence flow — never place a search-derived fact as an isolated single-sentence line separated by blank lines. The Where Things Stand content must be one cohesive paragraph of at least 2-3 sentences (preferably more), not a stack of orphaned one-liners. Before finalizing, scan for and merge any orphaned single-sentence lines into that paragraph.
- Do not name specific publications or outlets by name (e.g. "The Wall Street Journal reported...") unless you can also provide the source URL. Instead attribute generically ("recent reporting indicates...", "data from Q2 2026 shows..."). Separately from the body, include a new JSON field whereThingsStandSources: an array of { url, note } for any web-search sources actually used in that paragraph, so they can be manually added to externalLinks later.
- Wrap this section exactly like this in the markdown body:
## Where Things Stand
<!-- WHERE-THINGS-STAND:START -->
<the paragraph>
<!-- WHERE-THINGS-STAND:END -->

FRONTMATTER: Generate title, description, slug, tags, imageAlt, faqs per the constraints above. keywords may be omitted or left empty — the server overwrites them. Also set: date and updatedDate to today's date (ISO format), category to the pillar keyword name, draft to true, author to null, internalLinks to an empty array, externalLinks to an empty array, image/image2/image3 to null. Include whereThingsStandSources as an array of { url, note } for sources used in the Where Things Stand paragraph (empty array if none). Include competitorsMentioned: an array of every specific brand, company, or product name named anywhere in the article body (not generic category references). List every specific brand or company name mentioned in the body, even ones from the KNOWN COMPETITORS list. If none were mentioned, return an empty array.

OUTPUT FORMAT (mandatory — do not wrap in markdown fences, do not write any preamble or closing note):
<<<FRONTMATTER>>>
{ "title", "description", "slug", "date", "updatedDate", "category", "tags": [], "imageAlt", "keywords": [], "faqs": [{"question","answer"}], "draft": true, "author": null, "internalLinks": [], "externalLinks": [], "image": null, "image2": null, "image3": null, "whereThingsStandSources": [{"url","note"}], "competitorsMentioned": [] }
<<<BODY>>>
<full markdown body as plain text with real newlines, including the Where Things Stand section>
<<<END>>>`

function asStringArray(value) {
  if (!Array.isArray(value)) return []
  return value.map((item) => String(item || '').trim()).filter(Boolean)
}

export function normalizeCompetitors(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      name: String(item.name || '').trim(),
      url: String(item.url || '').trim(),
    }))
    .filter((item) => item.name || item.url)
}

export function normalizeBatchContext(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((item) => item && typeof item === 'object')
    .map((item) => ({
      title: String(item.title || '').trim(),
      slug: String(item.slug || '').trim(),
      type: String(item.type || '').trim(),
      targetKeyword: String(item.targetKeyword || '').trim(),
      oneLinerSummary: String(item.oneLinerSummary || '').trim(),
    }))
    .filter((item) => item.title || item.slug || item.targetKeyword)
}

export function normalizeArticleSpec(raw) {
  const article = raw && typeof raw === 'object' ? raw : {}
  const wordCountRaw = Number(article.wordCount)
  return {
    title: String(article.title || '').trim(),
    targetKeyword: String(article.targetKeyword || '').trim(),
    type: String(article.type || '').trim() || 'flex',
    searchIntent: String(article.searchIntent || '').trim(),
    wordCount: Number.isFinite(wordCountRaw) ? wordCountRaw : 1500,
    ctaAngle: String(article.ctaAngle || '').trim(),
    keyMessages: asStringArray(article.keyMessages),
    expertInput: String(article.expertInput || '').trim(),
  }
}

function audienceInstructionLine(audience) {
  if (audience) return `Audience: ${audience}.`
  return 'Audience: infer the likely audience from the company positioning above.'
}

function expertInputSection(expertInput) {
  if (!expertInput) return []
  return [
    '',
    'EXPERT INPUT (lead key message — give it spotlight, but do not make the article only about this):',
    'The editor provided first-hand expert perspective below. Treat it as the top key message: give it prominent coverage and let it shape the article\'s distinctive angle (typically as the opening thesis or first fully developed argument). Continue to cover every other keyMessage in the spec with real substance — this input is a primary thread, not the whole article. Integrate it as the author\'s own informed view; do not label a section "Expert Input" or quote it as an attributed aside.',
    expertInput,
  ]
}

export function buildUserPrompt({
  abstract,
  shortDescription,
  competitors,
  audience,
  article,
  pillarKeyword,
  supportingKeyword,
  batchContext,
}) {
  const spec = normalizeArticleSpec(article)
  const knownCompetitors = normalizeCompetitors(competitors)
  const context = normalizeBatchContext(batchContext)

  const parts = [
    'Company positioning:',
    `Abstract: ${abstract || '(not set)'}`,
    `Short Description: ${shortDescription || '(not set)'}`,
    '',
  ]

  if (knownCompetitors.length > 0) {
    parts.push(
      'KNOWN COMPETITORS (use ONLY these as the competitor set — do not research, invent, or add other competitors):'
    )
    for (const competitor of knownCompetitors) {
      const label = competitor.name || '(unnamed)'
      const url = competitor.url || '(no url)'
      parts.push(`- ${label}: ${url}`)
    }
    parts.push(
      'If the article discusses or compares alternatives/other products, you may describe them generically (e.g. "other prompted journals" or "mass-market alternatives") WITHOUT naming a specific brand, UNLESS that brand is in the known competitors list above. Never name a brand, company, or product that is not in this list.'
    )
  } else {
    parts.push('KNOWN COMPETITORS: (none saved)')
    parts.push(
      'No competitor brands are authorized. If the article discusses or compares alternatives/other products, describe them ONLY generically (e.g. "other prompted journals" or "mass-market alternatives") — do not name any specific brand, company, or product.'
    )
  }

  parts.push(
    '',
    'Article plan spec:',
    JSON.stringify(
      {
        title: spec.title,
        targetKeyword: spec.targetKeyword,
        type: spec.type,
        searchIntent: spec.searchIntent,
        wordCount: spec.wordCount,
        ctaAngle: spec.ctaAngle,
        keyMessages: spec.keyMessages,
        expertInput: spec.expertInput || '',
        pillarKeyword,
        supportingKeyword: supportingKeyword || null,
      },
      null,
      2
    ),
    ...expertInputSection(spec.expertInput),
    '',
    'Batch context so far (sibling articles already generated in this run — for tonal coherence only; do NOT invent internal links to them):',
    context.length > 0
      ? JSON.stringify(context, null, 2)
      : '(none yet — this is the first article in the batch)',
    '',
    'CONTENT CONTRACT CONSTRAINTS (enforce exactly):',
    '- title: MUST be between 55 and 60 characters total (count every character including spaces and punctuation). Aim for 57-58 to leave safety margin. Before finalizing, count the characters in your title.',
    '- description: MUST be between 140 and 160 characters total (count every character including spaces and punctuation). Aim for 148-152 to leave safety margin. Before finalizing, count the characters in your description. Must be a genuine meta description (not a restated title).',
    '- slug: kebab-case, derived from the target keyword, url-safe',
    '- tags: exactly 4-6 strings, mix of broad category terms and the specific target keyword',
    '- imageAlt: minimum 10 characters, genuinely descriptive of a plausible hero image for this article (even though the real image is added manually later)',
    '- keywords: optional in your JSON (server overwrites from targetKeyword / supportingKeyword / pillarKeyword).',
    '- whereThingsStandSources: array of { url, note } for web-search sources actually used in the Where Things Stand paragraph (empty array if none).',
    '- competitorsMentioned: array of every specific brand/company/product name mentioned anywhere in the article body (not generic category references). List every specific brand or company name mentioned in the body, even ones from the KNOWN COMPETITORS list. If none were mentioned, return an empty array.',
    '- faqs: array of 2-4 { question, answer } objects, genuinely useful, distinct from the body content, not filler',
    '',
    audienceInstructionLine(audience),
    '',
    TASK_INSTRUCTION,
  )

  return parts.join('\n')
}
