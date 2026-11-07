import { Annotation } from '@langchain/langgraph'
import type { ChatMessage, ParsedToolCall } from '../llm/llm-client'
import type { AtomicTestEvidence } from '../memory/engram-memory'

export type SdlcPhase =
  | '0_DISCOVERY_RIGOR'
  | '1_STRATEGY_AND_PLAN'
  | '2_TECHNICAL_DESIGN_GATE'
  | '3_COMPONENT_CONSTRUCTION'
  | '4_E2E_BUSINESS_AUDIT'
  | '5_STRATEGIC_RESILIENCE'
  | '6_DOCUMENTATION_PROJECTION'
  | 'COMPLETED'

export interface BusinessUseCase {
  id: string
  title: string
  actor: string
  happyPath: string[]
  exceptions: string[]
  expectedBusinessOutcome: string
  acceptanceCriteriaGherkin: string
}

// -------------------------------------------------------------------------------------
// ESPECIFICACIÓN DETALLADA EN 3 PASOS PARA LA FASE 0
// -------------------------------------------------------------------------------------

// Paso 1: Necesidades de Negocio
export interface BusinessNeedItem {
  id: string
  description: string
  expectedImpact: string
}

export interface Phase0Step1BusinessNeeds {
  rawBusinessLanguageText: string
  needsList: BusinessNeedItem[]
}

// Paso 2: Arquitectura Empresarial (Plantilla de Caso de Negocio)
export interface ArchitectureSituation {
  title: string
  description: string
  limitationsOrCapabilities: string[]
}

export interface Phase0Step2EnterpriseArch {
  marketStandard: string
  mcpUrl?: string
  currentSituation: ArchitectureSituation // As-Is (Soluciones actuales y limitaciones que imponen al negocio)
  desiredSituation: ArchitectureSituation // To-Be (Soluciones futuras y capacidades objetivo)
  transitionSituation?: ArchitectureSituation // Transición (Estadio intermedio de transición si aplica)
}

// Paso 3: Arquitectura de Soluciones & Componentes a Definir / Evolucionar
export interface SolutionComponentMapping {
  componentId: string
  name: string
  action: 'CREATE' | 'EVOLVE'
  targetState: 'DESIRED' | 'TRANSITION'
  description: string
  dependsOn: string[] // Dependencias Fin-Inicio
}

export interface Phase0Step3SolutionArch {
  featureComponentMappings: SolutionComponentMapping[]
}

export interface Phase0ThreeStepData {
  step1: Phase0Step1BusinessNeeds
  step2: Phase0Step2EnterpriseArch
  step3: Phase0Step3SolutionArch
}

export interface ComponentNode {
  id: string
  name: string
  description: string
  targetPath?: string
  targetState?: 'DESIRED' | 'TRANSITION'
  /** IDs de componentes que deben estar en estado VERIFIED antes de poder iniciar este componente (Fin-Inicio) */
  dependsOn: string[]
  status:
    | 'BLOCKED'
    | 'READY'
    | 'IN_DESIGN'
    | 'DESIGN_APPROVED'
    | 'IN_BUILD'
    | 'UNIT_TESTING'
    | 'VERIFIED'
}

export interface TechnicalDesignProposal {
  componentId: string
  approachName: string
  isChosen: boolean
  description: string
  contracts: Array<{ name: string; schema: string }>
  dependencies: string[]
  tradeOffAnalysis?: string
}

export interface TechnicalDebtRecord {
  id: string
  componentId: string
  title: string
  description: string
  riskLevel: 'BAJO' | 'MEDIO' | 'ALTO'
  mitigationPlan: string
  syncedToMcp: boolean
  createdAt: string
}

export interface GatekeeperDecision {
  componentId: string
  status: 'APPROVED' | 'REJECTED_NEEDS_REDESIGN' | 'APPROVED_WITH_DEBT'
  chosenApproachName: string
  feedback: string
  debtRecord?: TechnicalDebtRecord
}

