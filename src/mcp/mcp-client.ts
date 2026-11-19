import { trace } from '../diagnostics'
import { McpTransportType } from '../enums'
import { getActiveWorkspaceName } from '../fs/workspace-fs'
import type { OpenAiToolSpec } from '../llm/llm-client'
import {
  addMcpServer,
  listMcpServers,
  updateMcpServer,
  type StoredMcpServer,
} from '../memory/app-db'

export interface McpToolDefinition {
  serverName: string
  serverUrl: string
  name: string
  qualifiedName: string
  description: string
  inputSchema: Record<string, unknown>
}

export type McpCapabilityCategory =
  | 'CLI_EXECUTION_AND_BUILD'
  | 'TESTING_AND_VALIDATION'
  | 'FILESYSTEM_AND_WORKSPACE'
  | 'ARCHITECTURE_AND_LANDSCAPE'
  | 'PLANNING_AND_BACKLOG'
  | 'OBSERVABILITY_AND_RCA'
  | 'DOCUMENTATION_AND_KNOWLEDGE'
  | 'GENERAL_PURPOSE'

export interface AnalyzedMcpToolCapability {
  tool: McpToolDefinition
  spec: OpenAiToolSpec
  categories: McpCapabilityCategory[]
  confidenceScore: number
  matchedSignals: string[]
  assignedRoles: string[]
  rationale: string
}

export interface RoleMcpAssignment {
  roleId: string
  roleDescription: string
  tools: AnalyzedMcpToolCapability[]
  specs: OpenAiToolSpec[]
  capabilitiesSummary: McpCapabilityCategory[]
  promptSupplement: string
}

export interface McpCapabilityAssignmentReport {
  analyzedAt: string
  serversQueried: string[]
  tools: AnalyzedMcpToolCapability[]
  registry: Map<string, McpToolDefinition>
  allSpecs: OpenAiToolSpec[]
  roleAssignments: Record<string, RoleMcpAssignment>
}

export interface McpAuthConnectContext {
  agentId?: string
  agentName?: string
  workspace?: string
  waitForApproval?: boolean
  approvalTimeoutMs?: number
  pollIntervalMs?: number
  forceReconnect?: boolean
  onAuthStatus?: (message: string, status: 'pending_approval' | 'authorized' | 'failed') => void
}

interface ResolvedMcpEndpoint {
  mode: 'http-post' | 'classic-sse'
  postUrl: string
  sseUrl?: string
  sessionId?: string
}

const resolvedEndpointCache = new Map<string, ResolvedMcpEndpoint>()
const serverAuthTokenCache = new Map<string, string>()
const inFlightAuthPromises = new Map<string, Promise<string | null>>()

let cachedCapabilityReport: McpCapabilityAssignmentReport | null = null
let cachedCapabilityTimestamp = 0
const CAPABILITY_CACHE_TTL_MS = 15_000

const CAPABILITY_RULES: Array<{
  category: Exclude<McpCapabilityCategory, 'GENERAL_PURPOSE'>
  label: string
  keywords: RegExp
}> = [
  {
    category: 'CLI_EXECUTION_AND_BUILD',
    label: 'Ejecución CLI, Shell, Compilación y Construcción',
    keywords:
      /\b(exec|execute|run|command|cmd|shell|cli|terminal|bash|sh|powershell|pwsh|spawn|process|script|build|compile|bundle|npm|pnpm|yarn|npx|tsc|vite|cargo|go|python|node|install|setup|make|docker|tether)\b/i,
  },
  {
    category: 'TESTING_AND_VALIDATION',
    label: 'Pruebas Automatizadas, Validación, Linting y Auditoría',
    keywords:
      /\b(test|tests|testing|vitest|jest|mocha|pytest|assert|assertion|verify|validation|validate|check|lint|eslint|biome|typecheck|audit|e2e|browser|playwright|cypress|webdriver|qa|coverage|smoke|benchmark|security|vulnerability|scan)\b/i,
  },
  {
    category: 'FILESYSTEM_AND_WORKSPACE',
    label: 'Sistema de Archivos, Workspace y Control de Versiones',
    keywords:
      /\b(file|files|filesystem|fs|read|write|edit|patch|create|delete|remove|mkdir|dir|directory|folder|list|ls|tree|search|grep|rg|find|glob|workspace|path|git|commit|diff|branch|status|repo|repository)\b/i,
  },
  {
    category: 'ARCHITECTURE_AND_LANDSCAPE',
    label: 'Arquitectura Empresarial, Catálogo de Servicios, Contratos y Esquemas',
    keywords:
      /\b(arch|architecture|landscape|catalog|service|services|contract|contracts|schema|openapi|swagger|graphql|grpc|proto|c4|diagram|mermaid|debt|governance|dependency|dependencies|graph|design|blueprint|component|topology|database|sql|db|api)\b/i,
  },
  {
    category: 'PLANNING_AND_BACKLOG',
    label: 'Planificación, Backlog, Gobierno de Proyecto y Requisitos',
    keywords:
      /\b(plan|planning|backlog|issue|issues|ticket|task|tasks|milestone|sprint|roadmap|project|story|epic|requirement|requirements|jira|linear|kanban|estimate|kpi|outcome|alignment)\b/i,
  },
  {
    category: 'OBSERVABILITY_AND_RCA',
    label: 'Observabilidad, Diagnóstico, Logs y Análisis de Causa Raíz (RCA)',
    keywords:
      /\b(log|logs|trace|tracing|error|errors|exception|stack|diagnos|diagnostic|rca|root_cause|metric|metrics|telemetry|health|ping|monitor|debug|debugger|inspect|profile|crash|incident|alert|port|network)\b/i,
  },
  {
    category: 'DOCUMENTATION_AND_KNOWLEDGE',
    label: 'Documentación, Conocimiento, Memoria y Sincronización',
    keywords:
      /\b(doc|docs|documentation|guide|readme|manual|wiki|knowledge|memory|engram|report|markdown|adr|changelog|spec|specification|reference|fetch|web|url|query|summarize|sync|context7|ctx7|library|libraries|resolve-library-id|query-docs|resolve_library_id|query_docs)\b/i,
  },
]

interface RoleCapabilityProfile {
  roleId: string
  description: string
  acceptAll?: boolean
  primaryCategories: McpCapabilityCategory[]
  secondaryCategories: McpCapabilityCategory[]
  usageDirective: string
}

