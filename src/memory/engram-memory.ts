import Dexie from 'dexie'
import {
  createLangGraphMemoryTools,
  DexieMemoryStore,
  Engram,
  type CreateMemoryInput,
  type MemoryDocument,
  type MemoryHeader,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
} from 'engram-ts'
import { trace } from '../diagnostics'

export const ENGRAM_DB_NAME = 'localloop-engram-memory'
export const ENGRAM_REF_PREFIX = 'engram://storage/v1/'

export type AgentSkillName = 'skill_architect' | 'skill_coder' | 'skill_security' | 'skill_general'

export interface ScopeTaskDefinition {
  id_subtarea: string
  descripcion: string
  prueba_aceptacion?: string
  skill_requerida?: AgentSkillName
  targetPath?: string
  lineStart?: number
  lineEnd?: number
  datos_de_entrada?: Record<string, unknown>
  requiere_sub_planificacion?: boolean
}

export interface ScopeFinding {
  id: string
  filePath: string
  line: number
  severity: 'baja' | 'media' | 'alta'
  category: string
  message: string
  recommendation: string
}

export interface AtomicTestEvidence {
  ejecutada: boolean
  exito: boolean
  modo: 'js_sandbox' | 'browser_iframe_sandbox'
  logs: string[]
  returnValue?: string
  domSnapshot?: string
  screenshotDataUrl?: string
  error?: string
  reporteAgente?: string
  resumen: string
}

export interface AtomicTaskDeliverable {
  tarea_realizada: string
  prueba_aceptacion: string
  prueba_automatizada: string
  evidencia_prueba: AtomicTestEvidence
}

export interface SubAgentDeliverableSummary {
  id_scope: string
  descripcion: string
  prueba_aceptacion: string
  entregable_atomico?: AtomicTaskDeliverable
}

export interface ScopeExecutionResult {
  id_scope: string
  engram_ref: string
  memoryId: string
  sumario_ejecutivo: string
  findings: ScopeFinding[]
  fromMemoryCache?: boolean
  isAggregated?: boolean
  depth: number
  entregable_atomico?: AtomicTaskDeliverable
  entregables_subagentes?: SubAgentDeliverableSummary[]
}

export interface ReducedScopeSummary {
  id_scope: string
  engram_ref: string
  sumario_ejecutivo: string
  total_hallazgos: number
  hallazgos_resumen: Array<{
    id: string
    filePath: string
    line: number
    severity: string
    message: string
  }>
}

export interface InFlightScopeEntry {
  ownerScopeId: string
  promise: Promise<ScopeExecutionResult>
}

/**
 * Fast, non-blocking in-memory MemoryStore implementation for `engram-ts`
 * used in isolated scope trees or Node unit test environments without IndexedDB.
 */
export class InMemoryEngramStore implements MemoryStore {
  private readonly headers = new Map<string, MemoryHeader>()
  private readonly records = new Map<string, MemoryRecord[]>()

  async create(input: CreateMemoryInput): Promise<MemoryHeader> {
    const now = new Date().toISOString()
    const id = crypto.randomUUID()
    const header: MemoryHeader = {
      id,
      title: input.title.trim(),
      type: input.type.trim(),
      project: input.project.trim(),
      tags: [...(input.tags ?? [])],
      recordCount: input.records.length,
      createdAt: now,
      updatedAt: now,
    }
    const memRecords: MemoryRecord[] = input.records.map((record) => ({
      ...record,
      id: crypto.randomUUID(),
      memoryId: id,
      tags: [...(record.tags ?? [])],
      createdAt: record.createdAt ?? now,
    }))
    this.headers.set(id, header)
    this.records.set(id, memRecords)
    return header
  }

  async getHeader(id: string): Promise<MemoryHeader | undefined> {
    return this.headers.get(id)
  }

