import assert from 'node:assert'
import { renderFormattedMarkdown, escapeHtml, escapeHtmlAttr, renderMessageItem } from '../src/screens/workspace'
import { generateMermaidDag } from '../src/mermaid'

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

// 4. Caso Colapsado en una sola línea de la Imagen 1 (Gemini Flash compactando tabla con ||, metadatos y bloques `log...` e `html...`)
const collapsedReportImage1 = `Informe de Verificación Unitaria: comp_tetris_mobile_ui

Cliente: LocalLoop Proyecto: Tetris PWA (Mobile-First) Responsable de QA: UnitTest_Engineer Estado del Componente: <span style="color: #2ecc71; font-weight: bold;">PASS</span>

---

1. Resumen Ejecutivo
Se ha completado la ejecución de las pruebas unitarias y de renderizado para el componente comp_tetris_mobile_ui en un entorno de simulación de navegador (Browser Iframe Sandbox). El objetivo principal fue validar la integridad del DOM, la presencia de los contenedores críticos para el juego y la disponibilidad de los elementos de la interfaz de usuario (UI) necesarios para la interacción móvil.

El componente ha superado todas las aserciones de estructura, confirmando que el esqueleto de la interfaz está correctamente implementado según los contratos de diseño.

---

2. Detalles del Entorno de Pruebas
* Entorno: Browser Iframe Sandbox (DOM/HTML/CSS)
* Modo de Verificación: Renderizado y validación de selectores CSS.
* Componente bajo prueba: comp_tetris_mobile_ui

---

3. Resultados de las Pruebas (Test Suite)

A. VALIDACIÓN DE ESTRUCTURA DOM
| ID | Descripción de la Prueba | Resultado | Observaciones | |:---|:---|:---:|:---| | TC-01 | Presencia del Header Principal ( #tetris-header ) | ✅ PASS | El contenedor de marca y stats existe. || TC-02 | Integridad del Panel de Estadísticas ( .stats-panel ) | ✅ PASS | Contiene los elementos de Score, Lines y Level. || TC-03 | Disponibilidad de Selectores de Datos ( #score-val, etc.) | ✅ PASS | Los IDs para actualización dinámica están presentes. || TC-04 | Existencia del Escenario de Juego ( #game-stage ) | ✅ PASS | El contenedor principal está correctamente definido. || TC-05 | Disponibilidad del Canvas de Renderizado ( #tetris-canvas ) | ✅ PASS | Elemento listo para recibir el contexto 2D. |

B. LOGS DE EJECUCIÓN (SANDBOX)
\`log [INFO] Iniciando validación de DOM: comp_tetris_mobile_ui... [INFO] Verificando elementos críticos en #tetris-header... OK. [INFO] Verificando selectores de estadísticas (#score-val, #lines-val, #level-val)... OK. [INFO] Verificando contenedor de juego (#game-stage) y canvas... OK. [SUCCESS] Validación de DOM de Tetris Mobile UI superada con éxito.\`

---

4. Evidencia Visual (DOM Snapshot)

Estado del Renderizado: El componente se ha renderizado correctamente en el árbol DOM, manteniendo la jerarquía esperada para una aplicación *mobile-first*.

Snapshot del DOM capturado: \`html <header id="tetris-header" class="tetris-header"> <div class="brand-title">NEON TETRIS MOBILE</div> <div class="stats-panel"> <div class="stat-item">SCORE <span id="score-val" class="stat-num">0</span></div> </div> </header> <main id="game-stage" class="game-stage"> <canvas id="tetris-canvas" width="..."</canvas> <!-- Controles táctiles inyectados por el componente --> </main>\`

---

5. Conclusión y Recomendaciones

Estado Final: ✅ APROBADO`

const htmlCollapsed1 = renderFormattedMarkdown(collapsedReportImage1)
assert.ok(htmlCollapsed1.includes('<table class="w-full text-left text-xs border-collapse">'), 'La tabla colapsada con || debe renderizarse como <table> real')
assert.ok(htmlCollapsed1.includes('TC-01</td>'), 'Debe incluir fila TC-01')
assert.ok(htmlCollapsed1.includes('TC-05</td>'), 'Debe incluir fila TC-05')
assert.ok(htmlCollapsed1.includes('<span class="font-bold uppercase text-primary">log</span>'), 'Debe convertir `log ...` inline en bloque de código <pre> con badge de lenguaje')
assert.ok(htmlCollapsed1.includes('<span class="font-bold uppercase text-primary">html</span>'), 'Debe convertir `html ...` inline en bloque de código <pre> con badge de lenguaje')
assert.ok(htmlCollapsed1.includes('Cliente: LocalLoop<br />'), 'Los metadatos colapsados deben separarse con saltos de línea <br />')

