import { setWorkspaceDirectoryHandle } from '../fs/workspace-fs'
import { setWorkerLlmConfig, type LlmConfig } from '../llm/llm-config'
import {
  setWorkerBrowserSandboxDispatcher,
  type BrowserSandboxOptions,
  type BrowserSandboxResult,
} from '../sandbox/browser-sandbox'
import {
  abortRunningSession,
  executeSessionTurn,
  type AgentThinkingState,
} from './session-runner'

export type WorkerInboundMessage =
  | { type: 'SYNC_CONFIG'; config: LlmConfig }
  | { type: 'SET_DIRECTORY_HANDLE'; handle?: FileSystemDirectoryHandle }
  | { type: 'RUN_AGENT_SESSION'; sessionId: number; prompt?: string }
  | { type: 'CANCEL_SESSION'; sessionId: number }
  | { type: 'BROWSER_SANDBOX_RESPONSE'; requestId: string; result: BrowserSandboxResult }

export type WorkerOutboundMessage =
  | { type: 'WORKER_READY' }
  | { type: 'AGENT_THINKING'; state: AgentThinkingState }
  | { type: 'AGENT_STEP_UPDATE'; sessionId: number }
  | { type: 'PROPOSAL_CREATED'; sessionId: number; proposalId: number; path: string }
  | { type: 'AGENT_COMPLETED'; sessionId: number; status: number | string }
  | { type: 'AGENT_ERROR'; sessionId: number; error: string }
  | { type: 'BROWSER_SANDBOX_REQUEST'; requestId: string; options: BrowserSandboxOptions }

const pendingSandboxRequests = new Map<
  string,
  { resolve: (res: BrowserSandboxResult) => void; timer: ReturnType<typeof setTimeout> }
>()

function postOut(msg: WorkerOutboundMessage): void {
  self.postMessage(msg)
}

setWorkerBrowserSandboxDispatcher((options: BrowserSandboxOptions) => {
  const requestId =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `worker_sbx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  const timeoutMs = Math.min(15000, Math.max(500, (options.timeoutMs ?? 5000) + 1500))

  return new Promise<BrowserSandboxResult>((resolve) => {
    const timer = setTimeout(() => {
      pendingSandboxRequests.delete(requestId)
      resolve({
        ok: false,
        logs: [],
        error: `Timeout esperando respuesta del Browser Iframe Sandbox en hilo principal (${timeoutMs}ms).`,
        dom: {
          title: 'Timeout',
          html: options.html ?? '',
          text: '',
          queriedElements: [],
        },
        durationMs: timeoutMs,
      })
    }, timeoutMs)

    pendingSandboxRequests.set(requestId, { resolve, timer })
    postOut({ type: 'BROWSER_SANDBOX_REQUEST', requestId, options })
  })
})

self.onmessage = async (event: MessageEvent<WorkerInboundMessage>) => {
  const data = event.data
  if (!data || typeof data !== 'object') return

  switch (data.type) {
    case 'SYNC_CONFIG': {
      setWorkerLlmConfig(data.config)
      break
    }
    case 'SET_DIRECTORY_HANDLE': {
      setWorkspaceDirectoryHandle(data.handle)
      break
    }
    case 'CANCEL_SESSION': {
      abortRunningSession(data.sessionId)
      break
    }
    case 'BROWSER_SANDBOX_RESPONSE': {
      const pending = pendingSandboxRequests.get(data.requestId)
      if (pending) {
        clearTimeout(pending.timer)
        pendingSandboxRequests.delete(data.requestId)
        pending.resolve(data.result)
      }
      break
    }
    case 'RUN_AGENT_SESSION': {
      const { sessionId, prompt } = data
      try {
        const status = await executeSessionTurn(sessionId, prompt, {
          onThinking: (state) => postOut({ type: 'AGENT_THINKING', state }),
          onStepUpdate: (id) => postOut({ type: 'AGENT_STEP_UPDATE', sessionId: id }),
          onProposalCreated: (sId, proposalId, path) =>
            postOut({ type: 'PROPOSAL_CREATED', sessionId: sId, proposalId, path }),
        })
        postOut({ type: 'AGENT_COMPLETED', sessionId, status })
      } catch (err) {
        postOut({
          type: 'AGENT_ERROR',
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        })
      }
      break
    }
  }
}

postOut({ type: 'WORKER_READY' })