export const ROLE_CAPABILITY_MATRIX: RoleCapabilityProfile[] = [
  {
    roleId: 'ProjectRigor_Interviewer',
    description: 'Fase 0.1 - Descubrimiento de Negocio y Entrevista Rigurosa',
    primaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'PLANNING_AND_BACKLOG', 'DOCUMENTATION_AND_KNOWLEDGE'],
    secondaryCategories: ['FILESYSTEM_AND_WORKSPACE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Utiliza las herramientas MCP asignadas para inspeccionar el contexto existente del repositorio o ecosistema antes de consolidar las necesidades de negocio y arquitectura.',
  },
  {
    roleId: 'EnterpriseArch_MCP_Connector',
    description: 'Fase 0.2 - Conector MCP de Paisaje Arquitectónico',
    acceptAll: true,
    primaryCategories: [
      'ARCHITECTURE_AND_LANDSCAPE',
      'CLI_EXECUTION_AND_BUILD',
      'FILESYSTEM_AND_WORKSPACE',
      'TESTING_AND_VALIDATION',
      'PLANNING_AND_BACKLOG',
      'OBSERVABILITY_AND_RCA',
      'DOCUMENTATION_AND_KNOWLEDGE',
      'GENERAL_PURPOSE',
    ],
    secondaryCategories: [],
    usageDirective:
      'Invoca proactivamente las herramientas MCP descubiertas para inventariar servicios, validar el entorno CLI/sistema y extraer contratos o estado real del paisaje tecnológico.',
  },
  {
    roleId: 'BusinessEnterpriseArch_Alignment',
    description: 'Fase 1.1 - Alineación de Negocio y Arquitectura Empresarial',
    primaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'PLANNING_AND_BACKLOG', 'DOCUMENTATION_AND_KNOWLEDGE'],
    secondaryCategories: ['FILESYSTEM_AND_WORKSPACE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Emplea las herramientas MCP de arquitectura y documentación para contrastar el modelo As-Is / To-Be con los activos reales del entorno.',
  },
  {
    roleId: 'GovernanceProject_Planner',
    description: 'Fase 1.5 - Planificador de Gobierno y Setup de Proyecto',
    primaryCategories: [
      'PLANNING_AND_BACKLOG',
      'ARCHITECTURE_AND_LANDSCAPE',
      'CLI_EXECUTION_AND_BUILD',
      'FILESYSTEM_AND_WORKSPACE',
    ],
    secondaryCategories: ['TESTING_AND_VALIDATION', 'DOCUMENTATION_AND_KNOWLEDGE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Usa las herramientas MCP de CLI, construcción y sistema de archivos para verificar o inicializar la estructura del proyecto, dependencias y scripts base durante el setup.',
  },
  {
    roleId: 'ComponentTechnical_Designer',
    description: 'Fase 2.1 - Diseñador Técnico de Componentes y Contratos',
    primaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'FILESYSTEM_AND_WORKSPACE', 'DOCUMENTATION_AND_KNOWLEDGE'],
    secondaryCategories: ['TESTING_AND_VALIDATION', 'CLI_EXECUTION_AND_BUILD', 'GENERAL_PURPOSE'],
    usageDirective:
      'Apóyate en las herramientas MCP para inspeccionar contratos existentes, esquemas, tipos y estructura de módulos antes de fijar el diseño técnico del componente.',
  },
  {
    roleId: 'EnterpriseArch_Gatekeeper',
    description: 'Fase 2.2 - Gatekeeper de Arquitectura Empresarial y Calidad',
    primaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'TESTING_AND_VALIDATION', 'CLI_EXECUTION_AND_BUILD'],
    secondaryCategories: ['PLANNING_AND_BACKLOG', 'FILESYSTEM_AND_WORKSPACE', 'OBSERVABILITY_AND_RCA', 'GENERAL_PURPOSE'],
    usageDirective:
      'Ejecuta validaciones de arquitectura, chequeos estáticos o comandos de verificación vía MCP para auditar el cumplimiento de gobernanza antes de aprobar el paso a construcción.',
  },
  {
    roleId: 'Component_Implementer',
    description: 'Fase 3.1 - Implementador de Componentes y Construcción',
    primaryCategories: ['CLI_EXECUTION_AND_BUILD', 'FILESYSTEM_AND_WORKSPACE', 'TESTING_AND_VALIDATION'],
    secondaryCategories: ['DOCUMENTATION_AND_KNOWLEDGE', 'ARCHITECTURE_AND_LANDSCAPE', 'OBSERVABILITY_AND_RCA', 'GENERAL_PURPOSE'],
    usageDirective:
      'Prioriza el uso de las herramientas MCP de ejecución CLI, construcción y sistema de archivos para compilar, instalar dependencias, escribir código y verificar que el componente construye sin errores.',
  },
  {
    roleId: 'UnitTest_Engineer',
    description: 'Fase 3.2 - Ingeniero de Pruebas Unitarias y Verificación Técnica',
    primaryCategories: ['TESTING_AND_VALIDATION', 'CLI_EXECUTION_AND_BUILD', 'FILESYSTEM_AND_WORKSPACE'],
    secondaryCategories: ['OBSERVABILITY_AND_RCA', 'DOCUMENTATION_AND_KNOWLEDGE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Invoca las herramientas MCP de testing y CLI para ejecutar suites de pruebas unitarias, compilación de tipos y cobertura real sobre el componente implementado.',
  },
  {
    roleId: 'E2EAutomation_Runner',
    description: 'Fase 4.1 - Ejecutor de Pruebas E2E e Integración de Sistema',
    primaryCategories: ['TESTING_AND_VALIDATION', 'CLI_EXECUTION_AND_BUILD', 'OBSERVABILITY_AND_RCA'],
    secondaryCategories: ['FILESYSTEM_AND_WORKSPACE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Utiliza las herramientas MCP para lanzar pruebas end-to-end, levantar o sondar servicios, ejecutar validaciones integrales por CLI y recolectar evidencias reales de ejecución.',
  },
  {
    roleId: 'BusinessOutcome_Auditor',
    description: 'Fase 4.2 - Auditor de Resultados de Negocio y KPIs',
    primaryCategories: ['PLANNING_AND_BACKLOG', 'TESTING_AND_VALIDATION', 'DOCUMENTATION_AND_KNOWLEDGE'],
    secondaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'OBSERVABILITY_AND_RCA', 'GENERAL_PURPOSE'],
    usageDirective:
      'Usa las herramientas MCP de validación y consulta para contrastar las evidencias técnicas obtenidas frente a los objetivos de negocio (NEEDs) comprometidos.',
  },
  {
    roleId: 'RootCause_Analyzer',
    description: 'Fase 5.1 - Analizador de Causa Raíz (RCA) y Diagnóstico',
    primaryCategories: ['OBSERVABILITY_AND_RCA', 'TESTING_AND_VALIDATION', 'CLI_EXECUTION_AND_BUILD', 'FILESYSTEM_AND_WORKSPACE'],
    secondaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Emplea las herramientas MCP de diagnóstico, logs, CLI y pruebas para reproducir fallos, inspeccionar salidas de error y aislar la causa raíz exacta.',
  },
  {
    roleId: 'BusinessEnterpriseArch_ReSpec',
    description: 'Fase 5.2 - Re-Especificador de Arquitectura y Resiliencia',
    primaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'PLANNING_AND_BACKLOG', 'DOCUMENTATION_AND_KNOWLEDGE'],
    secondaryCategories: ['FILESYSTEM_AND_WORKSPACE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Consulta el estado del proyecto y la arquitectura mediante MCP para formular una re-especificación viable tras un bloqueo o fallo.',
  },
  {
    roleId: 'Backlog_Manager',
    description: 'Fase 5.3 - Gestor de Backlog Evolutivo',
    primaryCategories: ['PLANNING_AND_BACKLOG', 'DOCUMENTATION_AND_KNOWLEDGE'],
    secondaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Sincroniza o consulta ítems del backlog y tareas correctivas utilizando las herramientas MCP asignadas.',
  },
  {
    roleId: 'ProjectProgress_Projector',
    description: 'Fase 6.1 - Proyector de Progreso Ejecutivo del Proyecto',
    primaryCategories: ['DOCUMENTATION_AND_KNOWLEDGE', 'PLANNING_AND_BACKLOG', 'FILESYSTEM_AND_WORKSPACE'],
    secondaryCategories: ['CLI_EXECUTION_AND_BUILD', 'GENERAL_PURPOSE'],
    usageDirective:
      'Recopila métricas de construcción, estado del repositorio y artefactos mediante MCP para consolidar el informe ejecutivo de progreso.',
  },
  {
    roleId: 'SystemDocumentation_Synchronizer',
    description: 'Fase 6.2 - Sincronizador de Documentación Viva del Sistema',
    primaryCategories: ['DOCUMENTATION_AND_KNOWLEDGE', 'ARCHITECTURE_AND_LANDSCAPE', 'FILESYSTEM_AND_WORKSPACE'],
    secondaryCategories: ['CLI_EXECUTION_AND_BUILD', 'GENERAL_PURPOSE'],
    usageDirective:
      'Utiliza las herramientas MCP de archivos y documentación para inspeccionar el código final y sincronizar la documentación técnica viva del sistema.',
  },
  {
    roleId: 'skill_general',
    description: 'Asistente General de Ingeniería',
    acceptAll: true,
    primaryCategories: [
      'CLI_EXECUTION_AND_BUILD',
      'TESTING_AND_VALIDATION',
      'FILESYSTEM_AND_WORKSPACE',
      'ARCHITECTURE_AND_LANDSCAPE',
      'PLANNING_AND_BACKLOG',
      'OBSERVABILITY_AND_RCA',
      'DOCUMENTATION_AND_KNOWLEDGE',
      'GENERAL_PURPOSE',
    ],
    secondaryCategories: [],
    usageDirective:
      'Tienes acceso completo a las herramientas MCP activas para ejecutar comandos, inspeccionar archivos, validar pruebas y consultar arquitectura.',
  },
  {
    roleId: 'skill_architect',
    description: 'Arquitecto de Software y Sistemas',
    primaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'PLANNING_AND_BACKLOG', 'DOCUMENTATION_AND_KNOWLEDGE', 'FILESYSTEM_AND_WORKSPACE'],
    secondaryCategories: ['CLI_EXECUTION_AND_BUILD', 'TESTING_AND_VALIDATION', 'GENERAL_PURPOSE'],
    usageDirective:
      'Usa las herramientas MCP para analizar la estructura del sistema, dependencias y contratos arquitectónicos.',
  },
  {
    roleId: 'skill_coder',
    description: 'Desarrollador Full-Stack y Constructor',
    primaryCategories: ['CLI_EXECUTION_AND_BUILD', 'FILESYSTEM_AND_WORKSPACE', 'TESTING_AND_VALIDATION'],
    secondaryCategories: ['DOCUMENTATION_AND_KNOWLEDGE', 'OBSERVABILITY_AND_RCA', 'GENERAL_PURPOSE'],
    usageDirective:
      'Ejecuta comandos de construcción, compilación y pruebas vía MCP para validar tus cambios de código.',
  },
  {
    roleId: 'skill_security',
    description: 'Auditor de Seguridad y Resiliencia',
    primaryCategories: ['TESTING_AND_VALIDATION', 'OBSERVABILITY_AND_RCA', 'CLI_EXECUTION_AND_BUILD', 'FILESYSTEM_AND_WORKSPACE'],
    secondaryCategories: ['ARCHITECTURE_AND_LANDSCAPE', 'GENERAL_PURPOSE'],
    usageDirective:
      'Usa las herramientas MCP para auditar dependencias, ejecutar escaneos y verificar la postura de seguridad del código.',
  },
  {
    roleId: 'subagent_leaf',
    description: 'Subagente Fractal de Ejecución Atómica',
    primaryCategories: ['CLI_EXECUTION_AND_BUILD', 'FILESYSTEM_AND_WORKSPACE', 'TESTING_AND_VALIDATION'],
    secondaryCategories: ['DOCUMENTATION_AND_KNOWLEDGE', 'OBSERVABILITY_AND_RCA', 'GENERAL_PURPOSE'],
    usageDirective:
      'Como subagente de ejecución atómica, puedes invocar estas herramientas MCP para ejecutar comandos CLI, construir artefactos o verificar pruebas antes de emitir ejecutar_tarea_atomica.',
  },
]

