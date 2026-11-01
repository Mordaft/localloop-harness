import { Annotation, END, START, StateGraph } from '@langchain/langgraph'
import { trace } from '../diagnostics'
import { SessionStatus, type SessionStatus as SessionStatusType } from '../enums'
import { executeFileSystemTool, getFileSystemToolSpecs } from '../fs/fs-tools'
import { readWorkspaceFile } from '../fs/workspace-fs'
import {
  procesarNodoScope,
  SlmConcurrencyGate,
  streamChatCompletion,
  type ChatMessage,
  type OpenAiToolSpec,
  type ParsedToolCall,
} from '../llm/llm-client'
import { getLlmConfig } from '../llm/llm-config'
import { callMcpTool, getActiveMcpToolSpecs } from '../mcp/mcp-client'
import { appendSessionMessage, updateSessionMetrics } from '../memory/app-db'
import {
  AgentScopeStorage,
  getPersistentEngram,
  type AgentSkillName,
} from '../memory/engram-memory'
import { getSharedIndexedDBSaver, type IndexedDBSaver } from '../memory/indexeddb-saver'
import { executeSandboxedJs, getSandboxToolSpec } from '../sandbox/code-runner'
import { getSkillById } from './skills-registry'

export interface AgentLoopCallbacks {
  onThinking?: (state: {
    sessionId: number
    thought: string
    phase: 'thinking' | 'executing_tools' | 'completed'
    activeTool?: string
    turnsUsed?: number
    maxTurns?: number
    tokensUsed?: number
  }) => void
  onStepUpdate?: (sessionId: number) => void
  onProposalCreated?: (proposalId: number, path: string) => void
  signal?: AbortSignal
}

const activeCallbacks = new Map<number, AgentLoopCallbacks>()

export function registerSessionCallbacks(sessionId: number, callbacks: AgentLoopCallbacks): void {
  activeCallbacks.set(sessionId, callbacks)
}

export function unregisterSessionCallbacks(sessionId: number): void {
  activeCallbacks.delete(sessionId)
}

function getEngramToolSpecs(): OpenAiToolSpec[] {
  return [
    {
      type: 'function',
      function: {
        name: 'memory_search',
        description:
          'Busca en la memoria episódica persistente (engram-ts / Lunr) de sesiones o sub-scopes anteriores.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Términos de búsqueda full-text.' },
            project: { type: 'string', description: 'Filtro opcional de proyecto o sesión.' },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_get',
        description: 'Recupera el documento completo de una memoria de engram-ts por su ID.',
        parameters: {
          type: 'object',
          properties: {
            id: { type: 'string', description: 'UUID de la memoria en engram-ts.' },
          },
          required: ['id'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'memory_save',
        description:
          'Guarda un hallazgo, decisión arquitectónica o episodio importante en la memoria persistente engram-ts.',
        parameters: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Título descriptivo de la memoria.' },
            type: { type: 'string', description: 'Tipo (ej. decision, hallazgo, resumen).' },
            content: { type: 'string', description: 'Contenido detallado a persistir.' },
            tags: { type: 'array', items: { type: 'string' } },
          },
          required: ['title', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_subagent_scope',
        description:
          'Delega una subtarea compleja o análisis profundo de un archivo a un sub-agente fractal con memoria engram-ts.',
        parameters: {
          type: 'object',
          properties: {
            targetPath: { type: 'string', description: 'Ruta del archivo sobre el que delegar.' },
            taskDescription: { type: 'string', description: 'Instrucción específica para el sub-agente.' },
            skill: {
              type: 'string',
              enum: ['skill_architect', 'skill_coder', 'skill_security', 'skill_general'],
            },
          },
          required: ['targetPath', 'taskDescription'],
        },
      },
    },
  ]
}

export const AgentState = Annotation.Root({
  sessionId: Annotation<number>,
  threadId: Annotation<string>,
  skill: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'skill_general',
  }),
  messages: Annotation<ChatMessage[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  turnsUsed: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  maxTurns: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 12,
  }),
  tokensUsed: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),
  maxTokenBudget: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 64000,
  }),
  pendingToolCalls: Annotation<ParsedToolCall[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),
  requiresHumanConfirmation: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),
  status: Annotation<SessionStatusType>({
    reducer: (curr, next) => next ?? curr,
    default: () => SessionStatus.IDLE,
  }),
})

