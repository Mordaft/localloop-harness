import type { AgentSkillName } from '../memory/engram-memory'

export interface AgentSkillDefinition {
  id: AgentSkillName
  name: string
  title: string
  description: string
  systemSupplement: string
}

export const BUILTIN_SKILLS: AgentSkillDefinition[] = [
  {
    id: 'skill_general',
    name: 'Agente Generalista Full-Stack',
    title: 'Agente Generalista Full-Stack',
    description: 'Exploración de código, edición asistida, memoria engram-ts y ejecución en sandbox.',
    systemSupplement:
      '[SKILL ACTIVA: skill_general] Actúa como ingeniero de software versátil. Combina lectura de archivos, búsqueda en memoria episódica y propuestas de modificación claras.',
  },
  {
    id: 'skill_architect',
    name: 'Arquitecto SOLID & Modularidad',
    title: 'Arquitecto SOLID & Modularidad',
    description: 'Diseño de arquitectura limpia, desacoplamiento, principios SOLID y descomposición en sub-scopes.',
    systemSupplement:
      '[SKILL ACTIVA: skill_architect] Enfócate en principios SOLID, separación de responsabilidades, contratos tipados y descomposición de tareas complejas mediante sub-agentes fractales.',
  },
  {
    id: 'skill_coder',
    name: 'Implementador & Refactorizador',
    title: 'Implementador & Refactorizador',
    description: 'Generación de código TypeScript limpio, pruebas unitarias y verificación en Sandbox JS e Iframe.',
    systemSupplement:
      '[SKILL ACTIVA: skill_coder] Prioriza escribir código conciso, tipado estrictamente y verificable. Usa run_browser_sandbox (iframe con inspección de DOM, logs y captura) o run_sandboxed_js para validar pruebas automatizadas y fs_write_file para proponer los cambios.',
  },
  {
    id: 'skill_security',
    name: 'Auditor de Seguridad & Sandboxing',
    title: 'Auditor de Seguridad & Sandboxing',
    description: 'Detección de vulnerabilidades, inyecciones, exposición de secretos y validación de entradas.',
    systemSupplement:
      '[SKILL ACTIVA: skill_security] Analiza exhaustivamente riesgos de seguridad, sanitización, permisos de navegador y aislamiento de ejecución.',
  },
]

export function getBuiltInSkills(): AgentSkillDefinition[] {
  return BUILTIN_SKILLS
}

export function getSkillById(skillId?: string): AgentSkillDefinition {
  return BUILTIN_SKILLS.find((s) => s.id === skillId) ?? BUILTIN_SKILLS[0]
}
