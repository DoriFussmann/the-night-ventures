import react from '@vitejs/plugin-react'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'
import { defineConfig, loadEnv } from 'vite'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch {
        resolve(raw)
      }
    })
    req.on('error', reject)
  })
}

/** Serve `api/*.js` Vercel handlers during `vite` / `npm run dev`. */
function localApiPlugin() {
  return {
    name: 'local-vercel-api',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const url = req.url || ''
          if (!url.startsWith('/api/')) {
            next()
            return
          }

          const pathname = url.split('?')[0]
          let name = pathname.slice('/api/'.length).replace(/\/$/, '')
          if (!name || name.includes('..') || name.includes('/')) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Not found' }))
            return
          }

          // Keep public /api/scan-live-articles without a 13th Vercel function.
          if (name === 'scan-live-articles') {
            name = 'check-article-update'
            const parsed = new URL(url, 'http://localhost')
            parsed.searchParams.set('action', 'scan-live')
            req.url = `/api/check-article-update${parsed.search}`
          }

          const filePath = path.resolve(__dirname, 'api', `${name}.js`)
          if (!fs.existsSync(filePath)) {
            res.statusCode = 404
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: `API route not found: /api/${name}` }))
            return
          }

          const env = loadEnv(server.config.mode, server.config.envDir || __dirname, '')
          for (const [key, value] of Object.entries(env)) {
            if (process.env[key] === undefined) {
              process.env[key] = value
            }
          }

          req.body = await readBody(req)

          const mod = await server.ssrLoadModule(pathToFileURL(filePath).href)
          const handler = mod.default
          if (typeof handler !== 'function') {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ error: 'Invalid API handler' }))
            return
          }

          await handler(req, res)
        } catch (err) {
          console.error('local API error:', err)
          if (!res.headersSent) {
            res.statusCode = 500
            res.setHeader('Content-Type', 'application/json')
            res.end(
              JSON.stringify({
                error: err?.message || 'Local API handler failed',
              })
            )
          }
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), localApiPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
