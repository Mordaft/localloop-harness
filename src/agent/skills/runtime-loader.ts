import { getFileSystemToolSpecs } from '../../fs/fs-tools'
import type { OpenAiToolSpec } from '../../llm/llm-client'
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
function getAllMasterToolSpecs(): Map<string, OpenAiToolSpec> {
  const map = new Map<string, OpenAiToolSpec>()

  // Herramientas de sistema de archivos
  for (const spec of getFileSystemToolSpecs()) {
    map.set(spec.function.name, spec)
  }

  // Herramientas de Sandbox
  const jsSandbox = getSandboxToolSpec()
  map.set(jsSandbox.function.name, jsSandbox)

  const browserSandbox = getBrowserSandboxToolSpec()
  map.set(browserSandbox.function.name, browserSandbox)

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

