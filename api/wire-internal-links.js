import { handleWireInternalLinks } from '../lib/wire-internal-links/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleWireInternalLinks(req, res)
}
