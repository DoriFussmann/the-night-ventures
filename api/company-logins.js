import { handleCompanyLogins } from '../lib/company-logins/handler.js'

export default function handler(req, res) {
  return handleCompanyLogins(req, res)
}
