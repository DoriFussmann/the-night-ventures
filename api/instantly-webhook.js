import { handleInstantlyWebhook } from '../lib/instantly/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleInstantlyWebhook(req, res)
}
