import {
  callMcpTool,
  closeTetherSession,
  readTetherSessionScreen,
  sendTetherSessionInput,
  sanitizeCommandForTether,
  sanitizePathForTetherSandbox,
  type McpToolDefinition,
} from '../src/mcp/mcp-client'

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(`Assertion failed: ${message}`)
  }
}

async function runTetherIntegrationTests(): Promise<void> {
  console.log('=== Iniciando Pruebas de Integración y Saneamiento de Tether MCP ===\n')

  // [Test 1] Saneamiento de rutas relativas para el sandbox de Tether
  console.log('[Test 1] Verificando sanitizePathForTetherSandbox...')
  assert(sanitizePathForTetherSandbox('../src') === 'src', 'Debe extraer ruta relativa limpia')
  assert(sanitizePathForTetherSandbox('dist/assets') === 'dist/assets', 'Debe normalizar barras')
  assert(sanitizePathForTetherSandbox('../../../etc/passwd') === 'etc/passwd', 'Debe eliminar path traversal')
  assert(sanitizePathForTetherSandbox('') === '.', 'Ruta vacía debe ser punto')
  console.log('✓ sanitizePathForTetherSandbox superado con éxito.')

  // [Test 2] Saneamiento de comandos y Command Guard de Tether
  console.log('[Test 2] Verificando sanitizeCommandForTether...')
  const sanitized1 = sanitizeCommandForTether('cd "c:\\Users\\alvar\\git\\localloop" && npm test', 'c:/Users/alvar/git/localloop')
  assert(sanitized1 === 'npm test', `Debe eliminar cd inicial redundante hacia el workspace: "${sanitized1}"`)

  const sanitized2 = sanitizeCommandForTether('cd /d "c:/Users/alvar/git/localloop" && git status', 'c:/Users/alvar/git/localloop')
  assert(sanitized2 === 'git status', `Debe eliminar cd /d hacia workspace: "${sanitized2}"`)

  const sanitized3 = sanitizeCommandForTether('npm run build "c:\\Users\\alvar\\git\\localloop"', 'c:/Users/alvar/git/localloop')
  assert(sanitized3.includes('.'), `Debe sustituir ruta absoluta por relativa: "${sanitized3}"`)
  console.log('✓ sanitizeCommandForTether superado con éxito.')

  // [Test 3] Adaptación de herramientas Tether en callMcpTool
  console.log('[Test 3] Verificando adaptación automática de session_open, session_exec, session_input...')
  const originalFetch = globalThis.fetch
  let lastMcpCallBody: any = null

  globalThis.fetch = (async (url: string | URL, init?: RequestInit) => {
    const urlStr = String(url)
    if (urlStr.includes('/auth/connect')) {
      return new Response(JSON.stringify({
        access_token: 'test-token',
        token_type: 'Bearer',
        workspace_root: 'c:\\Users\\alvar\\git\\localloop',
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    }
    if (urlStr.includes('/mcp')) {
      const body = JSON.parse(String(init?.body || '{}'))
      lastMcpCallBody = body
      if (body.params?.name === 'session_open') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ session_id: 'tether-sess-100', state: 'IDLE' }),
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (body.params?.name === 'session_exec') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({
                session_id: 'tether-sess-100',
                output: 'SUCCESS_OUT',
                exit_code: 0,
                state: 'IDLE',
              }),
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (body.params?.name === 'session_screen') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ screen: 'TERMINAL_SCREEN_BUFFER', lines: ['LINE 1', 'LINE 2'] }),
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (body.params?.name === 'session_input') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ output: 'INPUT_RECEIVED', state: 'IDLE' }),
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
      if (body.params?.name === 'session_close') {
        return new Response(JSON.stringify({
          jsonrpc: '2.0',
          id: body.id,
          result: {
            content: [{
              type: 'text',
              text: JSON.stringify({ closed: true, state: 'CLOSED' }),
            }],
          },
        }), { status: 200, headers: { 'Content-Type': 'application/json' } })
      }
    }
    return new Response(JSON.stringify({ status: 'ok' }), { status: 200 })
  }) as typeof fetch

  try {
    const sessionOpenTool: McpToolDefinition = {
      serverName: 'tether',
      serverUrl: 'http://127.0.0.1:7432/mcp',
      name: 'session_open',
      qualifiedName: 'mcp_tether_session_open',
      description: 'Open a PTY session',
      inputSchema: { type: 'object', properties: { name: { type: 'string' }, shell: { type: 'string' } } },
    }

    // Probar session_open eliminando carpetas no admitidas en esquema
    await callMcpTool(sessionOpenTool, {
      workspace: 'c:/Users/alvar/git/localloop',
      cwd: 'c:/Users/alvar/git/localloop',
      name: 'Test Terminal',
    }, {
      workspace: 'c:/Users/alvar/git/localloop',
    })

    assert(lastMcpCallBody.params.arguments.workspace === undefined, 'No debe pasar workspace a session_open')
    assert(lastMcpCallBody.params.arguments.cwd === undefined, 'No debe pasar cwd a session_open')
    assert(lastMcpCallBody.params.arguments.name === 'Test Terminal', 'Debe conservar name')
    assert(lastMcpCallBody.params.arguments.shell === 'cmd.exe', 'Debe auto-asignar shell cmd.exe')

    // Probar session_exec con inyección de session_id y saneamiento
    const sessionExecTool: McpToolDefinition = {
      serverName: 'tether',
      serverUrl: 'http://127.0.0.1:7432/mcp',
      name: 'session_exec',
      qualifiedName: 'mcp_tether_session_exec',
      description: 'Execute command in session',
      inputSchema: { type: 'object', properties: { command: { type: 'string' }, session_id: { type: 'string' } } },
    }

    await callMcpTool(sessionExecTool, {
      command: 'cd "c:\\Users\\alvar\\git\\localloop" && npm run build',
    }, {
      workspace: 'c:/Users/alvar/git/localloop',
    })

    assert(lastMcpCallBody.params.arguments.session_id === 'tether-sess-100', 'Debe auto-inyectar el session_id activo')
    assert(lastMcpCallBody.params.arguments.command === 'npm run build', 'Debe sanitizar el comando')
    assert(lastMcpCallBody.params.arguments.timeout_ms === 60000, 'Debe auto-establecer timeout_ms')

    // Probar session_input (renombrando input a text)
    const sessionInputTool: McpToolDefinition = {
      serverName: 'tether',
      serverUrl: 'http://127.0.0.1:7432/mcp',
      name: 'session_input',
      qualifiedName: 'mcp_tether_session_input',
      description: 'Send input to session',
      inputSchema: { type: 'object', properties: { text: { type: 'string' }, session_id: { type: 'string' } } },
    }

    await callMcpTool(sessionInputTool, {
      input: 'dir /b\r\n',
    })

    assert(lastMcpCallBody.params.arguments.text === 'dir /b\r\n', 'Debe renombrar input a text')
    assert(lastMcpCallBody.params.arguments.press_enter === true, 'Debe asignar press_enter')

    console.log('✓ Adaptación de herramientas de Tether en callMcpTool verificada.')
  } finally {
    globalThis.fetch = originalFetch
  }

  console.log('\n=== ¡Todas las Pruebas de Integración y Saneamiento de Tether MCP pasaron exitosamente! ===')
}

runTetherIntegrationTests().catch((err) => {
  console.error('Error fatal en pruebas de integración de Tether:', err)
  process.exit(1)
})
