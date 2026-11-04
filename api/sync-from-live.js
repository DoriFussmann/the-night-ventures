import { handleSyncFromLive } from '../lib/sync-from-live/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleSyncFromLive(req, res)
}
