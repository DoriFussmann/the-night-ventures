import { handleBriefOutline } from '../lib/aeo/briefOutline.js'

export const config = { maxDuration: 120 }

export default function handler(req, res) {
  return handleBriefOutline(req, res)
}
