import { handleArticleUpdates } from '../lib/article-updates/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleArticleUpdates(req, res)
}
