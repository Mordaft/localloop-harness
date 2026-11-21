import assert from 'node:assert'
import {
  computeSdlcPhasesState,
  renderLifecycleStepperHtml,
  renderMessageItem,
  updateHeaderStatusInDom,
} from '../src/screens/workspace'
import { renderSessionCard } from '../src/screens/dashboard'
import { SessionStatus } from '../src/enums'
import {
  createSession,
  getSessionById,
  appendSessionMessage,
  type StoredChatMessage,
} from '../src/memory/app-db'

console.log('🧪 Iniciando pruebas de Stepper Dinámico y Cola Selectiva de Streaming...')

// 1. Prueba de Stepper en Fase 0 esperando interacción HITL
const phases0 = computeSdlcPhasesState({
  sessionStatus: SessionStatus.IDLE,
  turnsUsed: 0,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: 'Fase 0: Descubrimiento Riguroso...',
      createdAt: new Date().toISOString(),
    },
  ],
  running: false,
})

assert.strictEqual(phases0.length, 7, 'Debe haber 7 fases del ciclo de vida')
assert.strictEqual(phases0[0].status, 'waiting', 'Fase 0 debe estar en estado waiting (HITL 1)')
assert.strictEqual(phases0[1].status, 'pending', 'Fase 1 debe estar pendiente')

const html0 = renderLifecycleStepperHtml(phases0)
assert(html0.includes('0. Descubrimiento'), 'Debe incluir Fase 0')
assert(html0.includes('border-amber-500'), 'Debe tener estilo waiting con amber-500')

// 2. Prueba de Stepper con ejecución activa en Fase 2 (Diseño & Gatekeeper)
const phases2 = computeSdlcPhasesState({
  sessionStatus: SessionStatus.RUNNING,
  turnsUsed: 2,
  messages: [
    {
      sessionId: 1,
      role: 'user',
      content: 'Definición Formal de Fase 0 (3 Pasos Completados)',
      createdAt: new Date().toISOString(),
    },
    {
      sessionId: 1,
      role: 'assistant',
      content: 'Fase 1: Alineamiento Estratégico & DAG completado',
      createdAt: new Date().toISOString(),
    },
  ],
  running: true,
  liveStreamPhase: 'Fase 2: Diseño Técnico de Componentes',
  thinkingThought: 'Generando contratos de interfaz y arquitectura limpia',
})

assert.strictEqual(phases2[0].status, 'completed', 'Fase 0 debe estar completada')
assert.strictEqual(phases2[1].status, 'completed', 'Fase 1 debe estar completada')
assert.strictEqual(phases2[2].status, 'active', 'Fase 2 debe estar activa')
assert.strictEqual(phases2[3].status, 'pending', 'Fase 3 debe estar pendiente')

const html2 = renderLifecycleStepperHtml(phases2)
assert(html2.includes('border-primary'), 'Fase activa debe incluir border-primary')
assert(html2.includes('animate-pulse'), 'Fase activa debe incluir animate-pulse')

// 3. Prueba de Stepper en Fase 4 esperando Aprobación Formal de Negocio (HITL 2)
const phases4 = computeSdlcPhasesState({
  sessionStatus: SessionStatus.WAITING_APPROVAL,
  turnsUsed: 5,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: 'Fase 4: Solicitud de Aprobación Formal de Negocio. Pruebas E2E completadas con éxito.',
      createdAt: new Date().toISOString(),
    },
  ],
  running: false,
})

assert.strictEqual(phases4[4].status, 'waiting', 'Fase 4 debe estar waiting (HITL 2)')
const html4 = renderLifecycleStepperHtml(phases4)
assert(html4.includes('4. E2E & Negocio'), 'Debe renderizar Fase 4')
assert(html4.includes('border-amber-500'), 'Fase 4 waiting debe tener estilo amber-500')

// 4. Prueba de Stepper en Sesión Completada (Todas completas)
const phasesCompleted = computeSdlcPhasesState({
  sessionStatus: SessionStatus.COMPLETED,
  turnsUsed: 8,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: 'Ciclo de desarrollo completado con éxito. Documentación y código proyectados.',
      createdAt: new Date().toISOString(),
    },
  ],
  running: false,
})

assert(
  phasesCompleted.every((p) => p.status === 'completed'),
  'Todas las fases deben estar en completed cuando la sesión está terminada',
)
const htmlCompleted = renderLifecycleStepperHtml(phasesCompleted)
assert(!htmlCompleted.includes('animate-pulse'), 'Ninguna fase debe tener animate-pulse al completar')

// 5. Prueba de que en Fase 3 durante la ejecución de herramientas (pensamiento sin palabra clave) NO salta a Fase 0
const phases3RunningWithToolThought = computeSdlcPhasesState({
  sessionStatus: SessionStatus.RUNNING,
  currentPhase: '3_COMPONENT_CONSTRUCTION',
  turnsUsed: 3,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: 'Fase 1: Alineamiento DAG completado.',
      createdAt: new Date().toISOString(),
    },
    {
      sessionId: 1,
      role: 'assistant',
      content: 'Fase 2: Dictamen Gatekeeper aprobado.',
      createdAt: new Date().toISOString(),
    },
  ],
  running: true,
  liveStreamPhase: undefined,
  thinkingThought: 'Ejecutando herramienta run_sandboxed_js...',
})

