import { trace } from '../../../diagnostics'
import { getActiveWorkspaceName } from '../../../fs/workspace-fs'
import { getPersistentEngram, saveSdlcPhaseArtifact } from '../../../memory/engram-memory'
import { appendSessionMessage, getSessionById, listMcpServers, updateSessionMetrics } from '../../../memory/app-db'
import { SessionStatus } from '../../../enums'
import { getSessionCallbacks } from '../../agent-graph'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import { isAbsoluteOsPath, isTetherServer } from '../../../mcp/mcp-client'
import type { BusinessUseCase, SDLCStateType } from '../../sdlc-state'

export class CriticalWorkspacePathError extends Error {
  public readonly details: {
    sessionId?: number
    providedPath?: string
    reason: string
  }
  constructor(details: { sessionId?: number; providedPath?: string; reason: string }) {
    super(
      `[CRITICAL ERROR] No se puede iniciar el ciclo de desarrollo en la sesión #${details.sessionId ?? 'N/A'}. ` +
      `La ruta física del workspace en el anfitrión no está definida o es inválida: "${details.providedPath ?? 'undefined'}". ` +
      `Detalle: ${details.reason}`,
    )
    this.name = 'CriticalWorkspacePathError'
    this.details = details
  }
}

/**
 * Resuelve y valida obligatoriamente la ruta física del workspace en el anfitrión.
 * Si no está definida o no es una ruta absoluta del sistema operativo, arroja CriticalWorkspacePathError.
 */
export async function resolveRequiredSessionWorkspacePath(
  sessionId?: number,
  statePath?: string,
): Promise<string> {
  let resolvedWsPath = statePath?.trim()
  if (!resolvedWsPath || !isAbsoluteOsPath(resolvedWsPath)) {
    if (sessionId) {
      const sess = await getSessionById(sessionId).catch(() => null)
      if (sess?.workspacePath && isAbsoluteOsPath(sess.workspacePath)) {
        resolvedWsPath = sess.workspacePath.trim()
      }
    }
  }
  if (!resolvedWsPath || !isAbsoluteOsPath(resolvedWsPath)) {
    const servers = await listMcpServers().catch(() => [])
    const tether = servers.find((s) => isTetherServer(s))
    if (tether?.workspace && isAbsoluteOsPath(tether.workspace)) {
      resolvedWsPath = tether.workspace.trim()
    }
  }

  if (!resolvedWsPath || !isAbsoluteOsPath(resolvedWsPath)) {
    const errMsg = `[CRITICAL ERROR] Error Crítico de Workflow: La sesión #${sessionId ?? 'N/A'} no tiene una ruta de workspace válida en el anfitrión. No se puede generar nada sin esta ruta obligatoria. Detalle: ruta="${resolvedWsPath ?? 'undefined'}"`
    trace('[SDLCGraph] ' + errMsg)
    if (sessionId) {
      await updateSessionMetrics(sessionId, {
        status: SessionStatus.ERROR,
      }).catch(() => {})
      await appendSessionMessage({
        sessionId,
        role: 'system',
        content: `🚨 **Error Crítico de Configuración del Workspace**\n\n${errMsg}\n\nPor favor, vincula o define la ruta absoluta del workspace local en la sesión antes de iniciar el desarrollo.`,
      }).catch(() => {})
    }
    throw new CriticalWorkspacePathError({
      sessionId,
      providedPath: resolvedWsPath,
      reason: 'No hay ruta física de workspace absoluta definida para esta sesión.',
    })
  }

  return resolvedWsPath
}

/**
 * NODO 0.1: Evaluación de Entrada Inicial
 * Verifica si el usuario ya proporcionó casos de uso y directrices arquitectónicas rigurosas.
 */
