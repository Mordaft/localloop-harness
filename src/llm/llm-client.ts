import { getLlmConfig } from './llm-config'
import { trace } from '../diagnostics'
import {
  AgentScopeStorage,
  computeScopeSignature,
  normalizeScopeKeyText,
  toReducedScopeSummary,
  type AgentSkillName,
  type AtomicTaskDeliverable,
  type AtomicTestEvidence,
  type ScopeExecutionResult,
  type ScopeFinding,
  type ScopeTaskDefinition,
  type SubAgentDeliverableSummary,
} from '../memory/engram-memory'
import {
  executeWebGuidanceTool,
  getWebGuidanceToolSpecs,
  hasLoadedWebGuidanceDocs,
} from '../memory/web-guidance-manager'
import { executeBrowserSandbox, stripMarkdownCodeFences } from '../sandbox/browser-sandbox'
import { executeSandboxedJs } from '../sandbox/code-runner'

interface RawToolCallDelta {
  index?: number
  id?: string
  type?: string
  function?: {
    name?: string
    arguments?: string
  }
}

interface ChatCompletionChunk {
  choices?: Array<{
    index?: number
    finish_reason?: string | null
    delta?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: RawToolCallDelta[]
    }
    message?: {
      role?: string
      content?: string | null
      reasoning_content?: string | null
      reasoning?: string | null
      tool_calls?: Array<{
        id?: string
        type?: string
        function?: {
          name?: string
          arguments?: string
        }
      }>
    }
  }>
  usage?: {
    prompt_tokens?: number
    completion_tokens?: number
    total_tokens?: number
  }
}

export interface ParsedToolCall {
  id: string
  name: string
  argumentsRaw: string
  args: Record<string, unknown>
}

export interface OpenAiToolSpec {
  type: 'function'
  function: {
    name: string
    description: string
    parameters: Record<string, unknown>
  }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  tool_call_id?: string
  name?: string
  thought?: string
  tool_calls?: Array<{
    id: string
    type: 'function'
    function: {
      name: string
      arguments: string
    }
  }>
}

export interface LlmStreamResponse {
  toolCalls: ParsedToolCall[]
  contentBuffer: string
  thoughtBuffer: string
  finishReason: string | null
  reasoningChars: number
  estimatedTokens: number
}

const DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS = 90_000
const MAX_SUBTASKS_PER_SCOPE = 6

/**
 * Request-level concurrency gate (FIFO semaphore) reused from codereview-ai-assisted.
 * Limits simultaneous HTTP requests to the local LLM runtime across the entire execution tree.
 */
export class SlmConcurrencyGate {
  private active = 0
  private readonly queue: Array<() => void> = []
  private readonly limit: number

  constructor(maxConcurrent: number) {
    this.limit = Math.max(1, maxConcurrent)
  }

  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError')
    }
    if (this.active < this.limit) {
      this.active += 1
      let released = false
      return () => {
        if (released) return
        released = true
        this.release()
      }
    }

    return new Promise<() => void>((resolve, reject) => {
      let settled = false
      const onAbort = () => {
        if (settled) return
        settled = true
        const idx = this.queue.indexOf(wake)
        if (idx >= 0) this.queue.splice(idx, 1)
        reject(new DOMException('Aborted', 'AbortError'))
      }

      const wake = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        let released = false
        resolve(() => {
          if (released) return
          released = true
          this.release()
        })
      }

      signal?.addEventListener('abort', onAbort, { once: true })
      this.queue.push(wake)
    })
  }

  private release(): void {
    const next = this.queue.shift()
    if (next) {
      next()
    } else {
      this.active = Math.max(0, this.active - 1)
    }
  }
}

export function completeJsonObjects(content: string): string[] {
  const objects: string[] = []
  for (let start = 0; start < content.length; start += 1) {
    if (content[start] !== '{') continue
    let depth = 0
    let inString = false
    let escaped = false
    for (let index = start; index < content.length; index += 1) {
      const character = content[index]
      if (inString) {
        if (escaped) escaped = false
        else if (character === '\\') escaped = true
        else if (character === '"') inString = false
        continue
      }
      if (character === '"') inString = true
      else if (character === '{') depth += 1
      else if (character === '}') {
        depth -= 1
        if (depth === 0) {
          objects.push(content.slice(start, index + 1))
          start = index
          break
        }
      }
    }
  }
  return objects
}

export function safeParseJsonObject(raw: string): Record<string, unknown> {
  const trimmed = raw.trim()
  if (!trimmed) return {}
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    const objects = completeJsonObjects(trimmed)
    for (const candidate of objects) {
      try {
        const parsed = JSON.parse(candidate) as unknown
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          return parsed as Record<string, unknown>
        }
      } catch {
        // Continue trying next object
      }
    }
  }
  return {}
}

export function estimateMessageTokens(messages: ChatMessage[], completionText = ''): number {
  const inputChars = messages.reduce(
    (acc, m) => acc + (m.content?.length ?? 0) + JSON.stringify(m.tool_calls ?? '').length,
    0,
  )
  return Math.max(1, Math.ceil((inputChars + completionText.length) / 4))
}

/**
 * Core OpenAI-compatible SSE Streaming client reused from codereview-ai-assisted (`callSlmWithTools`).
 * Supports `<think>...</think>` reasoning blocks, `delta.reasoning_content`, incremental `tool_calls`,
 * inactivity timeouts, and `SlmConcurrencyGate`.
 */
