import { trace } from '../../../diagnostics'
import { getPersistentEngram, saveSdlcPhaseArtifact } from '../../../memory/engram-memory'
import type { ProjectProgressEvent, RcaDiagnosis, SDLCStateType } from '../../sdlc-state'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import { streamLlmPhase } from '../execution/llm-phase-streamer'
import { emitSDLCProgress } from '../execution/progress-emitter'

/**
 * Deriva el diagnóstico RCA de las evidencias existentes en el estado del SDLC
 * (comentarios del stakeholder, errores de pruebas unitarias, fallos de integración E2E, simulaciones y deuda técnica).
 */
export function deriveRcaFromEvidence(state: SDLCStateType): RcaDiagnosis {
  const stakeholderFeedback =
    state.businessApproval?.stakeholderComments?.trim() ||
    [...state.messages].reverse().find((m) => m.role === 'user')?.content?.trim() ||
    ''

  const failedUnits = Object.entries(state.unitEvidences || {}).filter(
    ([_, ev]) => ev && ev.exito === false,
  )
  const failedCompNodes = Object.values(state.componentsGraph || {}).filter(
    (c) => c.status === 'FAILED' || failedUnits.some(([id]) => id === c.id),
  )

  const e2eError = state.e2eEvidences?.error
  const e2eFailed = state.e2eEvidences && state.e2eEvidences.allAssertionsPassed === false
  const e2eSimulation = state.e2eEvidences?.isSimulation === true
  const isCompilationOrBuildDefect =
    Boolean(state.technicalDebtList?.some((d) => d.id === 'td-compilation-failure')) ||
    /\b(build|pnpm|npm|vite|tsc|compila|transpila|error|falla|fallo|bug|fichero|archivo|sintaxis|syntax|typeerror|cannot find module|exception)\b/i.test(
      stakeholderFeedback,
    )
  const hasTechDefects = failedUnits.length > 0 || failedCompNodes.length > 0 || Boolean(e2eError) || isCompilationOrBuildDefect

  let failureSummary = ''
  let rootCauseCategory: RcaDiagnosis['rootCauseCategory'] = 'BUSINESS_ASSUMPTION'
  let detail = ''
  let remedyRecommendation = ''
  let remedyTitle = ''

  if (hasTechDefects) {
    rootCauseCategory = 'TECH_DEFECT'
    const failedNames = failedCompNodes.map((c) => `${c.name} (${c.id})`)
    const firstErr =
      failedUnits[0]?.[1]?.error ||
      e2eError ||
      (isCompilationOrBuildDefect ? stakeholderFeedback : 'Aserción técnica no superada')
    failureSummary =
      failedCompNodes.length > 0
        ? `Defecto técnico detectado en componente(s): ${failedNames.join(', ')}. Error: ${firstErr}`
        : `Defecto de compilación o ejecución detectado en la aplicación: "${firstErr}"`
    detail = `Evidencia de fallo en ejecución/build: ${
      failedUnits[0]?.[1]?.logs?.slice(-2).join(' | ') || firstErr
    }. Feedback stakeholder: "${stakeholderFeedback || 'Rechazado por fallo técnico'}"`
    remedyRecommendation = `Subsanar el defecto de implementación en ${
      failedNames.join(', ') || 'los módulos afectados'
    } y revalidar aserciones unitarias en Sandbox y compilación.`
    remedyTitle = `Corrección de defecto técnico: ${failedCompNodes[0]?.name || 'Código Fuente / Compilación'}`
  } else if (
    state.technicalDebtList &&
    state.technicalDebtList.length > 0 &&
    /deuda|arquitectura|acoplamiento|contrato/i.test(stakeholderFeedback)
  ) {
    rootCauseCategory = 'ARCH_LIMITATION'
    const primaryDebt = state.technicalDebtList[0]
    failureSummary = `Limitación arquitectónica identificada: ${primaryDebt.title} (${primaryDebt.componentId})`
    detail = `Deuda técnica registrada con nivel de riesgo ${primaryDebt.riskLevel}: ${primaryDebt.description}. Feedback stakeholder: "${stakeholderFeedback}"`
    remedyRecommendation = `Aplicar el plan de mitigación arquitectónico: ${primaryDebt.mitigationPlan}`
    remedyTitle = `Mitigación arquitectónica: ${primaryDebt.title}`
  } else if (stakeholderFeedback) {
    rootCauseCategory = 'BUSINESS_ASSUMPTION'
    failureSummary = `Discrepancia con requisitos de negocio: "${stakeholderFeedback}"`
    detail = `El comportamiento observado no satisface el criterio del stakeholder. Comentarios registrados: "${stakeholderFeedback}". ${
      e2eSimulation ? 'Nota: La integración E2E se ejecutó en modo simulación.' : ''
    }`
    remedyRecommendation = `Re-especificar las reglas de negocio y criterios de aceptación conforme al feedback: "${stakeholderFeedback}".`
    remedyTitle = `Refinamiento de negocio: ${stakeholderFeedback.slice(0, 45)}`
  } else if (e2eFailed || e2eSimulation) {
    rootCauseCategory = e2eFailed ? 'TECH_DEFECT' : 'BUSINESS_ASSUMPTION'
    failureSummary = e2eFailed
      ? `Fallo en pruebas automatizadas de integración E2E (${state.e2eEvidences?.traceLog?.slice(-1)[0] || 'Aserciones fallidas'})`
      : 'Integración E2E completada como simulación sin confirmación observable en vivo de criterios de negocio.'
    detail = `Trazabilidad E2E: ${(state.e2eEvidences?.traceLog || []).slice(-3).join(' ➔ ') || 'Sin traza'}`
    remedyRecommendation = 'Implementar comprobaciones observables en vivo contra los criterios de aceptación en entorno de ejecución.'
    remedyTitle = 'Remediación de integración E2E y criterios observables'
  } else {
    rootCauseCategory = 'BUSINESS_ASSUMPTION'
    failureSummary = 'La entrega no cumplió las expectativas de negocio validadas en la auditoría formal.'
    detail = 'Se requiere revisión de los casos de uso y criterios de aceptación definidos en Fase 0.'
    remedyRecommendation = 'Revisar y re-especificar los casos de uso para la siguiente iteración de desarrollo.'
    remedyTitle = 'Re-especificación de casos de uso tras auditoría'
  }

  return {
    failureSummary,
    rootCauseCategory,
    detail,
    remedyRecommendation,
    newBacklogItem: {
      id: `BL-REMEDY-${Date.now()}`,
      title: remedyTitle,
      spec: `Remediación basada en evidencias: ${failureSummary}. ${detail}`,
      priority: 1,
      acceptanceCriteria: `Given el fallo identificado [${failureSummary.slice(0, 80)}], When se implemente la corrección, Then debe verificarse con evidencias observables y superar la auditoría de negocio.`,
    },
  }
}

