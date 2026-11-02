import { handleInstantly } from '../lib/instantly/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleInstantly(req, res)
}
