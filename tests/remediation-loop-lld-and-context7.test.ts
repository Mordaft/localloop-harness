import assert from 'node:assert'
import {
  validateExecutionWithLld,
  detectStaticErrorSignals,
  KNOWN_CLI_ERROR_PATTERNS,
} from '../src/agent/sdlc/verification/lld-execution-validator'
import {
  verifyAndRepairApplicationCompilation,
  validateAndCleanWorkspaceImports,
} from '../src/agent/sdlc/verification/compilation-verifier'
import {
  buildUniversalScaffold,
  assembleScaffoldDefinition,
} from '../src/agent/sdlc/scaffold/scaffold-engine'
import {
  analyzeAndAssignMcpCapabilities,
  buildRoleMcpPromptSupplementFromAssignment,
  clearMcpCapabilityCache,
  clearTetherActiveSessions,
  ensureTetherSession,
  executeCliViaMcp,
  findCliExecutionTool,
  findContext7Tools,
  getTetherActiveSessionId,
  isContext7Available,
  isContext7Configured,
  isContext7Server,
  isTetherAvailable,
  setTetherActiveSessionId,
  type McpToolDefinition,
} from '../src/mcp/mcp-client'
import {
  clearVirtualFiles,
  getVirtualFile,
  writeWorkspaceFileDirect,
} from '../src/fs/workspace-fs'
import type { SDLCStateType, UniversalProjectScaffold } from '../src/agent/sdlc-state'

