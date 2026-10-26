/**
 * Markets the Advisor can research. One row maps to each provider's codes:
 * Semrush database, DataForSEO location_code, default language.
 * Shared by the server (tool params) and the browser (selector).
 */
export const MARKETS = [
  { code: 'us', label: 'United States', semrush: 'us', dfsLocation: 2840, language: 'en' },
  { code: 'uk', label: 'United Kingdom', semrush: 'uk', dfsLocation: 2826, language: 'en' },
  { code: 'ca', label: 'Canada', semrush: 'ca', dfsLocation: 2124, language: 'en' },
  { code: 'au', label: 'Australia', semrush: 'au', dfsLocation: 2036, language: 'en' },
  { code: 'ie', label: 'Ireland', semrush: 'ie', dfsLocation: 2372, language: 'en' },
  { code: 'nz', label: 'New Zealand', semrush: 'nz', dfsLocation: 2554, language: 'en' },
  { code: 'in', label: 'India', semrush: 'in', dfsLocation: 2356, language: 'en' },
  { code: 'sg', label: 'Singapore', semrush: 'sg', dfsLocation: 2702, language: 'en' },
  { code: 'za', label: 'South Africa', semrush: 'za', dfsLocation: 2710, language: 'en' },
  { code: 'il', label: 'Israel', semrush: 'il', dfsLocation: 2376, language: 'he' },
  { code: 'de', label: 'Germany', semrush: 'de', dfsLocation: 2276, language: 'de' },
  { code: 'fr', label: 'France', semrush: 'fr', dfsLocation: 2250, language: 'fr' },
  { code: 'es', label: 'Spain', semrush: 'es', dfsLocation: 2724, language: 'es' },
  { code: 'it', label: 'Italy', semrush: 'it', dfsLocation: 2380, language: 'it' },
  { code: 'nl', label: 'Netherlands', semrush: 'nl', dfsLocation: 2528, language: 'nl' },
  { code: 'se', label: 'Sweden', semrush: 'se', dfsLocation: 2752, language: 'sv' },
  { code: 'br', label: 'Brazil', semrush: 'br', dfsLocation: 2076, language: 'pt' },
  { code: 'mx', label: 'Mexico', semrush: 'mx', dfsLocation: 2484, language: 'es' },
]

export const LANGUAGES = [
  { code: 'en', label: 'English' },
  { code: 'he', label: 'Hebrew' },
  { code: 'de', label: 'German' },
  { code: 'fr', label: 'French' },
  { code: 'es', label: 'Spanish' },
  { code: 'it', label: 'Italian' },
  { code: 'nl', label: 'Dutch' },
  { code: 'sv', label: 'Swedish' },
  { code: 'pt', label: 'Portuguese' },
]

export const DEFAULT_MARKET = 'us'

export function resolveMarket(code) {
  return MARKETS.find((m) => m.code === code) || MARKETS.find((m) => m.code === DEFAULT_MARKET)
}

export function resolveLanguage(code, market) {
  const m = resolveMarket(market)
  return LANGUAGES.find((l) => l.code === code) || LANGUAGES.find((l) => l.code === m.language)
}

/** Provider params for a session's market + language. */
export function researchLocale(marketCode, languageCode) {
  const market = resolveMarket(marketCode)
  const language = resolveLanguage(languageCode, market.code)
  return {
    market: market.code,
    marketLabel: market.label,
    language: language.code,
    languageLabel: language.label,
    semrushDatabase: market.semrush,
    dfsLocationCode: market.dfsLocation,
    dfsLanguageCode: language.code,
    mozLocale: `${language.code}-${market.code === 'uk' ? 'GB' : market.code.toUpperCase()}`,
  }
}

/**
 * Market + language codes from SEO Controls free text ("United States",
 * "US", "English"). Falls back to the default market.
 */
export function localeFromSeoControls(profile) {
  const m = String(profile?.seo_market || '').trim().toLowerCase()
  const l = String(profile?.seo_language || '').trim().toLowerCase()
  const aliases = { usa: 'us', 'united states of america': 'us', gb: 'uk', 'great britain': 'uk', england: 'uk' }
  const market =
    MARKETS.find((row) => row.code === m || row.label.toLowerCase() === m) ||
    MARKETS.find((row) => row.code === aliases[m]) ||
    MARKETS.find((row) => m && row.label.toLowerCase().startsWith(m)) ||
    null
  const language = LANGUAGES.find((row) => row.code === l || row.label.toLowerCase() === l) || null
  return researchLocale(market?.code || DEFAULT_MARKET, language?.code)
}
