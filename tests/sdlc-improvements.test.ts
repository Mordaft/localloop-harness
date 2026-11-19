import assert from 'node:assert/strict'
import {
  node_component_scheduler,
  node_phase3_unit_tests,
  node_phase4_e2e_runner,
  node_phase4_business_decision,
  node_phase5_resilience,
  deriveRcaFromEvidence,
  node_phase6_doc_projection,
} from '../src/agent/sdlc'
import { compiledSDLCGraph } from '../src/agent/sdlc-graph'
import type { ComponentNode, SDLCStateType } from '../src/agent/sdlc-state'
import { getVirtualFile, clearVirtualFiles } from '../src/fs/workspace-fs'

async function runSDLCImprovementsTests() {
  console.log('=== Iniciando pruebas de Mejoras en el Flujo SDLC ===\n')

  // -------------------------------------------------------------------------------------
  // 1. SCHEDULER: Bloquear dependencias desconocidas y ciclos, sin rescate automático
  // -------------------------------------------------------------------------------------
  console.log('[Test 1] Scheduler: Bloqueo de dependencias desconocidas...')
  const stateWithUnknownDep: Partial<SDLCStateType> = {
    componentsGraph: {
      comp_a: {
        id: 'comp_a',
        name: 'Componente A',
        description: 'Depende de algo que no existe',
        dependsOn: ['comp_inexistente_999'],
        status: 'BLOCKED',
      },
    },
    activeComponentId: null,
  }

  const schedRes1 = await node_component_scheduler(stateWithUnknownDep as SDLCStateType)
  assert.strictEqual(
    schedRes1.componentsGraph?.['comp_a']?.status,
    'BLOCKED',
    'Componente con dependencia desconocida debe permanecer BLOQUEADO',
  )
  assert.strictEqual(
    schedRes1.activeComponentId,
    null,
    'No debe despachar componente con dependencia desconocida ni rescatar automáticamente',
  )
  console.log('✓ Dependencias desconocidas permanecen BLOQUEADAS sin despachar.')

  console.log('[Test 1.1] Scheduler: Detección y bloqueo de ciclos sin rescate automático...')
  const stateWithCycle: Partial<SDLCStateType> = {
    componentsGraph: {
      comp_c1: {
        id: 'comp_c1',
        name: 'Componente Ciclo 1',
        description: 'Depende de C2',
        dependsOn: ['comp_c2'],
        status: 'BLOCKED',
      },
      comp_c2: {
        id: 'comp_c2',
        name: 'Componente Ciclo 2',
        description: 'Depende de C1',
        dependsOn: ['comp_c1'],
        status: 'BLOCKED',
      },
    },
    activeComponentId: null,
  }

  const schedRes2 = await node_component_scheduler(stateWithCycle as SDLCStateType)
  assert.strictEqual(
    schedRes2.componentsGraph?.['comp_c1']?.status,
    'BLOCKED',
    'Componente en ciclo C1 debe permanecer BLOQUEADO',
  )
  assert.strictEqual(
    schedRes2.componentsGraph?.['comp_c2']?.status,
    'BLOCKED',
    'Componente en ciclo C2 debe permanecer BLOQUEADO',
  )
  assert.strictEqual(
    schedRes2.activeComponentId,
    null,
    'No debe despachar ningún componente involucrado en ciclos (sin rescate)',
  )
  console.log('✓ Ciclos de dependencias bloqueados estrictamente sin rescate automático.')

  // -------------------------------------------------------------------------------------
  // 2. CONSTRUCCIÓN Y PRUEBAS: VERIFIED solo si pasó la ejecución real; si falla, FAILED
  //    y no desbloquea dependientes
  // -------------------------------------------------------------------------------------
  console.log('[Test 2] Construcción y Pruebas: Manejo estricto de fallo y no desbloqueo de dependientes...')
  const stateFailingComp: Partial<SDLCStateType> = {
    sessionId: 991,
    activeComponentId: 'comp_failing',
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    componentsGraph: {
      comp_failing: {
        id: 'comp_failing',
        name: 'Módulo con Error de Transpilación/Ejecución',
        description: 'Componente defectuoso',
        dependsOn: [],
        status: 'IN_BUILD',
        files: [
          {
            path: 'src/components/comp_failing.ts',
            content: `export class FailingService { constructor() { throw new Error('Assertion Error: Fatal Crash'); } }`,
            description: 'Servicio con fallo',
          },
        ],
      },
      comp_dependent: {
        id: 'comp_dependent',
        name: 'Módulo Dependiente',
        description: 'Depende del componente con error',
        dependsOn: ['comp_failing'],
        status: 'BLOCKED',
      },
    },
    progressEvents: [],
    unitEvidences: {},
    messages: [],
  }

  const unitTestRes = await node_phase3_unit_tests(stateFailingComp as SDLCStateType)
  assert.strictEqual(
    unitTestRes.componentsGraph?.['comp_failing']?.status,
    'FAILED',
    'El componente con ejecución fallida debe pasar a estado FAILED, no VERIFIED',
  )
  assert.strictEqual(
    unitTestRes.unitEvidences?.['comp_failing']?.exito,
    false,
    'La evidencia unitaria debe conservarse como exito: false',
  )
  const failEvent = unitTestRes.progressEvents?.find((e) => e.componentId === 'comp_failing')
  assert.strictEqual(
    failEvent?.type,
    'UNIT_TEST_FAIL',
    'El evento de progreso debe ser UNIT_TEST_FAIL cuando la ejecución real falla',
  )

  // Pasar por el scheduler para confirmar que comp_dependent NO se desbloquea
  const schedAfterFail = await node_component_scheduler({
    ...stateFailingComp,
    componentsGraph: unitTestRes.componentsGraph,
  } as SDLCStateType)

  assert.strictEqual(
    schedAfterFail.componentsGraph?.['comp_dependent']?.status,
    'BLOCKED',
    'El componente dependiente debe permanecer BLOQUEADO al fallar su dependencia',
  )
  assert.strictEqual(
    schedAfterFail.activeComponentId,
    null,
    'No se debe despachar el dependiente tras el fallo',
  )
  console.log('✓ Fallo en ejecución real conservado como FAILED y dependientes bloqueados.')

  // -------------------------------------------------------------------------------------
  // 3. E2E: Exigir comprobaciones observables y registrar simulación si no hay observables
  // -------------------------------------------------------------------------------------
  console.log('[Test 3] E2E: Detección y registro explícito de Simulación cuando no hay comprobación observable...')
  const stateE2eSim: Partial<SDLCStateType> = {
    sessionId: 992,
    componentsGraph: {
      comp_backend: {
        id: 'comp_backend',
        name: 'Servicio Backend',
        description: 'Servicio puro sin UI',
        dependsOn: [],
        status: 'VERIFIED',
      },
    },
    useCases: [
      {
        id: 'UC-101',
        title: 'Procesamiento de Pago Asíncrono',
        actor: 'Cliente',
        happyPath: ['Envía orden', 'Procesa pago', 'Confirma'],
        exceptions: [],
        expectedBusinessOutcome: 'Transacción completada',
        acceptanceCriteriaGherkin: 'Given orden válida When paga Then confirmación emitida',
      },
    ],
    unitEvidences: {
      comp_backend: {
        ejecutada: true,
        exito: true,
        modo: 'js_sandbox',
        logs: ['OK'],
        returnValue: '',
      },
    },
    progressEvents: [],
    messages: [],
  }

  const e2eRes = await node_phase4_e2e_runner(stateE2eSim as SDLCStateType)
  assert.strictEqual(
    e2eRes.e2eEvidences?.isSimulation,
    true,
    'Debe registrar isSimulation: true cuando no hay comprobación observable directa en DOM/runtime',
  )
  assert.ok(
    e2eRes.e2eEvidences?.simulationReason?.length > 0,
    'Debe especificar el motivo de la simulación',
  )
  const simEvent = e2eRes.progressEvents?.find((e) => e.type === 'E2E_SIMULATION')
  assert.ok(simEvent, 'Debe emitir evento de progreso tipo E2E_SIMULATION')
  assert.ok(
    e2eRes.messages?.[0]?.content.includes('SIMULACIÓN REGISTRADA'),
    'El informe E2E debe registrar explícitamente simulación y no integración superada',
  )
  console.log('✓ E2E en modo simulación registrado explícitamente como SIMULACIÓN.')

  // -------------------------------------------------------------------------------------
  // 4. HITL: Requerir decisión explícita y mantener aprobación pendiente ante ambigüedad
  // -------------------------------------------------------------------------------------
  console.log('[Test 4] HITL: Respuestas ambiguas mantienen aprobación PENDIENTE...')
  const stateAmbiguousHitl: Partial<SDLCStateType> = {
    sessionId: 993,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    businessApproval: null,
    messages: [
      { role: 'user', content: '¿Cuánto tiempo tarda esto? Oye, revísalo cuando puedas.' },
    ],
    progressEvents: [],
  }

  const hitlDecisionAmbiguous = await node_phase4_business_decision(stateAmbiguousHitl as SDLCStateType)
  assert.strictEqual(
    hitlDecisionAmbiguous.currentPhase,
    '4_E2E_BUSINESS_AUDIT',
    'Ante respuesta ambigua, debe permanecer en 4_E2E_BUSINESS_AUDIT',
  )
  assert.strictEqual(
    hitlDecisionAmbiguous.businessApproval,
    null,
    'businessApproval debe permanecer en null (pendiente)',
  )
  const lastMsg = hitlDecisionAmbiguous.messages?.[hitlDecisionAmbiguous.messages.length - 1]
  assert.ok(
    lastMsg?.content.includes('Decisión de Negocio Pendiente') || lastMsg?.content.includes('PENDIENTE'),
    'Debe emitir advertencia exigiendo una decisión explícita',
  )
  console.log('✓ Respuesta ambigua mantiene aprobación formal PENDIENTE.')

  console.log('[Test 4.1] HITL: Decisión explícita de rechazo deriva a Fase 5 (Resiliencia)...')
  const stateRejectHitl: Partial<SDLCStateType> = {
    sessionId: 994,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    businessApproval: null,
    messages: [
      { role: 'user', content: 'Rechazado formalmente: el cálculo de comisiones es incorrecto y falla con decimales.' },
    ],
    progressEvents: [],
  }
  const hitlDecisionReject = await node_phase4_business_decision(stateRejectHitl as SDLCStateType)
  assert.strictEqual(
    hitlDecisionReject.currentPhase,
    '5_STRATEGIC_RESILIENCE',
    'El rechazo explícito debe derivar a Fase 5 (Resiliencia)',
  )
  assert.strictEqual(
    hitlDecisionReject.businessApproval?.approved,
    false,
    'businessApproval debe registrar approved: false',
  )
  console.log('✓ Rechazo explícito activa Fase 5 de Resiliencia.')

  console.log('[Test 4.2] HITL: Decisión explícita de aprobación deriva a Fase 6 (Documentación)...')
  const stateApproveHitl: Partial<SDLCStateType> = {
    sessionId: 995,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    businessApproval: null,
    messages: [
      { role: 'user', content: 'Aprobado formalmente y conforme con las evidencias presentadas.' },
    ],
    progressEvents: [],
  }
  const hitlDecisionApprove = await node_phase4_business_decision(stateApproveHitl as SDLCStateType)
  assert.strictEqual(
    hitlDecisionApprove.currentPhase,
    '6_DOCUMENTATION_PROJECTION',
    'La aprobación explícita debe derivar a Fase 6 (Documentación)',
  )
  assert.strictEqual(
    hitlDecisionApprove.businessApproval?.approved,
    true,
    'businessApproval debe registrar approved: true',
  )
  console.log('✓ Aprobación explícita avanza a Fase 6.')

  // -------------------------------------------------------------------------------------
  // 5. RCA Y DOCUMENTACIÓN: Derivados de evidencias existentes, sin prefijados
  // -------------------------------------------------------------------------------------
  console.log('[Test 5] RCA: Derivación dinámica basada en evidencias existentes...')
  const stateForRca: Partial<SDLCStateType> = {
    sessionId: 996,
    componentsGraph: {
      comp_billing: {
        id: 'comp_billing',
        name: 'Módulo de Facturación',
        description: 'Cálculo de facturas',
        dependsOn: [],
        status: 'FAILED',
      },
    },
    unitEvidences: {
      comp_billing: {
        ejecutada: true,
        exito: false,
        modo: 'js_sandbox',
        logs: ['AssertionError: expected 121.00 to equal 120.00'],
        returnValue: '',
        error: 'AssertionError: Decimal rounding mismatch in tax calculation',
      },
    },
    businessApproval: {
      approved: false,
      stakeholderComments: 'Rechazo: el redondeo de impuestos difiere por un céntimo.',
      evaluatedAt: new Date().toISOString(),
    },
    technicalDebtList: [],
    messages: [],
    progressEvents: [],
    projectPlan: { milestones: [], backlog: [] },
  }

  const derivedRca = deriveRcaFromEvidence(stateForRca as SDLCStateType)
  assert.strictEqual(
    derivedRca.rootCauseCategory,
    'TECH_DEFECT',
    'Debe categorizar como TECH_DEFECT por el fallo en pruebas unitarias',
  )
  assert.ok(
    derivedRca.failureSummary.includes('comp_billing') || derivedRca.failureSummary.includes('Decimal rounding'),
    'failureSummary debe derivarse del componente fallido y el error real',
  )
  assert.ok(
    derivedRca.detail.includes('redondeo') || derivedRca.detail.includes('AssertionError'),
    'detail debe incluir el comentario real del stakeholder o los logs de error',
  )
  assert.ok(
    derivedRca.newBacklogItem?.title.includes('comp_billing') || derivedRca.newBacklogItem?.title.includes('Módulo de Facturación'),
    'El nuevo ítem de backlog debe apuntar al módulo real afectado',
  )

  const rcaNodeRes = await node_phase5_resilience(stateForRca as SDLCStateType)
  assert.strictEqual(rcaNodeRes.rcaDiagnosis?.rootCauseCategory, 'TECH_DEFECT')
  assert.strictEqual(
    rcaNodeRes.currentPhase,
    '3_COMPONENT_CONSTRUCTION',
    'La resiliencia ante un defecto técnico debe saltar a Fase 3 (Construcción & Tests)',
  )
  assert.strictEqual(
    rcaNodeRes.activeComponentId,
    'comp_billing',
    'El componente afectado debe programarse como activeComponentId para desarrollo y pruebas',
  )
  assert.strictEqual(
    rcaNodeRes.componentsGraph?.['comp_billing']?.status,
    'READY',
    'El componente afectado debe cambiar a estado READY para su reconstrucción',
  )
  assert.strictEqual(
    rcaNodeRes.businessApproval,
    null,
    'La aprobación de negocio debe resetearse a null para evitar bucles de rechazo automático',
  )
  console.log('✓ Diagnóstico RCA derivado de evidencias reales (errores y comentarios de stakeholder).')

  console.log('[Test 5.1] Documentación: Proyección documental derivada de evidencias reales...')
  clearVirtualFiles()
  const stateForDoc: Partial<SDLCStateType> = {
    sessionId: 997,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    componentsGraph: {
      comp_billing: {
        id: 'comp_billing',
        name: 'Módulo de Facturación',
        description: 'Cálculo de facturas',
        dependsOn: [],
        status: 'VERIFIED',
      },
    },
    unitEvidences: {
      comp_billing: {
        ejecutada: true,
        exito: true,
        modo: 'js_sandbox',
        logs: ['Contrato IFactura validado OK', 'Aserciones de impuestos superadas OK'],
        returnValue: '',
      },
    },
    useCases: [
      {
        id: 'UC-1',
        title: 'Facturación Automatizada',
        actor: 'Contabilidad',
        happyPath: ['Genera recibo'],
        exceptions: [],
        expectedBusinessOutcome: 'Recibo emitido',
        acceptanceCriteriaGherkin: 'Given orden When emite Then recibo creado',
      },
    ],
    e2eEvidences: {
      executedUseCases: ['UC-1'],
      allAssertionsPassed: true,
      isSimulation: true,
      simulationReason: 'Simulación sintética en Sandbox JS',
      traceLog: ['Simulación E2E ejecutada OK'],
    },
    businessApproval: {
      approved: true,
      stakeholderComments: 'Validado conforme por Dirección Financiera.',
      evaluatedAt: new Date().toISOString(),
    },
    technicalDebtList: [],
    progressEvents: [],
    messages: [],
  }

  await node_phase6_doc_projection(stateForDoc as SDLCStateType)

  const e2eDoc = getVirtualFile('doc/fase-4-e2e-auditoria-negocio/01_EVIDENCIAS_PRUEBAS_E2E.md')
  assert.ok(e2eDoc, 'Documento E2E debe haberse generado')
  assert.ok(
    e2eDoc.includes('Simulación E2E Registrada'),
    'El documento E2E debe registrar la simulación derivada de e2eEvidences.isSimulation',
  )

  const businessDoc = getVirtualFile('doc/fase-4-e2e-auditoria-negocio/02_INFORME_EJECUTIVO_APROBACION_NEGOCIO.md')
  assert.ok(businessDoc, 'Documento de Aprobación de Negocio debe haberse generado')
  assert.ok(
    businessDoc.includes('Validado conforme por Dirección Financiera'),
    'El documento de negocio debe reflejar los comentarios reales del stakeholder',
  )

  const unitDoc = getVirtualFile('doc/fase-3-construccion-pruebas/EVIDENCIA_PRUEBAS_COMP_BILLING.md')
  assert.ok(unitDoc, 'Documento de pruebas unitarias debe haberse generado')
  assert.ok(
    unitDoc.includes('Contrato IFactura validado OK'),
    'El documento de pruebas debe reflejar los logs reales de ejecución',
  )
  console.log('✓ Documentación modular derivada fielmente de las evidencias existentes.')

  console.log('\n=== ¡Todas las pruebas de las 5 mejoras del SDLC pasaron exitosamente! ===')
}

runSDLCImprovementsTests().catch((err) => {
  console.error('Error en pruebas de mejoras SDLC:', err)
  process.exit(1)
})
