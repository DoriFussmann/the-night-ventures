import { handleProposeExternalLinks } from '../lib/external-links/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleProposeExternalLinks(req, res)
}
