/**
 * Hot takes bank: the expert's own positions, one per row (aeo_hot_takes).
 * Two requests run against it for one brief:
 *  - match: which takes in the bank already speak to this article's topic;
 *  - new:   draft one new take for this article from the existing ones.
 * The bank is the only source of opinion. Nothing here invents a stance,
 * a number or a client story.
 */
import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import { json } from '../seo-advisor/auth.js'

export const MAX_MATCHES = 8

function extractText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b?.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
}

function parseJson(text, what) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error(`${what} came back incomplete. Try again.`)
  try {
    return JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error(`${what} came back incomplete. Try again.`)
  }
}

/** One line per take, as the model reads the bank. */
export function bankLines(takes) {
  return takes.map((t) => `[${t.code}] (${t.topic || 'No topic'} · ${t.kind}) ${t.take}${t.note ? ` {note: ${t.note}}` : ''}`)
}

function articleLines({ title, angle, outline, group, pillar, prompts }) {
  const sections = (Array.isArray(outline) ? outline : []).map((s) => `- ${s.heading}`)
  return [
    `Article: ${title || group?.name || ''}`,
    `Theme: ${pillar?.name || '(none)'}`,
    angle ? `Angle: ${angle}` : '',
    sections.length ? 'Sections:' : '',
    ...sections,
    '',
    'Buyer questions the article answers:',
    ...(prompts || []).slice(0, 12).map((p) => `- ${p.prompt}`),
  ]
}

