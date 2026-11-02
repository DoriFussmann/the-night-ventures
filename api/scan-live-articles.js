import { handleScanLiveArticles } from '../lib/scan-live-articles/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleScanLiveArticles(req, res)
}
