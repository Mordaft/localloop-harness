import assert from 'node:assert'
import { renderFormattedMarkdown, escapeHtml } from '../src/screens/workspace'

console.log('--- Iniciando pruebas de renderFormattedMarkdown para informes de Verificación Unitaria ---')

// 1. Caso Exacto de la Imagen 1: Informe de comp_tetris_mobile_ui con tablas, metadatos, bloques de código cercados y HTML spans
const reportImage1 = `Informe de Verificación Unitaria: \`comp_tetris_mobile_ui\`

Cliente: LocalLoop Proyecto: Tetris PWA (Mobile-First) Responsable de QA: UnitTest_Engineer Estado del Componente: <span style="color: #2ecc71; font-weight: bold;">PASS</span>

---

1. Resumen Ejecutivo
Se ha completado la ejecución de las pruebas unitarias y de renderizado para el componente comp_tetris_mobile_ui en un entorno de simulación de navegador (Browser Iframe Sandbox). El objetivo principal fue validar la integridad del DOM, la presencia de los contenedores críticos para el juego y la disponibilidad de los elementos de la interfaz de usuario (UI) necesarios para la interacción móvil.

---

2. Detalles del Entorno de Pruebas
* Entorno: Browser Iframe Sandbox (DOM/HTML/CSS)
* Modo de Verificación: Renderizado y validación de selectores CSS.
* Componente bajo prueba: \`comp_tetris_mobile_ui\`

---

3. Resultados de las Pruebas (Test Suite)

A. VALIDACIÓN DE ESTRUCTURA DOM
| ID | Descripción de la Prueba | Resultado | Observaciones |
|:---|:---|:---:|:---|
| TC-01 | Presencia del Header Principal (\`#tetris-header\`) | ✅ PASS | El contenedor de marca y stats existe. |
| TC-02 | Integridad del Panel de Estadísticas (\`.stats-panel\`) | ✅ PASS | Contiene los elementos de Score, Lines y Level. |
| TC-03 | Disponibilidad de Selectores de Datos (\`#score-val\`, etc.) | ✅ PASS | Los IDs para actualización dinámica están presentes. |
| TC-04 | Existencia del Escenario de Juego (\`#game-stage\`) | ✅ PASS | El contenedor principal está correctamente definido. |
| TC-05 | Disponibilidad del Canvas de Renderizado (\`#tetris-canvas\`) | ✅ PASS | Elemento listo para recibir el contexto 2D. |

B. LOGS DE EJECUCIÓN (SANDBOX)
\`\`\`log
[INFO] Iniciando validación de DOM: comp_tetris_mobile_ui...
[INFO] Verificando elementos críticos en #tetris-header... OK.
[INFO] Verificando selectores de estadísticas (#score-val, #lines-val, #level-val)... OK.
[INFO] Verificando contenedor de juego (#game-stage) y canvas... OK.
[SUCCESS] Validación de DOM de Tetris Mobile UI superada con éxito.
\`\`\`

---

4. Evidencia Visual (DOM Snapshot)

Estado del Renderizado: El componente se ha renderizado correctamente en el árbol DOM.

Snapshot del DOM capturado:
\`\`\`html
<header id="tetris-header" class="tetris-header">
  <div class="brand-title">NEON TETRIS MOBILE</div>
  <div class="stats-panel">
    <div class="stat-item">SCORE <span id="score-val" class="stat-num">0</span></div>
  </div>
</header>
<main id="game-stage" class="game-stage">
  <canvas id="tetris-canvas" width="300"></canvas>
</main>
\`\`\`

---

5. Conclusión y Recomendaciones
Estado Final: ✅ APROBADO
`

const htmlOutput1 = renderFormattedMarkdown(reportImage1)

// Validar que las tablas ya no se colapsan en una sola línea de texto plano
assert.ok(htmlOutput1.includes('<table class="w-full text-left text-xs border-collapse">'), 'La tabla debe renderizarse como un elemento <table> real')
assert.ok(htmlOutput1.includes('<th class="py-2.5 px-3 text-[11px] font-bold uppercase tracking-wider text-text-primary text-center">Resultado</th>'), 'La columna Resultado debe tener alineación centrada')
assert.ok(htmlOutput1.includes('<td class="py-2 px-3 text-text-secondary text-left">TC-01</td>'), 'Las celdas de las filas de la tabla deben estar correctamente estructuradas')
assert.ok(htmlOutput1.includes('✅ PASS</span>'), 'Los estados PASS dentro de las celdas de la tabla deben recibir badge de estado')

