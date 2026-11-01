import { trace } from '../diagnostics'
import type { OpenAiToolSpec } from '../llm/llm-client'
import { listMcpServers, type StoredMcpServer } from '../memory/app-db'

export interface McpToolDefinition {
  serverName: string
  serverUrl: string
  name: string
  qualifiedName: string
  description: string
  inputSchema: Record<string, unknown>
}

/**
 * Web-compatible MCP Client Transport (supports HTTP JSON-RPC and SSE endpoints)
 * to discover and invoke external MCP tools from within the browser/Web Worker.
 */
export async function discoverMcpServerTools(server: StoredMcpServer): Promise<McpToolDefinition[]> {
  if (!server.enabled) return []
  try {
    const response = await fetch(server.url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `list-${Date.now()}`,
        method: 'tools/list',
        params: {},
      }),
    })
    if (!response.ok) return []
    const data = (await response.json()) as {
      result?: {
        tools?: Array<{
          name: string
          description?: string
          inputSchema?: Record<string, unknown>
        }>
      }
    }
    const rawTools = data.result?.tools ?? []
    const safePrefix = server.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    return rawTools.map((t) => ({
      serverName: server.name,
      serverUrl: server.url,
      name: t.name,
      qualifiedName: `mcp_${safePrefix}_${t.name}`,
      description: `[MCP: ${server.name}] ${t.description ?? t.name}`,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }))
  } catch (err) {
    trace('mcp.discover.error', {
      server: server.name,
      url: server.url,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

export async function getActiveMcpToolSpecs(): Promise<{
  specs: OpenAiToolSpec[]
  registry: Map<string, McpToolDefinition>
}> {
  const servers = await listMcpServers()
  const registry = new Map<string, McpToolDefinition>()
  const specs: OpenAiToolSpec[] = []

  for (const server of servers) {
    if (!server.enabled) continue
    const tools = await discoverMcpServerTools(server)
    for (const tool of tools) {
      registry.set(tool.qualifiedName, tool)
      specs.push({
        type: 'function',
        function: {
          name: tool.qualifiedName,
          description: tool.description,
          parameters: tool.inputSchema,
        },
      })
    }
  }

  return { specs, registry }
}

export async function callMcpTool(
  tool: McpToolDefinition,
  args: Record<string, unknown>,
): Promise<string> {
  trace('mcp.tool.call', { server: tool.serverName, tool: tool.name })
  const response = await fetch(tool.serverUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: `call-${Date.now()}`,
      method: 'tools/call',
      params: {
        name: tool.name,
        arguments: args,
      },
    }),
  })

  if (!response.ok) {
    throw new Error(`Servidor MCP ${tool.serverName} respondió HTTP ${response.status}`)
  }

  const payload = (await response.json()) as {
    result?: unknown
    error?: { message?: string }
  }
  if (payload.error) {
    throw new Error(payload.error.message ?? 'Error en llamada MCP')
  }
  return JSON.stringify(payload.result ?? {})
}