/**
 * Identifica el componente objetivo sobre el que se debe aplicar la remediación
 * analizando el feedback del usuario, las rutas de archivos mencionadas, las pruebas fallidas y la deuda técnica.
 */
export function identifyTargetComponentForRemediation(
  state: SDLCStateType,
  stakeholderFeedback: string,
): string | null {
  const graph = state.componentsGraph || {}
  const compIds = Object.keys(graph)
  if (compIds.length === 0) return null

  const lowerFeedback = (stakeholderFeedback || '').toLowerCase()

  // 1. Si el feedback menciona explícitamente un component ID
  for (const id of compIds) {
    if (lowerFeedback.includes(id.toLowerCase())) {
      return id
    }
  }

  // 2. Si el feedback menciona el nombre del componente
  for (const comp of Object.values(graph)) {
    if (comp.name && lowerFeedback.includes(comp.name.toLowerCase())) {
      return comp.id
    }
  }

  // 3. Si el feedback o la deuda técnica mencionan una ruta o nombre de archivo de algún componente
  const allTextsToSearch = [
    lowerFeedback,
    ...(state.technicalDebtList || []).map((d) => (d.description || '').toLowerCase()),
    ...(state.e2eEvidences?.traceLog || []).map((t) => t.toLowerCase()),
  ].join(' ')

  for (const comp of Object.values(graph)) {
    const allFiles = [
      comp.targetPath,
      ...(comp.targetPaths || []),
      ...(comp.files?.map((f) => f.path) || []),
    ].filter(Boolean) as string[]

    for (const f of allFiles) {
      const basename = f.split('/').pop()?.toLowerCase()
      if (
        allTextsToSearch.includes(f.toLowerCase()) ||
        (basename && basename.length > 3 && allTextsToSearch.includes(basename))
      ) {
        return comp.id
      }
    }
  }

  // 4. Si hay algún componente con estado FAILED en graph o en unitEvidences
  const failedUnitId = Object.entries(state.unitEvidences || {}).find(([_, ev]) => ev && !ev.exito)?.[0]
  if (failedUnitId && graph[failedUnitId]) return failedUnitId

  const failedCompId = Object.values(graph).find((c) => c.status === 'FAILED')?.id
  if (failedCompId) return failedCompId

  // 5. Si hay deuda técnica de compilación que especifique componente
  const compDebt = state.technicalDebtList?.find((d) => d.id === 'td-compilation-failure')
  if (compDebt?.componentId && graph[compDebt.componentId]) {
    return compDebt.componentId
  }

  // 6. Por defecto: el componente de interfaz/visual, o el último componente construido en el DAG
  const uiComp = Object.values(graph).find((c) =>
    /\b(ui|view|visual|pwa|frontend|interfaz|client|engine)\b/i.test(`${c.id} ${c.name} ${c.description}`),
  )
  if (uiComp) return uiComp.id

  return compIds[compIds.length - 1]
}

