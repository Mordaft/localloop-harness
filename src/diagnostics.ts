export interface DiagnosticEvent {
  at: string
  event: string
  details?: Record<string, unknown>
}

export interface TraceEntry {
  step: string
  elapsedMs: number
  detail?: Record<string, unknown>
}

const storageKey = 'localloop-diagnostics'
const maxEvents = 150
const startEpoch = Date.now()
const inMemoryTraces: TraceEntry[] = []

function serializeValue(val: unknown): unknown {
  if (val instanceof Error) {
    return {
      name: val.name,
      message: val.message,
      stack: val.stack,
    }
  }
  return val
}

function safeDetails(details?: Record<string, unknown>) {
  if (!details) return undefined
  return Object.fromEntries(
    Object.entries(details)
      .filter(([key]) => !/token|authorization|apikey|api_key|^content$|^patch$|body/i.test(key))
      .map(([key, val]) => [key, serializeValue(val)]),
  )
}

export function trace(event: string, details?: Record<string, unknown>) {
  const cleaned = safeDetails(details)
  const entry: DiagnosticEvent = { at: new Date().toISOString(), event, details: cleaned }
  inMemoryTraces.push({
    step: event,
    elapsedMs: Date.now() - startEpoch,
    detail: cleaned,
  })
  if (inMemoryTraces.length > maxEvents) {
    inMemoryTraces.shift()
  }
  console.info(`[LocalLoop] ${entry.event}`, entry.details ?? '')
  try {
    if (typeof sessionStorage !== 'undefined') {
      const previous = JSON.parse(sessionStorage.getItem(storageKey) ?? '[]') as DiagnosticEvent[]
      sessionStorage.setItem(storageKey, JSON.stringify([...previous, entry].slice(-maxEvents)))
    }
  } catch {
    // Diagnostics must never interrupt the agent loop.
  }
}

export function getTraceEntries(): TraceEntry[] {
  return [...inMemoryTraces]
}

export function getDiagnostics() {
  try {
    if (typeof sessionStorage === 'undefined') return '[]'
    return sessionStorage.getItem(storageKey) ?? '[]'
  } catch {
    return '[]'
  }
}

export function clearDiagnostics() {
  inMemoryTraces.length = 0
  try {
    if (typeof sessionStorage !== 'undefined') {
      sessionStorage.removeItem(storageKey)
    }
  } catch {
    // Ignore
  }
}

export function installDiagnosticsGlobal(): void {
  if (typeof window !== 'undefined') {
    ;(window as unknown as Record<string, unknown>).__LOCALLOOP_DIAGNOSTICS__ = {
      getDiagnostics,
      getTraceEntries,
      clearDiagnostics,
    }
  }
}
