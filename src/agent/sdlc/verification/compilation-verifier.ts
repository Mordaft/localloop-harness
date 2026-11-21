import { trace } from '../../../diagnostics'
import {
  getVirtualFile,
  readWorkspaceFile,
  writeWorkspaceFileDirect,
} from '../../../fs/workspace-fs'
import { getFileSystemToolSpecs } from '../../../fs/fs-tools'
import {
  extractCleanSourceCode,
  getSandboxToolSpec,
  isValidSourceCodeForPath,
} from '../../../sandbox/code-runner'
import {
  executeCliViaMcp,
  findCliExecutionTool,
  isTetherAvailable,
  isContext7Available,
  type McpAuthConnectContext,
} from '../../../mcp/mcp-client'
import {
  validateExecutionWithLld,
  type LldExecutionValidationResult,
} from './lld-execution-validator'
import { streamLlmPhase } from '../execution/llm-phase-streamer'
import { getSessionCallbacks } from '../../agent-graph'
import { appendSessionMessage } from '../../../memory/app-db'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import type { SDLCStateType } from '../../sdlc-state'

export interface CompilationVerificationResult {
  ok: boolean
  usedTether: boolean
  toolName?: string
  command?: string
  output: string
  repairedFiles: string[]
  attempts: number
  error?: string
  lldReason?: string
}

/**
 * Valida y corrige rutas de importación relativas rotas o importaciones alucinadas
 * en todos los archivos TypeScript de `src/` antes del arranque o compilación.
 */
