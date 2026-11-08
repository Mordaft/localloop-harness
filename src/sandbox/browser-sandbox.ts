import { trace } from '../diagnostics'
import { getVirtualFile } from '../fs/workspace-fs'
import type { OpenAiToolSpec } from '../llm/llm-client'

export interface BrowserSandboxElementInfo {
  selector: string
  tagName: string
  id?: string
  className?: string
  textContent: string
  innerHTML: string
  outerHTML: string
  attributes: Record<string, string>
  rect: { x: number; y: number; width: number; height: number }
  computedStyle?: Record<string, string>
}

export interface BrowserSandboxDomSnapshot {
  title: string
  html: string
  text: string
  queriedElements: BrowserSandboxElementInfo[]
}

export interface BrowserSandboxOptions {
  html?: string
  css?: string
  code?: string
  files?: Array<{ path: string; content: string }>
  domSelector?: string
  selectors?: string[]
  captureScreenshot?: boolean
  viewportWidth?: number
  viewportHeight?: number
  timeoutMs?: number
}

export interface BrowserSandboxResult {
  ok: boolean
  logs: string[]
  returnValue?: string
  error?: string
  dom: BrowserSandboxDomSnapshot
  screenshotDataUrl?: string
  durationMs: number
}

type WorkerBrowserSandboxDispatcher = (
  options: BrowserSandboxOptions,
) => Promise<BrowserSandboxResult>

let workerDispatcher: WorkerBrowserSandboxDispatcher | undefined
let lastBrowserSandboxResult: BrowserSandboxResult | undefined

export function setWorkerBrowserSandboxDispatcher(
  dispatcher: WorkerBrowserSandboxDispatcher | undefined,
): void {
  workerDispatcher = dispatcher
}

export function getLastBrowserSandboxResult(): BrowserSandboxResult | undefined {
  return lastBrowserSandboxResult
}

export function getBrowserSandboxToolSpec(): OpenAiToolSpec {
  return {
    type: 'function',
    function: {
      name: 'run_browser_sandbox',
      description:
        'Ejecuta una prueba automatizada o fragmento web (HTML, CSS y JavaScript) en el navegador dentro de un sandbox aislado construido en un iframe (sandbox="allow-scripts"). Permite al LLM consultar el DOM resultante, inspeccionar selectores CSS, leer los logs de consola/errores y obtener una captura (screenshot data URL) del área renderizada.',
      parameters: {
        type: 'object',
        properties: {
          html: {
            type: 'string',
            description: 'Markup HTML a renderizar dentro del iframe aislado.',
          },
          css: {
            type: 'string',
            description: 'Hoja de estilos CSS opcional a inyectar en el documento del iframe.',
          },
          code: {
            type: 'string',
            description:
              'Código JavaScript o prueba automatizada a ejecutar sobre el DOM renderizado (tiene acceso a document, window y console).',
          },
          domSelector: {
            type: 'string',
            description:
              'Selector CSS opcional (ej. "#app, .card, button") para consultar elementos específicos del DOM tras la ejecución.',
          },
          selectors: {
            type: 'array',
            items: { type: 'string' },
            description: 'Lista opcional de selectores CSS adicionales a consultar en el DOM.',
          },
          captureScreenshot: {
            type: 'boolean',
            description:
              'Si es true (por defecto true), genera una captura visual (data:image/png;base64 o data:image/svg+xml;base64) del área renderizada.',
          },
          viewportWidth: {
            type: 'integer',
            minimum: 200,
            maximum: 1920,
            description: 'Ancho del viewport del iframe en píxeles (por defecto 800).',
          },
          viewportHeight: {
            type: 'integer',
            minimum: 150,
            maximum: 1080,
            description: 'Alto del viewport del iframe en píxeles (por defecto 600).',
          },
          timeoutMs: {
            type: 'integer',
            minimum: 200,
            maximum: 15000,
            description: 'Tiempo máximo de ejecución en milisegundos (por defecto 5000ms).',
          },
        },
      },
    },
  }
}

interface OriginLike {
  opaque: boolean
  isSameOrigin(other: OriginLike): boolean
}

interface OriginConstructorLike {
  new (): OriginLike
  from(value: unknown): OriginLike
}

/**
 * Validates incoming postMessage events from a sandboxed `<iframe sandbox="allow-scripts">`
 * whose serialized `event.origin` is `"null"`. Uses the modern `Origin` API (`Origin.from(event)`)
 * when supported by the browser, falling back to `event.source === expectedWindow`.
 */
