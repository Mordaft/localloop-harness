import { defineConfig, type Plugin } from 'vite'
import fs from 'node:fs'
import path from 'node:path'

const pkg = JSON.parse(
  fs.readFileSync(path.resolve(import.meta.dirname, 'package.json'), 'utf-8')
) as { version: string }

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
  plugins: [pwaVersionPlugin()],
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
