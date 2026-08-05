/**
 * Offline/unit self-test: providers degrade gracefully, Anthropic tool loop + save_insight work.
 * Does not require Semrush/DataForSEO keys or service role.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import Anthropic from '@anthropic-ai/sdk'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    if (!line || line.trim().startsWith('#')) continue
    const eq = line.indexOf('=')
    if (eq === -1) continue
    const key = line.slice(0, eq).trim()
    let val = line.slice(eq + 1).trim()
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1)
    }
    if (process.env[key] === undefined) process.env[key] = val
  }
}

loadEnvFile(path.join(root, '.env.local'))
loadEnvFile(path.join(root, '.env'))

const insights = []
const mockSupabase = {
  from(table) {
    if (table !== 'insights') throw new Error(`unexpected table ${table}`)
    return {
      insert(row) {
        const data = {
          id: `insight-${insights.length + 1}`,
          created_at: new Date().toISOString(),
          ...row,
        }
        insights.push(data)
        return {
          select() {
            return {
              single: async () => ({ data, error: null }),
            }
          },
        }
      },
    }
  },
}

async function main() {
  console.log('=== SEO Advisor unit self-test ===')

  const { semrushTools } = await import(
    pathToFileURL(path.join(root, 'api/lib/seo-advisor/providers/semrush.js')).href
  )
  const { dataforseoTools } = await import(
    pathToFileURL(path.join(root, 'api/lib/seo-advisor/providers/dataforseo.js')).href
  )
  const { executeTool, TOOL_DEFINITIONS, MAX_TOOL_CALLS_PER_TURN } = await import(
    pathToFileURL(path.join(root, 'api/lib/seo-advisor/tools.js')).href
  )
  const { buildSystemPrompt } = await import(
    pathToFileURL(path.join(root, 'api/lib/seo-advisor/context.js')).href
  )

  const sm = await semrushTools.domainOverview({ domain: 'example.com' })
  if (sm.available !== false && !process.env.SEMRUSH_API_KEY) {
    throw new Error('Semrush should be unavailable without key')
  }
  console.log('✓ Semrush graceful:', sm.available ? 'live' : sm.reason)

  const dfs = await dataforseoTools.keywordData({ keyword: 'content marketing' })
  console.log('✓ DataForSEO graceful:', dfs.available ? 'live' : dfs.reason)

  const saved = await executeTool(
    'save_insight',
    {
      title: 'Test pillar: investor outreach',
      body: 'Unit test insight body',
      insight_type: 'pillar_topic',
      source_tool: 'dataforseo',
      conflicts_with_profile: false,
    },
    {
      supabase: mockSupabase,
      companyId: '00000000-0000-0000-0000-000000000001',
      sessionId: '00000000-0000-0000-0000-000000000002',
      onInsight: (row) => console.log('  onInsight:', row.title),
    }
  )
  if (!saved.saved || insights.length !== 1) throw new Error('save_insight failed')
  console.log('✓ save_insight persists via tool layer')

  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn('○ Skipping Anthropic tool-loop (no ANTHROPIC_API_KEY)')
    return
  }

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const system = buildSystemPrompt({
    company: { name: 'Rupert' },
    profile: {
      domain: 'getrupert.com',
      abstract: 'Expert-managed investor outreach for founders raising capital.',
      short_description: 'Investor outreach platform for startups.',
      competitors: [{ name: 'Harmonic', url: 'harmonic.ai' }],
      target_audience: 'Startup founders raising seed/Series A',
      services: ['Investor outreach', 'CRM'],
    },
    industries: ['Entrepreneurship & Startups', 'B2B SaaS'],
  })

  let messages = [
    {
      role: 'user',
      content:
        'Identify 2 content pillars for organic traffic. Call at least one data tool if available, then save_insight with one pillar recommendation. Keep the final answer under 120 words.',
    },
  ]

  let toolCalls = 0
  let rounds = 0
  while (rounds < 4) {
    rounds += 1
    const msg = await anthropic.messages.create({
      model: 'claude-sonnet-4-6',
      max_tokens: 2000,
      system,
      tools: TOOL_DEFINITIONS,
      messages,
    })

    const toolUses = (msg.content || []).filter((b) => b.type === 'tool_use')
    if (msg.stop_reason !== 'tool_use' || toolUses.length === 0) {
      const text = (msg.content || [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('')
      console.log('✓ Final model text length:', text.length)
      break
    }

    const results = []
    for (const tu of toolUses.slice(0, MAX_TOOL_CALLS_PER_TURN - toolCalls)) {
      toolCalls += 1
      const result = await executeTool(tu.name, tu.input, {
        supabase: mockSupabase,
        companyId: '00000000-0000-0000-0000-000000000001',
        sessionId: '00000000-0000-0000-0000-000000000002',
      })
      console.log(`  tool ${tu.name}:`, result.available === false ? result.reason : 'ok')
      results.push({
        type: 'tool_result',
        tool_use_id: tu.id,
        content: JSON.stringify(result),
      })
    }

    messages.push({ role: 'assistant', content: msg.content })
    messages.push({ role: 'user', content: results })
  }

  if (toolCalls < 1) throw new Error('Expected model to call at least one tool')
  console.log(`✓ Anthropic tool loop: ${toolCalls} tool call(s), insights=${insights.length}`)
  if (insights.length < 1) {
    console.warn('○ Model did not call save_insight this run')
  } else {
    console.log('✓ Insight created in tool loop')
  }
  console.log('=== Unit self-test finished ===')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
