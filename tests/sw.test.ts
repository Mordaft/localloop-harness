import assert from 'node:assert/strict'
import sw from '../public/sw.js'

const { isStaticRequest, CACHE_NAME, APP_SHELL } = sw

console.log('--- Iniciando pruebas de Service Worker y Caché Estática (LocalLoop) ---')

assert.ok(CACHE_NAME.startsWith('localloop-'))
assert.ok(Array.isArray(APP_SHELL) && APP_SHELL.length >= 4)

// 1. App Shell y bundles de Vite deben cachearse
for (const url of [
  'http://localhost:5173/',
  'http://localhost:5173/index.html',
  'http://localhost:5173/manifest.webmanifest',
  'http://localhost:5173/favicon.svg',
  'http://localhost:5173/assets/index-abc123.js',
  'http://localhost:5173/assets/style-abc123.css',
]) {
  assert.equal(
    isStaticRequest({ method: 'GET', url, headers: new Headers() }),
    true,
    `El recurso estático ${url} debe ser cacheable`,
  )
}

// 2. Endpoints de inferencia LLM y servidores MCP NUNCA deben cachearse
for (const url of [
  'http://127.0.0.1:1234/v1/models',
  'http://127.0.0.1:1234/v1/chat/completions',
  'http://localhost:11434/api/chat',
  'http://localhost:3001/mcp/sse',
]) {
  assert.equal(
    isStaticRequest({ method: 'GET', url, headers: new Headers() }),
    false,
    `La petición dinámica ${url} NO debe cachearse`,
  )
}

console.log('✓ Todas las pruebas de Service Worker pasaron exitosamente.')
