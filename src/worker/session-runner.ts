import {
  defaultAgentWorkflow,
  registerSessionCallbacks,
  unregisterSessionCallbacks,
} from '../agent/agent-graph'
import { compiledSDLCGraph } from '../agent/sdlc-graph'
import type { Phase0ThreeStepData } from '../agent/sdlc-state'
import { trace } from '../diagnostics'
import { SessionStatus, type SessionStatus as SessionStatusType } from '../enums'
import type { ChatMessage } from '../llm/llm-client'
import { getLlmConfig } from '../llm/llm-config'
import {
  appendSessionMessage,
  getSessionById,
  listSessionMessages,
  updateSessionMetrics,
} from '../memory/app-db'

export interface AgentThinkingState {
  sessionId: number
  isThinking: boolean
  thought: string
  phase: 'thinking' | 'executing_tools' | 'completed'
  activeTool?: string
  turnsUsed?: number
  maxTurns?: number
  tokensUsed?: number
  updatedAt: number
}

export interface SessionRunHooks {
  onThinking?: (state: AgentThinkingState) => void
  onStepUpdate?: (sessionId: number) => void
  onStreamChunk?: (sessionId: number, contentSoFar: string, delta: string, thought?: string, phase?: string) => void
  onProposalCreated?: (sessionId: number, proposalId: number, path: string) => void
}

const activeAbortControllers = new Map<number, AbortController>()

export function abortRunningSession(sessionId: number): void {
  const ctrl = activeAbortControllers.get(sessionId)
  if (ctrl) {
    ctrl.abort()
    activeAbortControllers.delete(sessionId)
  }
}

export function isSessionCurrentlyRunning(sessionId: number): boolean {
  return activeAbortControllers.has(sessionId)
}

/**
 * Runs a complete cyclic LangGraph turn for a given session, persisting checkpoints
 * in IndexedDBSaver and messages in Dexie (`localloop-app-db`).
 */
