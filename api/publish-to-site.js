import { handlePublishToSite } from '../lib/publish-to-site/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handlePublishToSite(req, res)
}
