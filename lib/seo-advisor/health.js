/** In-memory provider health: last call success/failure per process. */
const state = {
  semrush: { ok: null, lastError: null, at: null },
  dataforseo: { ok: null, lastError: null, at: null },
  moz: { ok: null, lastError: null, at: null },
}

export function markProviderSuccess(provider) {
  if (!state[provider]) return
  state[provider] = { ok: true, lastError: null, at: new Date().toISOString() }
}

export function markProviderFailure(provider, error) {
  if (!state[provider]) return
  state[provider] = {
    ok: false,
    lastError: String(error?.message || error || 'unknown error'),
    at: new Date().toISOString(),
  }
}

export function getProviderHealth() {
  return {
    semrush: { ...state.semrush },
    dataforseo: { ...state.dataforseo },
    moz: { ...state.moz },
  }
}

export function isProviderLikelyDown(provider) {
  return state[provider]?.ok === false
}
