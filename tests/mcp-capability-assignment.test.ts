import { streamLlmPhase } from '../src/agent/sdlc-graph'
import type { SDLCStateType } from '../src/agent/sdlc-state'
import { RuntimeSkillLoader } from '../src/agent/skills/runtime-loader'
import {
  analyzeAndAssignMcpCapabilities,
  analyzeMcpToolCapabilities,
  clearMcpCapabilityCache,
  parseMcpResponseText,
  type McpToolDefinition,
} from '../src/mcp/mcp-client'
import { addMcpServer, listMcpServers, deleteMcpServer } from '../src/memory/app-db'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function runMcpCapabilityAssignmentTests(): Promise<void> {
  console.log('--- Iniciando pruebas de Análisis Dinámico de Capacidades MCP y Asignación por Roles ---')

  // 1. Verificar parseo multi-formato (JSON directo y SSE text/event-stream)
  console.log('[Test 1] Verificando parseo de respuestas MCP (JSON y SSE text/event-stream)...')
  const sseText = [
    'event: message',
    'data: {"jsonrpc":"2.0","id":"req-1","result":{"tools":[{"name":"run_cli","description":"Ejecuta comandos CLI y scripts de build"}]}}',
    '',
  ].join('\n')
  const parsedSse = parseMcpResponseText(sseText, 'req-1') as {
    result?: { tools?: Array<{ name: string }> }
  } | null
  assert(parsedSse?.result?.tools?.[0]?.name === 'run_cli', 'Debe extraer el payload JSON-RPC desde un stream SSE')
  console.log('✓ Parseo de respuestas JSON-RPC y SSE verificado.')

  // 2. Verificar clasificación semántica de capacidades MCP (no solo tether, cualquier MCP)
  console.log('[Test 2] Verificando clasificación semántica de capacidades MCP y matriz de roles...')
  const sampleTools: McpToolDefinition[] = [
    {
      serverName: 'tether',
      serverUrl: 'http://localhost:7434/sse',
      name: 'execute_command',
      qualifiedName: 'mcp_tether_execute_command',
      description: '[MCP: tether] Ejecuta comandos CLI en terminal shell para build, compilación y pruebas',
      inputSchema: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'Comando shell o script a ejecutar' },
        },
      },
    },
    {
      serverName: 'qa_runner',
      serverUrl: 'http://localhost:8100/mcp',
      name: 'run_playwright_suite',
      qualifiedName: 'mcp_qa_runner_run_playwright_suite',
      description: '[MCP: qa_runner] Ejecuta suite de pruebas E2E en navegador con Playwright y verifica cobertura',
      inputSchema: {
        type: 'object',
        properties: {
          specPattern: { type: 'string', description: 'Ruta de tests e2e' },
        },
      },
    },
    {
      serverName: 'arch_catalog',
      serverUrl: 'http://localhost:8200/mcp',
      name: 'get_service_contracts',
      qualifiedName: 'mcp_arch_catalog_get_service_contracts',
      description: '[MCP: arch_catalog] Consulta contratos OpenAPI, esquemas y diagrama C4 del landscape empresarial',
      inputSchema: {
        type: 'object',
        properties: {
          serviceId: { type: 'string', description: 'Identificador del componente o servicio' },
        },
      },
    },
  ]

  const cliAnalysis = analyzeMcpToolCapabilities(sampleTools[0])
  assert(
    cliAnalysis.categories.includes('CLI_EXECUTION_AND_BUILD'),
    'mcp_tether_execute_command debe clasificarse en CLI_EXECUTION_AND_BUILD',
  )
  assert(
    cliAnalysis.assignedRoles.includes('Component_Implementer') &&
      cliAnalysis.assignedRoles.includes('GovernanceProject_Planner') &&
      cliAnalysis.assignedRoles.includes('UnitTest_Engineer') &&
      cliAnalysis.assignedRoles.includes('E2EAutomation_Runner'),
    'mcp_tether_execute_command debe asignarse a roles de construcción, planificación y pruebas',
  )

  const qaAnalysis = analyzeMcpToolCapabilities(sampleTools[1])
  assert(
    qaAnalysis.categories.includes('TESTING_AND_VALIDATION'),
    'mcp_qa_runner_run_playwright_suite debe clasificarse en TESTING_AND_VALIDATION',
  )
  assert(
    qaAnalysis.assignedRoles.includes('UnitTest_Engineer') &&
      qaAnalysis.assignedRoles.includes('E2EAutomation_Runner') &&
      qaAnalysis.assignedRoles.includes('EnterpriseArch_Gatekeeper'),
    'mcp_qa_runner_run_playwright_suite debe asignarse a UnitTest_Engineer, E2EAutomation_Runner y Gatekeeper',
  )

  const archAnalysis = analyzeMcpToolCapabilities(sampleTools[2])
  assert(
    archAnalysis.categories.includes('ARCHITECTURE_AND_LANDSCAPE'),
    'mcp_arch_catalog_get_service_contracts debe clasificarse en ARCHITECTURE_AND_LANDSCAPE',
  )
  assert(
    archAnalysis.assignedRoles.includes('ProjectRigor_Interviewer') &&
      archAnalysis.assignedRoles.includes('BusinessEnterpriseArch_Alignment') &&
      archAnalysis.assignedRoles.includes('ComponentTechnical_Designer'),
    'mcp_arch_catalog_get_service_contracts debe asignarse a roles de descubrimiento y diseño arquitectónico',
  )
  console.log('✓ Clasificación semántica de capacidades y asignación dinámica a roles verificada.')

  // 3. Verificar inyección dinámica en RuntimeSkillLoader según el rol activo del SDLC
  console.log('[Test 3] Verificando inyección dinámica en RuntimeSkillLoader por rol SDLC...')
  clearMcpCapabilityCache()
  await RuntimeSkillLoader.syncMcpCapabilities({
    preDiscoveredTools: sampleTools,
    forceRefresh: true,
  })

  const baseState: SDLCStateType = {
    sessionId: 501,
    threadId: 'thread-mcp-501',
    currentPhase: '3_COMPONENT_CONSTRUCTION',
    activeSkill: 'Component_Implementer',
    activeComponentId: 'comp_booking_engine',
    discoveryInputValid: true,
    phase1FrameworkAgreed: true,
    projectFrameworkConfig: null,
    useCases: [],
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    mcpServerConfig: { connected: true, url: 'http://localhost:7434/sse' },
    componentsGraph: {},
    projectPlan: { milestones: [], backlog: [] },
    technicalDesigns: {},
    gatekeeperDecisions: {},
    technicalDebtList: [],
    unitEvidences: {},
    e2eEvidences: null,
    businessApproval: null,
    rcaDiagnosis: null,
    progressEvents: [],
    discoveryCompleted: true,
    messages: [],
    pendingToolCalls: [],
    turnsUsed: 0,
    maxTurns: 20,
  }

  const implementerCtx = RuntimeSkillLoader.resolveContext({
    ...baseState,
    activeSkill: 'Component_Implementer',
  })
  const implementerToolNames = implementerCtx.tools.map((t) => t.function.name)
  assert(
    implementerToolNames.includes('mcp_tether_execute_command'),
    `Component_Implementer debe recibir mcp_tether_execute_command. Recibido: ${implementerToolNames.join(', ')}`,
  )
  assert(
    implementerCtx.systemPrompt.includes('[CAPACIDADES MCP ASIGNADAS DINÁMICAMENTE A TU ROL]'),
    'El systemPrompt de Component_Implementer debe incluir el suplemento dinámico de capacidades MCP',
  )

  const interviewerCtx = RuntimeSkillLoader.resolveContext({
    ...baseState,
    activeSkill: 'ProjectRigor_Interviewer',
  })
  const interviewerToolNames = interviewerCtx.tools.map((t) => t.function.name)
  assert(
    interviewerToolNames.includes('mcp_arch_catalog_get_service_contracts'),
    'ProjectRigor_Interviewer debe recibir mcp_arch_catalog_get_service_contracts',
  )
  console.log('✓ RuntimeSkillLoader inyecta herramientas y directivas MCP específicas para cada rol.')

  // 4. Verificar flujo completo /auth/connect + aprobación de usuario + descubrimiento + ejecución MCP en streamLlmPhase
  console.log('[Test 4] Verificando handshake /auth/connect, autorización Bearer y ejecución MCP en streamLlmPhase...')
  const originalFetch = globalThis.fetch
  let authConnectPayload: Record<string, unknown> | null = null
  let userApprovedInTether = false
  let mcpToolCalledWithArgs: Record<string, unknown> | null = null
  let mcpToolAuthHeader: string | null = null
  let llmCallCount = 0

  const existingServers = await listMcpServers()
  for (const s of existingServers) {
    if (s.id) await deleteMcpServer(s.id)
  }
  await addMcpServer({
    name: 'tether',
    url: 'http://localhost:7432/sse',
    agentId: 'localloop-agent-handlebar',
    agentName: 'LocalLoop Handlebar Agent',
    workspace: 'c:/Users/alvar/git/localloop',
  })
  clearMcpCapabilityCache(true)

  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
      const bodyText = typeof init?.body === 'string' ? init.body : ''
      const headersObj = (init?.headers ?? {}) as Record<string, string>
      const authHeader = headersObj['Authorization'] ?? headersObj['authorization'] ?? null

      // Endpoint de autenticación de Tether: POST /auth/connect
      if (url.includes('7432/auth/connect')) {
        authConnectPayload = JSON.parse(bodyText) as Record<string, unknown>
        // Simulamos que el usuario autoriza la petición tras la primera sonda
        setTimeout(() => {
          userApprovedInTether = true
        }, 40)
        return new Response(
          JSON.stringify({
            token: 'tether-secret-token-7432',
            status: 'pending_user_approval',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }

      // Mock del servidor MCP tether en puerto 7432 (exige Authorization: Bearer tether-secret-token-7432 y aprobación del usuario)
      if (url.includes('7432')) {
        if (authHeader !== 'Bearer tether-secret-token-7432' || !userApprovedInTether) {
          return new Response(
            JSON.stringify({
              error: 'missing or unapproved Authorization Bearer token',
              status: 401,
            }),
            { status: 401, headers: { 'Content-Type': 'application/json' } },
          )
        }

        if (bodyText.includes('"method":"tools/list"')) {
          const sseResp =
            'event: message\ndata: ' +
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'list-1',
              result: {
                tools: [
                  {
                    name: 'run_cli',
                    description: 'Ejecuta comandos CLI de construcción, validación y pruebas en el workspace',
                    inputSchema: {
                      type: 'object',
                      properties: { cmd: { type: 'string', description: 'Comando CLI a ejecutar' } },
                      required: ['cmd'],
                    },
                  },
                ],
              },
            }) +
            '\n\n'
          return new Response(sseResp, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }

        if (bodyText.includes('"method":"tools/call"')) {
          mcpToolAuthHeader = authHeader
          const parsedReq = JSON.parse(bodyText) as {
            params?: { name?: string; arguments?: Record<string, unknown> }
          }
          mcpToolCalledWithArgs = parsedReq.params?.arguments ?? null
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'call-1',
              result: {
                exitCode: 0,
                stdout: 'Build & Tests OK for The Handlebar Club',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
      }

      // Mock del endpoint LLM (/chat/completions)
      if (url.includes('/chat/completions')) {
        llmCallCount++
        if (llmCallCount === 1) {
          assert(
            bodyText.includes('mcp_tether_run_cli'),
            'La petición al LLM debe publicar la herramienta mcp_tether_run_cli asignada al rol',
          )
          const sseChunk =
            'data: ' +
            JSON.stringify({
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_mcp_1',
                        type: 'function',
                        function: {
                          name: 'mcp_tether_run_cli',
                          arguments: JSON.stringify({ cmd: 'pnpm test && pnpm build' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }) +
            '\n\ndata: [DONE]\n\n'
          return new Response(sseChunk, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        } else {
          assert(
            bodyText.includes('Build & Tests OK for The Handlebar Club'),
            'La segunda iteración del LLM debe recibir el resultado devuelto por el servidor MCP',
          )
          const sseFinal =
            'data: ' +
            JSON.stringify({
              choices: [
                {
                  delta: {
                    content: 'Validación CLI completada con éxito mediante MCP tether.',
                  },
                },
              ],
            }) +
            '\n\ndata: [DONE]\n\n'
          return new Response(sseFinal, {
            status: 200,
            headers: { 'Content-Type': 'text/event-stream' },
          })
        }
      }

      return new Response('{}', { status: 200 })
    }) as typeof fetch

    const report = await analyzeAndAssignMcpCapabilities({
      forceRefresh: true,
      authContext: {
        agentId: 'localloop-agent-handlebar',
        agentName: 'LocalLoop Handlebar Agent',
        workspace: 'c:/Users/alvar/git/localloop',
        pollIntervalMs: 25,
        approvalTimeoutMs: 2000,
      },
    })

    assert(
      authConnectPayload?.agent_id === 'localloop-agent-handlebar' &&
        authConnectPayload?.agent_name === 'LocalLoop Handlebar Agent' &&
        authConnectPayload?.workspace === 'c:/Users/alvar/git/localloop',
      `El payload enviado a /auth/connect no coincide: ${JSON.stringify(authConnectPayload)}`,
    )
    assert(report.tools.length === 1, 'Debe descubrir la herramienta mcp_tether_run_cli tras la autorización')
    assert(
      report.roleAssignments['Component_Implementer'].specs.some(
        (s) => s.function.name === 'mcp_tether_run_cli',
      ),
      'Component_Implementer debe tener asignada mcp_tether_run_cli',
    )

    const phaseResult = await streamLlmPhase({
      sessionId: undefined,
      phaseName: 'Fase 3.1: Construcción de comp_booking_engine — [Skill: Component_Implementer]',
      sdlcPhase: '3_COMPONENT_CONSTRUCTION',
      roleId: 'Component_Implementer',
      systemPrompt: 'Implementa y valida el componente.',
      userPrompt: 'Construye comp_booking_engine y valida con CLI.',
      defaultFallback: () => ({ content: 'fallback' }),
    })

    assert(
      mcpToolAuthHeader === 'Bearer tether-secret-token-7432',
      `tools/call debe incluir cabecera Authorization Bearer, recibido: ${mcpToolAuthHeader}`,
    )
    assert(
      mcpToolCalledWithArgs?.cmd === 'pnpm test && pnpm build',
      `Se esperaba invocación a MCP con cmd="pnpm test && pnpm build", obtenido: ${JSON.stringify(mcpToolCalledWithArgs)}`,
    )
    assert(
      phaseResult.content.includes('Validación CLI completada con éxito mediante MCP tether'),
      'streamLlmPhase debe retornar la síntesis final tras ejecutar la herramienta MCP',
    )
    console.log('✓ Handshake /auth/connect, espera de autorización de usuario y ejecución con Bearer token verificados.')
  } finally {
    globalThis.fetch = originalFetch
    clearMcpCapabilityCache(true)
  }

  console.log('=== Todas las pruebas de capacidades MCP y asignación por roles pasaron exitosamente ===')
}

runMcpCapabilityAssignmentTests().catch((err) => {
  console.error('❌ Fallo en tests/mcp-capability-assignment.test.ts:', err)
  process.exit(1)
})
