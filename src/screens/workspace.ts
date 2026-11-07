import { heroIcon } from '../config/heroicons'
import { SessionStatus, type SessionStatus as SessionStatusType } from '../enums'
import {
  getWorkspaceDirectoryHandle,
  listWorkspaceFiles,
  pickWorkspaceDirectory,
  readWorkspaceFile,
  restoreSavedWorkspaceDirectory,
} from '../fs/workspace-fs'
import { t, translateStatus } from '../i18n'
import {
  getSessionById,
  listSessionMessages,
  updateSessionTitle,
  type StoredChatMessage,
} from '../memory/app-db'
import {
  cancelAgentSession,
  getSessionThinkingState,
  isSessionRunning,
  onAgentStreamChunk,
  onAgentThinking,
  runAgentSessionTurn,
  syncWorkerEnvironment,
  type AgentStreamChunkEvent,
} from '../worker/agent-bridge'
import { bindLangToggle, renderLangToggle, renderSidebar, statusClass, toggleTheme } from './shared'
import type { Phase0ThreeStepData, SolutionComponentMapping } from '../agent/sdlc-state'

let isFileDrawerOpen = false
let selectedFilePath = ''
let activeStreamListener: (() => void) | undefined
let activeThinkingListener: (() => void) | undefined
let activeStreamBatcher: StreamingQueueBatcher | undefined

// Estado del Wizard de 3 Pasos de la Fase 0
let phase0SubStep = 1
let isMarkdownView = false
const p0State = {
  featureTitle: 'Emisión de Facturación Electrónica B2B',
  // Paso 1: Negocio
  rawBusinessLanguageText:
    'Como dirección de operaciones, necesitamos emitir facturas electrónicas conformes a la normativa fiscal de forma automática al confirmar un pedido, garantizando firma digital y trazabilidad contable para evitar sanciones y reducir el tiempo de cobro en un 40%.',
  needsList: [
    {
      id: 'NEED-1',
      description: 'Generación automática del XML firmado digitalmente según la normativa fiscal.',
      expectedImpact: 'Cero errores de formato y cumplimiento legal inmediato.',
    },
    {
      id: 'NEED-2',
      description: 'Integración síncrona con el sistema de contabilidad y ERP corporativo.',
      expectedImpact: 'Reducción de 48h a segundos en el registro del asiento contable.',
    },
  ],
  // Paso 2: Arquitectura Empresarial (As-Is / To-Be / Transición)
  marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
  mcpUrl: '',
  currentSituationTitle: 'ERP Monolítico on-premise con módulos legados en base de datos centralizada.',
  currentSituationLimitations: [
    'Bloqueos por transacciones lentas en horas punta.',
    'No dispone de conector seguro con la autoridad tributaria vía API.',
    'Coste de mantenimiento muy elevado y falta de modularidad.',
  ],
  desiredSituationTitle: 'Arquitectura orientada a eventos con microservicios desacoplados y API Gateway.',
  desiredSituationCapabilities: [
    'Generador de XML/UBL agnóstico con firma XAdES/CAdES en milisegundos.',
    'Publicación de eventos de facturación en Event Bus para auditoría y ERP.',
    'Escalabilidad elástica y observabilidad completa.',
  ],
  transitionSituationTitle: 'Adaptador de convivencia: Fachada API sobre ERP para emitir facturas mientras se migra.',
  transitionMilestones: [
    'Hito 1: Desplegar microservicio de firma digital invocado desde el monolito.',
    'Hito 2: Desviar el 100% de la facturación electrónica al nuevo módulo antes de desmantelar el módulo legado.',
  ],
  // Paso 3: Arquitectura de Soluciones
  components: [
    {
      componentId: 'comp_billing_core',
      name: 'Motor Core de Facturación & Reglas de Negocio',
      action: 'CREATE' as const,
      targetState: 'DESIRED' as const,
      description: 'Cálculo de impuestos, retenciones y validaciones fiscales.',
      dependsOn: [],
    },
    {
      componentId: 'comp_digital_signature',
      name: 'Servicio Criptográfico de Firma Digital',
      action: 'CREATE' as const,
      targetState: 'DESIRED' as const,
      description: 'Gestión de certificados y firmado electrónico XAdES.',
      dependsOn: ['comp_billing_core'],
    },
    {
      componentId: 'comp_erp_adapter',
      name: 'Adaptador de Convivencia ERP / Transición',
      action: 'EVOLVE' as const,
      targetState: 'TRANSITION' as const,
      description: 'Sincronización bidireccional con el ERP legado.',
      dependsOn: ['comp_billing_core'],
    },
  ] as SolutionComponentMapping[],
}

function generateP0Markdown(state: typeof p0State): string {
  let md = `# Especificación de Fase 0: Descubrimiento y Arquitectura\n\n`
  md += `## 1. Necesidades de Negocio\n`
  md += `* **Iniciativa:** ${state.featureTitle}\n`
  md += `* **Narrativa:**\n${state.rawBusinessLanguageText}\n\n`
  md += `### Lista de Necesidades de Negocio\n`
  state.needsList.forEach((n, idx) => {
    md += `${idx + 1}. **${n.id || `NEED-${idx + 1}`}**: ${n.description} *(Impacto: ${n.expectedImpact})*\n`
  })

  md += `\n## 2. Arquitectura Empresarial (Caso de Negocio)\n`
  md += `* **Marco Estándar:** ${state.marketStandard}\n`
  if (state.mcpUrl) md += `* **Conexión MCP:** ${state.mcpUrl}\n`
  md += `\n### Situación Actual (As-Is)\n`
  md += `${state.currentSituationTitle}\n`
  state.currentSituationLimitations.forEach((l) => {
    md += `- [Limitación]: ${l}\n`
  })

  md += `\n### Situación Deseada (To-Be)\n`
  md += `${state.desiredSituationTitle}\n`
  state.desiredSituationCapabilities.forEach((c) => {
    md += `- [Capacidad Objetivo]: ${c}\n`
  })

  if (state.transitionSituationTitle || state.transitionMilestones.length > 0) {
    md += `\n### Situación de Transición (Estadio Intermedio)\n`
    md += `${state.transitionSituationTitle}\n`
    state.transitionMilestones.forEach((m) => {
      md += `- [Hito]: ${m}\n`
    })
  }

  md += `\n## 3. Arquitectura de Soluciones & Componentes\n`
  state.components.forEach((c) => {
    md += `- **[${c.action}] ${c.name}** (\`${c.componentId}\` - ${c.targetState})\n`
    md += `  - Depende de: ${c.dependsOn.join(', ') || 'Ninguno'}\n`
    md += `  - Descripción: ${c.description}\n`
  })

  return md
}