function getServerOriginKey(rawUrl: string): string {
  try {
    const parsed = new URL(rawUrl.trim())
    const host = parsed.hostname === '127.0.0.1' ? 'localhost' : parsed.hostname
    const defaultPort = parsed.protocol === 'https:' ? '443' : '80'
    return `${parsed.protocol}//${host}:${parsed.port || defaultPort}`
  } catch {
    return rawUrl.trim()
  }
}

export function getCachedServerAuthToken(serverUrl: string, fallbackToken?: string): string | undefined {
  if (fallbackToken) {
    setCachedServerAuthToken(serverUrl, fallbackToken)
    return fallbackToken
  }
  const originKey = getServerOriginKey(serverUrl)
  return serverAuthTokenCache.get(originKey)
}

export function setCachedServerAuthToken(serverUrl: string, token: string): void {
  const originKey = getServerOriginKey(serverUrl)
  serverAuthTokenCache.set(originKey, token)
}

/**
 * Determina si un nombre de host corresponde a la máquina local (localhost, loopback IPv4/IPv6).
 */
export function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return (
    normalized === 'localhost' ||
    normalized === '127.0.0.1' ||
    normalized === '::1' ||
    normalized === '0.0.0.0'
  )
}

/**
 * Identifica si un servidor MCP corresponde a la integración especializada de Tether (daemon local /auth/connect).
 */
export function isTetherServer(server: { name: string; url: string }): boolean {
  const n = (server.name || '').toLowerCase()
  const u = (server.url || '').toLowerCase()
  return (
    n.includes('tether') ||
    u.includes('tether') ||
    u.includes(':7432') ||
    u.includes(':7434')
  )
}

/**
 * Identifica si un servidor MCP corresponde a la integración especializada de Context7 (Upstash / documentación en tiempo real).
 */
export function isContext7Server(server: { name: string; url: string }): boolean {
  const n = (server.name || '').toLowerCase()
  const u = (server.url || '').toLowerCase()
  return (
    n.includes('context7') ||
    u.includes('context7') ||
    n === 'ctx7' ||
    u.includes('context7.com')
  )
}

/**
 * Ejecuta `fetch` hacia un servidor MCP.
 *
 * Si se ejecuta en el navegador servido desde localhost (entorno de desarrollo Vite p. ej. `http://localhost:5173`)
 * contra otro puerto local (p. ej. `http://localhost:7432`) o Context7, enruta automáticamente a través del middleware
 * de desarrollo local `/__mcp_proxy__` de Vite para evitar restricciones de CORS o resolución IPv6.
 *
 * En entornos estáticos o remotos (como GitHub Pages en `*.github.io` o producción HTTPS):
 * - NO se invoca `/__mcp_proxy__` sobre el host remoto, ya que los hosts estáticos rechazan peticiones POST con
 *   HTTP 405 Method Not Allowed y un servidor remoto en la nube no tiene acceso al `localhost` del cliente.
 * - Se realiza `fetch` directo desde el navegador hacia el servidor MCP local.
 * - Si por alguna razón el proxy responde con 404 (no existe), 403 o 405 (método no permitido), se realiza fallback a `fetch` directo.
 */
export async function mcpFetch(url: string, init?: RequestInit): Promise<Response> {
  const hasBrowserLocation =
    typeof location !== 'undefined' &&
    typeof location.origin === 'string' &&
    location.origin.startsWith('http')

  if (hasBrowserLocation) {
    try {
      const targetUrl = new URL(url)
      const isOriginLocal = isLocalHostname(location.hostname)
      const isLocalTarget = isLocalHostname(targetUrl.hostname)
      const isContext7Target = targetUrl.hostname.includes('context7.com')

      // El middleware local `/__mcp_proxy__` de Vite SOLO existe cuando la propia aplicación
      // se ejecuta desde un servidor local (Vite dev/preview en localhost/127.0.0.1).
      // En hosts estáticos (como GitHub Pages) no existe backend de proxy en dicho origen.
      if (isOriginLocal && (isLocalTarget || isContext7Target) && targetUrl.origin !== location.origin) {
        const proxyUrl = `${location.origin}/__mcp_proxy__?target=${encodeURIComponent(url)}`
        const proxyResp = await fetch(proxyUrl, init)
        // Si el proxy no existe (404) o el host rechaza el método (405) o responde 403, fallback a fetch directo
        if (proxyResp.status !== 404 && proxyResp.status !== 405 && proxyResp.status !== 403) {
          return proxyResp
        }
      }
    } catch {
      // Si el proxy no está disponible o falla por red, hacer fallback a fetch directo
    }
  }

  return fetch(url, init)
}

/**
 * Extrae objetos JSON-RPC tanto de respuestas `application/json` como de streams `text/event-stream` (SSE).
 */
export function parseMcpResponseText(rawText: string, expectedId?: string): {
  result?: unknown
  error?: { code?: number; message?: string }
} | null {
  const trimmed = rawText.trim()
  if (!trimmed) return null

  // 1. Intento de JSON directo
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    try {
      const parsed = JSON.parse(trimmed)
      if (Array.isArray(parsed)) {
        const match =
          (expectedId ? parsed.find((item) => item && String(item.id) === expectedId) : undefined) ??
          parsed.find((item) => item && ('result' in item || 'error' in item)) ??
          parsed[0]
        return match ?? null
      }
      return parsed
    } catch {
      // Continuar a parseo línea por línea / SSE
    }
  }

  // 2. Parseo de frames SSE (`data: {...}`) o NDJSON
  const lines = trimmed.split(/\r?\n/)
  let lastValidObject: { result?: unknown; error?: { code?: number; message?: string }; id?: unknown } | null = null

  for (const line of lines) {
    const cleanLine = line.trim()
    const jsonCandidate = cleanLine.startsWith('data:') ? cleanLine.slice(5).trim() : cleanLine
    if (!jsonCandidate.startsWith('{')) continue
    try {
      const obj = JSON.parse(jsonCandidate) as {
        id?: unknown
        result?: unknown
        error?: { code?: number; message?: string }
      }
      if ('result' in obj || 'error' in obj) {
        if (expectedId && String(obj.id) === expectedId) {
          return obj
        }
        lastValidObject = obj
      }
    } catch {
      // Ignorar líneas que no sean JSON
    }
  }

  return lastValidObject
}

/**
 * Genera URLs candidatas para servidores MCP expuestos en raíz, `/mcp` o `/sse`.
 * Incluye también el puerto por defecto de tether (7432) si se configuró 7434 por error.
 */
export function buildCandidateMcpUrls(rawUrl: string, serverName = ''): string[] {
  const trimmed = rawUrl.trim()
  if (!trimmed) return []
  const candidates = new Set<string>([trimmed])

  // Context7 es un endpoint HTTP JSON-RPC exacto (/mcp); no alternar a endpoints incompatibles /sse
  if (isContext7Server({ name: serverName, url: trimmed })) {
    return [trimmed]
  }

  const addOriginVariants = (origin: string, cleanPath: string) => {
    if (cleanPath === '' || cleanPath === '/') {
      candidates.add(new URL('/sse', origin).toString())
      candidates.add(new URL('/mcp', origin).toString())
    } else if (cleanPath.endsWith('/sse')) {
      candidates.add(new URL('/sse', origin).toString())
      candidates.add(new URL('/mcp', origin).toString())
      candidates.add(new URL('/', origin).toString())
    } else if (cleanPath.endsWith('/mcp')) {
      candidates.add(new URL('/mcp', origin).toString())
      candidates.add(new URL('/sse', origin).toString())
      candidates.add(new URL('/', origin).toString())
    }
  }

  try {
    const parsed = new URL(trimmed)
    const cleanPath = parsed.pathname.replace(/\/+$/, '')
    addOriginVariants(parsed.origin, cleanPath)

    // Si es tether y estaba apuntando a 7434, probar también el puerto por defecto 7432
    const isTether =
      serverName.toLowerCase().includes('tether') ||
      trimmed.toLowerCase().includes('tether') ||
      parsed.port === '7434'
    if (isTether && parsed.port === '7434') {
      const port7432Origin = `${parsed.protocol}//${parsed.hostname}:7432`
      addOriginVariants(port7432Origin, cleanPath)
    }
  } catch {
    // Si es una URL relativa o mock en tests, mantener solo trimmed
  }

  return Array.from(candidates)
}

