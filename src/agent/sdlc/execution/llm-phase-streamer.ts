import { trace } from '../../../diagnostics'
import { getActiveWorkspaceName, readWorkspaceFile, writeWorkspaceFileDirect } from '../../../fs/workspace-fs'
import { executeFileSystemTool, getFileSystemToolSpecs } from '../../../fs/fs-tools'
import {
  executeBrowserSandbox,
  executeSandboxedJs,
  extractCleanSourceCode,
  getSandboxToolSpec,
  isValidSourceCodeForPath,
} from '../../../sandbox/code-runner'
import {
  AgentScopeStorage,
  getPersistentEngram,
  retrieveEngramMemoryContext,
  saveEpisodicTurnMemory,
  type AgentSkillName,
  type ScopeTaskDefinition,
} from '../../../memory/engram-memory'
import { executeWebGuidanceTool, getWebGuidanceToolSpecs } from '../../../memory/web-guidance-manager'
import {
  SlmConcurrencyGate,
  procesarNodoScope,
  streamChatCompletion,
  type ChatMessage,
  type OpenAiToolSpec,
  type ParsedToolCall,
} from '../../../llm/llm-client'
import { getLlmConfig } from '../../../llm/llm-config'
import { getEngramToolSpecs, getSessionCallbacks } from '../../agent-graph'
import { appendSessionMessage } from '../../../memory/app-db'
import {
  callMcpTool,
  findCliExecutionTool,
  getMcpToolsForRole,
  ROLE_CAPABILITY_MATRIX,
} from '../../../mcp/mcp-client'
import { FsWriteMode } from '../../../enums'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import type { SdlcPhase } from '../../sdlc-state'

export const ITERATIVE_QUERY_TOOLS = new Set([
  'search_web_guidance',
  'read_web_guidance_doc',
  'engram_search',
  'memory_search',
  'memory_get',
  'fs_read_file',
  'fs_list_dir',
  'fs_list_files',
  'fs_search',
  'plan_and_delegate_tasks',
  'delegate_subagent_scope',
])

let globalRequireLiveLlm = false

export function setRequireLiveLlm(enabled: boolean): void {
  globalRequireLiveLlm = enabled
}

export function getRequireLiveLlm(): boolean {
  return globalRequireLiveLlm
}

export interface SubagentComponentDeliverable {
  taskId: string
  targetPath: string
  code: string
  testCode: string
  summary: string
}

export const PHASE_DEFAULT_ROLE_MAP: Partial<Record<SdlcPhase, string>> = {
  '0_DISCOVERY_RIGOR': 'ProjectRigor_Interviewer',
  '1_STRATEGY_AND_PLAN': 'GovernanceProject_Planner',
  '2_TECHNICAL_DESIGN_GATE': 'ComponentTechnical_Designer',
  '3_COMPONENT_CONSTRUCTION': 'Component_Implementer',
  '4_E2E_BUSINESS_AUDIT': 'E2EAutomation_Runner',
  '5_STRATEGIC_RESILIENCE': 'RootCause_Analyzer',
  '6_DOCUMENTATION_PROJECTION': 'ProjectProgress_Projector',
}

export function inferRoleIdForPhase(phaseName: string, sdlcPhase?: SdlcPhase, explicitRoleId?: string): string {
  if (explicitRoleId) return explicitRoleId
  for (const profile of ROLE_CAPABILITY_MATRIX) {
    if (phaseName.includes(profile.roleId)) {
      return profile.roleId
    }
  }
  const skillBracket = phaseName.match(/\[Skill:\s*([^\]]+)\]/i)
  if (skillBracket?.[1]) {
    const matched = ROLE_CAPABILITY_MATRIX.find(
      (r) =>
        r.roleId.toLowerCase() === skillBracket[1].trim().toLowerCase() ||
        r.description.toLowerCase().includes(skillBracket[1].trim().toLowerCase()),
    )
    if (matched) return matched.roleId
  }
  if (sdlcPhase && PHASE_DEFAULT_ROLE_MAP[sdlcPhase]) {
    return PHASE_DEFAULT_ROLE_MAP[sdlcPhase]!
  }
  return 'skill_general'
}