export interface FormalBusinessApproval {
  approved: boolean
  stakeholderComments?: string
  evaluatedAt: string
}

export interface ProjectProgressEvent {
  id: string
  timestamp: string
  type: 'UNIT_TEST_PASS' | 'E2E_AUDIT_PASS' | 'BACKLOG_UPDATED' | 'DEBT_RECORDED' | 'COMPONENT_VERIFIED'
  componentId?: string
  evidenceSummary: string
}

export interface RcaDiagnosis {
  failureSummary: string
  rootCauseCategory: 'BUSINESS_ASSUMPTION' | 'ARCH_LIMITATION' | 'TECH_DEFECT'
  detail: string
  remedyRecommendation: string
  newBacklogItem?: {
    id: string
    title: string
    spec: string
    priority: number
    acceptanceCriteria: string
  }
}

export const SDLCState = Annotation.Root({
  sessionId: Annotation<number>,
  threadId: Annotation<string>,

  currentPhase: Annotation<SdlcPhase>({
    reducer: (_, next) => next,
    default: () => '0_DISCOVERY_RIGOR',
  }),

  activeSkill: Annotation<string>({
    reducer: (_, next) => next,
    default: () => 'ProjectRigor_Interviewer',
  }),

  // FASE 0: Descubrimiento & Calibración de Rigor
  discoveryInputValid: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  discoveryCompleted: Annotation<boolean>({
    reducer: (_, next) => next,
    default: () => false,
  }),
  useCases: Annotation<BusinessUseCase[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  marketArchStandard: Annotation<string>({
    reducer: (_, next) => next,
    default: () => 'C4_AND_CLEAN_ARCHITECTURE',
  }),
  mcpServerConfig: Annotation<{ url?: string; connected: boolean }>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({ connected: false }),
  }),
  phase0Data: Annotation<Phase0ThreeStepData | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  // FASE 1: Estrategia, Fundamentos y Planificación Fin-Inicio
  componentsGraph: Annotation<Record<string, ComponentNode>>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),
  projectPlan: Annotation<{
    milestones: Array<{ id: string; target: string; completed: boolean }>
    backlog: Array<{ id: string; title: string; priority: number; status: string }>
  }>({
    reducer: (curr, next) => next ?? curr,
    default: () => ({ milestones: [], backlog: [] }),
  }),

  // FASE 2 & 3: Componentes en Curso y Control
  activeComponentId: Annotation<string | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  technicalDesigns: Annotation<Record<string, TechnicalDesignProposal[]>>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),
  gatekeeperDecisions: Annotation<Record<string, GatekeeperDecision>>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),
  technicalDebtList: Annotation<TechnicalDebtRecord[]>({
    reducer: (curr, next) => (next ? [...curr, ...next] : curr),
    default: () => [],
  }),
  unitEvidences: Annotation<Record<string, AtomicTestEvidence>>({
    reducer: (curr, next) => ({ ...curr, ...next }),
    default: () => ({}),
  }),

  // FASE 4: E2E y Aprobación Formal de Negocio (HITL)
  e2eEvidences: Annotation<any>({
    reducer: (_, next) => next,
    default: () => null,
  }),
  businessApproval: Annotation<FormalBusinessApproval | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // FASE 5: Resiliencia Estratégica (RCA -> Re-especificación -> Backlog)
  rcaDiagnosis: Annotation<RcaDiagnosis | null>({
    reducer: (_, next) => next,
    default: () => null,
  }),

  // FASE 6 / Proyección Desacoplada hacia entregables humanos
  progressEvents: Annotation<ProjectProgressEvent[]>({
    reducer: (curr, next) => (next ? [...curr, ...next] : curr),
    default: () => [],
  }),

  // Mensajería, turnos y herramientas del agente de LangGraph
  messages: Annotation<ChatMessage[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  pendingToolCalls: Annotation<ParsedToolCall[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  turnsUsed: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  maxTurns: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 20,
  }),
})

export type SDLCStateType = typeof SDLCState.State