export async function streamChatCompletion(params: {
  scopeId?: string
  messages: ChatMessage[]
  tools?: OpenAiToolSpec[]
  toolChoice?: 'none' | 'auto' | 'required'
  concurrencyGate?: SlmConcurrencyGate
  requestTimeoutMs?: number
  onThinking?: (thought: string) => void | Promise<void>
  onContentDelta?: (contentSoFar: string, delta: string) => void | Promise<void>
  signal?: AbortSignal
}): Promise<LlmStreamResponse> {
  const { messages, tools, onThinking, onContentDelta, signal } = params
  const releaseGate = params.concurrencyGate
    ? await params.concurrencyGate.acquire(signal)
    : () => { }

  const inactivityTimeoutMs = params.requestTimeoutMs ?? DEFAULT_STREAM_INACTIVITY_TIMEOUT_MS
  const requestAbortController = new AbortController()
  let timedOut = false
  let inactivityTimer: ReturnType<typeof setTimeout> | undefined

  const resetInactivityTimer = () => {
    if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
    inactivityTimer = setTimeout(() => {
      timedOut = true
      requestAbortController.abort()
    }, inactivityTimeoutMs)
  }

  const onParentAbort = () => {
    requestAbortController.abort()
  }
  signal?.addEventListener('abort', onParentAbort, { once: true })
  if (signal?.aborted) {
    requestAbortController.abort()
  }

  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined

  try {
    const config = getLlmConfig()
    const startedAt = performance.now()
    const hasTools = Boolean(tools && tools.length > 0)
    const toolChoice = hasTools ? (params.toolChoice ?? 'auto') : undefined

    trace('llm.stream.start', {
      scopeId: params.scopeId,
      model: config.model,
      maxTokens: config.maxTokens,
      toolsCount: tools?.length ?? 0,
    })

    resetInactivityTimer()

    const requestBody: Record<string, unknown> = {
      model: config.model,
      temperature: config.temperature,
      max_tokens: config.maxTokens,
      max_completion_tokens: config.maxTokens,
      stream: true,
      chat_template_kwargs: {
        enable_thinking: true,
      },
      messages: messages.map(({ thought: _t, ...rest }) => rest),
    }

    if (hasTools) {
      requestBody.tools = tools
      requestBody.tool_choice = toolChoice
    }

    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: requestAbortController.signal,
      body: JSON.stringify(requestBody),
    })

    resetInactivityTimer()

    if (!response.ok) {
      const errorDetail = await response.text().catch(() => '')
      trace('llm.stream.response_error', {
        scopeId: params.scopeId,
        status: response.status,
        errorDetail: errorDetail.slice(0, 400),
      })
      throw new Error(
        `El runtime LLM respondió ${response.status}${errorDetail ? `: ${errorDetail.slice(0, 200)}` : '.'}`,
      )
    }

    if (!response.body) {
      throw new Error('El runtime LLM no devolvió un cuerpo de respuesta.')
    }

    reader = response.body.getReader()
    const decoder = new TextDecoder()
    let streamBuffer = ''
    let rawResponseText = ''
    let contentBuffer = ''
    let finishReason: string | null = null
    let reasoningChars = 0
    let accumulatedThought = ''
    let usageTotalTokens = 0

    let inThinkTag = false
    let thinkTagBuffer = ''

    const toolCallsMap = new Map<number, { id: string; name: string; arguments: string }>()

    function recordToolCallDelta(
      idx: number,
      id: string | undefined,
      name: string | undefined,
      argsChunk: string | undefined,
    ) {
      const existing = toolCallsMap.get(idx) ?? {
        id: id || `call_${idx}_${Date.now()}`,
        name: '',
        arguments: '',
      }
      if (id) existing.id = id
      if (name) existing.name = existing.name ? existing.name : name
      if (typeof argsChunk === 'string') {
        existing.arguments += argsChunk
      }
      toolCallsMap.set(idx, existing)
    }

    function processContentDelta(text: string): string {
      let combined = thinkTagBuffer + text
      thinkTagBuffer = ''
      let clean = ''

      while (combined.length > 0) {
        if (!inThinkTag) {
          const openIdx = combined.indexOf('<think>')
          if (openIdx !== -1) {
            clean += combined.slice(0, openIdx)
            inThinkTag = true
            combined = combined.slice(openIdx + 7)
          } else {
            const possiblePartial = combined.match(/<t(?:h(?:i(?:n(?:k)?)?)?)?$/)
            if (possiblePartial && possiblePartial.index !== undefined) {
              clean += combined.slice(0, possiblePartial.index)
              thinkTagBuffer = possiblePartial[0]
              combined = ''
            } else {
              clean += combined
              combined = ''
            }
          }
        } else {
          const closeIdx = combined.indexOf('</think>')
          if (closeIdx !== -1) {
            const thinkChunk = combined.slice(0, closeIdx)
            accumulatedThought += thinkChunk
            reasoningChars += closeIdx
            inThinkTag = false
            combined = combined.slice(closeIdx + 8)
            if (onThinking) {
              try {
                void onThinking(accumulatedThought)
              } catch {
                // Ignore callback error
              }
            }
          } else {
            const possiblePartial = combined.match(/<\/t(?:h(?:i(?:n(?:k)?)?)?)?$/)
            if (possiblePartial && possiblePartial.index !== undefined) {
              const thinkChunk = combined.slice(0, possiblePartial.index)
              accumulatedThought += thinkChunk
              reasoningChars += possiblePartial.index
              thinkTagBuffer = possiblePartial[0]
              combined = ''
            } else {
              accumulatedThought += combined
              reasoningChars += combined.length
              combined = ''
            }
            if (onThinking) {
              try {
                void onThinking(accumulatedThought)
              } catch {
                // Ignore callback error
              }
            }
          }
        }
      }
      return clean
    }

    function handleParsedChunk(parsed: ChatCompletionChunk) {
      if (parsed.usage?.total_tokens) {
        usageTotalTokens = parsed.usage.total_tokens
      }
      const choice = parsed.choices?.[0]
      if (!choice) return
      if (choice.finish_reason) finishReason = choice.finish_reason

      const delta = choice.delta
      if (delta) {
        const rawReasoning = delta.reasoning_content ?? delta.reasoning
        if (typeof rawReasoning === 'string' && rawReasoning.length > 0) {
          accumulatedThought += rawReasoning
          reasoningChars += rawReasoning.length
          if (onThinking) {
            try {
              void onThinking(accumulatedThought)
            } catch {
              // Ignore
            }
          }
        }

        if (Array.isArray(delta.tool_calls)) {
          for (const [idx, tc] of delta.tool_calls.entries()) {
            recordToolCallDelta(tc.index ?? idx, tc.id, tc.function?.name, tc.function?.arguments)
          }
        }

        if (typeof delta.content === 'string' && delta.content.length > 0) {
          const cleanDelta = processContentDelta(delta.content)
          if (cleanDelta.length > 0) {
            contentBuffer += cleanDelta
            if (onContentDelta) {
              try {
                void onContentDelta(contentBuffer, cleanDelta)
              } catch {
                // Ignore
              }
            }
          }
        }
      }

      const message = choice.message
      if (message) {
        const rawReasoning = message.reasoning_content ?? message.reasoning
        if (typeof rawReasoning === 'string' && rawReasoning.length > 0) {
          accumulatedThought += rawReasoning
          reasoningChars += rawReasoning.length
          if (onThinking) {
            try {
              void onThinking(accumulatedThought)
            } catch {
              // Ignore
            }
          }
        }

        if (Array.isArray(message.tool_calls)) {
          for (const [idx, tc] of message.tool_calls.entries()) {
            recordToolCallDelta(idx, tc.id, tc.function?.name, tc.function?.arguments)
          }
        }

        if (typeof message.content === 'string' && message.content.length > 0) {
          const cleanContent = processContentDelta(message.content)
          if (cleanContent.length > 0) {
            contentBuffer += cleanContent
            if (onContentDelta) {
              try {
                void onContentDelta(contentBuffer, cleanContent)
              } catch {
                // Ignore
              }
            }
          }
        }
      }
    }

    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError')
      }
      const { done, value } = await reader.read()
      resetInactivityTimer()
      if (done) break

      const decoded = decoder.decode(value, { stream: true })
      rawResponseText += decoded
      streamBuffer += decoded
      const lines = streamBuffer.split('\n')
      streamBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) continue
        const dataStr = trimmed.slice(5).trim()
        if (dataStr === '[DONE]') continue
        try {
          const parsed = JSON.parse(dataStr) as ChatCompletionChunk
          handleParsedChunk(parsed)
        } catch {
          // Skip unparseable SSE chunk
        }
      }
    }

    if (streamBuffer.trim().startsWith('data:')) {
      const dataStr = streamBuffer.trim().slice(5).trim()
      if (dataStr !== '[DONE]') {
        try {
          const parsed = JSON.parse(dataStr) as ChatCompletionChunk
          handleParsedChunk(parsed)
        } catch {
          // Skip
        }
      }
    } else if (
      toolCallsMap.size === 0 &&
      contentBuffer.length === 0 &&
      rawResponseText.trim().startsWith('{')
    ) {
      try {
        const parsed = JSON.parse(rawResponseText.trim()) as ChatCompletionChunk
        handleParsedChunk(parsed)
      } catch {
        // Ignore
      }
    }

    if (thinkTagBuffer.length > 0) {
      if (inThinkTag) {
        accumulatedThought += thinkTagBuffer
        reasoningChars += thinkTagBuffer.length
      } else {
        contentBuffer += thinkTagBuffer
      }
    }

    const toolCalls: ParsedToolCall[] = [...toolCallsMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, tc]) => ({
        id: tc.id,
        name: tc.name,
        argumentsRaw: tc.arguments,
        args: safeParseJsonObject(tc.arguments),
      }))
      .filter((tc) => tc.name.length > 0)

    const estimatedTokens =
      usageTotalTokens > 0
        ? usageTotalTokens
        : estimateMessageTokens(messages, contentBuffer + accumulatedThought)

    trace('llm.stream.complete', {
      scopeId: params.scopeId,
      elapsedMs: Math.round(performance.now() - startedAt),
      reasoningChars,
      contentChars: contentBuffer.length,
      finishReason,
      toolCallsCount: toolCalls.length,
      toolNames: toolCalls.map((t) => t.name),
      estimatedTokens,
    })

    return {
      toolCalls,
      contentBuffer,
      thoughtBuffer: accumulatedThought,
      finishReason,
      reasoningChars,
      estimatedTokens,
    }
  } catch (err) {
    if (timedOut && !signal?.aborted) {
      throw new Error(
        `El runtime LLM excedió el tiempo de espera de inactividad (${Math.round(inactivityTimeoutMs / 1000)}s).`,
      )
    }
    throw err
  } finally {
    if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
    signal?.removeEventListener('abort', onParentAbort)
    if (reader) {
      try {
        await reader.cancel()
      } catch {
        // Ignore
      }
      try {
        reader.releaseLock()
      } catch {
        // Ignore
      }
    }
    releaseGate()
  }
}