// 5. Caso Colapsado en una sola línea de la Imagen 2 (comp_google_ads_slot con tabla con | |)
const collapsedReportImage2 = `■ Informe de Verificación Unitaria: comp_google_ads_slot

Cliente: LocalLoop Proyecto: Tetris PWA (Monetization Layer) Responsable de QA: UnitTest_Engineer Estado del Componente: <span style="color: #2ecc71; font-weight: bold;">PASS</span>

---

1. Resumen Ejecutivo
Se ha completado la ejecución de las pruebas unitarias para el componente comp_google_ads_slot. El objetivo principal de esta suite fue validar la integridad estructural del contenedor publicitario y, fundamentalmente, asegurar que el componente implemente medidas preventivas contra el CLS (Cumulative Layout Shift), garantizando una experiencia de usuario fluida durante la carga de anuncios.

Los resultados confirman que el componente renderiza correctamente su estructura base y mantiene dimensiones reservadas para evitar saltos visuales en el layout principal.

---

2. Detalles del Entorno de Pruebas
* Entorno: Browser Iframe Sandbox (Renderizado Real)
* Tipo de Prueba: Verificación de DOM, Estabilidad de Layout (Anti-CLS) y Consistencia Visual.
* Componente bajo prueba: comp_google_ads_slot

---

3. Resultados de la Ejecución

🧪 SUITE DE PRUEBAS UNITARIAS
| ID | Descripción de la Prueba | Resultado | Observaciones | |:---|:---:|:---:|:---| | UT-ADS-01 | Verificación de presencia del contenedor principal ( #google-ads-container ) | ✅ PASS | El elemento existe y tiene las propiedades CSS correctas. | | UT-ADS-02 | Validación de etiqueta de transparencia/identificación ( .ad-label ) | ✅ PASS | La etiqueta "Publicidad" es visible para cumplimiento normativo. | | UT-ADS-03 | Verificación de estabilidad de layout (Anti-CLS) | ✅ PASS | El uso de min-height previene el desplazamiento del contenido inferior. | | UT-ADS-04 | Integridad del elemento de inserción ( ins.adsbygoogle ) | ✅ PASS | Estructura de Google Ads detectada correctamente en`

const htmlCollapsed2 = renderFormattedMarkdown(collapsedReportImage2)
assert.ok(htmlCollapsed2.includes('<table class="w-full text-left text-xs border-collapse">'), 'La tabla colapsada con | | debe renderizarse como <table> real')
assert.ok(htmlCollapsed2.includes('UT-ADS-01</td>'), 'Debe incluir fila UT-ADS-01')
assert.ok(htmlCollapsed2.includes('UT-ADS-04</td>'), 'Debe incluir fila UT-ADS-04')
assert.ok(htmlCollapsed2.includes('Cliente: LocalLoop<br />'), 'Los metadatos colapsados deben separarse con saltos de línea')

// 6. Caso con título preliminar pegado a la tabla en la misma línea sin \n
const gluedTitleReport = `3. Resultados de la Ejecución 🧪 SUITE DE PRUEBAS UNITARIAS | ID | Descripción | Resultado | Observaciones | |:---|:---|:---:|:---| | TC-01 | Test 1 | ✅ PASS | Ok |`
const htmlGlued = renderFormattedMarkdown(gluedTitleReport)
assert.ok(htmlGlued.includes('<table class="w-full text-left text-xs border-collapse">'), 'Debe desacoplar el título y crear la tabla HTML')
assert.ok(htmlGlued.includes('<th class="py-2.5 px-3 text-[11px] font-bold uppercase tracking-wider text-text-primary text-left">ID</th>'), 'El primer encabezado debe ser limpiamente ID')
assert.ok(htmlGlued.includes('🧪 SUITE DE PRUEBAS UNITARIAS'), 'El título preliminar debe preservarse fuera de la tabla')

// 7. Pruebas de Renderizado de Diagramas Mermaid
const mermaidDoc = `#### Diagrama de Dependencias Fin-Inicio
\`\`\`mermaid
graph TD
  comp_core["Módulo Core / Dominio (comp_core)"]
  comp_service["Servicio de Aplicación (comp_service)"]
  comp_core --> comp_service
\`\`\``

const htmlMermaid = renderFormattedMarkdown(mermaidDoc)
assert.ok(htmlMermaid.includes('Diagrama Mermaid'), 'Debe renderizar la cabecera del contenedor Mermaid')
assert.ok(htmlMermaid.includes('class="mermaid text-xs font-mono text-text-secondary leading-relaxed"'), 'Debe generar el elemento pre con clase mermaid para el módulo CDN')
assert.ok(htmlMermaid.includes('comp_core --&gt; comp_service'), 'Debe escapar caracteres HTML para renderizado seguro en DOM')

// 8. Prueba de Diagrama Mermaid incompleto en Streaming
const streamingMermaid = `\`\`\`mermaid
graph TD
  comp_core --> comp_service`
const htmlStreamMermaid = renderFormattedMarkdown(streamingMermaid)
assert.ok(htmlStreamMermaid.includes('MERMAID (Generando diagrama...)'), 'Debe mostrar badge de generación en progreso durante streaming')

