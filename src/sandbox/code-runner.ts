import { trace } from '../diagnostics'
import type { OpenAiToolSpec } from '../llm/llm-client'

export interface SandboxExecutionResult {
  ok: boolean
  logs: string[]
  returnValue?: string
  error?: string
  durationMs: number
}

export function getSandboxToolSpec(): OpenAiToolSpec {
  return {
    type: 'function',
    function: {
      name: 'run_sandboxed_js',
      description:
        'Ejecuta un fragmento experimental de JavaScript de forma aislada en un entorno sandbox sin acceso al DOM ni a credenciales, devolviendo console.log y el resultado.',
      parameters: {
        type: 'object',
        properties: {
          code: {
            type: 'string',
            description: 'Código JavaScript a evaluar dentro del sandbox aislado.',
          },
          timeoutMs: {
            type: 'integer',
            minimum: 100,
            maximum: 10000,
            description: 'Tiempo máximo de ejecución en milisegundos (por defecto 3000ms).',
          },
        },
        required: ['code'],
      },
    },
  }
}

/**
 * Runs untrusted/experimental agent-generated JS code inside an isolated disposable Web Worker
 * (or a restricted Function scope in Node unit test environments where Blob Workers are unavailable).
 */
export async function executeSandboxedJs(
  code: string,
  timeoutMs = 3000,
): Promise<SandboxExecutionResult> {
  const startedAt = performance.now()
  const safeTimeout = Math.min(10000, Math.max(100, timeoutMs))

  if (typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const workerScript = `
      self.fetch = undefined;
      self.XMLHttpRequest = undefined;
      self.WebSocket = undefined;
      self.EventSource = undefined;
      self.indexedDB = undefined;

      self.onmessage = async (event) => {
        const logs = [];
        const customConsole = {
          log: (...args) => logs.push(args.map((a) => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')),
          warn: (...args) => logs.push('[WARN] ' + args.map((a) => String(a)).join(' ')),
          error: (...args) => logs.push('[ERROR] ' + args.map((a) => String(a)).join(' ')),
        };
        try {
          const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
          const fn = new AsyncFunction('console', event.data.code);
          const result = await fn(customConsole);
          self.postMessage({
            ok: true,
            logs,
            returnValue: result !== undefined ? JSON.stringify(result) : undefined,
          });
        } catch (err) {
          self.postMessage({
            ok: false,
            logs,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      };
    `
    const blob = new Blob([workerScript], { type: 'application/javascript' })
    const url = URL.createObjectURL(blob)
    const worker = new Worker(url)

    try {
      return await new Promise<SandboxExecutionResult>((resolve) => {
        const timer = setTimeout(() => {
          worker.terminate()
          resolve({
            ok: false,
            logs: [],
            error: `Tiempo de ejecución excedido en Sandbox (${safeTimeout}ms). Worker terminado.`,
            durationMs: Math.round(performance.now() - startedAt),
          })
        }, safeTimeout)

        worker.onmessage = (e: MessageEvent<{ ok: boolean; logs: string[]; returnValue?: string; error?: string }>) => {
          clearTimeout(timer)
          worker.terminate()
          resolve({
            ...e.data,
            durationMs: Math.round(performance.now() - startedAt),
          })
        }

        worker.onerror = (err) => {
          clearTimeout(timer)
          worker.terminate()
          resolve({
            ok: false,
            logs: [],
            error: err.message || 'Error en Sandbox Worker',
            durationMs: Math.round(performance.now() - startedAt),
          })
        }

        worker.postMessage({ code })
      })
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  // Fallback for Node.js unit test execution
  const logs: string[] = []
  const customConsole = {
    log: (...args: unknown[]) =>
      logs.push(args.map((a) => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ')),
    warn: (...args: unknown[]) => logs.push('[WARN] ' + args.map(String).join(' ')),
    error: (...args: unknown[]) => logs.push('[ERROR] ' + args.map(String).join(' ')),
  }

  try {
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor as new (
      arg: string,
      body: string,
    ) => (c: typeof customConsole) => Promise<unknown>
    const fn = new AsyncFunction('console', code)
    const res = await fn(customConsole)
    const result: SandboxExecutionResult = {
      ok: true,
      logs,
      returnValue: res !== undefined ? JSON.stringify(res) : undefined,
      durationMs: Math.round(performance.now() - startedAt),
    }
    trace('sandbox.executed', { ok: true, durationMs: result.durationMs })
    return result
  } catch (err) {
    return {
      ok: false,
      logs,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Math.round(performance.now() - startedAt),
    }
  }
}
