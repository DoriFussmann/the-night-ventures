/**
 * Guided Advisor: from the serialized keyword map, work out the one thing to
 * do next and the chat prompt that starts it. Pure; used by the Advisor page
 * (Next step panel) and the system prompt.
 */
import { MAX_CORE_KEYWORDS, MAX_SUPPORTING_PER_CORE, MIN_KEY_MESSAGES } from './pillars.js'

const MIN_CORES = 4
const MIN_SUPPORTING = 4

function specComplete(item) {
  return (item?.spec?.keyMessages || []).length >= MIN_KEY_MESSAGES
}

export function mapProgress(tree) {
  const pillars = Array.isArray(tree) ? tree : []
  const all = pillars.flatMap((p) => [p, ...(p.supporting || [])])
  return {
    cores: pillars.length,
    maxCores: MAX_CORE_KEYWORDS,
    supporting: pillars.reduce((n, p) => n + (p.supporting || []).length, 0),
    articles: all.length,
    specsComplete: all.filter(specComplete).length,
    live: all.filter((item) => item?.spec?.status === 'live').length,
    backlog: pillars.reduce((n, p) => n + (p.backlog || []).length, 0),
  }
}

export function formatProgress(progress) {
  return `${progress.cores}/${progress.maxCores} Core · ${progress.supporting} Supporting · ${progress.specsComplete}/${progress.articles} specs complete · ${progress.live} Live`
}

/**
 * @returns { kind, title, detail, prompt, core?, keyword?, progress }
 */
export function computeNextStep(tree) {
  const pillars = Array.isArray(tree) ? tree : []
  const progress = mapProgress(pillars)

  if (pillars.length < MIN_CORES) {
    const need = Math.max(5 - pillars.length, 1)
    return {
      kind: 'cores',
      title: 'Suggest Core keywords',
      detail: `${pillars.length} of 4–7 Core keywords so far. Core keywords come first; each becomes a pillar article.`,
      prompt:
        pillars.length === 0
          ? 'Based on SEO Controls, suggest 5 to 7 Core keywords for this site, with your reasoning and data for each. I will confirm them one by one.'
          : `We have ${pillars.length} Core keyword${pillars.length === 1 ? '' : 's'}. Suggest ${need} more, with reasoning and data, that don't overlap the ones we have.`,
      progress,
    }
  }

  const thin = [...pillars]
    .filter((p) => (p.supporting || []).length < MIN_SUPPORTING)
    .sort((a, b) => (a.supporting || []).length - (b.supporting || []).length)[0]
  if (thin) {
    const count = (thin.supporting || []).length
    return {
      kind: 'supporting',
      title: `Fill “${thin.keyword}”`,
      detail: `${count} of up to ${MAX_SUPPORTING_PER_CORE} Supporting keywords. Most Cores need 4–8.`,
      prompt: `Suggest Supporting keywords for the Core “${thin.keyword}” (it has ${count}). Check volume, difficulty and that each has its own Google results.`,
      core: thin.keyword,
      progress,
    }
  }

  for (const pillar of pillars) {
    for (const item of [pillar, ...(pillar.supporting || [])]) {
      if (!specComplete(item)) {
        const isCore = item === pillar
        return {
          kind: 'spec',
          title: `Finish the spec for “${item.keyword}”`,
          detail: `${(item.spec?.keyMessages || []).length} of ${MIN_KEY_MESSAGES}–5 key messages. Articles can't be generated without them.`,
          prompt: `Draft the article spec for “${item.keyword}”${isCore ? ' (the pillar article)' : ` (under “${pillar.keyword}”)`}: an angle and 3 to 5 key messages based on SEO Controls.`,
          core: pillar.keyword,
          keyword: item.keyword,
          progress,
        }
      }
    }
  }

  const pillarPending = pillars.find((p) => p.spec?.status !== 'live')
  if (pillarPending) {
    return {
      kind: 'pillar',
      title: `Write the pillar for “${pillarPending.keyword}”`,
      detail: 'Supporting articles under a Core need its pillar article to be Live first.',
      prompt: null,
      core: pillarPending.keyword,
      keyword: pillarPending.keyword,
      progress,
    }
  }

  const approved = pillars
    .flatMap((p) => (p.supporting || []).map((s) => ({ ...s, core: p.keyword })))
    .find((s) => s.spec?.status === 'approved')
  if (approved) {
    return {
      kind: 'generate',
      title: `Generate “${approved.keyword}”`,
      detail: 'Spec is complete and approved; it is ready to write in Article Generation.',
      prompt: null,
      core: approved.core,
      keyword: approved.keyword,
      progress,
    }
  }

  return {
    kind: 'review',
    title: progress.backlog ? 'Review the backlog' : 'Map is complete',
    detail: progress.backlog
      ? `${progress.backlog} parked ideas. Promote the strongest where a Core has room.`
      : 'Every keyword has a complete spec and is Live.',
    prompt: progress.backlog
      ? 'Review the backlog ideas under each Core. Which are worth promoting, given volume, difficulty and overlap with what we have?'
      : 'Where are the gaps in this keyword map? Is there a Core keyword we are missing?',
    progress,
  }
}