/**
 * NODO 5: Bucle de Resiliencia Estratégica (RCA -> Re-especificación -> Backlog)
 * Deriva el resultado de evidencias existentes (no de textos o diagnósticos prefijados).
 */
export async function node_phase5_resilience(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Activando bucle de resiliencia: derivando RCA de evidencias existentes...')
  const engram = await getPersistentEngram()

  // Derivar diagnóstico RCA real a partir de las evidencias acumuladas
  const derivedRca = deriveRcaFromEvidence(state)

  const stakeholderFeedback =
    state.businessApproval?.stakeholderComments?.trim() ||
    [...state.messages].reverse().find((m) => m.role === 'user')?.content?.trim() ||
    ''

  // Identificar el componente a corregir en Fase 3
  let targetCompId = identifyTargetComponentForRemediation(state, stakeholderFeedback)
  const updatedGraph = { ...state.componentsGraph }
  const updatedUnitEvidences = { ...state.unitEvidences }

  if (targetCompId && updatedGraph[targetCompId]) {
    updatedGraph[targetCompId] = {
      ...updatedGraph[targetCompId],
      status: 'READY',
      description: `${updatedGraph[targetCompId].description} [Remediación solicitada por RCA: ${derivedRca.failureSummary}]`,
    }
    delete updatedUnitEvidences[targetCompId]

    // Bloquear componentes dependientes para que se re-evalúen en el DAG
    for (const other of Object.values(updatedGraph)) {
      if (other.dependsOn?.includes(targetCompId) && other.status === 'VERIFIED') {
        other.status = 'BLOCKED'
        delete updatedUnitEvidences[other.id]
      }
    }
  } else if (!targetCompId && Object.keys(updatedGraph).length > 0) {
    const remedyId = `comp_remedy_${Date.now().toString(36)}`
    updatedGraph[remedyId] = {
      id: remedyId,
      name: derivedRca.newBacklogItem?.title || 'Remediación de Defectos',
      description: derivedRca.remedyRecommendation || 'Corregir defectos de compilación y validar en pruebas.',
      dependsOn: [],
      status: 'READY',
      targetPath: 'src/components/remedy.ts',
    }
    targetCompId = remedyId
  }

  const resolvedSkill = RuntimeSkillLoader.resolveContext({
    ...state,
    activeSkill: 'RootCause_Analyzer',
  })

  const fallbackResilience = () => ({
    content:
      `### 🔄 Fase 5: Bucle de Resiliencia Estratégica (RCA)\n\n` +
      `Se ha analizado la evidencia acumulada tras el dictamen de negocio y las pruebas:\n\n` +
      `* **Diagnóstico RCA Derivado:** ${derivedRca.failureSummary}\n` +
      `* **Causa Raíz:** \`${derivedRca.rootCauseCategory}\` — ${derivedRca.detail}\n` +
      `* **Acción Correctiva:** ${derivedRca.remedyRecommendation}\n` +
      `* **Nuevo Ítem de Backlog:** \`${derivedRca.newBacklogItem?.title}\`\n\n` +
      `> 🔁 **Realimentación:** El ciclo retorna a la Fase 1 para re-planificar el sprint con las nuevas especificaciones derivadas de la evidencia.`,
    thought: `Analizando causa raíz a partir de evidencias reales... Categoría: ${derivedRca.rootCauseCategory}`,
  })

  const llmResilience = await streamLlmPhase({
    sessionId: state.sessionId,
    phaseName: `Fase 5: Análisis de Causa Raíz (RCA) — [Skill: ${resolvedSkill.skill.name}]`,
    sdlcPhase: '5_STRATEGIC_RESILIENCE',
    systemPrompt: `${resolvedSkill.systemPrompt}\n\nEres el Analista de Causa Raíz (RCA) de LocalLoop. Tu función es diagnosticar las razones exactas del rechazo o fallo analizando estrictamente las evidencias existentes del proyecto, sin inventar causas ni usar textos prefijados.`,
    userPrompt: `Evidencias existentes:
- Resumen de fallo derivado: ${derivedRca.failureSummary}
- Categoría causa raíz: ${derivedRca.rootCauseCategory}
- Detalle de evidencia: ${derivedRca.detail}
- Acción correctiva propuesta: ${derivedRca.remedyRecommendation}
- Nuevo ítem backlog: ${derivedRca.newBacklogItem?.title}

Redacta el informe formal de RCA en Markdown explicando la causa raíz derivada de las evidencias y la acción correctiva.`,
    tools: resolvedSkill.tools,
    defaultFallback: fallbackResilience,
  })

  const resilienceMsg = {
    role: 'assistant' as const,
    content: llmResilience.content,
    thought: llmResilience.thought,
  }

  await engram.save({
    title: 'Informe de Análisis de Causa Raíz (RCA)',
    type: 'strategic_resilience',
    project: 'localloop',
    tags: ['strategic_resilience', 'rca_findings', 'backlog'],
    records: [
      {
        title: 'rca_diagnosis',
        content: JSON.stringify(derivedRca, null, 2),
      },
    ],
  })

  // Inyectar el nuevo ítem al plan de proyecto
  const updatedBacklog = [
    ...(state.projectPlan?.backlog || []),
    {
      id: derivedRca.newBacklogItem!.id,
      title: derivedRca.newBacklogItem!.title,
      priority: derivedRca.newBacklogItem!.priority,
      status: 'PLANNED_REMEDY',
    },
  ]

  const progressEvent: ProjectProgressEvent = {
    id: `EV-RESILIENCE-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'BACKLOG_UPDATED',
    evidenceSummary: `Nueva historia de remediación agregada al backlog tras RCA: ${derivedRca.newBacklogItem!.title}`,
  }

  await emitSDLCProgress(
    state.sessionId,
    resilienceMsg,
    'Ejecutando bucle de resiliencia RCA con evidencias reales...',
    '5_STRATEGIC_RESILIENCE',
  )

  if (state.sessionId) {
    try {
      await saveSdlcPhaseArtifact({
        sessionId: state.sessionId,
        phaseName: '5_STRATEGIC_RESILIENCE',
        artifactTitle: 'Diagnóstico RCA y Realimentación de Resiliencia',
        artifactType: 'strategic_resilience',
        payload: {
          rcaDiagnosis: derivedRca,
          newBacklogItem: derivedRca.newBacklogItem,
        },
        tags: ['resilience', 'rca', derivedRca.rootCauseCategory.toLowerCase()],
      })
    } catch {
      // ignore
    }
  }

  return {
    rcaDiagnosis: derivedRca,
    projectPlan: {
      milestones: state.projectPlan?.milestones || [],
      backlog: updatedBacklog,
    },
    componentsGraph: updatedGraph,
    unitEvidences: updatedUnitEvidences,
    businessApproval: null, // Resetear la aprobación pendiente para que no se auto-rechace en la siguiente iteración
    e2eEvidences: null,
    progressEvents: [...state.progressEvents, progressEvent],
    messages: [...state.messages, resilienceMsg],
    currentPhase: targetCompId ? '3_COMPONENT_CONSTRUCTION' : '1_STRATEGY_AND_PLAN',
    activeComponentId: targetCompId,
    activeSkill: targetCompId ? 'Component_Implementer' : 'GovernanceProject_Planner',
  }
}