function parseP0Markdown(raw: string): void {
  if (!raw || raw.trim().length === 0) return

  const titleMatch = raw.match(/\*\s*\*\*Iniciativa:\*\*\s*(.*)/i)
  if (titleMatch && titleMatch[1]?.trim()) {
    p0State.featureTitle = titleMatch[1].trim()
  }

  const narrativeMatch = raw.match(/\*\s*\*\*Narrativa:\*\*\s*\n([\s\S]*?)(?=\n###|\n##|$)/i)
  if (narrativeMatch && narrativeMatch[1]?.trim()) {
    p0State.rawBusinessLanguageText = narrativeMatch[1].trim()
  }

  const marcoMatch = raw.match(/\*\s*\*\*Marco Estándar:\*\*\s*([^\n|]+)/i)
  if (marcoMatch && marcoMatch[1]?.trim()) {
    const m = marcoMatch[1].trim()
    if (['C4_AND_CLEAN_ARCHITECTURE', 'HEXAGONAL_ARCHITECTURE', 'DOMAIN_DRIVEN_DESIGN', 'TOGAF_ENTERPRISE_ARCH'].includes(m)) {
      p0State.marketStandard = m
    }
  }

  const mcpMatch = raw.match(/\*\s*\*\*Conexión MCP:\*\*\s*(https?:\/\/[^\s\n]+)/i)
  if (mcpMatch && mcpMatch[1]?.trim()) {
    p0State.mcpUrl = mcpMatch[1].trim()
  }

  const needsMatches = Array.from(raw.matchAll(/\d+\.\s+\*\*([^*]+)\*\*:\s*(.*?)(?:\s*\*\(Impacto:\s*(.*?)\*\))?$/gim))
  if (needsMatches.length > 0) {
    p0State.needsList = needsMatches.map((m) => ({
      id: m[1]?.trim() || `NEED-${Math.random().toString(36).slice(2, 6)}`,
      description: m[2]?.trim() || '',
      expectedImpact: m[3]?.trim() || '',
    }))
  }

  const asIsBlock = raw.match(/### Situación Actual \(As-Is\)\s*\n([\s\S]*?)(?=\n###|\n##|$)/i)
  if (asIsBlock && asIsBlock[1]) {
    const lines = asIsBlock[1].split('\n').map((l) => l.trim()).filter(Boolean)
    const titleLine = lines.find((l) => !l.startsWith('-'))
    if (titleLine) p0State.currentSituationTitle = titleLine
    const limitLines = lines.filter((l) => l.startsWith('-'))
    if (limitLines.length > 0) {
      p0State.currentSituationLimitations = limitLines.map((l) =>
        l.replace(/^-\s*(\[Limitación\]:\s*)?/i, '').trim(),
      )
    }
  }

  const toBeBlock = raw.match(/### Situación Deseada \(To-Be\)\s*\n([\s\S]*?)(?=\n###|\n##|$)/i)
  if (toBeBlock && toBeBlock[1]) {
    const lines = toBeBlock[1].split('\n').map((l) => l.trim()).filter(Boolean)
    const titleLine = lines.find((l) => !l.startsWith('-'))
    if (titleLine) p0State.desiredSituationTitle = titleLine
    const capLines = lines.filter((l) => l.startsWith('-'))
    if (capLines.length > 0) {
      p0State.desiredSituationCapabilities = capLines.map((l) =>
        l.replace(/^-\s*(\[Capacidad Objetivo\]:\s*)?/i, '').trim(),
      )
    }
  }

  const transBlock = raw.match(/### Situación de Transición[^\n]*\s*\n([\s\S]*?)(?=\n###|\n##|$)/i)
  if (transBlock && transBlock[1]) {
    const lines = transBlock[1].split('\n').map((l) => l.trim()).filter(Boolean)
    const titleLine = lines.find((l) => !l.startsWith('-'))
    if (titleLine) p0State.transitionSituationTitle = titleLine
    const mileLines = lines.filter((l) => l.startsWith('-'))
    if (mileLines.length > 0) {
      p0State.transitionMilestones = mileLines.map((l) =>
        l.replace(/^-\s*(\[Hito\]:\s*)?/i, '').trim(),
      )
    }
  }

  const compRegex = /-\s*\*\*\[(CREATE|EVOLVE)\]\s*(.*?)\*\*\s*\(`([^`]+)`\s*-\s*(DESIRED|TRANSITION)\)([\s\S]*?)(?=\n-\s*\*\*\[|\n##|$)/gi
  const compMatches = Array.from(raw.matchAll(compRegex))
  if (compMatches.length > 0) {
    p0State.components = compMatches.map((m) => {
      const action = m[1].toUpperCase() as 'CREATE' | 'EVOLVE'
      const name = m[2].trim()
      const componentId = m[3].trim()
      const targetState = m[4].toUpperCase() as 'DESIRED' | 'TRANSITION'
      const details = m[5] || ''
      const depsMatch = details.match(/Depende de:\s*([^\n]+)/i)
      const descMatch = details.match(/Descripción:\s*([^\n]+)/i)
      const dependsOn = depsMatch && depsMatch[1]?.trim() !== 'Ninguno'
        ? depsMatch[1].split(',').map((s) => s.trim()).filter(Boolean)
        : []
      const description = descMatch ? descMatch[1].trim() : ''
      return {
        componentId,
        name,
        action,
        targetState,
        description,
        dependsOn,
      }
    })
  }
}

function syncP0StateFromDom(root: HTMLElement): void {
  if (isMarkdownView) {
    const mdArea = root.querySelector<HTMLTextAreaElement>('#p0-markdown-textarea')
    if (mdArea) {
      parseP0Markdown(mdArea.value)
    }
    return
  }

  // 1. Negocio
  const titleIn = root.querySelector<HTMLInputElement>('#step1-title-input')
  if (titleIn && titleIn.value.trim().length > 0) p0State.featureTitle = titleIn.value.trim()
  const rawIn = root.querySelector<HTMLTextAreaElement>('#step1-raw-text-input')
  if (rawIn) p0State.rawBusinessLanguageText = rawIn.value.trim()

  root.querySelectorAll<HTMLInputElement>('[data-need-desc]').forEach((input) => {
    const idx = Number(input.dataset.needDesc)
    if (p0State.needsList[idx]) p0State.needsList[idx].description = input.value
  })
  root.querySelectorAll<HTMLInputElement>('[data-need-impact]').forEach((input) => {
    const idx = Number(input.dataset.needImpact)
    if (p0State.needsList[idx]) p0State.needsList[idx].expectedImpact = input.value
  })

  // 2. Arquitectura Empresarial
  const stdIn = root.querySelector<HTMLSelectElement>('#step2-standard-select')
  if (stdIn) p0State.marketStandard = stdIn.value
  const mcpIn = root.querySelector<HTMLInputElement>('#step2-mcp-input')
  if (mcpIn) p0State.mcpUrl = mcpIn.value.trim()
  const curIn = root.querySelector<HTMLInputElement>('#step2-cur-title')
  if (curIn) p0State.currentSituationTitle = curIn.value.trim()

  root.querySelectorAll<HTMLInputElement>('[data-cur-limit]').forEach((input) => {
    const idx = Number(input.dataset.curLimit)
    if (idx < p0State.currentSituationLimitations.length) {
      p0State.currentSituationLimitations[idx] = input.value
    }
  })

  const desIn = root.querySelector<HTMLInputElement>('#step2-des-title')
  if (desIn) p0State.desiredSituationTitle = desIn.value.trim()

  root.querySelectorAll<HTMLInputElement>('[data-des-cap]').forEach((input) => {
    const idx = Number(input.dataset.desCap)
    if (idx < p0State.desiredSituationCapabilities.length) {
      p0State.desiredSituationCapabilities[idx] = input.value
    }
  })

  const transIn = root.querySelector<HTMLInputElement>('#step2-trans-title')
  if (transIn) p0State.transitionSituationTitle = transIn.value.trim()

  root.querySelectorAll<HTMLInputElement>('[data-trans-mile]').forEach((input) => {
    const idx = Number(input.dataset.transMile)
    if (idx < p0State.transitionMilestones.length) {
      p0State.transitionMilestones[idx] = input.value
    }
  })

  // 3. Componentes
  root.querySelectorAll<HTMLInputElement>('[data-comp-name]').forEach((input) => {
    const idx = Number(input.dataset.compName)
    if (p0State.components[idx]) p0State.components[idx].name = input.value
  })
  root.querySelectorAll<HTMLSelectElement>('[data-comp-action]').forEach((sel) => {
    const idx = Number(sel.dataset.compAction)
    if (p0State.components[idx]) p0State.components[idx].action = sel.value as 'CREATE' | 'EVOLVE'
  })
  root.querySelectorAll<HTMLSelectElement>('[data-comp-state]').forEach((sel) => {
    const idx = Number(sel.dataset.compState)
    if (p0State.components[idx]) p0State.components[idx].targetState = sel.value as 'DESIRED' | 'TRANSITION'
  })
  root.querySelectorAll<HTMLInputElement>('[data-comp-id]').forEach((input) => {
    const idx = Number(input.dataset.compId)
    if (p0State.components[idx]) p0State.components[idx].componentId = input.value
  })
  root.querySelectorAll<HTMLInputElement>('[data-comp-deps]').forEach((input) => {
    const idx = Number(input.dataset.compDeps)
    if (p0State.components[idx]) {
      p0State.components[idx].dependsOn = input.value
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    }
  })
  root.querySelectorAll<HTMLInputElement>('[data-comp-desc]').forEach((input) => {
    const idx = Number(input.dataset.compDesc)
    if (p0State.components[idx]) p0State.components[idx].description = input.value
  })
}

function loadExampleTemplate(): void {
  p0State.featureTitle = 'Emisión de Facturación Electrónica B2B'
  p0State.rawBusinessLanguageText =
    'Como dirección de operaciones, necesitamos emitir facturas electrónicas conformes a la normativa fiscal de forma automática al confirmar un pedido, garantizando firma digital y trazabilidad contable para evitar sanciones y reducir el tiempo de cobro en un 40%.'
  p0State.needsList = [
    {
      id: 'NEED-1',
      description: 'Generación automática del XML firmado digitalmente según la normativa fiscal.',
      expectedImpact: 'Cero errores de formato y cumplimiento legal inmediato.',
    },
    {
      id: 'NEED-2',
      description: 'Integración síncrona con el sistema de contabilidad y ERP corporativo.',
      expectedImpact: 'Reducción de 48h a segundos en el registro del asiento contable.',
    },
  ]
  p0State.marketStandard = 'C4_AND_CLEAN_ARCHITECTURE'
  p0State.mcpUrl = 'http://localhost:3000/sse'
  p0State.currentSituationTitle = 'ERP Monolítico on-premise con módulos legados en base de datos centralizada.'
  p0State.currentSituationLimitations = [
    'Bloqueos por transacciones lentas en horas punta.',
    'No dispone de conector seguro con la autoridad tributaria vía API.',
    'Coste de mantenimiento muy elevado y falta de modularidad.',
  ]
  p0State.desiredSituationTitle = 'Arquitectura orientada a eventos con microservicios desacoplados y API Gateway.'
  p0State.desiredSituationCapabilities = [
    'Generador de XML/UBL agnóstico con firma XAdES/CAdES en milisegundos.',
    'Publicación de eventos de facturación en Event Bus para auditoría y ERP.',
    'Escalabilidad elástica y observabilidad completa.',
  ]
  p0State.transitionSituationTitle = 'Adaptador de convivencia: Fachada API sobre ERP para emitir facturas mientras se migra.'
  p0State.transitionMilestones = [
    'Hito 1: Desplegar microservicio de firma digital invocado desde el monolito.',
    'Hito 2: Desviar el 100% de la facturación electrónica al nuevo módulo antes de desmantelar el módulo legado.',
  ]
  p0State.components = [
    {
      componentId: 'comp_billing_core',
      name: 'Motor Core de Facturación & Reglas de Negocio',
      action: 'CREATE',
      targetState: 'DESIRED',
      description: 'Cálculo de impuestos, retenciones y validaciones fiscales.',
      dependsOn: [],
    },
    {
      componentId: 'comp_digital_signature',
      name: 'Servicio Criptográfico de Firma Digital',
      action: 'CREATE',
      targetState: 'DESIRED',
      description: 'Gestión de certificados y firmado electrónico XAdES.',
      dependsOn: ['comp_billing_core'],
    },
    {
      componentId: 'comp_erp_adapter',
      name: 'Adaptador de Convivencia ERP / Transición',
      action: 'EVOLVE',
      targetState: 'TRANSITION',
      description: 'Sincronización bidireccional con el ERP legado.',
      dependsOn: ['comp_billing_core'],
    },
  ]
}

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderFormattedMarkdown(raw: string): string {
  let html = escapeHtml(raw)

  // Headers: ### Header
  html = html.replace(/^### (.*$)/gim, '<h3 class="text-xs font-bold uppercase tracking-wider text-primary mt-3 mb-1.5">$1</h3>')
  html = html.replace(/^## (.*$)/gim, '<h2 class="text-sm font-bold text-text-primary mt-3 mb-2">$1</h2>')
  html = html.replace(/^# (.*$)/gim, '<h1 class="text-base font-bold text-text-primary mt-3 mb-2">$1</h1>')

  // Negrita: **texto**
  html = html.replace(/\*\*(.*?)\*\*/gim, '<strong class="font-semibold text-text-primary">$1</strong>')

  // Código en línea: `código`
  html = html.replace(/`([^`]+)`/gim, '<code class="rounded bg-bg-app px-1.5 py-0.5 font-mono text-[11px] text-accent border border-border-default">$1</code>')

  // Listas ordenadas: 1. Item...
  html = html.replace(
    /^(\d+)\.\s+(.*$)/gim,
    '<div class="flex items-start gap-2.5 my-1.5"><span class="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10 text-[10px] font-bold text-primary mt-0.5">$1</span><div class="leading-relaxed text-xs text-text-primary">$2</div></div>',
  )

  // Viñetas anidadas (con 2 o más espacios de sangría):   - Item o   * Item
  html = html.replace(
    /^\s{2,}[\*\-]\s+(.*$)/gim,
    '<div class="flex items-start gap-2 my-1 ml-4"><span class="h-1.5 w-1.5 rounded-full bg-primary/60 shrink-0 mt-1.5"></span><div class="leading-relaxed text-xs text-text-secondary">$1</div></div>',
  )

  // Viñetas estándar: - Item o * Item
  html = html.replace(
    /^\s*[\*\-]\s+(.*$)/gim,
    '<div class="flex items-start gap-2 my-1"><span class="h-1.5 w-1.5 rounded-full bg-primary shrink-0 mt-1.5"></span><div class="leading-relaxed text-xs text-text-primary">$1</div></div>',
  )

  // Párrafos y saltos de línea estructurados
  html = html.replace(/\n\n+/g, '<div class="h-2"></div>')

  return html
}

function renderMessageItem(msg: StoredChatMessage): string {
  if (msg.role === 'user') {
    return `
      <div data-message-role="user" data-message-content="${escapeHtml(msg.content)}" class="ml-auto max-w-3xl w-full rounded-2xl rounded-tr-sm border border-primary/30 bg-primary/[0.06] dark:bg-primary/[0.12] p-5 text-xs text-text-primary shadow-sm space-y-3 transition-all">
        <div class="flex items-center justify-between border-b border-primary/20 pb-2 text-[11px]">
          <div class="flex items-center gap-1.5 font-bold text-primary">
            ${heroIcon('sparkles', 'h-3.5 w-3.5 text-primary')}
            <span>Tú (Usuario)</span>
          </div>
          <span class="rounded bg-primary/15 border border-primary/25 px-2 py-0.5 font-mono text-[10px] font-semibold text-primary">
            Prompt / Definición
          </span>
        </div>
        <div class="leading-relaxed space-y-2 text-text-primary">
          ${renderFormattedMarkdown(msg.content)}
        </div>
      </div>
    `
  }

  if (msg.role === 'tool') {
    return `
      <div data-message-role="tool" data-message-content="${escapeHtml(msg.content)}" class="max-w-3xl w-full rounded-xl border border-border-default bg-bg-app/80 px-4 py-3 font-mono text-[11px] text-text-secondary">
        <div class="flex items-center gap-2 text-accent">
          ${heroIcon('wrench-screwdriver', 'h-3.5 w-3.5')}
          <span class="font-semibold">${escapeHtml(msg.toolName ?? 'tool')}</span>
        </div>
        <pre class="mt-2 max-h-40 overflow-auto whitespace-pre-wrap text-[10px] text-text-muted">${escapeHtml(msg.content)}</pre>
      </div>
    `
  }

  return `
    <div data-message-role="assistant" data-message-content="${escapeHtml(msg.content)}" class="max-w-3xl w-full rounded-2xl border border-border-default bg-bg-card p-6 text-xs text-text-primary shadow-sm space-y-3">
      ${msg.thought
      ? `
            <details class="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-text-secondary">
              <summary class="cursor-pointer font-semibold text-primary select-none">Razonamiento del Agente (&lt;think&gt;)</summary>
              <pre class="mt-2 whitespace-pre-wrap font-mono text-[10px] text-text-muted">${escapeHtml(msg.thought)}</pre>
            </details>
          `
      : ''
    }
      <div class="leading-relaxed space-y-2 text-text-secondary">${renderFormattedMarkdown(msg.content)}</div>
    </div>
  `
}

export type PhaseLifecycleStatus = 'completed' | 'active' | 'waiting' | 'pending'

export interface SdlcPhaseItem {
  id: number
  label: string
  sublabel: string
  status: PhaseLifecycleStatus
}

export function computeSdlcPhasesState(params: {
  sessionStatus: SessionStatusType
  turnsUsed: number
  messages: StoredChatMessage[]
  running: boolean
  isThinking?: boolean
  thinkingPhase?: string
  thinkingThought?: string
  liveStreamPhase?: string
}): SdlcPhaseItem[] {
  const { sessionStatus, turnsUsed, messages, running, thinkingThought, liveStreamPhase } = params

  const isCompleted = sessionStatus === SessionStatus.COMPLETED

  const lastMsg = messages[messages.length - 1]?.content ?? ''
  const isPhase0Waiting =
    !isCompleted &&
    (lastMsg.includes('Fase 0: Descubrimiento') || messages.length <= 1)
  const isPhase4Waiting =
    !isCompleted &&
    (lastMsg.includes('Fase 4: Solicitud de Aprobación Formal de Negocio') ||
      lastMsg.includes('Aprobación Formal de Negocio') ||
      sessionStatus === SessionStatus.WAITING_APPROVAL)

  // Historial global de mensajes acumulados
  const allText = messages.map((m) => m.content).join('\n')
  const liveIndicator = `${liveStreamPhase || ''} ${thinkingThought || ''}`.toLowerCase()

  const hasP0Done =
    isCompleted ||
    allText.includes('Definición Formal de Fase 0') ||
    allText.includes('Fase 1: Alineamiento') ||
    (turnsUsed >= 1 && !isPhase0Waiting)

  const hasP1Done =
    isCompleted ||
    allText.includes('Fase 2: Diseño') ||
    allText.includes('Fase 2: Dictamen Gatekeeper')

  const hasP2Done =
    isCompleted ||
    allText.includes('Fase 3: Construcción') ||
    allText.includes('Fase 3: Pruebas Unitarias')

  const hasP3Done =
    isCompleted ||
    allText.includes('Fase 4: Integración E2E') ||
    allText.includes('Fase 4: Solicitud de Aprobación')

  const hasP4Done =
    isCompleted ||
    allText.includes('Aprobación formal de negocio concedida') ||
    allText.includes('Fase 5 & 6: Cierre') ||
    allText.includes('Fase 6')

  const hasP5Done =
    isCompleted ||
    allText.includes('Fase 5 & 6: Cierre') ||
    allText.includes('Fase 6')

  const hasP6Done = isCompleted || allText.includes('Ciclo de desarrollo completado con éxito')

  // Identificación precisa de la fase en tiempo real mientras el modelo genera deltas
  let activeLivePhaseNumber = -1
  if (running) {
    if (
      liveIndicator.includes('fase 6') ||
      liveIndicator.includes('fase 5 & 6') ||
      liveIndicator.includes('cierre y proyección') ||
      liveIndicator.includes('sincronizador de documentación')
    ) {
      activeLivePhaseNumber = 6
    } else if (liveIndicator.includes('fase 5') || liveIndicator.includes('resiliencia')) {
      activeLivePhaseNumber = 5
    } else if (
      liveIndicator.includes('fase 4') ||
      liveIndicator.includes('integración e2e') ||
      liveIndicator.includes('auditoría de negocio')
    ) {
      activeLivePhaseNumber = 4
    } else if (
      liveIndicator.includes('fase 3') ||
      liveIndicator.includes('construcción') ||
      liveIndicator.includes('pruebas unitarias') ||
      liveIndicator.includes('sandbox js') ||
      liveIndicator.includes('typescript')
    ) {
      activeLivePhaseNumber = 3
    } else if (
      liveIndicator.includes('fase 2') ||
      liveIndicator.includes('diseño técnico') ||
      liveIndicator.includes('gatekeeper')
    ) {
      activeLivePhaseNumber = 2
    } else if (
      liveIndicator.includes('fase 1') ||
      liveIndicator.includes('alineamiento') ||
      liveIndicator.includes('dag') ||
      liveIndicator.includes('planificación')
    ) {
      activeLivePhaseNumber = 1
    } else if (liveIndicator.includes('fase 0') || liveIndicator.includes('descubrimiento')) {
      activeLivePhaseNumber = 0
    }
  }

  // Estado Fase 0
  let p0Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP0Done || activeLivePhaseNumber > 0) {
    p0Status = 'completed'
  } else if (isPhase0Waiting) {
    p0Status = 'waiting'
  } else if (running && (activeLivePhaseNumber === 0 || activeLivePhaseNumber === -1)) {
    p0Status = 'active'
  }

  // Estado Fase 1
  let p1Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP1Done || activeLivePhaseNumber > 1) {
    p1Status = 'completed'
  } else if (activeLivePhaseNumber === 1 || (running && hasP0Done && !hasP1Done && activeLivePhaseNumber <= 1)) {
    p1Status = 'active'
  } else if (hasP0Done && !hasP1Done && !running) {
    p1Status = allText.includes('Fase 1: Alineamiento') ? 'completed' : 'pending'
  }

  // Estado Fase 2
  let p2Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP2Done || activeLivePhaseNumber > 2) {
    p2Status = 'completed'
  } else if (activeLivePhaseNumber === 2 || (running && hasP1Done && !hasP2Done && activeLivePhaseNumber <= 2)) {
    p2Status = 'active'
  }

  // Estado Fase 3
  let p3Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP3Done || activeLivePhaseNumber > 3) {
    p3Status = 'completed'
  } else if (activeLivePhaseNumber === 3 || (running && hasP2Done && !hasP3Done && activeLivePhaseNumber <= 3)) {
    p3Status = 'active'
  }

  // Estado Fase 4
  let p4Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP4Done || activeLivePhaseNumber > 4) {
    p4Status = 'completed'
  } else if (isPhase4Waiting) {
    p4Status = 'waiting'
  } else if (activeLivePhaseNumber === 4 || (running && hasP3Done && !hasP4Done && activeLivePhaseNumber <= 4)) {
    p4Status = 'active'
  }

  // Estado Fase 5
  let p5Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP5Done || activeLivePhaseNumber > 5) {
    p5Status = 'completed'
  } else if (activeLivePhaseNumber === 5) {
    p5Status = 'active'
  }

  // Estado Fase 6
  let p6Status: PhaseLifecycleStatus = 'pending'
  if (isCompleted || hasP6Done) {
    p6Status = 'completed'
  } else if (activeLivePhaseNumber === 6 || (running && hasP4Done && !isCompleted)) {
    p6Status = 'active'
  }

  return [
    { id: 0, label: '0. Descubrimiento', sublabel: 'HITL 1', status: p0Status },
    { id: 1, label: '1. Estrategia & Plan', sublabel: 'DAG', status: p1Status },
    { id: 2, label: '2. Diseño & Gatekeeper', sublabel: 'Clean Arch', status: p2Status },
    { id: 3, label: '3. Construcción & Unit', sublabel: 'Sandbox JS', status: p3Status },
    { id: 4, label: '4. E2E & Negocio', sublabel: 'HITL 2', status: p4Status },
    { id: 5, label: '5. Resiliencia', sublabel: 'RCA / Deuda', status: p5Status },
    { id: 6, label: '6. Cierre & Docs', sublabel: 'doc/ y src/', status: p6Status },
  ]
}

