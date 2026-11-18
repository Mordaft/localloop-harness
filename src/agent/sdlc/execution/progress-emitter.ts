import { trace } from '../../../diagnostics'
import { appendSessionMessage, updateSessionMetrics } from '../../../memory/app-db'
import { getSessionCallbacks } from '../../agent-graph'
import type { SdlcPhase } from '../../sdlc-state'

/**
 * Notifica el avance en tiempo real a Dexie (app-db) y a la UI mediante los callbacks de sesión
 */
export async function emitSDLCProgress(
  sessionId: number | undefined,
  message: { role: 'assistant'; content: string; thought?: string },
  thinkingText?: string,
  sdlcPhase?: SdlcPhase,
): Promise<void> {
  if (!sessionId) return
  try {
    if (sdlcPhase) {
      await updateSessionMetrics(sessionId, { currentPhase: sdlcPhase })
    }
    await appendSessionMessage({
      sessionId,
      role: message.role,
      content: message.content,
      thought: message.thought,
    })
    const callbacks = getSessionCallbacks(sessionId)
    if (thinkingText) {
      callbacks?.onThinking?.({
        sessionId,
        thought: thinkingText,
        phase: 'executing_tools',
        sdlcPhase,
      })
    }
    callbacks?.onStepUpdate?.(sessionId)
    // Pequeño retardo asíncrono para que el Web Worker procese el evento y el hilo principal actualice la UI
    await new Promise((resolve) => setTimeout(resolve, 200))
  } catch (err) {
    trace(`[SDLCGraph] Error en emitSDLCProgress: ${err}`)
  }
}
