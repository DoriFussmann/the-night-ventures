import { handlePublishSchedule } from '../lib/publish-schedule/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handlePublishSchedule(req, res)
}