export type AgentGraphState = typeof AgentState.State

/**
 * Capability 2: Nodo de Decisión (LLM Router)
 */
async function llmRouterNode(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
  const callbacks = activeCallbacks.get(state.sessionId)
  const signal = callbacks?.signal
  if (signal?.aborted) {
    return {
      status: SessionStatus.IDLE,
      pendingToolCalls: [],
    }
  }

  const config = getLlmConfig()
  const skillDef = getSkillById(state.skill)
  const { specs: mcpSpecs } = await getActiveMcpToolSpecs()
  const allTools: OpenAiToolSpec[] = [
    ...getFileSystemToolSpecs(),
    ...getEngramToolSpecs(),
    getSandboxToolSpec(),
    ...mcpSpecs,
  ]

  const systemMessage: ChatMessage = {
    role: 'system',
    content: `${config.systemPrompt}\n\n${skillDef.systemSupplement}\n\n[PRESUPUESTO ACTUAL: Turno ${state.turnsUsed + 1}/${state.maxTurns} | Tokens ${state.tokensUsed}/${state.maxTokenBudget}]`,
  }

  const conversationMessages: ChatMessage[] = [
    systemMessage,
    ...state.messages.filter((m) => m.role !== 'system'),
  ]

  callbacks?.onThinking?.({
    sessionId: state.sessionId,
    thought: `Analizando contexto en turno ${state.turnsUsed + 1}/${state.maxTurns}...`,
    phase: 'thinking',
    turnsUsed: state.turnsUsed,
    maxTurns: state.maxTurns,
    tokensUsed: state.tokensUsed,
  })

  const response = await streamChatCompletion({
    scopeId: `session_${state.sessionId}_turn_${state.turnsUsed + 1}`,
    messages: conversationMessages,
    tools: allTools,
    toolChoice: 'auto',
    onThinking: (thought) => {
      callbacks?.onThinking?.({
        sessionId: state.sessionId,
        thought,
        phase: 'thinking',
        turnsUsed: state.turnsUsed + 1,
        maxTurns: state.maxTurns,
        tokensUsed: state.tokensUsed,
      })
    },
    signal,
  })

  const nextTurns = state.turnsUsed + 1
  const nextTokens = state.tokensUsed + response.estimatedTokens

  const assistantMsg: ChatMessage = {
    role: 'assistant',
    content: response.contentBuffer || (response.toolCalls.length > 0 ? '' : 'Tarea completada.'),
    thought: response.thoughtBuffer || undefined,
    ...(response.toolCalls.length > 0
      ? {
          tool_calls: response.toolCalls.map((tc) => ({
            id: tc.id,
            type: 'function' as const,
            function: {
              name: tc.name,
              arguments: tc.argumentsRaw || JSON.stringify(tc.args),
            },
          })),
        }
      : {}),
  }

  if (assistantMsg.content || assistantMsg.thought || response.toolCalls.length === 0) {
    await appendSessionMessage({
      sessionId: state.sessionId,
      role: 'assistant',
      content:
        assistantMsg.content ||
        `Invocando ${response.toolCalls.map((tc) => tc.name).join(', ')}...`,
      thought: assistantMsg.thought,
    })
  }

  const nextStatus =
    response.toolCalls.length > 0 ? SessionStatus.RUNNING : SessionStatus.COMPLETED

  await updateSessionMetrics(state.sessionId, {
    status: nextStatus,
    turnsUsed: nextTurns,
    tokensUsed: nextTokens,
    model: config.model,
  })
  callbacks?.onStepUpdate?.(state.sessionId)

  return {
    messages: [...state.messages, assistantMsg],
    turnsUsed: nextTurns,
    tokensUsed: nextTokens,
    pendingToolCalls: response.toolCalls,
    status: nextStatus,
  }
}

/**
 * Capability 3: Nodo Ejecutor (Tool Runtime)
 */
