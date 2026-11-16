import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8')
) as { version: string }

function mcpLocalProxyPlugin(): Plugin {
  const handler = (req: http.IncomingMessage, res: http.ServerResponse) => {
    try {
      const reqUrl = new URL(req.url ?? '', 'http://localhost')
      const targetRaw = reqUrl.searchParams.get('target')
      if (!targetRaw) {
        res.statusCode = 400
        res.end(JSON.stringify({ error: 'Missing target parameter' }))
        return
      }

      const targetUrl = new URL(targetRaw)
      const isLocalHost = targetUrl.hostname === 'localhost' || targetUrl.hostname === '127.0.0.1'
      const isContext7 = targetUrl.hostname === 'mcp.context7.com' || targetUrl.hostname.endsWith('.context7.com')
      if (!isLocalHost && !isContext7) {
        res.statusCode = 403
        res.end(JSON.stringify({ error: 'Only localhost and context7 MCP targets are allowed' }))
        return
      }

      if (req.method === 'OPTIONS') {
        res.writeHead(204, {
          'Access-Control-Allow-Origin': '*',
          'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
          'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id',
        })
        res.end()
        return
      }

      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)))
      req.on('end', () => {
        const bodyBuffer = Buffer.concat(chunks)
        const forwardHeaders: http.OutgoingHttpHeaders = {
          host: targetUrl.host,
        }
        for (const [key, val] of Object.entries(req.headers)) {
          const lower = key.toLowerCase()
          if (
            lower === 'content-type' ||
            lower === 'accept' ||
            lower === 'authorization' ||
            lower === 'mcp-session-id' ||
            lower.startsWith('x-')
          ) {
            forwardHeaders[key] = val
          }
        }
        if (bodyBuffer.length > 0) {
          forwardHeaders['content-length'] = String(bodyBuffer.length)
        }

        const transport = targetUrl.protocol === 'https:' ? https : http
        const requestOptions: http.RequestOptions = {
          protocol: targetUrl.protocol,
          hostname: targetUrl.hostname === 'localhost' ? '127.0.0.1' : targetUrl.hostname,
          port: targetUrl.port,
          path: `${targetUrl.pathname}${targetUrl.search}`,
          method: req.method || 'GET',
          headers: forwardHeaders,
        }
        const proxyReq = transport.request(
          requestOptions,
          (proxyRes) => {
            const respHeaders: http.OutgoingHttpHeaders = {
              ...proxyRes.headers,
              'access-control-allow-origin': '*',
              'access-control-expose-headers': 'Mcp-Session-Id, mcp-session-id, Content-Type',
            }
            res.writeHead(proxyRes.statusCode || 200, respHeaders)
            proxyRes.pipe(res)
          },
        )

        proxyReq.on('error', (err) => {
          if (!res.headersSent) {
            res.writeHead(502, { 'Content-Type': 'application/json' })
          }
          res.end(JSON.stringify({ error: err.message }))
        })

        res.on('close', () => {
          proxyReq.destroy()
        })

        if (bodyBuffer.length > 0) {
          proxyReq.write(bodyBuffer)
        }
        proxyReq.end()
      })
    } catch (err) {
      res.statusCode = 500
      res.end(JSON.stringify({ error: err instanceof Error ? err.message : String(err) }))
    }
  }

  return {
    name: 'mcp-local-proxy-plugin',
    configureServer(server) {
      server.middlewares.use('/__mcp_proxy__', handler)
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__mcp_proxy__', handler)
    },
  }
}

function pwaVersionPlugin(): Plugin {
  return {
    name: 'pwa-version-plugin',
    apply: 'build',
    closeBundle() {
      const swDistPath = path.resolve(import.meta.dirname, 'dist/sw.js')
      if (fs.existsSync(swDistPath)) {
        let content = fs.readFileSync(swDistPath, 'utf-8')
        const buildVersion = `${Date.now()}`
        content = content.replace(
          /const SW_VERSION = ['"][^'"]+['"]/,
          `const SW_VERSION = '${buildVersion}'`
        )
        fs.writeFileSync(swDistPath, content, 'utf-8')
        console.log(`[PWA] Inyectada versión de Service Worker en dist/sw.js: ${buildVersion}`)
      }
    },
  }
}

export default defineConfig({
  base: './',
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [mcpLocalProxyPlugin(), pwaVersionPlugin()],
  worker: {
    format: 'es',
  },
  build: {
    chunkSizeWarningLimit: 1000,
    rolldownOptions: {
      output: {
        codeSplitting: {
          groups: [
            {
              name: 'dexie',
              test: /[\\/]node_modules[\\/]dexie/,
              priority: 10,
            },
            {
              name: 'langgraph',
              test: /[\\/]node_modules[\\/]@langchain[\\/]langgraph/,
              priority: 30,
            },
            {
              name: 'langchain-core',
              test: /[\\/]node_modules[\\/](?:@langchain[\\/]core|langsmith)/,
              priority: 20,
            },
          ],
        },
      },
    },
  },
})