/**
 * Extrae el token Bearer de la respuesta JSON de `/auth/connect`.
 */
function extractAuthTokenFromResponse(raw: unknown): string | null {
  if (!raw || typeof raw !== 'object') return null
  const obj = raw as Record<string, unknown>
  const directCandidates = [
    obj.token,
    obj.access_token,
    obj.accessToken,
    obj.api_key,
    obj.apiKey,
    obj.jwt,
    obj.secret,
  ]
  for (const c of directCandidates) {
    if (typeof c === 'string' && c.trim().length > 0) {
      return c.trim()
    }
  }
  if (obj.data && typeof obj.data === 'object') {
    const nested = extractAuthTokenFromResponse(obj.data)
    if (nested) return nested
  }
  if (obj.result && typeof obj.result === 'object') {
    const nested = extractAuthTokenFromResponse(obj.result)
    if (nested) return nested
  }
  return null
}

/**
 * Realiza el flujo de autenticación en `/auth/connect` proporcionando:
 * `{ agent_id, agent_name, workspace }`
 * y espera/verifica la autorización del usuario antes de comenzar a trabajar.
 */
export async function authenticateMcpServer(
  server: StoredMcpServer,
  context?: McpAuthConnectContext,
): Promise<string | null> {
  // Context7 utiliza directamente su API Key / Bearer token y no utiliza el endpoint /auth/connect de Tether
  if (isContext7Server(server)) {
    const existingToken = getCachedServerAuthToken(server.url, server.authToken) ?? server.authToken ?? null
    if (existingToken) {
      server.authToken = existingToken
      server.authStatus = 'authorized'
      setCachedServerAuthToken(server.url, existingToken)
      if (server.id) {
        try {
          await updateMcpServer(server.id, { authToken: existingToken, authStatus: 'authorized' })
        } catch {
          // ignore
        }
      }
      context?.onAuthStatus?.(`✅ Context7 configurado con API Key.`, 'authorized')
      return existingToken
    }
    server.authStatus = 'none'
    context?.onAuthStatus?.(`ℹ️ Context7 configurado sin API Key (modo público).`, 'authorized')
    return null
  }

  const originKey = getServerOriginKey(server.url)

  if (!context?.forceReconnect) {
    const existingToken = getCachedServerAuthToken(server.url, server.authToken)
    if (existingToken) {
      serverAuthTokenCache.set(originKey, existingToken)
      return existingToken
    }
    const inFlight = inFlightAuthPromises.get(originKey)
    if (inFlight) {
      return inFlight
    }
  }

  const authPromise = (async (): Promise<string | null> => {
    const generatedGuid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID().slice(0, 8)
        : Math.random().toString(36).slice(2, 10)

    const agentId = (context?.agentId || server.agentId || `localloop-agent-${generatedGuid}`).trim()
    const agentName = (context?.agentName || server.agentName || 'LocalLoop SDLC Agent').trim()
    const workspace = (
      context?.workspace ||
      server.workspace ||
      getActiveWorkspaceName() ||
      'localloop-workspace'
    ).trim()

    const candidateUrls = buildCandidateMcpUrls(server.url, server.name)
    const candidateAuthUrls = Array.from(
      new Set(
        candidateUrls.map((u) => {
          try {
            return new URL('/auth/connect', u).toString()
          } catch {
            return `${u.replace(/\/+$/, '')}/auth/connect`
          }
        }),
      ),
    )

    const statusMsg = `🔐 Solicitando autenticación en ${server.name} (/auth/connect) con { agent_id: "${agentId}", agent_name: "${agentName}", workspace: "${workspace}" }. Esperando autorización del usuario...`
    trace('mcp.auth.connect.start', {
      server: server.name,
      authUrls: candidateAuthUrls,
      agent_id: agentId,
      agent_name: agentName,
      workspace,
    })
    context?.onAuthStatus?.(statusMsg, 'pending_approval')

    if (server.id) {
      try {
        await updateMcpServer(server.id, {
          agentId,
          agentName,
          workspace,
          authStatus: 'pending_approval',
        })
      } catch {
        // Ignorar fallo de actualización intermedia
      }
    }

    let obtainedToken: string | null = null
    let workingOriginUrl: string = server.url

    for (const authUrl of candidateAuthUrls) {
      try {
        const resp = await mcpFetch(authUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            agent_id: agentId,
            agent_name: agentName,
            workspace,
          }),
        })

        if (!resp.ok) {
          continue
        }

        let rawText = ''
        if (typeof resp.text === 'function') {
          rawText = await resp.text()
        } else if (typeof resp.json === 'function') {
          rawText = JSON.stringify(await resp.json())
        }

        let parsed: unknown = null
        try {
          parsed = JSON.parse(rawText)
        } catch {
          parsed = parseMcpResponseText(rawText)
        }

        const token = extractAuthTokenFromResponse(parsed)
        if (token) {
          obtainedToken = token
          workingOriginUrl = authUrl
          break
        }
      } catch (err) {
        trace('mcp.auth.connect.attempt_error', {
          authUrl,
          error: err instanceof Error ? err.message : String(err),
        })
      }
    }

    if (!obtainedToken) {
      if (server.id) {
        try {
          await updateMcpServer(server.id, { authStatus: 'failed' })
        } catch {
          // ignore
        }
      }
      const isRemoteHttps =
        typeof location !== 'undefined' &&
        location.protocol === 'https:' &&
        !isLocalHostname(location.hostname)
      const isLocalTargetServer =
        server.url.includes('localhost') || server.url.includes('127.0.0.1')
      const httpsNote =
        isRemoteHttps && isLocalTargetServer
          ? ' Si estás en GitHub Pages (HTTPS) y tu servidor MCP corre en localhost (HTTP), verifica que el servidor admita CORS y Private Network Access (PNA), o expónlo mediante un túnel HTTPS (ej. ngrok/cloudflared).'
          : ''
      context?.onAuthStatus?.(
        `⚠️ No se pudo obtener token desde /auth/connect en ${server.name}. Verifica que el servidor esté activo y hayas autorizado el acceso.${httpsNote}`,
        'failed',
      )
      return null
    }

    setCachedServerAuthToken(server.url, obtainedToken)
    setCachedServerAuthToken(workingOriginUrl, obtainedToken)

    // Si el servidor devolvió el token de inmediato pero requiere que el usuario apruebe en la UI/CLI de Tether
    // para activarlo, sondeamos hasta que deje de devolver 401/403 (cuando waitForApproval !== false).
    const shouldWait = context?.waitForApproval ?? true
    const timeoutMs = context?.approvalTimeoutMs ?? 60_000
    const pollIntervalMs = context?.pollIntervalMs ?? 1500
    const startWait = Date.now()

    if (shouldWait) {
      while (Date.now() - startWait < timeoutMs) {
        const probeStatus = await probeServerAuthorizationStatus(
          workingOriginUrl,
          server.url,
          obtainedToken,
        )
        if (probeStatus === 'authorized') {
          break
        }
        if (probeStatus === 'unreachable') {
          break
        }
        context?.onAuthStatus?.(
          `⏳ Token recibido de /auth/connect para "${agentName}" (${workspace}). Esperando a que el usuario autorice la sesión en ${server.name}...`,
          'pending_approval',
        )
        await new Promise((r) => setTimeout(r, pollIntervalMs))
      }
    }

    if (server.id) {
      try {
        await updateMcpServer(server.id, {
          authToken: obtainedToken,
          agentId,
          agentName,
          workspace,
          authStatus: 'authorized',
        })
      } catch {
        // ignore
      }
    }

    server.authToken = obtainedToken
    server.agentId = agentId
    server.agentName = agentName
    server.workspace = workspace
    server.authStatus = 'authorized'

    trace('mcp.auth.connect.authorized', {
      server: server.name,
      agent_id: agentId,
      workspace,
    })
    context?.onAuthStatus?.(
      `✅ Servidor MCP ${server.name} autenticado y autorizado para "${agentName}" en workspace "${workspace}".`,
      'authorized',
    )

    return obtainedToken
  })()

  inFlightAuthPromises.set(originKey, authPromise)
  try {
    return await authPromise
  } finally {
    inFlightAuthPromises.delete(originKey)
  }
}

