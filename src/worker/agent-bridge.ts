import { trace } from '../diagnostics'
import { getWorkspaceDirectoryHandle } from '../fs/workspace-fs'
import { getLlmConfig } from '../llm/llm-config'
import type { WorkerInboundMessage, WorkerOutboundMessage } from './agent.worker'
import {
  abortRunningSession,
  executeSessionTurn,
  isSessionCurrentlyRunning,
  type AgentThinkingState,
} from './session-runner'

type ProgressListener = (sessionId: number) => void
type ThinkingListener = (state: AgentThinkingState) => void

const progressListeners = new Set<ProgressListener>()
const thinkingListeners = new Set<ThinkingListener>()
const thinkingStateBySession = new Map<number, AgentThinkingState>()
const runningSessionsInUi = new Set<number>()

let workerInstance: Worker | null = null
let workerInitFailed = false

function notifyProgress(sessionId: number): void {
  for (const listener of progressListeners) {
    listener(sessionId)
  }
}

function updateThinkingState(state: AgentThinkingState): void {
  if (!state.isThinking) {
    thinkingStateBySession.delete(state.sessionId)
  } else {
    thinkingStateBySession.set(state.sessionId, state)
  }
  for (const listener of thinkingListeners) {
    listener(state)
  }
}

function getOrCreateWorker(): Worker | null {
  if (workerInitFailed || typeof Worker === 'undefined') {
    return null
  }
  if (workerInstance) {
    return workerInstance
  }
  try {
    workerInstance = new Worker(new URL('./agent.worker.ts', import.meta.url), {
      type: 'module',
    })
    workerInstance.onmessage = (event: MessageEvent<WorkerOutboundMessage>) => {
      const msg = event.data
      if (!msg) return
      switch (msg.type) {
        case 'WORKER_READY': {
          trace('worker.bridge.ready')
          syncWorkerEnvironment()
          break
        }
        case 'AGENT_THINKING': {
          updateThinkingState(msg.state)
          break
        }
        case 'AGENT_STEP_UPDATE':
        case 'PROPOSAL_CREATED': {
          notifyProgress(msg.sessionId)
          break
        }
        case 'AGENT_COMPLETED':
        case 'AGENT_ERROR': {
          runningSessionsInUi.delete(msg.sessionId)
          updateThinkingState({
            sessionId: msg.sessionId,
            isThinking: false,
            thought: '',
            phase: 'completed',
            updatedAt: Date.now(),
          })
          notifyProgress(msg.sessionId)
          break
        }
      }
    }
    workerInstance.onerror = (err) => {
      console.warn('[AgentBridge] Web Worker error, falling back to in-process loop:', err)
    }
    return workerInstance
  } catch (err) {
    workerInitFailed = true
    console.warn('[AgentBridge] No se pudo crear el Web Worker, usando modo en hilo:', err)
    return null
  }
}

function postToWorker(msg: WorkerInboundMessage): boolean {
  const worker = getOrCreateWorker()
  if (!worker) return false
  try {
    worker.postMessage(msg)
    return true
  } catch {
    return false
  }
}

/**
 * Synchronizes current `LlmConfig` and `FileSystemDirectoryHandle` with the background Web Worker.
 */
export function syncWorkerEnvironment(): void {
  const config = getLlmConfig()
  postToWorker({ type: 'SYNC_CONFIG', config })
  const handle = getWorkspaceDirectoryHandle()
  if (handle) {
    postToWorker({ type: 'SET_DIRECTORY_HANDLE', handle })
  }
}

export function onAgentProgress(listener: ProgressListener): () => void {
  progressListeners.add(listener)
  return () => progressListeners.delete(listener)
}

export function onAgentThinking(listener: ThinkingListener): () => void {
  thinkingListeners.add(listener)
  return () => thinkingListeners.delete(listener)
}

export function getSessionThinkingState(sessionId: number): AgentThinkingState | undefined {
  return thinkingStateBySession.get(sessionId)
}

export function isSessionRunning(sessionId: number): boolean {
  return runningSessionsInUi.has(sessionId) || isSessionCurrentlyRunning(sessionId)
}

export async function runAgentSessionTurn(
  sessionId: number,
  userPrompt?: string,
): Promise<void> {
  if (isSessionRunning(sessionId)) return

  runningSessionsInUi.add(sessionId)
  syncWorkerEnvironment()

  const sentToWorker = postToWorker({
    type: 'RUN_AGENT_SESSION',
    sessionId,
    prompt: userPrompt,
  })

  if (sentToWorker) {
    return
  }

  // Fallback for environments where Web Worker is unavailable
  try {
    await executeSessionTurn(sessionId, userPrompt, {
      onThinking: (state) => updateThinkingState(state),
      onStepUpdate: (id) => notifyProgress(id),
      onProposalCreated: (sId) => notifyProgress(sId),
    })
  } finally {
    runningSessionsInUi.delete(sessionId)
  }
}

export function cancelAgentSession(sessionId: number): void {
  runningSessionsInUi.delete(sessionId)
  abortRunningSession(sessionId)
  postToWorker({ type: 'CANCEL_SESSION', sessionId })
  updateThinkingState({
    sessionId,
    isThinking: false,
    thought: '',
    phase: 'completed',
    updatedAt: Date.now(),
  })
  notifyProgress(sessionId)
}
