import { handleAudienceBuild } from '../lib/audience-build/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleAudienceBuild(req, res)
}