async function toolRuntimeNode(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
  const callbacks = activeCallbacks.get(state.sessionId)
  const signal = callbacks?.signal
  const config = getLlmConfig()
  const engram = getPersistentEngram()
  const { registry: mcpRegistry } = await getActiveMcpToolSpecs()

  const newToolMessages: ChatMessage[] = []
  let anyRequiresHumanConfirmation = state.requiresHumanConfirmation

  for (const tc of state.pendingToolCalls) {
    if (signal?.aborted) break

    callbacks?.onThinking?.({
      sessionId: state.sessionId,
      thought: `Ejecutando herramienta ${tc.name}...`,
      phase: 'executing_tools',
      activeTool: tc.name,
      turnsUsed: state.turnsUsed,
      maxTurns: state.maxTurns,
      tokensUsed: state.tokensUsed,
    })

    let toolResultContent = ''
    try {
      if (tc.name.startsWith('fs_')) {
        const res = await executeFileSystemTool(tc.name, tc.args, {
          sessionId: state.sessionId,
          fsWriteMode: config.fsWriteMode,
          onProposalCreated: (proposalId, path) => {
            callbacks?.onProposalCreated?.(proposalId, path)
          },
        })
        toolResultContent = res.output
        if (res.requiresHumanConfirmation) {
          anyRequiresHumanConfirmation = true
        }
      } else if (tc.name === 'memory_search') {
        const query = String(tc.args.query ?? '')
        const project = typeof tc.args.project === 'string' ? tc.args.project : undefined
        const results = await engram.search({ query, project, limit: 10 })
        toolResultContent = JSON.stringify({
          count: results.length,
          results: results.map((r) => ({
            id: r.header.id,
            title: r.header.title,
            type: r.header.type,
            project: r.header.project,
            tags: r.header.tags,
            score: r.score,
          })),
        })
      } else if (tc.name === 'memory_get') {
        const id = String(tc.args.id ?? '')
        const doc = await engram.getById(id)
        toolResultContent = JSON.stringify(doc ?? { error: 'Memoria no encontrada' })
      } else if (tc.name === 'memory_save') {
        const title = String(tc.args.title ?? 'Memoria de agente')
        const type = String(tc.args.type ?? 'episodic')
        const content = String(tc.args.content ?? '')
        const tags = Array.isArray(tc.args.tags) ? tc.args.tags.map(String) : ['agent-memory']
        const header = await engram.save({
          title,
          type,
          project: `session-${state.sessionId}`,
          tags,
          records: [{ title: 'contenido', content, tags }],
        })
        toolResultContent = JSON.stringify({
          status: 'saved',
          memoryId: header.id,
          title: header.title,
        })
      } else if (tc.name === 'run_sandboxed_js') {
        const code = String(tc.args.code ?? '')
        const timeoutMs = typeof tc.args.timeoutMs === 'number' ? tc.args.timeoutMs : 3000
        const sandboxRes = await executeSandboxedJs(code, timeoutMs)
        toolResultContent = JSON.stringify(sandboxRes)
      } else if (tc.name === 'delegate_subagent_scope') {
        const targetPath = String(tc.args.targetPath ?? 'workspace')
        const taskDescription = String(tc.args.taskDescription ?? 'Analizar módulo')
        const skill = (tc.args.skill as AgentSkillName) ?? 'skill_general'
        let codeContent = ''
        try {
          const readRes = await readWorkspaceFile(targetPath)
          codeContent = readRes.content
        } catch {
          codeContent = ''
        }
        const rootScopeId = `subagent_${targetPath.replace(/[^a-zA-Z0-9_.-]/g, '_')}`
        const storage = new AgentScopeStorage({
          engram,
          project: `session-${state.sessionId}`,
          filePath: targetPath,
          scopeId: rootScopeId,
        })
        const scopeRes = await procesarNodoScope(
          {
            id_subtarea: rootScopeId,
            descripcion: taskDescription,
            skill_requerida: skill,
            targetPath,
          },
          storage,
          {
            targetPath,
            codeContent,
            baseInstructions: config.systemPrompt,
            maxDepth: config.maxDepth,
            maxConcurrency: config.maxConcurrency,
            concurrencyGate: new SlmConcurrencyGate(config.maxConcurrency),
            onThinking: (thought) => {
              callbacks?.onThinking?.({
                sessionId: state.sessionId,
                thought,
                phase: 'thinking',
                activeTool: 'delegate_subagent_scope',
              })
            },
            signal,
          },
          true,
        )
        toolResultContent = JSON.stringify({
          scopeId: scopeRes.id_scope,
          engramRef: scopeRes.engram_ref,
          summary: scopeRes.sumario_ejecutivo,
          findings: scopeRes.findings,
          fromMemoryCache: scopeRes.fromMemoryCache,
        })
      } else if (mcpRegistry.has(tc.name)) {
        const mcpTool = mcpRegistry.get(tc.name)!
        toolResultContent = await callMcpTool(mcpTool, tc.args)
      } else {
        toolResultContent = JSON.stringify({ error: `Herramienta no reconocida: ${tc.name}` })
      }
    } catch (err) {
      toolResultContent = JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      })
    }

    const toolMsg: ChatMessage = {
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.name,
      content: toolResultContent,
    }
    newToolMessages.push(toolMsg)

    await appendSessionMessage({
      sessionId: state.sessionId,
      role: 'tool',
      toolName: tc.name,
      toolCallId: tc.id,
      content: toolResultContent.slice(0, 1200),
    })
    callbacks?.onStepUpdate?.(state.sessionId)
  }

  return {
    messages: [...state.messages, ...newToolMessages],
    pendingToolCalls: [],
    requiresHumanConfirmation: anyRequiresHumanConfirmation,
  }
}