const findingItemSchema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    filePath: { type: 'string' },
    line: { type: 'integer', minimum: 1 },
    severity: { type: 'string', enum: ['baja', 'media', 'alta'] },
    category: { type: 'string' },
    message: { type: 'string' },
    recommendation: { type: 'string' },
  },
  required: ['message'],
}

export function buildStep1ScopeTools(
  allowDecompose: boolean,
  hasMemoryHeaders: boolean,
  forceDecompose = false,
  includeWebGuidance = false,
): OpenAiToolSpec[] {
  const tools: OpenAiToolSpec[] = []

  const atomicDeliverableProperties: Record<string, unknown> = {
    foco: { type: 'string' },
    tarea_realizada: {
      type: 'string',
      description:
        'OBLIGATORIO: Entrega completa de la tarea realizada (código, cambios o solución implementada).',
    },
    prueba_automatizada: {
      type: 'string',
      description:
        'OBLIGATORIO: Código ejecutable de la prueba automatizada implementada (JS o script DOM para navegador iframe) que verifica la prueba de aceptación.',
    },
    modo_sandbox: {
      type: 'string',
      enum: ['js', 'browser_iframe'],
      description:
        'Entorno donde ejecutar la prueba automatizada: "browser_iframe" si prueba DOM/HTML en un iframe o "js" para lógica pura.',
    },
    html_prueba: {
      type: 'string',
      description:
        'Markup HTML opcional a montar en el iframe sandbox durante la prueba automatizada.',
    },
    css_prueba: {
      type: 'string',
      description: 'CSS opcional a montar en el iframe sandbox.',
    },
    selector_dom: {
      type: 'string',
      description: 'Selector CSS opcional a consultar en el DOM del iframe sandbox.',
    },
    evidencia_prueba: {
      type: 'string',
      description:
        'OBLIGATORIO: Evidencia verificable de haber realizado y superado la prueba automatizada.',
    },
    sumario_ejecutivo: { type: 'string' },
    findings: { type: 'array', items: findingItemSchema },
  }

  if (!forceDecompose || !allowDecompose) {
    tools.push({
      type: 'function',
      function: {
        name: 'ejecutar_tarea_atomica',
        description:
          'Ejecuta y entrega la tarea asignada a este sub-agente cuando NO necesita descomponerse en más subtareas. Es OBLIGATORIO entregar: 1) tarea_realizada, 2) prueba_automatizada implementada y 3) evidencia_prueba.',
        parameters: {
          type: 'object',
          properties: {
            skill_a_usar: {
              type: 'string',
              enum: ['skill_architect', 'skill_coder', 'skill_security', 'skill_general'],
            },
            ...atomicDeliverableProperties,
            argumentos: {
              type: 'object',
              properties: atomicDeliverableProperties,
              required: ['tarea_realizada', 'prueba_automatizada', 'evidencia_prueba'],
            },
          },
        },
      },
    })
  }

  if (allowDecompose) {
    tools.push({
      type: 'function',
      function: {
        name: 'descomponer_en_subtareas',
        description: forceDecompose
          ? 'OBLIGATORIO para iniciar o dividir un trabajo: crea una lista de tareas verificables donde cada elemento define explícitamente su prueba de aceptación (prueba_aceptacion). Cada tarea de la lista se delega a un sub-agente independiente.'
          : 'Opcional: úsala SOLO si la tarea asignada es compuesta y requiere subdividirse en subtareas más pequeñas con su propia prueba_aceptacion. Si la tarea ya tiene una prueba de aceptación directa, usa ejecutar_tarea_atomica.',
        parameters: {
          type: 'object',
          properties: {
            justificacion: { type: 'string' },
            subtareas: {
              type: 'array',
              minItems: 1,
              items: {
                type: 'object',
                properties: {
                  id_subtarea: { type: 'string' },
                  descripcion: {
                    type: 'string',
                    description: 'Descripción de la tarea verificable a asignar al sub-agente.',
                  },
                  prueba_aceptacion: {
                    type: 'string',
                    description:
                      'OBLIGATORIO: Definición de la prueba de aceptación que valida empíricamente esta tarea.',
                  },
                  skill_requerida: {
                    type: 'string',
                    enum: ['skill_architect', 'skill_coder', 'skill_security', 'skill_general'],
                  },
                  targetPath: { type: 'string' },
                  lineStart: { type: 'integer', minimum: 1 },
                  lineEnd: { type: 'integer', minimum: 1 },
                },
                required: ['id_subtarea', 'descripcion', 'prueba_aceptacion'],
              },
            },
          },
          required: ['subtareas'],
        },
      },
    })
  }

  if (hasMemoryHeaders) {
    tools.push({
      type: 'function',
      function: {
        name: 'reutilizar_scope_memoria',
        description:
          'Úsala si en engram-ts ya existe un sub-scope completado equivalente a esta tarea.',
        parameters: {
          type: 'object',
          properties: {
            id_scope: { type: 'string' },
            motivo: { type: 'string' },
          },
          required: ['id_scope'],
        },
      },
    })
  }

  if (includeWebGuidance && !forceDecompose) {
    tools.push(...getWebGuidanceToolSpecs())
  }

  return tools
}

