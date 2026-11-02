import { handleCoreVersion } from '../lib/core-version/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleCoreVersion(req, res)
}
