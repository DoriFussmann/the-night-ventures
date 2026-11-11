import { handlePromptTests } from '../lib/prompt-tests/handler.js'

// One step runs up to 10 captures in parallel; each can take over 30 seconds and is retried once.
export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handlePromptTests(req, res)
}
