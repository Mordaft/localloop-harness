// Motor de ejecución y streaming LLM
export {
  streamLlmPhase,
  setRequireLiveLlm,
  getRequireLiveLlm,
  inferRoleIdForPhase,
  type SubagentComponentDeliverable,
} from './execution/llm-phase-streamer'
export { emitSDLCProgress } from './execution/progress-emitter'

// Generación de código y diseño técnico
export {
  generateComponentDesign,
  type ComponentDesignResult,
} from './codegen/component-design'
export {
  generateComponentCode,
  type GeneratedComponentArtifacts,
} from './codegen/component-codegen'

// Scaffolding universal agnóstico
export {
  buildUniversalScaffold,
  materializeUniversalScaffold,
  detectProjectArchetype,
  type ArchetypeClassification,
} from './scaffold/scaffold-engine'

// Planificador topológico Fin-Inicio
export { node_component_scheduler } from './scheduler/component-scheduler'

// Nodos del Grafo SDLC por Fase
export {
  node_phase0_assess,
  node_phase0_ask_discovery,
  node_phase0_process_discovery,
} from './nodes/phase0-discovery'

export {
  node_phase1_strategy_and_plan,
  node_phase1_confirm_framework,
} from './nodes/phase1-plan'

export {
  node_phase2_technical_design,
  node_phase2_gatekeeper,
} from './nodes/phase2-design'

export {
  node_phase3_implement_component,
  node_phase3_unit_tests,
} from './nodes/phase3-construction'

export {
  node_phase4_e2e_runner,
  node_phase4_business_compile,
  node_phase4_business_decision,
} from './nodes/phase4-e2e-audit'

export { node_phase5_resilience, deriveRcaFromEvidence } from './nodes/phase5-resilience'

export { node_phase6_doc_projection } from './documentation/doc-projector'
