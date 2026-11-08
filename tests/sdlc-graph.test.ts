import { compiledSDLCGraph } from '../src/agent/sdlc-graph'
import type { SDLCStateType } from '../src/agent/sdlc-state'
import { RuntimeSkillLoader } from '../src/agent/skills/runtime-loader'
import { SKILL_TREE } from '../src/agent/skills/skills-tree'
import { getVirtualFile } from '../src/fs/workspace-fs'

async function runSDLCGraphTests() {
  console.log('--- Iniciando pruebas de Árbol Progresivo de Skills y SDLC Graph ---')

  // 1. Verificar integridad del árbol de skills
  console.log(`[Test 1] Verificando árbol de skills (${SKILL_TREE.length} ramas)...`)
  if (SKILL_TREE.length !== 7) {
    throw new Error(`Se esperaban 7 ramas en el árbol de skills, encontradas: ${SKILL_TREE.length}`)
  }
  const totalSkills = SKILL_TREE.reduce((acc, b) => acc + b.skills.length, 0)
  console.log(`✓ Árbol de skills íntegro con ${totalSkills} skills especializadas.`)

  // 2. Verificar resolución quirúrgica de contexto en RuntimeSkillLoader
  console.log('[Test 2] Verificando RuntimeSkillLoader (JIT Scoping sin context bloat)...')
  const mockState: SDLCStateType = {
    sessionId: 101,
    threadId: 'test-thread-101',
    currentPhase: '3_COMPONENT_CONSTRUCTION',
    activeSkill: 'Component_Implementer',
    activeComponentId: 'comp_auth',
    discoveryInputValid: true,
    useCases: [],
    marketArchStandard: 'CLEAN_ARCHITECTURE',
    mcpServerConfig: { connected: false },
    componentsGraph: {},
    projectPlan: { milestones: [], backlog: [] },
    technicalDesigns: {},
    gatekeeperDecisions: {},
    technicalDebtList: [],
    unitEvidences: {},
    e2eEvidences: null,
    businessApproval: null,
    rcaDiagnosis: null,
    progressEvents: [],
    discoveryCompleted: true,
    messages: [],
    pendingToolCalls: [],
    turnsUsed: 0,
    maxTurns: 20,
  }

  const resolved = RuntimeSkillLoader.resolveContext(mockState)
  if (!resolved.systemPrompt.includes('comp_auth')) {
    throw new Error('El system prompt no se especializó con el componente activo')
  }
  if (!resolved.engramFilter.tags.includes('local_contracts')) {
    throw new Error('El filtro de Engram no coincide con la especificación de Component_Implementer')
  }
  console.log(`✓ RuntimeSkillLoader cargó quirúrgicamente las tools: ${resolved.tools.map((t) => t.function.name).join(', ')}`)

  // 3. Ejecutar el grafo de estados LangGraph
  console.log('[Test 3] Ejecutando grafo SDLC hasta la primera interrupción (HITL 1 - Fase 0)...')
  const initialState = {
    sessionId: 201,
    threadId: 'thread-sdlc-201',
    messages: [{ role: 'user' as const, content: 'Quiero desarrollar un sistema de facturación' }],
  }

  const threadConfig = { configurable: { thread_id: 'thread-sdlc-201' } }
  const run1 = await compiledSDLCGraph.invoke(initialState, threadConfig)

  if (run1.currentPhase !== '0_DISCOVERY_RIGOR') {
    throw new Error(`Se esperaba fase 0_DISCOVERY_RIGOR, obtenido: ${run1.currentPhase}`)
  }
  const lastMsg = run1.messages[run1.messages.length - 1]
  if (!lastMsg.content.includes('Fase 0: Descubrimiento y Calibración de Rigor')) {
    throw new Error('El grafo no generó las preguntas de descubrimiento esperadas.')
  }
  console.log('✓ Fase 0 generó el cuestionario de rigor y pausó en la interrupción HITL 1.')

  // 4. Reanudar el grafo proporcionando la definición detallada en 3 pasos (Fase 0)
  console.log('[Test 4] Reanudando tras HITL 1 con especificación completa en 3 Pasos (Negocio + EA + Solución)...')
  const resumeState = {
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        rawBusinessLanguageText: 'Automatizar emisión de facturación electrónica B2B conforme a ley.',
        needsList: [
          { id: 'NEED-1', description: 'Generación XML y firma digital fiscal', expectedImpact: 'Cero multas fiscales' },
        ],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        mcpUrl: 'http://localhost:3000/sse',
        currentSituation: {
          title: 'ERP Monolítico legado',
          description: 'ERP Monolítico legado',
          limitationsOrCapabilities: ['Bloqueos transaccionales', 'Sin API tributaria'],
        },
        desiredSituation: {
          title: 'Arquitectura orientada a eventos',
          description: 'Arquitectura orientada a eventos',
          limitationsOrCapabilities: ['Emisión de facturas en milisegundos'],
        },
        transitionSituation: {
          title: 'Adaptador de convivencia transicional',
          description: 'Adaptador de convivencia transicional',
          limitationsOrCapabilities: ['Convivencia con ERP legado'],
        },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_billing_core',
            name: 'Motor Core de Facturación',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Reglas fiscales y cálculo.',
            dependsOn: [],
          },
          {
            componentId: 'comp_digital_signature',
            name: 'Servicio de Firma Criptográfica',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Firma digital XAdES.',
            dependsOn: ['comp_billing_core'],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-FACT-01',
        title: 'Emisión de Factura Electrónica',
        actor: 'Administrador Financiero',
        happyPath: ['Crear borrador', 'Calcular impuestos', 'Firmar digitalmente'],
        exceptions: ['Impuesto inválido'],
        expectedBusinessOutcome: 'Automatizar el 100% de la facturación legal.',
        acceptanceCriteriaGherkin: 'Given factura válida, When se firma, Then estado EMITIDA.',
      },
    ],
  }

  await compiledSDLCGraph.updateState(threadConfig, resumeState)
  const run2 = await compiledSDLCGraph.invoke(null, threadConfig)
  console.log(`✓ Estado alcanzado tras reanudación: Fase ${run2.currentPhase}`)
  console.log(`✓ Componentes planificados con dependencias Fin-Inicio: ${Object.keys(run2.componentsGraph).join(', ')}`)
  console.log(`✓ Eventos de progreso emitidos: ${run2.progressEvents.length}`)

  if (!run2.componentsGraph['comp_billing_core'] || !run2.componentsGraph['comp_digital_signature']) {
    throw new Error('Los componentes personalizados de la Fase 0 no fueron cargados en el DAG.')
  }
  if (!run2.componentsGraph['comp_digital_signature'].dependsOn.includes('comp_billing_core')) {
    throw new Error('La dependencia Fin-Inicio comp_billing_core no se preservó en comp_digital_signature.')
  }

  // 5. Verificar que Fase 1 propuso el marco de referencia y pausó en la interrupción HITL 1.5
  if (run2.currentPhase !== '1_STRATEGY_AND_PLAN') {
    throw new Error(`Se esperaba pausa en 1_STRATEGY_AND_PLAN, obtenido: ${run2.currentPhase}`)
  }
  console.log('✓ Fase 1 propuso el WBS, DAG y marco de desarrollo y pausó para feedback del usuario.')

  // Reanudar con la respuesta del usuario en conversación abierta confirmando el stack tecnológico
  console.log('[Test 4.5] Respondiendo en conversación abierta para formalizar framework y generar setup.cmd / setup.sh...')
  await compiledSDLCGraph.updateState(threadConfig, {
    messages: [
      ...run2.messages,
      { role: 'user', content: 'De acuerdo con HTML5 + TypeScript + TailwindCSS. Procede con el setup.' },
    ],
  })
  const run2b = await compiledSDLCGraph.invoke(null, threadConfig)

  // Validar que setup.cmd y setup.sh fueron generados en la raíz
  const setupCmd = getVirtualFile('setup.cmd')
  const setupSh = getVirtualFile('setup.sh')
  if (!setupCmd || (!setupCmd.includes('setup.cmd') && !setupCmd.includes('LocalLoop'))) {
    throw new Error('setup.cmd no fue generado en la raíz del workspace')
  }
  if (!setupSh || !setupSh.includes('npm install')) {
    throw new Error('setup.sh no fue generado en la raíz del workspace')
  }
  console.log('✓ Scripts de setup (setup.cmd y setup.sh) generados en la raíz del workspace.')

  // 6. Verificar que se alcanzó la Fase 4 y la segunda interrupción (HITL 2 - Aprobación Formal de Negocio)
  const approvalMsg = run2b.messages.find((m: any) => m.content.includes('Fase 4: Solicitud de Aprobación Formal de Negocio'))
  if (!approvalMsg) {
    throw new Error('Se esperaba solicitud de aprobación formal de negocio en Fase 4')
  }

  // Validar que start.cmd y start.sh fueron generados en la raíz en Fase 4
  const startCmd = getVirtualFile('start.cmd')
  const startSh = getVirtualFile('start.sh')
  if (!startCmd || (!startCmd.includes('start.cmd') && !startCmd.includes('npm'))) {
    throw new Error('start.cmd no fue generado en la raíz del workspace en Fase 4')
  }
  if (!startSh || !startSh.includes('npm')) {
    throw new Error('start.sh no fue generado en la raíz del workspace en Fase 4')
  }
  console.log('✓ Scripts de arranque (start.cmd y start.sh) generados en Fase 4.')
  console.log('✓ Fase 4 compiló evidencias E2E y pausó en la interrupción HITL 2.')

  // 7. Aprobar formalmente y verificar cierre y proyección documental
  console.log('[Test 5] Otorgando Aprobación Formal de Negocio para completar Fase 6 (Documentación)...')
  await compiledSDLCGraph.updateState(threadConfig, {
    businessApproval: {
      approved: true,
      stakeholderComments: 'Aprobado formalmente por Dirección de Operaciones.',
      evaluatedAt: new Date().toISOString(),
    },
  })
  const run3 = await compiledSDLCGraph.invoke(null, threadConfig)

  if (run3.currentPhase !== 'COMPLETED') {
    throw new Error(`Se esperaba estado COMPLETED, obtenido: ${run3.currentPhase}`)
  }
  console.log('✓ Fase 6 ejecutó la proyección documental y finalizó el ciclo con éxito.')

  // 7. Verificar que los documentos modulares en doc/ y carpetas por fase existen
  const docFiles = [
    'doc/fase-0-descubrimiento/01_CASOS_DE_USO_Y_NEGOCIO.md',
    'doc/fase-0-descubrimiento/02_ARQUITECTURA_EMPRESARIAL_AS_IS_TO_BE.md',
    'doc/fase-1-estrategia-plan/01_PLAN_WBS_Y_GRAFO_DEPENDENCIAS.md',
    'doc/fase-2-diseno-gatekeeper/00_AUDITORIA_ARQUITECTURA_Y_DEUDA_TECNICA.md',
    'doc/fase-2-diseno-gatekeeper/DISENO_COMP_BILLING_CORE.md',
    'doc/fase-3-construccion-pruebas/EVIDENCIA_PRUEBAS_COMP_BILLING_CORE.md',
    'doc/fase-4-e2e-auditoria-negocio/01_EVIDENCIAS_PRUEBAS_E2E.md',
    'doc/fase-4-e2e-auditoria-negocio/02_INFORME_EJECUTIVO_APROBACION_NEGOCIO.md',
    'doc/fase-6-cierre-entrega/01_LANDSCAPE_ARQUITECTURA.md',
    'LANDSCAPE.md',
  ]
  for (const path of docFiles) {
    const fileContent = getVirtualFile(path)
    if (!fileContent || fileContent.length === 0) {
      throw new Error(`El archivo de documentación esperado no fue generado: ${path}`)
    }
  }
  console.log(`✓ Generación documental modular en doc/ verificada (${docFiles.length} documentos validados).`)

  console.log('--- Todas las pruebas del SDLC Graph y Árbol de Skills pasaron con éxito ---')
}

runSDLCGraphTests().catch((err) => {
  console.error('Error en pruebas de SDLC Graph:', err)
  process.exit(1)
})
