import { handleSitePlaceholders } from '../lib/placeholders/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleSitePlaceholders(req, res)
}
