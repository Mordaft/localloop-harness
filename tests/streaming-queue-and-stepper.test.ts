import assert from 'node:assert'
import {
  computeSdlcPhasesState,
  renderLifecycleStepperHtml,
} from '../src/screens/workspace'
import { SessionStatus } from '../src/enums'
import type { StoredChatMessage } from '../src/memory/app-db'

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

console.log('✅ Todas las pruebas de Stepper Dinámico y Estado de Fases pasaron exitosamente.')

