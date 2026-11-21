import { trace } from '../../../diagnostics'
import { streamChatCompletion, type ChatMessage } from '../../../llm/llm-client'
import {
  detectStaticErrorSignals,
  KNOWN_CLI_ERROR_PATTERNS,
} from '../../../mcp/mcp-client'

export { detectStaticErrorSignals, KNOWN_CLI_ERROR_PATTERNS }

export interface LldExecutionValidationResult {
  isValid: boolean
  reason: string
  detectedErrors?: string[]
  suggestedRemedy?: string
  validatedBy: 'lld_llm' | 'deterministic_rules' | 'custom_validator'
}

export interface ValidateExecutionParams {
  command: string
  output: string
  exitCode?: number
  expectedPurpose?: string
  sessionId?: string
  customValidator?: (params: {
    command: string
    output: string
    exitCode: number
  }) => Promise<LldExecutionValidationResult | null>
  signal?: AbortSignal
}

/**
 * Valida de forma rigurosa la salida de ejecución de Tether mediante el LLD (Low-Level Designer / LLM).
 *
 * El hecho de que Tether haya ejecutado el comando y devuelto un resultado NO implica que la validación
 * sea correcta. El LLD evalúa:
 * "Respecto a la ejecución para validar XXX, esta es la salida obtenida YYYYY, ¿encaja con el resultado esperado?"
 */
export async function validateExecutionWithLld(
  params: ValidateExecutionParams,
): Promise<LldExecutionValidationResult> {
  const { command, output, exitCode = 0, expectedPurpose, sessionId, customValidator, signal } = params

  // 1. Si existe un validador inyectado (p. ej. en pruebas unitarias)
  if (customValidator) {
    try {
      const customRes = await customValidator({ command, output, exitCode })
      if (customRes) return customRes
    } catch (err) {
      trace('lld.validator.custom_error', { error: String(err) })
    }
  }

  // 2. Detección estática inicial de señales de error
  const staticSignals = detectStaticErrorSignals(output, exitCode)

  // 3. Consulta semántica al LLD mediante streamChatCompletion
  const purposeText = expectedPurpose ? ` (${expectedPurpose})` : ''
  const systemPrompt = `Eres el Diseñador Técnico de Bajo Nivel (LLD) y Auditor de Calidad de LocalLoop.
Tu tarea es validar si la salida de la ejecución de comandos por Tether u otras herramientas encaja con el resultado esperado de la verificación.
Ten presente que el hecho de que la herramienta Tether haya ejecutado el comando y devuelto una salida NO implica que la validación sea correcta.
Debes detectar si la salida contiene errores de compilación, imports no resueltos, dependencias ausentes, scripts inexistentes, comandos no reconocidos, tests fallidos o advertencias bloqueantes.

Responde ÚNICAMENTE con un objeto JSON válido con la siguiente estructura:
{
  "isValid": true | false,
  "reason": "Explicación concisa de por qué encaja o qué error apunta",
  "detectedErrors": ["lista de errores detectados si los hubiera"],
  "suggestedRemedy": "sugerencia de corrección para el LLD si isValid es false"
}`

  const userPrompt = `Respecto a la ejecución para validar "${command}"${purposeText}, esta es la salida obtenida:
\`\`\`
${output.trim() ? output.slice(0, 4000) : '(Salida vacía)'}
\`\`\`

Código de retorno reportado por el proceso: ${exitCode}

¿Encaja con el resultado esperado?
Evalúa críticamente si la salida anterior representa una validación 100% exitosa o si la salida apunta realmente a un error, fallo de compilación, script faltante, dependencia no encontrada, fallo de pruebas, advertencia bloqueante o comando no reconocido.`

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  try {
    trace('lld.execution_validation.start', {
      command,
      exitCode,
      staticErrorsCount: staticSignals.detectedErrors.length,
    })

    const llmRes = await streamChatCompletion({
      scopeId: `lld_val_${sessionId || 'adhoc'}_${Date.now().toString(36)}`,
      messages,
      tools: [],
      requestTimeoutMs: 25000,
      signal,
    })

    const content = llmRes.contentBuffer.trim()
    let parsedJson: {
      isValid?: boolean
      reason?: string
      detectedErrors?: string[]
      suggestedRemedy?: string
    } | null = null

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/)
      if (jsonMatch) {
        parsedJson = JSON.parse(jsonMatch[0])
      }
    } catch {
      // No devolvió JSON válido
    }

    if (parsedJson && typeof parsedJson.isValid === 'boolean') {
      const isValid = parsedJson.isValid && !staticSignals.hasErrors
      const allErrors = [
        ...(parsedJson.detectedErrors || []),
        ...staticSignals.detectedErrors,
      ]

      trace('lld.execution_validation.complete', {
        command,
        isValid,
        reason: parsedJson.reason,
        validatedBy: 'lld_llm',
      })

      return {
        isValid,
        reason: parsedJson.reason || (isValid ? 'La ejecución encaja con el resultado esperado.' : 'La salida apunta a un error de ejecución.'),
        detectedErrors: allErrors.length > 0 ? Array.from(new Set(allErrors)) : undefined,
        suggestedRemedy: parsedJson.suggestedRemedy,
        validatedBy: 'lld_llm',
      }
    }
  } catch (err) {
    trace('lld.execution_validation.fallback', {
      command,
      error: String(err),
      staticHasErrors: staticSignals.hasErrors,
    })
  }

  // Fallback si el LLM no está disponible o no devolvió JSON:
  // Decisión basada en las señales de error estáticas detectadas
  const isValid = !staticSignals.hasErrors
  const reason = isValid
    ? 'La ejecución completó sin señales estáticas de error ni código de salida adverso.'
    : `La salida apunta a un error de ejecución: ${staticSignals.detectedErrors.join(' | ')}`

  return {
    isValid,
    reason,
    detectedErrors: staticSignals.hasErrors ? staticSignals.detectedErrors : undefined,
    validatedBy: 'deterministic_rules',
  }
}