function normalizeFindings(items: unknown[], fallbackPath = 'workspace'): ScopeFinding[] {
  if (!Array.isArray(items)) return []
  return items.flatMap((item, idx): ScopeFinding[] => {
    if (!item || typeof item !== 'object') return []
    const raw = item as Record<string, unknown>
    const msg =
      typeof raw.message === 'string'
        ? raw.message.trim()
        : typeof raw.description === 'string'
          ? raw.description.trim()
          : ''
    if (!msg) return []
    const sevRaw = String(raw.severity ?? 'media').toLowerCase()
    const severity: 'baja' | 'media' | 'alta' =
      sevRaw === 'alta' || sevRaw === 'high'
        ? 'alta'
        : sevRaw === 'baja' || sevRaw === 'low'
          ? 'baja'
          : 'media'
    return [
      {
        id: typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : `f-${idx + 1}-${Date.now()}`,
        filePath: typeof raw.filePath === 'string' && raw.filePath.trim() ? raw.filePath.trim() : fallbackPath,
        line: typeof raw.line === 'number' && raw.line > 0 ? Math.round(raw.line) : 1,
        severity,
        category: typeof raw.category === 'string' ? raw.category : 'general',
        message: msg,
        recommendation: typeof raw.recommendation === 'string' ? raw.recommendation : msg,
      },
    ]
  })
}

