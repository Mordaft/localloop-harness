import { trace } from '../../../diagnostics'
import { getPersistentEngram, saveSdlcPhaseArtifact } from '../../../memory/engram-memory'
import type { ProjectProgressEvent, RcaDiagnosis, SDLCStateType } from '../../sdlc-state'
import { emitSDLCProgress } from '../execution/progress-emitter'

/**
 * NODO 5: Bucle de Resiliencia Estratégica (RCA -> Re-especificación -> Backlog)
 */
export async function node_phase5_resilience(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Activando bucle de resiliencia: RCA y realimentación del Backlog...')
  const engram = await getPersistentEngram()

  const rca: RcaDiagnosis = {
    failureSummary: 'La funcionalidad no alcanzó el objetivo de negocio esperado por los stakeholders.',
    rootCauseCategory: 'BUSINESS_ASSUMPTION',
    detail: 'Se requiere una regla de negocio adicional y refinamiento en el flujo alternativo.',
    remedyRecommendation: 'Re-especificar el caso de uso e incorporarlo como nueva iteración en el backlog.',
    newBacklogItem: {
      id: `BL-REMEDY-${Date.now()}`,
      title: 'Refinamiento de Reglas de Negocio Post-RCA',
      spec: 'Nueva especificación funcional acordada conjuntamente entre Negocio y Arquitectura.',
      priority: 1,
      acceptanceCriteria: 'Given nuevas reglas, When se ejecute el caso, Then resultado óptimo.',
    },
  }

  await engram.save({
    title: 'Informe de Análisis de Causa Raíz (RCA)',
    type: 'strategic_resilience',
    project: 'localloop',
    tags: ['strategic_resilience', 'rca_findings', 'backlog'],
    records: [
      {
        title: 'rca_diagnosis',
        content: JSON.stringify(rca, null, 2),
      },
    ],
  })

  // Inyectar el nuevo ítem al plan de proyecto
  const updatedBacklog = [
    ...(state.projectPlan?.backlog || []),
    {
      id: rca.newBacklogItem!.id,
      title: rca.newBacklogItem!.title,
      priority: rca.newBacklogItem!.priority,
      status: 'PLANNED_REMEDY',
    },
  ]

  const progressEvent: ProjectProgressEvent = {
    id: `EV-RESILIENCE-${Date.now()}`,
    timestamp: new Date().toISOString(),
    type: 'BACKLOG_UPDATED',
    evidenceSummary: `Nueva historia de remediación agregada al backlog tras RCA: ${rca.newBacklogItem!.title}`,
  }

  const resilienceMsg = {
    role: 'assistant' as const,
    content:
      `### 🔄 Fase 5: Bucle de Resiliencia Estratégica (RCA)\n\n` +
      `Negocio ha indicado ajustes necesarios. Se ha iniciado el proceso de Resiliencia y Análisis de Causa Raíz:\n\n` +
      `* **Diagnóstico RCA:** ${rca.failureSummary}\n` +
      `* **Causa Raíz:** \`${rca.rootCauseCategory}\` — ${rca.detail}\n` +
      `* **Acción Correctiva:** ${rca.remedyRecommendation}\n` +
      `* **Nuevo Ítem de Backlog:** \`${rca.newBacklogItem?.title}\`\n\n` +
      `> 🔁 **Realimentación:** El ciclo retorna a la Fase 1 para re-planificar el sprint con las nuevas especificaciones.`,
  }

  await emitSDLCProgress(
    state.sessionId,
    resilienceMsg,
    'Ejecutando bucle de resiliencia RCA...',
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
          rcaDiagnosis: rca,
          newBacklogItem: rca.newBacklogItem,
        },
        tags: ['resilience', 'rca'],
      })
    } catch {
      // ignore
    }
  }

  return {
    rcaDiagnosis: rca,
    projectPlan: {
      milestones: state.projectPlan?.milestones || [],
      backlog: updatedBacklog,
    },
    progressEvents: [...state.progressEvents, progressEvent],
    messages: [...state.messages, resilienceMsg],
    currentPhase: '1_STRATEGY_AND_PLAN', // Realimenta el plan de la Fase 1
  }
}