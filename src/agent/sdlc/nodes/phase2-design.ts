import { trace } from '../../../diagnostics'
import { saveSdlcPhaseArtifact } from '../../../memory/engram-memory'
import { hasLoadedWebGuidanceDocs } from '../../../memory/web-guidance-manager'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import type {
  GatekeeperDecision,
  SDLCStateType,
  TechnicalDebtRecord,
  TechnicalDesignProposal,
} from '../../sdlc-state'
import { streamLlmPhase } from '../execution/llm-phase-streamer'
import { emitSDLCProgress } from '../execution/progress-emitter'
import { generateComponentDesign } from '../codegen/component-design'

/**
 * NODO 2.1: Diseño Técnico por Componente
 * Propone alternativas técnicas y contratos de interfaces.
 */
export async function node_phase2_technical_design(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  const compId = state.activeComponentId!
  const comp = state.componentsGraph[compId]
  trace(`[SDLCGraph] Elaborando opciones de diseño técnico para ${compId}...`)

  const design = generateComponentDesign(comp, state.marketArchStandard)
  let proposals: TechnicalDesignProposal[] = [
    {
      componentId: compId,
      approachName: design.approachName,
      isChosen: true,
      description: design.description,
      contracts: design.contracts,
      dependencies: comp.dependsOn || [],
      tradeOffAnalysis: design.tradeOffAnalysis,
    },
  ]

  if (hasLoadedWebGuidanceDocs()) {
    const resolvedSkill = RuntimeSkillLoader.resolveContext({
      ...state,
      activeSkill: 'ComponentTechnical_Designer',
    })
    const llmDesign = await streamLlmPhase({
      sessionId: state.sessionId,
      phaseName: `Fase 2.1: Diseño Técnico — ${compId} [Skill: ${resolvedSkill.skill.name}]`,
      sdlcPhase: '2_TECHNICAL_DESIGN_GATE',
      systemPrompt: `${resolvedSkill.systemPrompt}\n\nIMPORTANTE: El usuario YA aprobó el alcance y el grafo en la Fase 1. Esta fase es 100% autónoma: selecciona directamente el diseño óptimo y sus contratos TypeScript SIN hacer preguntas al usuario ni pedir confirmación.`,
      userPrompt: `Componente: ${comp.name} (${compId})\nDescripción: ${comp.description}\nEstándar: ${state.marketArchStandard}\nDefine el diseño técnico definitivo y sus contratos TypeScript consultando search_web_guidance y read_web_guidance_doc si aplica.`,
      tools: resolvedSkill.tools,
      maxToolIterations: 3,
      defaultFallback: () => ({
        content: design.description,
        thought: `Diseñando contratos técnicos para ${comp.name}...`,
      }),
    })
    const proposeCall = llmDesign.toolCalls.find((tc) => tc.name === 'propose_design_options')
    if (proposeCall && Array.isArray(proposeCall.args.approaches) && proposeCall.args.approaches.length > 0) {
      const firstApproach = proposeCall.args.approaches[0] as Record<string, unknown>
      proposals = [
        {
          componentId: compId,
          approachName: String(firstApproach.approachName || design.approachName),
          isChosen: true,
          description: String(firstApproach.description || design.description),
          contracts: design.contracts,
          dependencies: comp.dependsOn || [],
          tradeOffAnalysis: String(firstApproach.tradeOffs || design.tradeOffAnalysis),
        },
      ]
    }
  }

  const updatedDesigns = { ...state.technicalDesigns, [compId]: proposals }

  if (state.sessionId) {
    try {
      await saveSdlcPhaseArtifact({
        sessionId: state.sessionId,
        phaseName: '2_TECHNICAL_DESIGN',
        artifactTitle: `Diseño Técnico de ${comp.name} (${compId})`,
        artifactType: 'technical_design',
        payload: {
          componentId: compId,
          proposals,
        },
        tags: [`comp:${compId}`, 'architecture_design'],
      })
    } catch {
      // ignore
    }
  }

  return {
    technicalDesigns: updatedDesigns,
    activeSkill: 'EnterpriseArch_Gatekeeper',
  }
}

/**
 * NODO 2.2: Gatekeeper de Arquitectura Empresarial
 * Evalúa opciones, decide trade-offs y sincroniza deuda técnica si aplica.
 */
