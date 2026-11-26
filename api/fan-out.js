import { handleFanOut } from '../lib/fan-out/handler.js'

// One run step holds up to 4 captures of real ChatGPT in parallel; a capture can take
// about 100 seconds and is retried once when it times out.
export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleFanOut(req, res)
}
