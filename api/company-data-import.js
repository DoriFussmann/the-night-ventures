import { handleCompanyDataImport } from '../lib/company-data-import/handler.js'

export const config = { maxDuration: 300 }

export default function handler(req, res) {
  return handleCompanyDataImport(req, res)
}