/**
 * Capability 4: Turn / Token Budget Halt Node (Infinite Loop Protection)
 */
async function haltBudgetExceededNode(state: AgentGraphState): Promise<Partial<AgentGraphState>> {
  const callbacks = activeCallbacks.get(state.sessionId)
  const reason =
    state.turnsUsed >= state.maxTurns
      ? `Se alcanzó el límite máximo de turnos permitidos (${state.turnsUsed}/${state.maxTurns}).`
      : `Se superó el presupuesto máximo de tokens (${state.tokensUsed}/${state.maxTokenBudget}).`

  const haltMessage = `⚠️ [Budget Edge Protection] ${reason} El grafo ha detenido el ciclo de forma segura y ha persistido su checkpoint en IndexedDB.`

  trace('agent.budget.halt', {
    sessionId: state.sessionId,
    turnsUsed: state.turnsUsed,
    maxTurns: state.maxTurns,
    tokensUsed: state.tokensUsed,
    maxTokenBudget: state.maxTokenBudget,
  })

  await appendSessionMessage({
    sessionId: state.sessionId,
    role: 'assistant',
    content: haltMessage,
  })

  await updateSessionMetrics(state.sessionId, {
    status: SessionStatus.BUDGET_EXCEEDED,
    turnsUsed: state.turnsUsed,
    tokensUsed: state.tokensUsed,
  })
  callbacks?.onStepUpdate?.(state.sessionId)

  return {
    messages: [
      ...state.messages,
      {
        role: 'assistant',
        content: haltMessage,
      },
    ],
    pendingToolCalls: [],
    status: SessionStatus.BUDGET_EXCEEDED,
  }
}

/**
 * Capability 4: Conditional Edge evaluating turn/token budget on every cycle.
 */
export function routeAfterLlmRouter(
  state: AgentGraphState,
): 'tool_runtime' | 'halt_budget_exceeded' | typeof END {
  if (!state.pendingToolCalls || state.pendingToolCalls.length === 0) {
    return END
  }
  if (state.turnsUsed >= state.maxTurns || state.tokensUsed >= state.maxTokenBudget) {
    return 'halt_budget_exceeded'
  }
  return 'tool_runtime'
}

export function createAgentWorkflow(customCheckpointer?: IndexedDBSaver) {
  const graph = new StateGraph(AgentState)
    .addNode('llm_router', llmRouterNode)
    .addNode('tool_runtime', toolRuntimeNode)
    .addNode('halt_budget_exceeded', haltBudgetExceededNode)
    .addEdge(START, 'llm_router')
    .addConditionalEdges('llm_router', routeAfterLlmRouter, {
      tool_runtime: 'tool_runtime',
      halt_budget_exceeded: 'halt_budget_exceeded',
      [END]: END,
    })
    .addEdge('tool_runtime', 'llm_router')
    .addEdge('halt_budget_exceeded', END)

  return graph.compile({
    checkpointer: customCheckpointer ?? getSharedIndexedDBSaver(),
  })
}

export const defaultAgentWorkflow = createAgentWorkflow()