export function renderLifecycleStepperHtml(phases: SdlcPhaseItem[]): string {
  return phases
    .map((p, idx) => {
      let badgeStyle = ''
      let icon = ''
      switch (p.status) {
        case 'completed':
          badgeStyle =
            'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 font-semibold shadow-sm'
          icon = heroIcon('check', 'h-3.5 w-3.5 text-emerald-400 shrink-0 inline-block mr-1')
          break
        case 'active':
          badgeStyle =
            'border-2 border-primary bg-primary/20 text-primary font-bold shadow-md shadow-primary/25 animate-pulse'
          icon =
            '<span class="inline-block h-2 w-2 rounded-full bg-primary animate-ping mr-1.5 shrink-0"></span>'
          break
        case 'waiting':
          badgeStyle =
            'border-2 border-amber-500 bg-amber-500/20 text-amber-300 font-bold shadow-md shadow-amber-500/30 animate-pulse'
          icon = heroIcon('exclamation-triangle', 'h-3.5 w-3.5 text-amber-300 shrink-0 inline-block mr-1')
          break
        case 'pending':
        default:
          badgeStyle = 'border-border-default/60 bg-bg-card/40 text-text-muted/60'
          icon = '<span class="inline-block h-1.5 w-1.5 rounded-full bg-text-muted/30 mr-1.5 shrink-0"></span>'
          break
      }

      const arrow =
        idx < phases.length - 1
          ? `<span class="shrink-0 text-xs ${p.status === 'completed'
            ? 'text-emerald-500/80 font-bold'
            : p.status === 'active'
              ? 'text-primary font-bold'
              : 'text-text-muted/30'
          }">→</span>`
          : ''

      return `
        <div class="flex items-center gap-2 shrink-0">
          <div class="inline-flex items-center rounded-lg border px-2.5 py-1 text-[11px] transition-all duration-300 ${badgeStyle}" title="${p.sublabel}">
            ${icon}
            <span class="whitespace-nowrap">${p.label}</span>
          </div>
          ${arrow}
        </div>
      `
    })
    .join('')
}