export function createSandboxedIframeMessageValidator(expectedWindow: Window | null) {
  const OriginApi = (globalThis as unknown as { Origin?: OriginConstructorLike }).Origin
  let pinnedOrigin: OriginLike | undefined

  return (event: MessageEvent): boolean => {
    if (!expectedWindow || event.source !== expectedWindow) {
      return false
    }
    if (OriginApi && typeof OriginApi.from === 'function') {
      try {
        const senderOrigin = OriginApi.from(event)
        if (!pinnedOrigin) {
          pinnedOrigin = senderOrigin
        }
        return senderOrigin.isSameOrigin(pinnedOrigin)
      } catch {
        // Synthetic MessageEvent or browser without MessageEvent Origin extraction
        return event.source === expectedWindow
      }
    }
    return event.source === expectedWindow
  }
}

export function stripMarkdownCodeFences(raw: string): string {
  const trimmed = raw.trim()
  const fenceMatch = trimmed.match(/^```(?:[a-zA-Z0-9_-]+)?\s*\n([\s\S]*?)\n?```$/)
  if (fenceMatch) {
    return fenceMatch[1].trim()
  }
  return trimmed
}

function normalizeSelectorList(options: BrowserSandboxOptions): string[] {
  const list: string[] = []
  if (typeof options.domSelector === 'string' && options.domSelector.trim()) {
    list.push(options.domSelector.trim())
  }
  if (Array.isArray(options.selectors)) {
    for (const s of options.selectors) {
      if (typeof s === 'string' && s.trim() && !list.includes(s.trim())) {
        list.push(s.trim())
      }
    }
  }
  return list
}

function lookupWorkspaceFile(
  targetPath: string,
  files?: Array<{ path: string; content: string }>,
): string | undefined {
  if (!targetPath) return undefined
  const normalized = targetPath.replace(/^\.?\/+/, '').toLowerCase()
  const basename = normalized.split('/').pop() || normalized

  if (files && files.length > 0) {
    const exact = files.find(
      (f) => f.path.replace(/^\.?\/+/, '').toLowerCase() === normalized,
    )
    if (exact) return exact.content

    const endsWith = files.find((f) =>
      f.path.replace(/^\.?\/+/, '').toLowerCase().endsWith(normalized),
    )
    if (endsWith) return endsWith.content

    const baseMatch = files.find(
      (f) => (f.path.split('/').pop() || '').toLowerCase() === basename,
    )
    if (baseMatch) return baseMatch.content
  }

  try {
    const v1 = getVirtualFile(normalized)
    if (v1 !== undefined) return v1
    const v2 = getVirtualFile(targetPath)
    if (v2 !== undefined) return v2
    const v3 = getVirtualFile(basename)
    if (v3 !== undefined) return v3
  } catch {
    // Ignore virtual FS lookup failure
  }

  return undefined
}

function sanitizeTsForBrowser(code: string): string {
  return code
    .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?/gm, '// [import stripped]')
    .replace(/^import\s+['"][^'"]+['"];?/gm, '// [import stripped]')
    .replace(/^export\s+(?:default\s+)?/gm, '')
    .replace(/^(?:export\s+)?(?:interface|type)\s+[\s\S]*?\{[\s\S]*?\}/gm, '')
}

/**
 * Preprocesa el HTML y CSS a inyectar en el sandbox del iframe:
 * 1. Resuelve e inyecta hojas de estilos <link rel="stylesheet"> a partir de los ficheros del workspace,
 *    y neutraliza enlaces externos relativos para evitar bloqueos CORS con Origin: null.
 * 2. Resuelve e inyecta scripts <script src="..."> a partir de ficheros del workspace,
 *    eliminando el atributo `src` para evitar peticiones net::ERR_FAILED al servidor de la app anfitriona.
 * 3. Extrae el contenido de <body> y estilos embebidos si el código proporcionado es un documento HTML completo.
 */
