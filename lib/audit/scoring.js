// Pure issue diff + accepted-override helpers. No I/O. (Scoring lives in readiness.js.)

/**
 * Compare two issue lists by fingerprint.
 * @template {{ fingerprint: string }} T
 * @param {T[]} current
 * @param {T[] | null} previous  null when there is no previous run
 * @returns {{ current: Array<T & { diff: 'new' | 'persisting' | 'baseline' }>, fixed: T[] }}
 */
export function diffIssues(current, previous) {
  if (!previous) {
    return {
      current: (current || []).map((i) => ({ ...i, diff: 'baseline' })),
      fixed: [],
    }
  }
  const prev = new Set(previous.map((i) => i.fingerprint))
  const curr = new Set((current || []).map((i) => i.fingerprint))
  return {
    current: (current || []).map((i) => ({ ...i, diff: prev.has(i.fingerprint) ? 'persisting' : 'new' })),
    fixed: previous.filter((i) => !curr.has(i.fingerprint)),
  }
}

/**
 * Split issues into active vs accepted using the company's overrides.
 * @template {{ fingerprint: string }} T
 * @param {T[]} issues
 * @param {Set<string>} acceptedFingerprints
 */
export function partitionAccepted(issues, acceptedFingerprints) {
  const active = []
  const accepted = []
  for (const issue of issues || []) {
    if (acceptedFingerprints.has(issue.fingerprint)) accepted.push(issue)
    else active.push(issue)
  }
  return { active, accepted }
}