async function runRemediationLoopLldAndContext7Tests(): Promise<void> {
  console.log('=== Iniciando Pruebas de Auto-Remediación con Validación LLD y Uso Mandatorio de Context7 ===\n')

  clearVirtualFiles()
  clearMcpCapabilityCache()

  // -------------------------------------------------------------------------------------
  // Test 1: Detección estática de errores cuando exitCode es 0 pero el texto apunta a un fallo
  // -------------------------------------------------------------------------------------
  console.log('[Test 1] Verificando detección de errores cuando exitCode es 0 pero la salida contiene fallos...')

  const errorOutputs = [
    { text: 'npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path /package.json', expected: 'Error de gestor de paquetes npm/pnpm/yarn' },
    { text: 'sh: line 1: vite: not found', expected: 'Herramienta de compilación no encontrada' },
    { text: "'vite' is not recognized as an internal or external command", expected: 'Comando o ejecutable no encontrado' },
    { text: '[vite]: Rollup failed to resolve import "lucide-react" from "src/main.ts"', expected: 'Error de empaquetado de Rollup' },
    { text: 'src/main.ts(1,1): error TS2307: Cannot find module "dexie"', expected: 'Error de tipos o sintaxis de TypeScript' },
    { text: 'TypeError: Cannot read properties of undefined (reading "call")', expected: 'Excepción de sintaxis o tipo en tiempo de ejecución' },
    { text: 'fatal error: runtime: out of memory', expected: 'Pánico o error fatal en runtime nativo' },
    { text: 'Tests: 1 failed, 2 passed, 3 total', expected: 'Fallo en batería de pruebas' },
    { text: 'npm error Missing script: "build"', expected: 'Error de gestor de paquetes npm/pnpm/yarn' },
  ]

  for (const item of errorOutputs) {
    const check = detectStaticErrorSignals(item.text, 0)
    assert.strictEqual(
      check.hasErrors,
      true,
      `Debe detectar error en: "${item.text.slice(0, 40)}" a pesar de exitCode 0`,
    )
  }

  const cleanOutput = 'vite v5.4.0 building for production...\n✓ 12 modules transformed.\ndist/index.html 0.45 kB\ndist/assets/index.js 12.30 kB\n✓ built in 150ms'
  const cleanCheck = detectStaticErrorSignals(cleanOutput, 0)
  assert.strictEqual(cleanCheck.hasErrors, false, 'Salida limpia no debe disparar señales de error')
  console.log('✓ Detección estática de errores verificada correctamente.')

  // -------------------------------------------------------------------------------------
  // Test 2: Validación LLD ("Respecto a la ejecución para validar XXX, esta es la salida...")
  // -------------------------------------------------------------------------------------
  console.log('[Test 2] Verificando validador LLD de ejecución con semántica de negocio...')

  // Simular cuando Tether ejecutó el comando (exitCode 0) pero la salida apunta a un error de dependencia
  const lldFailResult = await validateExecutionWithLld({
    command: 'npm run build',
    output: 'npm ERR! code ENOENT\nnpm ERR! syscall open\nnpm ERR! path /package.json',
    exitCode: 0,
    expectedPurpose: 'Compilación de producción de la aplicación',
    customValidator: async ({ command, output, exitCode }) => {
      // Simula el dictamen riguroso del LLD
      assert.ok(command.includes('npm run build'), 'Debe recibir el comando evaluado')
      assert.ok(output.includes('npm ERR!'), 'Debe recibir la salida de la terminal')
      return {
        isValid: false,
        reason: 'La salida de Tether apunta a un error crítico de npm (ENOENT: package.json no encontrado) a pesar de haber retornado código de salida 0.',
        detectedErrors: ['package.json ausente', 'npm ERR! code ENOENT'],
        suggestedRemedy: 'Generar el package.json antes de ejecutar el build.',
        validatedBy: 'custom_validator',
      }
    },
  })

  assert.strictEqual(lldFailResult.isValid, false, 'El LLD debe declarar la validación como no válida')
  assert.ok(lldFailResult.reason.includes('apunta a un error crítico de npm'), 'Debe incluir la razón del LLD')
  assert.strictEqual(lldFailResult.validatedBy, 'custom_validator')

  // Validar ejecución exitosa con LLD
  const lldPassResult = await validateExecutionWithLld({
    command: 'npx vite build',
    output: cleanOutput,
    exitCode: 0,
    expectedPurpose: 'Compilación limpia con Vite',
    customValidator: async () => ({
      isValid: true,
      reason: 'La salida encaja perfectamente con el resultado esperado de Vite build.',
      validatedBy: 'custom_validator',
    }),
  })

  assert.strictEqual(lldPassResult.isValid, true, 'El LLD debe validar positivamente la compilación limpia')
  console.log('✓ Validador semántico LLD verificado exitosamente.')

  // -------------------------------------------------------------------------------------
  // Test 3: executeCliViaMcp rechaza ejecuciones con Tether cuando el texto apunta a un fallo
  // -------------------------------------------------------------------------------------
  console.log('[Test 3] Verificando executeCliViaMcp ante salidas con errores y exitCode 0...')

  const tetherToolDef: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7432/sse',
    name: 'run_cli',
    qualifiedName: 'mcp_tether_run_cli',
    description: '[MCP: tether] Ejecuta comandos en el host',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
      },
    },
  }

  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherToolDef],
    forceRefresh: true,
  })

  const originalFetch = globalThis.fetch
  try {
    // Simular que Tether devuelve exitCode 0 pero el texto contiene 'Rollup failed to resolve import'
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-tether-1',
          result: {
            exitCode: 0,
            stdout: '[vite]: Rollup failed to resolve import "nonexistent" from "src/main.ts"',
            stderr: '',
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    const execRes = await executeCliViaMcp('npx vite build')
    assert.strictEqual(
      execRes.ok,
      false,
      'executeCliViaMcp debe devolver ok: false cuando la salida contiene "Rollup failed", incluso con exitCode 0',
    )
    assert.ok(execRes.output.includes('Rollup failed'), 'Debe conservar la salida completa')
    console.log('✓ executeCliViaMcp rechaza falsos positivos de Tether exitosamente.')
  } finally {
    globalThis.fetch = originalFetch
  }

  // -------------------------------------------------------------------------------------
  // Test 4: Bucle de Scaffolding con Tether rechazado por salida errónea y corregido por LLD
  // -------------------------------------------------------------------------------------
  console.log('[Test 4] Verificando bucle de scaffolding iterativo con rechazo por LLD en intento 1...')
  clearVirtualFiles()

  let scaffoldAttempt = 0
  const validProposal: Partial<UniversalProjectScaffold> = {
    runtime: 'node',
    archetype: 'API_SERVICE',
    hasUI: false,
    frameworkTitle: 'Fastify Microservice',
    componentDirectory: 'src/modules',
    serviceDirectory: 'src/services',
    testDirectory: 'tests',
    manifestFiles: [
      { path: 'package.json', content: '{"name":"fastify-app","version":"1.0.0"}', purpose: 'Manifiesto' },
    ],
    configFiles: [
      { path: 'tsconfig.json', content: '{"compilerOptions":{"target":"es2022"}}', purpose: 'TSConfig' },
    ],
    skeletonFiles: [
      { path: 'src/index.ts', content: 'console.log("ready");', purpose: 'Entry' },
    ],
    lifecycle: {
      setupCmd: '@echo off\ncall npm install',
      setupSh: '#!/usr/bin/env bash\nnpm install',
      startCmd: '@echo off\nnode dist/index.js',
      startSh: '#!/usr/bin/env bash\nnode dist/index.js',
      testCmd: 'npm test',
      testSh: 'npm test',
    },
  }

  const scaffoldResult = await buildUniversalScaffold({
    proposedScaffold: validProposal,
    initiativeTitle: 'Fastify App',
    executeCommand: async (cmd) => {
      scaffoldAttempt++
      if (scaffoldAttempt === 1) {
        // Tether ejecutó el comando y devolvió exitCode 0, pero el texto dice 'npm ERR! missing dependency'
        return {
          ok: false,
          output: 'npm ERR! code ENOENT\nnpm ERR! missing dependency fastify in package.json',
          exitCode: 0,
        }
      }
      return {
        ok: true,
        output: 'added 25 packages in 0.5s\nup to date',
        exitCode: 0,
      }
    },
    validateWithLld: async ({ command, output, exitCode }) => {
      if (output.includes('npm ERR!')) {
        return {
          isValid: false,
          reason: 'La salida de la terminal contiene errores explícitos de dependencias en npm ERR!',
          validatedBy: 'custom_validator',
        }
      }
      return {
        isValid: true,
        reason: 'Dependencias instaladas y actualizadas correctamente.',
        validatedBy: 'custom_validator',
      }
    },
    repairScaffold: async ({ attempt, error, scaffold }) => {
      assert.strictEqual(attempt, 1, 'Auto-reparación llamada tras intento 1')
      assert.ok(error.includes('errores explícitos de dependencias'), 'Debe recibir el motivo del LLD')
      return {
        manifestFiles: [
          {
            path: 'package.json',
            content: '{"name":"fastify-app","dependencies":{"fastify":"^4.28.0"}}',
            purpose: 'Manifiesto reparado con dependencias vigentes',
          },
        ],
      }
    },
  })

  assert.strictEqual(scaffoldResult.validationResult?.ok, true, 'El scaffold debe terminar validado')
  assert.strictEqual(scaffoldResult.validationResult?.attempts, 2, 'Debe haber requerido 2 intentos debido al rechazo del LLD')
  assert.strictEqual(scaffoldAttempt, 2, 'Debe haber ejecutado el comando 2 veces')
  console.log('✓ Bucle de auto-remediación de scaffolding gobernado por LLD verificado exitosamente.')

  // -------------------------------------------------------------------------------------
  // Test 5: Verificación de compilación de app (Fase 4) con Tether y validación estricta LLD
  // -------------------------------------------------------------------------------------
  console.log('[Test 5] Verificando verifyAndRepairApplicationCompilation con Tether y LLD...')
  clearVirtualFiles()

  await writeWorkspaceFileDirect('src/main.ts', 'console.log("LocalLoop App");')

  let compileAttempt = 0
  const mockState: SDLCStateType = {
    messages: [],
    currentPhase: '4_E2E_BUSINESS_AUDIT',
    frameworkConfig: {
      framework: 'vite',
      bundler: 'vite',
      buildCommand: 'npx vite build',
    },
    componentsGraph: {
      comp_ui: {
        id: 'comp_ui',
        name: 'UI View',
        description: 'Componente UI',
        files: [{ path: 'src/main.ts', content: 'console.log("LocalLoop App");' }],
      },
    },
    sessionId: 777,
  } as any

  // Mock global fetch para Tether
  try {
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const bodyText = typeof init?.body === 'string' ? init.body : ''
      if (bodyText.includes('tools/call')) {
        compileAttempt++
        if (compileAttempt === 1) {
          // Tether reporta exitCode 0, pero la salida dice 'sh: line 1: vite: not found'
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: 'call-comp-1',
              result: {
                exitCode: 0,
                stdout: 'sh: line 1: vite: not found',
                stderr: '',
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
        // Segundo intento: compilación limpia
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: 'call-comp-2',
            result: {
              exitCode: 0,
              stdout: 'vite v5.4.0 building for production...\n✓ built in 110ms',
              stderr: '',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 })
    }) as typeof fetch

    const compVerifyRes = await verifyAndRepairApplicationCompilation(mockState, {
      maxRepairIterations: 2,
      validateWithLld: async ({ output }) => {
        if (output.includes('not found')) {
          return {
            isValid: false,
            reason: 'Vite no está instalado o no se encuentra en PATH.',
            validatedBy: 'custom_validator',
          }
        }
        return {
          isValid: true,
          reason: 'Compilación y arranque verificados limpiamente.',
          validatedBy: 'custom_validator',
        }
      },
    })

    assert.strictEqual(compVerifyRes.usedTether, true, 'Debe usar Tether CLI')
    assert.strictEqual(compileAttempt, 1, 'Intento 1 ejecutado con Tether')
    // El intento 1 fue rechazado por el LLD (Vite not found)
    assert.strictEqual(compVerifyRes.ok, false, 'No debe dar por válida la compilación cuando el texto indica "not found"')
    assert.ok(compVerifyRes.error?.includes('Vite no está instalado'), 'El error debe reflejar el dictamen del LLD')
    console.log('✓ verifyAndRepairApplicationCompilation detecta rechazo del LLD y no da por válida salida errónea.')
  } finally {
    globalThis.fetch = originalFetch
  }

  // -------------------------------------------------------------------------------------
  // Test 6: Asignación y uso obligatorio de Context7 en roles y suplemento de prompt
  // -------------------------------------------------------------------------------------
  console.log('[Test 6] Verificando asignación de Context7 y directivas de uso mandatorio...')
  clearMcpCapabilityCache()

  const ctx7Tool1: McpToolDefinition = {
    serverName: 'context7',
    serverUrl: 'https://mcp.context7.com/mcp',
    name: 'resolve-library-id',
    qualifiedName: 'mcp_context7_resolve_library_id',
    description: 'Resolves library name to Context7 identifier',
    inputSchema: { type: 'object', properties: { libraryName: { type: 'string' } } },
  }
  const ctx7Tool2: McpToolDefinition = {
    serverName: 'context7',
    serverUrl: 'https://mcp.context7.com/mcp',
    name: 'query-docs',
    qualifiedName: 'mcp_context7_query_docs',
    description: 'Queries documentation and code examples from official live libraries via Context7',
    inputSchema: { type: 'object', properties: { libraryId: { type: 'string' }, query: { type: 'string' } } },
  }

  const report = await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [ctx7Tool1, ctx7Tool2],
    forceRefresh: true,
  })

  assert.strictEqual(isContext7Available(report), true, 'isContext7Available debe ser true')
  const ctx7Tools = findContext7Tools(report)
  assert.strictEqual(ctx7Tools.length, 2, 'Debe encontrar las 2 herramientas de Context7')

  // Verificar que Context7 se asigna a todos los roles clave del SDLC
  const plannerAssignment = report.roleAssignments['GovernanceProject_Planner']
  const implementerAssignment = report.roleAssignments['Component_Implementer']
  const designerAssignment = report.roleAssignments['ComponentTechnical_Designer']
  const testerAssignment = report.roleAssignments['UnitTest_Engineer']
  const rcaAssignment = report.roleAssignments['RootCause_Analyzer']

  assert.ok(plannerAssignment?.tools.some((t) => t.tool.qualifiedName === 'mcp_context7_query_docs'), 'Planner debe tener Context7')
  assert.ok(implementerAssignment?.tools.some((t) => t.tool.qualifiedName === 'mcp_context7_query_docs'), 'Implementer debe tener Context7')
  assert.ok(designerAssignment?.tools.some((t) => t.tool.qualifiedName === 'mcp_context7_query_docs'), 'Designer debe tener Context7')
  assert.ok(testerAssignment?.tools.some((t) => t.tool.qualifiedName === 'mcp_context7_query_docs'), 'Tester debe tener Context7')
  assert.ok(rcaAssignment?.tools.some((t) => t.tool.qualifiedName === 'mcp_context7_query_docs'), 'RootCause_Analyzer debe tener Context7')

  // Verificar que buildRoleMcpPromptSupplementFromAssignment genera el mandato obligatorio de Context7
  const promptSupplement = buildRoleMcpPromptSupplementFromAssignment(implementerAssignment)
  assert.ok(
    promptSupplement.includes('INSTRUCCIÓN OBLIGATORIA: USO DE CONTEXT7 PARA DOCUMENTACIÓN OFICIAL VIVA Y DEPENDENCIAS ACTUALIZADAS'),
    'El system prompt dinámico debe incluir la directiva obligatoria de Context7',
  )
  assert.ok(
    promptSupplement.includes('mcp_context7_query_docs'),
    'El prompt supplement debe mencionar las herramientas de Context7 disponibles',
  )
  assert.ok(
    promptSupplement.includes('NUNCA adivines ni recurras a versiones o firmas de memoria para paquetes o frameworks modernos'),
    'El prompt supplement debe prohibir explícitamente usar APIs de memoria obsoletas',
  )

  console.log('✓ Asignación y directiva obligatoria de Context7 verificadas exitosamente.')

  // -------------------------------------------------------------------------------------
  // Test 7: Comprobación de configuración de Context7 en base de datos
  // -------------------------------------------------------------------------------------
  console.log('[Test 7] Verificando helper isContext7Configured...')

  assert.strictEqual(
    await isContext7Configured([
      { name: 'context7', url: 'https://mcp.context7.com/mcp', enabled: true } as any,
    ]),
    true,
    'isContext7Configured debe retornar true si existe servidor activo',
  )

  assert.strictEqual(
    await isContext7Configured([
      { name: 'context7', url: 'https://mcp.context7.com/mcp', enabled: false } as any,
    ]),
    false,
    'isContext7Configured debe retornar false si está deshabilitado',
  )

  assert.strictEqual(
    await isContext7Configured([
      { name: 'tether', url: 'http://localhost:7432/sse', enabled: true } as any,
    ]),
    false,
    'isContext7Configured debe retornar false si solo hay Tether',
  )

  console.log('✓ Helper isContext7Configured verificado exitosamente.')

  // -------------------------------------------------------------------------------------
  // Test 8: Detección y extracción de error estándar MCP (isError: true, content: [...])
  // -------------------------------------------------------------------------------------
  console.log('[Test 8] Verificando detección de isError: true y extracción de content text en executeCliViaMcp...')

  const tetherCliToolWithSession: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7432/sse',
    name: 'exec',
    qualifiedName: 'mcp_tether_exec',
    description: '[MCP: tether] Ejecuta comando en sesión anfitrión',
    inputSchema: {
      type: 'object',
      properties: {
        command: { type: 'string' },
        session_id: { type: 'string' },
      },
      required: ['command', 'session_id'],
    },
  }

  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherCliToolWithSession],
    forceRefresh: true,
  })

  const origFetch8 = globalThis.fetch
  try {
    // Simular que el servidor responde con formato estándar de error MCP
    globalThis.fetch = (async () => {
      return new Response(
        JSON.stringify({
          jsonrpc: '2.0',
          id: 'test-mcp-error',
          result: {
            content: [{ type: 'text', text: 'session_id is required' }],
            isError: true,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      )
    }) as typeof fetch

    // Llamada sin pasar session_id previa
    const mcpErrRes = await executeCliViaMcp('npm install', { sessionId: undefined })
    assert.strictEqual(mcpErrRes.ok, false, 'Debe devolver ok: false cuando isError es true')
    assert.ok(
      mcpErrRes.output.includes('session_id is required'),
      'Debe extraer el texto de content block en lugar de dejar el JSON crudo',
    )
    assert.ok(mcpErrRes.exitCode >= 1, 'exitCode debe ser >= 1 cuando isError es true')
    console.log('✓ Respuesta de error estándar MCP detectada y extraída adecuadamente.')
  } finally {
    globalThis.fetch = origFetch8
  }

  // -------------------------------------------------------------------------------------
  // Test 9: Envío automático de session_id a herramientas Tether que lo requieran
  // -------------------------------------------------------------------------------------
  console.log('[Test 9] Verificando propagación automática de session_id en executeCliViaMcp...')

  let receivedArgsInMcp: Record<string, unknown> | null = null
  const origFetch9 = globalThis.fetch
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      if (body.method === 'tools/call') {
        receivedArgsInMcp = body.params?.arguments || null
        return new Response(
          JSON.stringify({
            jsonrpc: '2.0',
            id: body.id,
            result: {
              content: [{ type: 'text', text: 'LocalLoop setup completed successfully' }],
              isError: false,
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: { ok: true } }), { status: 200 })
    }) as typeof fetch

    const execSessionRes = await executeCliViaMcp('@echo off\ncall npm install', {
      sessionId: 'test-session-42',
      workspace: 'C:\\Users\\test\\localloop',
    })

    assert.strictEqual(execSessionRes.ok, true, 'Debe ser exitoso con session_id válido')
    assert.ok(receivedArgsInMcp !== null, 'Debe haber recibido argumentos en tools/call')
    assert.strictEqual(
      receivedArgsInMcp?.session_id,
      'test-session-42',
      'Debe inyectar automáticamente session_id desde authContext.sessionId',
    )
    assert.strictEqual(
      receivedArgsInMcp?.command,
      '@echo off\ncall npm install',
      'Debe pasar el comando esperado',
    )
    console.log('✓ session_id propagado correctamente a la herramienta Tether.')
  } finally {
    globalThis.fetch = origFetch9
  }

  // -------------------------------------------------------------------------------------
  // Test 10: Auto-remediación inmediata cuando Tether devuelve session_id is required
  // -------------------------------------------------------------------------------------
  console.log('[Test 10] Verificando auto-reparación y reintento cuando Tether reporta sesión ausente...')

  const tetherSessionOpenTool: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7432/sse',
    name: 'session_open',
    qualifiedName: 'mcp_tether_session_open',
    description: '[MCP: tether] Abre una nueva sesión en host',
    inputSchema: {
      type: 'object',
      properties: {
        workspace: { type: 'string' },
      },
    },
  }

  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherSessionOpenTool, tetherCliToolWithSession],
    forceRefresh: true,
  })

  clearTetherActiveSessions()
  let callCount = 0
  const origFetch10 = globalThis.fetch
  try {
    globalThis.fetch = (async (_url, init) => {
      const body = typeof init?.body === 'string' ? JSON.parse(init.body) : {}
      if (body.method === 'tools/call') {
        const toolName = body.params?.name
        if (toolName === 'session_open') {
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: { session_id: 'auto-remediated-session-99' },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }

        if (toolName === 'exec') {
          callCount++
          if (callCount === 1) {
            // Primer intento falla indicando que la sesión previa ya no es válida o faltó
            return new Response(
              JSON.stringify({
                jsonrpc: '2.0',
                id: body.id,
                result: {
                  content: [{ type: 'text', text: 'session_id is required' }],
                  isError: true,
                },
              }),
              { status: 200, headers: { 'Content-Type': 'application/json' } },
            )
          }

          // Segundo intento tras auto-remediación con session_open
          assert.strictEqual(
            body.params?.arguments?.session_id,
            'auto-remediated-session-99',
            'El reintento debe usar la sesión recién obtenida de session_open',
          )
          return new Response(
            JSON.stringify({
              jsonrpc: '2.0',
              id: body.id,
              result: {
                content: [{ type: 'text', text: 'Command executed cleanly on fresh session' }],
                isError: false,
              },
            }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          )
        }
      }
      return new Response(JSON.stringify({ jsonrpc: '2.0', result: {} }), { status: 200 })
    }) as typeof fetch

    const healedResult = await executeCliViaMcp('npm test', {
      workspace: 'localloop-ws',
    })

    assert.strictEqual(healedResult.ok, true, 'El reintento auto-remediado debe concluir en ok: true')
    assert.strictEqual(callCount, 2, 'Debe haber reintentado exactamente una vez')
    assert.ok(
      healedResult.output.includes('Command executed cleanly on fresh session'),
      'La salida debe reflejar la ejecución exitosa de la sesión re-abierta',
    )
    console.log('✓ Auto-remediación de sesión Tether verificada exitosamente.')
  } finally {
    globalThis.fetch = origFetch10
  }

  // -------------------------------------------------------------------------------------
  // Test 11: findCliExecutionTool prioriza herramienta de ejecución y excluye session_open/close
  // -------------------------------------------------------------------------------------
  console.log('[Test 11] Verificando que findCliExecutionTool no confunda herramientas de control con el runner...')

  const sessionCloseTool: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7432/sse',
    name: 'session_close',
    qualifiedName: 'mcp_tether_session_close',
    description: '[MCP: tether] Cierra sesión',
    inputSchema: { type: 'object', properties: { session_id: { type: 'string' } } },
  }

  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherSessionOpenTool, sessionCloseTool, tetherCliToolWithSession],
    forceRefresh: true,
  })

  const selectedTool = findCliExecutionTool()
  assert.ok(selectedTool !== null, 'Debe encontrar herramienta')
  assert.strictEqual(selectedTool?.name, 'exec', 'Debe seleccionar exec en lugar de session_open o session_close')
  console.log('✓ Selección precisa de la herramienta CLI de Tether verificada.')

  console.log('\n=== ¡Todas las pruebas de Auto-Remediación LLD y Context7 pasaron exitosamente! ===')
}

void runRemediationLoopLldAndContext7Tests().catch((err) => {
  console.error('Error fatal en pruebas de Auto-Remediación LLD y Context7:', err)
  process.exit(1)
})
