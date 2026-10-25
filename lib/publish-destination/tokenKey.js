// Publish Destination field rules, shared by the Company Data dialog and the
// server-side connection check.

export const TOKEN_KEY_RE = /^[A-Z][A-Z0-9_]*$/
export const OWNER_REPO_RE = /^[A-Za-z0-9_.-]+$/

const TOKEN_VALUE_RE = /^(github_pat_|ghp_|gho_|ghu_|ghs_)/i

/** Env var TNV reads the token from, e.g. HEYRUPERT → GITHUB_TOKEN_HEYRUPERT. */
export function tokenEnvName(tokenKey) {
  return `GITHUB_TOKEN_${String(tokenKey || '').trim().toUpperCase()}`
}

/**
 * Why a token key is unusable, or null when it is fine (empty counts as fine:
 * the field is optional until the company publishes).
 * @param {string} value
 * @returns {string | null}
 */
export function tokenKeyIssue(value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (TOKEN_VALUE_RE.test(raw)) {
    return 'This field takes the label, not the token. Paste the github_pat_… value only into the Vercel variable.'
  }
  const key = raw.toUpperCase()
  if (key.startsWith('GITHUB_TOKEN_')) {
    return 'Enter only the part after GITHUB_TOKEN_ (for example HEYRUPERT).'
  }
  if (!TOKEN_KEY_RE.test(key)) {
    return 'Use capital letters, numbers and underscores only, starting with a letter (for example HEYRUPERT).'
  }
  return null
}

/**
 * Why an owner or repo value is unusable, or null.
 * @param {'owner' | 'repo'} field
 * @param {string} value
 * @returns {string | null}
 */
export function ownerRepoIssue(field, value) {
  const raw = String(value || '').trim()
  if (!raw) return null
  if (/github\.com|\//i.test(raw)) {
    return field === 'owner'
      ? 'Enter only the owner name, not a URL (github.com/<owner>/<repo>).'
      : 'Enter only the repo name, not a URL or owner/repo.'
  }
  if (!OWNER_REPO_RE.test(raw)) {
    return 'Use letters, numbers, dots, dashes and underscores only.'
  }
  return null
}
