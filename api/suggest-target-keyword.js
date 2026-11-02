import { handleSuggestTargetKeyword } from '../lib/suggest-target-keyword/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleSuggestTargetKeyword(req, res)
}