export function buildMatchPrompt({ takes, title, angle, outline, group, pillar, prompts }) {
  const lines = [
    'An expert keeps a bank of their own positions ("hot takes"). Pick the takes that belong in one article: the ones that already say something on what this article covers.',
    '',
    ...articleLines({ title, angle, outline, group, pillar, prompts }),
    '',
    'The bank (code, topic, kind, take):',
    ...bankLines(takes),
    '',
    `Rules: pick at most ${MAX_MATCHES}, most relevant first. A take belongs only if it speaks to this article's topic or to one of its buyer questions; a take that is merely on the same broad theme does not. Prefer opinions, methods and frameworks over company facts. If two picked takes disagree with each other, still return both and say so in "conflicts". If nothing in the bank fits, return an empty list. Use only codes from the bank.`,
    '',
    'Return JSON only, no markdown fences:',
    '{"matches":[{"code":"R001","why":"one short line: what in this article it speaks to"}],"conflicts":[{"codes":["R001","R002"],"why":"one short line"}]}',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

export function parseMatches(text, takes) {
  const parsed = parseJson(text, 'The matches')
  const known = new Set(takes.map((t) => t.code))
  const seen = new Set()
  const matches = (Array.isArray(parsed.matches) ? parsed.matches : [])
    .map((m) => ({ code: String(m?.code || '').trim(), why: String(m?.why || '').trim() }))
    .filter((m) => known.has(m.code) && !seen.has(m.code) && seen.add(m.code))
    .slice(0, MAX_MATCHES)
  const conflicts = (Array.isArray(parsed.conflicts) ? parsed.conflicts : [])
    .map((c) => ({
      codes: (Array.isArray(c?.codes) ? c.codes : []).map((x) => String(x || '').trim()).filter((x) => known.has(x)),
      why: String(c?.why || '').trim(),
    }))
    .filter((c) => c.codes.length >= 2)
  return { matches, conflicts }
}

export function buildNewTakePrompt({ voice, takes, current, title, angle, outline, group, pillar, prompts }) {
  const lines = [
    'An expert keeps a bank of their own positions ("hot takes"). Draft ONE new take for the article below, for the expert to edit. It must be a position the expert would plausibly hold, worked out from the takes already in the bank and applied to this article. It is a draft, not a fact about what the expert thinks.',
    '',
    `Who the expert is and how they write: ${voice || 'Practical, direct, no fluff.'}`,
    '',
    ...articleLines({ title, angle, outline, group, pillar, prompts }),
    '',
    current ? `Hot takes already on this article (do not repeat them):\n${current}` : '',
    '',
    'The bank (code, topic, kind, take):',
    ...bankLines(takes),
    '',
    'Rules: two to four sentences, first person, in the expert\'s plain wording. It takes a side on a question this article raises that no take in the bank answers yet. It follows from the bank: name the takes it builds on. It never contradicts a take in the bank. No invented numbers, results, client stories or names. If the bank gives no honest basis for a new take on this article, return an empty take and say why.',
    '',
    'Return JSON only, no markdown fences:',
    '{"take":"the new take","basedOn":["R001","R014"],"why":"one short line: the question it answers and how it follows from those takes"}',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

export function parseNewTake(text, takes) {
  const parsed = parseJson(text, 'The new take')
  const known = new Set(takes.map((t) => t.code))
  return {
    take: String(parsed.take || '').trim(),
    basedOn: (Array.isArray(parsed.basedOn) ? parsed.basedOn : []).map((x) => String(x || '').trim()).filter((x) => known.has(x)),
    why: String(parsed.why || '').trim(),
  }
}

/** The active bank of a company, in code order. An empty list if there is none. */
export async function loadActiveTakes(supabase, companyId) {
  const { data, error } = await supabase
    .from('aeo_hot_takes')
    .select('code, topic, kind, take, note')
    .eq('company_id', companyId)
    .eq('status', 'active')
    .order('code')
  if (error) throw new Error(`Hot takes: ${error.message}`)
  return data || []
}

async function loadArticle(supabase, companyId, groupId) {
  const [{ data: group }, { data: prompts }] = await Promise.all([
    supabase.from('aeo_prompt_groups').select('*').eq('company_id', companyId).eq('id', groupId).maybeSingle(),
    supabase.from('aeo_prompts').select('prompt').eq('company_id', companyId).eq('group_id', groupId),
  ])
  if (!group) return null
  const { data: pillar } = group.pillar_id
    ? await supabase.from('aeo_pillars').select('name').eq('id', group.pillar_id).maybeSingle()
    : { data: null }
  return { group, pillar, prompts: prompts || [] }
}

/** mode "hot_takes_match" and "hot_take_new" of /api/aeo-brief-outline. */
export async function handleHotTakes({ res, supabase, body, companyId, groupId, apiKey }) {
  const [takes, article] = await Promise.all([loadActiveTakes(supabase, companyId), loadArticle(supabase, companyId, groupId)])
  if (!article) return json(res, 404, { error: 'Prompt group not found' })
  if (!takes.length) return json(res, 400, { error: 'The hot takes bank is empty. Add or import takes first.' })
  const brief = { title: String(body.title || ''), angle: String(body.angle || ''), outline: body.outline, ...article }
  const anthropic = new Anthropic({ apiKey })

  if (body.mode === 'hot_take_new') {
    const { data: playbook } = await supabase.from('aeo_playbook').select('key_points_voice').eq('company_id', companyId).maybeSingle()
    const message = await anthropic.messages.create({
      model: GENERATE_ARTICLE_MODEL,
      max_tokens: 1000,
      messages: [{
        role: 'user',
        content: buildNewTakePrompt({ voice: String(playbook?.key_points_voice || '').trim(), takes, current: String(body.current || '').trim(), ...brief }),
      }],
    })
    return json(res, 200, parseNewTake(extractText(message.content), takes))
  }

  const message = await anthropic.messages.create({
    model: GENERATE_ARTICLE_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: buildMatchPrompt({ takes, ...brief }) }],
  })
  const byCode = new Map(takes.map((t) => [t.code, t]))
  const { matches, conflicts } = parseMatches(extractText(message.content), takes)
  return json(res, 200, {
    matches: matches.map((m) => ({ ...m, take: byCode.get(m.code).take, topic: byCode.get(m.code).topic, note: byCode.get(m.code).note })),
    conflicts,
  })
}