export function updateLifecycleStepperInDom(
  root: HTMLElement,
  sessionId: number,
  livePhase?: string,
): void {
  const container = root.querySelector<HTMLElement>('#sdlc-lifecycle-stepper')
  if (!container) return

  const running = isSessionRunning(sessionId)
  const thinkingState = getSessionThinkingState(sessionId)

  const messageNodes = root.querySelectorAll<HTMLElement>('[data-message-role]')
  const messageTexts: StoredChatMessage[] = Array.from(messageNodes).map((node) => ({
    role: (node.dataset.messageRole as any) || 'assistant',
    content: node.dataset.messageContent || node.textContent || '',
    sessionId,
    createdAt: new Date().toISOString(),
  }))

  const headerStatusEl = root.querySelector('#session-title-header')?.parentElement
  const isCompleted = headerStatusEl?.textContent?.includes('Completado') ?? false

  const phases = computeSdlcPhasesState({
    sessionStatus: isCompleted
      ? SessionStatus.COMPLETED
      : running
        ? SessionStatus.RUNNING
        : SessionStatus.IDLE,
    turnsUsed: messageTexts.length,
    messages: messageTexts,
    running,
    isThinking: Boolean(thinkingState?.isThinking),
    thinkingPhase: thinkingState?.phase,
    thinkingThought: thinkingState?.thought,
    liveStreamPhase: livePhase,
  })

  container.innerHTML = renderLifecycleStepperHtml(phases)
}

interface QueuedChunk {
  sessionId: number
  contentSoFar: string
  delta: string
  thought?: string
  phase?: string
  receivedAt: number
}

/**
 * Cola de Streaming selectiva que acumula los deltas de SSE y actualiza
 * el DOM cada 1000 ms de forma quirúrgica sin alterar la responsividad general.
 */
class StreamingQueueBatcher {
  private latestChunk: QueuedChunk | null = null
  private timer: any = null
  private root: HTMLElement | null = null
  private sessionId = 0
  private isDirty = false
  private readonly INTERVAL_MS = 1000

  start(sessionId: number, root: HTMLElement) {
    this.stop()
    this.sessionId = sessionId
    this.root = root
    this.latestChunk = null
    this.isDirty = false

    this.timer = setInterval(() => {
      this.flush()
    }, this.INTERVAL_MS)
  }

  enqueue(chunk: AgentStreamChunkEvent) {
    if (chunk.sessionId !== this.sessionId) return
    this.latestChunk = {
      ...chunk,
      receivedAt: Date.now(),
    }
    this.isDirty = true
  }

  flush() {
    if (!this.isDirty || !this.latestChunk || !this.root) return
    this.isDirty = false
    this.applySelectiveDomUpdate(this.latestChunk)
  }