export async function streamLlmPhase(params: {
  sessionId: number | undefined
  phaseName: string
  sdlcPhase?: SdlcPhase
  roleId?: string
  systemPrompt: string
  userPrompt: string
  tools?: OpenAiToolSpec[]
  toolChoice?: 'auto' | 'required' | 'none'
  maxToolIterations?: number
  requireLiveLlm?: boolean
  defaultFallback: () => { content: string; thought?: string }
}): Promise<{
  content: string
  thought?: string
  toolCalls: ParsedToolCall[]
  subagentDeliverables: SubagentComponentDeliverable[]
  usedFallback?: boolean
  tokenUsage: {
    promptTokens: number
    completionTokens: number
    totalTokens: number
  }
}> {
  const { sessionId, phaseName, sdlcPhase, systemPrompt, userPrompt, defaultFallback } = params
  const callbacks = sessionId ? getSessionCallbacks(sessionId) : undefined
  const config = getLlmConfig()
  const maxToolIterations = Math.min(6, Math.max(1, params.maxToolIterations ?? 4))
  const mustUseLiveLlm = Boolean(
    params.requireLiveLlm ?? callbacks?.requireLiveLlm ?? globalRequireLiveLlm,
  )

  const effectiveRoleId = inferRoleIdForPhase(phaseName, sdlcPhase, params.roleId)
  const mcpAuthContext = {
    agentId: sessionId ? `localloop-session-${sessionId}` : 'localloop-sdlc-agent',
    agentName: `LocalLoop (${effectiveRoleId})`,
    workspace: getActiveWorkspaceName() || '',
    onAuthStatus: (msg: string) => {
      if (callbacks && sessionId) {
        callbacks.onThinking?.({
          sessionId,
          thought: msg,
          phase: 'thinking',
          sdlcPhase,
        })
      }
    },
  }
  const mcpReport = await RuntimeSkillLoader.syncMcpCapabilities({
    authContext: mcpAuthContext,
  })
  const roleMcp = getMcpToolsForRole(effectiveRoleId)

  const defaultTools: OpenAiToolSpec[] = [
    ...getFileSystemToolSpecs(),
    getSandboxToolSpec(),
    ...getEngramToolSpecs(),
    ...getWebGuidanceToolSpecs(),
  ]
  const baseTools = params.tools ? [...params.tools] : [...defaultTools]
  const publishedToolNames = new Set(baseTools.map((t) => t.function.name))
  for (const mcpSpec of roleMcp.specs) {
    if (!publishedToolNames.has(mcpSpec.function.name)) {
      baseTools.push(mcpSpec)
      publishedToolNames.add(mcpSpec.function.name)
    }
  }
  const publishedTools = baseTools

  let enrichedSystemPrompt = systemPrompt
  if (
    roleMcp.promptSupplement &&
    !enrichedSystemPrompt.includes('[CAPACIDADES MCP ASIGNADAS DINÁMICAMENTE A TU ROL]')
  ) {
    enrichedSystemPrompt += roleMcp.promptSupplement
  }
  if (sessionId) {
    try {
      const memoryContext = await retrieveEngramMemoryContext({
        query: `${phaseName} ${userPrompt}`.slice(0, 100),
        project: `session-${sessionId}`,
        limit: 3,
      })
      if (memoryContext) {
        enrichedSystemPrompt += memoryContext
      }
    } catch {
      // Ignorar fallo de búsqueda en memoria
    }
  }

  trace(
    `[SDLCGraph] Invocando LLM (${config.model}) en ${config.baseUrl} para: ${phaseName} con ${publishedTools.length} herramientas publicadas: ${publishedTools.map((t) => t.function.name).join(', ')}`,
  )

  if (callbacks && sessionId) {
    callbacks.onThinking?.({
      sessionId,
      thought: `Consultando modelo LLM ${config.model} (${config.baseUrl}) con herramientas [${publishedTools.map((t) => t.function.name).join(', ')}] para ${phaseName}...`,
      phase: 'thinking',
      sdlcPhase,
    })
    callbacks.onStreamChunk?.({
      sessionId,
      contentSoFar: '',
      delta: '',
      thought: `Analizando ${phaseName} con ${config.model}...`,
      phase: phaseName,
      sdlcPhase,
    })
  }

  let accumulatedContent = ''
  let accumulatedThought = ''
  let totalPhasePromptTokens = 0
  let totalPhaseCompletionTokens = 0
  const allExecutedToolCalls: ParsedToolCall[] = []
  const subagentDeliverables: SubagentComponentDeliverable[] = []

  try {
    const conversationMessages: ChatMessage[] = [
      { role: 'system', content: enrichedSystemPrompt },
      { role: 'user', content: userPrompt },
    ]

    for (let iteration = 0; iteration < maxToolIterations; iteration++) {
      const response = await streamChatCompletion({
        scopeId: `sdlc_${sessionId || 'test'}_${phaseName.replace(/[^a-zA-Z0-9]/g, '_')}_iter_${iteration + 1}`,
        messages: conversationMessages,
        tools: publishedTools,
        toolChoice: iteration === 0 ? (params.toolChoice ?? 'auto') : 'auto',
        onThinking: (thought) => {
          accumulatedThought = thought
          if (sessionId) {
            callbacks?.onThinking?.({
              sessionId,
              thought,
              phase: 'thinking',
              sdlcPhase,
            })
            const currentPrompt = totalPhasePromptTokens || Math.max(1, Math.ceil((enrichedSystemPrompt.length + userPrompt.length) / 4))
            const currentCompletion = totalPhaseCompletionTokens + Math.max(1, Math.ceil((accumulatedContent.length + accumulatedThought.length) / 4))
            callbacks?.onStreamChunk?.({
              sessionId,
              contentSoFar: accumulatedContent,
              delta: '',
              thought,
              phase: phaseName,
              sdlcPhase,
              tokenUsage: {
                promptTokens: currentPrompt,
                completionTokens: currentCompletion,
                totalTokens: currentPrompt + currentCompletion,
              },
            })
          }
        },
        onContentDelta: (contentSoFar, delta) => {
          accumulatedContent = contentSoFar
          if (sessionId) {
            const currentPrompt = totalPhasePromptTokens || Math.max(1, Math.ceil((enrichedSystemPrompt.length + userPrompt.length) / 4))
            const currentCompletion = totalPhaseCompletionTokens + Math.max(1, Math.ceil((contentSoFar.length + accumulatedThought.length) / 4))
            callbacks?.onStreamChunk?.({
              sessionId,
              contentSoFar,
              delta,
              thought: accumulatedThought,
              phase: phaseName,
              sdlcPhase,
              tokenUsage: {
                promptTokens: currentPrompt,
                completionTokens: currentCompletion,
                totalTokens: currentPrompt + currentCompletion,
              },
            })
          }
        },
        signal: callbacks?.signal,
        requestTimeoutMs: 35000,
      })

      totalPhasePromptTokens += (response.promptTokens || 0)
      totalPhaseCompletionTokens += (response.completionTokens || 0)

      if (response.contentBuffer.trim().length > 0) {
        accumulatedContent = response.contentBuffer.trim()
      }
      if (response.thoughtBuffer.trim().length > 0) {
        accumulatedThought = response.thoughtBuffer.trim()
      }

      if (!response.toolCalls || response.toolCalls.length === 0) {
        break
      }

      allExecutedToolCalls.push(...response.toolCalls)

      conversationMessages.push({
        role: 'assistant',
        content: response.contentBuffer || '',
        tool_calls: response.toolCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.argumentsRaw || JSON.stringify(tc.args),
          },
        })),
      })

      let hasIterativeQueryTool = false

      for (const tc of response.toolCalls) {
        if (
          ITERATIVE_QUERY_TOOLS.has(tc.name) ||
          tc.name.startsWith('mcp_') ||
          mcpReport.registry.has(tc.name)
        ) {
          hasIterativeQueryTool = true
        }
        trace(
          `[SDLCGraph] Ejecutando herramienta invocada por el LLM (iteración ${iteration + 1}/${maxToolIterations}): ${tc.name}`,
          tc.args,
        )
        const toolStartTime = Date.now()
        trace('tool.execute.start', {
          toolName: tc.name,
          args: tc.args,
          sdlcPhase,
          iteration: iteration + 1,
        })
        if (callbacks && sessionId) {
          callbacks.onThinking?.({
            sessionId,
            thought: `Ejecutando herramienta ${tc.name} (paso ${iteration + 1}/${maxToolIterations})...`,
            phase: 'executing_tools',
            activeTool: tc.name,
            sdlcPhase,
          })
        }

        let toolResultOutput = ''
        try {
          if (tc.name === 'search_web_guidance' || tc.name === 'read_web_guidance_doc') {
            toolResultOutput = await executeWebGuidanceTool(tc.name, tc.args)
          } else if (tc.name === 'engram_search' || tc.name === 'memory_search') {
            const engram = getPersistentEngram()
            const q = String(tc.args.query ?? '')
            const results = await engram.search({ query: q, limit: 8 })
            toolResultOutput = JSON.stringify({
              count: results.length,
              results: results.map((r) => ({
                id: r.header.id,
                title: r.header.title,
                type: r.header.type,
                tags: r.header.tags,
                score: r.score,
              })),
            })
          } else if (tc.name.startsWith('fs_')) {
            const targetToolName = tc.name === 'fs_list_files' ? 'fs_list_dir' : tc.name
            const fsRes = await executeFileSystemTool(targetToolName, tc.args, {
              sessionId: sessionId || 0,
              fsWriteMode: FsWriteMode.AUTO,
              onProposalCreated: callbacks?.onProposalCreated,
            })
            toolResultOutput = fsRes.output
          } else if (tc.name === 'run_sandboxed_js') {
            const code = String(tc.args.code ?? '')
            const jsRes = await executeSandboxedJs(code)
            toolResultOutput = JSON.stringify(jsRes)
          } else if (tc.name === 'run_browser_sandbox') {
            const browserRes = await executeBrowserSandbox({
              html: typeof tc.args.html === 'string' ? tc.args.html : undefined,
              css: typeof tc.args.css === 'string' ? tc.args.css : undefined,
              code: typeof tc.args.code === 'string' ? tc.args.code : undefined,
              domSelector: typeof tc.args.domSelector === 'string' ? tc.args.domSelector : undefined,
            })
            toolResultOutput = JSON.stringify(browserRes)
          } else if (tc.name === 'plan_and_delegate_tasks' || tc.name === 'delegate_subagent_scope') {
            const engram = getPersistentEngram()
            const rawTasks = Array.isArray(tc.args.tasks)
              ? tc.args.tasks
              : Array.isArray(tc.args.subtareas)
                ? tc.args.subtareas
                : [
                    {
                      id: 'subtask_1',
                      description: String(tc.args.taskDescription ?? tc.args.workGoal ?? 'Subtarea de componente'),
                      acceptanceTest: String(tc.args.acceptanceTest ?? 'Verificar contrato del componente'),
                      targetPath: String(tc.args.targetPath ?? 'src/components/module.ts'),
                      skill: (tc.args.skill as AgentSkillName) ?? 'skill_coder',
                    },
                  ]

            const normalizedTasks: ScopeTaskDefinition[] = rawTasks.flatMap(
              (item, idx): ScopeTaskDefinition[] => {
                if (!item || typeof item !== 'object') return []
                const raw = item as Record<string, unknown>
                return [
                  {
                    id_subtarea: String(raw.id ?? raw.id_subtarea ?? `subtask_${idx + 1}`),
                    descripcion: String(raw.description ?? raw.descripcion ?? `Subtarea #${idx + 1}`),
                    prueba_aceptacion: String(
                      raw.acceptanceTest ?? raw.prueba_aceptacion ?? 'Verificar funcionamiento en sandbox',
                    ),
                    targetPath: String(raw.targetPath ?? 'src/components/module.ts'),
                    skill_requerida:
                      (raw.skill as AgentSkillName) ??
                      (raw.skill_requerida as AgentSkillName) ??
                      'skill_coder',
                    requiere_sub_planificacion: false,
                  },
                ]
              },
            )

            const rootScopeId = `sdlc_subplan_${sessionId || 0}_${Date.now()}`
            const rootStorage = new AgentScopeStorage({
              engram,
              project: `session-${sessionId || 0}`,
              filePath: normalizedTasks[0]?.targetPath ?? 'workspace',
              scopeId: rootScopeId,
            })
            await rootStorage.saveSubPlan(
              normalizedTasks,
              String(tc.args.workGoal ?? tc.args.taskDescription ?? phaseName),
            )
            const gate = new SlmConcurrencyGate(config.maxConcurrency)

            // Ordenar subtareas por capa arquitectónica (tipos -> servicios/adaptadores -> componentes UI -> HTML/CSS -> tests)
            // para que cada sub-agente conozca los contratos, clases y rutas reales generados por las capas previas.
            const taskLayerPriority = (p = ''): number => {
              const lower = p.toLowerCase()
              if (lower.startsWith('tests/') || /\.(test|spec)\./.test(lower)) return 4
              if (/\.(html|css|webmanifest)$/.test(lower)) return 3
              if (lower.includes('/components/') || lower.includes('view')) return 2
              if (lower.includes('/services/') || lower.includes('adapter') || lower.includes('engine')) return 1
              if (lower.includes('/types/') || lower.includes('model') || lower.includes('interface')) return 0
              return 2
            }

            const orderedTasks = [...normalizedTasks].sort(
              (a, b) => taskLayerPriority(a.targetPath) - taskLayerPriority(b.targetPath),
            )

            const completedSiblings: Array<{ path: string; code: string }> = []
            const subResults = []

            for (const subTask of orderedTasks) {
              const targetPath = (subTask.targetPath ?? 'src/components/module.ts').trim().replace(/\\/g, '/')
              let codeContent = ''
              try {
                const readRes = await readWorkspaceFile(targetPath)
                codeContent = readRes.content
              } catch {
                codeContent = ''
              }

              if (!codeContent.trim() && completedSiblings.length > 0) {
                codeContent = completedSiblings
                  .map(
                    (sib) =>
                      `// === Archivo hermano ya generado en "${sib.path}" (usa estos nombres e imports exactos) ===\n${sib.code.slice(0, 3500)}`,
                  )
                  .join('\n\n')
              }

              const res = await procesarNodoScope(
                subTask,
                rootStorage,
                {
                  targetPath,
                  codeContent,
                  baseInstructions: `${enrichedSystemPrompt}\n\nREGLA DE CÓDIGO LIMPIO EN SUB-AGENTE: En "ejecutar_tarea_atomica", el campo "tarea_realizada" debe contener EXCLUSIVAMENTE el código fuente válido del archivo "${targetPath}", sin bloques Markdown (\`\`\`), sin introducciones en prosa y sin mensajes de error.`,
                  maxDepth: config.maxDepth,
                  maxConcurrency: config.maxConcurrency,
                  concurrencyGate: gate,
                  onThinking: (t) => {
                    if (sessionId) {
                      callbacks?.onThinking?.({
                        sessionId,
                        thought: t,
                        phase: 'thinking',
                        activeTool: tc.name,
                        sdlcPhase,
                      })
                    }
                  },
                  signal: callbacks?.signal,
                },
                false,
              )

              const recordDeliverableIfValid = (rawCode: string, rawTest: string, summaryText: string) => {
                const cleanedCode = extractCleanSourceCode(rawCode, targetPath)
                if (isValidSourceCodeForPath(targetPath, cleanedCode)) {
                  subagentDeliverables.push({
                    taskId: subTask.id_subtarea,
                    targetPath,
                    code: cleanedCode,
                    testCode: extractCleanSourceCode(rawTest, 'test.ts'),
                    summary: summaryText,
                  })
                  completedSiblings.push({ path: targetPath, code: cleanedCode })
                  void writeWorkspaceFileDirect(targetPath, cleanedCode)
                }
              }

              if (res.entregable_atomico?.tarea_realizada) {
                recordDeliverableIfValid(
                  res.entregable_atomico.tarea_realizada,
                  res.entregable_atomico.prueba_automatizada,
                  res.sumario_ejecutivo,
                )
              } else if (res.entregables_subagentes && res.entregables_subagentes.length > 0) {
                for (const childDeliv of res.entregables_subagentes) {
                  if (childDeliv.entregable_atomico?.tarea_realizada) {
                    recordDeliverableIfValid(
                      childDeliv.entregable_atomico.tarea_realizada,
                      childDeliv.entregable_atomico.prueba_automatizada,
                      childDeliv.descripcion || res.sumario_ejecutivo,
                    )
                  }
                }
              }

              subResults.push(res)
            }

            toolResultOutput = JSON.stringify({
              status: 'subtasks_completed',
              count: subResults.length,
              deliverables: subResults.map((r, i) => ({
                taskId: orderedTasks[i]?.id_subtarea,
                targetPath: orderedTasks[i]?.targetPath,
                summary: r.sumario_ejecutivo,
                atomicDeliverable: r.entregable_atomico,
              })),
            })
          } else if (mcpReport.registry.has(tc.name)) {
            const mcpTool = mcpReport.registry.get(tc.name)!
            toolResultOutput = await callMcpTool(mcpTool, tc.args, mcpAuthContext)
          } else {
            toolResultOutput = JSON.stringify({ status: 'ok', tool: tc.name, args: tc.args })
          }

          const elapsedMs = Date.now() - toolStartTime
          trace('tool.execute.complete', {
            toolName: tc.name,
            elapsedMs,
            sdlcPhase,
            outputPreview: toolResultOutput.slice(0, 400),
          })

          if (callbacks && sessionId) {
            callbacks.onThinking?.({
              sessionId,
              thought: `Herramienta ${tc.name} completada en ${elapsedMs}ms`,
              phase: 'thinking',
              activeTool: tc.name,
              sdlcPhase,
            })
          }
        } catch (toolErr) {
          const elapsedMs = Date.now() - toolStartTime
          trace(`[SDLCGraph] Error al ejecutar herramienta ${tc.name}: ${toolErr}`)
          trace('tool.execute.error', {
            toolName: tc.name,
            elapsedMs,
            sdlcPhase,
            error: toolErr instanceof Error ? toolErr.message : String(toolErr),
          })
          toolResultOutput = JSON.stringify({
            error: toolErr instanceof Error ? toolErr.message : String(toolErr),
          })
        }

        const sanitizedOutput = toolResultOutput.replace(
          /"data:image\/[^";]+;base64,[A-Za-z0-9+/=]{120,}"/g,
          '"data:image/png;base64,[captura_disponible_en_inspector_ui]"',
        )

        conversationMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: sanitizedOutput,
        })

        if (sessionId) {
          await appendSessionMessage({
            sessionId,
            role: 'tool',
            toolName: tc.name,
            toolCallId: tc.id,
            content: sanitizedOutput.slice(0, 2000),
          }).catch(() => {})
          callbacks?.onStepUpdate?.(sessionId)
        }
      }

      // Si no se invocaron herramientas de lectura/consulta (p. ej. solo se invocó fs_write_file o approve_design), evaluamos invitar a Tether o salir
      if (!hasIterativeQueryTool) {
        const cliTool = findCliExecutionTool(mcpReport)
        if (
          cliTool &&
          iteration === 0 &&
          allExecutedToolCalls.some((tc) => tc.name === 'fs_write_file')
        ) {
          hasIterativeQueryTool = true
          conversationMessages.push({
            role: 'user',
            content: `Se han guardado los archivos. Tienes disponible la herramienta de Tether "${cliTool.qualifiedName}". Puedes invocarla mediante tool_calls para ejecutar la compilación o validación real (ej: \`npx tsc --noEmit\` o \`npm run build\`) y verificar que no existen errores antes de finalizar.`,
          })
          continue
        }
        break
      }
    }

    // Si el LLM agotó las iteraciones llamando únicamente a herramientas de consulta (ej. search_web_guidance)
    // sin llegar a emitir la respuesta final o escribir los archivos, forzamos una llamada final de síntesis
    const hasWrittenFile =
      allExecutedToolCalls.some((tc) => tc.name === 'fs_write_file') ||
      subagentDeliverables.length > 0
    if (accumulatedContent.trim().length === 0 && allExecutedToolCalls.length > 0 && !hasWrittenFile) {
      conversationMessages.push({
        role: 'user',
        content:
          'Con la información recopilada de las herramientas anteriores, emite ahora la respuesta completa en Markdown (y los bloques de código completos con sus rutas path="...") sin realizar más búsquedas.',
      })
      const synthResponse = await streamChatCompletion({
        scopeId: `sdlc_${sessionId || 'test'}_${phaseName.replace(/[^a-zA-Z0-9]/g, '_')}_final_synth`,
        messages: conversationMessages,
        tools: [],
        toolChoice: 'none',
        onThinking: (thought) => {
          accumulatedThought = thought
          if (sessionId) {
            callbacks?.onThinking?.({
              sessionId,
              thought,
              phase: 'thinking',
              sdlcPhase,
            })
          }
        },
        onContentDelta: (contentSoFar, delta) => {
          accumulatedContent = contentSoFar
          if (sessionId) {
            callbacks?.onStreamChunk?.({
              sessionId,
              contentSoFar,
              delta,
              thought: accumulatedThought,
              phase: phaseName,
              sdlcPhase,
            })
          }
        },
        signal: callbacks?.signal,
        requestTimeoutMs: 35000,
      })
      if (synthResponse.contentBuffer.trim().length > 0) {
        accumulatedContent = synthResponse.contentBuffer.trim()
      }
    }

    const content = accumulatedContent.trim()
    const thought = accumulatedThought.trim()
    if (content.length > 0 || allExecutedToolCalls.length > 0) {
      trace(
        `[SDLCGraph] Respuesta viva recibida del LLM (${content.length} caracteres, ${allExecutedToolCalls.length} tool calls).`,
      )
      const finalMsg = {
        content: content || `Herramientas ejecutadas: ${allExecutedToolCalls.map((t) => t.name).join(', ')}.`,
        thought: thought || undefined,
        toolCalls: allExecutedToolCalls,
        subagentDeliverables,
        usedFallback: false,
        tokenUsage: {
          promptTokens: totalPhasePromptTokens,
          completionTokens: totalPhaseCompletionTokens,
          totalTokens: totalPhasePromptTokens + totalPhaseCompletionTokens,
        },
      }
      if (sessionId) {
        try {
          await saveEpisodicTurnMemory({
            sessionId,
            userPrompt,
            assistantReply: finalMsg.content,
            thought: finalMsg.thought,
            phase: phaseName,
            tags: ['sdlc', 'llm_live'],
          })
        } catch (memErr) {
          trace(`[SDLCGraph] Aviso al persistir memoria episódica viva: ${memErr}`)
        }
      }
      return finalMsg
    }

    if (mustUseLiveLlm) {
      throw new Error(
        `El servidor LLM local (${config.baseUrl} — modelo "${config.model}") devolvió una respuesta vacía durante "${phaseName}".`,
      )
    }
  } catch (err) {
    if (mustUseLiveLlm) {
      const errMsg = err instanceof Error ? err.message : String(err)
      trace(`[SDLCGraph] Error crítico conectando con LLM local en sesión activa: ${errMsg}`)
      throw new Error(
        `No se pudo conectar con el servidor LLM local en ${config.baseUrl} (modelo "${config.model}") durante "${phaseName}". Inicia o conecta tu motor LLM local (Ollama / LM Studio) y vuelve a intentarlo. Detalle: ${errMsg}`,
      )
    }
    trace(`[SDLCGraph] Endpoint LLM no disponible (${err}). Usando motor arquitectónico con streaming interactivo.`)
  }

  // Generador fallback (solo para pruebas deterministas offline cuando requireLiveLlm es false)
  const fallback = defaultFallback()
  const fallbackPromptTokens = Math.max(1, Math.ceil((enrichedSystemPrompt.length + userPrompt.length) / 4))
  const fallbackCompletionTokens = Math.max(1, Math.ceil((fallback.content.length + (fallback.thought?.length || 0)) / 4))
  const fallbackTotalTokens = fallbackPromptTokens + fallbackCompletionTokens

  if (sessionId && callbacks?.onStreamChunk) {
    const lines = fallback.content.split('\n')
    let current = ''
    for (const line of lines) {
      current += (current ? '\n' : '') + line
      callbacks.onStreamChunk({
        sessionId,
        contentSoFar: current,
        delta: line + '\n',
        thought: fallback.thought,
        phase: phaseName,
        sdlcPhase,
        tokenUsage: {
          promptTokens: fallbackPromptTokens,
          completionTokens: Math.max(1, Math.ceil(current.length / 4)),
          totalTokens: fallbackPromptTokens + Math.max(1, Math.ceil(current.length / 4)),
        },
      })
      await new Promise((r) => setTimeout(r, 20))
    }
  }

  if (sessionId) {
    try {
      await saveEpisodicTurnMemory({
        sessionId,
        userPrompt,
        assistantReply: fallback.content,
        thought: fallback.thought,
        phase: phaseName,
        tags: ['sdlc', 'deterministic_engine'],
      })
    } catch (memErr) {
      trace(`[SDLCGraph] Aviso al persistir memoria episódica fallback: ${memErr}`)
    }
  }

  return {
    content: fallback.content,
    thought: fallback.thought,
    toolCalls: [],
    subagentDeliverables: [],
    usedFallback: true,
    tokenUsage: {
      promptTokens: fallbackPromptTokens,
      completionTokens: fallbackCompletionTokens,
      totalTokens: fallbackTotalTokens,
    },
  }
}
