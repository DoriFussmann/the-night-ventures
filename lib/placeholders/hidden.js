// Checks TNV does not show, even when seo-core's manifest still lists them.
// Applied to new scans (handler.js) and to scans saved before (placeholdersSummary.js).
export const HIDDEN_CHECKS = new Set(['ga4-id'])
