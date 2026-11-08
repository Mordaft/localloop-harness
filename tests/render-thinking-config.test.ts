import assert from 'node:assert/strict'
import { defaultLlmConfig, getLlmConfig, saveLlmConfig, setWorkerLlmConfig } from '../src/llm/llm-config'
import { t } from '../src/i18n'

console.log('--- Iniciando pruebas de Configuración de Renderizado del Pensamiento LLM ---')

// 1. Verificación del valor por defecto (deshabilitado por defecto para rendimiento visual)
assert.strictEqual(
  defaultLlmConfig.renderThinking,
  false,
  'El valor por defecto de renderThinking debe ser false',
)

const initialConfig = getLlmConfig()
assert.strictEqual(
  typeof initialConfig.renderThinking,
  'boolean',
  'renderThinking debe ser un booleano en getLlmConfig',
)

// 2. Verificación de guardado y cambio de configuración
const updatedToTrue = saveLlmConfig({
  ...initialConfig,
  renderThinking: true,
})
assert.strictEqual(updatedToTrue.renderThinking, true, 'Debe permitir habilitar renderThinking')
assert.strictEqual(getLlmConfig().renderThinking, true, 'getLlmConfig debe devolver true')

const updatedToFalse = saveLlmConfig({
  ...initialConfig,
  renderThinking: false,
})
assert.strictEqual(updatedToFalse.renderThinking, false, 'Debe permitir deshabilitar renderThinking')
assert.strictEqual(getLlmConfig().renderThinking, false, 'getLlmConfig debe devolver false')

// 3. Verificación de soporte en Web Worker override
setWorkerLlmConfig({
  ...initialConfig,
  renderThinking: true,
})
assert.strictEqual(getLlmConfig().renderThinking, true, 'Worker config override debe reflejar renderThinking: true')

setWorkerLlmConfig({
  ...initialConfig,
  renderThinking: false,
})
assert.strictEqual(getLlmConfig().renderThinking, false, 'Worker config override debe reflejar renderThinking: false')

// 4. Verificación de claves i18n
const translations = t()
assert.ok(translations.settings.renderThinkingLabel, 'Debe existir etiqueta i18n para renderThinkingLabel')
assert.ok(translations.settings.renderThinkingHint, 'Debe existir hint i18n para renderThinkingHint')
assert.ok(translations.settings.renderThinkingEnabled, 'Debe existir opción i18n para renderThinkingEnabled')
assert.ok(translations.settings.renderThinkingDisabled, 'Debe existir opción i18n para renderThinkingDisabled')

console.log('✓ Todas las pruebas de Configuración de Renderizado del Pensamiento pasaron exitosamente.')