export async function executeSessionTurn(
  sessionId: number,
  userPrompt: string | undefined,
  hooks: SessionRunHooks = {},
  phase0Data?: Phase0ThreeStepData,
): Promise<SessionStatusType> {
  if (activeAbortControllers.has(sessionId)) {
    return SessionStatus.RUNNING
  }

  const session = await getSessionById(sessionId)
  if (!session) {
    throw new Error(`Sesión #${sessionId} no encontrada.`)
  }

  const abortController = new AbortController()
  activeAbortControllers.set(sessionId, abortController)

  const config = getLlmConfig()

  if (userPrompt && userPrompt.trim().length > 0) {
    await appendSessionMessage({
      sessionId,
      role: 'user',
      content: userPrompt.trim(),
    })
  }

  const storedMessages = await listSessionMessages(sessionId)
  const historyMessages: ChatMessage[] = storedMessages.map((m) => ({
    role: m.role,
    content: m.content,
    thought: m.thought,
    ...(m.toolCallId ? { tool_call_id: m.toolCallId } : {}),
    ...(m.toolName ? { name: m.toolName } : {}),
  }))

  await updateSessionMetrics(sessionId, {
    status: SessionStatus.RUNNING,
    model: config.model,
  })
  hooks.onStepUpdate?.(sessionId)

  registerSessionCallbacks(sessionId, {
    signal: abortController.signal,
    onThinking: (info) => {
      hooks.onThinking?.({
        sessionId,
        isThinking: info.phase !== 'completed',
        thought: info.thought,
        phase: info.phase,
        activeTool: info.activeTool,
        turnsUsed: info.turnsUsed,
        maxTurns: info.maxTurns,
        tokensUsed: info.tokensUsed,
        updatedAt: Date.now(),
      })
    },
    onStreamChunk: (chunk) => {
      hooks.onStreamChunk?.(sessionId, chunk.contentSoFar, chunk.delta, chunk.thought, chunk.phase)
    },
    onStepUpdate: (id) => {
      hooks.onStepUpdate?.(id)
    },
    onProposalCreated: (proposalId, path) => {
      hooks.onProposalCreated?.(sessionId, proposalId, path)
    },
  })

  try {
    if (session.skill === 'ProjectRigor_Interviewer' || session.skill === 'sdlc' || !session.skill || session.skill === 'skill_general') {
      const threadConfig = { configurable: { thread_id: session.threadId } }
      let finalState: any
      if (userPrompt && userPrompt.trim().length > 0) {
        const updatePayload: Record<string, any> = {
          messages: historyMessages,
        }
        if (phase0Data) {
          updatePayload.phase0Data = phase0Data
          if (phase0Data.step2?.marketStandard) {
            updatePayload.marketArchStandard = phase0Data.step2.marketStandard
          }
          if (phase0Data.step2?.mcpUrl) {
            updatePayload.mcpServerConfig = {
              connected: true,
              url: phase0Data.step2.mcpUrl,
            }
          }
        }
        await compiledSDLCGraph.updateState(threadConfig, updatePayload)
        finalState = await compiledSDLCGraph.invoke(null, threadConfig)
      } else {
        finalState = await compiledSDLCGraph.invoke(
          {
            sessionId,
            threadId: session.threadId,
            messages: historyMessages,
            ...(phase0Data ? { phase0Data } : {}),
            ...(phase0Data?.step2?.marketStandard ? { marketArchStandard: phase0Data.step2.marketStandard } : {}),
            ...(phase0Data?.step2?.mcpUrl ? { mcpServerConfig: { connected: true, url: phase0Data.step2.mcpUrl } } : {}),
          },
          threadConfig,
        )
      }

      const storedAfterInvoke = await listSessionMessages(sessionId)
      const storedContents = new Set(storedAfterInvoke.map((m) => m.content.trim()))
      const graphMessages = finalState.messages || []
      for (const gm of graphMessages) {
        if (gm.content && !storedContents.has(gm.content.trim())) {
          await appendSessionMessage({
            sessionId,
            role: gm.role,
            content: gm.content,
          })
          storedContents.add(gm.content.trim())
        }
      }

      let resolvedStatus: SessionStatusType = SessionStatus.COMPLETED
      if (finalState.currentPhase === '0_DISCOVERY_RIGOR' && !finalState.discoveryCompleted) {
        resolvedStatus = SessionStatus.WAITING_APPROVAL
      } else if (finalState.currentPhase === '4_E2E_BUSINESS_AUDIT' && !finalState.businessApproval) {
        resolvedStatus = SessionStatus.WAITING_APPROVAL
      } else if (finalState.currentPhase !== 'COMPLETED') {
        resolvedStatus = SessionStatus.IDLE
      }

      await updateSessionMetrics(sessionId, {
        status: resolvedStatus,
        turnsUsed: (session.turnsUsed || 0) + 1,
        tokensUsed: session.tokensUsed || 0,
      })

      hooks.onThinking?.({
        sessionId,
        isThinking: false,
        thought: '',
        phase: 'completed',
        updatedAt: Date.now(),
      })
      hooks.onStepUpdate?.(sessionId)
      return resolvedStatus
    }

    const finalState = await defaultAgentWorkflow.invoke(
      {
        sessionId,
        threadId: session.threadId,
        skill: session.skill || 'skill_general',
        messages: historyMessages,
        turnsUsed: 0,
        maxTurns: config.maxTurns || session.maxTurns || 12,
        tokensUsed: session.tokensUsed || 0,
        maxTokenBudget: config.maxTokenBudget || session.maxTokenBudget || 64000,
        pendingToolCalls: [],
        requiresHumanConfirmation: false,
        status: SessionStatus.RUNNING,
      },
      {
        configurable: {
          thread_id: session.threadId,
        },
      },
    )

    let resolvedStatus: SessionStatusType = finalState.status ?? SessionStatus.COMPLETED
    if (
      resolvedStatus === SessionStatus.COMPLETED &&
      finalState.requiresHumanConfirmation
    ) {
      resolvedStatus = SessionStatus.WAITING_APPROVAL
    }

    await updateSessionMetrics(sessionId, {
      status: resolvedStatus,
      turnsUsed: (session.turnsUsed || 0) + (finalState.turnsUsed || 0),
      tokensUsed: finalState.tokensUsed ?? session.tokensUsed,
    })

    hooks.onThinking?.({
      sessionId,
      isThinking: false,
      thought: '',
      phase: 'completed',
      updatedAt: Date.now(),
    })
    hooks.onStepUpdate?.(sessionId)
    return resolvedStatus
  } catch (err) {
    const isAbort =
      abortController.signal.aborted ||
      (err instanceof Error && err.name === 'AbortError')
    const errorStatus = isAbort ? SessionStatus.IDLE : SessionStatus.ERROR
    const errMsg = err instanceof Error ? err.message : String(err)

    trace('agent.session.error', { sessionId, isAbort, error: errMsg })

    if (!isAbort) {
      await appendSessionMessage({
        sessionId,
        role: 'assistant',
        content: `❌ Error durante el bucle agéntico: ${errMsg}`,
      })
    }

    await updateSessionMetrics(sessionId, {
      status: errorStatus,
    })

    hooks.onThinking?.({
      sessionId,
      isThinking: false,
      thought: '',
      phase: 'completed',
      updatedAt: Date.now(),
    })
    hooks.onStepUpdate?.(sessionId)
    if (!isAbort) throw err
    return errorStatus
  } finally {
    unregisterSessionCallbacks(sessionId)
    activeAbortControllers.delete(sessionId)
  }
}