export async function node_phase0_assess(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Evaluando rigor del input inicial...')
  const callbacks = state.sessionId ? getSessionCallbacks(state.sessionId) : undefined

  // 1. Verificación obligatoria de la ruta física del workspace en el anfitrión
  const resolvedWsPath = await resolveRequiredSessionWorkspacePath(state.sessionId, state.workspacePath)

  const extraUrls =
    state.mcpServerConfig?.url && state.mcpServerConfig.url.trim().length > 0
      ? [state.mcpServerConfig.url.trim()]
      : undefined
  await RuntimeSkillLoader.syncMcpCapabilities({
    extraServerUrls: extraUrls,
    authContext: {
      agentId: state.sessionId ? `localloop-session-${state.sessionId}` : 'localloop-sdlc-agent',
      agentName: 'LocalLoop (EnterpriseArch_MCP_Connector)',
      workspace: resolvedWsPath,
      sessionId: state.sessionId ? String(state.sessionId) : undefined,
      onAuthStatus: (msg) => {
        if (callbacks && state.sessionId) {
          callbacks.onThinking?.({
            sessionId: state.sessionId,
            thought: msg,
            phase: 'thinking',
            sdlcPhase: '0_DISCOVERY_RIGOR',
          })
        }
      },
    },
  })
  const hasUseCases = state.useCases && state.useCases.length > 0
  const hasStandard = Boolean(state.marketArchStandard && state.marketArchStandard.trim().length > 0)

  if (hasUseCases && hasStandard) {
    if (state.sessionId) {
      try {
        await saveSdlcPhaseArtifact({
          sessionId: state.sessionId,
          phaseName: '0_DISCOVERY_RIGOR',
          artifactTitle: 'Especificación Inicial de Negocio y Casos de Uso',
          artifactType: 'project_discovery',
          payload: {
            useCases: state.useCases,
            standard: state.marketArchStandard,
            phase0Data: state.phase0Data,
          },
          tags: ['discovery', 'use_cases'],
        })
      } catch (err) {
        trace(`[SDLCGraph] Aviso guardando discovery inicial en engram: ${err}`)
      }
    }
    return {
      discoveryInputValid: true,
      currentPhase: '1_STRATEGY_AND_PLAN',
      workspacePath: resolvedWsPath,
    }
  }

  return {
    discoveryInputValid: false,
    activeSkill: 'ProjectRigor_Interviewer',
    currentPhase: '0_DISCOVERY_RIGOR',
    workspacePath: resolvedWsPath,
  }
}

/**
 * NODO 0.2: Presentación del Cuestionario de Rigor & Oferta MCP
 * Genera las preguntas clave y deja el grafo listo para la interrupción (HITL 1).
 */
export async function node_phase0_ask_discovery(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Generando cuestionario de descubrimiento y propuesta MCP...')
  RuntimeSkillLoader.resolveContext(state)

  const discoveryMessage = {
    role: 'assistant' as const,
    content:
      `### Fase 0: Descubrimiento y Calibración de Rigor\n\n` +
      `Para garantizar que el desarrollo cumpla con los estándares de negocio y arquitectura empresarial, requerimos definir:\n\n` +
      `1. **Casos de Uso de Negocio:** Actores, flujo principal (happy path) y flujos alternativos.\n` +
      `2. **Criterios de Aceptación Medibles:** Formato Given-When-Then (BDD) y objetivo de mejora de negocio cuantificable.\n` +
      `3. **Marco de Arquitectura Estándar:** (ej. C4 Model, Clean/Hexagonal Architecture, DDD).\n` +
      `4. **Conexión con MCP de Arquitectura:** ¿Dispones de un servidor MCP con el catálogo o landscape de arquitectura empresarial para acelerar la Fase 1? Indica la URL de conexión (SSE/WebSocket) o confirma si definimos el landscape manualmente.`,
  }

  if (state.sessionId) {
    try {
      await updateSessionMetrics(state.sessionId, {
        currentPhase: '0_DISCOVERY_RIGOR',
        status: SessionStatus.WAITING_APPROVAL,
      })
    } catch {
      // ignore
    }
  }

  return {
    currentPhase: '0_DISCOVERY_RIGOR',
    messages: [...state.messages, discoveryMessage],
  }
}

/**
 * NODO 0.3: Ingesta de Descubrimiento y Conexión MCP
 * Se ejecuta tras la reanudación del interrupt con las respuestas del usuario.
 */
