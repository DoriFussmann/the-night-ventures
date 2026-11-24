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

// How far a take from the bank may be changed when it is brought into an article or a theme view.
const REWORD_RULE =
  'Give each take as it should read here: keep the expert\'s wording where it already fits, and change the wording where that makes it speak to this topic (name the topic, drop a detail that belongs to another context, tighten). Never change what the take says, never add a claim, number, story or name that is not in it, and keep a {note} in mind.'

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
    `Rules: pick at most ${MAX_MATCHES}, strongest first: the takes that give this article a clear position. A take belongs only if it speaks to this article's topic or to one of its buyer questions; a take that is merely on the same broad theme does not. Prefer opinions, methods and frameworks over company facts. ${REWORD_RULE} If two picked takes disagree with each other, still return both and say so in "conflicts". If nothing in the bank fits, return an empty list. Use only codes from the bank.`,
    '',
    'Return JSON only, no markdown fences:',
    '{"matches":[{"code":"R001","text":"the take as it should read in this article","why":"one short line: what in this article it speaks to"}],"conflicts":[{"codes":["R001","R002"],"why":"one short line"}]}',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

export function parseMatches(text, takes) {
  const parsed = parseJson(text, 'The matches')
  const known = new Set(takes.map((t) => t.code))
  const seen = new Set()
  const matches = (Array.isArray(parsed.matches) ? parsed.matches : [])
    .map((m) => ({ code: String(m?.code || '').trim(), text: String(m?.text || '').trim(), why: String(m?.why || '').trim() }))
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

export const MAX_CONNECTIONS = 8

/** The strongest takes in the bank for one theme of the month, for the expert's theme view. */
export function buildThemeConnectionPrompt({ takes, pillar, articles, prompts, view }) {
  const lines = [
    `An expert keeps a bank of their own positions ("hot takes"). They are writing their view on one theme of this month's articles: ${pillar?.name || 'this theme'}. Connect the bank to the theme: bring the takes they have already made that belong in this view.`,
    '',
    'Articles in this theme this month:',
    ...articles.map((a) => `- ${a}`),
    '',
    'Questions buyers ask on these topics:',
    ...(prompts || []).slice(0, 15).map((p) => `- ${p}`),
    '',
    view ? `The view as written so far (do not bring what it already says):\n${view}` : '',
    '',
    'The bank (code, topic, kind, take):',
    ...bankLines(takes),
    '',
    `Rules: at most ${MAX_CONNECTIONS}, strongest first: the takes that give these articles a clear, distinctive position. Leave out takes that are only loosely related; fewer strong ones beat many weak ones. Two takes that say nearly the same thing become one, with both codes. ${REWORD_RULE} Say which article or buyer question each one serves. If nothing in the bank belongs here, return an empty list. Use only codes from the bank.`,
    '',
    'Return JSON only, no markdown fences:',
    '{"connections":[{"codes":["N001"],"text":"the take as it should read in this view","serves":"the article or question it serves, in a few words"}]}',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

export function parseConnections(text, takes) {
  const parsed = parseJson(text, 'The hot takes connection')
  const byCode = new Map(takes.map((t) => [t.code, t]))
  return (Array.isArray(parsed.connections) ? parsed.connections : [])
    .map((c) => {
      const codes = [...new Set((Array.isArray(c?.codes) ? c.codes : [c?.code]).map((x) => String(x || '').trim()).filter((x) => byCode.has(x)))]
      return {
        codes,
        text: String(c?.text || '').trim(),
        serves: String(c?.serves || '').trim(),
        from: codes.map((code) => ({ code, take: byCode.get(code).take, note: byCode.get(code).note })),
      }
    })
    .filter((c) => c.codes.length && c.text)
    .slice(0, MAX_CONNECTIONS)
}

/** mode "hot_takes_theme" of /api/aeo-brief-outline: no single article, a whole theme. */
export async function handleHotTakesTheme({ res, supabase, body, companyId, apiKey }) {
  const pillarId = String(body.pillarId || '').trim()
  const groupIds = (Array.isArray(body.groupIds) ? body.groupIds : []).map(String).filter(Boolean).slice(0, 10)
  if (!groupIds.length) return json(res, 400, { error: 'No articles in this theme' })
  const [takes, { data: groups }, { data: prompts }, { data: pillar }] = await Promise.all([
    loadActiveTakes(supabase, companyId),
    supabase.from('aeo_prompt_groups').select('id, name').eq('company_id', companyId).in('id', groupIds),
    supabase.from('aeo_prompts').select('prompt').eq('company_id', companyId).in('group_id', groupIds),
    pillarId ? supabase.from('aeo_pillars').select('name').eq('id', pillarId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  if (!takes.length) return json(res, 400, { error: 'The hot takes bank is empty. Add or import takes first.' })
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: GENERATE_ARTICLE_MODEL,
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: buildThemeConnectionPrompt({
        takes,
        pillar,
        articles: (groups || []).map((g) => g.name),
        prompts: (prompts || []).map((p) => p.prompt),
        view: String(body.view || '').trim(),
      }),
    }],
  })
  return json(res, 200, { connections: parseConnections(extractText(message.content), takes), bankSize: takes.length })
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
    matches: matches.map((m) => {
      const t = byCode.get(m.code)
      return { ...m, text: m.text || t.take, take: t.take, topic: t.topic, note: t.note }
    }),
    conflicts,
  })
}