// 9. Prueba de generación automática del grafo DAG en sintaxis Mermaid
const mockDag = {
  comp_core: {
    id: 'comp_core',
    name: 'Módulo Core',
    description: 'Entidades centrales',
    targetState: 'DESIRED' as const,
    dependsOn: [],
    status: 'VERIFIED' as const,
  },
  comp_service: {
    id: 'comp_service',
    name: 'Servicio de Aplicación',
    description: 'Lógica orquestadora',
    targetState: 'DESIRED' as const,
    dependsOn: ['comp_core'],
    status: 'READY' as const,
  },
}

const generatedDagMd = generateMermaidDag(mockDag)
assert.ok(generatedDagMd.includes('```mermaid\ngraph TD'), 'Debe incluir encabezado ```mermaid graph TD')
assert.ok(generatedDagMd.includes('comp_core["Módulo Core (comp_core)"]'), 'Debe definir nodo comp_core')
assert.ok(generatedDagMd.includes('comp_service["Servicio de Aplicación (comp_service)"]'), 'Debe definir nodo comp_service')
assert.ok(generatedDagMd.includes('comp_core --> comp_service'), 'Debe modelar relación de dependencia Fin-Inicio comp_core --> comp_service')

// 10. Prueba de regresión: data-message-content con comillas dobles, rutas path="..." y palabras clave class en bloques de código
const gatekeeperReportWithQuotes = `# 🛡️ DICTAMEN TÉCNICO DE ARQUITECTURA: [APROBADO CON OBSERVACIONES]

**ID del Componente:** \`comp_calendar_payment_adapter\`
**Estado de Auditoría:** ✅ **VALIDADO PARA CONSTRUCCIÓN (MODO TRANSICIÓN)**

---

### 2. REGISTRO DE DEUDA TÉCNICA (MANDATORIO)

| Atributo | Detalle |
| :--- | :--- |
| **Título** | Acoplamiento Temporal a ERP Legado (Strangler Fig) |
| **Plan de Mitigación** | 1. Implementar "Circuit Breaker" en los adaptadores. <br> 2. Definir puertos (interfaces) estrictos en el Dominio. |

---

### 3. BLUEPRINT DE IMPLEMENTACIÓN (CONTRATOS TÉCNICOS)

\`\`\`typescript
// path="src/domain/interfaces/IPaymentGateway.ts"
export interface IPaymentTransaction {
  id: string;
  status: 'pending' | 'completed' | 'failed';
}

class LegacyERPAdapter {
  async processPayment() {
    const legacyPayload = { "tx_id": "123" };
    return JSON.stringify(legacyPayload);
  }
}
\`\`\`
`

const renderedMessageHtml = renderMessageItem({
  id: 1,
  sessionId: 1,
  role: 'assistant',
  content: gatekeeperReportWithQuotes,
  createdAt: new Date().toISOString(),
})

// Verificar que el atributo data-message-content escapa comillas dobles (&quot;) y saltos de línea, sin romper el tag <div> ni su atributo class
const openingDivMatch = renderedMessageHtml.match(/<div\s+data-message-role="assistant"\s+data-message-content="([^"]*)"\s+class="([^"]+)"\s*>/)
assert.ok(openingDivMatch, 'El elemento <div data-message-role="assistant"> debe mantener su estructura HTML intacta y su atributo class sin romperse por comillas internas')
assert.ok(
  openingDivMatch[2].includes('max-w-3xl') && openingDivMatch[2].includes('bg-bg-card') && openingDivMatch[2].includes('rounded-2xl'),
  'El atributo class de la tarjeta del mensaje debe preservarse íntegramente',
)
assert.ok(!openingDivMatch[1].includes('\n'), 'data-message-content no debe contener saltos de línea crudos')
assert.ok(openingDivMatch[1].includes('&quot;Circuit Breaker&quot;'), 'Las comillas dobles dentro de data-message-content deben escaparse como &quot;')
assert.ok(openingDivMatch[1].includes('path=&quot;src/domain/interfaces/IPaymentGateway.ts&quot;'), 'Las rutas con comillas en bloques de código deben escaparse en data-message-content')
assert.ok(renderedMessageHtml.includes('1. Implementar "Circuit Breaker" en los adaptadores. <br /> 2. Definir puertos'), 'Las etiquetas <br> dentro de celdas de tabla deben renderizarse como saltos de línea <br />')
assert.strictEqual(escapeHtmlAttr('a "b" \'c\' `d`\ne'), 'a &quot;b&quot; &#39;c&#39; &#96;d&#96; e', 'escapeHtmlAttr debe escapar comillas dobles, simples, backticks y saltos de línea')
assert.strictEqual(escapeHtml('a "b" \'c\' <d> &'), 'a &quot;b&quot; &#39;c&#39; &lt;d&gt; &amp;', 'escapeHtml debe escapar comillas y entidades HTML')

console.log('✓ Todas las verificaciones de renderFormattedMarkdown, data-message-content y Mermaid pasaron exitosamente.')