export async function node_phase0_process_discovery(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Procesando respuestas de descubrimiento e ingesta MCP...')
  const engram = await getPersistentEngram()

  const userMessages = (state.messages || []).filter((m) => m.role === 'user')
  const latestUserText = userMessages[userMessages.length - 1]?.content?.trim() || ''

  // Si el usuario respondió en el chat sin phase0Data estructurado, sintetizamos phase0Data a partir de su respuesta
  let phase0Data = state.phase0Data
  if (!phase0Data && latestUserText.length > 0) {
    const firstLine =
      latestUserText
        .split(/\r?\n/)[0]
        ?.replace(/^[#*\-\d\.\s]+/, '')
        .trim() || ''
    const featureTitle =
      firstLine.length > 3 && firstLine.length <= 80
        ? firstLine
        : latestUserText.slice(0, 60).trim()
    const slug =
      featureTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 18) || 'app'

    const bulletLines = latestUserText
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => /^[-*\d]/.test(l))

    const needsList =
      bulletLines.length > 0
        ? bulletLines.slice(0, 5).map((l, idx) => ({
            id: `NEED-${idx + 1}`,
            description: l.replace(/^[-*\d\.\)\s]+/, '').trim(),
            expectedImpact: 'Cumplimiento directo del requerimiento indicado por el usuario.',
          }))
        : [
            {
              id: 'NEED-1',
              description: latestUserText,
              expectedImpact: 'Entrega funcional completa según la respuesta del usuario en Fase 0.',
            },
          ]

    phase0Data = {
      step1: {
        featureTitle,
        rawBusinessLanguageText: latestUserText,
        needsList,
      },
      step2: {
        marketStandard: state.marketArchStandard || 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: {
          title: 'Necesidad funcional definida por el usuario en Fase 0',
          description: latestUserText,
          limitationsOrCapabilities: ['Requiere implementación modular verificada'],
        },
        desiredSituation: {
          title: `Solución completa para: ${featureTitle}`,
          description: latestUserText,
          limitationsOrCapabilities: needsList.map((n) => n.description),
        },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: `comp_${slug}_core`,
            name: `Motor de Dominio y Lógica (${featureTitle})`,
            action: 'CREATE',
            targetState: 'DESIRED',
            description: `Entidades, contratos y reglas principales para: ${latestUserText.slice(0, 140)}`,
            dependsOn: [],
          },
          {
            componentId: `comp_${slug}_service`,
            name: `Servicio de Aplicación y Estado (${featureTitle})`,
            action: 'CREATE',
            targetState: 'DESIRED',
            description: `Orquestación de casos de uso y lógica de negocio para ${featureTitle}.`,
            dependsOn: [`comp_${slug}_core`],
          },
          {
            componentId: `comp_${slug}_ui`,
            name: `Interfaz Interactiva y Punto de Entrada (${featureTitle})`,
            action: 'CREATE',
            targetState: 'DESIRED',
            description: `Interfaz de usuario y experiencia interactiva para ${featureTitle}.`,
            dependsOn: [`comp_${slug}_core`, `comp_${slug}_service`],
          },
        ],
      },
    }
  }

  // Derivar casos de uso fieles a la respuesta del usuario en Fase 0 si no estaban predefinidos
  let useCases = state.useCases
  if (!useCases || useCases.length === 0) {
    if (phase0Data?.step1) {
      const needs = phase0Data.step1.needsList || []
      useCases =
        needs.length > 0
          ? needs.map((n, idx) => ({
              id: `UC-00${idx + 1}`,
              title: `${phase0Data!.step1.featureTitle} — ${n.description.slice(0, 70)}`,
              actor: 'Usuario / Operador',
              happyPath: [
                `El usuario inicia la operación en ${phase0Data!.step1.featureTitle}`,
                `El sistema ejecuta: ${n.description}`,
                `El resultado se valida y presenta cumpliendo: ${n.expectedImpact || 'objetivo de negocio'}`,
              ],
              exceptions: ['Datos de entrada incompletos o inválidos'],
              expectedBusinessOutcome: n.expectedImpact || phase0Data!.step1.rawBusinessLanguageText,
              acceptanceCriteriaGherkin: `Given ${phase0Data!.step1.featureTitle} inicializado, When se ejecuta "${n.description}", Then se obtiene "${n.expectedImpact || 'resultado verificado'}".`,
            }))
          : [
              {
                id: 'UC-001',
                title: phase0Data.step1.featureTitle || 'Caso de Uso Principal de Negocio',
                actor: 'Usuario Final',
                happyPath: [
                  'El usuario inicia la aplicación',
                  `Se procesa la necesidad: ${phase0Data.step1.rawBusinessLanguageText}`,
                  'El resultado es confirmado y renderizado',
                ],
                exceptions: ['Fallo de validación de entrada'],
                expectedBusinessOutcome: phase0Data.step1.rawBusinessLanguageText,
                acceptanceCriteriaGherkin: `Given el sistema activo, When el usuario utiliza ${phase0Data.step1.featureTitle}, Then se cumple el flujo principal sin errores.`,
              },
            ]
    } else {
      const defaultUseCase: BusinessUseCase = {
        id: 'UC-001',
        title: latestUserText ? latestUserText.slice(0, 70) : 'Caso de Uso Principal de Negocio',
        actor: 'Usuario Final',
        happyPath: [
          'El usuario inicia la operación',
          latestUserText ? `El sistema ejecuta: ${latestUserText}` : 'El sistema valida reglas',
          'El resultado es persistido y confirmado',
        ],
        exceptions: ['Fallo de validación de negocio', 'Error de timeout'],
        expectedBusinessOutcome: latestUserText || 'Incrementar la eficiencia operativa reduciendo errores manuales.',
        acceptanceCriteriaGherkin: 'Given el sistema está disponible, When el usuario ejecuta la acción, Then se genera la confirmación esperada.',
      }
      useCases = [defaultUseCase]
    }
  }

  // Guardar en Engram para consulta por todas las fases posteriores
  await engram.save({
    title: 'Definición de Casos de Uso y Criterios de Aceptación',
    type: 'project_discovery',
    project: 'localloop',
    tags: ['project_discovery', 'use_cases', 'business_goals'],
    records: [
      {
        title: 'use_cases_spec',
        content: JSON.stringify(useCases, null, 2),
      },
    ],
  })

  // Ingesta de Arquitectura y Análisis Dinámico de Capacidades MCP
  const callbacks = state.sessionId ? getSessionCallbacks(state.sessionId) : undefined
  const extraMcpUrls =
    state.mcpServerConfig?.url && state.mcpServerConfig.url.trim().length > 0
      ? [state.mcpServerConfig.url.trim()]
      : undefined
  const mcpCapabilityReport = await RuntimeSkillLoader.syncMcpCapabilities({
    extraServerUrls: extraMcpUrls,
    forceRefresh: Boolean(extraMcpUrls?.length),
    authContext: {
      agentId: state.sessionId ? `localloop-session-${state.sessionId}` : 'localloop-sdlc-agent',
      agentName: 'LocalLoop (EnterpriseArch_MCP_Connector)',
      workspace: state.workspacePath || getActiveWorkspaceName() || '',
      onAuthStatus: (msg) => {
        if (callbacks && state.sessionId) {
          callbacks.onThinking?.({
            sessionId: state.sessionId,
            thought: msg,
            phase: 'thinking',
            sdlcPhase: '0_DISCOVERY_RIGOR',
          })
        }
      },
    },
  })

  if (
    (state.mcpServerConfig && state.mcpServerConfig.connected && state.mcpServerConfig.url) ||
    mcpCapabilityReport.tools.length > 0
  ) {
    await engram.save({
      title: 'Landscape de Arquitectura Empresarial y Capacidades MCP',
      type: 'enterprise_landscape',
      project: 'localloop',
      tags: ['enterprise_landscape', 'mcp_services', 'c4_model', 'mcp_capabilities'],
      records: [
        {
          title: 'mcp_landscape_data',
          content: JSON.stringify({
            source: state.mcpServerConfig?.url || mcpCapabilityReport.serversQueried.join(', '),
            importedAt: new Date().toISOString(),
            standard: state.marketArchStandard,
            discoveredTools: mcpCapabilityReport.tools.map((t) => ({
              qualifiedName: t.tool.qualifiedName,
              serverName: t.tool.serverName,
              categories: t.categories,
              assignedRoles: t.assignedRoles,
            })),
          }),
        },
      ],
    })
  }

  // Persistir la definición detallada en 3 pasos si está presente
  if (phase0Data) {
    await engram.save({
      title: 'Caso de Negocio Arquitectónico (As-Is / To-Be / Transición)',
      type: 'enterprise_architecture_case',
      project: 'localloop',
      tags: ['enterprise_case', 'as_is', 'to_be', 'transition'],
      records: [
        {
          title: 'phase0_three_step_data',
          content: JSON.stringify(phase0Data, null, 2),
        },
      ],
    })
  }

  return {
    ...(phase0Data ? { phase0Data } : {}),
    useCases,
    discoveryCompleted: true,
    currentPhase: '1_STRATEGY_AND_PLAN',
    activeSkill: 'GovernanceProject_Planner',
  }
}