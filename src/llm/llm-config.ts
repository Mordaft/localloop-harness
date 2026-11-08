import { FsWriteMode, type FsWriteMode as FsWriteModeType } from '../enums'

export interface LlmConfig {
  baseUrl: string
  model: string
  temperature: number
  maxTokens: number
  maxTurns: number
  maxTokenBudget: number
  maxDepth: number
  maxConcurrency: number
  fsWriteMode: FsWriteModeType
  systemPrompt: string
  renderThinking: boolean
}

const STORAGE_KEY = 'localloop-llm-config'

export const defaultSystemPrompt = `Eres LocalLoop, un agente autónomo que se ejecuta localmente en un Web Worker sobre LangGraph.js con memoria episódica engram-ts y acceso al sistema de archivos del usuario.
Reglas operativas:
1. Antes de modificar código, explora el árbol de archivos (fs_list_dir) y lee los ficheros relevantes (fs_read_file) o busca en la memoria episódica (memory_search).
2. Descomposición inicial obligatoria por pruebas (TDD Agéntico): Al iniciar un trabajo es obligatorio crear una única vez una lista de tareas invocando plan_and_delegate_tasks (o delegate_subagent_scope). Una tarea es única y exclusivamente aquello para lo que podemos definir una prueba de aceptación (acceptanceTest / prueba_aceptacion). Al definir la lista de tareas y su prueba de aceptación para cada elemento, cada elemento se pasa a un sub-agente. Una vez recibidos los entregables de los sub-agentes, NO vuelvas a descomponer: consolida el resultado final o aplica los cambios en archivos.
3. Entrega de tarea atómica: Cuando un sub-agente realiza una tarea que no se puede descomponer en otras, tiene que entregar obligatoriamente: 1) la tarea realizada (tarea_realizada), 2) la prueba automatizada implementada (prueba_automatizada), y 3) una evidencia verificable de haber ejecutado la prueba (evidencia_prueba).
4. Pruebas en Navegador (Iframe Sandbox) y JS: Usa run_browser_sandbox para probar en el navegador mediante un sandbox en iframe (consultando el DOM resultante, los logs de consola/errores y obteniendo una captura del área renderizada) o run_sandboxed_js para lógica JS aislada.
5. Cuando necesites crear o modificar un archivo, invoca fs_write_file indicando el path y el contenido completo actualizado.`

export const defaultLlmConfig: LlmConfig = {
  baseUrl: 'http://localhost:11434/v1',
  model: 'llama3.2',
  temperature: 0.2,
  maxTokens: 8192,
  maxTurns: 12,
  maxTokenBudget: 64000,
  maxDepth: 3,
  maxConcurrency: 2,
  fsWriteMode: FsWriteMode.CONFIRM,
  systemPrompt: defaultSystemPrompt,
  renderThinking: false,
}

let workerConfigOverride: LlmConfig | undefined

export function setWorkerLlmConfig(config: LlmConfig): void {
  workerConfigOverride = { ...config }
}

export function getLlmConfig(): LlmConfig {
  if (workerConfigOverride) return { ...workerConfigOverride }
  if (typeof localStorage === 'undefined') return { ...defaultLlmConfig }
  const saved = localStorage.getItem(STORAGE_KEY)
  if (!saved) return { ...defaultLlmConfig }
  try {
    const parsed = { ...defaultLlmConfig, ...(JSON.parse(saved) as Partial<LlmConfig>) }
    if (!parsed.maxTokens || parsed.maxTokens < 256) parsed.maxTokens = defaultLlmConfig.maxTokens
    if (!Number.isInteger(parsed.maxTurns) || parsed.maxTurns < 1 || parsed.maxTurns > 50) {
      parsed.maxTurns = defaultLlmConfig.maxTurns
    }
    if (!Number.isInteger(parsed.maxTokenBudget) || parsed.maxTokenBudget < 1024) {
      parsed.maxTokenBudget = defaultLlmConfig.maxTokenBudget
    }
    if (!Number.isInteger(parsed.maxDepth) || parsed.maxDepth < 1 || parsed.maxDepth > 5) {
      parsed.maxDepth = defaultLlmConfig.maxDepth
    }
    if (!Number.isInteger(parsed.maxConcurrency) || parsed.maxConcurrency < 1 || parsed.maxConcurrency > 6) {
      parsed.maxConcurrency = defaultLlmConfig.maxConcurrency
    }
    if (parsed.fsWriteMode !== FsWriteMode.AUTO && parsed.fsWriteMode !== FsWriteMode.CONFIRM) {
      parsed.fsWriteMode = FsWriteMode.CONFIRM
    }
    if (typeof parsed.systemPrompt !== 'string' || !parsed.systemPrompt.trim()) {
      parsed.systemPrompt = defaultSystemPrompt
    }
    parsed.renderThinking = typeof parsed.renderThinking === 'boolean' ? parsed.renderThinking : false
    return parsed
  } catch {
    return { ...defaultLlmConfig }
  }
}

export function saveLlmConfig(config: LlmConfig): LlmConfig {
  const url = new URL(config.baseUrl)
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('La URL del runtime LLM debe usar HTTP o HTTPS.')
  }
  if (!config.model.trim()) {
    throw new Error('Debes indicar el nombre del modelo LLM/SLM.')
  }
  const normalized: LlmConfig = {
    baseUrl: url.toString().replace(/\/$/, ''),
    model: config.model.trim(),
    temperature: Number.isFinite(config.temperature) ? Math.max(0, Math.min(2, config.temperature)) : 0.2,
    maxTokens: Number.isInteger(config.maxTokens) ? Math.max(256, config.maxTokens) : 8192,
    maxTurns: Number.isInteger(config.maxTurns) ? Math.min(50, Math.max(1, config.maxTurns)) : 12,
    maxTokenBudget: Number.isInteger(config.maxTokenBudget)
      ? Math.max(1024, config.maxTokenBudget)
      : 64000,
    maxDepth: Number.isInteger(config.maxDepth) ? Math.min(5, Math.max(1, config.maxDepth)) : 3,
    maxConcurrency: Number.isInteger(config.maxConcurrency)
      ? Math.min(6, Math.max(1, config.maxConcurrency))
      : 2,
    fsWriteMode: config.fsWriteMode === FsWriteMode.AUTO ? FsWriteMode.AUTO : FsWriteMode.CONFIRM,
    systemPrompt: config.systemPrompt?.trim() ? config.systemPrompt.trim() : defaultSystemPrompt,
    renderThinking: Boolean(config.renderThinking),
  }
  workerConfigOverride = normalized
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  }
  return normalized
}

export async function testLlmConnection(config: Pick<LlmConfig, 'baseUrl'>): Promise<{
  data?: Array<{ id: string }>
}> {
  const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/models`)
  if (!response.ok) {
    throw new Error(`El runtime LLM respondió ${response.status}.`)
  }
  return response.json() as Promise<{ data?: Array<{ id: string }> }>
}
