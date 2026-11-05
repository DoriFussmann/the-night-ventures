/**
 * AEO brief: suggest a title, article type, angle and outline for one prompt
 * group, from its prompts, personas and the company's Brand Facts.
 * The suggestion is a starting point the user edits on the brief card.
 */
import Anthropic from '@anthropic-ai/sdk'
import { GENERATE_ARTICLE_MODEL } from '../generate-article/prompt.js'
import { handleOptions, json, parseBody, requireAuth } from '../seo-advisor/auth.js'

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
    'Rules: 5-8 sections, 2-4 points each, each point one short sentence. Answer first: the first section gives the direct answer. Every buyer question above is answered under some heading. Points are specific claims or steps, not topics. Be honest about alternatives. No hype.',
  ]
  return lines.filter((l) => l !== '').join('\n')
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
  if (!companyId || !groupId) return json(res, 400, { error: 'companyId and groupId are required' })

  const apiKey = process.env.ANTHROPIC_API_KEY
  if (!apiKey) return json(res, 500, { error: 'Server configuration error' })

  try {
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