/**
 * Verifica si el token Bearer ya está autorizado por el usuario en el servidor MCP.
 */
async function probeServerAuthorizationStatus(
  workingOriginUrl: string,
  configuredUrl: string,
  token: string,
): Promise<'authorized' | 'unauthorized' | 'unreachable'> {
  let probeUrl = configuredUrl
  try {
    const originParsed = new URL(workingOriginUrl)
    const configParsed = new URL(configuredUrl)
    probeUrl = new URL(configParsed.pathname || '/sse', originParsed.origin).toString()
  } catch {
    probeUrl = configuredUrl
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 2500)
  try {
    const resp = await mcpFetch(probeUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `probe-${Date.now()}`,
        method: 'tools/list',
        params: {},
      }),
      signal: controller.signal,
    })

    if (resp.status === 401 || resp.status === 403) {
      return 'unauthorized'
    }
    return 'authorized'
  } catch (err) {
    // Si fue abortado por timeout (p.ej. abrió el stream SSE exitosamente y quedó escuchando), está autorizado
    if (err instanceof Error && err.name === 'AbortError') {
      return 'authorized'
    }
    return 'unreachable'
  } finally {
    clearTimeout(timer)
  }
}

async function sendHttpPostRpc(
  url: string,
  method: string,
  params: Record<string, unknown>,
  sessionId?: string,
  authToken?: string,
): Promise<{
  ok: boolean
  status: number
  sessionId?: string
  payload: { result?: unknown; error?: { code?: number; message?: string } } | null
}> {
  const reqId = `${method.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  }
  if (sessionId) {
    headers['Mcp-Session-Id'] = sessionId
  }
  if (authToken) {
    headers['Authorization'] = `Bearer ${authToken}`
  }

  const response = await mcpFetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: reqId,
      method,
      params,
    }),
  })

  const returnedSessionId =
    response.headers?.get?.('mcp-session-id') ??
    response.headers?.get?.('Mcp-Session-Id') ??
    sessionId

  let rawText = ''
  if (typeof response.text === 'function') {
    rawText = await response.text()
  } else if (typeof response.json === 'function') {
    const jsonObj = await response.json()
    rawText = JSON.stringify(jsonObj)
  }

  const payload = parseMcpResponseText(rawText, reqId)
  return {
    ok: response.ok,
    status: response.status,
    sessionId: returnedSessionId ?? undefined,
    payload,
  }
}

/**
 * Ejecuta una operación JSON-RPC sobre transporte clásico MCP SSE (`GET /sse` -> `event: endpoint` -> `POST <endpoint>`).
 */
async function executeClassicSseRpc(
  sseUrl: string,
  method: string,
  params: Record<string, unknown>,
  authToken?: string,
  timeoutMs = 8000,
): Promise<{
  status?: number
  postUrl: string
  payload: { result?: unknown; error?: { code?: number; message?: string } } | null
} | null> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const sseHeaders: Record<string, string> = {
      Accept: 'text/event-stream',
    }
    if (authToken) {
      sseHeaders['Authorization'] = `Bearer ${authToken}`
    }

    const sseResponse = await mcpFetch(sseUrl, {
      method: 'GET',
      headers: sseHeaders,
      signal: controller.signal,
    })

    if (sseResponse.status === 401 || sseResponse.status === 403) {
      return { status: sseResponse.status, postUrl: sseUrl, payload: null }
    }

    if (!sseResponse.ok || !sseResponse.body || typeof sseResponse.body.getReader !== 'function') {
      return null
    }

    const reader = sseResponse.body.getReader()
    const decoder = new TextDecoder()
    let buffer = ''
    let resolvedPostUrl: string | null = null
    const rpcId = `sse-${method.replace(/[^a-zA-Z0-9]/g, '_')}-${Date.now()}`
    let rpcSent = false
    let directPostPayload: { result?: unknown; error?: { code?: number; message?: string } } | null = null

    const postHeaders: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
    }
    if (authToken) {
      postHeaders['Authorization'] = `Bearer ${authToken}`
    }

    while (true) {
      const { value, done } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      const events = buffer.split(/\r?\n\r?\n/)
      buffer = events.pop() ?? ''

      for (const evtBlock of events) {
        const lines = evtBlock.split(/\r?\n/)
        let eventType = 'message'
        const dataLines: string[] = []

        for (const line of lines) {
          if (line.startsWith('event:')) {
            eventType = line.slice(6).trim()
          } else if (line.startsWith('data:')) {
            dataLines.push(line.slice(5).trim())
          }
        }

        const dataPayload = dataLines.join('\n').trim()
        if (!dataPayload) continue

        if (eventType === 'endpoint' && !resolvedPostUrl) {
          try {
            resolvedPostUrl = new URL(dataPayload, sseUrl).toString()
          } catch {
            resolvedPostUrl = dataPayload
          }

          if (!rpcSent && resolvedPostUrl) {
            rpcSent = true
            try {
              await mcpFetch(resolvedPostUrl, {
                method: 'POST',
                headers: postHeaders,
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  id: `init-${Date.now()}`,
                  method: 'initialize',
                  params: {
                    protocolVersion: '2024-11-05',
                    capabilities: {},
                    clientInfo: { name: 'localloop', version: '0.1.0' },
                  },
                }),
              })
              await mcpFetch(resolvedPostUrl, {
                method: 'POST',
                headers: postHeaders,
                body: JSON.stringify({
                  jsonrpc: '2.0',
                  method: 'notifications/initialized',
                  params: {},
                }),
              })
            } catch {
              // Ignorar si el servidor SSE no exige initialize previo
            }

            const postResp = await mcpFetch(resolvedPostUrl, {
              method: 'POST',
              headers: postHeaders,
              body: JSON.stringify({
                jsonrpc: '2.0',
                id: rpcId,
                method,
                params,
              }),
            })

            if (postResp.ok && typeof postResp.text === 'function') {
              const postText = await postResp.text()
              const parsedPost = parseMcpResponseText(postText, rpcId)
              if (parsedPost && ('result' in parsedPost || 'error' in parsedPost)) {
                directPostPayload = parsedPost
                return { status: 200, postUrl: resolvedPostUrl, payload: directPostPayload }
              }
            }
          }
        } else {
          const parsedMsg = parseMcpResponseText(dataPayload, rpcId)
          if (parsedMsg && ('result' in parsedMsg || 'error' in parsedMsg)) {
            const rawObj = JSON.parse(dataPayload) as { id?: unknown; result?: Record<string, unknown> }
            if (String(rawObj.id) === rpcId || (method === 'tools/list' && rawObj.result && 'tools' in rawObj.result)) {
              return {
                status: 200,
                postUrl: resolvedPostUrl ?? sseUrl,
                payload: parsedMsg,
              }
            }
          }
        }
      }
    }

    return null
  } catch {
    return null
  } finally {
    clearTimeout(timeout)
    try {
      controller.abort()
    } catch {
      // No-op
    }
  }
}

/**
 * Ejecuta una petición JSON-RPC contra un servidor MCP incluyendo `Authorization: Bearer <token>` si existe.
 * Si el servidor responde `401` o `403`, inicia automáticamente el flujo de autenticación en `/auth/connect`
 * esperando la autorización del usuario y reintenta la petición.
 */
async function invokeMcpServerRpc(
  server: StoredMcpServer,
  method: string,
  params: Record<string, unknown>,
  authContext?: McpAuthConnectContext,
): Promise<{ result?: unknown; error?: { code?: number; message?: string } } | null> {
  const serverUrl = server.url
  let authToken = getCachedServerAuthToken(serverUrl, server.authToken)

  const attemptRpcWithToken = async (
    token?: string,
  ): Promise<{
    unauthorized: boolean
    payload: { result?: unknown; error?: { code?: number; message?: string } } | null
  }> => {
    let sawUnauthorized = false
    const cached = resolvedEndpointCache.get(serverUrl)
    if (cached) {
      try {
        if (cached.mode === 'http-post') {
          const res = await sendHttpPostRpc(cached.postUrl, method, params, cached.sessionId, token)
          if (res.status === 401 || res.status === 403) {
            sawUnauthorized = true
          } else if (res.ok && res.payload && !res.payload.error) {
            return { unauthorized: false, payload: res.payload }
          }
        } else if (cached.mode === 'classic-sse' && cached.sseUrl) {
          const sseRes = await executeClassicSseRpc(cached.sseUrl, method, params, token)
          if (sseRes?.status === 401 || sseRes?.status === 403) {
            sawUnauthorized = true
          } else if (sseRes?.payload) {
            return { unauthorized: false, payload: sseRes.payload }
          }
        }
      } catch {
        resolvedEndpointCache.delete(serverUrl)
      }
    }

    const candidateUrls = buildCandidateMcpUrls(serverUrl, server.name)

    // Paso 1: Intentar HTTP POST JSON-RPC (Stateless o Streamable HTTP con initialize)
    for (const candidateUrl of candidateUrls) {
      try {
        const direct = await sendHttpPostRpc(candidateUrl, method, params, undefined, token)
        if (direct.status === 401 || direct.status === 403) {
          sawUnauthorized = true
          continue
        }
        if (direct.ok && direct.payload && 'result' in direct.payload) {
          resolvedEndpointCache.set(serverUrl, {
            mode: 'http-post',
            postUrl: candidateUrl,
            sessionId: direct.sessionId,
          })
          return { unauthorized: false, payload: direct.payload }
        }

        const initRes = await sendHttpPostRpc(
          candidateUrl,
          'initialize',
          {
            protocolVersion: '2024-11-05',
            capabilities: {},
            clientInfo: { name: 'localloop', version: '0.1.0' },
          },
          undefined,
          token,
        )

        if (initRes.status === 401 || initRes.status === 403) {
          sawUnauthorized = true
          continue
        }

        if (initRes.ok && (initRes.sessionId || initRes.payload?.result)) {
          const sessionId = initRes.sessionId
          try {
            const notifHeaders: Record<string, string> = {
              'Content-Type': 'application/json',
              Accept: 'application/json, text/event-stream',
            }
            if (sessionId) notifHeaders['Mcp-Session-Id'] = sessionId
            if (token) notifHeaders['Authorization'] = `Bearer ${token}`

            await mcpFetch(candidateUrl, {
              method: 'POST',
              headers: notifHeaders,
              body: JSON.stringify({
                jsonrpc: '2.0',
                method: 'notifications/initialized',
                params: {},
              }),
            })
          } catch {
            // Opcional según servidor
          }

          const retry = await sendHttpPostRpc(candidateUrl, method, params, sessionId, token)
          if (retry.ok && retry.payload && ('result' in retry.payload || 'error' in retry.payload)) {
            resolvedEndpointCache.set(serverUrl, {
              mode: 'http-post',
              postUrl: candidateUrl,
              sessionId: retry.sessionId ?? sessionId,
            })
            return { unauthorized: false, payload: retry.payload }
          }
        }
      } catch {
        // Continuar con el siguiente candidato o SSE
      }
    }

    // Paso 2: Intentar transporte clásico MCP SSE (`GET /sse` -> `event: endpoint`)
    for (const candidateUrl of candidateUrls) {
      const sseResult = await executeClassicSseRpc(candidateUrl, method, params, token)
      if (sseResult?.status === 401 || sseResult?.status === 403) {
        sawUnauthorized = true
        continue
      }
      if (sseResult?.payload) {
        resolvedEndpointCache.set(serverUrl, {
          mode: 'classic-sse',
          postUrl: sseResult.postUrl,
          sseUrl: candidateUrl,
        })
        return { unauthorized: false, payload: sseResult.payload }
      }
    }

    return { unauthorized: sawUnauthorized, payload: null }
  }

  // Si aún no tenemos token pero el servidor es tether (o puerto 7432), autenticar proactivamente en /auth/connect
  const isTether = isTetherServer(server)

  const firstAttempt = await attemptRpcWithToken(authToken)
  if (firstAttempt.payload) {
    return firstAttempt.payload
  }

  // SOLO invocar /auth/connect si es un servidor Tether (Context7 u otros no usan este endpoint)
  if (isTether && (firstAttempt.unauthorized || !authToken)) {
    const newToken = await authenticateMcpServer(server, {
      ...authContext,
      forceReconnect: Boolean(authToken && firstAttempt.unauthorized),
    })
    if (newToken) {
      authToken = newToken
      const secondAttempt = await attemptRpcWithToken(authToken)
      return secondAttempt.payload
    }
  }

  return null
}

/**
 * Asegura que una URL de servidor MCP (p.ej. proporcionada en Fase 0) esté registrada en la base de datos local.
 */
export async function ensureMcpServerRegistered(
  url: string,
  preferredName?: string,
  workspace?: string,
): Promise<StoredMcpServer | null> {
  const cleanUrl = url.trim()
  if (!cleanUrl) return null

  const existing = await listMcpServers()
  const match = existing.find((s) => s.url.trim().toLowerCase() === cleanUrl.toLowerCase())
  if (match) {
    return match
  }

  let inferredName = preferredName?.trim() || 'mcp_server'
  if (!preferredName) {
    try {
      const parsed = new URL(cleanUrl)
      if (parsed.port === '7432' || parsed.port === '7434' || cleanUrl.toLowerCase().includes('tether')) {
        inferredName = 'tether'
      } else if (cleanUrl.toLowerCase().includes('context7') || parsed.hostname.includes('context7.com')) {
        inferredName = 'context7'
      } else {
        inferredName = `mcp_${parsed.hostname.replace(/[^a-zA-Z0-9]/g, '_')}_${parsed.port || 'http'}`
      }
    } catch {
      inferredName = 'mcp_custom'
    }
  }

  const id = await addMcpServer({
    name: inferredName,
    url: cleanUrl,
    transport: McpTransportType.SSE,
    workspace: workspace || getActiveWorkspaceName() || 'localloop-workspace',
  })
  cachedCapabilityReport = null

  return {
    id,
    name: inferredName,
    url: cleanUrl,
    transport: McpTransportType.SSE,
    enabled: true,
    workspace: workspace || getActiveWorkspaceName() || 'localloop-workspace',
    createdAt: new Date().toISOString(),
  }
}

/**
 * Web-compatible MCP Client Transport (supports HTTP JSON-RPC, Streamable HTTP, SSE endpoints,
 * and `/auth/connect` Bearer authentication handshake).
 */
export async function discoverMcpServerTools(
  server: StoredMcpServer,
  authContext?: McpAuthConnectContext,
): Promise<McpToolDefinition[]> {
  if (!server.enabled) return []
  try {
    const data = (await invokeMcpServerRpc(server, 'tools/list', {}, authContext)) as {
      result?: {
        tools?: Array<{
          name: string
          description?: string
          inputSchema?: Record<string, unknown>
        }>
      }
    } | null

    if (!data?.result?.tools) return []

    const rawTools = data.result.tools
    const safePrefix = server.name.replace(/[^a-zA-Z0-9_]/g, '_').toLowerCase()
    const discovered = rawTools.map((t) => ({
      serverName: server.name,
      serverUrl: server.url,
      name: t.name,
      qualifiedName: `mcp_${safePrefix}_${t.name}`,
      description: `[MCP: ${server.name}] ${t.description ?? t.name}`,
      inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
    }))

    trace('mcp.discover.success', {
      server: server.name,
      url: server.url,
      toolCount: discovered.length,
      tools: discovered.map((d) => d.qualifiedName),
    })

    return discovered
  } catch (err) {
    trace('mcp.discover.error', {
      server: server.name,
      url: server.url,
      error: err instanceof Error ? err.message : String(err),
    })
    return []
  }
}

export async function getActiveMcpToolSpecs(authContext?: McpAuthConnectContext): Promise<{
  specs: OpenAiToolSpec[]
  registry: Map<string, McpToolDefinition>
}> {
  const servers = await listMcpServers()
  const registry = new Map<string, McpToolDefinition>()
  const specs: OpenAiToolSpec[] = []

  for (const server of servers) {
    if (!server.enabled) continue
    const tools = await discoverMcpServerTools(server, authContext)
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
  authContext?: McpAuthConnectContext,
): Promise<string> {
  trace('mcp.tool.call', { server: tool.serverName, tool: tool.name, qualifiedName: tool.qualifiedName })

  const servers = await listMcpServers()
  const matchedServer: StoredMcpServer = servers.find(
    (s) => s.name === tool.serverName || s.url === tool.serverUrl,
  ) ?? {
    name: tool.serverName,
    url: tool.serverUrl,
    transport: McpTransportType.SSE,
    enabled: true,
    createdAt: new Date().toISOString(),
  }

  // Sanitize relative or virtual workspace directory arguments (e.g. "Prueba 12", "workspace")
  // that cause Windows PTY / CreateProcess to fail with "The directory name is invalid"
  const sanitizedArgs: Record<string, unknown> = { ...args }
  const isAbsoluteOsPath = (val: string) => /^([a-zA-Z]:[\\/]|\\\\|\/(?!workspace\b)[a-zA-Z0-9._-]+)/.test(val.trim())
  const serverAbsWorkspace =
    matchedServer.workspace && isAbsoluteOsPath(matchedServer.workspace)
      ? matchedServer.workspace.trim()
      : undefined

  for (const dirKey of ['cwd', 'directory', 'workingDirectory', 'workdir', 'working_dir']) {
    if (typeof sanitizedArgs[dirKey] === 'string') {
      const rawDir = String(sanitizedArgs[dirKey]).trim()
      if (!rawDir || !isAbsoluteOsPath(rawDir)) {
        if (serverAbsWorkspace) {
          sanitizedArgs[dirKey] = serverAbsWorkspace
        } else {
          delete sanitizedArgs[dirKey]
        }
      }
    }
  }

  let payload = await invokeMcpServerRpc(
    matchedServer,
    'tools/call',
    {
      name: tool.name,
      arguments: sanitizedArgs,
    },
    authContext,
  )

  const payloadStr = JSON.stringify(payload ?? '')
  if (
    payloadStr.includes('The directory name is invalid') ||
    payloadStr.includes('directory name is invalid')
  ) {
    const retryArgs: Record<string, unknown> = { ...sanitizedArgs }
    for (const k of ['cwd', 'directory', 'workingDirectory', 'workdir', 'working_dir', 'path']) {
      delete retryArgs[k]
    }
    const retryPayload = await invokeMcpServerRpc(
      matchedServer,
      'tools/call',
      {
        name: tool.name,
        arguments: retryArgs,
      },
      authContext,
    )
    if (retryPayload && !retryPayload.error) {
      payload = retryPayload
    }
  }

  if (!payload) {
    throw new Error(`Servidor MCP ${tool.serverName} (${tool.serverUrl}) no respondió a la invocación de ${tool.name}`)
  }

  if (payload.error) {
    throw new Error(payload.error.message ?? 'Error en llamada MCP')
  }
  return JSON.stringify(payload.result ?? {})
}

/**
 * Analiza semánticamente una herramienta MCP individual (nombre, servidor, descripción y esquema de parámetros)
 * para clasificar sus capacidades y determinar a qué roles del SDLC debe asignarse dinámicamente.
 */
export function analyzeMcpToolCapabilities(tool: McpToolDefinition): AnalyzedMcpToolCapability {
  const schemaProps =
    tool.inputSchema && typeof tool.inputSchema.properties === 'object' && tool.inputSchema.properties !== null
      ? Object.entries(tool.inputSchema.properties as Record<string, { description?: string }>)
          .map(([key, val]) => `${key} ${val?.description ?? ''}`)
          .join(' ')
      : ''

  const corpus = `${tool.serverName} ${tool.name} ${tool.description} ${schemaProps}`
  const matchedCategories: McpCapabilityCategory[] = []
  const matchedSignals: string[] = []

  for (const rule of CAPABILITY_RULES) {
    const match = corpus.match(rule.keywords)
    if (match) {
      matchedCategories.push(rule.category)
      matchedSignals.push(`${rule.category}:${match[0].toLowerCase()}`)
    }
  }

  if (matchedCategories.length === 0) {
    matchedCategories.push('GENERAL_PURPOSE')
    matchedSignals.push('GENERAL_PURPOSE:fallback')
  }

  const assignedRoles: string[] = []
  for (const role of ROLE_CAPABILITY_MATRIX) {
    if (role.acceptAll) {
      assignedRoles.push(role.roleId)
      continue
    }

    const matchesPrimary = matchedCategories.some((cat) => role.primaryCategories.includes(cat))
    const matchesSecondary = matchedCategories.some((cat) => role.secondaryCategories.includes(cat))

    if (matchesPrimary || matchesSecondary) {
      assignedRoles.push(role.roleId)
    }
  }

  const confidenceScore = matchedCategories.includes('GENERAL_PURPOSE')
    ? 0.6
    : Math.min(1, 0.7 + matchedCategories.length * 0.1)

  const spec: OpenAiToolSpec = {
    type: 'function',
    function: {
      name: tool.qualifiedName,
      description: tool.description,
      parameters: tool.inputSchema,
    },
  }

  return {
    tool,
    spec,
    categories: matchedCategories,
    confidenceScore,
    matchedSignals,
    assignedRoles,
    rationale: `Herramienta ${tool.qualifiedName} (${tool.serverName}) clasificada en [${matchedCategories.join(', ')}] y asignada a ${assignedRoles.length} roles.`,
  }
}

/**
 * Construye el suplemento de System Prompt dinámico para un rol específico con las herramientas MCP asignadas.
 */
export function buildRoleMcpPromptSupplementFromAssignment(assignment?: RoleMcpAssignment): string {
  if (!assignment || assignment.tools.length === 0) return ''

  const roleProfile = ROLE_CAPABILITY_MATRIX.find((r) => r.roleId === assignment.roleId)
  const directive =
    roleProfile?.usageDirective ??
    'Utiliza estas herramientas MCP activamente cuando aporten capacidades de construcción, validación, consulta o diagnóstico para tu rol.'

  const toolLines = assignment.tools
    .map(
      (t) =>
        `- \`${t.tool.qualifiedName}\` (servidor: \`${t.tool.serverName}\` | capacidades: ${t.categories.join(', ')}): ${t.tool.description}`,
    )
    .join('\n')

  const hasCliTools = assignment.tools.some((t) => t.categories.includes('CLI_EXECUTION_AND_BUILD'))
  const cliToolNames = assignment.tools
    .filter((t) => t.categories.includes('CLI_EXECUTION_AND_BUILD'))
    .map((t) => `\`${t.tool.qualifiedName}\``)
    .join(', ')

  const cliMandate = hasCliTools
    ? [
        '\n🚨 [INSTRUCCIÓN PRIORITARIA: USO DE TETHER PARA EJECUCIÓN CLI, COMPILACIÓN Y RESOLUCIÓN DE ERRORES]:',
        `Tienes disponible la integración de Tether mediante las herramientas: ${cliToolNames}.`,
        'DEBES utilizar estas herramientas activamente mediante llamadas a tool_calls para:',
        '1. Ejecutar comandos reales en la terminal shell del host (ej: `npm run build`, `npm run dev`, `npx tsc --noEmit`, `npm test`, `npm install`).',
        '2. Verificar la compilación real del proyecto y de los componentes construidos antes de emitir informes o dar por finalizada la fase.',
        '3. Si un comando devuelve errores de compilación o transpilación (TypeScript/Vite/SyntaxError), lee el log de error devuelto, identifica el fichero y la línea afectada, modifica el código usando las herramientas de edición/escritura de archivos para corregirlo, y vuelve a ejecutar la compilación con Tether hasta que pase limpiamente.',
        '4. NUNCA asumas que el código compila sin haberlo ejecutado a través de Tether cuando estas herramientas estén disponibles.',
      ].join('\n')
    : ''

  return [
    '\n\n[CAPACIDADES MCP ASIGNADAS DINÁMICAMENTE A TU ROL]',
    `Rol activo: ${assignment.roleId} (${assignment.roleDescription})`,
    `Directiva de uso MCP: ${directive}`,
    cliMandate,
    'Herramientas MCP disponibles en tu contexto actual:',
    toolLines,
    'IMPORTANTE: Cuando necesites ejecutar acciones de CLI, construcción, pruebas, lectura/escritura o consulta externa cubiertas por estas herramientas MCP, invócalas directamente mediante tool_calls antes de emitir tu veredicto final.',
  ].filter(Boolean).join('\n')
}

