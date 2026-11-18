import type { ComponentNode } from '../../sdlc-state'

export interface ComponentDesignResult {
  approachName: string
  description: string
  contracts: Array<{ name: string; schema: string }>
  tradeOffAnalysis: string
}

export type ComponentDesignPresetProvider = (comp: ComponentNode, standard: string) => ComponentDesignResult | null
let customDesignPresetProvider: ComponentDesignPresetProvider | null = null

/**
 * Permite registrar proveedores externos de diseño técnico (ej. fixtures en suites de prueba)
 * evitando contaminar el generador de diseño de producción.
 */
export function registerComponentDesignPresetProvider(provider: ComponentDesignPresetProvider | null): void {
  customDesignPresetProvider = provider
}

/**
 * Genera la propuesta de diseño técnico de Clean Architecture según el rol y tipo de componente
 */
export function generateComponentDesign(
  comp: ComponentNode,
  standard: string,
): ComponentDesignResult {
  if (customDesignPresetProvider) {
    const preset = customDesignPresetProvider(comp, standard)
    if (preset) return preset
  }

  const isTransition =
    comp.targetState === 'TRANSITION' ||
    comp.id.includes('adapter') ||
    comp.name.toLowerCase().includes('adapter') ||
    comp.name.toLowerCase().includes('transic')

  const pascalId =
    comp.id
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('') || 'Component'

  return {
    approachName: isTransition
      ? `Strangler Fig / Transition Adapter (${standard})`
      : `Modular Component Service (${standard})`,
    description: isTransition
      ? `Adaptador de transición y fachada de integración para ${comp.name} (${comp.description}) conforme a ${standard}.`
      : `Servicio y módulo tipado para ${comp.name} (${comp.description}) conforme a ${standard}.`,
    contracts: [
      {
        name: `I${pascalId}Service`,
        schema: `export interface ${pascalId}Item {\n  id: string;\n  title: string;\n  payload: Record<string, unknown>;\n  createdAt: string;\n}\n\nexport interface ${pascalId}Input {\n  action: string;\n  payload: Record<string, unknown>;\n}\n\nexport interface ${pascalId}Output {\n  success: boolean;\n  executedAt: string;\n  resultData?: unknown;\n  items?: ${pascalId}Item[];\n}\n\nexport interface I${pascalId}Service {\n  execute(input: ${pascalId}Input): ${pascalId}Output;\n  listItems(): ${pascalId}Item[];\n  getState(): { status: string; count: number; lastUpdatedAt: string | null };\n  mount?(container: HTMLElement): void;\n}`,
      },
    ],
    tradeOffAnalysis: isTransition
      ? 'Desacopla la integración con sistemas o pasarelas externas mediante un puerto tipado para evolución progresiva sin despliegue Big-Bang.'
      : 'Alta cohesión interna con contratos TypeScript explícitos y dependencias Fin-Inicio verificadas.',
  }
}