  private applySelectiveDomUpdate(chunk: QueuedChunk) {
    if (!this.root) return
    const scrollContainer = this.root.querySelector<HTMLElement>('#chat-messages-scroll')
    if (!scrollContainer) return

    let bubble = scrollContainer.querySelector<HTMLElement>(`#live-streaming-bubble-${this.sessionId}`)
    if (!bubble) {
      bubble = document.createElement('div')
      bubble.id = `live-streaming-bubble-${this.sessionId}`
      bubble.className =
        'max-w-3xl w-full rounded-2xl border border-primary/40 bg-bg-card p-6 text-xs text-text-primary shadow-lg space-y-3 transition-all'
      bubble.innerHTML = `
        <div class="flex items-center justify-between border-b border-border-default pb-2.5">
          <div class="flex items-center gap-2">
            <span class="flex h-2.5 w-2.5 rounded-full bg-primary animate-ping"></span>
            <span id="stream-phase-title" class="font-display text-xs font-bold text-primary">Conectando con Modelo LLM...</span>
          </div>
          <span class="rounded bg-primary/15 border border-primary/30 px-2 py-0.5 text-[10px] font-mono font-semibold text-primary">Cola Streaming (1000ms Selectivo)</span>
        </div>
        <div id="stream-thought-box" class="hidden rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 text-[11px] text-text-secondary">
          <div class="font-semibold text-primary mb-1 select-none">Razonamiento del Modelo (&lt;think&gt;)</div>
          <pre class="font-mono text-[10px] text-text-muted whitespace-pre-wrap"></pre>
        </div>
        <div id="stream-content-box" class="leading-relaxed space-y-2 text-text-secondary"></div>
      `
      const thinkingPill = scrollContainer.querySelector(`[data-thinking-pill="${this.sessionId}"]`)
      if (thinkingPill) {
        scrollContainer.insertBefore(bubble, thinkingPill)
      } else {
        scrollContainer.appendChild(bubble)
      }
    }

    if (chunk.phase) {
      const titleEl = bubble.querySelector<HTMLElement>('#stream-phase-title')
      if (titleEl) titleEl.textContent = `${chunk.phase}...`
    }

    if (chunk.thought && chunk.thought.trim()) {
      const thoughtBox = bubble.querySelector<HTMLElement>('#stream-thought-box')
      const thoughtPre = thoughtBox?.querySelector<HTMLElement>('pre')
      if (thoughtBox && thoughtPre) {
        thoughtBox.classList.remove('hidden')
        thoughtPre.textContent = chunk.thought
      }
    }

    const contentBox = bubble.querySelector<HTMLElement>('#stream-content-box')
    if (contentBox && chunk.contentSoFar) {
      contentBox.innerHTML = renderFormattedMarkdown(chunk.contentSoFar)
    }

    // Scroll suave solo si el usuario no ha subido intencionalmente
    const isNearBottom =
      scrollContainer.scrollHeight - scrollContainer.scrollTop - scrollContainer.clientHeight < 180
    if (isNearBottom) {
      scrollContainer.scrollTop = scrollContainer.scrollHeight
    }

    // Actualizar selectivamente el stepper del ciclo de vida conforme avanza el proceso
    if (chunk.phase) {
      updateLifecycleStepperInDom(this.root, this.sessionId, chunk.phase)
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    if (this.isDirty && this.latestChunk && this.root) {
      this.flush()
    }
  }
}

export async function renderWorkspaceScreen(
  root: HTMLElement,
  sessionId: number,
  rerender?: () => void,
): Promise<void> {
  await restoreSavedWorkspaceDirectory()

  const [session, messages, files] = await Promise.all([
    getSessionById(sessionId),
    listSessionMessages(sessionId),
    listWorkspaceFiles(),
  ])

  const i18n = t()
  if (!session) {
    window.location.hash = '#/sessions'
    return
  }

  const handle = getWorkspaceDirectoryHandle()
  const running = isSessionRunning(sessionId)
  const thinkingState = getSessionThinkingState(sessionId)

  // Filtrar mensajes que sean plantilla de inicialización
  const visibleMessages = messages.filter(
    (m) =>
      m.content.trim().length > 0 &&
      m.content.trim() !== 'Definición y elaboración de software con SDLC Graph',
  )

  // Identificar si estamos en una fase Human-in-the-Loop
  const lastMessage = messages[messages.length - 1]?.content ?? ''
  const isPhase0Waiting =
    lastMessage.includes('Fase 0: Descubrimiento') ||
    messages.length <= 1 ||
    session.title.includes('Nueva sesión')
  const isPhase4Waiting =
    lastMessage.includes('Fase 4: Solicitud de Aprobación Formal de Negocio') ||
    lastMessage.includes('Aprobación Formal de Negocio')

  root.innerHTML = `
    <div class="flex h-screen overflow-hidden bg-bg-app text-text-primary">
      ${renderSidebar('sessions')}

      <div class="flex flex-1 flex-col overflow-hidden relative">
        <!-- Barra Superior de Navegación -->
        <header class="flex shrink-0 items-center justify-between border-b border-border-default bg-bg-app/95 px-8 py-3.5 backdrop-blur z-10">
          <div class="flex items-center gap-3.5 min-w-0">
            <a href="#/sessions" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary">
              ${heroIcon('arrow-left', 'h-3.5 w-3.5')}
              <span>Dashboard</span>
            </a>

            <div class="flex items-center gap-2.5 min-w-0">
              <h1 id="session-title-header" class="truncate font-display text-base font-bold text-text-primary" title="${escapeHtml(session.title)}">
                ${escapeHtml(session.title)}
              </h1>
              <span class="rounded-md px-2.5 py-0.5 text-[11px] font-semibold ${statusClass(session.status)}">
                ${translateStatus(session.status)}
              </span>
              <span class="rounded-md border border-border-default bg-bg-card px-2.5 py-0.5 font-mono text-[11px] text-text-muted" title="Thread GUID">
                ${escapeHtml(session.threadId.slice(0, 18))}...
              </span>
            </div>
          </div>

          <div class="flex items-center gap-2.5">
            <button id="toggle-files-drawer-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary">
              ${heroIcon('folder-open', 'h-3.5 w-3.5 text-primary')}
              <span>Archivos</span>
              <span class="rounded bg-bg-app px-1.5 py-0.2 font-mono text-[10px] text-text-muted">${files.length}</span>
            </button>

            ${renderLangToggle()}
            <button id="theme-toggle" class="rounded-lg border border-border-default bg-bg-card p-2 text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary" title="${i18n.common.toggleTheme}">
              ${heroIcon('sun-moon', 'h-4 w-4')}
            </button>
          </div>
        </header>

        <!-- Sub-header: Contexto & Stepper de Fases SDLC Progresivo Dinámico -->
        <div class="border-b border-border-default bg-bg-app px-8 py-3 space-y-2">
          <p class="text-xs text-text-muted font-medium">
            ${escapeHtml(session.goal || 'Ciclo de Vida de Software Guiado por Árbol de Habilidades y Arquitectura Empresarial')}
          </p>
          <div id="sdlc-lifecycle-stepper" class="flex items-center gap-2 overflow-x-auto text-[11px] font-medium py-1 scrollbar-none">
            ${renderLifecycleStepperHtml(
    computeSdlcPhasesState({
      sessionStatus: session.status,
      turnsUsed: session.turnsUsed,
      messages: visibleMessages,
      running,
      isThinking: Boolean(thinkingState?.isThinking),
      thinkingPhase: thinkingState?.phase,
      thinkingThought: thinkingState?.thought,
    }),
  )}
          </div>
        </div>

        <!-- Canvas Principal de Conversación -->
        <main class="flex flex-1 flex-col overflow-hidden bg-bg-app">
          <div id="chat-messages-scroll" class="flex-1 overflow-y-auto px-8 py-6 space-y-5">
            ${visibleMessages.map((m) => renderMessageItem(m)).join('')}

            <!-- WIDGET INTERACTIVO HITL 1: FASE 0 EN 3 PASOS RIGUROSOS -->
            ${isPhase0Waiting
      ? `
                  <div class="max-w-3xl w-full rounded-2xl border border-border-default bg-bg-card p-6 shadow-sm space-y-5">
                    <!-- Cabecera del Wizard con botón para cargar plantilla de ejemplo y toggle Markdown -->
                    <div class="flex flex-col sm:flex-row sm:items-center justify-between border-b border-border-default pb-3.5 gap-3">
                      <div class="flex items-center gap-2.5">
                        <div class="text-primary">${heroIcon('sparkles', 'h-5 w-5')}</div>
                        <div>
                          <h3 class="font-display text-sm font-bold text-text-primary">Definición de Fase 0 (Marco en 3 Pasos)</h3>
                          <p class="text-xs text-text-muted mt-0.5">Visión de Negocio → Arquitectura Empresarial (As-Is / To-Be) → Arquitectura de Soluciones</p>
                        </div>
                      </div>
                      <div class="flex items-center gap-2 shrink-0">
                        <button type="button" id="toggle-p0-view-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-app px-2.5 py-1.5 text-xs font-semibold ${isMarkdownView ? 'text-primary border-primary/40 bg-primary/10' : 'text-text-secondary hover:bg-bg-elevated'} transition">
                          <span>${isMarkdownView ? '📝 Ver Formulario' : '📄 Ver Markdown'}</span>
                        </button>
                        <button type="button" id="load-p0-example-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-app px-2.5 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition" title="Pre-llenar con una especificación empresarial completa">
                          <span>✨ Cargar Ejemplo</span>
                        </button>
                      </div>
                    </div>

                    ${isMarkdownView
        ? `
                          <!-- VISTA PLANTILLA MARKDOWN EDITABLE -->
                          <div class="space-y-4 pt-1 animate-in fade-in duration-200">
                            <div class="flex items-center justify-between">
                              <div>
                                <label class="text-xs font-semibold text-text-primary">Plantilla Markdown Completa</label>
                                <p class="text-[11px] text-text-muted">Edita o pega la especificación directamente en formato Markdown estructurado.</p>
                              </div>
                              <button type="button" id="copy-p0-md-btn" class="inline-flex items-center gap-1 rounded-lg border border-border-default bg-bg-app px-2.5 py-1 text-[11px] font-semibold text-primary hover:bg-bg-elevated transition">
                                <span>📋 Copiar Plantilla</span>
                              </button>
                            </div>

                            <textarea id="p0-markdown-textarea" rows="16" class="w-full rounded-xl border border-border-default bg-bg-app p-3 font-mono text-xs text-text-primary outline-none focus:border-primary leading-relaxed">${escapeHtml(generateP0Markdown(p0State))}</textarea>

                            <div class="flex items-center justify-between pt-3 border-t border-border-default">
                              <button type="button" id="btn-back-to-form" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-elevated transition">
                                <span>Volver a Formulario Guiado</span>
                              </button>
                              <button type="button" id="btn-complete-phase0-from-md" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-5 py-2.5 text-xs font-bold text-text-primary hover:bg-bg-elevated transition shadow-md">
                                <span>&gt; Iniciar Fase 1 desde Markdown</span>
                              </button>
                            </div>
                          </div>
                        `
        : `
                          <!-- Navegador de Sub-Pasos (Stepper Interno) -->
                          <div class="grid grid-cols-3 gap-2 text-center text-xs font-semibold">
                            <button type="button" id="tab-p0-step-1" class="py-2 px-2.5 rounded-xl transition ${phase0SubStep === 1 ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-bg-app text-text-muted hover:text-text-secondary'}">
                              1. Necesidades de Negocio
                            </button>
                            <button type="button" id="tab-p0-step-2" class="py-2 px-2.5 rounded-xl transition ${phase0SubStep === 2 ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-bg-app text-text-muted hover:text-text-secondary'}">
                              2. Arq. Empresarial (As-Is / To-Be)
                            </button>
                            <button type="button" id="tab-p0-step-3" class="py-2 px-2.5 rounded-xl transition ${phase0SubStep === 3 ? 'bg-primary/15 text-primary border border-primary/30' : 'bg-bg-app text-text-muted hover:text-text-secondary'}">
                              3. Arq. de Soluciones & Componentes
                            </button>
                          </div>

                          <!-- ================= SUB-PASO 1: NECESIDADES DE NEGOCIO ================= -->
                          ${phase0SubStep === 1
          ? `
                                <div class="space-y-4 pt-1 animate-in fade-in duration-200">
                                  <div>
                                    <label class="block text-xs font-semibold text-text-primary mb-1.5">Nombre / Título de la Funcionalidad (Etiqueta de Sesión)</label>
                                    <input id="step1-title-input" value="${escapeHtml(p0State.featureTitle)}" required placeholder="ej. Emisión de Facturación Electrónica B2B" class="w-full rounded-xl border border-border-default bg-bg-app px-3.5 py-2 text-xs text-text-primary outline-none focus:border-primary" />
                                  </div>

                                  <div>
                                    <label class="block text-xs font-semibold text-text-primary mb-1.5">Narrativa en Lenguaje de Negocio (Texto multilínea)</label>
                                    <textarea id="step1-raw-text-input" rows="3" placeholder="Pega aquí la descripción en lenguaje de negocio con las necesidades, dolores operativos y objetivos..." class="w-full rounded-xl border border-border-default bg-bg-app px-3.5 py-2 text-xs text-text-primary outline-none focus:border-primary">${escapeHtml(p0State.rawBusinessLanguageText)}</textarea>
                                  </div>

                                  <div>
                                    <div class="flex items-center justify-between mb-1.5">
                                      <label class="text-xs font-semibold text-text-primary">Lista de Necesidades de Negocio & Impacto Esperado</label>
                                      <button type="button" id="add-need-btn" class="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                                        <span>+ Añadir Necesidad</span>
                                      </button>
                                    </div>
                                    <div id="needs-list-container" class="space-y-2">
                                      ${p0State.needsList
            .map(
              (need, idx) => `
                                          <div class="flex items-start gap-2 rounded-xl border border-border-default bg-bg-app p-2.5">
                                            <div class="flex-1 space-y-1.5">
                                              <input data-need-desc="${idx}" value="${escapeHtml(need.description)}" placeholder="Descripción de la necesidad de negocio..." class="w-full rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-xs text-text-primary outline-none focus:border-primary" />
                                              <input data-need-impact="${idx}" value="${escapeHtml(need.expectedImpact)}" placeholder="Impacto u objetivo cuantificable..." class="w-full rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-[11px] text-text-muted outline-none focus:border-primary" />
                                            </div>
                                            <button type="button" data-remove-need="${idx}" class="p-1 text-text-muted hover:text-red-400">
                                              ${heroIcon('trash', 'h-4 w-4')}
                                            </button>
                                          </div>
                                        `,
            )
            .join('')}
                                    </div>
                                  </div>

                                  <div class="flex items-center justify-end pt-3 border-t border-border-default">
                                    <button type="button" id="btn-goto-step-2" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-4 py-2 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition shadow-sm">
                                      <span>Siguiente: 2. Arquitectura Empresarial &gt;</span>
                                    </button>
                                  </div>
                                </div>
                              `
          : ''
        }

                          <!-- ================= SUB-PASO 2: ARQUITECTURA EMPRESARIAL ================= -->
                          ${phase0SubStep === 2
          ? `
                                <div class="space-y-4 pt-1 animate-in fade-in duration-200">
                                  <div class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                                    <div>
                                      <label class="block text-xs font-semibold text-text-primary mb-1.5">Marco de Arquitectura Estándar</label>
                                      <select id="step2-standard-select" class="w-full rounded-xl border border-border-default bg-bg-app px-3.5 py-2 text-xs text-text-primary outline-none focus:border-primary">
                                        <option value="C4_AND_CLEAN_ARCHITECTURE" ${p0State.marketStandard === 'C4_AND_CLEAN_ARCHITECTURE' ? 'selected' : ''}>C4 Model & Clean Architecture</option>
                                        <option value="HEXAGONAL_ARCHITECTURE" ${p0State.marketStandard === 'HEXAGONAL_ARCHITECTURE' ? 'selected' : ''}>Arquitectura Hexagonal (Ports & Adapters)</option>
                                        <option value="DOMAIN_DRIVEN_DESIGN" ${p0State.marketStandard === 'DOMAIN_DRIVEN_DESIGN' ? 'selected' : ''}>Domain-Driven Design (DDD)</option>
                                        <option value="TOGAF_ENTERPRISE_ARCH" ${p0State.marketStandard === 'TOGAF_ENTERPRISE_ARCH' ? 'selected' : ''}>TOGAF Architecture Framework</option>
                                      </select>
                                    </div>
                                    <div>
                                      <label class="block text-xs font-semibold text-text-primary mb-1.5">Servidor MCP de Arquitectura (Opcional)</label>
                                      <input id="step2-mcp-input" value="${escapeHtml(p0State.mcpUrl)}" placeholder="http://localhost:3000/sse" class="w-full rounded-xl border border-border-default bg-bg-app px-3.5 py-2 text-xs text-text-primary outline-none focus:border-primary" />
                                    </div>
                                  </div>

                                  <!-- Caso de Negocio: Situación Actual (As-Is) -->
                                  <div class="rounded-xl border border-border-default bg-bg-app/50 p-3.5 space-y-2">
                                    <div class="flex items-center justify-between">
                                      <label class="text-xs font-bold text-text-primary">1. Situación Actual (As-Is)</label>
                                      <button type="button" id="add-cur-limit-btn" class="text-[11px] font-semibold text-primary hover:underline">+ Añadir Limitación</button>
                                    </div>
                                    <input id="step2-cur-title" value="${escapeHtml(p0State.currentSituationTitle)}" placeholder="Descripción de las soluciones actuales..." class="w-full rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs text-text-primary outline-none focus:border-primary" />
                                    <div id="cur-limits-container" class="space-y-1.5">
                                      ${p0State.currentSituationLimitations
            .map(
              (lim, idx) => `
                                          <div class="flex items-center gap-2">
                                            <span class="text-text-muted text-xs">•</span>
                                            <input data-cur-limit="${idx}" value="${escapeHtml(lim)}" placeholder="Limitación que impone al negocio..." class="flex-1 rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-xs text-text-primary outline-none focus:border-primary" />
                                            <button type="button" data-remove-cur-limit="${idx}" class="p-1 text-text-muted hover:text-red-400">${heroIcon('x-mark', 'h-3.5 w-3.5')}</button>
                                          </div>
                                        `,
            )
            .join('')}
                                    </div>
                                  </div>

                                  <!-- Caso de Negocio: Situación Deseada (To-Be) -->
                                  <div class="rounded-xl border border-border-default bg-bg-app/50 p-3.5 space-y-2">
                                    <div class="flex items-center justify-between">
                                      <label class="text-xs font-bold text-text-primary">2. Situación Deseada (To-Be)</label>
                                      <button type="button" id="add-des-cap-btn" class="text-[11px] font-semibold text-primary hover:underline">+ Añadir Capacidad</button>
                                    </div>
                                    <input id="step2-des-title" value="${escapeHtml(p0State.desiredSituationTitle)}" placeholder="Descripción de las soluciones futuras deseadas..." class="w-full rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs text-text-primary outline-none focus:border-primary" />
                                    <div id="des-caps-container" class="space-y-1.5">
                                      ${p0State.desiredSituationCapabilities
            .map(
              (cap, idx) => `
                                          <div class="flex items-center gap-2">
                                            <span class="text-text-muted text-xs">•</span>
                                            <input data-des-cap="${idx}" value="${escapeHtml(cap)}" placeholder="Capacidad objetivo a habilitar..." class="flex-1 rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-xs text-text-primary outline-none focus:border-primary" />
                                            <button type="button" data-remove-des-cap="${idx}" class="p-1 text-text-muted hover:text-red-400">${heroIcon('x-mark', 'h-3.5 w-3.5')}</button>
                                          </div>
                                        `,
            )
            .join('')}
                                    </div>
                                  </div>

                                  <!-- Caso de Negocio: Situación de Transición (Opcional) -->
                                  <div class="rounded-xl border border-border-default bg-bg-app/50 p-3.5 space-y-2">
                                    <div class="flex items-center justify-between">
                                      <label class="text-xs font-bold text-text-primary">3. Situación de Transición (Estadio Intermedio)</label>
                                      <button type="button" id="add-trans-mile-btn" class="text-[11px] font-semibold text-primary hover:underline">+ Añadir Hito</button>
                                    </div>
                                    <input id="step2-trans-title" value="${escapeHtml(p0State.transitionSituationTitle)}" placeholder="Estadio intermedio de adaptación (opcional)..." class="w-full rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs text-text-primary outline-none focus:border-primary" />
                                    <div id="trans-miles-container" class="space-y-1.5">
                                      ${p0State.transitionMilestones
            .map(
              (mile, idx) => `
                                          <div class="flex items-center gap-2">
                                            <span class="text-text-muted text-xs">•</span>
                                            <input data-trans-mile="${idx}" value="${escapeHtml(mile)}" placeholder="Hito o convivencia intermedia..." class="flex-1 rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-xs text-text-primary outline-none focus:border-primary" />
                                            <button type="button" data-remove-trans-mile="${idx}" class="p-1 text-text-muted hover:text-red-400">${heroIcon('x-mark', 'h-3.5 w-3.5')}</button>
                                          </div>
                                        `,
            )
            .join('')}
                                    </div>
                                  </div>

                                  <div class="flex items-center justify-between pt-3 border-t border-border-default">
                                    <button type="button" id="btn-backto-step-1" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-elevated transition">
                                      <span>&lt; Volver a Negocio</span>
                                    </button>
                                    <button type="button" id="btn-goto-step-3" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-4 py-2 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition shadow-sm">
                                      <span>Siguiente: 3. Arq. de Soluciones &gt;</span>
                                    </button>
                                  </div>
                                </div>
                              `
          : ''
        }

                          <!-- ================= SUB-PASO 3: ARQUITECTURA DE SOLUCIONES ================= -->
                          ${phase0SubStep === 3
          ? `
                                <div class="space-y-4 pt-1 animate-in fade-in duration-200">
                                  <div>
                                    <div class="flex items-center justify-between mb-1.5">
                                      <div>
                                        <label class="text-xs font-semibold text-text-primary">Componentes de la Arquitectura a Definir o Evolucionar</label>
                                        <p class="text-[11px] text-text-muted">Mapeo de componentes impactados, acción (creación/evolución) y dependencias Fin-Inicio.</p>
                                      </div>
                                      <button type="button" id="add-component-btn" class="inline-flex items-center gap-1 text-[11px] font-semibold text-primary hover:underline">
                                        <span>+ Añadir Componente</span>
                                      </button>
                                    </div>

                                    <div id="components-list-container" class="space-y-2.5">
                                      ${p0State.components
            .map(
              (comp, idx) => `
                                          <div class="rounded-xl border border-border-default bg-bg-app p-3 space-y-2">
                                            <div class="flex items-center justify-between gap-2">
                                              <input data-comp-name="${idx}" value="${escapeHtml(comp.name)}" placeholder="Nombre del componente..." class="flex-1 rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-xs font-semibold text-text-primary outline-none focus:border-primary" />
                                              <select data-comp-action="${idx}" class="rounded-lg border border-border-default bg-bg-card px-2 py-1 text-[11px] text-text-primary outline-none">
                                                <option value="CREATE" ${comp.action === 'CREATE' ? 'selected' : ''}>Crear</option>
                                                <option value="EVOLVE" ${comp.action === 'EVOLVE' ? 'selected' : ''}>Evolucionar</option>
                                              </select>
                                              <select data-comp-state="${idx}" class="rounded-lg border border-border-default bg-bg-card px-2 py-1 text-[11px] text-text-primary outline-none">
                                                <option value="DESIRED" ${comp.targetState === 'DESIRED' ? 'selected' : ''}>Deseado (To-Be)</option>
                                                <option value="TRANSITION" ${comp.targetState === 'TRANSITION' ? 'selected' : ''}>Transición</option>
                                              </select>
                                              <button type="button" data-remove-comp="${idx}" class="p-1 text-text-muted hover:text-red-400">
                                                ${heroIcon('trash', 'h-4 w-4')}
                                              </button>
                                            </div>
                                            <div class="grid grid-cols-1 md:grid-cols-2 gap-2">
                                              <input data-comp-id="${idx}" value="${escapeHtml(comp.componentId)}" placeholder="ID (ej. comp_billing_core)..." class="rounded-lg border border-border-default bg-bg-card px-2.5 py-1 font-mono text-[11px] text-text-secondary outline-none" />
                                              <input data-comp-deps="${idx}" value="${escapeHtml(comp.dependsOn.join(', '))}" placeholder="Dependencias Fin-Inicio (ej. comp_billing_core)..." class="rounded-lg border border-border-default bg-bg-card px-2.5 py-1 font-mono text-[11px] text-text-secondary outline-none" />
                                            </div>
                                            <input data-comp-desc="${idx}" value="${escapeHtml(comp.description)}" placeholder="Descripción técnica y responsabilidades..." class="w-full rounded-lg border border-border-default bg-bg-card px-2.5 py-1 text-xs text-text-muted outline-none" />
                                          </div>
                                        `,
            )
            .join('')}
                                    </div>
                                  </div>

                                  <div class="flex items-center justify-between pt-3 border-t border-border-default">
                                    <button type="button" id="btn-backto-step-2" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-4 py-2 text-xs font-semibold text-text-secondary hover:bg-bg-elevated transition">
                                      <span>&lt; Volver a Arq. Empresarial</span>
                                    </button>
                                    <button type="button" id="btn-complete-phase0" class="inline-flex items-center gap-1.5 rounded-xl border border-border-default bg-bg-card px-5 py-2.5 text-xs font-bold text-text-primary hover:bg-bg-elevated transition shadow-md">
                                      <span>&gt; Iniciar Fase 1 (Alineamiento y Planificación)</span>
                                    </button>
                                  </div>
                                </div>
                              `
          : ''
        }
                        `
      }
                  </div>
                `
      : ''
    }

            <!-- WIDGET INTERACTIVO HITL 2: FASE 4 (APROBACIÓN FORMAL DE NEGOCIO) -->
            ${isPhase4Waiting
      ? `
                  <div class="max-w-3xl w-full rounded-2xl border border-border-default bg-bg-card p-6 shadow-sm space-y-4">
                    <div class="flex items-center gap-3">
                      <div class="text-warning">
                        ${heroIcon('check-circle', 'h-5 w-5')}
                      </div>
                      <div>
                        <h3 class="font-display text-sm font-bold text-text-primary">Aprobación Formal de Negocio (Fase 4 - HITL)</h3>
                        <p class="text-xs text-text-muted mt-0.5">Todos los componentes han sido construidos y verificados con pruebas unitarias y pruebas integradas E2E.</p>
                      </div>
                    </div>

                    <div class="rounded-xl border border-border-default bg-bg-app p-3.5 text-xs text-text-secondary space-y-1.5">
                      <p>✓ <strong>Componentes del DAG:</strong> Verificados unitariamente en Sandbox JS.</p>
                      <p>✓ <strong>Pruebas E2E de Casos de Uso:</strong> 100% aserciones superadas.</p>
                    </div>

                    <div class="flex flex-col sm:flex-row items-center justify-end gap-3 pt-2">
                      <button id="hitl-reject-btn" type="button" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-border-default bg-bg-app px-4 py-2 text-xs font-semibold text-warning hover:bg-bg-elevated transition">
                        ${heroIcon('arrow-path', 'h-4 w-4')}
                        <span>Rechazar / Activar Resiliencia (RCA)</span>
                      </button>
                      <button id="hitl-approve-btn" type="button" class="w-full sm:w-auto inline-flex items-center justify-center gap-2 rounded-xl border border-border-default bg-bg-card px-4 py-2 text-xs font-semibold text-text-primary hover:bg-bg-elevated transition shadow-sm">
                        <span>&gt; Otorgar Aprobación Formal de Negocio</span>
                      </button>
                    </div>
                  </div>
                `
      : ''
    }

            <!-- Banner de Feedback en Tiempo Real (Fases Autónomas) -->
            <div data-thinking-pill="${sessionId}" class="${thinkingState?.isThinking || running ? 'flex' : 'hidden'
    } max-w-3xl items-center gap-3 rounded-xl border border-primary/30 bg-primary/10 px-4 py-3 text-xs text-primary shadow-sm">
              <span class="h-2.5 w-2.5 rounded-full bg-primary animate-ping shrink-0"></span>
              <div class="min-w-0 flex-1">
                <span data-thinking-phase="${sessionId}" class="font-bold">Ejecutando ciclo agéntico SDLC...</span>
                <p data-thinking-text="${sessionId}" class="truncate font-mono text-[11px] text-text-secondary mt-0.5">
                  ${escapeHtml(thinkingState?.thought ?? 'Procesando paso en LangGraph...')}
                </p>
              </div>
            </div>
          </div>

          <!-- Barra de Entrada Inferior Flotante / Centrada conforme a la imagen -->
          <footer class="p-4 flex justify-center bg-bg-app">
            <form id="chat-prompt-form" class="flex items-center gap-3 w-full max-w-3xl rounded-xl border border-border-default bg-bg-card px-4 py-2 shadow-sm">
              <input
                id="chat-prompt-input"
                type="text"
                placeholder="${i18n.workspace.promptPlaceholder}"
                class="flex-1 bg-transparent text-xs text-text-primary placeholder:text-text-muted outline-none"
              />
              ${running
      ? `
                    <button type="button" id="stop-agent-btn" class="inline-flex items-center gap-1.5 text-xs font-semibold text-red-500 hover:text-red-400 transition shrink-0">
                      ${heroIcon('stop', 'h-4 w-4')}
                      <span>${i18n.common.stop}</span>
                    </button>
                  `
      : `
                    <button type="submit" class="inline-flex items-center gap-1.5 text-xs font-semibold text-text-secondary hover:text-text-primary transition shrink-0">
                      <span>▷</span>
                      <span>${i18n.common.send}</span>
                    </button>
                  `
    }
            </form>
          </footer>
        </main>

        <!-- Drawer Lateral Opcional de Archivos (Slide-Over) -->
        <aside id="workspace-files-drawer" class="absolute top-0 right-0 h-full w-80 max-w-[85vw] transform transition-transform duration-300 ease-in-out border-l border-border-default bg-bg-sidebar shadow-2xl z-20 flex flex-col ${isFileDrawerOpen ? 'translate-x-0' : 'translate-x-full'
    }">
          <div class="flex items-center justify-between border-b border-border-default px-4 py-3 bg-bg-card">
            <div class="flex items-center gap-2 min-w-0">
              ${heroIcon('folder-open', 'h-4 w-4 text-primary shrink-0')}
              <span class="truncate text-xs font-semibold text-text-primary">
                ${handle ? escapeHtml(handle.name) : 'Explorador de Archivos'}
              </span>
            </div>
            <div class="flex items-center gap-1.5">
              <button id="btn-link-workspace-dir" class="inline-flex items-center gap-1 rounded-md border border-border-default bg-bg-app px-2 py-1 text-[11px] font-medium text-text-secondary hover:text-text-primary hover:bg-bg-elevated transition" title="Vincular carpeta física del disco local">
                ${heroIcon('folder-open', 'h-3 w-3 text-primary')}
                <span>${handle ? 'Cambiar' : 'Vincular'}</span>
              </button>
              <button id="close-files-drawer-btn" class="rounded-lg p-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary">
                ${heroIcon('x-mark', 'h-4 w-4')}
              </button>
            </div>
          </div>

          <div class="flex-1 overflow-y-auto p-3 space-y-1">
            ${files.length > 0
      ? files
        .map((f) => {
          const isDoc = f.path.startsWith('doc/') || f.path.endsWith('.md')
          const isSrc = f.path.startsWith('src/')
          const icon = isDoc
            ? heroIcon('book-open', 'h-3.5 w-3.5 shrink-0 text-amber-400')
            : isSrc
              ? heroIcon('code-bracket', 'h-3.5 w-3.5 shrink-0 text-cyan-400')
              : heroIcon('document-text', 'h-3.5 w-3.5 shrink-0 text-text-muted')
          const badge = isDoc
            ? '<span class="ml-auto rounded px-1.5 py-0.5 text-[9px] font-mono font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30">DOC</span>'
            : isSrc
              ? '<span class="ml-auto rounded px-1.5 py-0.5 text-[9px] font-mono font-bold bg-cyan-500/15 text-cyan-400 border border-cyan-500/30">SRC</span>'
              : ''

          return `
                      <button
                        data-open-file="${escapeHtml(f.path)}"
                        class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition ${selectedFilePath === f.path
              ? 'bg-primary/15 text-primary font-semibold'
              : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
            }"
                      >
                        ${icon}
                        <span class="truncate">${escapeHtml(f.path)}</span>
                        ${badge}
                      </button>
                    `
        })
        .join('')
      : `
                  <div class="rounded-xl border border-dashed border-border-default p-4 text-center">
                    <p class="text-xs font-semibold text-text-primary">No hay archivos en workspace</p>
                    <p class="mt-1 text-[11px] text-text-muted">Los componentes y documentación generados aparecerán aquí.</p>
                  </div>
                `
    }
          </div>
        </aside>
      </div>
    </div>
  `

  const doRerender = rerender ?? (() => void renderWorkspaceScreen(root, sessionId, rerender))
  bindLangToggle(doRerender)
  root.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', toggleTheme)

  // Drawer Toggle
  root.querySelector<HTMLButtonElement>('#toggle-files-drawer-btn')?.addEventListener('click', () => {
    isFileDrawerOpen = !isFileDrawerOpen
    const drawer = root.querySelector('#workspace-files-drawer')
    if (drawer) {
      drawer.classList.toggle('translate-x-full', !isFileDrawerOpen)
      drawer.classList.toggle('translate-x-0', isFileDrawerOpen)
    }
  })

  root.querySelector<HTMLButtonElement>('#close-files-drawer-btn')?.addEventListener('click', () => {
    isFileDrawerOpen = false
    const drawer = root.querySelector('#workspace-files-drawer')
    if (drawer) {
      drawer.classList.add('translate-x-full')
      drawer.classList.remove('translate-x-0')
    }
  })

  // Vincular carpeta física del disco local desde el drawer
  root.querySelector<HTMLButtonElement>('#btn-link-workspace-dir')?.addEventListener('click', async () => {
    try {
      await pickWorkspaceDirectory()
      syncWorkerEnvironment()
      void renderWorkspaceScreen(root, sessionId, rerender)
    } catch (err) {
      console.warn('Vincular carpeta cancelado o error:', err)
    }
  })

  // Visualizador e Inspector de Archivos del Workspace
  root.querySelectorAll<HTMLButtonElement>('[data-open-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const path = btn.getAttribute('data-open-file')
      if (!path) return
      try {
        const fileData = await readWorkspaceFile(path)
        selectedFilePath = path

        let viewerDialog = document.getElementById('workspace-file-viewer-dialog') as HTMLDialogElement | null
        if (!viewerDialog) {
          viewerDialog = document.createElement('dialog')
          viewerDialog.id = 'workspace-file-viewer-dialog'
          viewerDialog.className =
            'fixed inset-0 z-50 m-auto max-w-4xl w-[90vw] max-h-[85vh] rounded-2xl border border-border-default bg-bg-card p-6 shadow-2xl backdrop:bg-black/60 text-text-primary flex flex-col'
          document.body.appendChild(viewerDialog)
        }

        viewerDialog.innerHTML = `
          <div class="flex items-center justify-between border-b border-border-default pb-3 shrink-0">
            <div class="flex items-center gap-2.5 min-w-0">
              ${heroIcon('document-text', 'h-5 w-5 text-primary shrink-0')}
              <h3 class="font-mono text-sm font-bold truncate text-text-primary">${escapeHtml(path)}</h3>
              <span class="rounded bg-bg-app px-2 py-0.5 font-mono text-[10px] text-text-muted">${fileData.totalLines} líneas</span>
            </div>
            <div class="flex items-center gap-2">
              <button id="copy-file-content-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-app px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition">
                <span>📋 Copiar</span>
              </button>
              <button id="download-file-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-app px-3 py-1.5 text-xs font-semibold text-text-secondary hover:bg-bg-elevated hover:text-text-primary transition">
                <span>⬇️ Descargar</span>
              </button>
              <button id="close-file-viewer-btn" class="rounded-lg p-1 text-text-muted hover:bg-bg-elevated hover:text-text-primary">
                ${heroIcon('x-mark', 'h-4 w-4')}
              </button>
            </div>
          </div>
          <div class="flex-1 overflow-auto mt-4 rounded-xl border border-border-default bg-bg-app p-4">
            <pre class="font-mono text-xs text-text-secondary whitespace-pre-wrap leading-relaxed select-text">${escapeHtml(fileData.numberedContent)}</pre>
          </div>
        `

        viewerDialog.querySelector('#copy-file-content-btn')?.addEventListener('click', async () => {
          await navigator.clipboard.writeText(fileData.content)
          const copyBtn = viewerDialog!.querySelector('#copy-file-content-btn')!
          copyBtn.innerHTML = '<span>✓ Copiado</span>'
          setTimeout(() => {
            copyBtn.innerHTML = '<span>📋 Copiar</span>'
          }, 2000)
        })

        viewerDialog.querySelector('#download-file-btn')?.addEventListener('click', () => {
          const blob = new Blob([fileData.content], { type: 'text/plain' })
          const url = URL.createObjectURL(blob)
          const a = document.createElement('a')
          a.href = url
          a.download = path.split('/').pop() || 'file.txt'
          a.click()
          URL.revokeObjectURL(url)
        })

        viewerDialog.querySelector('#close-file-viewer-btn')?.addEventListener('click', () => {
          viewerDialog!.close()
        })

        viewerDialog.showModal()
      } catch (err) {
        console.error('Error al abrir archivo:', err)
      }
    })
  })

  // -----------------------------------------------------------------------------------
  // HANDLERS DEL WIZARD EN 3 PASOS DE FASE 0 & MODO MARKDOWN
  // -----------------------------------------------------------------------------------

  // Toggle vista Formulario <-> Markdown
  root.querySelector<HTMLButtonElement>('#toggle-p0-view-btn')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    isMarkdownView = !isMarkdownView
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelector<HTMLButtonElement>('#btn-back-to-form')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    isMarkdownView = false
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Copiar plantilla Markdown al portapapeles
  root.querySelector<HTMLButtonElement>('#copy-p0-md-btn')?.addEventListener('click', async () => {
    syncP0StateFromDom(root)
    const md = generateP0Markdown(p0State)
    try {
      await navigator.clipboard.writeText(md)
      const btn = root.querySelector<HTMLButtonElement>('#copy-p0-md-btn')
      if (btn) btn.innerHTML = `<span>✓ ¡Copiado!</span>`
      setTimeout(() => {
        if (btn) btn.innerHTML = `<span>📋 Copiar Plantilla</span>`
      }, 2000)
    } catch (err) {
      console.error('No se pudo copiar al portapapeles', err)
    }
  })

  // Botón cargar plantilla de ejemplo completa
  root.querySelector<HTMLButtonElement>('#load-p0-example-btn')?.addEventListener('click', () => {
    loadExampleTemplate()
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Tabs de navegación directa entre sub-pasos
  root.querySelector<HTMLButtonElement>('#tab-p0-step-1')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 1
    void renderWorkspaceScreen(root, sessionId, rerender)
  })
  root.querySelector<HTMLButtonElement>('#tab-p0-step-2')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 2
    void renderWorkspaceScreen(root, sessionId, rerender)
  })
  root.querySelector<HTMLButtonElement>('#tab-p0-step-3')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 3
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Botones de avance y retroceso
  root.querySelector<HTMLButtonElement>('#btn-goto-step-2')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 2
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelector<HTMLButtonElement>('#btn-backto-step-1')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 1
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelector<HTMLButtonElement>('#btn-goto-step-3')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 3
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelector<HTMLButtonElement>('#btn-backto-step-2')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    phase0SubStep = 2
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Añadir / eliminar elementos en Paso 1 (Necesidades)
  root.querySelector<HTMLButtonElement>('#add-need-btn')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    p0State.needsList.push({
      id: `NEED-${p0State.needsList.length + 1}`,
      description: '',
      expectedImpact: '',
    })
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-remove-need]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncP0StateFromDom(root)
      const idx = Number(btn.dataset.removeNeed)
      p0State.needsList.splice(idx, 1)
      void renderWorkspaceScreen(root, sessionId, rerender)
    })
  })

  // Añadir / eliminar limitaciones As-Is (Paso 2)
  root.querySelector<HTMLButtonElement>('#add-cur-limit-btn')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    p0State.currentSituationLimitations.push('')
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-remove-cur-limit]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncP0StateFromDom(root)
      const idx = Number(btn.dataset.removeCurLimit)
      p0State.currentSituationLimitations.splice(idx, 1)
      void renderWorkspaceScreen(root, sessionId, rerender)
    })
  })

  // Añadir / eliminar capacidades To-Be (Paso 2)
  root.querySelector<HTMLButtonElement>('#add-des-cap-btn')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    p0State.desiredSituationCapabilities.push('')
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-remove-des-cap]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncP0StateFromDom(root)
      const idx = Number(btn.dataset.removeDesCap)
      p0State.desiredSituationCapabilities.splice(idx, 1)
      void renderWorkspaceScreen(root, sessionId, rerender)
    })
  })

  // Añadir / eliminar hitos de transición (Paso 2)
  root.querySelector<HTMLButtonElement>('#add-trans-mile-btn')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    p0State.transitionMilestones.push('')
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-remove-trans-mile]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncP0StateFromDom(root)
      const idx = Number(btn.dataset.removeTransMile)
      p0State.transitionMilestones.splice(idx, 1)
      void renderWorkspaceScreen(root, sessionId, rerender)
    })
  })

  // Añadir / eliminar componentes (Paso 3)
  root.querySelector<HTMLButtonElement>('#add-component-btn')?.addEventListener('click', () => {
    syncP0StateFromDom(root)
    p0State.components.push({
      componentId: `comp_module_${p0State.components.length + 1}`,
      name: 'Nuevo Componente de Arquitectura',
      action: 'CREATE',
      targetState: 'DESIRED',
      description: 'Responsabilidad y contratos de interfaz.',
      dependsOn: [],
    })
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelectorAll<HTMLButtonElement>('[data-remove-comp]').forEach((btn) => {
    btn.addEventListener('click', () => {
      syncP0StateFromDom(root)
      const idx = Number(btn.dataset.removeComp)
      p0State.components.splice(idx, 1)
      void renderWorkspaceScreen(root, sessionId, rerender)
    })
  })

  // Función común de envío de Fase 0 (Formulario o Markdown)
  const submitPhase0 = async () => {
    syncP0StateFromDom(root)

    // 1. Guardar título formal de sesión
    await updateSessionTitle(sessionId, p0State.featureTitle)

    // 2. Construir objeto estructurado de los 3 pasos
    const phase0ThreeStepPayload: Phase0ThreeStepData = {
      step1: {
        featureTitle: p0State.featureTitle,
        rawBusinessLanguageText: p0State.rawBusinessLanguageText,
        needsList: p0State.needsList.filter((n) => n.description.trim().length > 0),
      },
      step2: {
        marketStandard: p0State.marketStandard,
        mcpUrl: p0State.mcpUrl,
        currentSituation: {
          title: p0State.currentSituationTitle,
          description: p0State.currentSituationTitle,
          limitationsOrCapabilities: p0State.currentSituationLimitations.filter((l) => l.trim().length > 0),
        },
        desiredSituation: {
          title: p0State.desiredSituationTitle,
          description: p0State.desiredSituationTitle,
          limitationsOrCapabilities: p0State.desiredSituationCapabilities.filter((c) => c.trim().length > 0),
        },
        transitionSituation: p0State.transitionSituationTitle.trim()
          ? {
            title: p0State.transitionSituationTitle,
            description: p0State.transitionSituationTitle,
            limitationsOrCapabilities: p0State.transitionMilestones.filter((m) => m.trim().length > 0),
          }
          : undefined,
      },
      step3: {
        featureComponentMappings: p0State.components.filter((c) => c.name.trim().length > 0),
      },
    }

    // 3. Crear el mensaje de resumen para LangGraph
    const promptMessage =
      `## Definición Formal de Fase 0 (3 Pasos Completados)\n\n` +
      `### 1. Necesidades de Negocio\n` +
      `* **Iniciativa:** ${p0State.featureTitle}\n` +
      `* **Narrativa:** ${p0State.rawBusinessLanguageText}\n` +
      p0State.needsList.map((n) => `  - **${n.id}:** ${n.description} (Impacto: ${n.expectedImpact})`).join('\n') +
      `\n\n### 2. Arquitectura Empresarial (As-Is / To-Be / Transición)\n` +
      `* **Marco:** ${p0State.marketStandard} ${p0State.mcpUrl ? `| MCP: ${p0State.mcpUrl}` : ''}\n` +
      `* **Situación Actual (As-Is):** ${p0State.currentSituationTitle}\n` +
      p0State.currentSituationLimitations.map((l) => `  - [Limitación]: ${l}`).join('\n') +
      `\n* **Situación Deseada (To-Be):** ${p0State.desiredSituationTitle}\n` +
      p0State.desiredSituationCapabilities.map((c) => `  - [Capacidad Objetivo]: ${c}`).join('\n') +
      (p0State.transitionSituationTitle
        ? `\n* **Situación de Transición:** ${p0State.transitionSituationTitle}\n` +
        p0State.transitionMilestones.map((m) => `  - [Hito]: ${m}`).join('\n')
        : '') +
      `\n\n### 3. Arquitectura de Soluciones & Componentes\n` +
      p0State.components
        .map(
          (c) =>
            `* **[${c.action}] ${c.name}** (\`${c.componentId}\` - Estado: ${c.targetState}): ${c.description} (Depende de: ${c.dependsOn.join(', ') || 'Ninguno'})`,
        )
        .join('\n')

    // 4. Reanudar el ciclo agéntico con la especificación completa
    activeStreamBatcher?.stop()
    void runAgentSessionTurn(sessionId, promptMessage, phase0ThreeStepPayload)
    await renderWorkspaceScreen(root, sessionId, rerender)
  }

  // Botones finales: Completar Fase 0 (desde Formulario o desde Markdown)
  root.querySelector<HTMLButtonElement>('#btn-complete-phase0')?.addEventListener('click', submitPhase0)
  root.querySelector<HTMLButtonElement>('#btn-complete-phase0-from-md')?.addEventListener('click', submitPhase0)

  // Submit interactivo HITL 2: FASE 4 (Aprobación Formal)
  root.querySelector<HTMLButtonElement>('#hitl-approve-btn')?.addEventListener('click', async () => {
    activeStreamBatcher?.stop()
    void runAgentSessionTurn(sessionId, 'Aprobación formal de negocio concedida.')
    await renderWorkspaceScreen(root, sessionId, rerender)
  })

  root.querySelector<HTMLButtonElement>('#hitl-reject-btn')?.addEventListener('click', async () => {
    activeStreamBatcher?.stop()
    void runAgentSessionTurn(sessionId, 'Rechazo de negocio: Activar análisis de causa raíz (RCA).')
    await renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Formulario libre de chat
  root.querySelector<HTMLFormElement>('#chat-prompt-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const input = root.querySelector<HTMLInputElement>('#chat-prompt-input')
    const text = input?.value.trim() ?? ''
    if (!text) return
    input!.value = ''
    activeStreamBatcher?.stop()
    void runAgentSessionTurn(sessionId, text)
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Botón detener ejecución
  root.querySelector<HTMLButtonElement>('#stop-agent-btn')?.addEventListener('click', () => {
    activeStreamBatcher?.stop()
    cancelAgentSession(sessionId)
    void renderWorkspaceScreen(root, sessionId, rerender)
  })

  // Iniciar / reactivar la cola selectiva de Streaming SSE (1000 ms)
  if (!activeStreamBatcher) {
    activeStreamBatcher = new StreamingQueueBatcher()
  }
  activeStreamBatcher.start(sessionId, root)

  // Suscripción a Streaming SSE en vivo del LLM acumulando en cola cada 1000ms
  activeStreamListener?.()
  activeStreamListener = onAgentStreamChunk((evt) => {
    if (evt.sessionId !== sessionId) return
    activeStreamBatcher?.enqueue(evt)
  })

  // Suscripción a Thinking del agente para actualizar el stepper y el banner de estado
  activeThinkingListener?.()
  activeThinkingListener = onAgentThinking((state) => {
    if (state.sessionId !== sessionId) return
    const pill = root.querySelector(`[data-thinking-pill="${sessionId}"]`)
    if (pill) {
      pill.classList.toggle('hidden', !state.isThinking)
      pill.classList.toggle('flex', state.isThinking)
    }
    const text = root.querySelector(`[data-thinking-text="${sessionId}"]`)
    if (text) {
      text.textContent = state.thought
    }
    updateLifecycleStepperInDom(root, sessionId, state.thought)
  })
}

export { renderWorkspaceScreen as renderAgentWorkspace }
