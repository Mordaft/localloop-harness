import assert from 'node:assert/strict'
import { SessionStatus } from '../src/enums'
import { getLanguage, setLanguage, t, toggleLanguage, translateStatus } from '../src/i18n'

console.log('--- Iniciando pruebas de Internacionalización (ES / EN) ---')

setLanguage('es')
assert.equal(getLanguage(), 'es')
assert.equal(t().common.langCode, 'ES')
assert.equal(translateStatus(SessionStatus.WAITING_APPROVAL), 'Esperando confirmación')

toggleLanguage()
assert.equal(getLanguage(), 'en')
assert.equal(t().common.langCode, 'EN')
assert.equal(translateStatus(SessionStatus.WAITING_APPROVAL), 'Awaiting confirmation')

setLanguage('es')
console.log('✓ Todas las pruebas de i18n pasaron exitosamente.')
