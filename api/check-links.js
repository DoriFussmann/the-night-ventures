import { handleCheckLinks } from '../lib/check-links/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleCheckLinks(req, res)
}
