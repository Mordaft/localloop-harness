import { getLlmConfig } from './llm-config'
import { trace } from '../diagnostics'
import {
  AgentScopeStorage,
  computeScopeSignature,
  normalizeScopeKeyText,
  toReducedScopeSummary,
  type AgentSkillName,
  type ScopeExecutionResult,
  type ScopeFinding,
  type ScopeTaskDefinition,
} from '../memory/engram-memory'

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
    : () => {}

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

export function buildStep1ScopeTools(allowDecompose: boolean, hasMemoryHeaders: boolean): OpenAiToolSpec[] {
  const tools: OpenAiToolSpec[] = [
    {
      type: 'function',
      function: {
        name: 'ejecutar_tarea_atomica',
        description:
          'Úsala si la subtarea asignada a este Scope se puede resolver directamente en este paso sin subdividir en más sub-hilos.',
        parameters: {
          type: 'object',
          properties: {
            skill_a_usar: {
              type: 'string',
              enum: ['skill_architect', 'skill_coder', 'skill_security', 'skill_general'],
            },
            argumentos: {
              type: 'object',
              properties: {
                foco: { type: 'string' },
                sumario_ejecutivo: { type: 'string' },
                findings: { type: 'array', items: findingItemSchema },
              },
              required: ['foco'],
            },
          },
          required: ['skill_a_usar', 'argumentos'],
        },
      },
    },
  ]

  if (allowDecompose) {
    tools.push({
      type: 'function',
      function: {
        name: 'descomponer_en_subtareas',
        description:
          'Úsala si la tarea es compleja y conviene delegar el trabajo en sub-scopes concurrentes más específicos respaldados por engram-ts.',
        parameters: {
          type: 'object',
          properties: {
            justificacion: { type: 'string' },
            subtareas: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  id_subtarea: { type: 'string' },
                  descripcion: { type: 'string' },
                  skill_requerida: {
                    type: 'string',
                    enum: ['skill_architect', 'skill_coder', 'skill_security', 'skill_general'],
                  },
                  lineStart: { type: 'integer', minimum: 1 },
                  lineEnd: { type: 'integer', minimum: 1 },
                },
                required: ['id_subtarea', 'descripcion'],
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
  onThinking?: (thought: string) => void | Promise<void>
  signal?: AbortSignal
}

/**
 * Homogeneous Fractal Sub-Agent Scope Loop reused from codereview-ai-assisted (`procesarNodoScope`).
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
    const relatedHeaders = await currentStorage.listRelatedScopeHeaders(task)
    const step1Tools = buildStep1ScopeTools(canDecompose, relatedHeaders.length > 0)

    const memoryCatalogText =
      relatedHeaders.length > 0
        ? `\nMEMORIAS EN ENGRAM-TS:\n${relatedHeaders
            .map((h) => `- id_scope: "${h.id}" | título: "${h.title}"`)
            .join('\n')}`
        : ''

    const response = await streamChatCompletion({
      scopeId: currentStorage.scopeId,
      messages: [
        {
          role: 'system',
          content: `Eres un sub-agente fractal dentro de LocalLoop con memoria engram-ts.\n${context.baseInstructions}`,
        },
        {
          role: 'user',
          content: `SCOPE: ${currentStorage.scopeId} (Profundidad ${currentStorage.depth}/${context.maxDepth})\nTAREA: ${task.descripcion}\nOBJETIVO: ${context.targetPath}${memoryCatalogText}\n\nCONTENIDO:\n${rawSlice.slice(0, 12000)}`,
        },
      ],
      tools: step1Tools,
      toolChoice: 'required',
      concurrencyGate: context.concurrencyGate,
      onThinking: context.onThinking,
      signal: context.signal,
    })

    const decisionCall = response.toolCalls[0]

    if (decisionCall?.name === 'reutilizar_scope_memoria') {
      const targetScopeRef = String(decisionCall.args.id_scope ?? '')
      const recovered = await currentStorage.getScopeResultByMemoryId(targetScopeRef)
      if (recovered) return recovered
    }

    if (decisionCall?.name === 'descomponer_en_subtareas' && canDecompose) {
      const rawSubtasks = Array.isArray(decisionCall.args.subtareas) ? decisionCall.args.subtareas : []
      const subPlan: ScopeTaskDefinition[] = []
      for (const [idx, item] of rawSubtasks.entries()) {
        if (!item || typeof item !== 'object') continue
        const rawItem = item as Record<string, unknown>
        const rawId =
          typeof rawItem.id_subtarea === 'string' && rawItem.id_subtarea.trim()
            ? rawItem.id_subtarea.trim()
            : `${currentStorage.scopeId}_sub_${idx + 1}`
        const safeId =
          rawId === currentStorage.scopeId || currentStorage.ancestorScopeIds.has(rawId)
            ? `${currentStorage.scopeId}_${rawId}_${idx + 1}`
            : rawId
        subPlan.push({
          id_subtarea: safeId,
          descripcion:
            typeof rawItem.descripcion === 'string' && rawItem.descripcion.trim()
              ? rawItem.descripcion.trim()
              : `${task.descripcion} #${idx + 1}`,
          skill_requerida: (rawItem.skill_requerida as AgentSkillName) ?? 'skill_general',
          lineStart: typeof rawItem.lineStart === 'number' ? rawItem.lineStart : task.lineStart,
          lineEnd: typeof rawItem.lineEnd === 'number' ? rawItem.lineEnd : task.lineEnd,
        })
        if (subPlan.length >= MAX_SUBTASKS_PER_SCOPE) break
      }

      if (subPlan.length > 0) {
        currentStorage.clearInFlight(sigTag)
        await currentStorage.saveSubPlan(subPlan, String(decisionCall.args.justificacion ?? ''))
        const childResults = await Promise.all(
          subPlan.map((sub) => procesarNodoScope(sub, currentStorage, context, false)),
        )
        const combinedFindings = childResults.flatMap((r) => r.findings)
        const combinedSummary = childResults
          .map((r) => `[${r.id_scope}] ${r.sumario_ejecutivo}`)
          .join(' | ')
          .slice(0, 400)
        return currentStorage.saveScopeResult({
          task,
          codeSlice: rawSlice,
          sumarioEjecutivo:
            combinedSummary ||
            `Sub-scopes consolidados (${toReducedScopeSummary(childResults[0]).id_scope})`,
          findings: combinedFindings,
          isAggregated: true,
        })
      }
    }

    const argsObj =
      decisionCall?.args.argumentos && typeof decisionCall.args.argumentos === 'object'
        ? (decisionCall.args.argumentos as Record<string, unknown>)
        : (decisionCall?.args ?? {})

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

    return currentStorage.saveScopeResult({
      task,
      codeSlice: rawSlice,
      sumarioEjecutivo: sumario,
      findings,
      isAggregated: false,
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
