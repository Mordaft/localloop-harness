import { setWorkspaceDirectoryHandle } from '../fs/workspace-fs'
import { setWorkerLlmConfig, type LlmConfig } from '../llm/llm-config'
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

export type WorkerOutboundMessage =
  | { type: 'WORKER_READY' }
  | { type: 'AGENT_THINKING'; state: AgentThinkingState }
  | { type: 'AGENT_STEP_UPDATE'; sessionId: number }
  | { type: 'PROPOSAL_CREATED'; sessionId: number; proposalId: number; path: string }
  | { type: 'AGENT_COMPLETED'; sessionId: number; status: number | string }
  | { type: 'AGENT_ERROR'; sessionId: number; error: string }

function postOut(msg: WorkerOutboundMessage): void {
  self.postMessage(msg)
}

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
