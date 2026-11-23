/**
 * AEO brief: suggest a title, article type, angle and outline for one prompt
 * group, from its prompts, personas and the company's Brand Facts.
 * The suggestion is a starting point the user edits on the brief card.
 */
import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import { handleOptions, json, parseBody, requireAuth } from '../seo-advisor/auth.js'
import { bankLines, handleHotTakes, loadActiveTakes } from './hotTakes.js'

const MAX_TOKENS = 6000
const ARTICLE_TYPES = ['comprehensive', 'howto', 'comparison', 'faq', 'flex']

function extractText(blocks) {
  return (Array.isArray(blocks) ? blocks : [])
    .filter((b) => b?.type === 'text' && b.text)
    .map((b) => b.text)
    .join('')
}

export function parseOutline(text) {
  const cleaned = String(text || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = cleaned.indexOf('{')
  const end = cleaned.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('The outline came back incomplete. Try again.')
  let parsed
  try {
    parsed = JSON.parse(cleaned.slice(start, end + 1))
  } catch {
    throw new Error('The outline came back incomplete. Try again.')
  }
  const outline = (Array.isArray(parsed.outline) ? parsed.outline : [])
    .map((s) => ({
      heading: String(s?.heading || '').trim(),
      points: (Array.isArray(s?.points) ? s.points : []).map((p) => String(p || '').trim()).filter(Boolean),
    }))
    .filter((s) => s.heading)
  if (outline.length < 3) throw new Error('The outline came back with fewer than 3 sections')
  return {
    title: String(parsed.title || '').trim(),
    articleType: ARTICLE_TYPES.includes(parsed.articleType) ? parsed.articleType : 'flex',
    angle: String(parsed.angle || '').trim(),
    outline,
  }
}

export function buildOutlinePrompt({ group, pillar, prompts, personas, brandFacts, primaryKeyword, siblings }) {
  const facts = brandFacts || {}
  const lines = [
    'You are planning one article for a company website. The article must answer, directly and specifically, every buyer question listed below, in a way AI assistants and search engines can quote.',
    '',
    `Article topic (prompt group): ${group.name}`,
    `Pillar: ${pillar?.name || '(none)'}`,
    `Primary keyword: ${primaryKeyword || '(none)'}`,
    '',
    'Buyer questions this article must answer (persona · intent tier · question):',
    ...prompts.map((p) => `- ${p.personaName || 'Any'} · ${p.intent_tier} · ${p.prompt}`),
    '',
    'Who is asking:',
    ...personas.map((p) => `- ${p.name}: ${p.summary} Trigger: ${p.trigger} Pains: ${p.pains}`),
    '',
    'Company facts (use only these about the company; never invent results or numbers):',
    facts.offer ? `Offer: ${facts.offer}` : '',
    facts.difference ? `Difference: ${facts.difference}` : '',
    (facts.approved_claims || []).length ? `Approved claims: ${facts.approved_claims.join('; ')}` : '',
    (facts.never_claims || []).length ? `Never claim: ${facts.never_claims.join('; ')}` : '',
    '',
    siblings.length ? `Existing articles in this pillar (do not repeat them; this article can link to them): ${siblings.join('; ')}` : '',
    '',
    'Return JSON only, no markdown fences:',
    '{"title":"55-60 character title with the primary keyword","articleType":"comprehensive|howto|comparison|faq|flex","angle":"one sentence: the specific point of view that makes this article worth citing","outline":[{"heading":"Section heading, phrased as the question a buyer asks where natural","points":["what this section must say, concretely"]}]}',
    '',
    'Rules: 5-8 sections, 2-4 points each, each point one short sentence. The writer opens every article with its own "The Short Answer" section, so do not plan a summary or direct-answer section; the first section starts the substance. Every buyer question above is answered under some heading. Points are specific claims or steps, not topics. Be honest about alternatives. No hype.',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

/**
 * Key points for one brief, from the company voice and the user's view on the
 * brief's theme this month. The user's view is the only source of opinion:
 * the model applies it to this article and invents no stance, number or story.
 */
export function buildKeyPointsPrompt({ voice, view, title, angle, outline, group, pillar, prompts, brandFacts, takes = [] }) {
  const facts = brandFacts || {}
  const sections = (Array.isArray(outline) ? outline : []).map((s) => `- ${s.heading}`)
  const lines = [
    'Write the "key points" for one article: the expert input the writer leads with. They are written as the expert, in first person where natural.',
    '',
    `Voice: ${voice || 'Practical, direct, no fluff.'}`,
    '',
    `The expert's view on this theme (${pillar?.name || 'this theme'}) this month. This is the ONLY source of opinions and original thoughts:`,
    view,
    '',
    takes.length ? "The expert's standing hot takes (their bank). Where one speaks to this article, use it, in its own wording; never write a point that contradicts one:" : '',
    ...bankLines(takes),
    '',
    `Article: ${title || group.name}`,
    angle ? `Angle: ${angle}` : '',
    sections.length ? 'Sections:' : '',
    ...sections,
    '',
    'Buyer questions the article answers:',
    ...prompts.slice(0, 12).map((p) => `- ${p.prompt}`),
    '',
    (facts.approved_claims || []).length ? `Claims the company may make: ${facts.approved_claims.join('; ')}` : '',
    (facts.never_claims || []).length ? `Never claim: ${facts.never_claims.join('; ')}` : '',
    '',
    'Rules: 4-6 bullet points, each one or two sentences. Apply the view to this specific article; at least one point carries its original thought. Do not invent opinions, numbers, client stories or results that are not in the view, the standing hot takes or the claims. Never name a client. Plain text bullets starting with "- ", nothing else.',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

async function handleKeyPoints({ res, supabase, body, companyId, groupId, apiKey }) {
  const view = String(body.view || '').trim()
  if (!view) return json(res, 400, { error: 'Write your view on this theme first' })
  const [{ data: group }, { data: playbook }, { data: prompts }] = await Promise.all([
    supabase.from('aeo_prompt_groups').select('*').eq('company_id', companyId).eq('id', groupId).maybeSingle(),
    supabase.from('aeo_playbook').select('brand_facts, key_points_voice').eq('company_id', companyId).maybeSingle(),
    supabase.from('aeo_prompts').select('prompt').eq('company_id', companyId).eq('group_id', groupId),
  ])
  if (!group) return json(res, 404, { error: 'Prompt group not found' })
  // The bank is optional here: before migration 087, or with an empty bank, the view alone is used.
  const takes = await loadActiveTakes(supabase, companyId).catch(() => [])
  const { data: pillar } = group.pillar_id
    ? await supabase.from('aeo_pillars').select('name').eq('id', group.pillar_id).maybeSingle()
    : { data: null }
  const prompt = buildKeyPointsPrompt({
    voice: String(playbook?.key_points_voice || '').trim(),
    view,
    title: String(body.title || ''),
    angle: String(body.angle || ''),
    outline: body.outline,
    group,
    pillar,
    prompts: prompts || [],
    brandFacts: playbook?.brand_facts || {},
    takes,
  })
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: GENERATE_ARTICLE_MODEL,
    max_tokens: 1500,
    messages: [{ role: 'user', content: prompt }],
  })
  const keyPoints = extractText(message.content).trim()
  if (!keyPoints) throw new Error('The key points came back empty. Try again.')
  return json(res, 200, { keyPoints })
}

/**
 * Suggestions for the user's view on one theme: angles and questions to take a
 * position on, not finished opinions. The user writes the view.
 */
export function buildThemeViewPrompt({ voice, pillar, articles, prompts, brandFacts }) {
  const facts = brandFacts || {}
  const lines = [
    `Help an expert write a short personal view on one theme of their content this month: ${pillar?.name || 'this theme'}.`,
    '',
    `Who the expert is and how they write: ${voice || '(not set)'}`,
    '',
    'Articles in this theme this month:',
    ...articles.map((a) => `- ${a}`),
    '',
    'Questions buyers ask on these topics:',
    ...prompts.slice(0, 15).map((p) => `- ${p}`),
    '',
    facts.offer ? `What the company offers: ${facts.offer}` : '',
    (facts.never_claims || []).length ? `Never claim: ${facts.never_claims.join('; ')}` : '',
    '',
    'Give 4-6 suggestions the expert can react to. Each is one line: a common mistake or myth on this theme, a trade-off worth taking a side on, or a question where an experienced practitioner would disagree with the usual advice. Phrase them as prompts for the expert ("Where do founders misjudge …? Your take: …"), not as the expert\'s opinion. No invented numbers, stories or results. Plain text bullets starting with "- ", nothing else.',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

async function handleThemeView({ res, supabase, body, companyId, apiKey }) {
  const pillarId = String(body.pillarId || '').trim()
  const groupIds = (Array.isArray(body.groupIds) ? body.groupIds : []).map(String).filter(Boolean).slice(0, 10)
  if (!groupIds.length) return json(res, 400, { error: 'No articles in this theme' })
  const [{ data: playbook }, { data: groups }, { data: prompts }, { data: pillar }] = await Promise.all([
    supabase.from('aeo_playbook').select('brand_facts, key_points_voice').eq('company_id', companyId).maybeSingle(),
    supabase.from('aeo_prompt_groups').select('id, name').eq('company_id', companyId).in('id', groupIds),
    supabase.from('aeo_prompts').select('prompt').eq('company_id', companyId).in('group_id', groupIds),
    pillarId ? supabase.from('aeo_pillars').select('name').eq('id', pillarId).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const prompt = buildThemeViewPrompt({
    voice: String(playbook?.key_points_voice || '').trim(),
    pillar,
    articles: (groups || []).map((g) => g.name),
    prompts: (prompts || []).map((p) => p.prompt),
    brandFacts: playbook?.brand_facts || {},
  })
  const anthropic = new Anthropic({ apiKey })
  const message = await anthropic.messages.create({
    model: GENERATE_ARTICLE_MODEL,
    max_tokens: 1200,
    messages: [{ role: 'user', content: prompt }],
  })
  const suggestions = extractText(message.content).trim()
  if (!suggestions) throw new Error('The suggestions came back empty. Try again.')
  return json(res, 200, { suggestions })
}

export async function handleBriefOutline(req, res) {
  if (handleOptions(req, res, 'POST, OPTIONS')) return
  if (req.method !== 'POST') return json(res, 405, { error: 'Method not allowed' })

  let auth
  try {
    auth = await requireAuth(req)
  } catch (err) {
    return json(res, err.statusCode || 401, { error: err.message || 'Unauthorized' })
  }
  const { supabase } = auth
  const body = parseBody(req)
  const companyId = String(body.companyId || '').trim()
  const groupId = String(body.groupId || '').trim()
  if (!companyId || (!groupId && body.mode !== 'theme_view')) return json(res, 400, { error: 'companyId and groupId are required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json(res, 500, { error: 'Server configuration error' })

  try {
    if (body.mode === 'theme_view') return await handleThemeView({ res, supabase, body, companyId, apiKey })
    if (body.mode === 'key_points') return await handleKeyPoints({ res, supabase, body, companyId, groupId, apiKey })
    if (body.mode === 'hot_takes_match' || body.mode === 'hot_take_new') return await handleHotTakes({ res, supabase, body, companyId, groupId, apiKey })
    const [{ data: group, error: gErr }, { data: playbook }, { data: personas }] = await Promise.all([
      supabase.from('aeo_prompt_groups').select('*').eq('company_id', companyId).eq('id', groupId).maybeSingle(),
      supabase.from('aeo_playbook').select('brand_facts').eq('company_id', companyId).maybeSingle(),
      supabase.from('aeo_personas').select('*').eq('company_id', companyId),
    ])
    if (gErr) throw gErr
    if (!group) return json(res, 404, { error: 'Prompt group not found' })
    const [{ data: pillar }, { data: prompts }, { data: siblingGroups }] = await Promise.all([
      group.pillar_id
        ? supabase.from('aeo_pillars').select('*').eq('id', group.pillar_id).maybeSingle()
        : Promise.resolve({ data: null }),
      supabase.from('aeo_prompts').select('*').eq('company_id', companyId).eq('group_id', groupId),
      group.pillar_id
        ? supabase.from('aeo_prompt_groups').select('name, live_slug, status').eq('company_id', companyId).eq('pillar_id', group.pillar_id)
        : Promise.resolve({ data: [] }),
    ])
    const personaById = new Map((personas || []).map((p) => [p.id, p]))
    const used = [...new Set((prompts || []).map((p) => p.persona_id).filter(Boolean))].map((id) => personaById.get(id)).filter(Boolean)
    const siblings = (siblingGroups || []).filter((g) => g.status === 'live' && g.live_slug).map((g) => `${g.name} (/${g.live_slug}/)`)

    const prompt = buildOutlinePrompt({
      group,
      pillar,
      prompts: (prompts || []).map((p) => ({ ...p, personaName: personaById.get(p.persona_id)?.name })),
      personas: used,
      brandFacts: playbook?.brand_facts || {},
      primaryKeyword: String(body.primaryKeyword || group.primary_keyword || '').trim(),
      siblings,
    })
    const anthropic = new Anthropic({ apiKey })
    const message = await anthropic.messages.create({
      model: GENERATE_ARTICLE_MODEL,
      max_tokens: MAX_TOKENS,
      messages: [{ role: 'user', content: prompt }],
    })
    if (message.stop_reason === 'max_tokens') throw new Error('The outline was too long and got cut off. Try again.')
    return json(res, 200, parseOutline(extractText(message.content)))
  } catch (err) {
    console.error('aeo-brief-outline failed:', err)
    return json(res, err.statusCode || 502, { error: err?.message || 'Could not suggest an outline' })
  }
}