// Validar que los bloques de código cercados (```log y ```html) no se rompen como código inline corrupto
assert.ok(!htmlOutput1.includes('`log [INFO]'), 'No debe quedar la sintaxis rota `log [INFO]...')
assert.ok(htmlOutput1.includes('<span class="font-bold uppercase text-primary">log</span>'), 'El bloque de log debe mostrar el badge de lenguaje')
assert.ok(htmlOutput1.includes('<span class="font-bold uppercase text-primary">html</span>'), 'El bloque de HTML snapshot debe mostrar el badge de lenguaje')
assert.ok(htmlOutput1.includes('<pre class="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-text-primary whitespace-pre"><code>&lt;header id="tetris-header"'), 'El snapshot DOM debe ser un bloque <pre><code> con HTML escapado')

// Validar que los separadores horizontales (---) se renderizan como <hr />
assert.ok(htmlOutput1.includes('<hr class="my-3 border-0 border-t border-border-default" />'), 'Los separadores --- deben renderizarse como etiquetas <hr />')

// Validar que los spans estilizados no se escapan como texto crudo &lt;span...
assert.ok(htmlOutput1.includes('<span style="color: #2ecc71; font-weight: bold">PASS</span>'), 'El span de estado PASS debe preservar su estilo seguro')

// Validar que los subtítulos con letra (A. y B.) se formatean con estilo jerárquico
assert.ok(htmlOutput1.includes('VALIDACIÓN DE ESTRUCTURA DOM</h4>'), 'A. VALIDACIÓN DE ESTRUCTURA DOM debe convertirse en encabezado <h4>')
assert.ok(htmlOutput1.includes('LOGS DE EJECUCIÓN (SANDBOX)</h4>'), 'B. LOGS DE EJECUCIÓN (SANDBOX) debe convertirse en encabezado <h4>')

// 2. Caso Exacto de la Imagen 2: Informe de comp_google_ads_slot con tabla Anti-CLS
const reportImage2 = `■ Informe de Verificación Unitaria: \`comp_google_ads_slot\`

Cliente: LocalLoop
Proyecto: Tetris PWA (Monetization Layer)
Responsable de QA: UnitTest_Engineer
Estado del Componente: <span style="color: #2ecc71; font-weight: bold;">PASS</span>

---

1. Resumen Ejecutivo
Se ha completado la ejecución de las pruebas unitarias para el componente comp_google_ads_slot. El objetivo principal de esta suite fue validar la integridad estructural del contenedor publicitario y, fundamentalmente, asegurar que el componente implemente medidas preventivas contra el CLS (Cumulative Layout Shift).

---

3. Resultados de la Ejecución

🧪 SUITE DE PRUEBAS UNITARIAS
| ID | Descripción de la Prueba | Resultado | Observaciones |
|:---|:---:|:---:|:---|
| UT-ADS-01 | Verificación de presencia del contenedor principal (\`#google-ads-container\`) | ✅ PASS | El elemento existe y tiene las propiedades CSS correctas. |
| UT-ADS-02 | Validación de etiqueta de transparencia (\`.ad-label\`) | ✅ PASS | La etiqueta "Publicidad" es visible para cumplimiento normativo. |
| UT-ADS-03 | Verificación de estabilidad de layout (Anti-CLS) | ✅ PASS | El uso de min-height previene el desplazamiento del contenido inferior. |
| UT-ADS-04 | Integridad del elemento de inserción (\`ins.adsbygoogle\`) | ✅ PASS | Estructura de Google Ads detectada correctamente. |
`

const htmlOutput2 = renderFormattedMarkdown(reportImage2)
assert.ok(htmlOutput2.includes('■</span> Informe de Verificación Unitaria'), 'El título con marcador ■ debe formatearse como encabezado <h2>')
assert.ok(htmlOutput2.includes('UT-ADS-01</td>'), 'La tabla de comp_google_ads_slot debe renderizarse correctamente')
assert.ok(htmlOutput2.includes('Cliente: LocalLoop<br />'), 'Las líneas de metadatos deben preservar saltos de línea suaves con <br />')

// 3. Caso de Streaming Incremental (bloque de código o tabla aún no cerrada)
const streamingChunk = `### Fase 3: En progreso...
\`\`\`typescript
const a = 1;
const b = 2;`

const streamOutput = renderFormattedMarkdown(streamingChunk)
assert.ok(streamOutput.includes('<pre class="overflow-x-auto p-3 font-mono text-[11px] leading-relaxed text-text-primary whitespace-pre"><code>const a = 1;\nconst b = 2;</code></pre>'), 'Los bloques de código abiertos durante streaming deben renderizarse sin fallar')

console.log('✓ Todas las verificaciones de renderFormattedMarkdown pasaron exitosamente.')

