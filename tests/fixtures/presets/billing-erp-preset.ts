import type { ComponentNode } from '../../../src/agent/sdlc-state'
import type { GeneratedComponentArtifacts } from '../../../src/agent/sdlc/codegen/component-codegen'
import type { ComponentDesignResult } from '../../../src/agent/sdlc/codegen/component-design'
import { sanitizeTsForBrowser } from '../../../src/sandbox/code-runner'

/**
 * Fixture de prueba: Generación de código para el caso de Facturación B2B, Firma Criptográfica y ERP
 */
export function getBillingErpCodePreset(comp: ComponentNode): GeneratedComponentArtifacts | null {
  if (comp.id.includes('billing') || comp.name.toLowerCase().includes('factura')) {
    const className = 'BillingCoreEngine'
    const code = `/**
 * Componente: ${comp.name} (${comp.id})
 * Generado por LocalLoop SDLC Graph
 */
export interface InvoiceItem {
  description: string;
  unitPrice: number;
  quantity: number;
}

export interface InvoiceCalculationInput {
  items: InvoiceItem[];
  taxRate: number;
  vatId: string;
}

export interface InvoiceCalculationResult {
  invoiceNumber: string;
  subtotal: number;
  taxAmount: number;
  total: number;
  isValid: boolean;
  generatedAt: string;
}

export class BillingCoreEngine {
  calculate(input: InvoiceCalculationInput): InvoiceCalculationResult {
    if (!input.vatId || input.vatId.trim().length === 0) {
      throw new Error('Identificador fiscal (VAT) obligatorio.');
    }
    if (!input.items || input.items.length === 0) {
      throw new Error('La factura debe contener al menos un concepto.');
    }
    let subtotal = 0;
    for (const item of input.items) {
      if (item.unitPrice < 0 || item.quantity <= 0) {
        throw new Error('Precios y cantidades deben ser valores positivos.');
      }
      subtotal += item.unitPrice * item.quantity;
    }
    const taxAmount = Number((subtotal * (input.taxRate / 100)).toFixed(2));
    const total = Number((subtotal + taxAmount).toFixed(2));
    const invoiceNumber = \`FAC-\${Math.floor(100000 + Math.random() * 900000)}\`;
    return {
      invoiceNumber,
      subtotal: Number(subtotal.toFixed(2)),
      taxAmount,
      total,
      isValid: true,
      generatedAt: new Date().toISOString(),
    };
  }
}
`
    const testScript = `
      ${sanitizeTsForBrowser(code)}
      const engine = new BillingCoreEngine();
      if (!engine || typeof engine.calculate !== 'function') throw new Error('Motor de facturación no instanciable');
      let caught = false;
      try {
        engine.calculate({ items: [], taxRate: 21, vatId: '' });
      } catch (e) {
        caught = true;
      }
      if (!caught) throw new Error('No falló ante entrada inválida');
      const res = engine.calculate({
        items: [{ description: 'Suscripción B2B', unitPrice: 100, quantity: 2 }],
        taxRate: 21,
        vatId: 'ESB12345678',
      });
      if (res.total !== 242 || res.taxAmount !== 42) throw new Error('Cálculo impositivo erróneo');
      ({ pass: true, assertions: 3 });
    `
    return {
      className,
      code,
      testScript,
      files: [
        { path: comp.targetPath || 'src/modules/comp_billing_core.ts', content: code, description: 'Motor Core de Facturación' },
      ],
    }
  } else if (
    comp.id.includes('signature') ||
    comp.name.toLowerCase().includes('firma') ||
    comp.name.toLowerCase().includes('cripto')
  ) {
    const className = 'DigitalSignatureService'
    const code = `/**
 * Componente: ${comp.name} (${comp.id})
 * Generado por LocalLoop SDLC Graph
 */
export interface SignaturePayload {
  content: string;
  certificateId: string;
}

export interface SignatureResult {
  signatureDigest: string;
  algorithm: string;
  timestamp: string;
  isVerified: boolean;
}

export class DigitalSignatureService {
  async sign(payload: SignaturePayload): Promise<SignatureResult> {
    if (!payload.content || payload.content.trim().length === 0) {
      throw new Error('El contenido a firmar no puede estar vacío.');
    }
    if (!payload.certificateId) {
      throw new Error('Certificado criptográfico no especificado.');
    }
    let hash = 0;
    for (let i = 0; i < payload.content.length; i++) {
      hash = ((hash << 5) - hash) + payload.content.charCodeAt(i);
      hash |= 0;
    }
    const signatureDigest = \`SHA256-\${Math.abs(hash).toString(16).padStart(16, '0')}\`;
    return {
      signatureDigest,
      algorithm: 'RSA-SHA256-XAdES',
      timestamp: new Date().toISOString(),
      isVerified: true,
    };
  }
}
`
    const testScript = `
      ${sanitizeTsForBrowser(code)}
      const service = new DigitalSignatureService();
      if (!service || typeof service.sign !== 'function') throw new Error('Servicio de firma no instanciable');
      const res = await service.sign({ content: '<Invoice>Factura 2026</Invoice>', certificateId: 'CERT-PROD-01' });
      if (!res.signatureDigest || !res.isVerified) throw new Error('Digest de firma inválido');
      ({ pass: true, assertions: 3 });
    `
    return {
      className,
      code,
      testScript,
      files: [
        { path: comp.targetPath || 'src/modules/comp_digital_signature.ts', content: code, description: 'Servicio de Firma Criptográfica' },
      ],
    }
  } else if (/\berp\b/i.test(`${comp.id} ${comp.name} ${comp.description}`)) {
    const className = 'LegacyErpAdapter'
    const code = `/**
 * Componente: ${comp.name} (${comp.id})
 * Generado por LocalLoop SDLC Graph (Estadio de Transición)
 */
export interface ErpSyncRequest {
  invoiceNumber: string;
  totalAmount: number;
  payloadXml: string;
}

export interface ErpSyncResponse {
  synced: boolean;
  erpTransactionId: string;
  mode: 'TRANSITIONAL_CONVIVENCIA';
  syncedAt: string;
}

export class LegacyErpAdapter {
  async syncWithLegacy(req: ErpSyncRequest): Promise<ErpSyncResponse> {
    if (!req.invoiceNumber) {
      throw new Error('Número de factura requerido para sincronización ERP.');
    }
    if (req.totalAmount <= 0) {
      throw new Error('El importe debe ser mayor a cero.');
    }
    const erpTransactionId = \`ERP-TX-\${Math.floor(100000 + Math.random() * 900000)}\`;
    return {
      synced: true,
      erpTransactionId,
      mode: 'TRANSITIONAL_CONVIVENCIA',
      syncedAt: new Date().toISOString(),
    };
  }
}
`
    const testScript = `
      ${sanitizeTsForBrowser(code)}
      const adapter = new LegacyErpAdapter();
      if (!adapter || typeof adapter.syncWithLegacy !== 'function') throw new Error('Adaptador no instanciable');
      const res = await adapter.syncWithLegacy({ invoiceNumber: 'FAC-001', totalAmount: 242, payloadXml: '<xml/>' });
      if (!res.synced || !res.erpTransactionId) throw new Error('Fallo en sincronización transicional ERP');
      ({ pass: true, assertions: 3 });
    `
    return {
      className,
      code,
      testScript,
      files: [
        { path: comp.targetPath || `src/modules/${comp.id}.ts`, content: code, description: 'Adaptador de Transición ERP' },
      ],
    }
  }

  return null
}

/**
 * Fixture de prueba: Generación de diseño para el caso de Facturación B2B, Firma Criptográfica y ERP
 */
export function getBillingErpDesignPreset(comp: ComponentNode, standard: string): ComponentDesignResult | null {
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
  }

  return null
}
