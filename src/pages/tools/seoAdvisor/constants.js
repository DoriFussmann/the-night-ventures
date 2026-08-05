export const SUGGESTED_PROMPTS = [
  {
    id: 'pillar',
    title: 'Pillar Content Strategy',
    text: "Based on this company's business and the space we're in, identify the pillar topics and content pillars we should build our site around to drive organic traffic. Pull real keyword and search demand data to back this up.",
  },
  {
    id: 'competitors',
    title: 'Competitor Analysis',
    text: "Look at who's actually ranking and competing with us in this space — not just who I think our competitors are. Pull real data and tell me who we're up against and where the gaps are.",
  },
  {
    id: 'traffic',
    title: 'Traffic Driver Audit',
    text: 'Analyze [URL] and tell me what\'s actually driving its traffic — which articles, topics, and keywords are working, so I can understand what to replicate or avoid.',
    needsUrl: true,
  },
  {
    id: 'technical',
    title: 'Technical SEO Audit',
    text: "Run a technical SEO audit on this site and tell me what's broken, what's holding back rankings, and what to prioritize fixing first.",
  },
]

export function fillTrafficPrompt(template, url) {
  const trimmed = String(url || '').trim()
  if (!trimmed) return template
  return template.replace('[URL]', trimmed)
}