  async getDocument(id: string): Promise<MemoryDocument | undefined> {
    const header = this.headers.get(id)
    if (!header) return undefined
    const records = [...(this.records.get(id) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    return { header, records }
  }

  async listHeaders(): Promise<MemoryHeader[]> {
    return [...this.headers.values()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  async listRecords(): Promise<MemoryRecord[]> {
    const all: MemoryRecord[] = []
    for (const list of this.records.values()) {
      all.push(...list)
    }
    return all
  }

  close(): void {
    this.headers.clear()
    this.records.clear()
  }
}

export function normalizeScopeKeyText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function hashCodeSlice(text: string): string {
  let hash = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export function computeScopeSignature(params: {
  filePath: string
  skill?: string
  lineStart?: number
  lineEnd?: number
  codeSlice: string
  descripcion: string
}): { sigTag: string; topicTag: string; sliceTag: string } {
  const normSkill = normalizeScopeKeyText(params.skill ?? 'skill_general') || 'skill_general'
  const rangeStr = `${params.lineStart ?? 1}-${params.lineEnd ?? 'end'}`
  const codeHash = hashCodeSlice(params.codeSlice.trim())
  const normDesc = normalizeScopeKeyText(params.descripcion)
  const descWords = normDesc
    .split(' ')
    .filter((w) => w.length > 2)
    .slice(0, 10)
    .join('_')
  const descHash = hashCodeSlice(descWords || normDesc)

  return {
    sigTag: `sig:${params.filePath}:${rangeStr}:${normSkill}:${codeHash}:${descHash}`,
    topicTag: `topic:${params.filePath}:${rangeStr}:${normSkill}:${descHash}`,
    sliceTag: `slice:${codeHash}:${descHash}`,
  }
}

export function toEngramRef(memoryId: string): string {
  return `${ENGRAM_REF_PREFIX}${memoryId}`
}

export function fromEngramRef(refOrId: string): string {
  const trimmed = refOrId.trim()
  if (trimmed.startsWith(ENGRAM_REF_PREFIX)) {
    return trimmed.slice(ENGRAM_REF_PREFIX.length)
  }
  return trimmed
}

export function toReducedScopeSummary(result: ScopeExecutionResult): ReducedScopeSummary {
  return {
    id_scope: result.id_scope,
    engram_ref: result.engram_ref,
    sumario_ejecutivo: result.sumario_ejecutivo,
    total_hallazgos: result.findings.length,
    hallazgos_resumen: result.findings.map((f) => ({
      id: f.id,
      filePath: f.filePath,
      line: f.line,
      severity: f.severity,
      message: f.message,
    })),
  }
}

let persistentEngramInstance: Engram | undefined

/**
 * Returns the persistent `Engram` instance backed by `DexieMemoryStore` in browser/Worker,
 * or `InMemoryEngramStore` when IndexedDB is unavailable.
 */
export function getPersistentEngram(customStore?: MemoryStore): Engram {
  if (customStore) {
    return new Engram({ store: customStore })
  }
  if (!persistentEngramInstance) {
    const store =
      typeof indexedDB !== 'undefined'
        ? new DexieMemoryStore(ENGRAM_DB_NAME)
        : new InMemoryEngramStore()
    persistentEngramInstance = new Engram({ store })
  }
  return persistentEngramInstance
}

export function createIsolatedEngram(customStore?: MemoryStore): Engram {
  return new Engram({ store: customStore ?? new InMemoryEngramStore() })
}

export async function resetEngramMemoryDatabase(): Promise<void> {
  if (persistentEngramInstance) {
    try {
      persistentEngramInstance.close()
    } catch {
      // Ignore close errors
    }
    persistentEngramInstance = undefined
  }
  if (typeof indexedDB !== 'undefined') {
    try {
      await Dexie.delete(ENGRAM_DB_NAME)
    } catch (err) {
      console.warn('[Engram] Error eliminando base de datos engram-ts:', err)
    }
  }
}

export interface AgentScopeStorageOptions {
  engram?: Engram
  project: string
  filePath: string
  scopeId: string
  parentScopeId?: string
  ancestorScopeIds?: Set<string>
  depth?: number
  inFlightMap?: Map<string, InFlightScopeEntry>
  scopeIdToMemoryIdMap?: Map<string, string>
}

/**
 * Hierarchical Scope Storage backed by `engram-ts`.
 * Supports episodic memory, decomposed sub-plans, progressive disclosure via compact headers,
 * and deadlock-free reuse of previously executed sub-scopes across sub-agents.
 */
export class AgentScopeStorage {
  readonly engram: Engram
  readonly project: string
  readonly filePath: string
  readonly scopeId: string
  readonly parentScopeId?: string
  readonly ancestorScopeIds: Set<string>
  readonly depth: number
  private readonly inFlightMap: Map<string, InFlightScopeEntry>
  private readonly scopeIdToMemoryIdMap: Map<string, string>

  constructor(options: AgentScopeStorageOptions) {
    this.engram = options.engram ?? getPersistentEngram()
    this.project = options.project
    this.filePath = options.filePath
    this.scopeId = options.scopeId
    this.parentScopeId = options.parentScopeId
    this.ancestorScopeIds = options.ancestorScopeIds ?? new Set<string>()
    this.depth = options.depth ?? 0
    this.inFlightMap = options.inFlightMap ?? new Map<string, InFlightScopeEntry>()
    this.scopeIdToMemoryIdMap = options.scopeIdToMemoryIdMap ?? new Map<string, string>()
  }

  createChildScopeStorage(childScopeId: string, targetPath?: string): AgentScopeStorage {
    const nextAncestors = new Set(this.ancestorScopeIds)
    nextAncestors.add(this.scopeId)
    return new AgentScopeStorage({
      engram: this.engram,
      project: this.project,
      filePath: targetPath ?? this.filePath,
      scopeId: childScopeId,
      parentScopeId: this.scopeId,
      ancestorScopeIds: nextAncestors,
      depth: this.depth + 1,
      inFlightMap: this.inFlightMap,
      scopeIdToMemoryIdMap: this.scopeIdToMemoryIdMap,
    })
  }

  getLangGraphTools() {
    return createLangGraphMemoryTools(this.engram)
  }

  getInFlight(signatureKey: string): Promise<ScopeExecutionResult> | undefined {
    const entry = this.inFlightMap.get(signatureKey)
    if (!entry) return undefined
    if (entry.ownerScopeId === this.scopeId || this.ancestorScopeIds.has(entry.ownerScopeId)) {
      return undefined
    }
    return entry.promise
  }

  setInFlight(signatureKey: string, promise: Promise<ScopeExecutionResult>): void {
    const existing = this.inFlightMap.get(signatureKey)
    if (existing && this.ancestorScopeIds.has(existing.ownerScopeId)) {
      return
    }
    this.inFlightMap.set(signatureKey, {
      ownerScopeId: this.scopeId,
      promise,
    })
  }

  clearInFlight(signatureKey: string): void {
    const existing = this.inFlightMap.get(signatureKey)
    if (existing && existing.ownerScopeId === this.scopeId) {
      this.inFlightMap.delete(signatureKey)
    }
  }

  async saveSubPlan(subPlan: ScopeTaskDefinition[], justification?: string): Promise<MemoryHeader> {
    const header = await this.engram.save({
      title: `Plan de Scope ${this.scopeId} (${subPlan.length} subtareas)`,
      type: 'scope-plan',
      project: this.project,
      tags: [
        'scope-plan',
        `scope:${this.scopeId}`,
        ...(this.parentScopeId ? [`parent:${this.parentScopeId}`] : []),
        `file:${this.filePath}`,
        `depth:${this.depth}`,
      ],
      records: [
        {
          title: 'manifiesto_subtareas',
          content: JSON.stringify({
            id_scope: this.scopeId,
            parent_scope: this.parentScopeId ?? null,
            depth: this.depth,
            justificacion: justification ?? 'Descomposición recursiva de tarea compleja',
            subtareas: subPlan,
          }),
          tags: ['plan', `scope:${this.scopeId}`],
        },
      ],
    })

    trace('engram.scope.plan_saved', {
      scopeId: this.scopeId,
      parentScopeId: this.parentScopeId,
      depth: this.depth,
      memoryId: header.id,
      subtasksCount: subPlan.length,
    })

    return header
  }

  async saveScopeResult(params: {
    task: ScopeTaskDefinition
    codeSlice: string
    sumarioEjecutivo: string
    findings: ScopeFinding[]
    isAggregated?: boolean
    entregableAtomico?: AtomicTaskDeliverable
    entregablesSubagentes?: SubAgentDeliverableSummary[]
  }): Promise<ScopeExecutionResult> {
    const { sigTag, topicTag, sliceTag } = computeScopeSignature({
      filePath: this.filePath,
      skill: params.task.skill_requerida,
      lineStart: params.task.lineStart,
      lineEnd: params.task.lineEnd,
      codeSlice: params.codeSlice,
      descripcion: params.task.descripcion,
    })

    const summaryText =
      params.sumarioEjecutivo.trim() ||
      `Scope ${this.scopeId} completado con ${params.findings.length} resultado(s) en ${this.filePath}.`

    const records: Array<{ title: string; content: string; tags: string[] }> = [
      {
        title: 'sumario_ejecutivo',
        content: JSON.stringify({
          id_scope: this.scopeId,
          filePath: this.filePath,
          skill: params.task.skill_requerida ?? 'skill_general',
          lineStart: params.task.lineStart ?? 1,
          lineEnd: params.task.lineEnd ?? null,
          descripcion: params.task.descripcion,
          prueba_aceptacion: params.task.prueba_aceptacion ?? null,
          sumario_ejecutivo: summaryText,
          findingsCount: params.findings.length,
        }),
        tags: ['summary', `scope:${this.scopeId}`, sigTag, topicTag],
      },
      {
        title: 'findings_payload',
        content: JSON.stringify({
          findings: params.findings,
        }),
        tags: ['findings', `scope:${this.scopeId}`, `file:${this.filePath}`],
      },
    ]

    if (params.entregableAtomico || params.entregablesSubagentes) {
      records.push({
        title: 'entregable_atomico_payload',
        content: JSON.stringify({
          entregable_atomico: params.entregableAtomico,
          entregables_subagentes: params.entregablesSubagentes,
        }),
        tags: ['deliverable', `scope:${this.scopeId}`, `file:${this.filePath}`],
      })
    }

    const header = await this.engram.save({
      title: summaryText.slice(0, 160),
      type: params.isAggregated ? 'scope-synthesis' : 'scope-atomic-result',
      project: this.project,
      tags: [
        'scope-result',
        params.isAggregated ? 'scope-synthesis' : 'scope-atomic-result',
        `scope:${this.scopeId}`,
        ...(this.parentScopeId ? [`parent:${this.parentScopeId}`] : []),
        `file:${this.filePath}`,
        `skill:${params.task.skill_requerida ?? 'skill_general'}`,
        `range:${params.task.lineStart ?? 1}-${params.task.lineEnd ?? 'end'}`,
        `depth:${this.depth}`,
        sigTag,
        topicTag,
        sliceTag,
      ],
      records,
    })

    this.scopeIdToMemoryIdMap.set(this.scopeId, header.id)
    if (params.task.id_subtarea) {
      this.scopeIdToMemoryIdMap.set(params.task.id_subtarea, header.id)
    }

    const result: ScopeExecutionResult = {
      id_scope: this.scopeId,
      engram_ref: toEngramRef(header.id),
      memoryId: header.id,
      sumario_ejecutivo: summaryText,
      findings: params.findings,
      fromMemoryCache: false,
      isAggregated: Boolean(params.isAggregated),
      depth: this.depth,
      ...(params.entregableAtomico ? { entregable_atomico: params.entregableAtomico } : {}),
      ...(params.entregablesSubagentes
        ? { entregables_subagentes: params.entregablesSubagentes }
        : {}),
    }

    trace('engram.scope.result_saved', {
      scopeId: this.scopeId,
      parentScopeId: this.parentScopeId,
      depth: this.depth,
      memoryId: header.id,
      engramRef: result.engram_ref,
      findingsCount: params.findings.length,
      hasAtomicDeliverable: Boolean(params.entregableAtomico),
    })

    return result
  }

  async listRelatedScopeHeaders(task: ScopeTaskDefinition, limit = 8): Promise<MemoryHeader[]> {
    const queryTerms = `${this.filePath} ${task.skill_requerida ?? ''} ${task.descripcion}`.trim()
    let results: MemorySearchResult[] = []
    try {
      results = await this.engram.search({
        query: queryTerms,
        project: this.project,
        limit: limit * 2,
      })
    } catch {
      results = []
    }
    if (results.length === 0) {
      try {
        results = await this.engram.search({
          query: '',
          project: this.project,
          limit: limit * 2,
        })
      } catch {
        results = []
      }
    }

    return results
      .map((r) => r.header)
      .filter(
        (h) =>
          h.tags.includes('scope-result') &&
          h.tags.includes(`file:${this.filePath}`) &&
          ![...this.ancestorScopeIds].some((ancId) => h.tags.includes(`scope:${ancId}`)),
      )
      .slice(0, limit)
  }

  async findReusableScopeResult(
    task: ScopeTaskDefinition,
    codeSlice: string,
  ): Promise<ScopeExecutionResult | undefined> {
    const { sigTag, topicTag, sliceTag } = computeScopeSignature({
      filePath: this.filePath,
      skill: task.skill_requerida,
      lineStart: task.lineStart,
      lineEnd: task.lineEnd,
      codeSlice,
      descripcion: task.descripcion,
    })

    const inFlight = this.getInFlight(sigTag) ?? this.getInFlight(topicTag)
    if (inFlight) {
      const resolved = await inFlight
      return {
        ...resolved,
        fromMemoryCache: true,
      }
    }

    let candidates: MemorySearchResult[] = []
    try {
      candidates = await this.engram.search({
        query: '',
        project: this.project,
        limit: 100,
      })
    } catch {
      candidates = []
    }

    const resultHeaders = candidates
      .map((c) => c.header)
      .filter(
        (h) =>
          h.tags.includes('scope-result') &&
          ![...this.ancestorScopeIds].some((ancId) => h.tags.includes(`scope:${ancId}`)),
      )

    const targetSkillTag = `skill:${task.skill_requerida ?? 'skill_general'}`
    const matchedHeader = resultHeaders.find((header) => {
      if (header.tags.includes(sigTag)) return true
      if (header.tags.includes(topicTag)) return true
      if (
        header.tags.includes(sliceTag) &&
        header.tags.includes(targetSkillTag) &&
        header.tags.includes(`file:${this.filePath}`)
      ) {
        return true
      }
      if (
        task.id_subtarea &&
        !this.ancestorScopeIds.has(task.id_subtarea) &&
        header.tags.includes(`scope:${task.id_subtarea}`) &&
        header.tags.includes(`file:${this.filePath}`)
      ) {
        return true
      }
      return false
    })

    if (!matchedHeader) {
      return undefined
    }

    return this.getScopeResultByMemoryId(matchedHeader.id)
  }

  async getScopeResultByMemoryId(idOrRefOrScopeId: string): Promise<ScopeExecutionResult | undefined> {
    const cleanKey = fromEngramRef(idOrRefOrScopeId)
    const mappedMemoryId = this.scopeIdToMemoryIdMap.get(cleanKey) ?? cleanKey

    let doc = await this.engram.getById(mappedMemoryId)
    if (!doc) {
      const all = await this.engram.search({ query: '', project: this.project, limit: 100 })
      const byScopeTag = all.find(
        ({ header }) =>
          header.tags.includes('scope-result') &&
          (header.tags.includes(`scope:${cleanKey}`) || header.id === cleanKey),
      )
      if (byScopeTag) {
        doc = await this.engram.getById(byScopeTag.header.id)
      }
    }

    if (!doc) return undefined

    let sumarioEjecutivo = doc.header.title
    let idScope = this.scopeId
    let findings: ScopeFinding[] = []
    let entregableAtomico: AtomicTaskDeliverable | undefined
    let entregablesSubagentes: SubAgentDeliverableSummary[] | undefined

    for (const record of doc.records) {
      if (record.title === 'sumario_ejecutivo') {
        try {
          const parsed = JSON.parse(record.content) as {
            id_scope?: string
            sumario_ejecutivo?: string
          }
          if (parsed.sumario_ejecutivo) sumarioEjecutivo = parsed.sumario_ejecutivo
          if (parsed.id_scope) idScope = parsed.id_scope
        } catch {
          // Keep header title fallback
        }
      } else if (record.title === 'findings_payload' || record.title === 'suggestions_payload') {
        try {
          const parsed = JSON.parse(record.content) as {
            findings?: ScopeFinding[]
            suggestions?: ScopeFinding[]
          }
          if (Array.isArray(parsed.findings)) {
            findings = parsed.findings
          } else if (Array.isArray(parsed.suggestions)) {
            findings = parsed.suggestions
          }
        } catch {
          // Ignore malformed payload
        }
      } else if (record.title === 'entregable_atomico_payload') {
        try {
          const parsed = JSON.parse(record.content) as {
            entregable_atomico?: AtomicTaskDeliverable
            entregables_subagentes?: SubAgentDeliverableSummary[]
          }
          if (parsed.entregable_atomico) {
            entregableAtomico = parsed.entregable_atomico
          }
          if (Array.isArray(parsed.entregables_subagentes)) {
            entregablesSubagentes = parsed.entregables_subagentes
          }
        } catch {
          // Ignore malformed deliverable payload
        }
      }
    }

    return {
      id_scope: idScope,
      engram_ref: toEngramRef(doc.header.id),
      memoryId: doc.header.id,
      sumario_ejecutivo: sumarioEjecutivo,
      findings,
      fromMemoryCache: true,
      isAggregated: doc.header.type === 'scope-synthesis',
      depth: this.depth,
      ...(entregableAtomico ? { entregable_atomico: entregableAtomico } : {}),
      ...(entregablesSubagentes ? { entregables_subagentes: entregablesSubagentes } : {}),
    }
  }
}

export interface SaveTurnMemoryParams {
  sessionId: number
  userPrompt?: string
  assistantReply: string
  thought?: string
  phase?: string
  tags?: string[]
  store?: MemoryStore
}

/**
 * Persiste un turno conversacional como memoria episódica en `engram-ts`.
 * Permite que el LLM recupere contexto histórico y recuerde decisiones previas.
 */
export async function saveEpisodicTurnMemory(params: SaveTurnMemoryParams): Promise<MemoryHeader> {
  const engram = getPersistentEngram(params.store)
  const preview = (params.userPrompt || params.assistantReply || 'Turno conversacional')
    .slice(0, 90)
    .replace(/\n/g, ' ')
    .trim()
  const phaseLabel = params.phase ? `[${params.phase}] ` : ''
  const title = `Turno Sesión #${params.sessionId} ${phaseLabel}${preview}`

  const records: Array<{ title: string; content: string; tags: string[] }> = []

  if (params.userPrompt && params.userPrompt.trim()) {
    records.push({
      title: 'user_prompt',
      content: params.userPrompt.trim(),
      tags: ['user_prompt', `session:${params.sessionId}`],
    })
  }

  if (params.assistantReply && params.assistantReply.trim()) {
    records.push({
      title: 'assistant_reply',
      content: params.assistantReply.trim(),
      tags: ['assistant_reply', `session:${params.sessionId}`],
    })
  }

  if (params.thought && params.thought.trim()) {
    records.push({
      title: 'reasoning_thought',
      content: params.thought.trim(),
      tags: ['reasoning_thought', `session:${params.sessionId}`],
    })
  }

  if (records.length === 0) {
    records.push({
      title: 'empty_turn',
      content: 'Turno sin contenido textual directo.',
      tags: [`session:${params.sessionId}`],
    })
  }

  const header = await engram.save({
    title,
    type: 'conversational_episode',
    project: `session-${params.sessionId}`,
    tags: [
      'episodic',
      'conversation',
      `session-${params.sessionId}`,
      'localloop',
      ...(params.phase ? [`phase:${normalizeScopeKeyText(params.phase).replace(/\s+/g, '_')}`] : []),
      ...(params.tags ?? []),
    ],
    records,
  })

  trace('engram.turn.saved', {
    sessionId: params.sessionId,
    memoryId: header.id,
    phase: params.phase,
    recordsCount: records.length,
  })

  return header
}

export interface SavePhaseArtifactParams {
  sessionId: number
  phaseName: string
  artifactTitle: string
  artifactType: string
  payload: Record<string, unknown> | string
  tags?: string[]
  store?: MemoryStore
}

/**
 * Persiste artefactos y decisiones de las fases SDLC en `engram-ts`.
 */
export async function saveSdlcPhaseArtifact(params: SavePhaseArtifactParams): Promise<MemoryHeader> {
  const engram = getPersistentEngram(params.store)
  const contentStr =
    typeof params.payload === 'string'
      ? params.payload
      : JSON.stringify(params.payload, null, 2)

  const header = await engram.save({
    title: params.artifactTitle,
    type: params.artifactType,
    project: `session-${params.sessionId}`,
    tags: [
      'sdlc_artifact',
      `phase:${params.phaseName}`,
      `session-${params.sessionId}`,
      'localloop',
      ...(params.tags ?? []),
    ],
    records: [
      {
        title: `${params.artifactType}_payload`,
        content: contentStr,
        tags: [params.artifactType, `phase:${params.phaseName}`],
      },
    ],
  })

  trace('engram.sdlc_phase_saved', {
    sessionId: params.sessionId,
    phaseName: params.phaseName,
    memoryId: header.id,
    title: params.artifactTitle,
  })

  return header
}

export interface RetrieveMemoryContextParams {
  query: string
  project?: string
  limit?: number
  store?: MemoryStore
}

/**
 * Busca y recupera memorias relevantes en `engram-ts` para alimentar el prompt del LLM.
 */
export async function retrieveEngramMemoryContext(
  params: RetrieveMemoryContextParams,
): Promise<string> {
  const engram = getPersistentEngram(params.store)
  const limit = params.limit ?? 4

  let results: MemorySearchResult[] = []
  const cleanQuery = params.query.replace(/[^a-zA-Z0-9_\-áéíóúÁÉÍÓÚñÑ ]/g, ' ').trim()

  if (cleanQuery.length > 2) {
    try {
      results = await engram.search({
        query: cleanQuery,
        project: params.project,
        limit,
      })
    } catch {
      results = []
    }
  }

  // Fallback 1: Buscar en el proyecto
  if (results.length === 0 && params.project) {
    try {
      results = await engram.search({
        query: '',
        project: params.project,
        limit,
      })
    } catch {
      results = []
    }
  }

  // Fallback 2: Buscar cualquier memoria reciente en el sistema
  if (results.length === 0) {
    try {
      results = await engram.search({
        query: '',
        limit,
      })
    } catch {
      results = []
    }
  }

  if (results.length === 0) {
    return ''
  }

  const memoryBlocks: string[] = []
  for (const r of results.slice(0, limit)) {
    try {
      const doc = await engram.getById(r.header.id)
      if (!doc || doc.records.length === 0) continue

      const firstRecord = doc.records[0]
      const snippet =
        firstRecord.content.length > 450
          ? `${firstRecord.content.slice(0, 450)}... [continúa en engram]`
          : firstRecord.content

      memoryBlocks.push(
        `- **Memoria [${doc.header.type}]**: ${doc.header.title}\n  *Tags:* ${doc.header.tags.join(', ')}\n  *Detalle:* ${snippet.replace(/\n+/g, ' ')}`,
      )
    } catch {
      // Ignorar fallos puntuales
    }
  }

  if (memoryBlocks.length === 0) {
    return ''
  }

  return `\n\n[MEMORIA EPISÓDICA / CONTEXTO PREVIO RECUPERADO DE ENGRAM-TS]:\n` + memoryBlocks.join('\n\n')
}

