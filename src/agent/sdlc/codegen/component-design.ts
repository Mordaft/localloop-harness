import type { ComponentNode } from '../../sdlc-state'

export interface ComponentDesignResult {
  approachName: string
  description: string
  contracts: Array<{ name: string; schema: string }>
  tradeOffAnalysis: string
}

/**
 * Genera la propuesta de diseño técnico de Clean Architecture según el rol y tipo de componente
 */
export function generateComponentDesign(
  comp: ComponentNode,
  standard: string,
): ComponentDesignResult {
  const isTransition =
    comp.targetState === 'TRANSITION' ||
    comp.id.includes('adapter') ||
    comp.name.toLowerCase().includes('adapter') ||
    comp.name.toLowerCase().includes('transic')
  const isErp = /\berp\b/i.test(`${comp.id} ${comp.name} ${comp.description}`)

  if (comp.id.includes('billing') || comp.name.toLowerCase().includes('factura')) {
    return {
      approachName: `Clean Architecture Domain Core (${standard})`,
      description: `Motor de cálculo y reglas de negocio puras para ${comp.name}, sin dependencias externas de I/O.`,
      contracts: [
        {
          name: 'IBillingCoreEngine',
          schema: `export interface InvoiceItem {\n  description: string;\n  unitPrice: number;\n  quantity: number;\n}\n\nexport interface InvoiceCalculationInput {\n  items: InvoiceItem[];\n  taxRate: number;\n  vatId: string;\n}\n\nexport interface InvoiceCalculationResult {\n  invoiceNumber: string;\n  subtotal: number;\n  taxAmount: number;\n  total: number;\n  isValid: boolean;\n  generatedAt: string;\n}\n\nexport interface IBillingCoreEngine {\n  calculate(input: InvoiceCalculationInput): InvoiceCalculationResult;\n}`,
        },
      ],
      tradeOffAnalysis: 'Aislamiento estricto de dominio; testing determinista en memoria sin mocks de base de datos.',
    }
  } else if (
    comp.id.includes('signature') ||
    comp.name.toLowerCase().includes('firma') ||
    comp.name.toLowerCase().includes('cripto')
  ) {
    return {
      approachName: `Hexagonal Crypto Port (${standard})`,
      description: `Puerto y adaptador criptográfico para firma digital XAdES y sellado de tiempo de ${comp.name}.`,
      contracts: [
        {
          name: 'IDigitalSignatureService',
          schema: `export interface SignaturePayload {\n  content: string;\n  certificateId: string;\n}\n\nexport interface SignatureResult {\n  signatureDigest: string;\n  algorithm: string;\n  timestamp: string;\n  isVerified: boolean;\n}\n\nexport interface IDigitalSignatureService {\n  sign(payload: SignaturePayload): Promise<SignatureResult>;\n}`,
        },
      ],
      tradeOffAnalysis: 'Uso de criptografía asíncrona; requiere inyección de dependencias para permitir tests con claves simuladas.',
    }
  } else if (isErp) {
    return {
      approachName: `Strangler Fig / Transition Adapter (${standard})`,
      description: `Fachada de convivencia temporal que sincroniza transacciones con el ERP legado mientras se completa la migración.`,
      contracts: [
        {
          name: 'ILegacyErpAdapter',
          schema: `export interface ErpSyncRequest {\n  invoiceNumber: string;\n  totalAmount: number;\n  payloadXml: string;\n}\n\nexport interface ErpSyncResponse {\n  synced: boolean;\n  erpTransactionId: string;\n  mode: 'TRANSITIONAL_CONVIVENCIA';\n  syncedAt: string;\n}\n\nexport interface ILegacyErpAdapter {\n  syncWithLegacy(req: ErpSyncRequest): Promise<ErpSyncResponse>;\n}`,
        },
      ],
      tradeOffAnalysis: 'Acepta acoplamiento con modelos del ERP legado a cambio de evitar un despliegue Big-Bang.',
    }
  } else if (
    comp.id.includes('tetris_engine') ||
    (comp.id.includes('tetris') && !comp.id.includes('ui') && !comp.id.includes('ads') && !comp.id.includes('pwa')) ||
    (comp.name.toLowerCase().includes('tetris') && comp.name.toLowerCase().includes('motor'))
  ) {
    return {
      approachName: `Game Loop & Matrix Core (${standard})`,
      description: `Motor desacoplado de Tetris con matriz 10x20, tetrominós estándar (I, J, L, O, S, T, Z), rotación SRS y cálculo de puntuación sin dependencias de DOM.`,
      contracts: [
        {
          name: 'ITetrisEngine',
          schema: `export type TetrominoType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';\n\nexport interface Point {\n  x: number;\n  y: number;\n}\n\nexport interface TetrisGameState {\n  matrix: number[][];\n  score: number;\n  lines: number;\n  level: number;\n  isGameOver: boolean;\n  isPaused: boolean;\n}\n\nexport interface ITetrisEngine {\n  initGame(): void;\n  spawnPiece(): boolean;\n  move(direction: 'LEFT' | 'RIGHT' | 'DOWN'): boolean;\n  rotate(): boolean;\n  hardDrop(): number;\n  tick(): boolean;\n  getState(): TetrisGameState;\n}`,
        },
      ],
      tradeOffAnalysis: 'Separación estricta entre la lógica de juego determinista y el renderizado en canvas para testing en sandbox.',
    }
  } else if (
    comp.id.includes('tetris_mobile_ui') ||
    comp.id.includes('mobile_ui') ||
    (comp.name.toLowerCase().includes('tetris') &&
      (comp.name.toLowerCase().includes('ui') ||
        comp.name.toLowerCase().includes('móvil') ||
        comp.name.toLowerCase().includes('interfaz') ||
        comp.name.toLowerCase().includes('canvas')))
  ) {
    return {
      approachName: `Canvas 2D & Touch Events Adapter (${standard})`,
      description: `Adaptador de interfaz visual para móviles: renderiza el tablero en Canvas HTML5 con tema oscuro neón y controles táctiles táctiles para smartphones.`,
      contracts: [
        {
          name: 'ITetrisMobileView',
          schema: `export interface ITetrisMobileView {\n  mount(canvasElement: HTMLCanvasElement, controlsElement: HTMLElement): void;\n  renderFrame(matrix: number[][], currentPiece?: unknown): void;\n  onDirectionInput(callback: (dir: 'LEFT' | 'RIGHT' | 'DOWN' | 'ROTATE') => void): void;\n  destroy(): void;\n}`,
        },
      ],
      tradeOffAnalysis: 'Renderizado en Canvas 2D nativo sin librerías externas pesadas; soporte táctil multi-touch directo.',
    }
  } else if (
    comp.id.includes('ads') ||
    comp.name.toLowerCase().includes('ads') ||
    comp.name.toLowerCase().includes('publicidad') ||
    comp.name.toLowerCase().includes('anuncio')
  ) {
    return {
      approachName: `Reserved Ad Space & CLS Guard (${standard})`,
      description: `Contenedor publicitario para Google Ads con espacio reservado fijo (320x50 móvil) para evitar Cumulative Layout Shift (CLS) sin interferir en los controles del juego.`,
      contracts: [
        {
          name: 'IGoogleAdsSlotManager',
          schema: `export interface AdSlotConfig {\n  adClient: string;\n  adSlot: string;\n  format: 'auto' | 'rectangle' | 'horizontal';\n  minHeightPx: number;\n}\n\nexport interface IGoogleAdsSlotManager {\n  initializeAdSlot(containerId: string, config: AdSlotConfig): Promise<boolean>;\n  refreshAd(): void;\n  isAdSlotRendered(): boolean;\n}`,
        },
      ],
      tradeOffAnalysis: 'Reserva de espacio preventivo fijo en el layout; aislamiento de scripts de terceros de Google Ads.',
    }
  } else if (
    comp.id.includes('pwa') ||
    comp.id.includes('shell') ||
    comp.name.toLowerCase().includes('pwa') ||
    comp.name.toLowerCase().includes('manifest')
  ) {
    return {
      approachName: `PWA Application Shell & Offline Cache (${standard})`,
      description: `Shell de aplicación web progresiva con Web App Manifest (display: standalone, portrait) y Service Worker para ejecución offline en smartphones.`,
      contracts: [
        {
          name: 'IPwaAppShell',
          schema: `export interface IPwaAppShell {\n  registerServiceWorker(): Promise<boolean>;\n  promptPwaInstall(): Promise<boolean>;\n  isStandalone(): boolean;\n}`,
        },
      ],
      tradeOffAnalysis: 'Configuración PWA nativa sin backend; caché local de assets críticos para juego offline.',
    }
  } else {
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
}
