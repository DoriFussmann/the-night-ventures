import { handleAuditSummary } from '../lib/audit-summary/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleAuditSummary(req, res)
}
