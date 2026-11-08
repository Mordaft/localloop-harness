import assert from 'node:assert'
import { generateP0Markdown, parseP0Markdown, p0State } from '../src/screens/workspace'

console.log('--- Iniciando pruebas de Fase 0: Markdown Roundtrip y Extracción de Impacto ---')

// 1. Caso exacto de la captura del usuario: 4 necesidades con fórmulas e impactos
const userMarkdownScreenshot = `# Especificación de Fase 0: Descubrimiento y Arquitectura

## 1. Necesidades de Negocio
* **Iniciativa:** PWA Tetris Móvil Moderno con Google Ads
* **Narrativa:**
Juego Tetris PWA para smartphones con diseño moderno neón, controles táctiles y monetización con banner de Google Ads protegido contra Cumulative Layout Shift (CLS).

### Lista de Necesidades de Negocio
1. **NEED-1**: Motor de juego fluido en TypeScript con rotaciones SRS y matriz 10*30 *(Impacto: Experiencia inmersiva en pantallas móviles y 60 FPS)*
2. **NEED-2**: Interfaz táctil optimizada para móviles con Canvas HTML5 y diseño neón glassmorphism *(Impacto: Reducción del tiempo de respuesta táctil)*
3. **NEED-3**: Espacio reservado para Google Ads (AdSense/AdMob) con altura fija sin desplazar controles *(Impacto: Monetización fluida sin penalizaciones Core Web Vitals/CLS)*
4. **NEED-4**: Shell PWA con Web App Manifest y Service Worker offline *(Impacto: Instalable en pantalla de inicio de Android/iOS y retención de usuarios)*

## 2. Arquitectura Empresarial (Caso de Negocio)
* **Marco Estándar:** C4_AND_CLEAN_ARCHITECTURE
* **Conexión MCP:** http://localhost:3000/sse

### Situación Actual (As-Is)
ERP Monolítico on-premise
- [Limitación]: Bloqueos por transacciones lentas en horas punta.

### Situación Deseada (To-Be)
Arquitectura orientada a eventos
- [Capacidad Objetivo]: Publicación de eventos de facturación en Event Bus.

## 3. Arquitectura de Soluciones & Componentes
- **[CREATE] comp_tetris_engine** (\`comp_tetris_engine\` - DESIRED)
  - Depende de: Ninguno
  - Descripción: Motor core en TypeScript con matriz de 10x20 y rotaciones SRS.
`

parseP0Markdown(userMarkdownScreenshot)

assert.strictEqual(p0State.featureTitle, 'PWA Tetris Móvil Moderno con Google Ads')
assert.strictEqual(p0State.needsList.length, 4, 'Deben extraerse exactamente 4 necesidades')

// Verificación de extracción limpia de descripción e impacto (sin contaminación cruzada)
assert.strictEqual(
  p0State.needsList[0].description,
  'Motor de juego fluido en TypeScript con rotaciones SRS y matriz 10*30',
  'NEED-1: la descripción no debe contener el impacto embebido'
)
assert.strictEqual(
  p0State.needsList[0].expectedImpact,
  'Experiencia inmersiva en pantallas móviles y 60 FPS',
  'NEED-1: el impacto debe extraerse correctamente'
)

assert.strictEqual(
  p0State.needsList[1].description,
  'Interfaz táctil optimizada para móviles con Canvas HTML5 y diseño neón glassmorphism',
  'NEED-2: descripción limpia'
)
assert.strictEqual(
  p0State.needsList[1].expectedImpact,
  'Reducción del tiempo de respuesta táctil',
  'NEED-2: impacto limpio'
)

assert.strictEqual(
  p0State.needsList[2].description,
  'Espacio reservado para Google Ads (AdSense/AdMob) con altura fija sin desplazar controles',
  'NEED-3: descripción limpia con paréntesis internos en AdSense/AdMob'
)
assert.strictEqual(
  p0State.needsList[2].expectedImpact,
  'Monetización fluida sin penalizaciones Core Web Vitals/CLS',
  'NEED-3: impacto limpio'
)

assert.strictEqual(
  p0State.needsList[3].description,
  'Shell PWA con Web App Manifest y Service Worker offline',
  'NEED-4: descripción limpia'
)
assert.strictEqual(
  p0State.needsList[3].expectedImpact,
  'Instalable en pantalla de inicio de Android/iOS y retención de usuarios',
  'NEED-4: impacto limpio'
)
console.log('✓ Caso de usuario (captura Tetris PWA) parseado con 100% de éxito.')

// 2. Round-trip: Markdown -> parse -> generate -> parse
const generatedMd = generateP0Markdown(p0State)
parseP0Markdown(generatedMd)
assert.strictEqual(p0State.needsList.length, 4)
assert.strictEqual(p0State.needsList[0].description, 'Motor de juego fluido en TypeScript con rotaciones SRS y matriz 10*30')
assert.strictEqual(p0State.needsList[0].expectedImpact, 'Experiencia inmersiva en pantallas móviles y 60 FPS')
console.log('✓ Round-trip Formulario <-> Markdown preserva campos sin acumular sufijos.')

// 3. Auto-recuperación (Self-Healing) de estados previamente corruptos en la UI
p0State.needsList = [
  {
    id: 'NEED-CORRUPT',
    description: 'Funcionalidad de login biométrico *(Impacto: Aumento de retención en un 35%)*',
    expectedImpact: ''
  }
]
const healedMd = generateP0Markdown(p0State)
assert.strictEqual(p0State.needsList[0].description, 'Funcionalidad de login biométrico')
assert.strictEqual(p0State.needsList[0].expectedImpact, 'Aumento de retención en un 35%')
console.log('✓ Auto-recuperación de texto corrupto en descripción superada con éxito.')

// 4. Soporte para saltos de línea Windows CRLF (\r\n)
const crlfMarkdown = userMarkdownScreenshot.replace(/\n/g, '\r\n')
parseP0Markdown(crlfMarkdown)
assert.strictEqual(p0State.needsList.length, 4)
assert.strictEqual(p0State.needsList[0].expectedImpact, 'Experiencia inmersiva en pantallas móviles y 60 FPS')
console.log('✓ Soporte Windows CRLF (\r\n) verificado con éxito.')

// 5. Variantes de formato de impacto: (Impacto: ...), *(Impact: ...)*, sin impacto
const variationsMd = `# Especificación de Fase 0: Descubrimiento y Arquitectura

## 1. Necesidades de Negocio
* **Iniciativa:** Test de Variaciones
* **Narrativa:** Narrativa de prueba

### Lista de Necesidades de Negocio
1. **VAR-1**: Sin impacto definido
2. **VAR-2**: Con paréntesis simple (Impacto: Impacto simple)
3. **VAR-3**: Con formato en inglés *(Impact: English impact)*
- **VAR-4**: Viñeta con guión *(Impacto: Viñeta válida)*
`
parseP0Markdown(variationsMd)
assert.strictEqual(p0State.needsList.length, 4)
assert.strictEqual(p0State.needsList[0].expectedImpact, '')
assert.strictEqual(p0State.needsList[1].expectedImpact, 'Impacto simple')
assert.strictEqual(p0State.needsList[2].expectedImpact, 'English impact')
assert.strictEqual(p0State.needsList[3].expectedImpact, 'Viñeta válida')
console.log('✓ Variaciones de formato y sintaxis de impacto pasaron exitosamente.')

console.log('--- Todas las pruebas de Fase 0 (Markdown e Impacto) pasaron exitosamente ---')

