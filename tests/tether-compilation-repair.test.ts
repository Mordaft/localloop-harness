import { node_phase4_business_compile } from '../src/agent/sdlc/nodes/phase4-e2e-audit'
import {
  validateAndCleanWorkspaceImports,
  verifyAndRepairApplicationCompilation,
} from '../src/agent/sdlc/verification/compilation-verifier'
import type { SDLCStateType } from '../src/agent/sdlc-state'
import {
  analyzeAndAssignMcpCapabilities,
  clearMcpCapabilityCache,
  executeCliViaMcp,
  findCliExecutionTool,
  isTetherAvailable,
  type McpToolDefinition,
} from '../src/mcp/mcp-client'
import {
  clearVirtualFiles,
  readWorkspaceFile,
  writeWorkspaceFileDirect,
} from '../src/fs/workspace-fs'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function runTetherCompilationRepairTests(): Promise<void> {
  console.log('=== Iniciando pruebas de Verificación de Compilación y Auto-Reparación con Tether CLI ===\n')

  const originalFetch = globalThis.fetch
  clearVirtualFiles()
  clearMcpCapabilityCache()

  const tetherToolDef: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7434/mcp',
    name: 'run_cli',
    qualifiedName: 'mcp_tether_run_cli',
    description: '[MCP: tether] Ejecuta comandos CLI de compilación y pruebas en el sistema anfitrión',
    inputSchema: {
      type: 'object',
      properties: {
        cmd: { type: 'string', description: 'Comando shell a ejecutar en el workspace' },
      },
      required: ['cmd'],
    },
  }

  // -------------------------------------------------------------------------------------
  // [Test 1] Detección de Tether y ejecución de comandos CLI adaptativa
  // -------------------------------------------------------------------------------------
  console.log('[Test 1] Verificando detección de Tether y ejecución CLI adaptativa (mcp_tether_run_cli)...')
  
  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherToolDef],
    forceRefresh: true,
  })

  assert(isTetherAvailable() === true, 'isTetherAvailable() debe ser true al existir tether')
  const cliTool = findCliExecutionTool()
  assert(Boolean(cliTool), 'findCliExecutionTool() debe encontrar mcp_tether_run_cli')
  assert(cliTool?.qualifiedName === 'mcp_tether_run_cli', 'El nombre cualificado debe coincidir')

  // Mock fetch para tools/call
  let mcpCallArgs: any = null
  let mcpCallCount = 0
  let mockExitCode = 0
  let mockOutput = 'vite v5.0.0 building for production...\n✓ built in 140ms'

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''

    if (url.includes('7434') && bodyText.includes('tools/call')) {
      mcpCallCount++
      const parsed = JSON.parse(bodyText)
      mcpCallArgs = parsed.params?.arguments
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: parsed.id || 'call-1',
          result: {
            exitCode: mockExitCode,
            stdout: mockExitCode === 0 ? mockOutput : '',
            stderr: mockExitCode !== 0 ? mockOutput : '',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  const execSuccess = await executeCliViaMcp('npx vite build')
  assert(execSuccess.ok === true, 'executeCliViaMcp debe devolver ok: true cuando exitCode es 0')
  assert(mcpCallArgs?.cmd === 'npx vite build', 'Debe pasar el comando bajo la propiedad "cmd"')
  assert(execSuccess.output.includes('vite v5.0.0'), 'Debe capturar la salida stdout')

  // Probar ejecución fallida
  mockExitCode = 1
  mockOutput = 'src/main.ts(2,20): error TS2307: Cannot find module "./services/api"'
  const execFail = await executeCliViaMcp('npx vite build')
  assert(execFail.ok === false, 'executeCliViaMcp debe devolver ok: false cuando exitCode es 1')
  assert(execFail.exitCode === 1, 'Debe registrar exitCode 1')
  assert(execFail.output.includes('error TS2307'), 'Debe capturar el error de compilación')
  console.log('✓ Detección de Tether y ejecución CLI adaptativa verificadas con éxito.')

  // -------------------------------------------------------------------------------------
  // [Test 2] Limpieza y sanitización estática previa de imports
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 2] Verificando limpieza estática previa de imports y configuración Vite...')
  await writeWorkspaceFileDirect(
    'vite.config.ts',
    `import { defineConfig } from 'vite';\nexport default defineConfig({ test: { globals: true } });`,
  )
  await writeWorkspaceFileDirect(
    'src/main.ts',
    `import { HTMLElement } from 'dom';\nimport { bootstrap } from './app';\nbootstrap();`,
  )

  const cleaned = await validateAndCleanWorkspaceImports()
  assert(cleaned.includes('vite.config.ts'), 'Debe corregir vite.config.ts')
  assert(cleaned.includes('src/main.ts'), 'Debe corregir src/main.ts')

  const readVite = await readWorkspaceFile('vite.config.ts')
  assert(
    readVite.content.includes('/// <reference types="vitest" />'),
    'Debe haber inyectado la referencia de tipos de vitest en vite.config.ts',
  )
  const readMain = await readWorkspaceFile('src/main.ts')
  assert(!readMain.content.includes("from 'dom'"), "Debe haber eliminado import hallucinado from 'dom'")
  console.log('✓ Limpieza estática previa verificada.')

  // -------------------------------------------------------------------------------------
  // [Test 3] Bucle completo de auto-reparación asistido por LLM y Tether CLI
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 3] Verificando bucle de auto-reparación asistido por LLM ante errores de compilación...')
  
  await writeWorkspaceFileDirect(
    'src/components/counter.ts',
    `export class Counter { constructor() { this.brokenSyntax = ; } }`,
  )

  const testState: SDLCStateType = {
    sessionId: 777,
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    activeSkill: 'BusinessOutcome_Auditor',
    useCases: [{ id: 'UC-1', title: 'Contador Interactivo', expectedBusinessOutcome: 'Funciona' }],
    componentsGraph: {
      comp_counter: {
        id: 'comp_counter',
        name: 'Contador',
        description: 'Componente contador',
        status: 'CONSTRUCTED',
        targetPath: 'src/components/counter.ts',
        files: [
          {
            path: 'src/components/counter.ts',
            content: `export class Counter { constructor() { this.brokenSyntax = ; } }`,
          },
        ],
      },
    },
    frameworkConfig: {
      framework: 'HTML5 + TypeScript + Vite',
      bundler: 'vite',
      packageManager: 'npm',
      buildCommand: 'npx vite build',
    },
    technicalDebtList: [],
    progressEvents: [],
    unitEvidences: {},
    messages: [],
  }

  // Simular: primer intento de Tether falla con error TS, LLM responde con corrección, segundo intento de Tether pasa
  let tetherIteration = 0
  let llmRepaired = false

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''

    // Tether CLI
    if (url.includes('7434') && bodyText.includes('tools/call')) {
      tetherIteration++
      if (tetherIteration === 1) {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'call-1',
            result: {
              exitCode: 1,
              stderr: `src/components/counter.ts:1:51 - error TS1109: Expression expected.`,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      } else {
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'call-2',
            result: {
              exitCode: 0,
              stdout: `vite v5.0.0 building for production...\n✓ built in 120ms\nApplication build succeeded!`,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
    }

    // LLM Repair Stream
    if (url.includes('/chat/completions')) {
      llmRepaired = true
      const repairedCode = `export class Counter {\n  public count: number = 0;\n  constructor() {\n    this.count = 0;\n  }\n  public mount(el: HTMLElement): void {\n    el.innerHTML = '<button id="btn">Click</button>';\n  }\n}`
      const sseResp = [
        'data: ' +
          JSON.stringify({
            id: 'repair-1',
            choices: [
              {
                delta: {
                  content: `He corregido el archivo con error de sintaxis:\n\`\`\`typescript path="src/components/counter.ts"\n${repairedCode}\n\`\`\``,
                },
                finish_reason: 'stop',
              },
            ],
          }),
        'data: [DONE]',
        '',
      ].join('\n\n')

      return new Response(sseResp, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200 })
  }) as typeof fetch

  const repairResult = await verifyAndRepairApplicationCompilation(testState, { maxRepairIterations: 3 })

  assert(repairResult.ok === true, 'El bucle de compilación debe terminar exitosamente tras la auto-reparación')
  assert(repairResult.usedTether === true, 'Debe haber usado Tether CLI')
  assert(repairResult.attempts === 2, `Debe haber tomado 2 intentos (tomó ${repairResult.attempts})`)
  assert(repairResult.repairedFiles.includes('src/components/counter.ts'), 'Debe incluir counter.ts en repairedFiles')
  assert(llmRepaired === true, 'El LLM debe haber intervenido en la auto-reparación')

  // Verificar que el archivo en workspace y en el grafo está actualizado
  const updatedFile = await readWorkspaceFile('src/components/counter.ts')
  assert(updatedFile.content.includes('public count: number = 0'), 'El archivo en workspace debe contener el código reparado')
  const graphFile = testState.componentsGraph['comp_counter'].files?.find((f) => f.path === 'src/components/counter.ts')
  assert(Boolean(graphFile?.content.includes('public count: number = 0')), 'El grafo de componentes debe reflejar el código reparado')
  console.log('✓ Bucle de auto-reparación de compilación verificado exitosamente.')

  // -------------------------------------------------------------------------------------
  // [Test 4] Integración en Phase 4: Aprobación HITL y balance de deuda técnica
  // -------------------------------------------------------------------------------------
  console.log('\n[Test 4] Verificando integración en node_phase4_business_compile...')
  
  // Si la compilación es exitosa con Tether:
  tetherIteration = 1 // devolverá exitCode 0 directamente
  const compileRes = await node_phase4_business_compile(testState)
  assert(compileRes.currentPhase === '4_E2E_BUSINESS_AUDIT', 'Debe permanecer en Fase 4')
  assert(Boolean(compileRes.frameworkConfig?.startScriptsGenerated), 'Debe haber generado scripts de arranque')

  // Comprobar que en startFiles y workspace existen start.cmd, start.sh y NO existe index.html generado por Fase 4
  const startCmd = await readWorkspaceFile('start.cmd')
  assert(Boolean(startCmd.content), 'start.cmd debe existir')
  const startSh = await readWorkspaceFile('start.sh')
  assert(Boolean(startSh.content), 'start.sh debe existir')
  const rootIndex = await readWorkspaceFile('index.html').catch(() => null)
  assert(rootIndex === null, 'node_phase4_business_compile NO debe generar index.html en la raíz')

  // Ahora probar si Tether falla persistente: se debe registrar deuda técnica y transicionar a Resiliencia (Fase 5)
  const failingState: SDLCStateType = {
    ...testState,
    technicalDebtList: [],
  }
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const bodyText = typeof init?.body === 'string' ? init.body : ''
    if (url.includes('7434') && bodyText.includes('tools/call')) {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'fail-always',
          result: { exitCode: 1, stderr: 'Fatal compiler crash' },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }
    return new Response(JSON.stringify({ choices: [{ delta: { content: '' }, finish_reason: 'stop' }] }), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }) as typeof fetch

  const failCompileRes = await node_phase4_business_compile(failingState)
  assert(
    failingState.technicalDebtList.some((d) => d.id === 'td-compilation-failure'),
    'Debe registrar deuda técnica "td-compilation-failure" cuando la compilación falla con Tether',
  )
  assert(
    failCompileRes.currentPhase === '5_STRATEGIC_RESILIENCE',
    'Debe transicionar a 5_STRATEGIC_RESILIENCE ante fallo persistente de compilación',
  )
  console.log('✓ Integración en node_phase4_business_compile y redirección a Resiliencia verificada.')

  // Restaurar fetch original
  globalThis.fetch = originalFetch
  console.log('\n=== ¡Todas las pruebas de Verificación y Reparación de Compilación con Tether pasaron exitosamente! ===')
}

void runTetherCompilationRepairTests().catch((err) => {
  console.error('Error en pruebas de Tether y Compilación:', err)
  process.exit(1)
})
