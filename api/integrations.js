import { handleIntegrations } from '../lib/integrations/handler.js'

export const config = { maxDuration: 30 }

export default async function handler(req, res) {
  return handleIntegrations(req, res)
}
