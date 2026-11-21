import assert from 'node:assert'
import {
  createSession,
  getSessionById,
  listSessionMessages,
  appendSessionMessage,
  createFileProposal,
  listFileProposals,
  resetSessionFromScratch,
} from '../src/memory/app-db'
import { getSharedIndexedDBSaver } from '../src/memory/indexeddb-saver'
import { SessionStatus, FileProposalStatus } from '../src/enums'
import { executeSessionTurn } from '../src/worker/session-runner'
import {
  resetAgentSessionFromScratch,
  isSessionRunning,
} from '../src/worker/agent-bridge'
import {
  p0State,
  resetP0State,
  computeSdlcPhasesState,
} from '../src/screens/workspace'

console.log('🧪 Iniciando pruebas de Capacidad de Iniciar el Proceso Desde Cero en Cualquier Momento...')

async function runTests() {
  const checkpointer = getSharedIndexedDBSaver()

  // 1. Crear sesión de prueba con checkpoints, mensajes y propuestas de ficheros
  const sessionId = await createSession({
    title: 'Proyecto E-Commerce',
    goal: 'Construir pasarela de pago y catálogo',
    skill: 'ProjectRigor_Interviewer',
  })

  const initialSession = await getSessionById(sessionId)
  assert(initialSession, 'La sesión inicial debe existir')
  const originalThreadId = initialSession.threadId

  // Simular checkpoints en IndexedDBSaver para el thread
  await checkpointer.put(
    { configurable: { thread_id: originalThreadId } },
    {
      v: 1,
      id: 'cp-step-1',
      ts: new Date().toISOString(),
      channel_values: { currentPhase: '3_COMPONENT_CONSTRUCTION' },
      channel_versions: {},
      versions_seen: {},
      pending_sends: [],
    },
    { source: 'loop', step: 3, writes: {}, parents: {} },
  )

  // Agregar varios mensajes simulando avance del ciclo
  await appendSessionMessage({
    sessionId,
    role: 'assistant',
    content: 'Fase 1: Arquitectura y Grafo DAG definidos',
    tokenUsage: { promptTokens: 1000, completionTokens: 200, totalTokens: 1200 },
  })
  await appendSessionMessage({
    sessionId,
    role: 'assistant',
    content: 'Fase 2: Diseño técnico gatekeeper aprobado',
    tokenUsage: { promptTokens: 1500, completionTokens: 400, totalTokens: 1900 },
  })

  // Crear propuesta de fichero
  await createFileProposal({
    sessionId,
    path: 'src/payment.ts',
    originalContent: '',
    proposedContent: 'export class PaymentService {}',
    reason: 'Implementación del servicio de pago',
    status: FileProposalStatus.PENDING,
  })

  const beforeResetMessages = await listSessionMessages(sessionId)
  const beforeResetProposals = await listFileProposals(sessionId)
  assert.strictEqual(beforeResetMessages.length, 3, 'Debe haber 3 mensajes antes del reset (1 inicial + 2 agénticos)')
  assert.strictEqual(beforeResetProposals.length, 1, 'Debe haber 1 propuesta antes del reset')

  // 2. Ejecutar reinicio del proceso desde cero
  const resetResult = await resetSessionFromScratch(sessionId)
  assert(resetResult, 'El resultado del reset debe devolver la sesión actualizada')

  // Verificaciones de estado limpio
  assert.notStrictEqual(resetResult.threadId, originalThreadId, 'Debe asignar un nuevo threadId para aislar completamente LangGraph')
  assert.strictEqual(resetResult.status, SessionStatus.IDLE, 'El estado debe volver a IDLE')
  assert.strictEqual(resetResult.currentPhase, '0_DISCOVERY_RIGOR', 'La fase debe volver a 0_DISCOVERY_RIGOR')
  assert.strictEqual(resetResult.turnsUsed, 0, 'Los turnos deben reiniciarse a 0')
  assert.strictEqual(resetResult.tokensUsed, 0, 'Los tokens deben reiniciarse a 0')

  // Verificar que los checkpoints del hilo anterior fueron purgados
  const oldCheckpoint = await checkpointer.getTuple({ configurable: { thread_id: originalThreadId } })
  assert.strictEqual(oldCheckpoint, undefined, 'Los checkpoints del thread previo deben haber sido eliminados')

  // Verificar que los mensajes fueron limpiados, quedando solo el mensaje inicial
  const afterResetMessages = await listSessionMessages(sessionId)
  assert.strictEqual(afterResetMessages.length, 1, 'Solo debe quedar el mensaje inicial tras el reset')
  assert.strictEqual(afterResetMessages[0].role, 'user', 'El único mensaje debe ser de rol user')

  // Verificar que las propuestas fueron eliminadas
  const afterResetProposals = await listFileProposals(sessionId)
  assert.strictEqual(afterResetProposals.length, 0, 'Las propuestas de fichero de la sesión deben quedar vacías')

  // 3. Probar reinicio mediante comando de chat en executeSessionTurn ('iniciar desde cero')
  const session2Id = await createSession({
    title: 'Proyecto CRM',
    goal: 'Construir pipeline de ventas',
  })
  await appendSessionMessage({
    sessionId: session2Id,
    role: 'assistant',
    content: 'Avanzando en Fase 2...',
  })

  const turnResult1 = await executeSessionTurn(session2Id, 'iniciar el proceso desde cero')
  assert.strictEqual(turnResult1, SessionStatus.IDLE, 'Debe retornar IDLE tras comando de reinicio')

  const session2After = await getSessionById(session2Id)
  assert.strictEqual(session2After?.currentPhase, '0_DISCOVERY_RIGOR', 'currentPhase debe ser 0_DISCOVERY_RIGOR tras comando en texto')
  assert.strictEqual(session2After?.turnsUsed, 0, 'turnsUsed debe ser 0')

  // Probar comando abreviado /reset
  const turnResult2 = await executeSessionTurn(session2Id, '/reset')
  assert.strictEqual(turnResult2, SessionStatus.IDLE, 'Debe procesar /reset correctamente')

  // 4. Probar reinicio a través de agent-bridge (resetAgentSessionFromScratch)
  const session3Id = await createSession({
    title: 'Proyecto IoT Dashboard',
    goal: 'Métricas de telemetría en tiempo real',
  })
  const resetBridgeResult = await resetAgentSessionFromScratch(session3Id)
  assert(resetBridgeResult, 'resetAgentSessionFromScratch debe retornar la sesión')
  assert.strictEqual(isSessionRunning(session3Id), false, 'La sesión no debe figurar como en ejecución')
  assert.strictEqual(resetBridgeResult.currentPhase, '0_DISCOVERY_RIGOR', 'La fase debe ser 0_DISCOVERY_RIGOR')

  // 5. Probar resetP0State en workspace
  p0State.featureTitle = 'Iniciativa Modificada'
  p0State.needsList = [{ id: 'NEED-99', description: 'Custom', expectedImpact: 'High' }]
  resetP0State('Iniciativa Reiniciada')
  assert.strictEqual(p0State.featureTitle, 'Iniciativa Reiniciada', 'featureTitle debe ser el proporcionado al resetear')
  assert.strictEqual(p0State.rawBusinessLanguageText, '', 'rawBusinessLanguageText debe quedar en blanco')
  assert.strictEqual(p0State.needsList.length, 1, 'needsList debe tener 1 elemento limpio')
  assert.strictEqual(p0State.needsList[0].description, '', 'description debe estar vacía')

  // 6. Probar cálculo de stepper en sesión reseteada (Fase 0 waiting)
  const stepperState = computeSdlcPhasesState({
    sessionStatus: SessionStatus.IDLE,
    currentPhase: '0_DISCOVERY_RIGOR',
    turnsUsed: 0,
    messages: [{ sessionId: 1, role: 'user', content: 'Nuevo objetivo', createdAt: new Date().toISOString() }],
    running: false,
  })
  assert.strictEqual(stepperState[0].status, 'waiting', 'Fase 0 debe estar en estado waiting (HITL 1 listo)')
  assert.strictEqual(stepperState[1].status, 'pending', 'Fase 1 debe estar pendiente')

  console.log('✅ Todas las pruebas de Iniciar el Proceso Desde Cero Pasaron Exitosamente.')
}

runTests().catch((err) => {
  console.error('❌ Error en pruebas:', err)
  process.exit(1)
})
