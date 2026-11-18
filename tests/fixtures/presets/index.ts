import type { ComponentNode } from '../../../src/agent/sdlc-state'
import {
  registerComponentCodePresetProvider,
  type GeneratedComponentArtifacts,
} from '../../../src/agent/sdlc/codegen/component-codegen'
import {
  registerComponentDesignPresetProvider,
  type ComponentDesignResult,
} from '../../../src/agent/sdlc/codegen/component-design'
import { getBillingErpCodePreset, getBillingErpDesignPreset } from './billing-erp-preset'
import { getTetrisPwaCodePreset, getTetrisPwaDesignPreset } from './tetris-pwa-preset'

/**
 * Proveedor unificado de código para fixtures de prueba
 */
export function getTestPresetComponentCode(comp: ComponentNode): GeneratedComponentArtifacts | null {
  const billingPreset = getBillingErpCodePreset(comp)
  if (billingPreset) return billingPreset

  const tetrisPreset = getTetrisPwaCodePreset(comp)
  if (tetrisPreset) return tetrisPreset

  return null
}

/**
 * Proveedor unificado de diseño para fixtures de prueba
 */
export function getTestPresetComponentDesign(comp: ComponentNode, standard: string): ComponentDesignResult | null {
  const billingPreset = getBillingErpDesignPreset(comp, standard)
  if (billingPreset) return billingPreset

  const tetrisPreset = getTetrisPwaDesignPreset(comp, standard)
  if (tetrisPreset) return tetrisPreset

  return null
}

/**
 * Habilita los presets de fixtures de pruebas en los motores de generación de código y diseño del SDLC.
 */
export function enableTestPresets(): void {
  registerComponentCodePresetProvider(getTestPresetComponentCode)
  registerComponentDesignPresetProvider(getTestPresetComponentDesign)
}

/**
 * Deshabilita los presets de pruebas para dejar el SDLC 100% puro y genérico.
 */
export function disableTestPresets(): void {
  registerComponentCodePresetProvider(null)
  registerComponentDesignPresetProvider(null)
}

// Auto-habilitar cuando se importa desde el entorno de pruebas
enableTestPresets()