/**
 * Descubre todas las herramientas de los servidores MCP configurados (y URLs adicionales),
 * ejecutando el handshake `/auth/connect` si es requerido, analiza sus capacidades técnicas/semánticas
 * y las asigna dinámicamente a los roles del SDLC.
 */
export async function analyzeAndAssignMcpCapabilities(options?: {
  servers?: StoredMcpServer[]
  extraServerUrls?: string[]
  preDiscoveredTools?: McpToolDefinition[]
  forceRefresh?: boolean
  authContext?: McpAuthConnectContext
}): Promise<McpCapabilityAssignmentReport> {
  const now = Date.now()
  if (
    !options?.forceRefresh &&
    !options?.preDiscoveredTools &&
    !options?.servers &&
    (!options?.extraServerUrls || options.extraServerUrls.length === 0) &&
    cachedCapabilityReport &&
    now - cachedCapabilityTimestamp < CAPABILITY_CACHE_TTL_MS
  ) {
    return cachedCapabilityReport
  }

  if (options?.extraServerUrls) {
    for (const url of options.extraServerUrls) {
      if (url?.trim()) {
        await ensureMcpServerRegistered(url, undefined, options.authContext?.workspace)
      }
    }
  }

  let discoveredTools: McpToolDefinition[] = []
  const serversQueried: string[] = []

  if (options?.preDiscoveredTools) {
    discoveredTools = [...options.preDiscoveredTools]
    for (const t of discoveredTools) {
      if (!serversQueried.includes(t.serverName)) {
        serversQueried.push(t.serverName)
      }
    }
  } else {
    const servers = options?.servers ?? (await listMcpServers())
    for (const server of servers) {
      if (!server.enabled) continue
      serversQueried.push(`${server.name} (${server.url})`)
      const serverTools = await discoverMcpServerTools(server, options?.authContext)
      discoveredTools.push(...serverTools)
    }
  }

  // Deduplicar por qualifiedName
  const uniqueToolsMap = new Map<string, McpToolDefinition>()
  for (const tool of discoveredTools) {
    uniqueToolsMap.set(tool.qualifiedName, tool)
  }

  const analyzedTools: AnalyzedMcpToolCapability[] = []
  const registry = new Map<string, McpToolDefinition>()
  const allSpecs: OpenAiToolSpec[] = []

  for (const tool of uniqueToolsMap.values()) {
    const analyzed = analyzeMcpToolCapabilities(tool)
    analyzedTools.push(analyzed)
    registry.set(tool.qualifiedName, tool)
    allSpecs.push(analyzed.spec)
  }

  const roleAssignments: Record<string, RoleMcpAssignment> = {}
  for (const roleProfile of ROLE_CAPABILITY_MATRIX) {
    const toolsForRole = analyzedTools.filter((t) => t.assignedRoles.includes(roleProfile.roleId))
    const capabilitiesSet = new Set<McpCapabilityCategory>()
    for (const t of toolsForRole) {
      for (const cat of t.categories) {
        capabilitiesSet.add(cat)
      }
    }

    const assignment: RoleMcpAssignment = {
      roleId: roleProfile.roleId,
      roleDescription: roleProfile.description,
      tools: toolsForRole,
      specs: toolsForRole.map((t) => t.spec),
      capabilitiesSummary: Array.from(capabilitiesSet),
      promptSupplement: '',
    }
    assignment.promptSupplement = buildRoleMcpPromptSupplementFromAssignment(assignment)
    roleAssignments[roleProfile.roleId] = assignment
  }

  const report: McpCapabilityAssignmentReport = {
    analyzedAt: new Date().toISOString(),
    serversQueried,
    tools: analyzedTools,
    registry,
    allSpecs,
    roleAssignments,
  }

  cachedCapabilityReport = report
  cachedCapabilityTimestamp = now

  trace('mcp.capabilities.assigned', {
    serversQueried,
    totalTools: analyzedTools.length,
    rolesWithTools: Object.values(roleAssignments)
      .filter((r) => r.tools.length > 0)
      .map((r) => ({
        roleId: r.roleId,
        toolCount: r.tools.length,
        tools: r.tools.map((t) => t.tool.qualifiedName),
      })),
  })

  return report
}

