import type { SDLCStateType } from '../sdlc-state'

export type SkillBranchId =
  | 'branch_0_discovery'
  | 'branch_1_strategy'
  | 'branch_2_design'
  | 'branch_3_engineering'
  | 'branch_4_verification'
  | 'branch_5_resilience'
  | 'branch_6_projection'

export interface EngramContextFilter {
  scope: string
  tags: string[]
}

export interface SkillDefinition {
  id: string
  branch: SkillBranchId
  name: string
  title: string
  description: string
  /** Nombres de las herramientas que este agente puede invocar en esta fase */
  allowedTools: string[]
  /** Determina el filtro de Engram para no saturar el contexto */
  resolveEngramFilter: (state: SDLCStateType) => EngramContextFilter
  /** Genera el system prompt quirúrgico y exclusivo para esta fase */
  buildSystemPrompt: (state: SDLCStateType) => string
}

export interface SkillBranch {
  id: SkillBranchId
  name: string
  description: string
  skills: SkillDefinition[]
}
