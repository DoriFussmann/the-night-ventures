import { handleAnalyzeWriterArticle } from '../lib/writer-intake/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleAnalyzeWriterArticle(req, res)
}
