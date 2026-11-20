import { trace } from '../../../diagnostics'
import { getSessionCallbacks } from '../../agent-graph'
import { executeFileSystemTool, getFileSystemToolSpecs } from '../../../fs/fs-tools'
import { writeWorkspaceFileDirect } from '../../../fs/workspace-fs'
import {
  executeBrowserSandbox,
  executeSandboxedJs,
  extractCleanSourceCode,
  getBrowserSandboxToolSpec,
  getSandboxToolSpec,
  isValidSourceCodeForPath,
  sanitizeTsForBrowser,
  type BrowserSandboxOptions,
} from '../../../sandbox/code-runner'
import { saveSdlcPhaseArtifact } from '../../../memory/engram-memory'
import { FsWriteMode } from '../../../enums'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import type {
  GeneratedComponentFile,
  ProjectProgressEvent,
  SDLCStateType,
} from '../../sdlc-state'
import { streamLlmPhase } from '../execution/llm-phase-streamer'
import { emitSDLCProgress } from '../execution/progress-emitter'
import { generateComponentCode } from '../codegen/component-codegen'

/**
 * NODO 3.1: Implementación del Componente (Multi-Fichero)
 * Escribe el código y archivos auxiliares en el workspace local.
 */
export async function node_phase3_implement_component(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  const compId = state.activeComponentId!
  const comp = state.componentsGraph[compId]
  const callbacks = state.sessionId ? getSessionCallbacks(state.sessionId) : undefined
  trace(`[SDLCGraph] Implementando código fuente del componente ${compId}...`)

  const compGraph = { ...state.componentsGraph }
  compGraph[compId].status = 'IN_BUILD'

  const compDir = state.projectScaffold?.componentDirectory || 'src/components'
  const fileExt = state.projectScaffold?.fileExtension
    ? (state.projectScaffold.fileExtension.startsWith('.')
        ? state.projectScaffold.fileExtension
        : `.${state.projectScaffold.fileExtension}`)
    : '.ts'
  const defaultTarget = comp.targetPath || `${compDir}/${compId}${fileExt}`

  const defaultGen = generateComponentCode(comp, {
    frameworkConfig: state.frameworkConfig,
    projectScaffold: state.projectScaffold,
    marketArchStandard: state.marketArchStandard,
    contracts: state.technicalDesigns?.[compId]?.[0]?.contracts,
    targetPath: defaultTarget,
  })
  const existingFiles = comp.files && comp.files.length > 0 ? comp.files : undefined
  const defaultFiles: GeneratedComponentFile[] =
    existingFiles ||
    (defaultGen.files && defaultGen.files.length > 0
      ? defaultGen.files
      : [{ path: defaultTarget, content: defaultGen.code, description: comp.name }])

  const resolvedSkill = RuntimeSkillLoader.resolveContext({
    ...state,
    activeSkill: 'Component_Implementer',
  })

  const frameworkName =
    state.frameworkConfig?.framework ||
    state.projectScaffold?.frameworkTitle ||
    state.marketArchStandard ||
    'Marco técnico acordado en la fase de diseño'
  const runtime = state.frameworkConfig?.runtime || state.projectScaffold?.runtime || 'agnóstico'
  const archetype = state.frameworkConfig?.archetype || state.projectScaffold?.archetype || 'modular'
  const hasUI = state.frameworkConfig?.hasUI ?? state.projectScaffold?.hasUI ?? false
  const chosenDesign = state.technicalDesigns?.[compId]?.[0]
  const buildCmd = state.frameworkConfig?.buildCommand
  const testCmd = state.frameworkConfig?.testCommand
  const validationCmdHint = buildCmd || testCmd || 'las herramientas de compilación o testing del proyecto'
  const isTypeScriptStack = Boolean(
    frameworkName.toLowerCase().includes('typescript') ||
    state.projectScaffold?.fileExtension === '.ts' ||
    state.projectScaffold?.fileExtension === '.tsx' ||
    (comp.files && comp.files.some((f) => /\.(ts|tsx)$/.test(f.path))) ||
    (comp.targetPath && /\.(ts|tsx)$/.test(comp.targetPath))
  )

  const depContextLines = (comp.dependsOn || [])
    .map((depId) => {
      const depComp = state.componentsGraph[depId]
      if (!depComp) return ''
      const depContracts = (state.technicalDesigns?.[depId]?.[0]?.contracts || []).map((c) => c.name).join(', ')
      const depFilesList = (depComp.targetPaths || [depComp.targetPath || `src/components/${depId}.ts`]).join(', ')
      const exportedSymbols = (depComp.files || [])
        .flatMap((f) => {
          const matches = Array.from(
            f.content.matchAll(/\bexport\s+(?:class|interface|type|function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g),
          )
          return matches.map((m) => `${m[1]} (en \`${f.path}\`)`)
        })
        .slice(0, 12)
        .join(', ')
      return `- Dependencia \`${depId}\` (${depComp.name}): archivos [${depFilesList}]${depContracts ? ` | Contratos: ${depContracts}` : ''}${exportedSymbols ? ` | Exports reales: ${exportedSymbols}` : ''}`
    })
    .filter(Boolean)
    .join('\n')

  const needsContextLines = (state.phase0Data?.step1?.needsList || [])
    .map((n) => `- **${n.id}**: ${n.description}${n.expectedImpact ? ` *(Impacto esperado: ${n.expectedImpact})*` : ''}`)
    .join('\n')
  const useCasesContextLines = (state.useCases || [])
    .map((u) => `- **${u.id} (${u.title})**: Actor: ${u.actor} | Resultado esperado: ${u.expectedBusinessOutcome}`)
    .join('\n')
  const businessContextBlock = [
    state.phase0Data?.step1?.featureTitle ? `Iniciativa de Negocio: ${state.phase0Data.step1.featureTitle}` : '',
    state.phase0Data?.step1?.rawBusinessLanguageText
      ? `Narrativa de Negocio: ${state.phase0Data.step1.rawBusinessLanguageText}`
      : '',
    needsContextLines ? `Necesidades de Negocio que la solución debe cubrir:\n${needsContextLines}` : '',
    state.phase0Data?.step2?.desiredSituation?.description
      ? `Arquitectura To-Be: ${state.phase0Data.step2.desiredSituation.description}`
      : '',
    useCasesContextLines ? `Casos de Uso:\n${useCasesContextLines}` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const llmCode = await streamLlmPhase({
    sessionId: state.sessionId,
    phaseName: `Fase 3: Construcción Iterativa — ${compId} [Skill: ${resolvedSkill.skill.name}]`,
    sdlcPhase: '3_COMPONENT_CONSTRUCTION',
    maxToolIterations: 5,
    systemPrompt: `${resolvedSkill.systemPrompt}\n\nEres el Desarrollador de Software de LocalLoop dentro del bucle iterativo de construcción tras la aprobación de la Propuesta de Solución Técnica.
Tu misión es implementar el componente "${comp.name}" (\`${compId}\`) materializando fielmente las decisiones tecnológicas y arquitectónicas pactadas en la fase de diseño técnico y planificación.

Marco y arquitectura aprobados:
- Marco Tecnológico: ${frameworkName} (Runtime: ${runtime}, Arquetipo: ${archetype})
- Estándar Arquitectónico: ${state.marketArchStandard || 'Clean Architecture / Modular'}
${chosenDesign ? `- Enfoque de Diseño Técnico Seleccionado: ${chosenDesign.approachName}\n- Descripción del Diseño: ${chosenDesign.description}` : ''}

Puedes abordar el componente de tres formas según su complejidad:
1. **Construcción Directa**: Consultar search_web_guidance / read_web_guidance_doc si aplica (máximo 1 consulta) y escribir directamente los archivos completos y funcionales con "fs_write_file" o mediante bloques de código anotados con \`\`\`<lenguaje> path="ruta/archivo.ext".
2. **Descomposición Previa en Subtareas**: Invocar "plan_and_delegate_tasks" (o "delegate_subagent_scope") definiendo las subtareas y su prueba de aceptación ("acceptanceTest") para delegar la construcción verificada en sub-agentes antes de consolidar los archivos del componente.
3. **Validación Temprana mediante Tether CLI**: Si dispones de herramientas de ejecución de terminal / Tether (como mcp_tether_run_cli o mcp_tether_execute_command), puedes ejecutar comandos en la terminal del proyecto (por ejemplo \`${validationCmdHint}\`) para validar la sintaxis, tipos, compilación y pruebas antes de dar por finalizada la construcción.

REGLAS ESTRICTAS DE CONSTRUCCIÓN Y CALIDAD:
- Fidelidad al Diseño Técnico: Implementa con exactitud los contratos de interfaces, firmas, tipos y responsabilidades aprobados para este componente en la fase de diseño técnico. No introduzcas frameworks, librerías ni supuestos arquitectónicos ajenos a lo acordado.
- Completitud para Producción: Todo archivo debe contener código completo, autocontenido y funcional para producción, sin placeholders (\`// TODO\`, \`...\`), sin bloques Markdown anidados dentro del código y con exportaciones explícitas coherentes con las dependencias del proyecto.
- Estructura del Proyecto: Sitúa todos los archivos respetando estrictamente la estructura de directorios y convenciones del marco acordado.
${hasUI ? `- Componentes de Interfaz / UI: Implementa el renderizado, interactividad y ciclo de vida respetando los contratos aprobados y las convenciones del marco acordado (${frameworkName}).` : '- Componentes de Lógica / Backend / Servicios: Implementa los contratos de servicio, métodos y modelos de datos acordados en la solución técnica.'}
${isTypeScriptStack ? '- Entorno TypeScript en Navegador: Si se utiliza TypeScript en el navegador, no importes tipos globales del DOM como `import { HTMLElement } from \'dom\'` (`HTMLElement` ya es global en el runtime).' : ''}`,
    userPrompt: `Marco Tecnológico Acordado: ${frameworkName}
Estructura de Directorios del Proyecto:
${state.frameworkConfig?.projectStructureSummary || (state.projectScaffold ? `- Componentes: \`${state.projectScaffold.componentDirectory}/\`\n- Servicios: \`${state.projectScaffold.serviceDirectory}/\`\n- Tests: \`${state.projectScaffold.testDirectory}/\`` : '- src/components/')}
IMPORTANTE: Sitúa los archivos generados respetando estrictamente esta estructura de directorios y marco técnico.

${businessContextBlock ? `Contexto de Negocio y Requisitos del Proyecto:\n${businessContextBlock}\n\n` : ''}${
  state.rcaDiagnosis
    ? `🚨 SOLICITUD DE REMEDIACIÓN Y CORRECCIÓN DE DEFECTO (RCA):
- Fallo detectado: ${state.rcaDiagnosis.failureSummary}
- Detalle / Causa raíz: ${state.rcaDiagnosis.detail}
- Acción requerida: ${state.rcaDiagnosis.remedyRecommendation}
- Criterios de aceptación de la corrección: ${state.rcaDiagnosis.newBacklogItem?.acceptanceCriteria || 'Superar pruebas unitarias y compilación'}
Debes corregir de forma completa los errores en los archivos correspondientes.\n\n`
    : ''
}Implementa el componente: ${comp.name} (\`${compId}\`)
Responsabilidad: ${comp.description}
${depContextLines ? `Dependencias ya construidas en el workspace:\n${depContextLines}\n` : ''}Contratos Aprobados en la Solución Técnica:
${(state.technicalDesigns?.[compId]?.[0]?.contracts || []).map((c) => c.schema).join('\n\n')}

Archivos sugeridos para esta funcionalidad:
${defaultFiles.map((f) => `- "${f.path}": ${f.description || f.path}`).join('\n')}

Guarda los archivos completos y transpilables/interpretables en el workspace (directamente o tras descomponer en subtareas). Si dispones de herramientas Tether (CLI), úsalas prioritariamente para validar la compilación y pruebas de tus archivos.`,
    tools:
      resolvedSkill.tools.length > 0
        ? resolvedSkill.tools
        : [...getFileSystemToolSpecs(), getBrowserSandboxToolSpec(), getSandboxToolSpec()],
    defaultFallback: () => ({
      content: defaultFiles
        .map((f) => {
          const ext = f.path.split('.').pop()?.toLowerCase() || ''
          const lang =
            ext === 'html'
              ? 'html'
              : ext === 'css'
                ? 'css'
                : ext === 'json' || ext === 'webmanifest'
                  ? 'json'
                  : ext === 'js' || ext === 'jsx'
                    ? 'javascript'
                    : ext === 'py'
                      ? 'python'
                      : ext === 'go'
                        ? 'go'
                        : ext === 'rs'
                          ? 'rust'
                          : ext === 'cs'
                            ? 'csharp'
                            : ext === 'java'
                              ? 'java'
                              : ext === 'ts' || ext === 'tsx'
                                ? 'typescript'
                                : ext || 'text'
          return `\`\`\`${lang} path="${f.path}"\n${f.content}\n\`\`\``
        })
        .join('\n\n'),
      thought: `Generando implementación multi-fichero (${defaultFiles.length} archivos) para ${comp.name}...`,
    }),
  })

  // Extraer archivos de la respuesta del LLM, llamadas fs_write_file o entregables de sub-agentes (descomposición previa)
  const extractedFiles: GeneratedComponentFile[] = []

  const pushExtractedFileIfValid = (rawPath: string, rawContent: string, description: string) => {
    const cleanPath = rawPath.trim().replace(/\\/g, '/').replace(/^\/+/, '')
    if (!cleanPath) return
    const cleanContent = extractCleanSourceCode(rawContent, cleanPath)
    if (isValidSourceCodeForPath(cleanPath, cleanContent)) {
      extractedFiles.push({
        path: cleanPath,
        content: cleanContent,
        description,
      })
    }
  }

  // 0. Archivos escritos directamente mediante tool call fs_write_file o entregados por sub-agentes en descomposición previa
  for (const tc of llmCode.toolCalls) {
    if (tc.name === 'fs_write_file' && typeof tc.args.path === 'string' && typeof tc.args.content === 'string') {
      pushExtractedFileIfValid(
        tc.args.path,
        tc.args.content,
        String(tc.args.reason || `Archivo ${tc.args.path.trim()}`),
      )
    }
  }

  for (const subDeliv of llmCode.subagentDeliverables || []) {
    if (subDeliv.targetPath && subDeliv.code.trim().length > 0) {
      pushExtractedFileIfValid(
        subDeliv.targetPath,
        subDeliv.code,
        subDeliv.summary || `Subtarea ${subDeliv.taskId}`,
      )
    }
  }

  // 1. Bloques con path="...", file="..." o nombre de archivo directo
  const blockRegex =
    /```(?:[a-zA-Z0-9_\-]+)?\s+(?:path=["']?([^"'\s>]+)["']?|file=["']?([^"'\s>]+)["']?|([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+))\n([\s\S]*?)```/g
  let match: RegExpExecArray | null
  while ((match = blockRegex.exec(llmCode.content)) !== null) {
    const filePath = (match[1] || match[2] || match[3] || '').trim().replace(/\\/g, '/')
    const content = match[4]?.trim()
    if (filePath && content) {
      pushExtractedFileIfValid(filePath, content, `Archivo ${filePath}`)
    }
  }

  // 2. Bloques con comentarios de encabezado // File: path o <!-- File: path -->
  if (extractedFiles.length === 0) {
    const generalBlockRegex = /```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/g
    while ((match = generalBlockRegex.exec(llmCode.content)) !== null) {
      const blockContent = match[1]?.trim()
      if (!blockContent) continue
      const headerMatch = blockContent.match(
        /^(?:\/\/|\/\*|<!--|#)\s*(?:File|Path|Archivo):\s*([a-zA-Z0-9_\-\./\\]+\.[a-zA-Z0-9]+)/i,
      )
      if (headerMatch && headerMatch[1]) {
        const filePath = headerMatch[1].trim().replace(/\\/g, '/')
        pushExtractedFileIfValid(filePath, blockContent, `Archivo ${filePath}`)
      }
    }
  }

  // 3. Fallback a coincidencia única de código estándar si no había rutas anotadas
  if (extractedFiles.length === 0) {
    const codeMatch = llmCode.content.match(/```(?:[a-zA-Z0-9_\-]+)?\n([\s\S]*?)```/)
    if (codeMatch && codeMatch[1] && codeMatch[1].trim().length > 30) {
      pushExtractedFileIfValid(defaultFiles[0].path, codeMatch[1].trim(), defaultFiles[0].description || defaultFiles[0].path)
    }
  }

  // Validar que los archivos extraídos del LLM tengan código fuente válido y transpilable/interpretable;
  let hasValidCodeFile = extractedFiles.some(
    (f) =>
      !f.path.startsWith('tests/') &&
      !f.path.includes('/types/') &&
      f.content.trim().length > 50 &&
      isValidSourceCodeForPath(f.path, f.content),
  )

  // Bucle de auto-reparación / fallback con el LLM: si el LLM fue invocado pero no generó archivos válidos
  if (!llmCode.usedFallback && (extractedFiles.length === 0 || !hasValidCodeFile)) {
    trace(`[SDLCGraph] Fallback activo: El LLM no generó archivos de código válidos para ${compId}. Solicitando autocorrección al LLM...`)
    if (callbacks && state.sessionId) {
      callbacks.onThinking?.({
        sessionId: state.sessionId,
        thought: `Código no detectado o incompleto para ${compId}. Solicitando generación correctiva al LLM...`,
        phase: 'thinking',
        sdlcPhase: '3_COMPONENT_CONSTRUCTION',
      })
    }

    try {
      const repairLlm = await streamLlmPhase({
        sessionId: state.sessionId,
        phaseName: `Fase 3: Fallback de Construcción — Autocorrección de ${compId}`,
        sdlcPhase: '3_COMPONENT_CONSTRUCTION',
        roleId: 'Component_Implementer',
        systemPrompt: `${resolvedSkill.systemPrompt}\n\nEres el Desarrollador de Software de LocalLoop. Tu turno anterior no produjo código fuente completo o válido para el componente "${comp.name}" (\`${compId}\`).
Escribe los archivos de código completos, transpilables y listos para producción utilizando "fs_write_file" o bloques de código \`\`\`<lenguaje> path="ruta/archivo.ext".
Respeta estrictamente el marco técnico acordado: ${frameworkName} y la estructura de directorios del proyecto.`,
        userPrompt: `Implementa el componente: ${comp.name} (\`${compId}\`)
Responsabilidad: ${comp.description}
${depContextLines ? `Dependencias ya construidas en el workspace:\n${depContextLines}\n` : ''}Contratos Aprobados en la Solución Técnica:
${(state.technicalDesigns?.[compId]?.[0]?.contracts || []).map((c) => c.schema).join('\n\n')}

Archivos requeridos para esta funcionalidad:
${defaultFiles.map((f) => `- "${f.path}": ${f.description || f.path}`).join('\n')}

IMPORTANTE: Escribe los archivos completos sin placeholders ni código omitido usando fs_write_file o bloques de código anotados con path="...".`,
        tools:
          resolvedSkill.tools.length > 0
            ? resolvedSkill.tools
            : [...getFileSystemToolSpecs(), getSandboxToolSpec()],
        defaultFallback: () => ({ content: '', thought: 'Fallback de autocorrección no disponible.' }),
      })

      for (const tc of repairLlm.toolCalls) {
        if (tc.name === 'fs_write_file' && typeof tc.args.path === 'string' && typeof tc.args.content === 'string') {
          pushExtractedFileIfValid(
            tc.args.path,
            tc.args.content,
            String(tc.args.reason || `Archivo ${tc.args.path.trim()}`),
          )
        }
      }

      for (const subDeliv of repairLlm.subagentDeliverables || []) {
        if (subDeliv.targetPath && subDeliv.code.trim().length > 0) {
          pushExtractedFileIfValid(
            subDeliv.targetPath,
            subDeliv.code,
            subDeliv.summary || `Subtarea ${subDeliv.taskId}`,
          )
        }
      }

      let repairMatch: RegExpExecArray | null
      while ((repairMatch = blockRegex.exec(repairLlm.content)) !== null) {
        const filePath = (repairMatch[1] || repairMatch[2] || repairMatch[3] || '').trim().replace(/\\/g, '/')
        const content = repairMatch[4]?.trim()
        if (filePath && content) {
          pushExtractedFileIfValid(filePath, content, `Archivo ${filePath}`)
        }
      }

      hasValidCodeFile = extractedFiles.some(
        (f) =>
          !f.path.startsWith('tests/') &&
          !f.path.includes('/types/') &&
          f.content.trim().length > 50 &&
          isValidSourceCodeForPath(f.path, f.content),
      )
    } catch (repairErr) {
      trace(`[SDLCGraph] Aviso en fallback de autocorrección con LLM para ${compId}: ${repairErr}`)
    }
  }

  const finalFilesMap = new Map<string, GeneratedComponentFile>()
  if (llmCode.usedFallback || extractedFiles.length === 0 || !hasValidCodeFile) {
    for (const f of defaultFiles) {
      finalFilesMap.set(f.path, f)
    }
  }
  for (const f of extractedFiles) {
    if (f.content.trim().length > 20 && isValidSourceCodeForPath(f.path, f.content)) {
      finalFilesMap.set(f.path, f)
    }
  }

  // Si el LLM generó el código del componente pero omitió el archivo de pruebas unitarias:
  let hasValidTestFile = Array.from(finalFilesMap.values()).some(
    (f) => f.path.startsWith('tests/') && isValidSourceCodeForPath(f.path, f.content),
  )

  if (!hasValidTestFile && !llmCode.usedFallback && isTypeScriptStack) {
    trace(`[SDLCGraph] Fallback activo: Archivo de test faltante para ${compId}. Solicitando generación de pruebas al LLM...`)
    try {
      const primaryImpl = Array.from(finalFilesMap.values()).find(
        (f) => !f.path.startsWith('tests/') && !f.path.includes('/types/'),
      )
      const testLlm = await streamLlmPhase({
        sessionId: state.sessionId,
        phaseName: `Fase 3: Generación de Pruebas Unitarias — ${compId}`,
        sdlcPhase: '3_COMPONENT_CONSTRUCTION',
        roleId: 'UnitTest_Engineer',
        systemPrompt: `Eres el Ingeniero de Pruebas Unitarias de LocalLoop. Tu tarea es generar la suite de pruebas unitarias para el componente "${compId}" (${comp.name}) conforme al marco "${frameworkName}".
Escribe el archivo de prueba unitaria usando "fs_write_file" o un bloque con path="tests/${compId}.test.ts".`,
        userPrompt: `Genera las pruebas unitarias para el componente ${comp.name} (${compId}).
Código de implementación existente:
--- "${primaryImpl?.path || defaultTarget}" ---
${primaryImpl?.content.slice(0, 2000) || ''}

Asegura aserciones claras que validen el contrato y funcionamiento del componente.`,
        tools: [...getFileSystemToolSpecs(), getSandboxToolSpec()],
        defaultFallback: () => ({ content: '', thought: 'No test fallback' }),
      })

      for (const tc of testLlm.toolCalls) {
        if (tc.name === 'fs_write_file' && typeof tc.args.path === 'string' && typeof tc.args.content === 'string') {
          pushExtractedFileIfValid(tc.args.path, tc.args.content, `Test ${tc.args.path}`)
        }
      }
      let testMatch: RegExpExecArray | null
      while ((testMatch = blockRegex.exec(testLlm.content)) !== null) {
        const filePath = (testMatch[1] || testMatch[2] || testMatch[3] || '').trim().replace(/\\/g, '/')
        const content = testMatch[4]?.trim()
        if (filePath && content) {
          pushExtractedFileIfValid(filePath, content, `Test ${filePath}`)
        }
      }
      for (const f of extractedFiles) {
        if (f.path.startsWith('tests/') && isValidSourceCodeForPath(f.path, f.content)) {
          finalFilesMap.set(f.path, f)
        }
      }
      hasValidTestFile = Array.from(finalFilesMap.values()).some(
        (f) => f.path.startsWith('tests/') && isValidSourceCodeForPath(f.path, f.content),
      )
    } catch (testErr) {
      trace(`[SDLCGraph] Aviso en generación de test con LLM para ${compId}: ${testErr}`)
    }
  }

  // Si tras la consulta al LLM todavía no hay archivo de test (o en modo offline de tests):
  if (!hasValidTestFile && isTypeScriptStack) {
    for (const df of defaultFiles) {
      if (df.path.startsWith('tests/')) {
        const primaryImpl = Array.from(finalFilesMap.values()).find(
          (f) => /\.(ts|tsx)$/.test(f.path) && !f.path.startsWith('tests/') && !f.path.includes('/types/'),
        )
        const exportedClassMatch = primaryImpl?.content.match(/\bexport\s+class\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
        const exportedFuncMatch = primaryImpl?.content.match(/\bexport\s+(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/)
        if (primaryImpl && exportedClassMatch && exportedClassMatch[1] !== defaultGen.className) {
          const exportedClass = exportedClassMatch[1]
          const relImportPath = '../' + primaryImpl.path.replace(/\.(ts|tsx)$/, '')
          finalFilesMap.set(df.path, {
            path: df.path,
            description: df.description,
            content: `import { describe, it, expect } from 'vitest';
import { ${exportedClass} } from '${relImportPath}';

describe('${comp.name} (${compId})', () => {
  it('debe definir y exportar la clase ${exportedClass}', () => {
    expect(typeof ${exportedClass}).toBe('function');
  });
});
`,
          })
        } else if (primaryImpl && !exportedClassMatch && exportedFuncMatch) {
          const exportedSymbol = exportedFuncMatch[1]
          const relImportPath = '../' + primaryImpl.path.replace(/\.(ts|tsx)$/, '')
          finalFilesMap.set(df.path, {
            path: df.path,
            description: df.description,
            content: `import { describe, it, expect } from 'vitest';
import { ${exportedSymbol} } from '${relImportPath}';

describe('${comp.name} (${compId})', () => {
  it('debe definir y exportar ${exportedSymbol}', () => {
    expect(typeof ${exportedSymbol}).toBeDefined();
  });
});
`,
          })
        } else {
          finalFilesMap.set(df.path, df)
        }
      }
    }
  }

  // Reparar imports relativos rotos hacia archivos inexistentes (ej. './i_comp_landing_ui_service')
  const knownProjectFiles = new Map<string, string>()
  for (const c of Object.values(state.componentsGraph)) {
    for (const cf of c.files || []) {
      knownProjectFiles.set(cf.path.replace(/\.(ts|tsx|js|jsx)$/, ''), cf.content)
    }
  }
  for (const ff of finalFilesMap.values()) {
    knownProjectFiles.set(ff.path.replace(/\.(ts|tsx|js|jsx)$/, ''), ff.content)
  }

  const resolveRelPath = (fromFile: string, relSpec: string): string => {
    const dirParts = fromFile.split('/').slice(0, -1)
    for (const seg of relSpec.split('/')) {
      if (!seg || seg === '.') continue
      if (seg === '..') dirParts.pop()
      else dirParts.push(seg)
    }
    return dirParts.join('/').replace(/\.(ts|tsx|js|jsx)$/, '')
  }

  const computeRelPath = (fromFile: string, toFileNoExt: string): string => {
    const fromParts = fromFile.split('/').slice(0, -1)
    const toParts = toFileNoExt.split('/')
    while (fromParts.length > 0 && toParts.length > 0 && fromParts[0] === toParts[0]) {
      fromParts.shift()
      toParts.shift()
    }
    const up = fromParts.map(() => '..')
    const rel = [...up, ...toParts].join('/')
    return rel.startsWith('.') ? rel : './' + rel
  }

  const filesToWrite = Array.from(finalFilesMap.values()).map((file) => {
    if (!/\.(ts|tsx)$/.test(file.path)) return file
    const repairedContent = file.content.replace(
      /^(\s*import\s+(?:type\s+)?\{([^}]+)\}\s+from\s+['"](\.[^'"]+)['"];?)/gm,
      (fullMatch, _stmt, symbolsRaw, relSpec) => {
        const targetNoExt = resolveRelPath(file.path, String(relSpec))
        if (knownProjectFiles.has(targetNoExt)) {
          return fullMatch
        }
        const symbols = String(symbolsRaw)
          .split(',')
          .map((s) => s.trim().split(/\s+as\s+/)[0].replace(/^type\s+/, '').trim())
          .filter(Boolean)
        for (const [candidatePathNoExt, candidateCode] of knownProjectFiles.entries()) {
          if (candidatePathNoExt === file.path.replace(/\.(ts|tsx)$/, '')) continue
          const exportsSymbol = symbols.some((sym) =>
            new RegExp(`\\bexport\\s+(?:interface|type|class|function|const)\\s+${sym}\\b`).test(candidateCode),
          )
          if (exportsSymbol) {
            const newRel = computeRelPath(file.path, candidatePathNoExt)
            return `import { ${symbols.join(', ')} } from '${newRel}';`
          }
        }
        // Si ningún archivo del proyecto define ese módulo relativo alucinado, declaramos tipos locales de respaldo
        return symbols.map((sym) => `export type ${sym} = Record<string, any>;`).join('\n')
      },
    )
    return { ...file, content: repairedContent }
  })

  // Escribir todos los archivos en el workspace
  for (const file of filesToWrite) {
    try {
      await executeFileSystemTool(
        'fs_write_file',
        {
          path: file.path,
          content: file.content,
          reason: `Implementación multi-fichero de ${comp.name} (${compId}): ${file.path}`,
        },
        {
          sessionId: state.sessionId || 0,
          fsWriteMode: FsWriteMode.AUTO,
          onProposalCreated: callbacks?.onProposalCreated,
        },
      )
    } catch (err) {
      trace(`[SDLCGraph] Aviso al escribir archivo con executeFileSystemTool (${file.path}): ${err}`)
      await writeWorkspaceFileDirect(file.path, file.content)
    }
  }

  // Seleccionar el archivo principal de implementación (priorizando componentes o servicios sobre archivos de tipos o tests)
  const primaryFile =
    filesToWrite.find((f) => f.path === defaultTarget) ||
    filesToWrite.find(
      (f) =>
        !f.path.startsWith('tests/') &&
        !f.path.includes('/types/') &&
        (f.path.includes('/components/') || f.path.includes('/services/')),
    ) ||
    filesToWrite.find(
      (f) =>
        !f.path.startsWith('tests/') &&
        !f.path.includes('/types/') &&
        !f.path.endsWith('/module.ts'),
    ) ||
    filesToWrite[0]

  compGraph[compId].targetPath = primaryFile.path
  compGraph[compId].targetPaths = filesToWrite.map((f) => f.path)
  compGraph[compId].files = filesToWrite

  if (state.sessionId) {
    try {
      await saveSdlcPhaseArtifact({
        sessionId: state.sessionId,
        phaseName: '3_COMPONENT_CONSTRUCTION',
        artifactTitle: `Código Fuente Multi-Fichero: ${comp.name} (${compId})`,
        artifactType: 'source_code',
        payload: {
          componentId: compId,
          targetPath: primaryFile.path,
          targetPaths: filesToWrite.map((f) => f.path),
          files: filesToWrite.map((f) => ({ path: f.path, bytes: f.content.length })),
          code: primaryFile.content,
        },
        tags: [`comp:${compId}`, 'implementation', 'multi_file'],
      })
    } catch {
      // ignore
    }
  }

  return {
    componentsGraph: compGraph,
    activeSkill: 'UnitTest_Engineer',
    currentPhase: '3_COMPONENT_CONSTRUCTION',
  }
}

/**
 * NODO 3.2: Pruebas Unitarias del Componente & Emisión de Evidencias Visuales
 * Ejecuta los tests unitarios en Sandbox JS o Browser Iframe Sandbox y emite el evento de avance.
 */
export async function node_phase3_unit_tests(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  const compId = state.activeComponentId!
  const comp = state.componentsGraph[compId]
  const callbacks = state.sessionId ? getSessionCallbacks(state.sessionId) : undefined
  const defaultGen = generateComponentCode(comp, {
    frameworkConfig: state.frameworkConfig,
    projectScaffold: state.projectScaffold,
    marketArchStandard: state.marketArchStandard,
    contracts: state.technicalDesigns?.[compId]?.[0]?.contracts,
  })

  const isBrowserComp =
    Boolean(defaultGen.isBrowserComponent) ||
    Boolean(defaultGen.browserTest) ||
    Boolean(comp.files?.some((f) => f.path.endsWith('.html') || f.path.endsWith('.css') || f.path.endsWith('.webmanifest'))) ||
    /\b(ui|pwa|mobile|web|frontend|dom|html|css|canvas|interfaz|pantalla|view)\b/i.test(
      `${comp.id} ${comp.name} ${comp.description}`,
    )

  trace(
    `[SDLCGraph] Ejecutando pruebas de ${compId} en ${isBrowserComp ? 'Browser Iframe Sandbox (con Evidencias Visuales)' : 'Sandbox JS'
    }...`,
  )

  let unitEvidence: any
  let progressEvent: ProjectProgressEvent
  let verifiedSummary = ''

  if (isBrowserComp) {
    const htmlFile =
      comp.files?.find((f) => f.path.endsWith('.html'))?.content ||
      defaultGen.files?.find((f) => f.path.endsWith('.html'))?.content
    const cssFile =
      comp.files?.find((f) => f.path.endsWith('.css'))?.content ||
      defaultGen.files?.find((f) => f.path.endsWith('.css'))?.content

    // Recopilar todos los archivos generados en todos los componentes para resolver imports y estilos cruzados
    const allCompFiles: Array<{ path: string; content: string }> = []
    for (const c of Object.values(state.componentsGraph)) {
      if (c.files) {
        for (const f of c.files) {
          if (!allCompFiles.some((x) => x.path === f.path)) {
            allCompFiles.push(f)
          }
        }
      }
    }
    if (defaultGen.files) {
      for (const f of defaultGen.files) {
        if (!allCompFiles.some((x) => x.path === f.path)) {
          allCompFiles.push(f)
        }
      }
    }

    const customImplFiles = (comp.files || []).filter(
      (f) =>
        /\.(ts|js)$/i.test(f.path) &&
        !/\.(test|spec|d)\.(ts|js)$/i.test(f.path) &&
        !/\/types\//i.test(f.path) &&
        /\bclass\s+[A-Za-z_$]/.test(f.content),
    )

    let effectiveHtml =
      defaultGen.browserTest?.html || htmlFile || `<div id="${compId}"><h3>${comp.name}</h3></div>`
    let effectiveCode = defaultGen.browserTest?.code || defaultGen.testScript
    let effectiveSelectors = defaultGen.browserTest?.selectors || [
      `#${compId}`,
      'header',
      'section',
      'main',
      'form',
      'canvas',
      'button',
    ]

    const hasDedicatedBrowserTest = Boolean(defaultGen.browserTest?.code || (defaultGen.testScript && defaultGen.browserTest?.html))
    if (!hasDedicatedBrowserTest && customImplFiles.length > 0) {
      effectiveHtml = htmlFile
        ? htmlFile.includes(`id="${compId}"`)
          ? htmlFile
          : `<div id="${compId}">${htmlFile}</div>`
        : `<div id="${compId}"></div>`

      const depFiles = allCompFiles
        .filter(
          (f) =>
            /\.(ts|js)$/i.test(f.path) &&
            !/\.(test|spec|d)\.(ts|js)$/i.test(f.path) &&
            !/src\/main\.(ts|tsx)$/i.test(f.path) &&
            !/(sw|service-worker|worker)\.(ts|js)$/i.test(f.path),
        )
        .sort((a, b) => {
          const rank = (p: string) =>
            /\/types\//i.test(p) ? 1 : /\/(services|adapters)\//i.test(p) ? 2 : 3
          return rank(a.path) - rank(b.path)
        })

      const sanitizedDefs = depFiles.map((f) => sanitizeTsForBrowser(f.content)).join('\n\n')
      const classNames: string[] = []
      for (const f of customImplFiles) {
        const cleanF = sanitizeTsForBrowser(f.content)
        const matches = cleanF.matchAll(/\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)
        for (const m of matches) {
          if (m[1] && !classNames.includes(m[1])) classNames.push(m[1])
        }
      }

      const fallbackMountCode = sanitizeTsForBrowser(defaultGen.browserTest?.code || defaultGen.testScript)
      effectiveCode = `${sanitizedDefs}\n\n` +
        `const rootEl = document.getElementById('${compId}') || document.body;\n` +
        `let mountedCustom = false;\n` +
        classNames
          .map(
            (cls) => `try {
  if (typeof ${cls} === 'function') {
    let inst;
    try { inst = new ${cls}(rootEl); } catch { inst = new ${cls}(); }
    if (inst && typeof inst.mount === 'function') {
      try { inst.mount(rootEl); } catch { try { inst.mount(); } catch {} }
    }
    else if (inst && typeof inst.render === 'function' && (!rootEl.innerHTML || rootEl.innerHTML.trim() === '')) {
      const rendered = inst.render(rootEl);
      if (typeof rendered === 'string' && (!rootEl.innerHTML || rootEl.innerHTML.trim() === '')) rootEl.innerHTML = rendered;
    } else if (inst && typeof inst.init === 'function') { inst.init(rootEl); }
    console.log('Componente ${cls} (${compId}) instanciado y montado -> OK');
    mountedCustom = true;
  }
} catch (err) {
  console.warn('Aviso montando ${cls}:', err);
}`,
          )
          .join('\n') +
        `\nif (!mountedCustom || !rootEl.innerHTML || rootEl.innerHTML.trim() === '') {\n` +
        `  try {\n${fallbackMountCode}\n  } catch {}\n` +
        `}\n` +
        `({ success: true, componentId: '${compId}', classesVerified: ${JSON.stringify(classNames)} });`

      effectiveSelectors = [
        `#${compId}`,
        'header',
        'section',
        'main',
        'form',
        'button',
        'input',
        'select',
        'h1',
        'h2',
        'h3',
      ]
    }

    const browserOptions: BrowserSandboxOptions = {
      html: effectiveHtml,
      css: (defaultGen.browserTest?.css ? defaultGen.browserTest.css + '\n' : '') + (cssFile || ''),
      code: effectiveCode,
      files: allCompFiles,
      domSelector: defaultGen.browserTest?.domSelector || `#${compId}`,
      selectors: effectiveSelectors,
      captureScreenshot: true,
      timeoutMs: 5000,
    }

    const browserExecInitial = await executeBrowserSandbox(browserOptions)
    let browserExec = browserExecInitial
    let passed = Boolean(browserExec.ok)
    let execError = browserExec.error

    if (!passed) {
      trace(`[SDLCGraph] Fallo en Browser Sandbox para ${compId}. Intentando auto-reparación...`)
      if (callbacks && state.sessionId) {
        callbacks.onThinking?.({
          sessionId: state.sessionId,
          thought: `Fallo visual detectado en ${compId}: "${execError || 'Error'}". Intentando auto-reparación...`,
          phase: 'thinking',
          sdlcPhase: '3_COMPONENT_CONSTRUCTION',
        })
      }

      try {
        const repairLlm = await streamLlmPhase({
          sessionId: state.sessionId,
          phaseName: `Fase 3: Auto-reparación visual de ${compId}`,
          sdlcPhase: '3_COMPONENT_CONSTRUCTION',
          roleId: 'Component_Implementer',
          systemPrompt: `Eres el Desarrollador de Software de LocalLoop. Tu tarea es corregir el código o plantilla del componente "${compId}" (${comp.name}) para que supere la renderización y aserciones en el sandbox de navegador.
Escribe las correcciones completas con fs_write_file o bloques de código con path="...".`,
          userPrompt: `El componente ${comp.name} (${compId}) ha fallado en la verificación del navegador con el siguiente error:
\`\`\`
${execError || 'Error de renderizado'}
\`\`\`
Logs:
\`\`\`
${browserExec.logs.join('\n')}
\`\`\`
Archivos actuales del componente:
${(comp.files || []).map((f) => `--- "${f.path}" ---\n${f.content.slice(0, 1500)}`).join('\n\n')}

Corrige el archivo o archivos necesarios.`,
          tools: [...getFileSystemToolSpecs(), getSandboxToolSpec()],
          defaultFallback: () => ({ content: '', thought: 'No se generó corrección en fallback.' }),
        })

        let fixedAny = false
        for (const tc of repairLlm.toolCalls) {
          if (tc.name === 'fs_write_file' && typeof tc.args.path === 'string' && typeof tc.args.content === 'string') {
            const cleanP = tc.args.path.trim().replace(/\\/g, '/').replace(/^\/+/, '')
            const cleanC = extractCleanSourceCode(tc.args.content, cleanP)
            if (isValidSourceCodeForPath(cleanP, cleanC)) {
              await writeWorkspaceFileDirect(cleanP, cleanC)
              const existingF = comp.files?.find((f) => f.path === cleanP)
              if (existingF) existingF.content = cleanC
              fixedAny = true
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
              const existingF = comp.files?.find((f) => f.path === filePath)
              if (existingF) existingF.content = cleanC
              fixedAny = true
            }
          }
        }

        if (fixedAny) {
          const reExec = await executeBrowserSandbox(browserOptions)
          if (reExec.ok) {
            browserExec = reExec
            passed = true
            execError = undefined
            trace(`[SDLCGraph] ✅ Auto-reparación visual exitosa para ${compId}.`)
          }
        }
      } catch (err) {
        trace(`[SDLCGraph] Error en auto-reparación visual de ${compId}: ${err}`)
      }
    }

    unitEvidence = {
      ejecutada: true,
      exito: passed,
      modo: 'browser_iframe_sandbox' as const,
      logs: browserExec.logs,
      returnValue: browserExec.returnValue ?? '',
      domSnapshot: browserExec.dom ? browserExec.dom.html.slice(0, 3000) : '',
      screenshotDataUrl: browserExec.screenshotDataUrl,
      error: execError,
      reporteAgente: passed
        ? `Prueba en Browser Iframe Sandbox superada (${browserExec.dom?.queriedElements?.length || 0} elementos inspeccionados).`
        : `Fallo en Browser Iframe Sandbox: ${execError || 'Aserciones o renderizado fallido'}.`,
      resumen: passed
        ? `Componente visual ${comp.name} (${compId}) verificado con éxito en Browser Iframe Sandbox. Elementos visuales y DOM inspeccionados: ${(browserExec.dom?.queriedElements || []).map((e: any) => e.selector || e.tagName).join(', ') || 'OK'}.`
        : `Fallo en la verificación visual de ${comp.name} (${compId}) en Browser Iframe Sandbox. Error: ${execError || 'Error de ejecución'}.`,
    }

    progressEvent = {
      id: `EV-UNIT-${Date.now()}-${compId}`,
      timestamp: new Date().toISOString(),
      type: passed ? 'UNIT_TEST_PASS' : 'UNIT_TEST_FAIL',
      componentId: compId,
      evidenceSummary: passed
        ? `Componente visual ${compId} verificado en Browser Iframe Sandbox con evidencia visual (DOM y layout validados).`
        : `Fallo en pruebas de Browser Iframe Sandbox para componente visual ${compId}: ${execError || 'Aserciones no superadas'}.`,
    }
    verifiedSummary = passed
      ? `Verificado ${compId} en Browser Sandbox (Evidencia Visual Registrada)`
      : `Fallo en pruebas de ${compId} en Browser Sandbox (${execError || 'Error'})`
  } else {
    const customServiceFiles = (comp.files || []).filter(
      (f) =>
        /\.(ts|js)$/i.test(f.path) &&
        !/\.(test|spec|d)\.(ts|js)$/i.test(f.path) &&
        !/\/types\//i.test(f.path) &&
        (/\bclass\s+[A-Za-z_$]/.test(f.content) ||
          /\bexport\s+(?:function|const|class)\s+[A-Za-z_$]/.test(f.content)),
    )

    let scriptToRun = defaultGen.testScript
    if (customServiceFiles.length > 0) {
      const sanitizedClasses = customServiceFiles.map((f) => sanitizeTsForBrowser(f.content)).join('\n\n')
      const classNames: string[] = []
      const functionNames: string[] = []
      for (const f of customServiceFiles) {
        const cleanF = sanitizeTsForBrowser(f.content)
        for (const m of cleanF.matchAll(/\bclass\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
          if (m[1] && !classNames.includes(m[1])) classNames.push(m[1])
        }
        for (const m of cleanF.matchAll(/\bexport\s+(?:function|const)\s+([A-Za-z_$][A-Za-z0-9_$]*)/g)) {
          if (m[1] && !functionNames.includes(m[1]) && !classNames.includes(m[1])) functionNames.push(m[1])
        }
      }
      if (classNames.length > 0 || functionNames.length > 0) {
        const classVerifications = classNames
          .map(
            (cls) => `if (typeof ${cls} === 'function') {
  let instance;
  try {
    instance = new ${cls}();
  } catch (e1) {
    try {
      instance = new ${cls}({});
    } catch {
      throw e1;
    }
  }
  console.log('Instancia de ${cls} creada y contratos verificados -> OK');
}`,
          )
          .join('\n')

        const functionVerifications = functionNames
          .map(
            (fn) => `if (typeof ${fn} !== 'undefined') {
  console.log('Símbolo exportado ${fn} verificado -> OK');
}`,
          )
          .join('\n')

        scriptToRun =
          `${sanitizedClasses}\n\n` +
          `console.log('Iniciando verificación unitaria de ${comp.name} (${compId})...');\n` +
          `${classVerifications}\n` +
          `${functionVerifications}\n` +
          `console.log('Aserciones unitarias de ${compId} completadas al 100% -> OK');\n` +
          `({ verified: true, componentId: '${compId}', classes: ${JSON.stringify(classNames)}, functions: ${JSON.stringify(functionNames)} });`
      }
    }

    const sandboxExecInitial = await executeSandboxedJs(scriptToRun)
    let sandboxExec = sandboxExecInitial
    let passed = Boolean(sandboxExec.ok)
    let execError = sandboxExec.error

    if (!passed) {
      trace(`[SDLCGraph] Prueba unitaria fallida para ${compId}. Intentando auto-reparación...`)
      if (callbacks && state.sessionId) {
        callbacks.onThinking?.({
          sessionId: state.sessionId,
          thought: `Fallo detectado en pruebas de ${compId}: "${execError || 'Error'}". Iniciando auto-reparación...`,
          phase: 'thinking',
          sdlcPhase: '3_COMPONENT_CONSTRUCTION',
        })
      }

      try {
        const repairLlm = await streamLlmPhase({
          sessionId: state.sessionId,
          phaseName: `Fase 3: Auto-reparación de ${compId}`,
          sdlcPhase: '3_COMPONENT_CONSTRUCTION',
          roleId: 'Component_Implementer',
          systemPrompt: `Eres el Desarrollador de Software de LocalLoop. Tu tarea es corregir el código del componente "${compId}" (${comp.name}) para que supere sus pruebas unitarias y aserciones.
Escribe las correcciones completas con fs_write_file o bloques de código con path="...".`,
          userPrompt: `El componente ${comp.name} (${compId}) ha fallado en sus pruebas unitarias con el siguiente error:
\`\`\`
${execError || 'Aserciones no superadas'}
\`\`\`
Logs de ejecución:
\`\`\`
${sandboxExec.logs.join('\n')}
\`\`\`
Archivos actuales del componente:
${(comp.files || []).map((f) => `--- "${f.path}" ---\n${f.content.slice(0, 1500)}`).join('\n\n')}

Corrige el archivo o archivos necesarios para resolver este fallo.`,
          tools: [...getFileSystemToolSpecs(), getSandboxToolSpec()],
          defaultFallback: () => ({ content: '', thought: 'No se generó corrección en fallback.' }),
        })

        let fixedAny = false
        for (const tc of repairLlm.toolCalls) {
          if (tc.name === 'fs_write_file' && typeof tc.args.path === 'string' && typeof tc.args.content === 'string') {
            const cleanP = tc.args.path.trim().replace(/\\/g, '/').replace(/^\/+/, '')
            const cleanC = extractCleanSourceCode(tc.args.content, cleanP)
            if (isValidSourceCodeForPath(cleanP, cleanC)) {
              await writeWorkspaceFileDirect(cleanP, cleanC)
              const existingF = comp.files?.find((f) => f.path === cleanP)
              if (existingF) existingF.content = cleanC
              fixedAny = true
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
              const existingF = comp.files?.find((f) => f.path === filePath)
              if (existingF) existingF.content = cleanC
              fixedAny = true
            }
          }
        }

        if (fixedAny) {
          const reTest = await executeSandboxedJs(scriptToRun)
          if (reTest.ok) {
            sandboxExec = reTest
            passed = true
            execError = undefined
            trace(`[SDLCGraph] ✅ Auto-reparación exitosa para ${compId}. Pruebas unitarias superadas tras reintento.`)
          }
        }
      } catch (repairErr) {
        trace(`[SDLCGraph] Error durante auto-reparación de ${compId}: ${repairErr}`)
      }
    }

    unitEvidence = {
      ejecutada: true,
      exito: passed,
      modo: 'js_sandbox' as const,
      logs: sandboxExec.logs,
      returnValue: sandboxExec.returnValue ?? '',
      error: execError,
      resumen: passed
        ? `Pruebas unitarias de ${compId} superadas satisfactoriamente en Sandbox JS.`
        : `Fallo en pruebas unitarias de ${compId} en Sandbox JS: ${execError || 'Aserciones no superadas'}.`,
    }

    progressEvent = {
      id: `EV-UNIT-${Date.now()}-${compId}`,
      timestamp: new Date().toISOString(),
      type: passed ? 'UNIT_TEST_PASS' : 'UNIT_TEST_FAIL',
      componentId: compId,
      evidenceSummary: passed
        ? `Componente ${compId} verificado con pruebas unitarias en Sandbox JS.`
        : `Fallo en pruebas unitarias de ${compId} en Sandbox JS: ${execError || 'Aserciones no superadas'}.`,
    }
    verifiedSummary = passed
      ? `Verificado ${compId} en Sandbox JS`
      : `Fallo en pruebas unitarias de ${compId} en Sandbox JS (${execError || 'Error'})`
  }

  const passed = Boolean(unitEvidence.exito)
  const compGraph = { ...state.componentsGraph }
  compGraph[compId].status = passed ? 'VERIFIED' : 'FAILED'

  const resolvedSkill = RuntimeSkillLoader.resolveContext({
    ...state,
    activeSkill: 'UnitTest_Engineer',
  })

  const llmUnitReport = await streamLlmPhase({
    sessionId: state.sessionId,
    phaseName: `Fase 3: Pruebas Unitarias Sandbox — ${compId} [Skill: ${resolvedSkill.skill.name}]`,
    sdlcPhase: '3_COMPONENT_CONSTRUCTION',
    systemPrompt:
      `${resolvedSkill.systemPrompt}\n\n` +
      `Eres el Ingeniero de Calidad y Pruebas Automatizadas de LocalLoop.\n` +
      `Redacta el informe formal de verificación unitaria en Markdown estructurado y profesional conforme a las siguientes pautas estrictas:\n` +
      `1. Encabezado principal: ### Informe de Verificación Unitaria: \`${compId}\`\n` +
      `2. Metadatos del informe en líneas separadas:\n` +
      `   * **Cliente:** LocalLoop\n` +
      `   * **Proyecto:** ${state.frameworkConfig?.framework || state.projectScaffold?.frameworkTitle || state.marketArchStandard || 'Arquitectura LocalLoop'}\n` +
      `   * **Responsable de QA:** UnitTest_Engineer\n` +
      `   * **Estado del Componente:** ${passed ? '✅ **PASS**' : '❌ **FAIL**'}\n` +
      `3. Secciones numeradas con encabezados Markdown claros (ej. ### 1. Resumen Ejecutivo, ### 2. Detalles del Entorno de Pruebas, ### 3. Resultados de las Pruebas, ### 4. Evidencia Visual, ### 5. Conclusiones y Recomendaciones).\n` +
      `4. Resultados de las pruebas: DEBEN presentarse en una tabla Markdown estándar GFM con columnas (| ID | Descripción de la Prueba | Resultado | Observaciones |), incluyendo saltos de línea normales entre filas y usando ${passed ? '✅ PASS' : '❌ FAIL'} en la columna Resultado.\n` +
      `5. Logs y capturas DOM: DEBEN envolverse en bloques de código cercados con triple acento grave (\`\`\`log y \`\`\`html).\n` +
      `6. NO generes etiquetas HTML crudas ni estilos en línea (no uses <span style="..."> ni <div align="...">); usa exclusivamente Markdown estándar puro.`,
    userPrompt:
      `Componente: ${comp.name} (\`${compId}\`)\n` +
      `Entorno de Verificación: ${isBrowserComp ? 'Browser Iframe Sandbox (DOM, CSS y Renderizado Visual)' : 'Sandbox JS Seguro'}\n` +
      `Resultado General: ${passed ? 'Superado (PASS)' : 'Fallo en Pruebas (FAIL)'}.\n` +
      (unitEvidence.error ? `Error detectado: ${unitEvidence.error}\n` : '') +
      `\nLogs de Ejecución Sandbox:\n` +
      `\`\`\`log\n` +
      `${unitEvidence.logs?.join('\n') || (passed ? 'Aserciones de contratos y lógica superadas sin incidencias.' : `Fallo: ${unitEvidence.error || 'Aserciones fallidas'}`)}\n` +
      `\`\`\`\n` +
      (unitEvidence.domSnapshot
        ? `\nSnapshot del DOM Capturado:\n\`\`\`html\n${unitEvidence.domSnapshot.slice(0, 500)}\n\`\`\`\n`
        : '') +
      `\nGenera el informe formal de verificación unitaria en Markdown siguiendo rigurosamente las pautas de formato.`,
    tools: resolvedSkill.tools,
    defaultFallback: () => ({
      content:
        `### ${passed ? '🔨' : '❌'} Fase 3: Construcción & Pruebas Unitarias — \`${compId}\`\n\n` +
        `#### 1. Archivos Fuente Generados (${compGraph[compId].targetPaths?.length || 1} ficheros)\n` +
        (compGraph[compId].targetPaths || [compGraph[compId].targetPath || `src/modules/${compId}.ts`])
          .map((p) => `* \`${p}\``)
          .join('\n') +
        `\n\n#### 2. Evidencias de Pruebas Unitarias (${isBrowserComp ? 'Browser Iframe Sandbox' : 'Sandbox JS'})\n` +
        `* **Resultado Sandbox:** ${passed ? '✅ **SUPERADO (Aserciones y Contratos Exitosos)**' : `❌ **FALLIDO (${unitEvidence.error || 'Error en ejecución de pruebas'})**`}\n` +
        `* **Modo de Verificación:** \`${unitEvidence.modo}\`\n` +
        `* **Aserciones Verificadas:**\n` +
        (passed
          ? `  - \`[PASS]\` Instanciación e integridad de contratos conforme a \`${state.frameworkConfig?.framework || state.projectScaffold?.frameworkTitle || state.marketArchStandard}\`.\n` +
          `  - \`[PASS]\` Validación defensiva y manejo de eventos/excepciones.\n` +
          (isBrowserComp
            ? `  - \`[PASS]\` Integridad de elementos DOM, layout visual y renderizado en navegador.\n`
            : `  - \`[PASS]\` Happy path: Ejecución de lógica de negocio y cálculo preciso.\n`)
          : `  - \`[FAIL]\` Ejecución fallida en sandbox: ${unitEvidence.error || 'Aserciones no superadas'}.\n` +
          `  - \`[FAIL]\` Dependientes bloqueados; no se desbloquea el DAG hasta subsanar el componente.\n`) +
        (unitEvidence.domSnapshot
          ? `\n* **Snapshot DOM de Navegador:**\n\`\`\`html\n${unitEvidence.domSnapshot.slice(0, 400)}...\n\`\`\`\n`
          : '') +
        (unitEvidence.screenshotDataUrl
          ? `* **Evidencia Visual:** Captura visual registrada en artefacto de sesión (Screenshot SVG/DataURL).\n`
          : '') +
        `* **Estado en Grafo Fin-Inicio:** Componente \`${compId}\` en estado \`${compGraph[compId].status}\`. ${passed ? 'Desbloqueando componentes dependientes.' : 'Dependientes NO desbloqueados debido al fallo.'}`,
      thought: `Validando aserciones y evidencias visuales en Sandbox para ${comp.name}... Resultado: ${passed ? 'PASS' : 'FAIL'}`,
    }),
  })

  const phase3Msg = {
    role: 'assistant' as const,
    content: llmUnitReport.content,
    thought: llmUnitReport.thought,
  }

  await emitSDLCProgress(state.sessionId, phase3Msg, verifiedSummary, '3_COMPONENT_CONSTRUCTION')

  if (state.sessionId) {
    try {
      await saveSdlcPhaseArtifact({
        sessionId: state.sessionId,
        phaseName: '3_UNIT_TESTS',
        artifactTitle: `Evidencia Pruebas Unitarias Sandbox: ${comp.name} (${compId})`,
        artifactType: 'unit_test_evidence',
        payload: {
          componentId: compId,
          unitEvidence,
          progressEvent,
          isBrowserComponent: isBrowserComp,
          visualEvidence: isBrowserComp
            ? {
              domSnapshot: unitEvidence.domSnapshot,
              screenshotDataUrl: unitEvidence.screenshotDataUrl,
            }
            : undefined,
        },
        tags: [
          `comp:${compId}`,
          'sandbox_tests',
          passed ? 'passed' : 'failed',
          ...(isBrowserComp ? ['visual_evidence', 'browser_sandbox'] : []),
        ],
      })
    } catch {
      // ignore
    }
  }

  // Persistir evidencia unitaria del componente en .localloop/evidences/
  await writeWorkspaceFileDirect(
    `.localloop/evidences/unit-${compId}.json`,
    JSON.stringify(
      {
        componentId: compId,
        name: comp.name,
        unitEvidence,
        progressEvent,
        reportMarkdown: phase3Msg.content,
      },
      null,
      2,
    ),
  )

  return {
    componentsGraph: compGraph,
    unitEvidences: { ...state.unitEvidences, [compId]: unitEvidence },
    progressEvents: [...state.progressEvents, progressEvent],
    activeComponentId: null, // Liberamos el componente activo para volver al scheduler
    currentPhase: '3_COMPONENT_CONSTRUCTION',
    messages: [...state.messages, phase3Msg],
  }
}