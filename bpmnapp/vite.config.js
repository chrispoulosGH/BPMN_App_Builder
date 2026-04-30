import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function normalizeRequestedJsonPath(filePath) {
  if (typeof filePath !== 'string') {
    return ''
  }

  const trimmedPath = filePath.trim().replace(/^["']+|["']+$/g, '')
  if (!trimmedPath) {
    return ''
  }

  return path.normalize(trimmedPath)
}

function resolveDiagramReadPath(filePath) {
  const normalizedPath = normalizeRequestedJsonPath(filePath)
  if (!normalizedPath) {
    return ''
  }

  if (path.isAbsolute(normalizedPath)) {
    return normalizedPath
  }

  const outputDir = path.resolve(__dirname, 'output', 'xml2json')
  return path.join(outputDir, path.basename(normalizedPath))
}

function resolveDiagramWritePath(filePath) {
  const normalizedPath = normalizeRequestedJsonPath(filePath)
  if (!normalizedPath) {
    return ''
  }

  if (path.isAbsolute(normalizedPath)) {
    return normalizedPath
  }

  const targetFileName = normalizedPath.toLowerCase().endsWith('.json')
    ? path.basename(normalizedPath)
    : `${path.basename(normalizedPath)}.json`
  const outputDir = path.resolve(__dirname, 'output', 'xml2json')
  return path.join(outputDir, targetFileName)
}

function saveDiagramPlugin() {
  return {
    name: 'save-diagram-plugin',
    configureServer(server) {
      server.middlewares.use('/output/xml2json', async (req, res, next) => {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          next()
          return
        }

        try {
          const requestUrl = new URL(req.url || '/', 'http://localhost')
          const rawName = requestUrl.pathname.replace(/^\/+/, '')
          const fileName = path.basename(decodeURIComponent(rawName || '')).trim()
          if (!fileName) {
            next()
            return
          }

          const outputDir = path.resolve(__dirname, 'output', 'xml2json')
          const targetPath = path.join(outputDir, fileName)
          const fileContent = await fs.readFile(targetPath)
          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json; charset=utf-8')
          res.end(fileContent)
        } catch {
          next()
        }
      })

      server.middlewares.use('/api/save-diagram', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, message: 'Method Not Allowed' }))
          return
        }

        try {
          let rawBody = ''
          for await (const chunk of req) {
            rawBody += chunk
          }

          const { fileName, filePath, payload } = JSON.parse(rawBody || '{}')
          const requestedPath = normalizeRequestedJsonPath(filePath || fileName)
          const targetPath = resolveDiagramWritePath(requestedPath)
          if (!targetPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, message: 'Missing fileName or filePath' }))
            return
          }

          if (path.extname(targetPath).toLowerCase() !== '.json') {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, message: 'Only .json files are supported' }))
            return
          }

          await fs.mkdir(path.dirname(targetPath), { recursive: true })
          await fs.writeFile(targetPath, JSON.stringify(payload, null, 2), 'utf8')

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, filePath: targetPath }))
        } catch (error) {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'Save failed' }))
        }
      })

      server.middlewares.use('/api/load-diagram', async (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, message: 'Method Not Allowed' }))
          return
        }

        try {
          let rawBody = ''
          for await (const chunk of req) {
            rawBody += chunk
          }

          const { filePath } = JSON.parse(rawBody || '{}')
          const targetPath = resolveDiagramReadPath(filePath)
          if (!targetPath) {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, message: 'Missing filePath' }))
            return
          }

          if (path.extname(targetPath).toLowerCase() !== '.json') {
            res.statusCode = 400
            res.setHeader('Content-Type', 'application/json')
            res.end(JSON.stringify({ ok: false, message: 'Only .json files are supported' }))
            return
          }

          const raw = await fs.readFile(targetPath, 'utf8')
          const payload = JSON.parse(raw)

          res.statusCode = 200
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: true, payload }))
        } catch (error) {
          res.statusCode = 404
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'Load failed' }))
        }
      })
    },
  }
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), saveDiagramPlugin()],
})
