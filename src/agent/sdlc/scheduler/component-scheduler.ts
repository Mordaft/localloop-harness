import { trace } from '../../../diagnostics'
import type { ComponentNode, SDLCStateType } from '../../sdlc-state'

/**
 * Detecta componentes involucrados en ciclos directos o indirectos en el grafo.
 */
function findCycleComponents(
  nodes: Record<string, ComponentNode>,
  resolver: (ref: string) => ComponentNode | undefined,
): Set<string> {
  const cyclicNodes = new Set<string>()
  const visited = new Set<string>()
  const recStack = new Set<string>()

  function dfs(compId: string, path: string[]): boolean {
    visited.add(compId)
    recStack.add(compId)

    const node = nodes[compId]
    if (node) {
      for (const depRef of node.dependsOn || []) {
        const depComp = resolver(depRef)
        if (!depComp) continue

        if (recStack.has(depComp.id)) {
          // Ciclo detectado
          const cycleStart = path.indexOf(depComp.id)
          const members = cycleStart !== -1 ? path.slice(cycleStart) : [depComp.id, compId]
          for (const m of members) cyclicNodes.add(m)
          cyclicNodes.add(depComp.id)
          cyclicNodes.add(compId)
          return true
        }

        if (!visited.has(depComp.id)) {
          if (dfs(depComp.id, [...path, depComp.id])) {
            cyclicNodes.add(compId)
          }
        } else if (cyclicNodes.has(depComp.id)) {
          cyclicNodes.add(compId)
        }
      }
    }

    recStack.delete(compId)
    return cyclicNodes.has(compId)
  }

  for (const compId of Object.keys(nodes)) {
    if (!visited.has(compId)) {
      dfs(compId, [compId])
    }
  }

  return cyclicNodes
}

/**
 * NODO DESPACHADOR DE COMPONENTES (Scheduler Fin-Inicio)
 * Evalúa las dependencias Fin-Inicio y despacha el siguiente componente elegible.
 * Bloquea dependencias desconocidas o ciclos y respeta estrictamente el DAG sin rescate automático.
 */
export async function node_component_scheduler(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Evaluando estado de dependencias Fin-Inicio en el grafo...')
  const graph: Record<string, ComponentNode> = {}
  for (const [k, v] of Object.entries(state.componentsGraph || {})) {
    graph[k] = { ...v, dependsOn: [...(v.dependsOn || [])] }
  }

  // Búsqueda flexible de dependencias (por ID exacto, ID insensible a mayúsculas o Nombre de componente)
  const findComp = (depRef: string): ComponentNode | undefined => {
    const clean = depRef.trim().replace(/^[`'"]+|[`'"]+$/g, '')
    if (!clean) return undefined
    if (graph[clean]) return graph[clean]
    const lower = clean.toLowerCase()
    const byLowerId = Object.values(graph).find((c) => c.id.toLowerCase() === lower)
    if (byLowerId) return byLowerId
    const byName = Object.values(graph).find(
      (c) => c.name.toLowerCase() === lower || c.name.toLowerCase().includes(lower),
    )
    if (byName) return byName
    return undefined
  }

  // Detección de ciclos en el grafo
  const cyclicNodes = findCycleComponents(graph, findComp)

  let nextComponentId: string | null = null

  // 1. Evaluar dependencias y desbloquear componentes cuyas dependencias válidas estén todas en VERIFIED
  for (const compId of Object.keys(graph)) {
    const comp = graph[compId]
    const cleanDeps = (comp.dependsOn || [])
      .map((d) => d.trim().replace(/^[`'"]+|[`'"]+$/g, ''))
      .filter(Boolean)

    // Si tiene dependencias desconocidas o inexistentes, bloquear inmediatamente
    const unknownDep = cleanDeps.find((depRef) => !findComp(depRef))
    if (unknownDep) {
      comp.status = 'BLOCKED'
      trace(
        `[SDLCGraph] Componente ${compId} BLOQUEADO: dependencia desconocida o inexistente '${unknownDep}' en el DAG.`,
      )
      continue
    }

    // Si está involucrado en un ciclo, bloquear y no permitir avance
    if (cyclicNodes.has(comp.id)) {
      comp.status = 'BLOCKED'
      trace(`[SDLCGraph] Componente ${compId} BLOQUEADO: ciclo detectado en sus dependencias.`)
      continue
    }

    if (comp.status === 'BLOCKED') {
      const allDepsVerified =
        cleanDeps.length === 0 ||
        cleanDeps.every((depRef) => {
          const depComp = findComp(depRef)
          return depComp ? depComp.status === 'VERIFIED' : false
        })

      if (allDepsVerified) {
        comp.status = 'READY'
        trace(
          `[SDLCGraph] Componente ${compId} desbloqueado a estado READY (todas las dependencias Fin-Inicio satisfechas).`,
        )
      }
    }

    if (comp.status === 'READY' && !nextComponentId) {
      nextComponentId = comp.id
    }
  }

  // 2. Si hay un componente listo para abordar
  if (nextComponentId) {
    graph[nextComponentId].status = 'IN_DESIGN'
    trace(`[SDLCGraph] Scheduler despachando siguiente componente: ${nextComponentId} (IN_DESIGN).`)
    return {
      componentsGraph: graph,
      activeComponentId: nextComponentId,
      activeSkill: 'ComponentTechnical_Designer',
      currentPhase: '2_TECHNICAL_DESIGN_GATE',
    }
  }

  // 3. Si todos los componentes están en estado VERIFIED, avanzamos a Fase 4 (E2E)
  const allVerified = Object.values(graph).every((c) => c.status === 'VERIFIED')
  if (allVerified && Object.keys(graph).length > 0) {
    trace('[SDLCGraph] Todos los componentes han alcanzado estado VERIFIED. Avanzando a Fase 4 (E2E y Aprobación Formal de Negocio)...')
    return {
      componentsGraph: graph,
      activeComponentId: null,
      currentPhase: '4_E2E_BUSINESS_AUDIT',
      activeSkill: 'E2EAutomation_Runner',
    }
  }

  // 4. Bloqueo estricto del DAG: no se salta el DAG con rescate automático
  if (!nextComponentId && !allVerified && Object.keys(graph).length > 0) {
    trace(
      '[SDLCGraph] Scheduler: Grafo sin componentes elegibles para despachar. Se respeta la topología estricta del DAG sin rescate automático.',
      {
        statuses: Object.fromEntries(Object.entries(graph).map(([k, v]) => [k, v.status])),
        cycles: Array.from(cyclicNodes),
      },
    )
  }

  return {
    componentsGraph: graph,
    activeComponentId: null,
  }
}