export function getCachedMcpCapabilityReport(): McpCapabilityAssignmentReport | null {
  return cachedCapabilityReport
}

export function clearMcpCapabilityCache(clearTokens = false): void {
  cachedCapabilityReport = null
  cachedCapabilityTimestamp = 0
  resolvedEndpointCache.clear()
  if (clearTokens) {
    serverAuthTokenCache.clear()
  }
}

export function getMcpToolsForRole(roleId: string): {
  specs: OpenAiToolSpec[]
  tools: AnalyzedMcpToolCapability[]
  promptSupplement: string
} {
  if (!cachedCapabilityReport) {
    return { specs: [], tools: [], promptSupplement: '' }
  }

  const assignment =
    cachedCapabilityReport.roleAssignments[roleId] ??
    cachedCapabilityReport.roleAssignments['skill_general']

  if (!assignment) {
    return { specs: [], tools: [], promptSupplement: '' }
  }

  return {
    specs: assignment.specs,
    tools: assignment.tools,
    promptSupplement: assignment.promptSupplement,
  }
}

/**
 * Prueba la conexión con el servidor Context7 MCP y descubre sus herramientas en tiempo real,
 * utilizando la API Key configurada (Authorization: Bearer <key>) sin invocar /auth/connect.
 */
export async function testContext7Connection(server: StoredMcpServer): Promise<{
  ok: boolean
  toolsCount: number
  tools: string[]
  error?: string
}> {
  try {
    const tools = await discoverMcpServerTools(server)
    if (tools.length > 0) {
      if (server.id) {
        try {
          await updateMcpServer(server.id, { authStatus: 'authorized' })
        } catch {
          // ignore
        }
      }
      server.authStatus = 'authorized'
      clearMcpCapabilityCache()
      return {
        ok: true,
        toolsCount: tools.length,
        tools: tools.map((t) => t.name),
      }
    }
    return {
      ok: false,
      toolsCount: 0,
      tools: [],
      error: 'El endpoint de Context7 no devolvió ninguna herramienta disponible.',
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err)
    if (server.id) {
      try {
        await updateMcpServer(server.id, { authStatus: 'failed' })
      } catch {
        // ignore
      }
    }
    server.authStatus = 'failed'
    return {
      ok: false,
      toolsCount: 0,
      tools: [],
      error: errorMsg,
    }
  }
}

