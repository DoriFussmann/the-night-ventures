import { handleIntegrations } from '../lib/integrations/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleIntegrations(req, res)
}
