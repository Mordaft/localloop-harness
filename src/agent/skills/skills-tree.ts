import type { SkillBranch, SkillDefinition } from './types'

export const SKILL_TREE: SkillBranch[] = [
  {
    id: 'branch_0_discovery',
    name: '0. Descubrimiento & Calibración de Rigor',
    description: 'Establece rigor inicial en casos de uso, aceptación y marco arquitectónico o ingesta MCP.',
    skills: [
      {
        id: 'ProjectRigor_Interviewer',
        branch: 'branch_0_discovery',
        name: 'Entrevistador de Rigor de Proyecto',
        title: 'Calibración de Casos de Uso y Criterios de Aceptación',
        description: 'Detecta lagunas de definición y formula preguntas estructuradas antes de iniciar el diseño.',
        allowedTools: ['ask_discovery_question', 'save_use_cases'],
        resolveEngramFilter: () => ({
          scope: 'project_discovery',
          tags: ['initial_prompt', 'stakeholder_intent'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: ProjectRigor_Interviewer] Eres un líder de producto y arquitectura. Tu objetivo es calibrar el rigor del proyecto. Identifica actores, flujos principales y alternativos, criterios de aceptación BDD (Given-When-Then) y el marco de arquitectura estándar. Si falta información, formula preguntas claras y concisas al usuario.`,
      },
      {
        id: 'EnterpriseArch_MCP_Connector',
        branch: 'branch_0_discovery',
        name: 'Conector de Landscape MCP',
        title: 'Ingesta de Arquitectura Empresarial vía MCP',
        description: 'Conecta mediante SSE/WebSocket a servidores MCP de arquitectura empresarial y sincroniza el catálogo.',
        allowedTools: ['mcp_connect_server', 'mcp_import_landscape'],
        resolveEngramFilter: () => ({
          scope: 'enterprise_landscape',
          tags: ['mcp_services', 'api_catalog', 'c4_model'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: EnterpriseArch_MCP_Connector] Eres un especialista en integración de metadatos de arquitectura. Conecta al endpoint MCP provisto, extrae el landscape de servicios, contratos y componentes, y persiste la información estructurada en Engram.`,
      },
    ],
  },
  {
    id: 'branch_1_strategy',
    name: '1. Estrategia, Fundamentos & Planificación Fin-Inicio',
    description: 'Alinea la visión de negocio con la arquitectura empresarial y genera el DAG de dependencias.',
    skills: [
      {
        id: 'BusinessEnterpriseArch_Alignment',
        branch: 'branch_1_strategy',
        name: 'Alineador de Negocio y Arquitectura',
        title: 'Modelado Conjunto Negocio-Arquitectura',
        description: 'Mapea la necesidad de negocio sobre las capacidades y sistemas de la arquitectura empresarial.',
        allowedTools: ['engram_search', 'map_capabilities_to_components'],
        resolveEngramFilter: () => ({
          scope: 'enterprise_landscape',
          tags: ['capabilities', 'systems', 'business_goals'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: BusinessEnterpriseArch_Alignment] Eres un Enterprise Architect. Mapea la necesidad del negocio con las capacidades de la arquitectura empresarial. Define qué componentes existen, cuáles se modifican y cuáles deben crearse.`,
      },
      {
        id: 'GovernanceProject_Planner',
        branch: 'branch_1_strategy',
        name: 'Planificador de Proyecto y Dependencias',
        title: 'Generador del Grafo de Dependencias Fin-Inicio',
        description: 'Define la estructura de desglose de trabajo y el orden riguroso de dependencias Fin-Inicio.',
        allowedTools: ['create_components_dag', 'set_quality_gates'],
        resolveEngramFilter: () => ({
          scope: 'project_planning',
          tags: ['wbs', 'dependencies', 'risk_matrix'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: GovernanceProject_Planner] Eres un Project Manager técnico. Genera el grafo de dependencias de componentes con relación Fin-Inicio estricta. Determina qué componentes pueden ejecutarse en paralelo y cuáles están bloqueados hasta la verificación del upstream.`,
      },
    ],
  },
  {
    id: 'branch_2_design',
    name: '2. Diseño Técnico y Gatekeeper Arquitectónico',
    description: 'Genera opciones de diseño técnico y audita trade-offs y deuda técnica.',
    skills: [
      {
        id: 'ComponentTechnical_Designer',
        branch: 'branch_2_design',
        name: 'Diseñador Técnico de Componente',
        title: 'Elaboración de Opciones de Diseño Técnico',
        description: 'Propone opciones de diseño técnico, contratos de interfaz y diagramas para un componente específico.',
        allowedTools: ['engram_search', 'search_web_guidance', 'read_web_guidance_doc', 'propose_design_options'],
        resolveEngramFilter: (state) => ({
          scope: `component_${state.activeComponentId ?? 'unknown'}`,
          tags: ['contracts', 'interfaces', 'local_scope'],
        }),
        buildSystemPrompt: (state) =>
          `[SKILL: ComponentTechnical_Designer] Estás diseñando el componente ${state.activeComponentId}. Si el componente involucra HTML, CSS, DOM o APIs del navegador, consulta primero search_web_guidance y read_web_guidance_doc para alinear el diseño con modern-web-guidance. Propón de 1 a 2 opciones de diseño técnico con sus contratos de interfaz y pros/contras.`,
      },
      {
        id: 'EnterpriseArch_Gatekeeper',
        branch: 'branch_2_design',
        name: 'Gatekeeper de Arquitectura Empresarial',
        title: 'Evaluación de Opciones y Registro de Deuda Técnica',
        description: 'Evalúa diseños técnicos frente a estándares. Si acepta un trade-off, tipifica la deuda y la sincroniza al MCP.',
        allowedTools: ['search_web_guidance', 'read_web_guidance_doc', 'approve_design', 'reject_with_redesign', 'register_technical_debt_mcp'],
        resolveEngramFilter: () => ({
          scope: 'enterprise_landscape',
          tags: ['enterprise_standards', 'trade_off_policies'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: EnterpriseArch_Gatekeeper] Eres el guardián de la arquitectura empresarial. Evalúa las opciones de diseño del componente y verifica con search_web_guidance / read_web_guidance_doc el cumplimiento de estándares web modernos cuando aplique. Si apruebas una solución con trade-off, registra formalmente la Deuda Técnica indicando riesgo y plan de amortización futuro.`,
      },
    ],
  },
  {
    id: 'branch_3_engineering',
    name: '3. Ingeniería y Verificación Unitaria',
    description: 'Implementación del código del componente y verificación unitaria aislada.',
    skills: [
      {
        id: 'Component_Implementer',
        branch: 'branch_3_engineering',
        name: 'Implementador de Componente',
        title: 'Construcción Limpia y Tipada de Código',
        description: 'Escribe y modifica el código fuente según el diseño aprobado en el workspace, con soporte multi-fichero (TS, HTML, CSS, JSON).',
        allowedTools: ['fs_read_file', 'fs_write_file', 'fs_list_files', 'search_web_guidance', 'read_web_guidance_doc'],
        resolveEngramFilter: (state) => ({
          scope: `component_${state.activeComponentId ?? 'unknown'}`,
          tags: ['approved_design', 'local_contracts'],
        }),
        buildSystemPrompt: (state) =>
          `[SKILL: Component_Implementer] Estás implementando el código del componente ${state.activeComponentId}. Antes de escribir HTML, CSS o JS de cliente, usa search_web_guidance para buscar buenas prácticas en modern-web-guidance y read_web_guidance_doc para leer la guía por su ruta relativa. Sigue con rigor el diseño técnico aprobado y escribe código modular, tipado y documentado invocando fs_write_file para cada archivo.`,
      },
      {
        id: 'UnitTest_Engineer',
        branch: 'branch_3_engineering',
        name: 'Ingeniero de Pruebas Unitarias',
        title: 'Verificación Automatizada Unitaria en Sandbox',
        description: 'Crea y ejecuta suites unitarias en Sandbox JS o Browser Iframe Sandbox. Emite evidencias de ejecución y capturas visuales de DOM.',
        allowedTools: ['run_sandboxed_js', 'run_browser_sandbox', 'fs_read_file', 'search_web_guidance', 'read_web_guidance_doc', 'emit_unit_evidence'],
        resolveEngramFilter: (state) => ({
          scope: `component_${state.activeComponentId ?? 'unknown'}`,
          tags: ['unit_tests', 'spec_contracts'],
        }),
        buildSystemPrompt: (state) =>
          `[SKILL: UnitTest_Engineer] Eres el responsable de pruebas unitarias de ${state.activeComponentId}. Ejecuta los tests en Sandbox JS o en Browser Iframe Sandbox si el componente incluye DOM, HTML o Canvas. Valida cobertura, aserciones y evidencias visuales. Solo si tienen éxito emite la evidencia de PASS.`,
      },
    ],
  },
  {
    id: 'branch_4_verification',
    name: '4. Verificación Funcional & Aprobación Formal de Negocio',
    description: 'Ejecución E2E, auditoría de valor de negocio e interrupción Human-In-The-Loop.',
    skills: [
      {
        id: 'E2EAutomation_Runner',
        branch: 'branch_4_verification',
        name: 'Ejecutor de Automatización E2E',
        title: 'Pruebas Integradas de Casos de Uso',
        description: 'Orquesta el navegador/iframe sandbox para validar los casos de uso definidos en la Fase 0.',
        allowedTools: ['run_browser_sandbox', 'fs_read_file'],
        resolveEngramFilter: () => ({
          scope: 'project_discovery',
          tags: ['use_cases', 'e2e_acceptance'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: E2EAutomation_Runner] Ejecuta las pruebas automatizadas de extremo a extremo que validan los casos de uso completos de negocio en el entorno de navegador/iframe sandbox.`,
      },
      {
        id: 'BusinessOutcome_Auditor',
        branch: 'branch_4_verification',
        name: 'Auditor de Consecución de Negocio',
        title: 'Compilador de Evidencias para Aprobación Humana',
        description: 'Compila el informe ejecutivo de resultados frente a KPIs de negocio para el Human-in-the-Loop.',
        allowedTools: ['compile_business_report', 'prepare_hitl_approval'],
        resolveEngramFilter: () => ({
          scope: 'project_discovery',
          tags: ['expected_business_outcome', 'use_cases'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: BusinessOutcome_Auditor] Prepara el informe para la aprobación formal de negocio. Sintetiza evidencias de ejecución y evalúa si se han cumplido los objetivos estratégicos planteados.`,
      },
    ],
  },
  {
    id: 'branch_5_resilience',
    name: '5. Resiliencia Estratégica & Realimentación de Backlog',
    description: 'Análisis de causa raíz ante rechazo o fallo E2E, re-especificación y retroalimentación del plan.',
    skills: [
      {
        id: 'RootCause_Analyzer',
        branch: 'branch_5_resilience',
        name: 'Analista de Causa Raíz (RCA)',
        title: 'Diagnóstico Estructural de Fallos de Negocio',
        description: 'Identifica si el fallo proviene de asunciones de negocio, limitaciones arquitectónicas o defectos.',
        allowedTools: ['engram_search', 'search_web_guidance', 'read_web_guidance_doc', 'diagnose_root_cause'],
        resolveEngramFilter: () => ({
          scope: 'e2e_audit_failure',
          tags: ['evidence', 'system_traces', 'stakeholder_feedback'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: RootCause_Analyzer] Analiza la causa raíz del rechazo de negocio o fallo E2E. Determina si el problema es de asunción de negocio, arquitectura o implementación.`,
      },
      {
        id: 'BusinessEnterpriseArch_ReSpec',
        branch: 'branch_5_resilience',
        name: 'Re-Especificador Conjunto Negocio-Arquitectura',
        title: 'Nueva Especificación Funcional Post-RCA',
        description: 'Elabora la nueva especificación funcional mitigando la causa raíz identificada.',
        allowedTools: ['create_respec_contract'],
        resolveEngramFilter: () => ({
          scope: 'enterprise_landscape',
          tags: ['rca_findings', 'business_goals'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: BusinessEnterpriseArch_ReSpec] Re-especifica la funcionalidad conjuntamente entre Negocio y Arquitectura para resolver la causa raíz diagnosticada.`,
      },
      {
        id: 'Backlog_Manager',
        branch: 'branch_5_resilience',
        name: 'Gestor de Backlog y Repriorización',
        title: 'Inyección Formal de Ítem en el Backlog de Proyecto',
        description: 'Registra la nueva especificación en el backlog del proyecto con estimación y riesgos.',
        allowedTools: ['insert_backlog_item', 'update_project_plan'],
        resolveEngramFilter: () => ({
          scope: 'project_planning',
          tags: ['backlog', 'risk_matrix'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: Backlog_Manager] Incorpora formalmente la nueva especificación al backlog del proyecto con prioridad, dependencias y riesgos, realimentando el plan de la Fase 1.`,
      },
    ],
  },
  {
    id: 'branch_6_projection',
    name: '6. Proyección y Documentación Humana',
    description: 'Sinks unidireccionales que generan o actualizan los entregables documentales sin ensuciar el contexto agéntico.',
    skills: [
      {
        id: 'ProjectProgress_Projector',
        branch: 'branch_6_projection',
        name: 'Proyector de Progreso de Proyecto',
        title: 'Actualizador Desacoplado del Plan de Proyecto',
        description: 'Traduce los eventos de evidencias unitarias y E2E en actualizaciones del fichero de seguimiento.',
        allowedTools: ['fs_write_file', 'fs_read_file'],
        resolveEngramFilter: () => ({
          scope: 'project_planning',
          tags: ['progress_events'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: ProjectProgress_Projector] Actualiza los entregables documentales de avance del plan de proyecto con base en los eventos de verificación registrados.`,
      },
      {
        id: 'SystemDocumentation_Synchronizer',
        branch: 'branch_6_projection',
        name: 'Sincronizador de Documentación del Sistema',
        title: 'Actualizador de Landscape y Manual de Procesos',
        description: 'Escribe en el workspace el landscape arquitectónico final y el manual de procesos con evidencias reales.',
        allowedTools: ['fs_write_file', 'fs_read_file'],
        resolveEngramFilter: () => ({
          scope: 'system_documentation',
          tags: ['verified_landscape', 'process_manual'],
        }),
        buildSystemPrompt: () =>
          `[SKILL: SystemDocumentation_Synchronizer] Escribe y consolida el Landscape de Componentes y el Manual de Procesos con las evidencias definitivas generadas en las pruebas.`,
      },
    ],
  },
]

export function getSkillDefinition(skillId: string): SkillDefinition {
  for (const branch of SKILL_TREE) {
    const found = branch.skills.find((s) => s.id === skillId)
    if (found) return found
  }
  // Fallback seguro a la primera skill
  return SKILL_TREE[0].skills[0]
}