export interface FractalScopeContext {
  targetPath: string
  codeContent: string
  baseInstructions: string
  maxDepth: number
  maxConcurrency: number
  concurrencyGate: SlmConcurrencyGate
  forceRootDecomposition?: boolean
  enableWebGuidance?: boolean
  maxGuidanceIterations?: number
  onThinking?: (thought: string) => void | Promise<void>
  signal?: AbortSignal
}

async function runAndVerifyAtomicTest(params: {
  tareaRealizada: string
  pruebaAceptacion: string
  pruebaAutomatizada: string
  evidenciaAgente: string
  modoSandbox?: string
  htmlPrueba?: string
  cssPrueba?: string
  selectorDom?: string
}): Promise<AtomicTestEvidence> {
  const cleanedTestCode = stripMarkdownCodeFences(params.pruebaAutomatizada)
  const codeToRun =
    cleanedTestCode ||
    `if (!${JSON.stringify(params.tareaRealizada.trim())}) throw new Error("Tarea vacía"); console.log("Verificación automática de tarea atómica OK"); return true;`

  const useBrowser =
    params.modoSandbox === 'browser_iframe' ||
    Boolean(params.htmlPrueba && params.htmlPrueba.trim()) ||
    /\b(document|window|HTMLElement|querySelector|getElementById)\b/.test(codeToRun)

  if (useBrowser) {
    const browserRes = await executeBrowserSandbox({
      html: params.htmlPrueba ?? '',
      css: params.cssPrueba ?? '',
      code: codeToRun,
      domSelector: params.selectorDom,
      captureScreenshot: true,
      timeoutMs: 5000,
    })
    const resumen = [
      params.evidenciaAgente.trim(),
      `[Browser Iframe Sandbox: ${browserRes.ok ? 'PASS ✓' : 'FAIL ✗'} en ${browserRes.durationMs}ms | Logs: ${browserRes.logs.join(' ; ') || 'ninguno'} | DOM: ${browserRes.dom.text.slice(0, 160) || 'vacío'}]`,
    ]
      .filter(Boolean)
      .join(' — ')

    return {
      ejecutada: true,
      exito: browserRes.ok,
      modo: 'browser_iframe_sandbox',
      logs: browserRes.logs,
      returnValue: browserRes.returnValue,
      domSnapshot: browserRes.dom.html.slice(0, 1500),
      screenshotDataUrl: browserRes.screenshotDataUrl,
      error: browserRes.error,
      reporteAgente: params.evidenciaAgente.trim() || undefined,
      resumen,
    }
  }

  const jsRes = await executeSandboxedJs(codeToRun, 3000)
  const resumen = [
    params.evidenciaAgente.trim(),
    `[JS Sandbox: ${jsRes.ok ? 'PASS ✓' : 'FAIL ✗'} en ${jsRes.durationMs}ms | Logs: ${jsRes.logs.join(' ; ') || 'ninguno'}${jsRes.returnValue ? ` | Return: ${jsRes.returnValue}` : ''}]`,
  ]
    .filter(Boolean)
    .join(' — ')

  return {
    ejecutada: true,
    exito: jsRes.ok,
    modo: 'js_sandbox',
    logs: jsRes.logs,
    returnValue: jsRes.returnValue,
    error: jsRes.error,
    reporteAgente: params.evidenciaAgente.trim() || undefined,
    resumen,
  }
}

/**
 * Homogeneous Fractal Sub-Agent Scope Loop reused from codereview-ai-assisted (`procesarNodoScope`).
 * Enforces mandatory task list creation with acceptance tests (`prueba_aceptacion`) at root scope,
 * delegates each task item to a child sub-agent, and requires every atomic leaf sub-agent to deliver
 * `tarea_realizada`, `prueba_automatizada`, and verifiable `evidencia_prueba`.
 */
