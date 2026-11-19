import { executeFileSystemTool } from '../src/fs/fs-tools'
import {
  analyzeAndAssignMcpCapabilities,
  clearMcpCapabilityCache,
  executeCliViaMcp,
  callMcpTool,
  type McpToolDefinition,
} from '../src/mcp/mcp-client'
import { getTraceEntries, clearDiagnostics } from '../src/diagnostics'
import { streamLlmPhase } from '../src/agent/sdlc/execution/llm-phase-streamer'
import { verifyAndRepairApplicationCompilation } from '../src/agent/sdlc/verification/compilation-verifier'
import { registerSessionCallbacks } from '../src/agent/agent-graph'
import {
  appendSessionMessage,
  listSessionMessages,
  createSession,
  resetDatabaseAndCache,
} from '../src/memory/app-db'
import { clearVirtualFiles, writeWorkspaceFileDirect } from '../src/fs/workspace-fs'
import { FsWriteMode, SessionStatus } from '../src/enums'
import type { SDLCStateType } from '../src/agent/sdlc-state'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function runToolMonitoringAndTracingTests(): Promise<void> {
  console.log('=== Iniciando pruebas de Monitorización y Trazabilidad Integral de Herramientas (Tether, FS, MCP) ===\n')

  const originalFetch = globalThis.fetch
  clearDiagnostics()
  clearVirtualFiles()
  clearMcpCapabilityCache()

  const sessionId = await createSession({
    title: 'Sesión de Prueba de Monitorización',
    goal: 'Verificar trazas y mensajes de herramientas',
    skill: 'sdlc',
  })

  // -------------------------------------------------------------------------------------
  // [Test 1] Trazas estructuradas de herramientas de Filesystem (fs.tool.start / fs.tool.complete)
  // -------------------------------------------------------------------------------------
  console.log('[Test 1] Verificando trazas de ejecución en executeFileSystemTool...')
  clearDiagnostics()

  await executeFileSystemTool(
    'fs_write_file',
    { path: 'src/test.txt', content: 'hola mundo', reason: 'prueba de trazas' },
    { sessionId, fsWriteMode: FsWriteMode.AUTO },
  )

  const tracesFsWrite = getTraceEntries()
  const startTrace = tracesFsWrite.find((t) => t.step === 'fs.tool.start')
  const completeTrace = tracesFsWrite.find((t) => t.step === 'fs.tool.complete')

  assert(Boolean(startTrace), 'Debe emitir traza fs.tool.start')
  assert(startTrace?.detail?.toolName === 'fs_write_file', 'fs.tool.start debe registrar toolName')
  assert(Boolean(completeTrace), 'Debe emitir traza fs.tool.complete')
  assert(typeof completeTrace?.elapsedMs === 'number', 'fs.tool.complete debe medir tiempo elapsedMs')
  console.log('✓ Trazas de filesystem (fs.tool.start / fs.tool.complete) emitidas correctamente.')

  // -------------------------------------------------------------------------------------
  // [Test 2] Trazas detalladas de Tether CLI y MCP (tether.execute.* / tether.cli.*)
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 2] Verificando trazas de Tether CLI (tether.execute.start, tether.cli.start, etc.)...')
  clearDiagnostics()

  const tetherTool: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7434/mcp',
    name: 'run_cli',
    qualifiedName: 'mcp_tether_run_cli',
    description: '[MCP: tether] Ejecuta comandos CLI anfitrión',
    inputSchema: {
      type: 'object',
      properties: { cmd: { type: 'string' } },
      required: ['cmd'],
    },
  }

  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherTool],
    forceRefresh: true,
  })

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    if (url.includes('7434') && bodyText.includes('tools/call')) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-call',
          result: { exitCode: 0, stdout: 'build ok in 250ms' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  const cliRes = await executeCliViaMcp('pnpm build')
  assert(cliRes.ok === true, 'executeCliViaMcp debe ser ok')

  const tracesTether = getTraceEntries()
  assert(
    tracesTether.some((t) => t.step === 'tether.execute.start'),
    'Debe emitir traza tether.execute.start',
  )
  assert(
    tracesTether.some((t) => t.step === 'tether.cli.start'),
    'Debe emitir traza tether.cli.start en callMcpTool',
  )
  assert(
    tracesTether.some((t) => t.step === 'tether.cli.complete'),
    'Debe emitir traza tether.cli.complete en callMcpTool',
  )
  assert(
    tracesTether.some((t) => t.step === 'tether.execute.complete'),
    'Debe emitir traza tether.execute.complete',
  )
  console.log('✓ Trazas de Tether CLI emitidas con éxito.')

  // -------------------------------------------------------------------------------------
  // [Test 3] Monitorización en streamLlmPhase: mensajes role: 'tool' y callbacks onThinking
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 3] Verificando emisión de mensajes role: "tool" y callbacks onThinking en streamLlmPhase...')
  clearDiagnostics()

  const capturedThinking: any[] = []
  let stepUpdateCalled = false

  registerSessionCallbacks(sessionId, {
    onThinking: (info) => capturedThinking.push(info),
    onStepUpdate: () => {
      stepUpdateCalled = true
    },
  })

  // Simular LLM respondiendo con tool call a fs_list_dir
  let mockLlmCall = 0
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    if (url.includes('/chat/completions')) {
      mockLlmCall++
      if (mockLlmCall === 1) {
        const sse = [
          'data: ' +
            JSON.stringify({
              id: 'c-1',
              choices: [
                {
                  delta: {
                    tool_calls: [
                      {
                        index: 0,
                        id: 'call_fs_1',
                        type: 'function',
                        function: {
                          name: 'fs_list_dir',
                          arguments: JSON.stringify({ filterPrefix: 'src' }),
                        },
                      },
                    ],
                  },
                },
              ],
            }),
          'data: [DONE]',
          '',
        ].join('\n\n')
        return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      } else {
        const sse = [
          'data: ' +
            JSON.stringify({
              id: 'c-2',
              choices: [
                {
                  delta: { content: 'Archivos listados.' },
                  finish_reason: 'stop',
                },
              ],
            }),
          'data: [DONE]',
          '',
        ].join('\n\n')
        return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } })
      }
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  const streamRes = await streamLlmPhase({
    sessionId,
    phaseName: 'Prueba de Stream con Herramientas',
    sdlcPhase: '3_COMPONENT_CONSTRUCTION',
    systemPrompt: 'Eres un agente de prueba.',
    userPrompt: 'Lista los archivos en src.',
    tools: [
      {
        type: 'function',
        function: {
          name: 'fs_list_dir',
          description: 'Lista archivos',
          parameters: { type: 'object', properties: {} },
        },
      },
    ],
    defaultFallback: () => ({ content: 'Fallback' }),
  })

  assert(streamRes.toolCalls.length === 1, 'Debe haber ejecutado 1 tool call')
  assert(streamRes.toolCalls[0].name === 'fs_list_dir', 'La herramienta debe ser fs_list_dir')

  // Comprobar que onThinking se activó con executing_tools
  const execToolsThinking = capturedThinking.find((t) => t.phase === 'executing_tools')
  assert(Boolean(execToolsThinking), 'onThinking debe recibir phase: "executing_tools"')
  assert(execToolsThinking?.activeTool === 'fs_list_dir', 'activeTool debe ser "fs_list_dir"')

  // Comprobar que se emitió traza tool.execute.start y tool.execute.complete
  const streamTraces = getTraceEntries()
  assert(
    streamTraces.some((t) => t.step === 'tool.execute.start'),
    'Debe registrar tool.execute.start en diagnósticos',
  )
  assert(
    streamTraces.some((t) => t.step === 'tool.execute.complete'),
    'Debe registrar tool.execute.complete en diagnósticos',
  )

  // Comprobar que el mensaje con role: "tool" se persistió en app-db para la sesión
  const sessionMessages = await listSessionMessages(sessionId)
  const toolMsg = sessionMessages.find((m) => m.role === 'tool' && m.toolName === 'fs_list_dir')
  assert(Boolean(toolMsg), 'Debe persistirse un mensaje con role: "tool" y toolName: "fs_list_dir" en la sesión')
  assert(Boolean(toolMsg?.content), 'El mensaje de herramienta debe contener la salida de ejecución')
  assert(stepUpdateCalled === true, 'onStepUpdate debe ser llamado para refrescar la UI')
  console.log('✓ Mensaje de herramienta persistido en sesión y monitorización reactiva confirmada.')

  // -------------------------------------------------------------------------------------
  // [Test 4] Verificación de Tether en verifyAndRepairApplicationCompilation con registro de sesión
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 4] Verificando persistencia de mensajes de Tether en verifyAndRepairApplicationCompilation...')
  
  const testState: SDLCStateType = {
    sessionId,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    activeSkill: 'BusinessOutcome_Auditor',
    useCases: [{ id: 'UC-1', title: 'Test', expectedBusinessOutcome: 'OK' }],
    componentsGraph: {},
    frameworkConfig: {
      framework: 'HTML5 + TypeScript + Vite',
      buildCommand: 'npx vite build',
    },
    technicalDebtList: [],
    progressEvents: [],
    unitEvidences: {},
    messages: [],
  }

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    if (url.includes('7434') && bodyText.includes('tools/call')) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'tether-verify',
          result: { exitCode: 0, stdout: 'Application compiled cleanly with Vite' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  const verifyRes = await verifyAndRepairApplicationCompilation(testState)
  assert(verifyRes.ok === true, 'verifyAndRepairApplicationCompilation debe ser ok')
  assert(verifyRes.usedTether === true, 'Debe haber usado Tether')

  const updatedMessages = await listSessionMessages(sessionId)
  const tetherMsg = updatedMessages.find(
    (m) => m.role === 'tool' && m.toolName === 'mcp_tether_run_cli',
  )
  assert(Boolean(tetherMsg), 'Debe existir un mensaje role: "tool" de Tether en la sesión')
  assert(
    tetherMsg?.content.includes('[Tether CLI] Comando: "npx vite build"'),
    'El mensaje debe documentar el comando real ejecutado',
  )
  assert(
    tetherMsg?.content.includes('Application compiled cleanly with Vite'),
    'El mensaje debe incluir la salida capturada de Tether',
  )
  console.log('✓ Ejecución de Tether registrada como mensaje visible de herramienta en la monitorización de sesión.')

  // Restaurar fetch
  globalThis.fetch = originalFetch
  console.log('\n=== ¡Todas las pruebas de Monitorización y Trazabilidad de Herramientas pasaron exitosamente! ===')
}

void runToolMonitoringAndTracingTests().catch((err) => {
  console.error('Error en pruebas de Monitorización y Trazas:', err)
  process.exit(1)
})
