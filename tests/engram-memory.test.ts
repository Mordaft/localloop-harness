import assert from 'node:assert/strict'
import {
  AgentScopeStorage,
  ENGRAM_REF_PREFIX,
  InMemoryEngramStore,
  createIsolatedEngram,
  fromEngramRef,
  getPersistentMemoryStore,
  refreshPersistentEngram,
  retrieveEngramMemoryContext,
  saveEpisodicTurnMemory,
  saveSdlcPhaseArtifact,
  toEngramRef,
} from '../src/memory/engram-memory'

console.log('--- Iniciando pruebas de Memoria Engram-ts y AgentScopeStorage ---')

async function runTests() {
  const engram = createIsolatedEngram()
  const rootStorage = new AgentScopeStorage({
    engram,
    project: 'session-1',
    filePath: 'src/index.ts',
    scopeId: 'root_src_index_ts',
  })

  const subTasks = [
    {
      id_subtarea: 'child_1',
      descripcion: 'Revisar imports y estructura modular',
      skill_requerida: 'skill_architect' as const,
      lineStart: 1,
      lineEnd: 20,
    },
  ]

  const planHeader = await rootStorage.saveSubPlan(subTasks, 'Separación modular')
  assert.ok(planHeader.id.length > 0)
  assert.equal(planHeader.type, 'scope-plan')

  const childStorage = rootStorage.createChildScopeStorage('child_1')
  assert.equal(childStorage.depth, 1)
  assert.equal(childStorage.parentScopeId, 'root_src_index_ts')
  assert.equal(childStorage.ancestorScopeIds.has('root_src_index_ts'), true)

  const savedResult = await childStorage.saveScopeResult({
    task: subTasks[0],
    codeSlice: 'const a = 1;',
    sumarioEjecutivo: 'Módulo limpio y modular',
    findings: [
      {
        id: 'f-1',
        filePath: 'src/index.ts',
        line: 1,
        severity: 'baja',
        category: 'architecture',
        message: 'Estructura correcta',
        recommendation: 'Mantener modularidad',
      },
    ],
  })

  assert.ok(savedResult.engram_ref.startsWith(ENGRAM_REF_PREFIX))
  assert.equal(fromEngramRef(toEngramRef(savedResult.memoryId)), savedResult.memoryId)

  const reused = await rootStorage.findReusableScopeResult(subTasks[0], 'const a = 1;')
  assert.ok(reused, 'Debe reutilizar el resultado del scope desde engram-ts')
  assert.ok(reused.sumario_ejecutivo.includes('Módulo limpio'))
  assert.equal(reused.findings.length, 1)

  const loadedByRef = await rootStorage.getScopeResultByMemoryId(savedResult.engram_ref)
  assert.ok(loadedByRef)
  assert.equal(loadedByRef.id_scope, 'child_1')

  // Pruebas de guardado episódico y recuperación de contexto LLM
  const store = new InMemoryEngramStore()
  const epHeader = await saveEpisodicTurnMemory({
    sessionId: 99,
    userPrompt: '¿Cómo modularizamos el módulo de pagos?',
    assistantReply: 'Diseñamos una interfaz IPaymentGateway con Clean Architecture.',
    thought: 'Analizando patrones arquitectónicos',
    phase: 'fase_2_diseno',
    store,
  })
  assert.ok(epHeader.id)
  assert.equal(epHeader.type, 'conversational_episode')
  assert.ok(epHeader.tags.includes('session-99'))

  const artHeader = await saveSdlcPhaseArtifact({
    sessionId: 99,
    phaseName: 'phase_2_design',
    artifactTitle: 'Contrato IPaymentGateway',
    artifactType: 'technical_design',
    payload: { interface: 'IPaymentGateway', methods: ['processPayment'] },
    store,
  })
  assert.ok(artHeader.id)
  assert.equal(artHeader.type, 'technical_design')

  const contextStr = await retrieveEngramMemoryContext({
    query: 'pagos arquitectura',
    project: 'session-99',
    limit: 2,
    store,
  })
  assert.ok(contextStr.includes('MEMORIA EPISÓDICA'))
  assert.ok(contextStr.includes('IPaymentGateway') || contextStr.includes('Turno Sesión #99'))

  // Prueba de sincronización de memoria y refresco para Memory Explorer
  const sharedStore = getPersistentMemoryStore()
  const savedShared = await saveEpisodicTurnMemory({
    sessionId: 101,
    userPrompt: '¿Cómo funciona la PWA de Tetris?',
    assistantReply: 'Combina motor de juego, controles táctiles y Google Ads slot.',
    phase: 'fase_1_plan',
    store: sharedStore,
  })
  assert.ok(savedShared.id)

  const directHeaders = await sharedStore.listHeaders()
  assert.ok(directHeaders.length > 0, 'listHeaders() debe listar cabeceras directamente desde el store')
  assert.ok(directHeaders.some((h) => h.id === savedShared.id))

  const refreshedEngram = await refreshPersistentEngram()
  assert.ok(refreshedEngram, 'refreshPersistentEngram debe devolver una instancia sincronizada')

  console.log('✓ Todas las pruebas de Memoria Engram-ts pasaron exitosamente.')
}

void runTests()