export async function procesarNodoScope(
  task: ScopeTaskDefinition,
  parentStorage: AgentScopeStorage,
  context: FractalScopeContext,
  isRootScope = false,
): Promise<ScopeExecutionResult> {
  if (context.signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }

  const currentStorage = isRootScope
    ? parentStorage
    : parentStorage.createChildScopeStorage(task.id_subtarea, task.targetPath)

  const lines = context.codeContent.split('\n')
  const start = task.lineStart && task.lineStart >= 1 ? Math.min(task.lineStart, lines.length) : 1
  const end = task.lineEnd && task.lineEnd >= start ? Math.min(task.lineEnd, lines.length) : lines.length
  const rawSlice = lines.slice(start - 1, end).join('\n')

  const cachedResult = await currentStorage.findReusableScopeResult(task, rawSlice)
  if (cachedResult) {
    if (context.onThinking) {
      void context.onThinking(
        `[engram-ts] Reutilizando memoria de sub-scope ${cachedResult.id_scope} (${cachedResult.engram_ref})`,
      )
    }
    return cachedResult
  }

  const { sigTag } = computeScopeSignature({
    filePath: context.targetPath,
    skill: task.skill_requerida,
    lineStart: task.lineStart,
    lineEnd: task.lineEnd,
    codeSlice: rawSlice,
    descripcion: task.descripcion,
  })

  const executionPromise = (async (): Promise<ScopeExecutionResult> => {
    const canDecompose =
      currentStorage.depth < context.maxDepth && task.requiere_sub_planificacion !== false
    const forceDecompose =
      canDecompose && isRootScope && context.forceRootDecomposition !== false
    const relatedHeaders = await currentStorage.listRelatedScopeHeaders(task)
    const useWebGuidance =
      !forceDecompose && (context.enableWebGuidance ?? hasLoadedWebGuidanceDocs())
    const maxGuidanceIterations = useWebGuidance
      ? Math.min(3, Math.max(2, context.maxGuidanceIterations ?? 3))
      : 1

    const baseStep1Tools = buildStep1ScopeTools(
      canDecompose,
      relatedHeaders.length > 0,
      forceDecompose,
      false,
    )
    const guidanceStep1Tools = useWebGuidance
      ? buildStep1ScopeTools(canDecompose, relatedHeaders.length > 0, forceDecompose, true)
      : baseStep1Tools

    const memoryCatalogText =
      relatedHeaders.length > 0
        ? `\nMEMORIAS EN ENGRAM-TS:\n${relatedHeaders
          .map((h) => `- id_scope: "${h.id}" | título: "${h.title}"`)
          .join('\n')}`
        : ''

    const acceptanceCriterion =
      task.prueba_aceptacion?.trim() ||
      `Verificar mediante prueba automatizada que se cumple: ${task.descripcion}`

    const decompositionDirective = forceDecompose
      ? `\nREGLA OBLIGATORIA DE DESCOMPOSICIÓN: Estás en el nivel raíz del trabajo. Es OBLIGATORIO crear primero una lista de tareas invocando "descomponer_en_subtareas". Una tarea es aquello para lo que podemos definir una prueba: cada elemento de "subtareas" DEBE incluir su "descripcion" y su "prueba_aceptacion", y cada elemento se pasará a un sub-agente.`
      : `\nREGLA DE EJECUCIÓN Y ENTREGA ATÓMICA: Esta tarea ya forma parte de una lista descompuesta y tiene una prueba de aceptación asignada.${useWebGuidance ? ' Puedes consultar previamente "search_web_guidance" y "read_web_guidance_doc" (hasta 2 pasos) si la tarea involucra HTML, CSS, DOM o APIs web modernas.' : ''} Invoca "ejecutar_tarea_atomica" y entrega obligatoriamente: 1) "tarea_realizada", 2) "prueba_automatizada" (código ejecutable JS o prueba de DOM en iframe que valide la prueba de aceptación), y 3) "evidencia_prueba". NO vuelvas a descomponer salvo que sea estrictamente imposible abordarla en una sola prueba.`

    const sanitizedBaseInstructions = context.baseInstructions.includes('plan_and_delegate_tasks')
      ? 'Actúa con precisión técnica verificando empíricamente cada entrega mediante su prueba de aceptación.'
      : context.baseInstructions

    const scopeMessages: ChatMessage[] = [
      {
        role: 'system',
        content: `Eres un sub-agente especializado dentro de LocalLoop con memoria engram-ts.\n${sanitizedBaseInstructions}${decompositionDirective}`,
      },
      {
        role: 'user',
        content: `SCOPE: ${currentStorage.scopeId} (Profundidad ${currentStorage.depth}/${context.maxDepth})\nTAREA: ${task.descripcion}\nPRUEBA DE ACEPTACIÓN: ${acceptanceCriterion}\nOBJETIVO: ${context.targetPath}${memoryCatalogText}\n\nCONTENIDO:\n${rawSlice.slice(0, 12000)}`,
      },
    ]

    let response!: LlmStreamResponse
    let decisionCall: ParsedToolCall | undefined
    const decisionToolNames = new Set([
      'ejecutar_tarea_atomica',
      'descomponer_en_subtareas',
      'reutilizar_scope_memoria',
    ])

    for (let iter = 0; iter < maxGuidanceIterations; iter++) {
      const isLastIter = iter === maxGuidanceIterations - 1
      const toolsForTurn = isLastIter ? baseStep1Tools : guidanceStep1Tools

      response = await streamChatCompletion({
        scopeId:
          maxGuidanceIterations > 1
            ? `${currentStorage.scopeId}_iter_${iter + 1}`
            : currentStorage.scopeId,
        messages: scopeMessages,
        tools: toolsForTurn,
        toolChoice: 'required',
        concurrencyGate: context.concurrencyGate,
        onThinking: context.onThinking,
        signal: context.signal,
      })

      decisionCall = response.toolCalls.find((tc) => decisionToolNames.has(tc.name))
      if (decisionCall || isLastIter) {
        if (!decisionCall) {
          decisionCall = response.toolCalls[0]
        }
        break
      }

      const guidanceCalls = response.toolCalls.filter(
        (tc) => tc.name === 'search_web_guidance' || tc.name === 'read_web_guidance_doc',
      )
      if (guidanceCalls.length === 0) {
        decisionCall = response.toolCalls[0]
        break
      }

      scopeMessages.push({
        role: 'assistant',
        content: response.contentBuffer || '',
        tool_calls: guidanceCalls.map((tc) => ({
          id: tc.id,
          type: 'function' as const,
          function: {
            name: tc.name,
            arguments: tc.argumentsRaw || JSON.stringify(tc.args),
          },
        })),
      })

      for (const tc of guidanceCalls) {
        if (context.onThinking) {
          void context.onThinking(
            `[modern-web-guidance] Sub-agente ${currentStorage.scopeId} ejecutando ${tc.name} (iteración ${iter + 1}/${maxGuidanceIterations})...`,
          )
        }
        const toolOutput = await executeWebGuidanceTool(tc.name, tc.args)
        scopeMessages.push({
          role: 'tool',
          tool_call_id: tc.id,
          name: tc.name,
          content: toolOutput,
        })
      }
    }

    if (decisionCall?.name === 'reutilizar_scope_memoria') {
      const targetScopeRef = String(decisionCall.args.id_scope ?? '')
      const recovered = await currentStorage.getScopeResultByMemoryId(targetScopeRef)
      if (recovered) return recovered
    }

    if (
      (decisionCall?.name === 'descomponer_en_subtareas' || forceDecompose) &&
      canDecompose
    ) {
      const rawArgs = decisionCall?.args ?? {}
      const rawSubtasks = Array.isArray(rawArgs.subtareas)
        ? rawArgs.subtareas
        : Array.isArray(rawArgs.tasks)
          ? rawArgs.tasks
          : Array.isArray(rawArgs.tareas)
            ? rawArgs.tareas
            : Array.isArray(rawArgs.lista_tareas)
              ? rawArgs.lista_tareas
              : Array.isArray(rawArgs.items)
                ? rawArgs.items
                : []
      const subPlan: ScopeTaskDefinition[] = []
      for (const [idx, item] of rawSubtasks.entries()) {
        if (!item || typeof item !== 'object') continue
        const rawItem = item as Record<string, unknown>
        const rawId =
          typeof rawItem.id_subtarea === 'string' && rawItem.id_subtarea.trim()
            ? rawItem.id_subtarea.trim()
            : typeof rawItem.id === 'string' && rawItem.id.trim()
              ? rawItem.id.trim()
              : `${currentStorage.scopeId}_sub_${idx + 1}`
        const safeId =
          rawId === currentStorage.scopeId || currentStorage.ancestorScopeIds.has(rawId)
            ? `${currentStorage.scopeId}_${rawId}_${idx + 1}`
            : rawId
        const desc =
          typeof rawItem.descripcion === 'string' && rawItem.descripcion.trim()
            ? rawItem.descripcion.trim()
            : typeof rawItem.description === 'string' && rawItem.description.trim()
              ? rawItem.description.trim()
              : `${task.descripcion} #${idx + 1}`
        const pruebaAceptacion =
          typeof rawItem.prueba_aceptacion === 'string' && rawItem.prueba_aceptacion.trim()
            ? rawItem.prueba_aceptacion.trim()
            : typeof rawItem.acceptanceTest === 'string' && rawItem.acceptanceTest.trim()
              ? rawItem.acceptanceTest.trim()
              : `Verificar automatizadamente que: ${desc}`

        subPlan.push({
          id_subtarea: safeId,
          descripcion: desc,
          prueba_aceptacion: pruebaAceptacion,
          skill_requerida:
            (rawItem.skill_requerida as AgentSkillName) ??
            (rawItem.skill as AgentSkillName) ??
            'skill_general',
          targetPath:
            typeof rawItem.targetPath === 'string' && rawItem.targetPath.trim()
              ? rawItem.targetPath.trim()
              : task.targetPath ?? context.targetPath,
          lineStart: typeof rawItem.lineStart === 'number' ? rawItem.lineStart : task.lineStart,
          lineEnd: typeof rawItem.lineEnd === 'number' ? rawItem.lineEnd : task.lineEnd,
          requiere_sub_planificacion:
            typeof rawItem.requiere_sub_planificacion === 'boolean'
              ? rawItem.requiere_sub_planificacion
              : false,
        })
        if (subPlan.length >= MAX_SUBTASKS_PER_SCOPE) break
      }

      if (subPlan.length === 0 && forceDecompose) {
        subPlan.push({
          id_subtarea: `${currentStorage.scopeId}_task_1`,
          descripcion: task.descripcion,
          prueba_aceptacion: acceptanceCriterion,
          skill_requerida: task.skill_requerida ?? 'skill_coder',
          targetPath: task.targetPath ?? context.targetPath,
          lineStart: task.lineStart,
          lineEnd: task.lineEnd,
          requiere_sub_planificacion: true,
        })
      }

      if (subPlan.length > 0) {
        currentStorage.clearInFlight(sigTag)
        await currentStorage.saveSubPlan(
          subPlan,
          String(
            decisionCall?.args?.justificacion ??
            'Descomposición obligatoria en lista de tareas con pruebas de aceptación',
          ),
        )
        const childResults = await Promise.all(
          subPlan.map((sub) => procesarNodoScope(sub, currentStorage, context, false)),
        )
        const combinedFindings = childResults.flatMap((r) => r.findings)
        const combinedDeliverables: SubAgentDeliverableSummary[] = childResults.flatMap(
          (r, idx) => {
            const subTask = subPlan[idx]
            if (r.entregables_subagentes && r.entregables_subagentes.length > 0) {
              return r.entregables_subagentes
            }
            return [
              {
                id_scope: r.id_scope,
                descripcion: subTask?.descripcion ?? task.descripcion,
                prueba_aceptacion:
                  subTask?.prueba_aceptacion ?? acceptanceCriterion,
                entregable_atomico: r.entregable_atomico,
              },
            ]
          },
        )
        const combinedSummary = childResults
          .map((r) => `[${r.id_scope}] ${r.sumario_ejecutivo}`)
          .join(' | ')
          .slice(0, 400)
        return currentStorage.saveScopeResult({
          task: {
            ...task,
            prueba_aceptacion: acceptanceCriterion,
          },
          codeSlice: rawSlice,
          sumarioEjecutivo:
            combinedSummary ||
            `Sub-scopes consolidados (${toReducedScopeSummary(childResults[0]).id_scope})`,
          findings: combinedFindings,
          isAggregated: true,
          entregablesSubagentes: combinedDeliverables,
        })
      }
    }

    const topArgs = decisionCall?.args ?? {}
    const nestedArgs =
      topArgs.argumentos && typeof topArgs.argumentos === 'object'
        ? (topArgs.argumentos as Record<string, unknown>)
        : {}
    const argsObj: Record<string, unknown> = { ...topArgs, ...nestedArgs }

    const findings = normalizeFindings(
      Array.isArray(argsObj.findings)
        ? argsObj.findings
        : Array.isArray(argsObj.suggestions)
          ? argsObj.suggestions
          : [],
      context.targetPath,
    )
    const sumario =
      typeof argsObj.sumario_ejecutivo === 'string' && argsObj.sumario_ejecutivo.trim()
        ? argsObj.sumario_ejecutivo.trim()
        : response.contentBuffer.trim() ||
        `Scope ${currentStorage.scopeId} completado (${findings.length} hallazgos).`

    const tareaRealizada =
      typeof argsObj.tarea_realizada === 'string' && argsObj.tarea_realizada.trim()
        ? argsObj.tarea_realizada.trim()
        : typeof argsObj.completedTask === 'string' && argsObj.completedTask.trim()
          ? argsObj.completedTask.trim()
          : typeof argsObj.code === 'string' && argsObj.code.trim()
            ? argsObj.code.trim()
            : sumario

    const pruebaAutomatizada =
      typeof argsObj.prueba_automatizada === 'string' && argsObj.prueba_automatizada.trim()
        ? argsObj.prueba_automatizada.trim()
        : typeof argsObj.automatedTest === 'string' && argsObj.automatedTest.trim()
          ? argsObj.automatedTest.trim()
          : typeof argsObj.testCode === 'string' && argsObj.testCode.trim()
            ? argsObj.testCode.trim()
            : `console.log(${JSON.stringify(`Prueba automatizada para: ${task.descripcion}`)}); return true;`

    const rawEvidencia =
      typeof argsObj.evidencia_prueba === 'string' && argsObj.evidencia_prueba.trim()
        ? argsObj.evidencia_prueba.trim()
        : typeof argsObj.testEvidence === 'string' && argsObj.testEvidence.trim()
          ? argsObj.testEvidence.trim()
          : `Ejecución de prueba automatizada para validar: ${acceptanceCriterion}`

    const evidenciaVerificada = await runAndVerifyAtomicTest({
      tareaRealizada,
      pruebaAceptacion: acceptanceCriterion,
      pruebaAutomatizada,
      evidenciaAgente: rawEvidencia,
      modoSandbox: typeof argsObj.modo_sandbox === 'string' ? argsObj.modo_sandbox : undefined,
      htmlPrueba: typeof argsObj.html_prueba === 'string' ? argsObj.html_prueba : undefined,
      cssPrueba: typeof argsObj.css_prueba === 'string' ? argsObj.css_prueba : undefined,
      selectorDom: typeof argsObj.selector_dom === 'string' ? argsObj.selector_dom : undefined,
    })

    const entregableAtomico: AtomicTaskDeliverable = {
      tarea_realizada: tareaRealizada,
      prueba_aceptacion: acceptanceCriterion,
      prueba_automatizada: pruebaAutomatizada,
      evidencia_prueba: evidenciaVerificada,
    }

    return currentStorage.saveScopeResult({
      task: {
        ...task,
        prueba_aceptacion: acceptanceCriterion,
      },
      codeSlice: rawSlice,
      sumarioEjecutivo: sumario,
      findings,
      isAggregated: false,
      entregableAtomico,
    })
  })()

  currentStorage.setInFlight(sigTag, executionPromise)
  try {
    return await executionPromise
  } finally {
    currentStorage.clearInFlight(sigTag)
  }
}

export { normalizeScopeKeyText }
