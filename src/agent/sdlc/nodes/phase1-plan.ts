import { trace } from '../../../diagnostics'
import { getSessionCallbacks } from '../../agent-graph'
import { getPersistentEngram, saveSdlcPhaseArtifact } from '../../../memory/engram-memory'
import { SessionStatus } from '../../../enums'
import { updateSessionMetrics } from '../../../memory/app-db'
import { generateMermaidDag } from '../../../mermaid'
import { RuntimeSkillLoader } from '../../skills/runtime-loader'
import type {
  ComponentNode,
  GatekeeperDecision,
  ProjectFrameworkConfig,
  SDLCStateType,
  TechnicalDebtRecord,
  TechnicalDesignProposal,
  UniversalProjectScaffold,
} from '../../sdlc-state'
import { streamLlmPhase } from '../execution/llm-phase-streamer'
import { emitSDLCProgress } from '../execution/progress-emitter'
import { generateComponentDesign } from '../codegen/component-design'
import {
  buildUniversalScaffold,
  materializeUniversalScaffold,
} from '../scaffold/scaffold-engine'

/**
 * NODO 1: Estrategia, Fundamentos & Planificación con Dependencias Fin-Inicio
 * Mapea la necesidad con componentes y genera el DAG con dependencias estrictas.
 */
export async function node_phase1_strategy_and_plan(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Generando el Grafo de Dependencias Fin-Inicio (DAG)...')
  const engram = await getPersistentEngram()

  // Generamos o actualizamos los componentes con sus dependencias Fin-Inicio (dependsOn)
  const existingComps = state.componentsGraph || {}
  const componentsGraph: Record<string, ComponentNode> = { ...existingComps }

  if (Object.keys(componentsGraph).length === 0) {
    if (state.phase0Data?.step3?.featureComponentMappings && state.phase0Data.step3.featureComponentMappings.length > 0) {
      for (const comp of state.phase0Data.step3.featureComponentMappings) {
        const rawDeps = Array.isArray(comp.dependsOn)
          ? comp.dependsOn
          : typeof comp.dependsOn === 'string'
            ? (comp.dependsOn as string).split(',')
            : []
        const cleanDeps = rawDeps
          .map((d: string) => String(d).trim().replace(/^[`'"]+|[`'"]+$/g, ''))
          .filter(Boolean)

        componentsGraph[comp.componentId] = {
          id: comp.componentId,
          name: comp.name,
          description: comp.description,
          targetState: comp.targetState,
          dependsOn: cleanDeps,
          status: cleanDeps.length > 0 ? 'BLOCKED' : 'READY',
        }
      }
    } else {
      // Ejemplo de descomposición canónica: Core -> Service -> UI/Integration
      componentsGraph['comp_core'] = {
        id: 'comp_core',
        name: 'Módulo Core / Dominio',
        description: 'Entidades y contratos centrales de negocio.',
        targetState: 'DESIRED',
        dependsOn: [], // Raíz: no depende de nadie
        status: 'READY',
      }
      componentsGraph['comp_service'] = {
        id: 'comp_service',
        name: 'Servicio de Aplicación & Orquestación',
        description: 'Lógica de orquestación de casos de uso.',
        targetState: 'DESIRED',
        dependsOn: ['comp_core'], // Fin-Inicio: solo inicia tras verificar comp_core
        status: 'BLOCKED',
      }
      componentsGraph['comp_integration'] = {
        id: 'comp_integration',
        name: 'Adaptador de Integración / Interfaz',
        description: 'Exposición externa y manejo de eventos.',
        targetState: 'TRANSITION',
        dependsOn: ['comp_service'], // Fin-Inicio: solo inicia tras verificar comp_service
        status: 'BLOCKED',
      }
    }
  }

  const projectPlan = {
    milestones: [
      { id: 'M1', target: 'Definición de Arquitectura & Dependencias', completed: true },
      { id: 'M2', target: 'Ingeniería de Componentes y Tests Unitarios', completed: false },
      { id: 'M3', target: 'Verificación E2E y Aprobación Formal de Negocio', completed: false },
    ],
    backlog: state.projectPlan?.backlog || [
      { id: 'BL-1', title: 'Implementación de Funcionalidad Base', priority: 1, status: 'IN_PROGRESS' },
    ],
  }

  await engram.save({
    title: 'Grafo de Componentes y Dependencias Fin-Inicio',
    type: 'project_planning',
    project: 'localloop',
    tags: ['project_planning', 'wbs', 'dependencies'],
    records: [
      {
        title: 'components_dag',
        content: JSON.stringify(componentsGraph, null, 2),
      },
    ],
  })

  if (state.sessionId) {
    try {
      await saveSdlcPhaseArtifact({
        sessionId: state.sessionId,
        phaseName: '1_STRATEGY_AND_PLAN',
        artifactTitle: 'Grafo de Componentes y Dependencias Fin-Inicio (DAG)',
        artifactType: 'project_planning',
        payload: {
          componentsGraph,
          projectPlan,
        },
        tags: ['wbs', 'dag', 'dependencies'],
      })
    } catch {
      // ignore
    }
  }

  // Elaborar la Propuesta de Solución Técnica inicial por componente (contratos, trade-offs, deuda técnica y modo de construcción)
  const initialTechnicalDesigns: Record<string, TechnicalDesignProposal[]> = {
    ...(state.technicalDesigns || {}),
  }
  const initialGatekeeperDecisions: Record<string, GatekeeperDecision> = {
    ...(state.gatekeeperDecisions || {}),
  }
  const initialDebtList: TechnicalDebtRecord[] = [...(state.technicalDebtList || [])]

  for (const comp of Object.values(componentsGraph)) {
    if (!initialTechnicalDesigns[comp.id] || initialTechnicalDesigns[comp.id].length === 0) {
      const design = generateComponentDesign(comp, state.marketArchStandard)
      initialTechnicalDesigns[comp.id] = [
        {
          componentId: comp.id,
          approachName: design.approachName,
          isChosen: true,
          description: design.description,
          contracts: design.contracts,
          dependencies: comp.dependsOn || [],
          tradeOffAnalysis: design.tradeOffAnalysis,
        },
      ]
    }

    if (!initialGatekeeperDecisions[comp.id]) {
      const isTransition =
        comp.targetState === 'TRANSITION' ||
        comp.id.includes('adapter') ||
        comp.name.toLowerCase().includes('adapter') ||
        comp.name.toLowerCase().includes('transic')
      const chosen = initialTechnicalDesigns[comp.id][0]
      let debtRecord: TechnicalDebtRecord | undefined
      if (isTransition) {
        debtRecord = {
          id: `DEBT-${comp.id.toUpperCase()}`,
          componentId: comp.id,
          title: `Deuda Técnica Transicional de Convivencia: ${comp.name}`,
          description:
            'Fachada temporal de adaptación para convivencia gradual con sistemas existentes.',
          riskLevel: 'MEDIO',
          mitigationPlan: `Desacoplar progresivamente y retirar ${comp.id} al completar la transición.`,
          syncedToMcp: Boolean(state.mcpServerConfig?.connected),
          createdAt: new Date().toISOString(),
        }
        if (!initialDebtList.some((d) => d.id === debtRecord!.id)) {
          initialDebtList.push(debtRecord)
        }
      }
      initialGatekeeperDecisions[comp.id] = {
        componentId: comp.id,
        status: isTransition ? 'APPROVED_WITH_DEBT' : 'APPROVED',
        chosenApproachName: chosen.approachName,
        feedback: isTransition
          ? 'Propuesta técnica con registro de deuda técnica por componente de transición.'
          : `Propuesta técnica alineada con ${state.marketArchStandard}.`,
        debtRecord,
      }
    }
  }

  const compList = Object.values(componentsGraph)
    .map((c) => {
      const prop = initialTechnicalDesigns[c.id]?.[0]
      const contractSummary =
        prop?.contracts
          .map((ct: { name: string; schema: string }) => `\`${ct.name}\``)
          .join(', ') || 'Contrato estándar'
      const requiresDecomp =
        c.dependsOn.length > 0 ||
        c.description.length > 90 ||
        /ui|interfaz|portal|motor|engine|service|orquest/i.test(`${c.name} ${c.description}`)
      const buildStrategy = requiresDecomp
        ? 'Descomposición previa en subtareas verificables (`plan_and_delegate_tasks`)'
        : 'Construcción directa atómica (`fs_write_file` + test unitario)'
      return (
        `* **\`${c.id}\`** (${c.name}): *Estado inicial:* \`${c.status}\` | *Depende de:* ${
          c.dependsOn.length > 0
            ? c.dependsOn.map((d) => `\`${d}\``).join(', ')
            : 'Ninguno (Componente Raíz)'
        }\n` +
        `  > *Responsabilidad:* ${c.description}\n` +
        `  > *Enfoque Técnico y Contratos:* ${prop?.approachName || 'Modular'} (${contractSummary})\n` +
        `  > *Estrategia de Construcción:* ${buildStrategy}`
      )
    })
    .join('\n')

  // Si el marco de referencia y propuesta técnica ya fueron aprobados previamente, avanzamos directamente al bucle de componentes
  if (state.phase1FrameworkAgreed) {
    return {
      componentsGraph,
      projectPlan,
      technicalDesigns: initialTechnicalDesigns,
      gatekeeperDecisions: initialGatekeeperDecisions,
      technicalDebtList: initialDebtList,
      currentPhase: '2_TECHNICAL_DESIGN_GATE',
    }
  }

  const contractsMarkdown = Object.values(componentsGraph)
    .map((c) => {
      const prop = initialTechnicalDesigns[c.id]?.[0]
      const schemas = prop?.contracts.map((ct: { name: string; schema: string }) => ct.schema).join('\n\n') || ''
      return `##### Componente \`${c.id}\` (${c.name})\n* **Enfoque:** ${prop?.approachName}\n* **Trade-offs:** ${prop?.tradeOffAnalysis}\n\`\`\`typescript\n${schemas}\n\`\`\``
    })
    .join('\n\n')

  const initiativeTitle =
    state.phase0Data?.step1?.featureTitle ||
    state.useCases?.[0]?.title ||
    'Desarrollo de Funcionalidad Empresarial'
  const initiativeNarrative =
    state.phase0Data?.step1?.rawBusinessLanguageText ||
    state.useCases?.[0]?.expectedBusinessOutcome ||
    'Especificación funcional capturada en Fase 0.'
  const capturedNeedsMd =
    state.phase0Data?.step1?.needsList && state.phase0Data.step1.needsList.length > 0
      ? state.phase0Data.step1.needsList
          .map((n) => `  - **${n.id}:** ${n.description} *(Impacto: ${n.expectedImpact || 'Directo'})*`)
          .join('\n')
      : state.useCases
          .map((u) => `  - **${u.id} (${u.title}):** ${u.expectedBusinessOutcome}`)
          .join('\n')

  const fallbackPlan = () => {
    let presetTitle = 'Arquitectura Propuesta'
    let presetManifests = 'Manifiestos del proyecto'
    try {
      const probe = buildUniversalScaffold({
        initiativeTitle,
        userText: initiativeNarrative,
        contextInitiative: initiativeTitle,
      })
      presetTitle = probe.frameworkTitle
      presetManifests = probe.manifestFiles.map((m) => `\`${m.path}\``).join(', ')
    } catch {
      // Si no hay propuesta ni preset, se refleja en el informe
    }

    return {
      content:
        `### 📋 Fase 1: Evaluación de Requerimientos y Propuesta de Solución Técnica (DAG Fin-Inicio)\n\n` +
        `He procesado tu definición de la **Fase 0** para **${initiativeTitle}** y he diseñado la **Propuesta de Solución Técnica** que servirá de base para el bucle iterativo de construcción:\n\n` +
        `#### 0. Síntesis de tu Definición y Requerimientos Capturados (Fase 0)\n` +
        `* **Iniciativa:** ${initiativeTitle}\n` +
        `* **Narrativa / Objetivo:** ${initiativeNarrative}\n` +
        `* **Requerimientos de Negocio Incorporados:**\n${capturedNeedsMd}\n\n` +
        `#### 1. Plan de Hitos de Negocio (WBS)\n` +
        `* **Hito 1 (Diseño de Solución Técnica & Contratos):** Modelado de contratos de interfaz y arquitectura limpia conforme a \`${state.marketArchStandard}\`.\n` +
        `* **Hito 2 (Bucle Iterativo de Construcción de Componentes):** Construcción por componente (directa o mediante descomposición previa en subtareas) y validación unitaria en Sandbox.\n` +
        `* **Hito 3 (Transición & Auditoría E2E):** Convivencia con sistemas existentes, verificación E2E y auditoría de resultados de negocio.\n\n` +
        `#### 2. Diseño de Componentes, Estrategia de Construcción y Dependencias Fin-Inicio (DAG)\n` +
        `${compList}\n\n` +
        `#### 3. Topología Visual del Grafo (Diagrama Mermaid)\n` +
        `${generateMermaidDag(componentsGraph)}\n\n` +
        `#### 4. Contratos Técnicos Base Propuestos\n` +
        `${contractsMarkdown}\n\n` +
        `#### 5. Marco de Referencia del Desarrollo y Estructura Propuesta\n` +
        `Para enmarcar el desarrollo propongo el siguiente marco de trabajo estándar:\n` +
        `* **Framework / Stack sugerido:** \`${presetTitle}\`\n` +
        `* **Manifiestos y scripts previstos:** ${presetManifests}\n\n` +
        `💬 **Iteración con el Usuario (Fase 1 - Marco de Referencia y Aprobación de Propuesta Técnica):**\n` +
        `Por favor, revisa esta **Propuesta de Solución Técnica** e indícame en el chat si la apruebas o si deseas ajustar algún componente, contrato o el marco tecnológico.\n` +
        `Con tu aprobación:\n` +
        `1. Generaré los scripts de ciclo de vida (\`setup.cmd\` y \`setup.sh\`) y archivos base en la raíz del workspace.\n` +
        `2. Entraremos en el **bucle autónomo de construcción de componentes** siguiendo el DAG Fin-Inicio sin interrupciones innecesarias hasta completar la solución integrable.\n\n` +
        `> ⚙️ **Pausa de Fase 1 (HITL):** Esperando tu aprobación o ajustes de la propuesta técnica en el chat para formalizar el setup e iniciar el bucle de construcción.`,
      thought:
        'Evaluando requerimientos técnicos junto a los componentes de alto nivel, diseñando contratos de solución técnica y preparando propuesta para aprobación HITL...',
    }
  }

  const resolvedSkill = RuntimeSkillLoader.resolveContext({
    ...state,
    activeSkill: 'GovernanceProject_Planner',
  })

  const llmPlan = await streamLlmPhase({
    sessionId: state.sessionId,
    phaseName: `Fase 1: Propuesta de Solución Técnica y DAG — [Skill: ${resolvedSkill.skill.name}]`,
    sdlcPhase: '1_STRATEGY_AND_PLAN',
    maxToolIterations: 3,
    systemPrompt: `${resolvedSkill.systemPrompt}\n\nEres el Arquitecto de Soluciones Técnicas y Planificador de LocalLoop. Tu misión es evaluar los requerimientos técnicos y funcionales de la Fase 0 junto con la propuesta de componentes de alto nivel y diseñar una Propuesta de Solución Técnica completa que debe ser aprobada por el usuario antes de entrar al bucle iterativo de construcción. Debes proponer el marco de referencia tecnológico, manifiestos base, dependencias y ciclo de vida mediante la herramienta propose_project_scaffold. Si el proyecto involucra tecnologías web (HTML, CSS, DOM, PWA), puedes consultar search_web_guidance y read_web_guidance_doc. Responde en Markdown estructurado y profesional.`,
    userPrompt: `Iniciativa: ${state.phase0Data?.step1?.rawBusinessLanguageText || state.useCases[0]?.title || 'Desarrollo de Software'}
Estándar de Arquitectura: ${state.marketArchStandard}
Necesidades de Negocio y Requerimientos:
${state.phase0Data?.step1?.needsList?.map((n) => `- ${n.id}: ${n.description} (Impacto: ${n.expectedImpact})`).join('\n') || 'Definición de funcionalidades base.'}
Situación Actual As-Is: ${state.phase0Data?.step2?.currentSituation?.title || 'Sistemas legados existentes'}
Situación Deseada To-Be: ${state.phase0Data?.step2?.desiredSituation?.title || 'Arquitectura modular limpia'}
Situación de Transición: ${state.phase0Data?.step2?.transitionSituation?.title || 'No requerida'}
Propuesta de Componentes de Alto Nivel:
${Object.values(componentsGraph).map((c) => `- ${c.name} (${c.id}) [Estado: ${c.targetState || 'DESIRED'} | Depende de: ${c.dependsOn.join(', ') || 'Ninguno'}]: ${c.description}`).join('\n')}

Elabora la Propuesta de Solución Técnica completa para aprobación del usuario incluyendo:
1. Evaluación Técnica de Requerimientos y Plan de Hitos (WBS)
2. Diseño de la Solución Técnica por Componente: contratos/interfaces principales, responsabilidades técnicas, análisis de trade-offs y si cada componente se construirá de forma directa o mediante descomposición previa en subtareas verificables.
3. Grafo de Dependencias Fin-Inicio (DAG) explicando la precedencia de cada componente y representándolo en un bloque Mermaid (\`\`\`mermaid\ngraph TD\n...\`\`\`).
4. Marco de Referencia del Desarrollo y Estructura Propuesta (debes invocar propose_project_scaffold para definir manifiestos, configuraciones y comandos de ciclo de vida).
5. Solicitud explícita de aprobación al usuario (Iteración con el Usuario - Marco de Referencia y Propuesta Técnica) para pasar al bucle iterativo de construcción de componentes.`,
    tools: resolvedSkill.tools,
    defaultFallback: fallbackPlan,
  })

  // Procesar herramientas invocadas por el LLM
  let declaredDependencies: Record<string, string> = { ...(state.declaredDependencies || {}) }
  let declaredDevDependencies: Record<string, string> = { ...(state.declaredDevDependencies || {}) }
  let rawProposedScaffold: Partial<UniversalProjectScaffold> | undefined = undefined

  for (const tc of llmPlan.toolCalls) {
    if (tc.name === 'declare_project_dependencies') {
      if (tc.args.dependencies && typeof tc.args.dependencies === 'object') {
        declaredDependencies = {
          ...declaredDependencies,
          ...(tc.args.dependencies as Record<string, string>),
        }
      }
      if (tc.args.devDependencies && typeof tc.args.devDependencies === 'object') {
        declaredDevDependencies = {
          ...declaredDevDependencies,
          ...(tc.args.devDependencies as Record<string, string>),
        }
      }
    } else if (tc.name === 'propose_project_scaffold') {
      rawProposedScaffold = tc.args as Record<string, any>
    } else if (tc.name === 'create_components_dag' && Array.isArray(tc.args.components)) {
      for (const rawComp of tc.args.components) {
        if (!rawComp || typeof rawComp !== 'object') continue
        const rc = rawComp as Record<string, unknown>
        const cid = String(rc.id || '').trim()
        if (!cid) continue
        const deps = Array.isArray(rc.dependsOn) ? rc.dependsOn.map(String) : []
        componentsGraph[cid] = {
          id: cid,
          name: String(rc.name || componentsGraph[cid]?.name || cid),
          description: String(rc.description || componentsGraph[cid]?.description || ''),
          targetState: componentsGraph[cid]?.targetState || 'DESIRED',
          dependsOn: deps,
          status: deps.length > 0 ? 'BLOCKED' : 'READY',
        }
        if (!initialTechnicalDesigns[cid]) {
          const gen = generateComponentDesign(componentsGraph[cid], state.marketArchStandard)
          initialTechnicalDesigns[cid] = [
            {
              componentId: cid,
              approachName: gen.approachName,
              isChosen: true,
              description: gen.description,
              contracts: gen.contracts,
              dependencies: deps,
              tradeOffAnalysis: gen.tradeOffAnalysis,
            },
          ]
        }
      }
    } else if (tc.name === 'propose_design_options' && Array.isArray(tc.args.approaches)) {
      const targetCompId = String(
        tc.args.componentId || Object.keys(componentsGraph)[0] || '',
      ).trim()
      if (targetCompId && componentsGraph[targetCompId] && tc.args.approaches.length > 0) {
        const firstApp = tc.args.approaches[0] as Record<string, unknown>
        const baseGen = generateComponentDesign(
          componentsGraph[targetCompId],
          state.marketArchStandard,
        )
        initialTechnicalDesigns[targetCompId] = [
          {
            componentId: targetCompId,
            approachName: String(firstApp.approachName || baseGen.approachName),
            isChosen: true,
            description: String(firstApp.description || baseGen.description),
            contracts: baseGen.contracts,
            dependencies: componentsGraph[targetCompId].dependsOn || [],
            tradeOffAnalysis: String(firstApp.tradeOffs || baseGen.tradeOffAnalysis),
          },
        ]
      }
    }
  }

  // Validación e instanciación estricta del scaffolding
  let proposedScaffold: UniversalProjectScaffold | undefined = undefined
  let scaffoldViabilityFailure: string | null = null

  try {
    proposedScaffold = buildUniversalScaffold({
      proposedScaffold: rawProposedScaffold,
      declaredDependencies,
      declaredDevDependencies,
      initiativeTitle,
      userText: initiativeNarrative,
      contextInitiative: initiativeTitle,
    })
  } catch (err) {
    scaffoldViabilityFailure = err instanceof Error ? err.message : String(err)
    trace(`[SDLCGraph] Fallo de viabilidad técnica de scaffolding: ${scaffoldViabilityFailure}`)
  }

  // REGLA FUNDAMENTAL DE GOBERNANZA:
  // Si el LLM no detalló la información necesaria o está offline, ese error invalida completamente
  // la viabilidad del proyecto: se detiene inmediatamente el flujo informando al usuario del problema.
  if (!proposedScaffold) {
    const failureContent =
      `### ❌ Detención Inmediata del SDLC — Viabilidad del Proyecto Invalidada\n\n` +
      `El Arquitecto de Solución Técnica (LLM) no ha podido detallar la propuesta formal de arquitectura y scaffolding para la iniciativa.\n\n` +
      `> 🛑 **Motivo de Invalidación:** ${scaffoldViabilityFailure || 'La herramienta `propose_project_scaffold` no fue invocada con los manifiestos y estructura requeridos.'}\n\n` +
      `**Regla de Integridad de LocalLoop:** Sin una arquitectura y ciclo de vida formalmente especificados por el modelo, **la viabilidad del proyecto queda completamente invalidada**. El flujo se detiene inmediatamente para evitar construir componentes sobre asunciones o marcos no fundamentados.\n\n` +
      `Por favor, verifica la disponibilidad del modelo o reformula los requerimientos funcionales de la iniciativa para reintentar la planificación técnica.`

    const failureMsg = {
      role: 'assistant' as const,
      content: failureContent,
      thought: 'Viabilidad técnica invalidada: no se definió la arquitectura y scaffolding formal requerido.',
    }

    if (state.sessionId) {
      try {
        await updateSessionMetrics(state.sessionId, {
          currentPhase: '1_STRATEGY_AND_PLAN',
          status: SessionStatus.ERROR,
        })
      } catch {
        // ignore
      }
    }

    await emitSDLCProgress(
      state.sessionId,
      failureMsg,
      'Fase 1: Viabilidad Técnica Invalidada (Flujo Detenido)',
      '1_STRATEGY_AND_PLAN',
    )

    return {
      componentsGraph,
      projectPlan,
      technicalDesigns: initialTechnicalDesigns,
      gatekeeperDecisions: initialGatekeeperDecisions,
      technicalDebtList: initialDebtList,
      currentPhase: '1_STRATEGY_AND_PLAN',
      phase1FrameworkAgreed: false,
      projectScaffold: undefined,
      messages: [...state.messages, failureMsg],
    }
  }

  const phase1Msg = {
    role: 'assistant' as const,
    content: llmPlan.content.includes('Pausa de Fase 1') || llmPlan.content.includes('Iteración con el Usuario (Fase 1')
      ? llmPlan.content
      : `${llmPlan.content}\n\n---\n💬 **Iteración con el Usuario (Fase 1 - Marco de Referencia):** Responde en el chat aprobando la propuesta o indicando tus ajustes de arquitectura/framework.\n> ⚙️ **Pausa de Fase 1 (HITL):** Esperando tu confirmación para generar \`setup.cmd\`/\`setup.sh\` e iniciar la construcción.`,
    thought: llmPlan.thought,
  }

  if (state.sessionId) {
    try {
      await updateSessionMetrics(state.sessionId, {
        currentPhase: '1_STRATEGY_AND_PLAN',
        status: SessionStatus.WAITING_APPROVAL,
      })
    } catch {
      // ignore
    }
  }

  await emitSDLCProgress(
    state.sessionId,
    phase1Msg,
    'Propuesta de Solución Técnica y Marco de Referencia (Esperando Aprobación HITL)',
    '1_STRATEGY_AND_PLAN',
  )

  return {
    componentsGraph,
    projectPlan,
    technicalDesigns: initialTechnicalDesigns,
    gatekeeperDecisions: initialGatekeeperDecisions,
    technicalDebtList: initialDebtList,
    currentPhase: '1_STRATEGY_AND_PLAN',
    phase1FrameworkAgreed: false,
    projectScaffold: proposedScaffold,
    declaredDependencies,
    declaredDevDependencies,
    messages: [...state.messages, phase1Msg],
  }
}

/**
 * NODO 1.2: Confirmación del Marco de Referencia y Generación de Scripts de Setup (HITL 1.5)
 * Procesa la respuesta en conversación abierta del usuario, genera setup.cmd / setup.sh y archivos base,
 * e instruye a los agentes de Fase 2 y 3 sobre la ubicación canónica del código.
 */
export async function node_phase1_confirm_framework(state: SDLCStateType): Promise<Partial<SDLCStateType>> {
  trace('[SDLCGraph] Confirmando marco de referencia del desarrollo y generando scripts de setup...')
  const engram = await getPersistentEngram()
  const callbacks = state.sessionId ? getSessionCallbacks(state.sessionId) : undefined

  // Recuperar la última respuesta del usuario en la conversación abierta
  const userMessages = state.messages.filter((m) => m.role === 'user')
  const lastUserText = userMessages[userMessages.length - 1]?.content || ''

  const initiativeTitle =
    state.phase0Data?.step1?.featureTitle ||
    state.useCases?.[0]?.title ||
    'LocalLoop Project'
  const contextInitiative =
    state.phase0Data?.step1?.rawBusinessLanguageText ||
    state.useCases?.[0]?.expectedBusinessOutcome ||
    ''

  let scaffold = state.projectScaffold

  if (lastUserText.trim()) {
    try {
      const userScaffold = buildUniversalScaffold({
        userText: lastUserText,
        contextInitiative,
        initiativeTitle,
        declaredDependencies: state.declaredDependencies,
        declaredDevDependencies: state.declaredDevDependencies,
      })
      if (userScaffold) {
        scaffold = userScaffold
      }
    } catch {
      // Se mantiene state.projectScaffold si no hay un nuevo scaffold propuesto
    }
  }

  if (!scaffold) {
    throw new Error('No existe un scaffolding formal propuesto para el proyecto. Viabilidad invalidada.')
  }

  // 1. Materializar físicamente todos los archivos del scaffold en el workspace
  await materializeUniversalScaffold(scaffold, {
    sessionId: state.sessionId,
    onProposalCreated: callbacks?.onProposalCreated,
  })

  // 3. Registrar frameworkConfig en memoria persistente Engram
  const frameworkConfig: ProjectFrameworkConfig = {
    framework: scaffold.frameworkTitle,
    packageManager: scaffold.packageManager,
    bundler: scaffold.hasUI ? (scaffold.frameworkTitle.includes('Angular') ? 'none' : 'vite') : 'none',
    testRunner: scaffold.testing.unitTestRunner,
    devCommand: scaffold.lifecycle.startCmd,
    buildCommand: scaffold.lifecycle.setupCmd,
    testCommand: scaffold.lifecycle.testCmd,
    projectStructureSummary:
      `- Marco Tecnológico: \`${scaffold.frameworkTitle}\` (Runtime: \`${scaffold.runtime}\`, Arquetipo: \`${scaffold.archetype}\`)\n` +
      `- Directorio de componentes: \`${scaffold.componentDirectory}/\`\n` +
      `- Directorio de servicios: \`${scaffold.serviceDirectory}/\`\n` +
      `- Directorio de tests: \`${scaffold.testDirectory}/\`\n` +
      `- Manifiestos base: ${scaffold.manifestFiles.map((m) => `\`${m.path}\``).join(', ')}\n` +
      `- Scripts de ciclo de vida: \`setup.cmd\`, \`setup.sh\`, \`start.cmd\`, \`start.sh\``,
    setupScriptsGenerated: true,
    setupInstructions: `Para inicializar el proyecto en tu máquina local:
1. Abre tu terminal en la raíz de la carpeta vinculada.
2. En Windows ejecuta: \`setup.cmd\`
3. En Linux/macOS ejecuta: \`chmod +x setup.sh && ./setup.sh\``,
    startScriptsGenerated: false,
    runtime: scaffold.runtime,
    archetype: scaffold.archetype,
    hasUI: scaffold.hasUI,
  }

  await engram.save({
    title: 'Marco de Referencia del Desarrollo y Estructura del Proyecto',
    type: 'project_framework_and_structure',
    project: 'localloop',
    tags: ['framework', 'tech_stack', 'project_structure', 'setup_scripts'],
    records: [
      {
        title: 'framework_config',
        content: JSON.stringify(frameworkConfig, null, 2),
      },
      {
        title: 'project_scaffold',
        content: JSON.stringify(scaffold, null, 2),
      },
    ],
  })

  // 4. Actualizar rutas en el grafo de componentes para guiar a los agentes de Fase 2 y 3
  const updatedComponents: Record<string, ComponentNode> = { ...state.componentsGraph }
  const fileExt = scaffold.fileExtension || 'ts'
  const baseDir = scaffold.componentDirectory || 'src/components'
  const servDir = scaffold.serviceDirectory || baseDir

  for (const compId of Object.keys(updatedComponents)) {
    const comp = updatedComponents[compId]
    const isService = comp.id.includes('service') || comp.name.toLowerCase().includes('servicio')
    const dir = isService ? servDir : baseDir
    comp.targetPath = `${dir}/${comp.id}.${fileExt}`
    comp.targetPaths = [comp.targetPath]
  }

  const userDecisionSummary = lastUserText.trim() || 'Aprobación de la propuesta de solución técnica estándar'

  const fallbackConfirm = () => ({
    content:
      `### 🛠️ Fase 1: Marco de Referencia Formalizado y Setup Inicial\n\n` +
      `He procesado tu respuesta en el paso HITL y he formalizado el marco de desarrollo del proyecto:\n\n` +
      `> 💬 **Tu Respuesta / Directriz Aplicada:** *"${userDecisionSummary}"*\n\n` +
      `* **Marco Tecnológico Acordado:** \`${scaffold.frameworkTitle}\` (Runtime: \`${scaffold.runtime}\`, Arquetipo: \`${scaffold.archetype}\`)\n` +
      `* **Gestor de Paquetes & Herramientas:** ${scaffold.packageManager ? `\`${scaffold.packageManager}\` (Bundler: \`${frameworkConfig.bundler}\`, Tests: \`${scaffold.testing.unitTestRunner}\`)` : `Herramientas nativas de \`${scaffold.runtime}\` (Tests: \`${scaffold.testing.unitTestRunner}\`)`}\n` +
      `* **Estructura Canónica del Proyecto:**\n` +
      `  - Directorio de Componentes: \`${scaffold.componentDirectory}/\`\n` +
      `  - Directorio de Servicios y Lógica: \`${scaffold.serviceDirectory}/\`\n` +
      `  - Directorio de Tests: \`${scaffold.testDirectory}/\`\n` +
      `  - Manifiestos y Configuración: ${scaffold.manifestFiles.map((m) => `\`${m.path}\``).join(', ')}${scaffold.configFiles.length > 0 ? ', ' + scaffold.configFiles.map((c) => `\`${c.path}\``).join(', ') : ''}\n\n` +
      `#### 🚀 Scripts de Setup Generados en la Raíz del Workspace\n` +
      `Se han creado los scripts de inicialización en la raíz de tu proyecto:\n` +
      `* 🪟 **Windows:** \`setup.cmd\`\n` +
      `* 🐧 **Linux / macOS:** \`setup.sh\`\n\n` +
      `**Instrucciones de uso para el usuario:**\n` +
      `1. Abre una terminal en la raíz de tu carpeta de workspace.\n` +
      `2. Ejecuta según tu sistema operativo:\n` +
      `   - En Windows: \`setup.cmd\`\n` +
      `   - En Linux / macOS: \`chmod +x setup.sh && ./setup.sh\`\n` +
      `3. El script creará la estructura de directorios y sincronizará las dependencias necesarias.\n\n` +
      `> 📍 **Alineamiento de Agentes:** Los agentes de las siguientes fases (Fase 2 de Diseño Técnico y Fase 3 de Construcción) ejecutarán el bucle de construcción de forma autónoma respetando tu directriz y las carpetas fijadas.\n\n` +
      `Procediendo con el despacho autónomo de componentes...`,
    thought: 'Formalizando marco de referencia con la respuesta del usuario, generando scripts setup.cmd / setup.sh y sincronizando estructura...',
  })

  const resolvedSkill = RuntimeSkillLoader.resolveContext({
    ...state,
    activeSkill: 'GovernanceProject_Planner',
  })

  const llmConfirm = await streamLlmPhase({
    sessionId: state.sessionId,
    phaseName: `Fase 1: Marco de Referencia — [Skill: ${resolvedSkill.skill.name}]`,
    sdlcPhase: '1_STRATEGY_AND_PLAN',
    systemPrompt: `${resolvedSkill.systemPrompt}\n\nEres el Arquitecto de Software de LocalLoop. Tu función es reflejar explícitamente la respuesta del usuario ("${userDecisionSummary}"), formalizar el marco tecnológico acordado y confirmar la generación de los scripts de setup inicial (setup.cmd y setup.sh) en la raíz del workspace. Si el usuario pidió ajustar componentes en su respuesta, puedes invocar create_components_dag. IMPORTANTE: No hagas nuevas preguntas al usuario; confirma su decisión y da paso a la construcción autónoma.`,
    userPrompt: `Respuesta exacta del usuario en el HITL de Fase 1: "${userDecisionSummary}"
Marco determinado: ${scaffold.frameworkTitle}
Estructura:
${frameworkConfig.projectStructureSummary}
Scripts generados en raíz: setup.cmd, setup.sh, ${scaffold.manifestFiles.map((m) => m.path).join(', ')}.

Genera el informe de formalización reflejando explícitamente la respuesta del usuario, indicándole cómo usar los scripts de setup y confirmando el inicio inmediato de la construcción autónoma.`,
    tools: resolvedSkill.tools,
    defaultFallback: fallbackConfirm,
  })

  // Si el usuario pidió ajustar componentes en su respuesta de Fase 1 y el LLM invocó create_components_dag, aplicamos los cambios
  for (const tc of llmConfirm.toolCalls) {
    if (tc.name === 'create_components_dag' && Array.isArray(tc.args.components)) {
      for (const rawComp of tc.args.components) {
        if (!rawComp || typeof rawComp !== 'object') continue
        const rc = rawComp as Record<string, unknown>
        const cid = String(rc.id || '').trim()
        if (!cid) continue
        const deps = Array.isArray(rc.dependsOn) ? rc.dependsOn.map(String) : []
        const isService = cid.includes('service') || String(rc.name || '').toLowerCase().includes('servicio')
        const dir = isService ? scaffold.serviceDirectory : scaffold.componentDirectory
        const ext = scaffold.fileExtension || fileExt || 'ts'
        updatedComponents[cid] = {
          id: cid,
          name: String(rc.name || updatedComponents[cid]?.name || cid),
          description: String(rc.description || updatedComponents[cid]?.description || ''),
          targetState: updatedComponents[cid]?.targetState || 'DESIRED',
          dependsOn: deps,
          status: deps.length > 0 ? 'BLOCKED' : 'READY',
          targetPath: `${dir}/${cid}.${ext}`,
          targetPaths: [`${dir}/${cid}.${ext}`],
        }
      }
    }
  }

  const finalConfirmContent =
    llmConfirm.content.includes(userDecisionSummary.slice(0, 25)) || !lastUserText.trim()
      ? llmConfirm.content
      : `> 💬 **Respuesta del Usuario Aplicada (HITL Fase 1):** *"${userDecisionSummary}"*\n\n${llmConfirm.content}`

  const confirmMsg = {
    role: 'assistant' as const,
    content: finalConfirmContent,
    thought: llmConfirm.thought,
  }

  await emitSDLCProgress(state.sessionId, confirmMsg, 'Marco de Referencia y Scripts de Setup Formalizados', '1_STRATEGY_AND_PLAN')

  return {
    frameworkConfig,
    projectScaffold: scaffold,
    phase1FrameworkAgreed: true,
    currentPhase: '2_TECHNICAL_DESIGN_GATE',
    componentsGraph: updatedComponents,
    messages: [...state.messages, confirmMsg],
  }
}