export function resolveSandboxHtmlAndAssets(
  rawHtml: string,
  rawCss: string = '',
  files?: Array<{ path: string; content: string }>,
): { html: string; css: string; bodyClass?: string } {
  let inlinedCss = rawCss ? `${rawCss}\n` : ''
  let workingHtml = rawHtml || ''
  let extractedBodyClass: string | undefined

  // 1. Resolver o neutralizar <link rel="stylesheet"> y <link rel="manifest">
  workingHtml = workingHtml.replace(
    /<link\b([^>]*)\bhref=(["'])([^"']+)\2([^>]*)>/gi,
    (match, before, _quote, href, after) => {
      const allAttrs = `${before} ${after}`
      const isRelStylesheet = /rel=(["'])stylesheet\1/i.test(allAttrs)
      const isRelManifest = /rel=(["'])manifest\1/i.test(allAttrs)

      if (isRelManifest) {
        return `<!-- [LocalLoop Sandbox] Manifest omitido en iframe para evitar fallo CORS: ${href} -->`
      }

      if (isRelStylesheet) {
        const fileContent = lookupWorkspaceFile(href, files)
        if (fileContent) {
          inlinedCss += `\n/* [LocalLoop Sandbox] Hoja de estilos inyectada desde ${href} */\n${fileContent}\n`
          return `<!-- [LocalLoop Sandbox] Estilos inyectados desde: ${href} -->`
        }
        if (!/^https?:\/\//i.test(href)) {
          return `<!-- [LocalLoop Sandbox] Hoja de estilos relativa no encontrada en workspace (omitida para evitar CORS): ${href} -->`
        }
      }

      if (!/^https?:\/\//i.test(href)) {
        return `<!-- [LocalLoop Sandbox] Enlace relativo omitido: ${href} -->`
      }
      return match
    },
  )

  // 2. Resolver o neutralizar <script ... src="...">...</script>
  workingHtml = workingHtml.replace(
    /<script\b([^>]*)\bsrc=(["'])([^"']+)\2([^>]*)>([\s\S]*?)<\/script>/gi,
    (_match, before, _quote, src, after) => {
      if (/^https?:\/\//i.test(src)) {
        return _match
      }

      const fileContent = lookupWorkspaceFile(src, files)
      if (fileContent) {
        const safeScript = src.endsWith('.ts') ? sanitizeTsForBrowser(fileContent) : fileContent
        const safeBody = safeScript.replace(/<\/script/gi, '<\\/script')
        return `<script data-inlined-from="${src}" ${before} ${after}>
/* [LocalLoop Sandbox] Inyectado desde workspace: ${src} */
try {
${safeBody}
} catch (inlinedScriptErr) {
  console.warn('[LocalLoop Sandbox] Error ejecutando script inyectado ${src}:', inlinedScriptErr);
}
</script>`
      }

      return `<script data-sandbox-stub="${src}">
/* [LocalLoop Sandbox] Script no encontrado en workspace: ${src} */
console.info('[LocalLoop Sandbox] Script relativo simulado para evitar CORS: ${src}');
</script>`
    },
  )

  // 3. Normalizar documentos HTML completos (<!DOCTYPE> o <html>) extrayendo <head> y <body>
  if (/<html[\s>]/i.test(workingHtml) || /<!DOCTYPE/i.test(workingHtml)) {
    workingHtml = workingHtml.replace(/<style\b[^>]*>([\s\S]*?)<\/style>/gi, (_match, styleContent) => {
      inlinedCss += `\n${styleContent}\n`
      return ''
    })

    const bodyOpenMatch = workingHtml.match(/<body\b([^>]*)>/i)
    if (bodyOpenMatch) {
      const classMatch = bodyOpenMatch[1].match(/class=(["'])([^"']+)\1/i)
      if (classMatch) {
        extractedBodyClass = classMatch[2]
      }
    }

    const bodyMatch = workingHtml.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)
    if (bodyMatch) {
      workingHtml = bodyMatch[1].trim()
    } else {
      workingHtml = workingHtml
        .replace(/<!DOCTYPE[\s\S]*?>/gi, '')
        .replace(/<\/?(html|head|meta|title)[\s\S]*?>/gi, '')
        .trim()
    }
  }

  return {
    html: workingHtml,
    css: inlinedCss.trim(),
    bodyClass: extractedBodyClass,
  }
}

function buildIframeSrcDoc(params: {
  requestId: string
  html: string
  css: string
  code: string
  selectors: string[]
  captureScreenshot: boolean
  width: number
  height: number
  bodyClass?: string
}): string {
  const safePayload = JSON.stringify({
    requestId: params.requestId,
    code: stripMarkdownCodeFences(params.code),
    selectors: params.selectors,
    captureScreenshot: params.captureScreenshot,
    width: params.width,
    height: params.height,
  }).replace(/<\/script/gi, '<\\/script')

  const bodyClassAttr = params.bodyClass ? ` class="${params.bodyClass}"` : ''

  return `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <style>
    html, body {
      margin: 0;
      padding: 12px;
      font-family: system-ui, -apple-system, sans-serif;
      background: #ffffff;
      color: #0f172a;
      box-sizing: border-box;
    }
    *, *::before, *::after { box-sizing: inherit; }
    ${params.css}
  </style>
</head>
<body${bodyClassAttr}>
  <div id="sandbox-root">${params.html}</div>
  <script>
    (function() {
      const payload = ${safePayload};
      const logs = [];
      function formatArg(a) {
        if (a === null) return 'null';
        if (a === undefined) return 'undefined';
        if (typeof a === 'object') {
          try { return JSON.stringify(a); } catch { return String(a); }
        }
        return String(a);
      }
      const origConsole = window.console;
      const customConsole = {
        log: (...args) => { logs.push(args.map(formatArg).join(' ')); origConsole.log(...args); },
        info: (...args) => { logs.push('[INFO] ' + args.map(formatArg).join(' ')); origConsole.info(...args); },
        warn: (...args) => { logs.push('[WARN] ' + args.map(formatArg).join(' ')); origConsole.warn(...args); },
        error: (...args) => { logs.push('[ERROR] ' + args.map(formatArg).join(' ')); origConsole.error(...args); },
      };
      window.console = customConsole;

      window.addEventListener('error', (ev) => {
        logs.push('[UNCAUGHT_ERROR] ' + (ev.message || String(ev.error || 'Error')));
      });
      window.addEventListener('unhandledrejection', (ev) => {
        logs.push('[UNHANDLED_REJECTION] ' + formatArg(ev.reason));
      });

      function inspectDom(selectors) {
        const rootEl = document.getElementById('sandbox-root') || document.body;
        const queriedElements = [];
        const effectiveSelectors = selectors.length > 0 ? selectors : ['#sandbox-root > *'];
        for (const sel of effectiveSelectors) {
          try {
            const nodes = document.querySelectorAll(sel);
            nodes.forEach((el) => {
              if (queriedElements.length >= 40) return;
              const attrs = {};
              if (el.attributes) {
                for (let i = 0; i < el.attributes.length; i++) {
                  const at = el.attributes[i];
                  attrs[at.name] = at.value;
                }
              }
              const r = el.getBoundingClientRect();
              const cs = window.getComputedStyle(el);
              queriedElements.push({
                selector: sel,
                tagName: el.tagName.toLowerCase(),
                id: el.id || undefined,
                className: typeof el.className === 'string' && el.className ? el.className : undefined,
                textContent: (el.textContent || '').trim().slice(0, 500),
                innerHTML: (el.innerHTML || '').trim().slice(0, 800),
                outerHTML: (el.outerHTML || '').trim().slice(0, 1000),
                attributes: attrs,
                rect: {
                  x: Math.round(r.x),
                  y: Math.round(r.y),
                  width: Math.round(r.width),
                  height: Math.round(r.height),
                },
                computedStyle: {
                  display: cs.display,
                  visibility: cs.visibility,
                  color: cs.color,
                  backgroundColor: cs.backgroundColor,
                  fontSize: cs.fontSize,
                },
              });
            });
          } catch (selErr) {
            logs.push('[WARN] Selector inválido "' + sel + '": ' + (selErr.message || String(selErr)));
          }
        }
        return {
          title: document.title || 'Sandbox Iframe',
          html: rootEl ? rootEl.innerHTML : document.body.innerHTML,
          text: (rootEl ? rootEl.innerText || rootEl.textContent : document.body.innerText || '')
            .trim()
            .slice(0, 4000),
          queriedElements,
        };
      }

      function renderFallbackCanvasScreenshot(width, height) {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return undefined;

        const bodyStyle = window.getComputedStyle(document.body);
        ctx.fillStyle =
          bodyStyle.backgroundColor && bodyStyle.backgroundColor !== 'rgba(0, 0, 0, 0)'
            ? bodyStyle.backgroundColor
            : '#ffffff';
        ctx.fillRect(0, 0, width, height);

        const rootEl = document.getElementById('sandbox-root') || document.body;
        const elements = [rootEl, ...Array.from(rootEl.querySelectorAll('*'))];
        for (const el of elements.slice(0, 80)) {
          const cs = window.getComputedStyle(el);
          if (cs.display === 'none' || cs.visibility === 'hidden') continue;
          const r = el.getBoundingClientRect();
          if (r.width <= 0 || r.height <= 0) continue;

          if (cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)') {
            ctx.fillStyle = cs.backgroundColor;
            ctx.fillRect(r.x, r.y, r.width, r.height);
          }
          if (parseFloat(cs.borderTopWidth) > 0) {
            ctx.strokeStyle = cs.borderTopColor || '#cbd5e1';
            ctx.lineWidth = parseFloat(cs.borderTopWidth) || 1;
            ctx.strokeRect(r.x, r.y, r.width, r.height);
          }

          let directText = '';
          for (const child of Array.from(el.childNodes)) {
            if (child.nodeType === Node.TEXT_NODE) {
              directText += child.textContent || '';
            }
          }
          directText = directText.trim();
          if (directText) {
            ctx.fillStyle = cs.color || '#0f172a';
            const fontSize = parseFloat(cs.fontSize) || 14;
            ctx.font = (cs.fontWeight || '400') + ' ' + fontSize + 'px sans-serif';
            ctx.fillText(directText.slice(0, 120), r.x + 4, r.y + fontSize + 2, Math.max(40, r.width - 8));
          }
        }
        return canvas.toDataURL('image/png');
      }

      async function captureRenderedArea(width, height) {
        try {
          const rootEl = document.getElementById('sandbox-root') || document.body;
          const clone = rootEl.cloneNode(true);
          const serializer = new XMLSerializer();
          const serializedHtml = serializer.serializeToString(clone);
          const styleTags = Array.from(document.querySelectorAll('style'))
            .map((s) => s.textContent || '')
            .join(' ');

          const svgString =
            '<svg xmlns="http://www.w3.org/2000/svg" width="' + width + '" height="' + height + '">' +
            '<foreignObject width="100%" height="100%">' +
            '<div xmlns="http://www.w3.org/1999/xhtml" style="width:100%;height:100%;background:#ffffff;color:#0f172a;padding:12px;box-sizing:border-box;">' +
            '<style>' + styleTags.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</style>' +
            serializedHtml +
            '</div>' +
            '</foreignObject>' +
            '</svg>';

          const svgDataUrl = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgString);
          const pngUrl = await new Promise((resolve) => {
            const img = new Image();
            const timer = setTimeout(() => resolve(undefined), 600);
            img.onload = () => {
              clearTimeout(timer);
              try {
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                if (!ctx) {
                  resolve(undefined);
                  return;
                }
                ctx.fillStyle = '#ffffff';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0);
                resolve(canvas.toDataURL('image/png'));
              } catch {
                resolve(undefined);
              }
            };
            img.onerror = () => {
              clearTimeout(timer);
              resolve(undefined);
            };
            img.src = svgDataUrl;
          });

          if (pngUrl) return pngUrl;
        } catch {
          // Fall through to direct Canvas 2D renderer
        }
        return renderFallbackCanvasScreenshot(width, height);
      }

      async function run() {
        let ok = true;
        let returnValue = undefined;
        let errorMsg = undefined;

        if (payload.code && payload.code.trim()) {
          try {
            const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
            const fn = new AsyncFunction('console', 'document', 'window', payload.code);
            const res = await fn(customConsole, document, window);
            if (res !== undefined) {
              returnValue = typeof res === 'string' ? res : JSON.stringify(res);
            }
          } catch (err) {
            ok = false;
            errorMsg = err instanceof Error ? err.message : String(err);
            logs.push('[ERROR] ' + errorMsg);
          }
        }

        // Wait one animation frame / tick for DOM mutations to settle
        await new Promise((r) => setTimeout(r, 16));

        const dom = inspectDom(payload.selectors || []);
        let screenshotDataUrl = undefined;
        if (payload.captureScreenshot) {
          screenshotDataUrl = await captureRenderedArea(payload.width, payload.height);
        }

        window.parent.postMessage({
          type: 'LOCALLOOP_IFRAME_SANDBOX_RESULT',
          sandboxRequestId: payload.requestId,
          ok,
          logs,
          returnValue,
          error: errorMsg,
          dom,
          screenshotDataUrl,
        }, '*');
      }

      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', () => { void run(); });
      } else {
        void run();
      }
    })();
  </script>
</body>
</html>`
}

/**
 * Executes HTML/CSS/JS inside a real browser `<iframe sandbox="allow-scripts">` on the main thread,
 * querying the resulting DOM, collecting console/error logs, and capturing a screenshot of the rendered area.
 */
export async function executeBrowserSandboxInDom(
  options: BrowserSandboxOptions,
): Promise<BrowserSandboxResult> {
  const startedAt = performance.now()
  const width = Math.min(1920, Math.max(200, options.viewportWidth ?? 800))
  const height = Math.min(1080, Math.max(150, options.viewportHeight ?? 600))
  const safeTimeout = Math.min(15000, Math.max(200, options.timeoutMs ?? 5000))
  const captureScreenshot = options.captureScreenshot !== false
  const selectors = normalizeSelectorList(options)
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `sbx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`

  const hostContainer = document.createElement('div')
  hostContainer.setAttribute('data-localloop-sandbox-host', requestId)
  hostContainer.style.position = 'fixed'
  hostContainer.style.left = '-10000px'
  hostContainer.style.top = '0px'
  hostContainer.style.width = `${width}px`
  hostContainer.style.height = `${height}px`
  hostContainer.style.overflow = 'hidden'
  hostContainer.style.pointerEvents = 'none'
  hostContainer.style.opacity = '0'

  const iframe = document.createElement('iframe')
  iframe.setAttribute('sandbox', 'allow-scripts')
  iframe.style.width = `${width}px`
  iframe.style.height = `${height}px`
  iframe.style.border = '0'

  hostContainer.appendChild(iframe)
  document.body.appendChild(hostContainer)

  const { html: resolvedHtml, css: resolvedCss, bodyClass } = resolveSandboxHtmlAndAssets(
    options.html ?? '',
    options.css ?? '',
    options.files,
  )

  const srcdoc = buildIframeSrcDoc({
    requestId,
    html: resolvedHtml,
    css: resolvedCss,
    code: options.code ?? '',
    selectors,
    captureScreenshot,
    width,
    height,
    bodyClass,
  })

  try {
    const result = await new Promise<BrowserSandboxResult>((resolve) => {
      let settled = false
      let validateSender: ((ev: MessageEvent) => boolean) | undefined

      const timer = setTimeout(() => {
        if (settled) return
        settled = true
        window.removeEventListener('message', onMessage)
        resolve({
          ok: false,
          logs: [],
          error: `Tiempo de ejecución excedido en Browser Iframe Sandbox (${safeTimeout}ms).`,
          dom: {
            title: 'Timeout',
            html: options.html ?? '',
            text: '',
            queriedElements: [],
          },
          durationMs: Math.round(performance.now() - startedAt),
        })
      }, safeTimeout)

      function onMessage(event: MessageEvent) {
        if (settled) return
        const data = event.data as Record<string, unknown> | undefined
        if (!data || data.type !== 'LOCALLOOP_IFRAME_SANDBOX_RESULT') return
        if (data.sandboxRequestId !== requestId) return

        if (!validateSender) {
          validateSender = createSandboxedIframeMessageValidator(iframe.contentWindow)
        }
        if (!validateSender(event)) return

        settled = true
        clearTimeout(timer)
        window.removeEventListener('message', onMessage)

        resolve({
          ok: Boolean(data.ok),
          logs: Array.isArray(data.logs) ? data.logs.map(String) : [],
          returnValue: typeof data.returnValue === 'string' ? data.returnValue : undefined,
          error: typeof data.error === 'string' ? data.error : undefined,
          dom: (data.dom as BrowserSandboxDomSnapshot) ?? {
            title: 'Sandbox Iframe',
            html: '',
            text: '',
            queriedElements: [],
          },
          screenshotDataUrl:
            typeof data.screenshotDataUrl === 'string' ? data.screenshotDataUrl : undefined,
          durationMs: Math.round(performance.now() - startedAt),
        })
      }

      window.addEventListener('message', onMessage)
      iframe.srcdoc = srcdoc
    })

    lastBrowserSandboxResult = result
    trace('sandbox.browser_iframe.executed', {
      ok: result.ok,
      durationMs: result.durationMs,
      logsCount: result.logs.length,
      queriedCount: result.dom.queriedElements.length,
      hasScreenshot: Boolean(result.screenshotDataUrl),
    })
    return result
  } finally {
    hostContainer.remove()
  }
}

/**
 * Lightweight virtual DOM & SVG screenshot fallback for Node.js unit test environments
 * where `document` and `HTMLIFrameElement` are not natively present.
 */
async function executeVirtualBrowserSandboxFallback(
  options: BrowserSandboxOptions,
): Promise<BrowserSandboxResult> {
  const startedAt = performance.now()
  const width = Math.min(1920, Math.max(200, options.viewportWidth ?? 800))
  const height = Math.min(1080, Math.max(150, options.viewportHeight ?? 600))
  const selectors = normalizeSelectorList(options)
  const logs: string[] = []

  const formatArg = (a: unknown): string => {
    if (a === null) return 'null'
    if (a === undefined) return 'undefined'
    if (typeof a === 'object') {
      try {
        return JSON.stringify(a)
      } catch {
        return String(a)
      }
    }
    return String(a)
  }

  const customConsole = {
    log: (...args: unknown[]) => logs.push(args.map(formatArg).join(' ')),
    info: (...args: unknown[]) => logs.push('[INFO] ' + args.map(formatArg).join(' ')),
    warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(formatArg).join(' ')),
    error: (...args: unknown[]) => logs.push('[ERROR] ' + args.map(formatArg).join(' ')),
  }

  interface VirtualNode {
    tagName: string
    id: string
    className: string
    attributes: Record<string, string>
    style: Record<string, string>
    innerHTML: string
    textContent: string
    outerHTML: string
    children: VirtualNode[]
    listeners: Record<string, Array<(ev?: unknown) => void>>
    setAttribute(name: string, value: string): void
    getAttribute(name: string): string | null
    addEventListener(type: string, cb: (ev?: unknown) => void): void
    click(): void
    appendChild(child: VirtualNode): VirtualNode
    querySelector(sel: string): VirtualNode | null
    querySelectorAll(sel: string): VirtualNode[]
    getBoundingClientRect(): { x: number; y: number; width: number; height: number }
  }

  const allNodes: VirtualNode[] = []

  function stripTags(raw: string): string {
    return raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim()
  }

  function createVirtualElement(
    tagName: string,
    attrs: Record<string, string> = {},
    inner = '',
  ): VirtualNode {
    const node: VirtualNode = {
      tagName: tagName.toUpperCase(),
      id: attrs.id ?? '',
      className: attrs.class ?? attrs.className ?? '',
      attributes: { ...attrs },
      style: {},
      innerHTML: inner,
      textContent: stripTags(inner),
      get outerHTML() {
        const attrPairs = Object.entries(this.attributes)
          .map(([k, v]) => `${k}="${v}"`)
          .join(' ')
        const open = attrPairs
          ? `<${this.tagName.toLowerCase()} ${attrPairs}>`
          : `<${this.tagName.toLowerCase()}>`
        return `${open}${this.innerHTML}</${this.tagName.toLowerCase()}>`
      },
      children: [],
      listeners: {},
      setAttribute(name: string, value: string) {
        this.attributes[name] = String(value)
        if (name === 'id') this.id = String(value)
        if (name === 'class') this.className = String(value)
      },
      getAttribute(name: string) {
        return name in this.attributes ? this.attributes[name] : null
      },
      addEventListener(type: string, cb: (ev?: unknown) => void) {
        if (!this.listeners[type]) this.listeners[type] = []
        this.listeners[type].push(cb)
      },
      click() {
        for (const cb of this.listeners.click ?? []) {
          cb({ target: this })
        }
      },
      appendChild(child: VirtualNode) {
        this.children.push(child)
        if (!allNodes.includes(child)) allNodes.push(child)
        this.innerHTML += child.outerHTML
        this.textContent = stripTags(this.innerHTML)
        return child
      },
      querySelector(sel: string) {
        return matchNodes(sel)[0] ?? null
      },
      querySelectorAll(sel: string) {
        return matchNodes(sel)
      },
      getBoundingClientRect() {
        return { x: 12, y: 12, width: Math.min(240, width - 24), height: 36 }
      },
    }

    let internalText = stripTags(inner)
    let internalHtml = inner
    Object.defineProperty(node, 'textContent', {
      get() {
        return internalText
      },
      set(val: unknown) {
        internalText = String(val ?? '')
        internalHtml = internalText
      },
      enumerable: true,
    })
    Object.defineProperty(node, 'innerHTML', {
      get() {
        return internalHtml
      },
      set(val: unknown) {
        internalHtml = String(val ?? '')
        internalText = stripTags(internalHtml)
        parseHtmlIntoNodes(internalHtml)
      },
      enumerable: true,
    })

    allNodes.push(node)
    return node
  }

  function parseHtmlIntoNodes(htmlStr: string): void {
    const tagRegex = /<([a-zA-Z0-9-]+)([^>]*)>([\s\S]*?)<\/\1>/g
    let match: RegExpExecArray | null
    while ((match = tagRegex.exec(htmlStr)) !== null) {
      const [, tag, rawAttrs, inner] = match
      const attrs: Record<string, string> = {}
      const attrRegex = /([a-zA-Z0-9_-]+)\s*=\s*["']([^"']*)["']/g
      let attrMatch: RegExpExecArray | null
      while ((attrMatch = attrRegex.exec(rawAttrs)) !== null) {
        attrs[attrMatch[1]] = attrMatch[2]
      }
      createVirtualElement(tag, attrs, inner)
      if (inner.includes('<')) {
        parseHtmlIntoNodes(inner)
      }
    }
  }

  function matchesSingleSelector(node: VirtualNode, singleSel: string): boolean {
    const s = singleSel.trim()
    if (!s || s === '*' || s === '#sandbox-root > *') return true
    if (s.startsWith('#')) {
      return node.id === s.slice(1)
    }
    if (s.startsWith('.')) {
      const targetClass = s.slice(1)
      return node.className.split(/\s+/).includes(targetClass)
    }
    if (s.includes('#')) {
      const [tagPart, idPart] = s.split('#')
      return node.tagName.toLowerCase() === tagPart.toLowerCase() && node.id === idPart
    }
    if (s.includes('.')) {
      const [tagPart, classPart] = s.split('.')
      return (
        node.tagName.toLowerCase() === tagPart.toLowerCase() &&
        node.className.split(/\s+/).includes(classPart)
      )
    }
    return node.tagName.toLowerCase() === s.toLowerCase()
  }

  function matchNodes(selectorGroup: string): VirtualNode[] {
    const parts = selectorGroup
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean)
    const matched: VirtualNode[] = []
    for (const node of allNodes) {
      if (node.id === 'sandbox-root') continue
      if (parts.some((p) => matchesSingleSelector(node, p))) {
        matched.push(node)
      }
    }
    return matched
  }

  const { html: resolvedHtml } = resolveSandboxHtmlAndAssets(
    options.html ?? '',
    options.css ?? '',
    options.files,
  )

  const rootNode = createVirtualElement('div', { id: 'sandbox-root' }, resolvedHtml)
  parseHtmlIntoNodes(resolvedHtml)

  const virtualDocument = {
    title: 'Sandbox Iframe',
    body: rootNode,
    documentElement: rootNode,
    createElement: (tag: string) => createVirtualElement(tag),
    getElementById: (id: string) => allNodes.find((n) => n.id === id) ?? null,
    querySelector: (sel: string) => matchNodes(sel)[0] ?? null,
    querySelectorAll: (sel: string) => matchNodes(sel),
  }

  const virtualWindow = {
    document: virtualDocument,
    console: customConsole,
    getComputedStyle: (el: VirtualNode) => ({
      display: el?.style?.display || 'block',
      visibility: el?.style?.visibility || 'visible',
      color: el?.style?.color || 'rgb(15, 23, 42)',
      backgroundColor: el?.style?.backgroundColor || 'rgb(255, 255, 255)',
      fontSize: el?.style?.fontSize || '14px',
    }),
  }

  let ok = true
  let returnValue: string | undefined
  let errorMsg: string | undefined

  if (options.code && options.code.trim()) {
    try {
      const cleanCode = stripMarkdownCodeFences(options.code)
      const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
        cArg: string,
        dArg: string,
        wArg: string,
        body: string,
      ) => (
        c: typeof customConsole,
        d: typeof virtualDocument,
        w: typeof virtualWindow,
      ) => Promise<unknown>
      const fn = new AsyncFunction('console', 'document', 'window', cleanCode)
      const res = await fn(customConsole, virtualDocument, virtualWindow)
      if (res !== undefined) {
        returnValue = typeof res === 'string' ? res : JSON.stringify(res)
      }
    } catch (err) {
      ok = false
      errorMsg = err instanceof Error ? err.message : String(err)
      logs.push('[ERROR] ' + errorMsg)
    }
  }

  const effectiveSelectors = selectors.length > 0 ? selectors : ['*']
  const queriedElements: BrowserSandboxElementInfo[] = []
  for (const sel of effectiveSelectors) {
    const matched = matchNodes(sel)
    for (const node of matched) {
      if (queriedElements.length >= 40) break
      queriedElements.push({
        selector: sel,
        tagName: node.tagName.toLowerCase(),
        id: node.id || undefined,
        className: node.className || undefined,
        textContent: node.textContent,
        innerHTML: node.innerHTML,
        outerHTML: node.outerHTML,
        attributes: { ...node.attributes },
        rect: node.getBoundingClientRect(),
        computedStyle: virtualWindow.getComputedStyle(node),
      })
    }
  }

  const consolidatedHtml =
    allNodes
      .filter((n) => n.id !== 'sandbox-root')
      .map((n) => n.outerHTML)
      .join('\n') || rootNode.innerHTML
  const consolidatedText =
    allNodes
      .filter((n) => n.id !== 'sandbox-root')
      .map((n) => n.textContent)
      .filter(Boolean)
      .join(' ')
      .trim() || rootNode.textContent

  let screenshotDataUrl: string | undefined
  if (options.captureScreenshot !== false) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#ffffff"/><text x="16" y="32" font-family="sans-serif" font-size="14" fill="#0f172a">${consolidatedText
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .slice(0, 200)}</text></svg>`
    const utf8Bytes = new TextEncoder().encode(svg)
    let binary = ''
    for (const byte of utf8Bytes) {
      binary += String.fromCharCode(byte)
    }
    const base64 = btoa(binary)
    screenshotDataUrl = `data:image/svg+xml;base64,${base64}`
  }

  const result: BrowserSandboxResult = {
    ok,
    logs,
    returnValue,
    error: errorMsg,
    dom: {
      title: virtualDocument.title,
      html: consolidatedHtml,
      text: consolidatedText,
      queriedElements,
    },
    screenshotDataUrl,
    durationMs: Math.round(performance.now() - startedAt),
  }

  lastBrowserSandboxResult = result
  trace('sandbox.browser_iframe.executed', {
    ok: result.ok,
    durationMs: result.durationMs,
    logsCount: result.logs.length,
    queriedCount: result.dom.queriedElements.length,
    hasScreenshot: Boolean(result.screenshotDataUrl),
  })
  return result
}

/**
 * Unified entry point to run a browser iframe sandbox test from either the Web Worker,
 * the browser main thread, or Node.js test environments.
 */
export async function executeBrowserSandbox(
  options: BrowserSandboxOptions,
): Promise<BrowserSandboxResult> {
  if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
    return executeBrowserSandboxInDom(options)
  }
  if (workerDispatcher) {
    return workerDispatcher(options)
  }
  return executeVirtualBrowserSandboxFallback(options)
}
