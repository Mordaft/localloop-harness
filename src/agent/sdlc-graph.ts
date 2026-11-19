import { END, START, StateGraph } from '@langchain/langgraph'
import { getSharedIndexedDBSaver } from '../memory/indexeddb-saver'
import { SDLCState } from './sdlc-state'
import {
  node_phase0_assess,
  node_phase0_ask_discovery,
  node_phase0_process_discovery,
  node_phase1_strategy_and_plan,
  node_phase1_confirm_framework,
  node_component_scheduler,
  node_phase2_technical_design,
  node_phase2_gatekeeper,
  node_phase3_implement_component,
  node_phase3_unit_tests,
  node_phase4_e2e_runner,
  node_phase4_business_compile,
  node_phase4_business_decision,
  node_phase5_resilience,
  node_phase6_doc_projection,
} from './sdlc'

/**
 * CONSTRUCCIÓN DEL GRAFO DE ESTADOS SDLC (LANGGRAPH)
 * Orquesta el ciclo de vida completo de ingeniería de software (Fases 0 a 6)
 * con dependencias Fin-Inicio en componentes y 3 puntos de interrupción HITL.
 */
const workflow = new StateGraph(SDLCState)
  // Nodos Fase 0: Descubrimiento & Rigor Arquitectónico
  .addNode('phase0_assess', node_phase0_assess)
  .addNode('phase0_ask_discovery', node_phase0_ask_discovery)
  .addNode('phase0_process_discovery', node_phase0_process_discovery)

  // Nodos Fase 1: Planificación WBS, DAG y Framework
  .addNode('phase1_strategy_and_plan', node_phase1_strategy_and_plan)
  .addNode('phase1_confirm_framework', node_phase1_confirm_framework)

  // Despachador de Componentes (Fin-Inicio)
  .addNode('component_scheduler', node_component_scheduler)

  // Nodos Fase 2 & 3: Diseño y Construcción por Componente
  .addNode('phase2_technical_design', node_phase2_technical_design)
  .addNode('phase2_gatekeeper', node_phase2_gatekeeper)
  .addNode('phase3_implement_component', node_phase3_implement_component)
  .addNode('phase3_unit_tests', node_phase3_unit_tests)

  // Nodos Fase 4: Integración E2E y Auditoría de Negocio
  .addNode('phase4_e2e_runner', node_phase4_e2e_runner)
  .addNode('phase4_business_compile', node_phase4_business_compile)
  .addNode('phase4_business_decision', node_phase4_business_decision)

  // Nodo Fase 5: Resiliencia y RCA
  .addNode('phase5_resilience', node_phase5_resilience)

  // Nodo Fase 6: Proyección Documental y Cierre
  .addNode('phase6_doc_projection', node_phase6_doc_projection)

  // BORDES Y RUTAS CONDICIONALES
  .addEdge(START, 'phase0_assess')

  // Bifurcación Fase 0
  .addConditionalEdges('phase0_assess', (state) => {
    return state.discoveryInputValid ? 'phase1_strategy_and_plan' : 'phase0_ask_discovery'
  })

  .addEdge('phase0_ask_discovery', 'phase0_process_discovery')
  .addEdge('phase0_process_discovery', 'phase1_strategy_and_plan')
  .addConditionalEdges('phase1_strategy_and_plan', (state) => {
    return state.phase1FrameworkAgreed ? 'component_scheduler' : 'phase1_confirm_framework'
  })
  .addEdge('phase1_confirm_framework', 'component_scheduler')

  // Enrutamiento del Scheduler de Componentes
  .addConditionalEdges('component_scheduler', (state) => {
    if (state.currentPhase === '4_E2E_BUSINESS_AUDIT') {
      return 'phase4_e2e_runner'
    }
    if (state.activeComponentId) {
      return 'phase2_technical_design'
    }
    return END
  })

  // Ciclo Fase 2 y 3 por componente
  .addEdge('phase2_technical_design', 'phase2_gatekeeper')
  .addEdge('phase2_gatekeeper', 'phase3_implement_component')
  .addEdge('phase3_implement_component', 'phase3_unit_tests')
  // Tras las pruebas unitarias, el flujo vuelve al scheduler para evaluar el siguiente componente listo
  .addEdge('phase3_unit_tests', 'component_scheduler')

  // Flujo Fase 4 (E2E & HITL)
  .addEdge('phase4_e2e_runner', 'phase4_business_compile')
  .addEdge('phase4_business_compile', 'phase4_business_decision')

  // Bifurcación Decisión Formal de Negocio (HITL)
  .addConditionalEdges('phase4_business_decision', (state) => {
    if (state.currentPhase === '4_E2E_BUSINESS_AUDIT') {
      return 'phase4_business_decision'
    }
    return state.currentPhase === '5_STRATEGIC_RESILIENCE' ? 'phase5_resilience' : 'phase6_doc_projection'
  })

  // Enrutamiento tras el bucle de resiliencia (salto directo a Fase 3 para desarrollo y pruebas unitarias de remediación)
  .addConditionalEdges('phase5_resilience', (state) => {
    if (state.currentPhase === '3_COMPONENT_CONSTRUCTION' && state.activeComponentId) {
      return 'phase3_implement_component'
    }
    return 'phase1_strategy_and_plan'
  })

  // Cierre
  .addEdge('phase6_doc_projection', END)

/**
 * Grafo compilado con los 3 puntos de interrupción Human-in-the-Loop (HITL):
 * 1. Antes de procesar las respuestas de descubrimiento en Fase 0 (espera respuesta del usuario & MCP).
 * 2. Antes de confirmar el marco de referencia en Fase 1 (espera feedback del usuario sobre framework y estructura).
 * 3. Antes de evaluar la decisión de negocio tras la compilación de evidencias E2E en Fase 4.
 */
export const compiledSDLCGraph = workflow.compile({
  checkpointer: getSharedIndexedDBSaver(),
  interruptBefore: ['phase0_process_discovery', 'phase1_confirm_framework', 'phase4_business_decision'],
})

// Re-exportaciones de compatibilidad pública
export {
  streamLlmPhase,
  setRequireLiveLlm,
  getRequireLiveLlm,
  type SubagentComponentDeliverable,
  resolveFrameworkStack,
  type FrameworkStackResolution,
  generateComponentCode,
  type GeneratedComponentArtifacts,
} from './sdlc'
