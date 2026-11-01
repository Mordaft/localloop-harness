const SW_VERSION = '1793537848252'
const CACHE_NAME = `localloop-shell-${SW_VERSION}`
const APP_SHELL = ['./', './index.html', './manifest.webmanifest', './favicon.svg']

const STATIC_EXTENSIONS = [
  '.html',
  '.htm',
  '.css',
  '.js',
  '.mjs',
  '.json',
  '.webmanifest',
  '.svg',
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.ico',
  '.woff',
  '.woff2',
  '.ttf',
  '.eot',
  '.otf',
  '.map',
]

const STATIC_DESTINATIONS = ['document', 'script', 'worker', 'style', 'image', 'font', 'manifest']

/**
 * Determina si una petición corresponde a navegación o documento HTML principal.
 */
function isNavigationRequest(request) {
  if (!request) return false
  if (request.mode === 'navigate' || request.destination === 'document') {
    return true
  }
  try {
    const url = new URL(request.url)
    return url.pathname === '/' || url.pathname.endsWith('/') || url.pathname.endsWith('/index.html')
  } catch {
    return false
  }
}

/**
 * Determina si una petición corresponde a contenido estático (incluyendo el bundle de LangGraph y Web Workers)
 * y por tanto es susceptible de cachearse agresivamente.
 * Las peticiones a APIs LLM (/v1/), servidores MCP (/mcp, /sse) o métodos no-GET nunca deben cachearse.
 */
function isStaticRequest(request) {
  if (!request || request.method !== 'GET') {
    return false
  }

  if (request.headers && typeof request.headers.has === 'function' && request.headers.has('authorization')) {
    return false
  }

  let url
  try {
    url = new URL(request.url)
  } catch {
    return false
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return false
  }

  const pathname = url.pathname.toLowerCase()

  // Excluir explícitamente llamadas a APIs LLM, servidores MCP y servicios dinámicos
  if (
    url.hostname === 'api.github.com' ||
    url.hostname === 'api.openai.com' ||
    pathname.includes('/api/') ||
    pathname.includes('/v1/') ||
    pathname.includes('/v4/') ||
    pathname.includes('/mcp') ||
    pathname.includes('/sse') ||
    pathname.includes('/graphql')
  ) {
    return false
  }

  // Excluir peticiones internas de desarrollo y HMR de Vite
  if (
    pathname.startsWith('/@') ||
    pathname.includes('/@vite/') ||
    url.searchParams.has('token')
  ) {
    return false
  }

  // Permitir recursos estáticos de fuentes de Google (Roboto, Inter, Space Grotesk)
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    return true
  }

  const currentOrigin = typeof self !== 'undefined' && self.location ? self.location.origin : null
  const isSameOrigin = currentOrigin
    ? url.origin === currentOrigin
    : (url.hostname === 'localhost' || url.hostname === '127.0.0.1' || !url.hostname.includes('.'))

  if (!isSameOrigin) {
    const isStaticCDN =
      url.hostname.includes('cdn') ||
      url.hostname.includes('cdnjs') ||
      url.hostname.includes('unpkg')

    const hasStaticExt = STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))
    const hasStaticDest = Boolean(request.destination && STATIC_DESTINATIONS.includes(request.destination))

    return isStaticCDN && (hasStaticExt || hasStaticDest)
  }

  if (request.destination && STATIC_DESTINATIONS.includes(request.destination)) {
    return true
  }

  if (STATIC_EXTENSIONS.some((ext) => pathname.endsWith(ext))) {
    return true
  }

  if (
    pathname === '/' ||
    pathname.endsWith('/') ||
    pathname.includes('/assets/') ||
    APP_SHELL.some((shellPath) => {
      const normalized = shellPath.replace(/^\./, '')
      return pathname === normalized || pathname.endsWith(normalized)
    })
  ) {
    return true
  }

  return false
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(
      caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).catch((err) => {
        console.warn('[SW] Error pre-cacheando app shell:', err)
      })
    )
    self.skipWaiting()
  })

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys().then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))
      )
    )
    self.clients.claim()
  })

  self.addEventListener('message', (event) => {
    if (event.data && event.data.type === 'SKIP_WAITING') {
      self.skipWaiting()
    }
  })

  self.addEventListener('fetch', (event) => {
    if (!isStaticRequest(event.request)) {
      return
    }

    if (isNavigationRequest(event.request)) {
      event.respondWith(
        fetch(event.request)
          .then((networkResponse) => {
            if (networkResponse && networkResponse.status === 200) {
              const responseToCache = networkResponse.clone()
              caches.open(CACHE_NAME).then((cache) => {
                cache.put(event.request, responseToCache)
              })
            }
            return networkResponse
          })
          .catch(() => {
            return caches.match(event.request).then((cached) => {
              if (cached) return cached
              return caches.match('./index.html')
            })
          })
      )
      return
    }

    event.respondWith(
      caches.match(event.request).then((cachedResponse) => {
        if (cachedResponse) {
          return cachedResponse
        }

        return fetch(event.request)
          .then((networkResponse) => {
            if (
              !networkResponse ||
              networkResponse.status !== 200 ||
              (networkResponse.type !== 'basic' && networkResponse.type !== 'cors')
            ) {
              return networkResponse
            }

            const responseToCache = networkResponse.clone()
            caches.open(CACHE_NAME).then((cache) => {
              cache.put(event.request, responseToCache)
            })

            return networkResponse
          })
          .catch((error) => {
            if (event.request.mode === 'navigate' || event.request.destination === 'document') {
              return caches.match('./index.html')
            }
            throw error
          })
      })
    )
  })
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isStaticRequest, isNavigationRequest, CACHE_NAME, APP_SHELL, STATIC_EXTENSIONS, STATIC_DESTINATIONS }
}
