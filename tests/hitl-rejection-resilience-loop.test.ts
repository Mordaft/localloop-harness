import { node_phase4_business_decision, node_phase4_business_compile } from '../src/agent/sdlc/nodes/phase4-e2e-audit'
import { node_phase5_resilience, deriveRcaFromEvidence, identifyTargetComponentForRemediation } from '../src/agent/sdlc/nodes/phase5-resilience'
import { node_phase3_implement_component, node_phase3_unit_tests } from '../src/agent/sdlc/nodes/phase3-construction'
import { node_component_scheduler } from '../src/agent/sdlc/scheduler/component-scheduler'
import type { SDLCStateType } from '../src/agent/sdlc-state'
import { clearVirtualFiles, writeWorkspaceFileDirect } from '../src/fs/workspace-fs'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function runHitlRejectionResilienceLoopTests(): Promise<void> {
  console.log('=== Iniciando pruebas del Bucle HITL -> Resiliencia -> Fase 3 (Desarrollo y Tests) ===\n')

  clearVirtualFiles()

  // -------------------------------------------------------------------------------------
  // [Test 1] Escenario Real del Usuario: Rechazo en HITL reportando fallo de build en fichero
  // -------------------------------------------------------------------------------------
  console.log('[Test 1] Verificando detección de TECH_DEFECT y selección de componente desde feedback...')
  
  const userFeedbackText =
    'cuando hago la validación de la aplicación generada , en esta caso realizando un "pnpm build" en la carpeta obtengo un error en el fichero src/components/counter.ts'

  const initialCompCode = `export class Counter { constructor() { this.broken = ; } }`
  await writeWorkspaceFileDirect('src/components/counter.ts', initialCompCode)

  const stateInPhase4: Partial<SDLCStateType> = {
    sessionId: 888,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    activeSkill: 'BusinessOutcome_Auditor',
    businessApproval: {
      approved: false,
      stakeholderComments: userFeedbackText,
      evaluatedAt: new Date().toISOString(),
    },
    useCases: [{ id: 'UC-1', title: 'Contador', expectedBusinessOutcome: 'Funciona' }],
    componentsGraph: {
      comp_core: {
        id: 'comp_core',
        name: 'Módulo Core',
        description: 'Tipos y lógica base',
        dependsOn: [],
        status: 'VERIFIED',
        targetPath: 'src/services/core.ts',
        files: [{ path: 'src/services/core.ts', content: 'export interface CounterState { count: number; }' }],
      },
      comp_counter: {
        id: 'comp_counter',
        name: 'Componente Contador',
        description: 'Renderiza el contador interactivo',
        dependsOn: ['comp_core'],
        status: 'VERIFIED',
        targetPath: 'src/components/counter.ts',
        files: [{ path: 'src/components/counter.ts', content: initialCompCode }],
      },
    },
    unitEvidences: {
      comp_core: { ejecutada: true, exito: true, modo: 'js_sandbox', logs: [], returnValue: '' },
      comp_counter: { ejecutada: true, exito: true, modo: 'js_sandbox', logs: [], returnValue: '' },
    },
    messages: [
      { role: 'user', content: userFeedbackText },
    ],
    progressEvents: [],
    technicalDebtList: [],
    projectPlan: { milestones: [], backlog: [] },
  }

  // 1. Probar que deriveRcaFromEvidence lo categoriza como TECH_DEFECT
  const rca = deriveRcaFromEvidence(stateInPhase4 as SDLCStateType)
  assert(
    rca.rootCauseCategory === 'TECH_DEFECT',
    `Debe categorizar como TECH_DEFECT ante mención de build/error en fichero (obtenido: ${rca.rootCauseCategory})`,
  )
  assert(
    rca.failureSummary.includes('Defecto') || rca.failureSummary.includes('build'),
    'failureSummary debe reflejar el defecto reportado',
  )

  // 2. Probar que identifyTargetComponentForRemediation localiza comp_counter por la ruta del archivo
  const targetId = identifyTargetComponentForRemediation(stateInPhase4 as SDLCStateType, userFeedbackText)
  assert(targetId === 'comp_counter', `Debe identificar comp_counter (obtenido: ${targetId})`)
  console.log('✓ Clasificación TECH_DEFECT e identificación de componente por ruta de archivo verificadas.')

  // -------------------------------------------------------------------------------------
  // [Test 2] Ejecución de Fase 5 Resiliencia: Creación de tarea de desarrollo y salto a Fase 3
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 2] Verificando que Fase 5 crea tarea en componentsGraph y salta a Fase 3...')

  const resilienceRes = await node_phase5_resilience(stateInPhase4 as SDLCStateType)

  // Verificar que el componente en componentsGraph NO queda en VERIFIED
  assert(
    resilienceRes.componentsGraph?.['comp_counter']?.status === 'READY',
    'comp_counter debe pasar a estado READY para su reconstrucción',
  )
  assert(
    resilienceRes.unitEvidences?.['comp_counter'] === undefined,
    'Las evidencias unitarias previas de comp_counter deben eliminarse para exigir revalidación',
  )
  assert(
    resilienceRes.businessApproval === null,
    'businessApproval debe resetearse a null para evitar auto-rechazo en la siguiente iteración',
  )
  assert(
    resilienceRes.currentPhase === '3_COMPONENT_CONSTRUCTION',
    'currentPhase debe ser 3_COMPONENT_CONSTRUCTION para saltar a Fase 3',
  )
  assert(
    resilienceRes.activeComponentId === 'comp_counter',
    'activeComponentId debe ser comp_counter',
  )
  assert(
    resilienceRes.activeSkill === 'Component_Implementer',
    'activeSkill debe ser Component_Implementer',
  )
  console.log('✓ Tarea de desarrollo programada en componentsGraph y salto a Fase 3 configurado.')

  // -------------------------------------------------------------------------------------
  // [Test 3] Ejecución de Fase 3 (Desarrollo y Prueba Unitaria) con los datos del RCA
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 3] Verificando ejecución de Fase 3 (Desarrollo y Pruebas) tras la remediación...')

  const stateInPhase3: SDLCStateType = {
    ...(stateInPhase4 as SDLCStateType),
    ...resilienceRes,
    currentPhase: '3_COMPONENT_CONSTRUCTION',
    activeComponentId: 'comp_counter',
  }

  // Al construir en Fase 3:
  const buildRes = await node_phase3_implement_component(stateInPhase3)
  assert(
    buildRes.componentsGraph?.['comp_counter']?.status === 'IN_BUILD' ||
    buildRes.componentsGraph?.['comp_counter']?.status === 'READY',
    'El componente debe estar en construcción',
  )
  assert(
    buildRes.currentPhase === '3_COMPONENT_CONSTRUCTION',
    'Permanece en Fase 3 para ejecutar pruebas unitarias',
  )

  // Actualizar código en el grafo y simular prueba unitaria exitosa tras corrección
  const fixedCode = `export class Counter {\n  public count = 0;\n  constructor() { this.count = 0; }\n  public mount(el: any) { el.innerHTML = '<div>OK</div>'; }\n}`
  await writeWorkspaceFileDirect('src/components/counter.ts', fixedCode)
  const stateReadyForUnit: SDLCStateType = {
    ...stateInPhase3,
    componentsGraph: {
      ...stateInPhase3.componentsGraph,
      comp_counter: {
        ...stateInPhase3.componentsGraph['comp_counter'],
        files: [{ path: 'src/components/counter.ts', content: fixedCode }],
        targetPath: 'src/components/counter.ts',
      },
    },
  }

  const unitRes = await node_phase3_unit_tests(stateReadyForUnit)
  if (!unitRes.unitEvidences?.['comp_counter']?.exito) {
    console.error('DEBUG UNIT EVIDENCE:', unitRes.unitEvidences?.['comp_counter'])
  }
  assert(
    unitRes.componentsGraph?.['comp_counter']?.status === 'VERIFIED',
    'comp_counter debe pasar a VERIFIED tras superar pruebas unitarias',
  )
  assert(
    unitRes.unitEvidences?.['comp_counter']?.exito === true,
    'La evidencia unitaria debe ser exito: true',
  )
  console.log('✓ Fase 3 completada con éxito: código reparado y prueba unitaria aprobada.')

  // -------------------------------------------------------------------------------------
  // [Test 4] Scheduler: Avanza a Fase 4 solo tras tener todos los componentes en VERIFIED
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 4] Verificando que el Scheduler avanza a Fase 4 y no hay bucle infinito...')

  const stateForScheduler: SDLCStateType = {
    ...stateReadyForUnit,
    componentsGraph: unitRes.componentsGraph!,
    unitEvidences: unitRes.unitEvidences!,
  }

  const schedRes = await node_component_scheduler(stateForScheduler)
  assert(
    schedRes.currentPhase === '4_E2E_BUSINESS_AUDIT',
    'El scheduler debe avanzar a Fase 4 al estar todos los componentes en VERIFIED',
  )

  // -------------------------------------------------------------------------------------
  // [Test 5] Verificando que Fase 4 compila y espera una nueva decisión (no auto-rechaza)
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 5] Verificando que Fase 4 espera nueva decisión HITL con businessApproval: null...')

  const stateEnteringPhase4: SDLCStateType = {
    ...stateForScheduler,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    businessApproval: null, // Como fue limpiado por Resiliencia
    messages: [
      { role: 'assistant', content: '### ⚖️ Fase 4: Solicitud de Aprobación Formal de Negocio (HITL)' },
    ],
  }

  // Comprobar node_phase4_business_decision cuando businessApproval es null
  const decisionRes = await node_phase4_business_decision(stateEnteringPhase4)
  assert(
    decisionRes.currentPhase === '4_E2E_BUSINESS_AUDIT',
    'Debe permanecer en Fase 4 esperando decisión explícita (no auto-rechazar)',
  )
  assert(
    decisionRes.businessApproval === null,
    'businessApproval debe mantenerse pendiente (null)',
  )
  console.log('✓ Fase 4 no auto-rechaza ni entra en bucle: espera decisión explícita del usuario.')

  console.log('\n=== ¡Todas las pruebas del Bucle HITL -> Resiliencia -> Fase 3 pasaron exitosamente! ===')
}

void runHitlRejectionResilienceLoopTests().catch((err) => {
  console.error('Error en pruebas de HITL y Resiliencia:', err)
  process.exit(1)
})
