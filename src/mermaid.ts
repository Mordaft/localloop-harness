import type { ComponentNode } from './agent/sdlc-state'

let mermaidLoadingPromise: Promise<any> | null = null

/**
 * Asegura la disponibilidad del módulo Mermaid en tiempo de ejecución.
 * Prioriza la instancia global cargada por el CDN en index.html.
 * Si aún no está lista, la importa dinámicamente desde el CDN de jsdelivr.
 */
export async function ensureMermaid(): Promise<any> {
  if (typeof window === 'undefined') return null
  const globalMermaid = (window as any).mermaid
  if (globalMermaid && typeof globalMermaid.render === 'function') {
    return globalMermaid
  }

  if (!mermaidLoadingPromise) {
    mermaidLoadingPromise = (async () => {
      try {
        const mod = await import(
          /* @vite-ignore */ 'https://cdn.jsdelivr.net/npm/mermaid@11/dist/mermaid.esm.min.mjs'
        )
        const instance = mod.default || mod
        const isDark =
          document.documentElement.classList.contains('dark') ||
          !document.documentElement.classList.contains('light')
        instance.initialize({
          startOnLoad: false,
          theme: isDark ? 'dark' : 'default',
          securityLevel: 'loose',
          fontFamily:
            'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        })
        ;(window as any).mermaid = instance
        return instance
      } catch (err) {
        console.warn('[LocalLoop] No se pudo cargar Mermaid desde CDN:', err)
        return null
      }
    })()
  }

  return mermaidLoadingPromise
}

/**
 * Actualiza el tema de Mermaid (dark / default) en caliente según el estado de la aplicación.
 */
export function updateMermaidTheme(isDark: boolean): void {
  if (typeof window === 'undefined') return
  const mermaid = (window as any).mermaid
  if (mermaid && typeof mermaid.initialize === 'function') {
    try {
      mermaid.initialize({
        theme: isDark ? 'dark' : 'default',
      })
    } catch (err) {
      console.warn('[LocalLoop] Aviso al actualizar tema de Mermaid:', err)
    }
  }
}

/**
 * Escanea y procesa todos los elementos con clase `.mermaid` no procesados dentro de un contenedor DOM.
 */
export async function renderMermaidInDom(container: ParentNode = document): Promise<void> {
  if (typeof window === 'undefined') return
  const nodes = Array.from(
    container.querySelectorAll<HTMLElement>('.mermaid:not([data-processed="true"])')
  )
  if (nodes.length === 0) return

  const mermaid = await ensureMermaid()
  if (!mermaid || typeof mermaid.run !== 'function') return

  try {
    await mermaid.run({
      nodes,
      suppressErrors: true,
    })
  } catch (err) {
    console.warn('[LocalLoop] Aviso al renderizar diagramas Mermaid:', err)
  } finally {
    for (const node of nodes) {
      node.setAttribute('data-processed', 'true')
    }
  }
}

/**
 * Genera la representación en sintaxis Mermaid (graph TD) del grafo DAG de componentes y sus dependencias Fin-Inicio.
 */
export function generateMermaidDag(componentsGraph: Record<string, ComponentNode> | undefined): string {
  if (!componentsGraph || Object.keys(componentsGraph).length === 0) {
    return ''
  }

  const lines: string[] = ['```mermaid', 'graph TD']
  const comps = Object.values(componentsGraph)

  for (const c of comps) {
    const cleanName = (c.name || c.id).replace(/["[\]()]/g, '')
    lines.push(`  ${c.id}["${cleanName} (${c.id})"]`)
  }

  for (const c of comps) {
    if (c.dependsOn && c.dependsOn.length > 0) {
      for (const dep of c.dependsOn) {
        if (dep && dep.trim()) {
          lines.push(`  ${dep.trim()} --> ${c.id}`)
        }
      }
    }
  }

  lines.push('```')
  return lines.join('\n')
}