export async function node_phase2_gatekeeper(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  const compId = state.activeComponentId!
  const comp = state.componentsGraph[compId]
  trace(`[SDLCGraph] Evaluando diseño técnico de ${compId} en el Gatekeeper de Arquitectura...`)

  const proposals = state.technicalDesigns[compId] || []
  const chosenProposal = proposals[0] || generateComponentDesign(comp, state.marketArchStandard)

  const isTransition =
    comp.targetState === 'TRANSITION' ||
    comp.id.includes('adapter') ||
    comp.name.toLowerCase().includes('adapter') ||
    comp.name.toLowerCase().includes('transic')

  let debtRecord: TechnicalDebtRecord | undefined
  if (isTransition) {
    debtRecord = {
      id: `DEBT-${compId.toUpperCase()}`,
      componentId: compId,
      title: `Deuda Técnica Transicional de Convivencia: ${comp.name}`,
      description: `Fachada temporal de adaptación. Introduce acoplamiento con la interfaz del sistema legado para evitar un despliegue Big-Bang.`,
      riskLevel: 'MEDIO',
      mitigationPlan: `Desviar el 100% de las transacciones al nuevo módulo core y desmantelar ${compId} al finalizar la transición.`,
      syncedToMcp: Boolean(state.mcpServerConfig?.connected),
      createdAt: new Date().toISOString(),
    }
  }

  const compGraph = { ...state.componentsGraph }
  const decision: GatekeeperDecision = {
    componentId: compId,
    status: isTransition ? 'APPROVED_WITH_DEBT' : 'APPROVED',
    chosenApproachName: chosenProposal.approachName,
    feedback: isTransition
      ? 'Aprobado con registro formal de deuda técnica debido al estadio intermedio de transición.'
      : `Diseño conforme a los estándares de arquitectura empresarial (${state.marketArchStandard}).`,
    debtRecord,
  }

  compGraph[compId].status = 'DESIGN_APPROVED'

  const resolvedSkill = RuntimeSkillLoader.resolveContext({
    ...state,
    activeSkill: 'EnterpriseArch_Gatekeeper',
  })

  const llmGatekeeper = await streamLlmPhase({
    sessionId: state.sessionId,
    phaseName: `Fase 2: Dictamen Gatekeeper — ${compId} [Skill: ${resolvedSkill.skill.name}]`,
    sdlcPhase: '2_TECHNICAL_DESIGN_GATE',
    systemPrompt: `${resolvedSkill.systemPrompt}\n\nEres el Gatekeeper de Arquitectura Empresarial de LocalLoop. Tu función es auditar el diseño técnico del componente frente a los estándares de arquitectura (${state.marketArchStandard}) en base al alcance ya aprobado por el usuario en Fase 1.\nIMPORTANTE: Esta es una validación técnica interna del flujo de construcción; NO plantees preguntas abiertas al usuario ni solicites una respuesta humana adicional en esta fase.`,
    userPrompt: `Componente: ${comp.name} (\`${compId}\`)
Propuesta Técnica: ${chosenProposal.approachName}
Descripción: ${chosenProposal.description}
Estado Objetivo: ${comp.targetState === 'TRANSITION' ? 'TRANSITION' : 'DESIRED'}
Estándar: ${state.marketArchStandard}
¿Es componente transicional de convivencia?: ${isTransition ? 'SÍ (Generar Deuda Técnica)' : 'NO'}

Genera el informe técnico y dictamen de pase a construcción del Gatekeeper en Markdown conciso, sin solicitar intervención del usuario.`,
    tools: resolvedSkill.tools,
    defaultFallback: () => ({
      content:
        `### 📐 Fase 2: Diseño Técnico & Gatekeeper — \`${compId}\`\n\n` +
        `#### 1. Especificación de Diseño Arquitectónico\n` +
        `* **Componente:** ${comp.name} (\`${compId}\`)\n` +
        `* **Enfoque Técnico:** ${chosenProposal.approachName}\n` +
        `* **Estado Objetivo:** ${comp.targetState === 'TRANSITION' ? 'Transición (Estadio Intermedio)' : 'Deseado (To-Be)'}\n` +
        `* **Contratos de Interfaz Tipados:**\n\`\`\`typescript\n${chosenProposal.contracts.map((c) => c.schema).join('\n\n')}\n\`\`\`\n` +
        `* **Análisis de Trade-offs:** ${chosenProposal.tradeOffAnalysis}\n\n` +
        `#### 2. Dictamen del Gatekeeper de Arquitectura Empresarial\n` +
        `* **Estado:** ${isTransition ? '⚠️ **APROBADO CON REGISTRO DE DEUDA TÉCNICA**' : '✅ **APROBADO CONFORME A ESTÁNDAR**'}\n` +
        `* **Evaluación:** ${decision.feedback}\n` +
        (debtRecord
          ? `* **Deuda Técnica Documentada en Plan:**\n  - **ID:** \`${debtRecord.id}\` | **Riesgo:** \`${debtRecord.riskLevel}\`\n  - **Plan de Mitigación:** ${debtRecord.mitigationPlan}\n  - **Sincronización:** ${debtRecord.syncedToMcp ? 'Sincronizado vía MCP de Arquitectura Empresarial.' : 'Registrado en memoria episódica Engram.'}\n`
          : '* **Deuda Técnica:** 0 ítems registrados.\n') +
        `\n> 🚀 **Pase a Construcción:** Autorizado para implementación de código fuente y pruebas unitarias.`,
      thought: `Evaluando diseño técnico y registro de deuda técnica para ${comp.name}...`,
    }),
  })

  const gatekeeperMsg = {
    role: 'assistant' as const,
    content: llmGatekeeper.content,
    thought: llmGatekeeper.thought,
  }

  await emitSDLCProgress(
    state.sessionId,
    gatekeeperMsg,
    `Aprobado diseño de ${compId} en Gatekeeper`,
    '2_TECHNICAL_DESIGN_GATE',
    llmGatekeeper.tokenUsage,
    `Fase 2: Dictamen Gatekeeper (${compId})`,
  )

  if (state.sessionId) {
    try {
      await saveSdlcPhaseArtifact({
        sessionId: state.sessionId,
        phaseName: '2_GATEKEEPER',
        artifactTitle: `Dictamen Gatekeeper: ${comp.name} (${compId})`,
        artifactType: 'gatekeeper_decision',
        payload: {
          componentId: compId,
          decision,
          debtRecord,
        },
        tags: [`comp:${compId}`, 'gatekeeper_audit'],
      })
    } catch {
      // ignore
    }
  }

  return {
    componentsGraph: compGraph,
    gatekeeperDecisions: { ...state.gatekeeperDecisions, [compId]: decision },
    technicalDebtList: debtRecord ? [...state.technicalDebtList, debtRecord] : state.technicalDebtList,
    activeSkill: 'Component_Implementer',
    currentPhase: '3_COMPONENT_CONSTRUCTION',
    messages: [...state.messages, gatekeeperMsg],
  }
}