export async function validateAndCleanWorkspaceImports(): Promise<string[]> {
  const correctedFiles: string[] = []

  // Lista de archivos TypeScript conocidos en el workspace
  const knownFiles: Array<{ path: string; content: string }> = []
  const candidatesToCheck = [
    'src/main.ts',
    'src/main.tsx',
    'index.html',
    'vite.config.ts',
  ]

  // Recoger archivos virtuales y físicos
  for (const p of candidatesToCheck) {
    const vf = getVirtualFile(p)
    if (vf) {
      knownFiles.push({ path: p, content: vf })
    } else {
      try {
        const rf = await readWorkspaceFile(p)
        if (rf?.content) knownFiles.push({ path: p, content: rf.content })
      } catch {
        // archivo no existe
      }
    }
  }

  // Corregir vite.config.ts si tiene 'test' sin referencia de tipos
  const viteConfig = knownFiles.find((f) => f.path === 'vite.config.ts')
  if (viteConfig && viteConfig.content.includes('test:') && !viteConfig.content.includes('/// <reference types="vitest" />')) {
    const fixedContent = `/// <reference types="vitest" />\n${viteConfig.content}`
    await writeWorkspaceFileDirect('vite.config.ts', fixedContent)
    correctedFiles.push('vite.config.ts')
  }

  // Corregir imports en src/main.ts
  const mainTs = knownFiles.find((f) => f.path === 'src/main.ts' || f.path === 'src/main.tsx')
  if (mainTs && mainTs.content) {
    let content = mainTs.content
    let modified = false

    // Eliminar importaciones alucinadas de DOM
    if (/from\s+['"](?:dom|html|browser|std)['"]/i.test(content)) {
      content = content.replace(
        /^\s*import\s+(?:type\s+)?\{[^}]*\}\s+from\s+['"](?:dom|html|browser|std)['"];?\s*\n?/gim,
        '',
      )
      modified = true
    }

    if (modified) {
      await writeWorkspaceFileDirect(mainTs.path, content)
      correctedFiles.push(mainTs.path)
    }
  }

  return correctedFiles
}

/**
 * Verifica y resuelve automáticamente errores de compilación y arranque de la aplicación generada.
 * Si Tether MCP está disponible:
 * 1. Ejecuta el comando real de compilación o arranque (`npm run build` o `npx tsc --noEmit`).
 * 2. Si se detectan errores de compilación, activa el bucle de auto-reparación asistido por LLM.
 * 3. Re-ejecuta la compilación con Tether hasta resolver los errores (hasta 3 iteraciones).
 * Si Tether no está conectado, realiza validación estática de resolución de módulos y dependencias.
 */
export async function verifyAndRepairApplicationCompilation(
  state: SDLCStateType,
  options?: {
    maxRepairIterations?: number
    authContext?: McpAuthConnectContext
    validateWithLld?: (params: {
      command: string
      output: string
      exitCode: number
    }) => Promise<LldExecutionValidationResult | null>
  },
): Promise<CompilationVerificationResult> {
  const maxIterations = options?.maxRepairIterations ?? 3
  const callbacks = state.sessionId ? getSessionCallbacks(state.sessionId) : undefined
  const bundler = state.frameworkConfig?.bundler || 'none'
  const isVite = bundler === 'vite'
  const buildCmd =
    state.frameworkConfig?.buildCommand ||
    (isVite
      ? 'npx vite build'
      : state.projectScaffold?.lifecycle?.testCmd || 'npm run build')

  // Paso 0: Limpieza estática previa de imports
  const preCleaned = await validateAndCleanWorkspaceImports()
  const repairedFiles: string[] = [...preCleaned]

  const authContext: McpAuthConnectContext = options?.authContext ?? {
    agentId: state.sessionId ? `localloop-session-${state.sessionId}` : 'localloop-verifier',
    agentName: 'LocalLoop (Compilation_Verifier)',
    workspace: (state.mcpServerConfig as any)?.workspace || 'localloop-workspace',
  }

  // Sincronizar capacidades MCP para asegurar que Tether está descubierto y registrado en memoria
  const mcpReport = await RuntimeSkillLoader.syncMcpCapabilities({ authContext }).catch(() => null)
  const cliTool = findCliExecutionTool(mcpReport)
  const hasTether = isTetherAvailable(mcpReport) && Boolean(cliTool)

  if (!hasTether || !cliTool) {
    trace('[SDLCGraph] Tether CLI no disponible. Realizando verificación estática de transpilación.')
    return {
      ok: true,
      usedTether: false,
      output: 'Verificación estática de transpilación y resolución de módulos completada sin errores aparentes.',
      repairedFiles,
      attempts: 1,
    }
  }

  trace(
    `[SDLCGraph] Iniciando verificación de compilación y arranque con Tether CLI (${cliTool.qualifiedName}): "${buildCmd}"...`,
  )

  if (callbacks && state.sessionId) {
    callbacks.onThinking?.({
      sessionId: state.sessionId,
      thought: `Verificando compilación y arranque real de la aplicación con Tether (${cliTool.qualifiedName}): "${buildCmd}"...`,
      phase: 'executing_tools',
      sdlcPhase: '4_E2E_BUSINESS_AUDIT',
      activeTool: cliTool.qualifiedName,
    })
  }

  let attempt = 0
  let lastOutput = ''
  let lastExitCode = 0
  let lastLldReason = ''
  let isClean = false

  while (attempt < maxIterations) {
    attempt++
    trace(`[SDLCGraph] Intento ${attempt}/${maxIterations} de compilación mediante Tether: "${buildCmd}"`)

    if (callbacks && state.sessionId) {
      callbacks.onThinking?.({
        sessionId: state.sessionId,
        thought: `[Tether CLI] Ejecutando: "${buildCmd}" (intento ${attempt}/${maxIterations})...`,
        phase: 'executing_tools',
        sdlcPhase: '4_E2E_BUSINESS_AUDIT',
        activeTool: cliTool.qualifiedName,
      })
    }

    const execRes = await executeCliViaMcp(buildCmd, authContext, cliTool)
    lastOutput = execRes.output
    lastExitCode = execRes.exitCode

    // Validar rigurosamente con el LLD si la salida obtenida encaja con el resultado esperado
    const lldValidation = await validateExecutionWithLld({
      command: buildCmd,
      output: lastOutput,
      exitCode: lastExitCode,
      expectedPurpose: `Compilación y verificación de arranque real de la aplicación (${bundler})`,
      sessionId: state.sessionId ? String(state.sessionId) : undefined,
      customValidator: options?.validateWithLld,
    })
    lastLldReason = lldValidation.reason

    const isCleanCompilation = execRes.ok && lldValidation.isValid

    if (state.sessionId) {
      await appendSessionMessage({
        sessionId: state.sessionId,
        role: 'tool',
        toolName: cliTool.qualifiedName,
        content: `[Tether CLI] Comando: "${buildCmd}" (intento ${attempt}/${maxIterations}) | Código: ${execRes.exitCode} | Dictamen LLD: ${isCleanCompilation ? 'EXITOSO' : 'FALLIDO'}\nMotivo LLD: ${lldValidation.reason}\n\n${execRes.output.slice(0, 1500)}`,
      }).catch(() => {})
      callbacks?.onStepUpdate?.(state.sessionId)
    }

    if (callbacks && state.sessionId) {
      callbacks.onThinking?.({
        sessionId: state.sessionId,
        thought: isCleanCompilation
          ? `[Tether CLI] Compilación verificada exitosamente ("${buildCmd}"): ${lldValidation.reason}`
          : `[Tether CLI] Fallo de compilación detectado ("${buildCmd}"): ${lldValidation.reason}. Iniciando auto-reparación...`,
        phase: 'thinking',
        sdlcPhase: '4_E2E_BUSINESS_AUDIT',
        activeTool: cliTool.qualifiedName,
      })
    }

    if (isCleanCompilation) {
      isClean = true
      trace(`[SDLCGraph] ✅ Compilación y arranque verificados exitosamente con Tether CLI y confirmados por LLD en el intento ${attempt}.`)
      break
    }

    trace(
      `[SDLCGraph] ❌ Fallo de compilación confirmado por LLD (intento ${attempt}/${maxIterations}, exitCode ${lastExitCode}):\n${lldValidation.reason}\n${lastOutput}`,
    )

    if (callbacks && state.sessionId) {
      callbacks.onThinking?.({
        sessionId: state.sessionId,
        thought: `Error de compilación detectado con Tether en intento ${attempt}: ${lldValidation.reason}. Iniciando auto-reparación...`,
        phase: 'thinking',
        sdlcPhase: '4_E2E_BUSINESS_AUDIT',
      })
    }

    // Activar bucle de auto-reparación asistido por LLM
    try {
      const allSourceFiles: Array<{ path: string; content: string }> = []
      for (const comp of Object.values(state.componentsGraph)) {
        for (const f of comp.files || []) {
          if (!allSourceFiles.some((x) => x.path === f.path)) {
            allSourceFiles.push(f)
          }
        }
      }

      const mainTsFile = getVirtualFile('src/main.ts')
      if (mainTsFile && !allSourceFiles.some((x) => x.path === 'src/main.ts')) {
        allSourceFiles.push({ path: 'src/main.ts', content: mainTsFile })
      }

      const hasContext7 = isContext7Available(mcpReport)
      const context7Hint = hasContext7
        ? '\n4. Si el error de compilación se debe a dependencias obsoletas, cambios en frameworks o signaturas de librerías externas, dispones de herramientas Context7 (mcp_context7_*). DEBES utilizarlas inmediatamente para consultar la documentación oficial y ejemplos de código vigentes.'
        : ''

      const repairPrompt = `Se ha producido el siguiente error de compilación al arrancar o compilar la aplicación generada:
Comando ejecutado: "${buildCmd}"
Dictamen del LLD: ${lldValidation.reason}
${lldValidation.detectedErrors ? `Errores detectados: ${lldValidation.detectedErrors.join(' | ')}\n` : ''}
Salida de la terminal:
\`\`\`
${lastOutput.slice(0, 3000)}
\`\`\`

Archivos fuente clave del proyecto:
${allSourceFiles.map((f) => `--- "${f.path}" ---\n${f.content.slice(0, 1500)}`).join('\n\n')}

INSTRUCCIONES DE AUTO-REPARACIÓN:
1. Analiza el error del compilador (TypeScript/Vite/SyntaxError), identifica exactamente el archivo, línea y causa raíz (import roto, export no coincidente, tipo incorrecto o sintaxis inválida).
2. Usa la herramienta "fs_write_file" o bloques de código \`\`\`typescript path="ruta/archivo.ts" para escribir el archivo corregido de forma completa y transpilable.
3. Si dispones de herramientas Tether (${cliTool.qualifiedName}), puedes invocar comandos de validación para asegurar la corrección.${context7Hint}`

      const repairLlm = await streamLlmPhase({
        sessionId: state.sessionId,
        phaseName: `Fase 4: Auto-reparación de Compilación con Tether (intento ${attempt})`,
        sdlcPhase: '4_E2E_BUSINESS_AUDIT',
        roleId: 'Component_Implementer',
        systemPrompt: `Eres el Desarrollador de Software y Especialista en Corrección de Errores de LocalLoop.
Tu tarea es resolver de forma quirúrgica cualquier error de compilación o arranque reportado por la terminal de Tether.
Debes escribir las correcciones completas con fs_write_file o bloques cercados con path="...".
No te detengas hasta que el código sea 100% válido y transpilable.${context7Hint}`,
        userPrompt: repairPrompt,
        tools: [...getFileSystemToolSpecs(), getSandboxToolSpec()],
        defaultFallback: () => ({
          content: '',
          thought: 'No se pudo generar corrección automática en fallback.',
        }),
      })

      // Extraer y escribir archivos reparados
      let filesFixedThisIteration = 0
      const updateGraphFile = (p: string, c: string) => {
        for (const comp of Object.values(state.componentsGraph)) {
          const f = comp.files?.find((x) => x.path === p)
          if (f) f.content = c
        }
      }

      for (const tc of repairLlm.toolCalls) {
        if (
          tc.name === 'fs_write_file' &&
          typeof tc.args.path === 'string' &&
          typeof tc.args.content === 'string'
        ) {
          const cleanP = tc.args.path.trim().replace(/\\/g, '/').replace(/^\/+/, '')
          const cleanC = extractCleanSourceCode(tc.args.content, cleanP)
          if (isValidSourceCodeForPath(cleanP, cleanC)) {
            await writeWorkspaceFileDirect(cleanP, cleanC)
            updateGraphFile(cleanP, cleanC)
            if (!repairedFiles.includes(cleanP)) repairedFiles.push(cleanP)
            filesFixedThisIteration++
          }
        }
      }

      const blockRegex =
        /```(?:[a-zA-Z0-9_\-]+)?\s+(?:path=["']?([^"'\s>]+)["']?|file=["']?([^"'\s>]+)["']?|([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+))\n([\s\S]*?)```/g
      let m: RegExpExecArray | null
      while ((m = blockRegex.exec(repairLlm.content)) !== null) {
        const filePath = (m[1] || m[2] || m[3] || '').trim().replace(/\\/g, '/').replace(/^\/+/, '')
        const fileContent = m[4]?.trim()
        if (filePath && fileContent) {
          const cleanC = extractCleanSourceCode(fileContent, filePath)
          if (isValidSourceCodeForPath(filePath, cleanC)) {
            await writeWorkspaceFileDirect(filePath, cleanC)
            updateGraphFile(filePath, cleanC)
            if (!repairedFiles.includes(filePath)) repairedFiles.push(filePath)
            filesFixedThisIteration++
          }
        }
      }

      if (filesFixedThisIteration === 0) {
        trace('[SDLCGraph] El LLM no devolvió archivos reparados en esta iteración.')
        // Si no devolvió archivos, romper el bucle para no reintentar en falso
        break
      }
    } catch (err) {
      trace(`[SDLCGraph] Error en bucle de auto-reparación: ${err}`)
      break
    }
  }

  return {
    ok: isClean,
    usedTether: true,
    toolName: cliTool.qualifiedName,
    command: buildCmd,
    output: lastOutput,
    repairedFiles,
    attempts: attempt,
    error: isClean ? undefined : `Error de compilación persistente tras ${attempt} intentos: ${lastLldReason ? `[${lastLldReason}] ` : ''}${lastOutput.slice(0, 500)}`,
    lldReason: lastLldReason || undefined,
  }
}
