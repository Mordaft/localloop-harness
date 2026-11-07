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
  type ScopeTaskDefinition,
} from '../memory/engram-memory'
import { getSharedIndexedDBSaver, type IndexedDBSaver } from '../memory/indexeddb-saver'
import {
  executeBrowserSandbox,
  executeSandboxedJs,
  getBrowserSandboxToolSpec,
  getSandboxToolSpec,
} from '../sandbox/code-runner'
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
  onStreamChunk?: (chunk: {
    sessionId: number
    contentSoFar: string
    delta: string
    thought?: string
    phase?: string
  }) => void
  onStepUpdate?: (sessionId: number) => void
  onProposalCreated?: (proposalId: number, path: string) => void
  signal?: AbortSignal
}

const activeCallbacks = new Map<number, AgentLoopCallbacks>()

export function registerSessionCallbacks(sessionId: number, callbacks: AgentLoopCallbacks): void {
  activeCallbacks.set(sessionId, callbacks)
}

export function getSessionCallbacks(sessionId: number): AgentLoopCallbacks | undefined {
  return activeCallbacks.get(sessionId)
}

export function unregisterSessionCallbacks(sessionId: number): void {
  activeCallbacks.delete(sessionId)
}

export function getEngramToolSpecs(): OpenAiToolSpec[] {
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
        name: 'plan_and_delegate_tasks',
        description:
          'OBLIGATORIO para abordar cualquier trabajo: crea una lista de tareas donde cada tarea es aquello para lo que podemos definir una prueba de aceptación (acceptanceTest / prueba_aceptacion). Cada elemento de la lista se pasa automáticamente a un sub-agente independiente, que entregará la tarea realizada, la prueba automatizada implementada y la evidencia de ejecución.',
        parameters: {
          type: 'object',
          properties: {
            workGoal: {
              type: 'string',
              description: 'Objetivo general del trabajo a descomponer.',
            },
            tasks: {
              type: 'array',
              minItems: 1,
              description:
                'Lista obligatoria de tareas verificables; cada elemento se delega a un sub-agente.',
              items: {
                type: 'object',
                properties: {
                  id: { type: 'string', description: 'Identificador único de la tarea.' },
                  description: {
                    type: 'string',
                    description: 'Descripción concreta de la tarea a realizar.',
                  },
                  acceptanceTest: {
                    type: 'string',
                    description:
                      'OBLIGATORIO: Definición de la prueba de aceptación que valida empíricamente esta tarea.',
                  },
                  targetPath: {
                    type: 'string',
                    description: 'Ruta del archivo principal afectado (opcional).',
                  },
                  skill: {
                    type: 'string',
                    enum: ['skill_architect', 'skill_coder', 'skill_security', 'skill_general'],
                  },
                },
                required: ['id', 'description', 'acceptanceTest'],
              },
            },
          },
          required: ['tasks'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'delegate_subagent_scope',
        description:
          'Delega una tarea o módulo a un árbol de sub-agentes fractales con memoria engram-ts. El sub-agente raíz descompondrá el trabajo en una lista de tareas con pruebas de aceptación y cada sub-agente hoja entregará tarea_realizada, prueba_automatizada y evidencia_prueba.',
        parameters: {
          type: 'object',
          properties: {
            targetPath: { type: 'string', description: 'Ruta del archivo sobre el que delegar.' },
            taskDescription: {
              type: 'string',
              description: 'Instrucción específica para el sub-agente.',
            },
            acceptanceTest: {
              type: 'string',
              description:
                'Prueba de aceptación que define y valida el cumplimiento de la tarea.',
            },
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
  taskPlanCreated: Annotation<boolean>({
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
    getBrowserSandboxToolSpec(),
    ...mcpSpecs,
  ]

  const hasTaskPlan =
    Boolean(state.taskPlanCreated) ||
    state.messages.some(
      (m) =>
        m.role === 'tool' &&
        (m.name === 'plan_and_delegate_tasks' || m.name === 'delegate_subagent_scope'),
    )

  const prePlanDiscoveryNames = new Set([
    'plan_and_delegate_tasks',
    'delegate_subagent_scope',
    'fs_list_dir',
    'fs_read_file',
    'fs_search',
    'memory_search',
    'memory_get',
  ])
  const strictPlanOnlyNames = new Set(['plan_and_delegate_tasks', 'delegate_subagent_scope'])

  const activeTools = hasTaskPlan
    ? allTools.filter((t) => !strictPlanOnlyNames.has(t.function.name))
    : state.turnsUsed === 0
      ? allTools.filter((t) => prePlanDiscoveryNames.has(t.function.name))
      : allTools.filter((t) => strictPlanOnlyNames.has(t.function.name))

  const activeToolChoice: 'auto' | 'required' = hasTaskPlan ? 'auto' : 'required'

  const mandatoryDecompositionReminder = hasTaskPlan
    ? '\n\n[FASE DE CONSOLIDACIÓN Y ENTREGA]: La descomposición en lista de tareas y la ejecución de los sub-agentes con sus pruebas de aceptación ya han finalizado. NO vuelvas a descomponer ni planificar. Usa los entregables recibidos (tarea_realizada, prueba_automatizada y evidencia_prueba) para aplicar cambios en archivos con "fs_write_file" si corresponde, o redacta directamente la respuesta final completa para el usuario sin invocar más herramientas.'
    : '\n\n[OBLIGATORIO - REGLA DE DESCOMPOSICIÓN POR PRUEBAS]: Siempre es obligatorio crear una lista de tareas antes de realizar un trabajo. Una tarea es aquello para lo que podemos definir una prueba de aceptación. Invoca "plan_and_delegate_tasks" (o "delegate_subagent_scope") indicando la lista de tareas y la prueba de aceptación ("acceptanceTest") de cada elemento para que cada tarea pase a un sub-agente.'

  const systemMessage: ChatMessage = {
    role: 'system',
    content: `${config.systemPrompt}\n\n${skillDef.systemSupplement}${mandatoryDecompositionReminder}\n\n[PRESUPUESTO ACTUAL: Turno ${state.turnsUsed + 1}/${state.maxTurns} | Tokens ${state.tokensUsed}/${state.maxTokenBudget}]`,
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
    tools: activeTools,
    toolChoice: activeToolChoice,
    onThinking: (thought) => {
      callbacks?.onThinking?.({
        sessionId: state.sessionId,
        thought,
        phase: 'thinking',
        turnsUsed: state.turnsUsed + 1,
        maxTurns: state.maxTurns,
        tokensUsed: state.tokensUsed,
      })
      callbacks?.onStreamChunk?.({
        sessionId: state.sessionId,
        contentSoFar: '',
        delta: '',
        thought,
        phase: 'Pensando',
      })
    },
    onContentDelta: (contentSoFar, delta) => {
      callbacks?.onStreamChunk?.({
        sessionId: state.sessionId,
        contentSoFar,
        delta,
        thought: undefined,
        phase: 'Generando respuesta',
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
  let taskPlanCreated = Boolean(state.taskPlanCreated)

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
      } else if (tc.name === 'run_browser_sandbox') {
        const browserRes = await executeBrowserSandbox({
          html: typeof tc.args.html === 'string' ? tc.args.html : undefined,
          css: typeof tc.args.css === 'string' ? tc.args.css : undefined,
          code: typeof tc.args.code === 'string' ? tc.args.code : undefined,
          domSelector: typeof tc.args.domSelector === 'string' ? tc.args.domSelector : undefined,
          selectors: Array.isArray(tc.args.selectors) ? tc.args.selectors.map(String) : undefined,
          captureScreenshot:
            typeof tc.args.captureScreenshot === 'boolean' ? tc.args.captureScreenshot : true,
          viewportWidth:
            typeof tc.args.viewportWidth === 'number' ? tc.args.viewportWidth : undefined,
          viewportHeight:
            typeof tc.args.viewportHeight === 'number' ? tc.args.viewportHeight : undefined,
          timeoutMs: typeof tc.args.timeoutMs === 'number' ? tc.args.timeoutMs : undefined,
        })
        toolResultContent = JSON.stringify(browserRes)
      } else if (tc.name === 'plan_and_delegate_tasks') {
        const workGoal = String(
          tc.args.workGoal ??
            tc.args.justificacion ??
            tc.args.description ??
            tc.args.descripcion ??
            'Plan de tareas con pruebas de aceptación',
        )
        const rawTasks = Array.isArray(tc.args.tasks)
          ? tc.args.tasks
          : Array.isArray(tc.args.subtareas)
            ? tc.args.subtareas
            : Array.isArray(tc.args.tareas)
              ? tc.args.tareas
              : Array.isArray(tc.args.lista_tareas)
                ? tc.args.lista_tareas
                : Array.isArray(tc.args.items)
                  ? tc.args.items
                  : []

        const normalizedTasks: ScopeTaskDefinition[] = rawTasks.flatMap(
          (item, idx): ScopeTaskDefinition[] => {
            if (!item || typeof item !== 'object') return []
            const raw = item as Record<string, unknown>
            const id =
              typeof raw.id === 'string' && raw.id.trim()
                ? raw.id.trim()
                : typeof raw.id_subtarea === 'string' && raw.id_subtarea.trim()
                  ? raw.id_subtarea.trim()
                  : `task_${idx + 1}`
            const desc =
              typeof raw.description === 'string' && raw.description.trim()
                ? raw.description.trim()
                : typeof raw.descripcion === 'string' && raw.descripcion.trim()
                  ? raw.descripcion.trim()
                  : `${workGoal} #${idx + 1}`
            const acceptance =
              typeof raw.acceptanceTest === 'string' && raw.acceptanceTest.trim()
                ? raw.acceptanceTest.trim()
                : typeof raw.prueba_aceptacion === 'string' && raw.prueba_aceptacion.trim()
                  ? raw.prueba_aceptacion.trim()
                  : `Verificar mediante prueba automatizada: ${desc}`
            const targetPath =
              typeof raw.targetPath === 'string' && raw.targetPath.trim()
                ? raw.targetPath.trim()
                : 'workspace'
            const skill =
              (raw.skill as AgentSkillName) ??
              (raw.skill_requerida as AgentSkillName) ??
              'skill_coder'

            return [
              {
                id_subtarea: id,
                descripcion: desc,
                prueba_aceptacion: acceptance,
                targetPath,
                skill_requerida: skill,
                requiere_sub_planificacion:
                  typeof raw.requiere_sub_planificacion === 'boolean'
                    ? raw.requiere_sub_planificacion
                    : false,
              },
            ]
          },
        )

        if (normalizedTasks.length === 0) {
          const fallbackDesc =
            typeof tc.args.description === 'string' && tc.args.description.trim()
              ? tc.args.description.trim()
              : typeof tc.args.descripcion === 'string' && tc.args.descripcion.trim()
                ? tc.args.descripcion.trim()
                : workGoal
          const fallbackAcceptance =
            typeof tc.args.acceptanceTest === 'string' && tc.args.acceptanceTest.trim()
              ? tc.args.acceptanceTest.trim()
              : typeof tc.args.prueba_aceptacion === 'string' && tc.args.prueba_aceptacion.trim()
                ? tc.args.prueba_aceptacion.trim()
                : `Verificar mediante prueba automatizada: ${fallbackDesc}`
          normalizedTasks.push({
            id_subtarea: 'task_1',
            descripcion: fallbackDesc,
            prueba_aceptacion: fallbackAcceptance,
            targetPath:
              typeof tc.args.targetPath === 'string' && tc.args.targetPath.trim()
                ? tc.args.targetPath.trim()
                : 'workspace',
            skill_requerida: (tc.args.skill as AgentSkillName) ?? 'skill_coder',
            requiere_sub_planificacion: false,
          })
        }

        const rootScopeId = `task_plan_session_${state.sessionId}_${Date.now()}`
        const rootStorage = new AgentScopeStorage({
          engram,
          project: `session-${state.sessionId}`,
          filePath: normalizedTasks[0].targetPath ?? 'workspace',
          scopeId: rootScopeId,
        })

        await rootStorage.saveSubPlan(normalizedTasks, workGoal)
        const gate = new SlmConcurrencyGate(config.maxConcurrency)

        const subagentResults = await Promise.all(
          normalizedTasks.map(async (subTask) => {
            const targetPath = subTask.targetPath ?? 'workspace'
            let codeContent = ''
            try {
              const readRes = await readWorkspaceFile(targetPath)
              codeContent = readRes.content
            } catch {
              codeContent = ''
            }
            return procesarNodoScope(
              subTask,
              rootStorage,
              {
                targetPath,
                codeContent,
                baseInstructions: config.systemPrompt,
                maxDepth: config.maxDepth,
                maxConcurrency: config.maxConcurrency,
                concurrencyGate: gate,
                onThinking: (thought) => {
                  callbacks?.onThinking?.({
                    sessionId: state.sessionId,
                    thought,
                    phase: 'thinking',
                    activeTool: 'plan_and_delegate_tasks',
                  })
                },
                signal,
              },
              false,
            )
          }),
        )

        taskPlanCreated = true
        toolResultContent = JSON.stringify({
          status: 'task_list_delegated_and_completed',
          workGoal,
          totalTasks: subagentResults.length,
          subagentDeliverables: subagentResults.map((res, idx) => ({
            taskId: normalizedTasks[idx].id_subtarea,
            description: normalizedTasks[idx].descripcion,
            acceptanceTest: normalizedTasks[idx].prueba_aceptacion,
            scopeId: res.id_scope,
            engramRef: res.engram_ref,
            summary: res.sumario_ejecutivo,
            atomicDeliverable: res.entregable_atomico,
            nestedSubagentDeliverables: res.entregables_subagentes,
          })),
        })
      } else if (tc.name === 'delegate_subagent_scope') {
        const targetPath = String(tc.args.targetPath ?? 'workspace')
        const taskDescription = String(tc.args.taskDescription ?? 'Analizar módulo')
        const acceptanceTest =
          typeof tc.args.acceptanceTest === 'string' && tc.args.acceptanceTest.trim()
            ? tc.args.acceptanceTest.trim()
            : typeof tc.args.prueba_aceptacion === 'string' && tc.args.prueba_aceptacion.trim()
              ? tc.args.prueba_aceptacion.trim()
              : `Verificar mediante prueba automatizada: ${taskDescription}`
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
            prueba_aceptacion: acceptanceTest,
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
        taskPlanCreated = true
        toolResultContent = JSON.stringify({
          scopeId: scopeRes.id_scope,
          engramRef: scopeRes.engram_ref,
          summary: scopeRes.sumario_ejecutivo,
          findings: scopeRes.findings,
          fromMemoryCache: scopeRes.fromMemoryCache,
          atomicDeliverable: scopeRes.entregable_atomico,
          subagentDeliverables: scopeRes.entregables_subagentes,
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

    const sanitizedToolResultContent = toolResultContent.replace(
      /"data:image\/[^";]+;base64,[A-Za-z0-9+/=]{120,}"/g,
      '"data:image/png;base64,[captura_disponible_en_inspector_ui]"',
    )

    const toolMsg: ChatMessage = {
      role: 'tool',
      tool_call_id: tc.id,
      name: tc.name,
      content: sanitizedToolResultContent,
    }
    newToolMessages.push(toolMsg)

    await appendSessionMessage({
      sessionId: state.sessionId,
      role: 'tool',
      toolName: tc.name,
      toolCallId: tc.id,
      content: sanitizedToolResultContent.slice(0, 1200),
    })
    callbacks?.onStepUpdate?.(state.sessionId)
  }

  return {
    messages: [...state.messages, ...newToolMessages],
    pendingToolCalls: [],
    requiresHumanConfirmation: anyRequiresHumanConfirmation,
    taskPlanCreated,
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