assert.strictEqual(phases3RunningWithToolThought[0].status, 'completed', 'Fase 0 debe estar completada')
assert.strictEqual(phases3RunningWithToolThought[1].status, 'completed', 'Fase 1 debe estar completada')
assert.strictEqual(phases3RunningWithToolThought[2].status, 'completed', 'Fase 2 debe estar completada')
assert.strictEqual(phases3RunningWithToolThought[3].status, 'active', 'Fase 3 debe permanecer activa, NO saltar a Fase 0')
assert.strictEqual(phases3RunningWithToolThought[4].status, 'pending', 'Fase 4 debe estar pendiente')

// 6. Prueba de que tras Fase 6 con mensaje final generado por LLM en vivo no vuelve a Fase 0
const phasesCompletedLiveLlm = computeSdlcPhasesState({
  sessionStatus: SessionStatus.IDLE,
  currentPhase: 'COMPLETED',
  turnsUsed: 8,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content:
        '# Informe de Entrega Final: Sistema de Facturación Electrónica (LocalLoop)\n' +
        'Estado del Proyecto: COMPLETADO Y VERIFICADO\n' +
        '¡Felicidades al Equipo de Desarrollo!\n' +
        'Ciclo de Desarrollo LocalLoop - Fase 6 Finalizada.',
      createdAt: new Date().toISOString(),
    },
  ],
  running: false,
})

assert(
  phasesCompletedLiveLlm.every((p) => p.status === 'completed'),
  'Todas las fases deben estar en completed tras el cierre de Fase 6',
)

// 7. Prueba de que el pensamiento <think> con palabras como "cierre", "proyección", "resiliencia" NO hace saltar el stepper al final
const phases1WithComplexThought = computeSdlcPhasesState({
  sessionStatus: SessionStatus.RUNNING,
  currentPhase: '1_STRATEGY_AND_PLAN',
  turnsUsed: 2,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: '### 🎯 Fase 0: Calibración de Rigor completada',
      createdAt: new Date().toISOString(),
    },
  ],
  running: true,
  liveStreamPhase: '1_STRATEGY_AND_PLAN',
  thinkingThought:
    'Analizando la proyección de arquitectura, contratos de construcción, resiliencia del sistema y criterios de cierre del proyecto...',
})

assert.strictEqual(phases1WithComplexThought[0].status, 'completed', 'Fase 0 debe estar completada')
assert.strictEqual(
  phases1WithComplexThought[1].status,
  'active',
  'Fase 1 debe permanecer activa aunque <think> mencione cierre o proyección',
)
assert.strictEqual(
  phases1WithComplexThought[5].status,
  'pending',
  'Fase 5 & 6 NO debe activarse ni saltar al final por palabras en <think>',
)

// 8. Prueba de estado waiting en Fase 1 (HITL de Marco de Referencia y DAG)
const phases1Waiting = computeSdlcPhasesState({
  sessionStatus: SessionStatus.WAITING_APPROVAL,
  currentPhase: '1_STRATEGY_AND_PLAN',
  turnsUsed: 2,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: '### 🗺️ Fase 1: Propuesta de Solución Técnica y Grafo de Dependencias (DAG)',
      createdAt: new Date().toISOString(),
    },
  ],
  running: false,
})

assert.strictEqual(phases1Waiting[0].status, 'completed', 'Fase 0 debe estar completada al llegar a HITL de Fase 1')
assert.strictEqual(phases1Waiting[1].status, 'waiting', 'Fase 1 debe estar en estado waiting durante HITL de Fase 1')
assert.strictEqual(phases1Waiting[1].sublabel, 'DAG / HITL', 'Sublabel de Fase 1 waiting debe ser DAG / HITL')

// 9. Prueba de resiliencia del Stepper ante iteraciones entre componentes (Fase 2 de comp_2 no reinicia Fase 3 previa a pending)
const phasesIteration = computeSdlcPhasesState({
  sessionStatus: SessionStatus.RUNNING,
  currentPhase: '2_TECHNICAL_DESIGN_GATE',
  turnsUsed: 4,
  messages: [
    {
      sessionId: 1,
      role: 'assistant',
      content: '### 🔨 Fase 3: Construcción & Pruebas Unitarias — comp_core verificado',
      createdAt: new Date().toISOString(),
    },
  ],
  running: true,
  liveStreamPhase: 'Fase 2: Dictamen Gatekeeper — comp_service',
})

assert.strictEqual(phasesIteration[2].status, 'active', 'Fase 2 debe estar activa durante el diseño de comp_service')
assert.strictEqual(phasesIteration[3].status, 'completed', 'Fase 3 debe permanecer completed debido a la evidencia previa de comp_core')

