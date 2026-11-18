import { trace } from '../../../diagnostics'
import type { ComponentNode, SDLCStateType } from '../../sdlc-state'

/**
 * NODO DESPACHADOR DE COMPONENTES (Scheduler Fin-Inicio)
 * Evalúa las dependencias Fin-Inicio y despacha el siguiente componente elegible.
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

  let nextComponentId: string | null = null

  // 1. Desbloquear componentes cuyas dependencias estén todas en VERIFIED
  for (const compId of Object.keys(graph)) {
    const comp = graph[compId]
    if (comp.status === 'BLOCKED') {
      const validDeps = comp.dependsOn
        .map((d) => d.trim().replace(/^[`'"]+|[`'"]+$/g, ''))
        .filter(Boolean)

      const allDepsVerified =
        validDeps.length === 0 ||
        validDeps.every((depRef) => {
          const depComp = findComp(depRef)
          return depComp ? depComp.status === 'VERIFIED' : true
        })

      if (allDepsVerified) {
        comp.status = 'READY'
        trace(`[SDLCGraph] Componente ${compId} desbloqueado a estado READY (todas las dependencias Fin-Inicio satisfechas).`)
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

  // 4. Mecanismo de rescate: si no hay componente READY pero quedan componentes no verificados (posible bloqueo por ID no encontrado)
  if (!nextComponentId && !allVerified && Object.keys(graph).length > 0) {
    trace('[SDLCGraph] Advertencia: Posible estancamiento en dependencias. Desbloqueando componente restante para continuar...', {
      statuses: Object.fromEntries(Object.entries(graph).map(([k, v]) => [k, v.status])),
    })
    const unverifiedComp = Object.values(graph).find((c) => c.status !== 'VERIFIED')
    if (unverifiedComp) {
      unverifiedComp.status = 'IN_DESIGN'
      return {
        componentsGraph: graph,
        activeComponentId: unverifiedComp.id,
        activeSkill: 'ComponentTechnical_Designer',
        currentPhase: '2_TECHNICAL_DESIGN_GATE',
      }
    }
  }

  return {
    componentsGraph: graph,
  }
}