/**
 * Localiza la mejor herramienta MCP disponible para ejecución CLI en terminal host (priorizando Tether).
 */
export function findCliExecutionTool(report?: McpCapabilityAssignmentReport | null): McpToolDefinition | null {
  const rep = report ?? getCachedMcpCapabilityReport()
  if (!rep || rep.tools.length === 0) return null

  // 1. Priorizar herramienta del servidor Tether con capacidad CLI_EXECUTION_AND_BUILD
  const tetherTool = rep.tools.find(
    (t) =>
      t.categories.includes('CLI_EXECUTION_AND_BUILD') &&
      (t.tool.serverName.toLowerCase().includes('tether') || t.tool.qualifiedName.toLowerCase().includes('tether')),
  )
  if (tetherTool) return tetherTool.tool

  // 2. Cualquier herramienta del servidor Tether
  const anyTetherTool = rep.tools.find(
    (t) =>
      t.tool.serverName.toLowerCase().includes('tether') ||
      t.tool.qualifiedName.toLowerCase().includes('tether'),
  )
  if (anyTetherTool) return anyTetherTool.tool

  // 3. Cualquier herramienta con capacidad CLI_EXECUTION_AND_BUILD
  const anyCliTool = rep.tools.find((t) => t.categories.includes('CLI_EXECUTION_AND_BUILD'))
  if (anyCliTool) return anyCliTool.tool

  return null
}

/**
 * Indica si hay herramientas MCP de Tether o ejecución CLI disponibles en el registro.
 */
export function isTetherAvailable(report?: McpCapabilityAssignmentReport | null): boolean {
  return Boolean(findCliExecutionTool(report))
}

/**
 * Ejecuta un comando en la máquina anfitriona a través de Tether MCP o la herramienta CLI disponible.
 * Adapta los argumentos al esquema esperado por la herramienta (cmd, command, script, etc.).
 */
export async function executeCliViaMcp(
  command: string,
  authContext?: McpAuthConnectContext,
  tool?: McpToolDefinition | null,
): Promise<{ ok: boolean; output: string; exitCode: number }> {
  const cliTool = tool ?? findCliExecutionTool()
  if (!cliTool) {
    return {
      ok: false,
      output: 'No hay ninguna herramienta CLI o de Tether disponible en el registro de capacidades MCP.',
      exitCode: 1,
    }
  }

  const args: Record<string, unknown> = {}
  const props = cliTool.inputSchema?.properties || {}
  if ('command' in props) {
    args.command = command
  }
  if ('cmd' in props) {
    args.cmd = command
  }
  if ('script' in props) {
    args.script = command
  }
  if (Object.keys(args).length === 0) {
    args.cmd = command
    args.command = command
  }

  try {
    const rawOutput = await callMcpTool(cliTool, args, authContext)
    let exitCode = 0
    let text = typeof rawOutput === 'string' ? rawOutput : JSON.stringify(rawOutput)

    try {
      const parsed = JSON.parse(text)
      if (typeof parsed === 'object' && parsed !== null) {
        if (typeof parsed.exitCode === 'number') exitCode = parsed.exitCode
        if (typeof parsed.code === 'number') exitCode = parsed.code
        const stdOut = typeof parsed.stdout === 'string' ? parsed.stdout : ''
        const stdErr = typeof parsed.stderr === 'string' ? parsed.stderr : ''
        if (stdOut || stdErr) {
          text = `${stdOut}\n${stdErr}`.trim()
        }
      }
    } catch {
      // texto plano
    }

    const hasErrorSignals =
      exitCode !== 0 ||
      /\b(?:error TS\d+|failed to compile|syntaxerror|compilation failed|build failed|cannot find module|failed to resolve import)\b/i.test(
        text,
      )

    return {
      ok: !hasErrorSignals,
      output: text,
      exitCode,
    }
  } catch (err) {
    return {
      ok: false,
      output: err instanceof Error ? err.message : String(err),
      exitCode: 1,
    }
  }
}