// 10. Prueba de renderMessageItem con métricas de tokens de Contexto y Salida
const messageHtml = renderMessageItem({
  sessionId: 1,
  role: 'assistant',
  content: '### Fase 2: Dictamen Gatekeeper\nPropuesta aprobada con éxito.',
  phaseName: 'Fase 2: Dictamen Gatekeeper (comp_core)',
  tokenUsage: {
    promptTokens: 1450,
    completionTokens: 380,
    totalTokens: 1830,
  },
  createdAt: new Date().toISOString(),
})

assert(messageHtml.includes(`Contexto: <strong class="text-text-primary">${(1450).toLocaleString()}</strong>`), 'Debe mostrar tokens de contexto')
assert(messageHtml.includes(`Salida: <strong class="text-text-primary">${(380).toLocaleString()}</strong>`), 'Debe mostrar tokens de salida')
assert(messageHtml.includes('Fase 2: Dictamen Gatekeeper (comp_core)'), 'Debe incluir el tag de la fase')

// 11. Prueba de formateo de tokens y turnos en la tarjeta de sesión de la pantalla de sesiones (dashboard)
const sessionCardHtml = renderSessionCard({
  id: 42,
  threadId: 'test-thread-42',
  title: 'Sesión de Prueba de Tokens',
  goal: 'Verificar telemetría de tokens en la pastilla',
  status: SessionStatus.RUNNING,
  turnsUsed: 3,
  maxTurns: 12,
  tokensUsed: 8450,
  maxTokenBudget: 64000,
  model: 'qwen2.5-coder',
  createdAt: new Date().toISOString(),
  updated: new Date().toISOString(),
})

assert(sessionCardHtml.includes('Turno 3/12'), 'La tarjeta de sesión debe reemplazar {turns}/{maxTurns} sin dejar placeholders')
assert(!sessionCardHtml.includes('{turns}'), 'No debe quedar el placeholder {turns} en el DOM')
assert(!sessionCardHtml.includes('{maxTurns}'), 'No debe quedar el placeholder {maxTurns} en el DOM')
assert(sessionCardHtml.includes(`${(8450).toLocaleString()} tokens`), 'Debe mostrar la estadística de tokens consumidos formateada')

// 12. Prueba de limpieza y actualización reactiva de la barra superior con updateHeaderStatusInDom
const mockStatusBadge: any = {
  dataset: { sessionStatus: String(SessionStatus.WAITING_APPROVAL) },
  className: 'old-class',
  textContent: 'Esperando confirmación',
}
const mockStepper: any = {
  dataset: { sessionStatus: String(SessionStatus.WAITING_APPROVAL) },
}
const mockRoot: any = {
  querySelector: (sel: string) => {
    if (sel === '[data-session-status]') return mockStatusBadge
    if (sel === '#sdlc-lifecycle-stepper') return mockStepper
    return null
  },
}

updateHeaderStatusInDom(mockRoot, SessionStatus.RUNNING)
assert.strictEqual(mockStatusBadge.dataset.sessionStatus, String(SessionStatus.RUNNING), 'El badge de estado debe actualizarse a RUNNING')
assert.strictEqual(mockStatusBadge.textContent, 'Ejecutando bucle', 'El texto del badge debe limpiar la espera y mostrar Ejecutando bucle')
assert(mockStatusBadge.className.includes('bg-primary/15'), 'El estilo del badge debe cambiar al color primary de ejecución')
assert.strictEqual(mockStepper.dataset.sessionStatus, String(SessionStatus.RUNNING), 'El stepper debe reflejar el estado RUNNING')

// 13. Prueba de acumulación automática de tokensUsed en app-db al registrar mensajes con tokenUsage
async function testTokenAccumulation() {
  const sessionId = await createSession({
    title: 'Sesión DB Tokens',
    goal: 'Probar acumulación en memoria',
  })
  const initial = await getSessionById(sessionId)
  assert.strictEqual(initial?.tokensUsed, 0, 'Tokens iniciales deben ser 0')

  await appendSessionMessage({
    sessionId,
    role: 'assistant',
    content: 'Paso 1',
    tokenUsage: { promptTokens: 500, completionTokens: 150, totalTokens: 650 },
  })
  const afterFirst = await getSessionById(sessionId)
  assert.strictEqual(afterFirst?.tokensUsed, 650, 'Debe acumular 650 tokens')

  await appendSessionMessage({
    sessionId,
    role: 'assistant',
    content: 'Paso 2',
    tokenUsage: { promptTokens: 1200, completionTokens: 300, totalTokens: 1500 },
  })
  const afterSecond = await getSessionById(sessionId)
  assert.strictEqual(afterSecond?.tokensUsed, 2150, 'Debe acumular 2150 tokens totales')
}

testTokenAccumulation().then(() => {
  console.log('✅ Todas las pruebas de Stepper Dinámico, Resiliencia de Iteraciones y Telemetría de Tokens pasaron exitosamente.')
}).catch((err) => {
  console.error('❌ Error en pruebas:', err)
  process.exit(1)
})

