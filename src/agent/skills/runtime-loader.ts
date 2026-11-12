import { getFileSystemToolSpecs } from '../../fs/fs-tools'
import type { OpenAiToolSpec } from '../../llm/llm-client'
import { getWebGuidanceToolSpecs } from '../../memory/web-guidance-manager'
import { getBrowserSandboxToolSpec, getSandboxToolSpec } from '../../sandbox/code-runner'
import type { SDLCStateType } from '../sdlc-state'
import { getSkillDefinition } from './skills-tree'
import type { EngramContextFilter, SkillDefinition } from './types'

export interface ResolvedAgentContext {
  skill: SkillDefinition
  systemPrompt: string
  engramFilter: EngramContextFilter
  tools: OpenAiToolSpec[]
}

/**
 * Catálogo maestro de especificaciones de herramientas de localloop.
 */
export function getAllMasterToolSpecs(): Map<string, OpenAiToolSpec> {
  const map = new Map<string, OpenAiToolSpec>()

  // Herramientas de sistema de archivos
  for (const spec of getFileSystemToolSpecs()) {
    map.set(spec.function.name, spec)
  }
  // Alias de fs_list_dir para compatibilidad con árbol de skills
  const listDirSpec = map.get('fs_list_dir')
  if (listDirSpec) {
    map.set('fs_list_files', listDirSpec)
  }

  // Herramientas de Sandbox
  const jsSandbox = getSandboxToolSpec()
  map.set(jsSandbox.function.name, jsSandbox)

  const browserSandbox = getBrowserSandboxToolSpec()
  map.set(browserSandbox.function.name, browserSandbox)

  // Herramientas de Modern Web Guidance (engram-ts + Lunr)
  for (const spec of getWebGuidanceToolSpecs()) {
    map.set(spec.function.name, spec)
  }

  // Herramientas nativas de Engram
  map.set('engram_search', {
    type: 'function',
    function: {
      name: 'engram_search',
      description: 'Busca memorias y especificaciones filtradas en la memoria episódica engram-ts.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'Términos de búsqueda semántica o etiquetas.' },
          tag: { type: 'string', description: 'Etiqueta opcional para restringir el alcance.' },
        },
        required: ['query'],
      },
    },
  })

  // Herramientas de Descubrimiento & Calibración
  map.set('ask_discovery_question', {
    type: 'function',
    function: {
      name: 'ask_discovery_question',
      description: 'Formula preguntas de rigor al usuario de negocio para calibrar los casos de uso.',
      parameters: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          category: { type: 'string', enum: ['USE_CASE', 'ACCEPTANCE_CRITERIA', 'ARCHITECTURE_LIMIT'] },
        },
        required: ['question'],
      },
    },
  })

  map.set('save_use_cases', {
    type: 'function',
    function: {
      name: 'save_use_cases',
      description: 'Persiste la lista formal de casos de uso de negocio en la memoria del proyecto.',
      parameters: {
        type: 'object',
        properties: {
          useCases: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                title: { type: 'string' },
                acceptanceCriteriaGherkin: { type: 'string' },
              },
              required: ['id', 'title'],
            },
          },
        },
        required: ['useCases'],
      },
    },
  })

  // Herramientas de Conexión MCP
  map.set('mcp_connect_server', {
    type: 'function',
    function: {
      name: 'mcp_connect_server',
      description: 'Conecta con un servidor MCP de arquitectura empresarial vía SSE/WebSocket.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'URL del servidor MCP' },
        },
        required: ['url'],
      },
    },
  })

  map.set('mcp_import_landscape', {
    type: 'function',
    function: {
      name: 'mcp_import_landscape',
      description: 'Importa el catálogo de servicios y componentes desde el servidor MCP.',
      parameters: {
        type: 'object',
        properties: {
          scope: { type: 'string' },
        },
      },
    },
  })

  // Herramientas de Estrategia & Planificación
  map.set('map_capabilities_to_components', {
    type: 'function',
    function: {
      name: 'map_capabilities_to_components',
      description: 'Mapea las capacidades de negocio con los componentes de software (As-Is / To-Be).',
      parameters: {
        type: 'object',
        properties: {
          mappings: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                capability: { type: 'string' },
                componentId: { type: 'string' },
                status: { type: 'string', enum: ['AS_IS', 'TO_BE', 'TRANSITION'] },
              },
              required: ['capability', 'componentId'],
            },
          },
        },
        required: ['mappings'],
      },
    },
  })

  map.set('create_components_dag', {
    type: 'function',
    function: {
      name: 'create_components_dag',
      description: 'Genera el grafo de dependencias Fin-Inicio (DAG) entre los componentes.',
      parameters: {
        type: 'object',
        properties: {
          components: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                name: { type: 'string' },
                dependsOn: { type: 'array', items: { type: 'string' } },
              },
              required: ['id', 'name', 'dependsOn'],
            },
          },
        },
        required: ['components'],
      },
    },
  })

  map.set('set_quality_gates', {
    type: 'function',
    function: {
      name: 'set_quality_gates',
      description: 'Establece los umbrales de calidad y compuertas de paso por componente.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          minCoverage: { type: 'number' },
          requireUnitPass: { type: 'boolean' },
        },
        required: ['componentId'],
      },
    },
  })

  // Herramientas de Diseño Técnico & Gatekeeper
  map.set('propose_design_options', {
    type: 'function',
    function: {
      name: 'propose_design_options',
      description: 'Propone opciones de diseño técnico, contratos de interfaz y trade-offs para el componente.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          approaches: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                approachName: { type: 'string' },
                description: { type: 'string' },
                tradeOffs: { type: 'string' },
              },
              required: ['approachName', 'description'],
            },
          },
        },
        required: ['componentId', 'approaches'],
      },
    },
  })

  map.set('approve_design', {
    type: 'function',
    function: {
      name: 'approve_design',
      description: 'Aprueba formalmente el diseño técnico seleccionado para autorizar su construcción.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          approachName: { type: 'string' },
          rationale: { type: 'string' },
        },
        required: ['componentId', 'approachName'],
      },
    },
  })

  map.set('reject_with_redesign', {
    type: 'function',
    function: {
      name: 'reject_with_redesign',
      description: 'Rechaza el diseño técnico exigiendo un rediseño que cumpla con los estándares.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          rejectionReasons: { type: 'array', items: { type: 'string' } },
        },
        required: ['componentId', 'rejectionReasons'],
      },
    },
  })

  // Herramienta de sincronización de Deuda Técnica con MCP
  map.set('register_technical_debt_mcp', {
    type: 'function',
    function: {
      name: 'register_technical_debt_mcp',
      description: 'Registra un ítem de deuda técnica formal y lo sincroniza con el MCP de arquitectura empresarial.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          title: { type: 'string' },
          description: { type: 'string' },
          riskLevel: { type: 'string', enum: ['BAJO', 'MEDIO', 'ALTO'] },
          mitigationPlan: { type: 'string' },
        },
        required: ['componentId', 'title', 'description', 'riskLevel', 'mitigationPlan'],
      },
    },
  })

  // Herramientas de Verificación Unitaria & E2E
  map.set('emit_unit_evidence', {
    type: 'function',
    function: {
      name: 'emit_unit_evidence',
      description: 'Emite y registra formalmente las evidencias de pruebas unitarias ejecutadas en Sandbox JS.',
      parameters: {
        type: 'object',
        properties: {
          componentId: { type: 'string' },
          assertionsCount: { type: 'integer' },
          passed: { type: 'boolean' },
          summary: { type: 'string' },
        },
        required: ['componentId', 'assertionsCount', 'passed'],
      },
    },
  })

  map.set('compile_business_report', {
    type: 'function',
    function: {
      name: 'compile_business_report',
      description: 'Compila el informe ejecutivo de resultados frente a KPIs de negocio para la aprobación humana.',
      parameters: {
        type: 'object',
        properties: {
          useCasesCompleted: { type: 'array', items: { type: 'string' } },
          executiveSummary: { type: 'string' },
        },
        required: ['useCasesCompleted', 'executiveSummary'],
      },
    },
  })

  map.set('prepare_hitl_approval', {
    type: 'function',
    function: {
      name: 'prepare_hitl_approval',
      description: 'Prepara la solicitud interactiva de Aprobación Formal de Negocio (HITL).',
      parameters: {
        type: 'object',
        properties: {
          summary: { type: 'string' },
          pendingDebts: { type: 'array', items: { type: 'string' } },
        },
        required: ['summary'],
      },
    },
  })

  // Herramientas de Resiliencia
  map.set('diagnose_root_cause', {
    type: 'function',
    function: {
      name: 'diagnose_root_cause',
      description: 'Diagnostica la causa raíz estructural (RCA) tras un rechazo de negocio o fallo E2E.',
      parameters: {
        type: 'object',
        properties: {
          category: { type: 'string', enum: ['BUSINESS_ASSUMPTION', 'ARCHITECTURE_LIMIT', 'CODE_DEFECT'] },
          detail: { type: 'string' },
          remedy: { type: 'string' },
        },
        required: ['category', 'detail', 'remedy'],
      },
    },
  })

  map.set('create_respec_contract', {
    type: 'function',
    function: {
      name: 'create_respec_contract',
      description: 'Crea el nuevo contrato de re-especificación funcional conjunta post-RCA.',
      parameters: {
        type: 'object',
        properties: {
          specTitle: { type: 'string' },
          changes: { type: 'array', items: { type: 'string' } },
        },
        required: ['specTitle', 'changes'],
      },
    },
  })

  map.set('insert_backlog_item', {
    type: 'function',
    function: {
      name: 'insert_backlog_item',
      description: 'Inserta un nuevo ítem en el backlog del proyecto tras un ciclo de resiliencia.',
      parameters: {
        type: 'object',
        properties: {
          title: { type: 'string' },
          spec: { type: 'string' },
          priority: { type: 'integer' },
        },
        required: ['title', 'spec'],
      },
    },
  })

  map.set('update_project_plan', {
    type: 'function',
    function: {
      name: 'update_project_plan',
      description: 'Actualiza los hitos y estimaciones del plan de proyecto.',
      parameters: {
        type: 'object',
        properties: {
          statusSummary: { type: 'string' },
        },
        required: ['statusSummary'],
      },
    },
  })

  return map
}

export class RuntimeSkillLoader {
  private static masterTools = getAllMasterToolSpecs()

  /**
   * Resuelve quirúrgicamente el contexto mínimo necesario para el agente en el paso actual del grafo.
   */
  public static resolveContext(state: SDLCStateType): ResolvedAgentContext {
    const skill = getSkillDefinition(state.activeSkill)
    const engramFilter = skill.resolveEngramFilter(state)
    const systemPrompt = skill.buildSystemPrompt(state)

    // Filtrar únicamente las herramientas permitidas para esta skill
    const tools: OpenAiToolSpec[] = []
    for (const toolName of skill.allowedTools) {
      const spec = this.masterTools.get(toolName)
      if (spec) {
        tools.push(spec)
      }
    }

    return {
      skill,
      systemPrompt,
      engramFilter,
      tools,
    }
  }
}

