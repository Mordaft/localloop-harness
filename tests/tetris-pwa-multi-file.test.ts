import assert from 'node:assert/strict'
import { compiledSDLCGraph } from '../src/agent/sdlc-graph'
import { getVirtualFile } from '../src/fs/workspace-fs'

console.log('--- Iniciando prueba de Caso de Uso: PWA Móvil Tetris Moderno con Google Ads (Multi-Fichero & Evidencias Visuales) ---')

async function runTetrisPwaTests() {
  const sessionId = 301
  const threadId = 'thread-tetris-pwa-301'
  const threadConfig = { configurable: { thread_id: threadId } }

  // 1. Inicializar sesión de desarrollo
  const userPrompt =
    'Definir una PWA para móviles con la aplicación de Tetris con aspecto moderno y un espacio reservado para publicidad de Google Ads.'
  console.log(`[Paso 1] Iniciando descubrimiento SDLC con prompt: "${userPrompt}"`)

  const run1 = await compiledSDLCGraph.invoke(
    {
      sessionId,
      threadId,
      messages: [{ role: 'user', content: userPrompt }],
    },
    threadConfig,
  )

  assert.equal(run1.currentPhase, '0_DISCOVERY_RIGOR', 'Debe iniciar en Fase 0 de rigor')
  console.log('✓ Fase 0 generó la calibración de rigor inicial y pausó en la interrupción HITL 1.')

  // 2. Reanudar con especificación formal en 3 pasos: Negocio, Arquitectura Empresarial y Componentes DAG
  console.log('[Paso 2] Reanudando con especificación formal en 3 Pasos (Negocio + EA + Solución Multi-Componente)...')
  const phase0Data = {
    step1: {
      featureTitle: 'PWA Tetris Móvil Moderno con Google Ads',
      rawBusinessLanguageText:
        'Juego Tetris PWA para smartphones con diseño moderno neón, controles táctiles y monetización con banner de Google Ads protegido contra Cumulative Layout Shift (CLS).',
      needsList: [
        {
          id: 'NEED-1',
          description: 'Motor de juego fluido en TypeScript con rotaciones SRS y matriz 10x20',
          expectedImpact: 'Jugabilidad adictiva y clásica sin retrasos',
        },
        {
          id: 'NEED-2',
          description: 'Interfaz táctil optimizada para móviles con Canvas HTML5 y diseño neón glassmorphism',
          expectedImpact: 'Experiencia inmersiva en pantallas táctiles de smartphone',
        },
        {
          id: 'NEED-3',
          description: 'Espacio reservado para Google Ads (AdSense/AdMob) con altura fija sin desplazar controles',
          expectedImpact: 'Monetización activa con 0 Cumulative Layout Shift (CLS)',
        },
        {
          id: 'NEED-4',
          description: 'Shell PWA con Web App Manifest y Service Worker offline',
          expectedImpact: 'Instalable en pantalla de inicio de Android/iOS y jugable sin conexión',
        },
      ],
    },
    step2: {
      marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
      currentSituation: {
        title: 'Juegos web legados en flash o no responsive',
        description: 'Juegos web legados en flash o no responsive',
        limitationsOrCapabilities: ['Sin controles táctiles', 'Anuncios emergentes molestos que rompen el layout'],
      },
      desiredSituation: {
        title: 'PWA Mobile-First con Canvas y monetización limpia',
        description: 'PWA Mobile-First con Canvas y monetización limpia',
        limitationsOrCapabilities: ['Instalación nativa PWA', 'Espacio publicitario reservado y seguro'],
      },
      transitionSituation: {
        title: 'Mock interactivo de Google Ads con etiquetas de producción',
        description: 'Mock interactivo de Google Ads con etiquetas de producción',
        limitationsOrCapabilities: ['Validación de viewability previa al despliegue'],
      },
    },
    step3: {
      featureComponentMappings: [
        {
          componentId: 'comp_tetris_engine',
          name: 'Motor Core del Juego Tetris',
          action: 'CREATE' as const,
          targetState: 'DESIRED' as const,
          description: 'Lógica matemática de matriz 10x20, tetrominós y puntuación sin dependencias de DOM.',
          dependsOn: [],
        },
        {
          componentId: 'comp_tetris_mobile_ui',
          name: 'Interfaz Visual y Controles Táctiles Móviles',
          action: 'CREATE' as const,
          targetState: 'DESIRED' as const,
          description: 'Renderizado en Canvas 2D, tema neón y barra de controles táctiles ergonómicos.',
          dependsOn: ['comp_tetris_engine'],
        },
        {
          componentId: 'comp_google_ads_slot',
          name: 'Espacio Reservado para Publicidad de Google Ads',
          action: 'CREATE' as const,
          targetState: 'DESIRED' as const,
          description: 'Contenedor publicitario con espacio fijo para Google Ads (anti-CLS guard).',
          dependsOn: ['comp_tetris_mobile_ui'],
        },
        {
          componentId: 'comp_pwa_shell',
          name: 'Shell PWA Móvil y Service Worker Offline',
          action: 'CREATE' as const,
          targetState: 'DESIRED' as const,
          description: 'Página principal integrada, Web App Manifest y Service Worker offline.',
          dependsOn: ['comp_google_ads_slot'],
        },
      ],
    },
  }

  const useCases = [
    {
      id: 'UC-TETRIS-01',
      title: 'Partida de Tetris en Móvil con Publicidad Integrada',
      actor: 'Jugador Móvil',
      happyPath: [
        'Abre la PWA desde su navegador móvil o pantalla de inicio',
        'Visualiza el tablero neon Canvas y la barra táctil ergonómica',
        'Observa el anuncio de Google Ads posicionado en el pie de página sin interferir con los controles',
        'Mueve y rota piezas con los botones táctiles con fluidez',
      ],
      exceptions: ['Pérdida de conexión a internet (PWA opera offline con Service Worker)'],
      expectedBusinessOutcome: 'Retención de usuarios superior a 10 min por sesión y monetización activa con 0 CLS.',
      acceptanceCriteriaGherkin:
        'Given la PWA de Tetris abierta en móvil, When se renderiza el tablero, Then el canvas mide 240x480 y el contenedor #google-ads-container reserva 50px de altura.',
    },
  ]

  await compiledSDLCGraph.updateState(threadConfig, {
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data,
    useCases,
  })

  console.log('[Paso 3] Ejecutando fases 1 a 4 del SDLC Graph...')
  const run2 = await compiledSDLCGraph.invoke(null, threadConfig)

  console.log(`✓ Fase alcanzada: ${run2.currentPhase}`)
  console.log(`✓ Componentes en el Grafo DAG: ${Object.keys(run2.componentsGraph).join(', ')}`)

  // 3. Validar generación multi-fichero para cada componente
  console.log('[Paso 4] Verificando generación multi-fichero en el workspace...')

  const engineComp = run2.componentsGraph['comp_tetris_engine']
  assert.ok(engineComp, 'comp_tetris_engine debe existir')
  assert.ok(
    (engineComp.targetPaths?.length || 0) >= 2,
    `comp_tetris_engine debe haber generado múltiples archivos, generados: ${engineComp.targetPaths?.join(', ')}`,
  )
  assert.ok(
    getVirtualFile('src/games/tetris-engine.ts'),
    'El archivo src/games/tetris-engine.ts debe haberse escrito en el workspace',
  )
  assert.ok(
    getVirtualFile('src/games/tetris-types.ts'),
    'El archivo src/games/tetris-types.ts debe haberse escrito en el workspace',
  )
  console.log(`✓ comp_tetris_engine generó ${engineComp.targetPaths?.length} archivos (lógica + tipos).`)

  const uiComp = run2.componentsGraph['comp_tetris_mobile_ui']
  assert.ok(uiComp, 'comp_tetris_mobile_ui debe existir')
  assert.ok(
    (uiComp.targetPaths?.length || 0) >= 2,
    `comp_tetris_mobile_ui debe ser multi-fichero: ${uiComp.targetPaths?.join(', ')}`,
  )
  assert.ok(
    getVirtualFile('public/tetris-view.html'),
    'El archivo public/tetris-view.html debe haberse escrito en el workspace',
  )
  assert.ok(
    getVirtualFile('src/styles/tetris-mobile.css'),
    'El archivo src/styles/tetris-mobile.css debe haberse escrito en el workspace',
  )
  assert.ok(
    getVirtualFile('src/components/tetris-view.ts'),
    'El archivo src/components/tetris-view.ts debe haberse escrito en el workspace',
  )
  console.log(`✓ comp_tetris_mobile_ui generó ${uiComp.targetPaths?.length} archivos (.html, .css, .ts).`)

  const adsComp = run2.componentsGraph['comp_google_ads_slot']
  assert.ok(adsComp, 'comp_google_ads_slot debe existir')
  assert.ok(
    getVirtualFile('src/components/google-ads-slot.ts'),
    'El archivo src/components/google-ads-slot.ts debe haberse escrito en el workspace',
  )
  assert.ok(
    getVirtualFile('public/ads-slot.html'),
    'El archivo public/ads-slot.html debe haberse escrito en el workspace',
  )
  assert.ok(
    getVirtualFile('src/styles/ads-slot.css'),
    'El archivo src/styles/ads-slot.css debe haberse escrito en el workspace',
  )
  console.log(`✓ comp_google_ads_slot generó ${adsComp.targetPaths?.length} archivos (.ts, .html, .css).`)

  const pwaShellComp = run2.componentsGraph['comp_pwa_shell']
  assert.ok(pwaShellComp, 'comp_pwa_shell debe existir')
  assert.ok(
    getVirtualFile('index.html'),
    'El archivo index.html debe haberse escrito en la raíz del workspace',
  )
  assert.ok(
    getVirtualFile('public/manifest.webmanifest'),
    'El archivo public/manifest.webmanifest debe haberse escrito en el workspace',
  )
  assert.ok(
    getVirtualFile('public/sw.js'),
    'El archivo public/sw.js debe haberse escrito en el workspace',
  )
  console.log(`✓ comp_pwa_shell generó ${pwaShellComp.targetPaths?.length} archivos (index.html, manifest, sw.js).`)

  // 4. Validar pruebas en Browser Iframe Sandbox con registro de evidencias visuales
  console.log('[Paso 5] Verificando evidencias de pruebas en Browser Sandbox y DOM Snapshot...')

  const uiEvidence = run2.unitEvidences['comp_tetris_mobile_ui']
  assert.ok(uiEvidence, 'Debe existir evidencia para comp_tetris_mobile_ui')
  assert.equal(
    uiEvidence.modo,
    'browser_iframe_sandbox',
    'El componente visual debe haberse probado en Browser Iframe Sandbox',
  )
  assert.ok(uiEvidence.exito, 'La prueba de UI debe haber sido exitosa')
  assert.ok(
    uiEvidence.domSnapshot && uiEvidence.domSnapshot.includes('tetris-canvas'),
    'El snapshot del DOM debe incluir #tetris-canvas',
  )
  assert.ok(
    uiEvidence.domSnapshot.includes('touch-controls'),
    'El snapshot del DOM debe incluir los controles táctiles #touch-controls',
  )
  assert.ok(
    uiEvidence.screenshotDataUrl && uiEvidence.screenshotDataUrl.startsWith('data:image/'),
    'Debe haberse registrado la evidencia visual (Screenshot DataURL)',
  )
  console.log('✓ comp_tetris_mobile_ui verificado en navegador con snapshot DOM y screenshot visual.')

  const adsEvidence = run2.unitEvidences['comp_google_ads_slot']
  assert.ok(adsEvidence, 'Debe existir evidencia para comp_google_ads_slot')
  assert.equal(adsEvidence.modo, 'browser_iframe_sandbox', 'Google Ads debe haberse probado en navegador')
  assert.ok(
    adsEvidence.domSnapshot && adsEvidence.domSnapshot.includes('google-ads-container'),
    'El DOM snapshot debe contener #google-ads-container',
  )
  assert.ok(
    adsEvidence.domSnapshot.includes('adsbygoogle'),
    'El DOM snapshot debe contener el tag de Google Ads <ins class="adsbygoogle">',
  )
  assert.ok(
    adsEvidence.screenshotDataUrl,
    'Debe haberse capturado evidencia visual del espacio de publicidad',
  )
  console.log('✓ comp_google_ads_slot verificado en navegador con validación de layout anti-CLS y captura visual.')

  // 5. Validar que la Fase 4 compiló las evidencias E2E y pausó para aprobación formal HITL 2
  console.log('[Paso 6] Verificando compilación E2E y solicitud de Aprobación Formal de Negocio...')
  assert.equal(run2.currentPhase, '4_E2E_BUSINESS_AUDIT', 'Debe estar en Fase 4 esperando aprobación formal')
  assert.ok(
    run2.e2eEvidences && run2.e2eEvidences.allAssertionsPassed,
    'Las aserciones E2E deben haber superado el 100%',
  )
  console.log('✓ Suite E2E de integración superada con éxito.')

  // 6. Conceder Aprobación Formal de Negocio para completar Fase 6 (Proyección Documental)
  console.log('[Paso 7] Otorgando Aprobación Formal de Negocio (HITL 2)...')
  await compiledSDLCGraph.updateState(threadConfig, {
    businessApproval: {
      approved: true,
      stakeholderComments:
        'Aprobado: La PWA de Tetris presenta un diseño neon moderno, controles móviles ergonómicos y el espacio de Google Ads respeta la usabilidad sin desplazamiento de layout.',
      evaluatedAt: new Date().toISOString(),
    },
  })

  const run3 = await compiledSDLCGraph.invoke(null, threadConfig)
  assert.equal(run3.currentPhase, 'COMPLETED', 'El ciclo SDLC debe completarse con éxito')
  console.log('✓ Fase 6 finalizada. SDLC en estado COMPLETED.')

  // 7. Validar documentación generada con detalle multi-fichero y evidencias visuales
  console.log('[Paso 8] Validando suites documentales generadas en doc/...')
  const uiDoc = getVirtualFile('doc/fase-3-construccion-pruebas/EVIDENCIA_PRUEBAS_COMP_TETRIS_MOBILE_UI.md')
  assert.ok(uiDoc, 'Debe existir EVIDENCIA_PRUEBAS_COMP_TETRIS_MOBILE_UI.md')
  assert.ok(
    uiDoc.includes('Browser Iframe Sandbox'),
    'El documento debe especificar Browser Iframe Sandbox como entorno',
  )
  assert.ok(
    uiDoc.includes('public/tetris-view.html') && uiDoc.includes('src/styles/tetris-mobile.css'),
    'El documento debe listar todos los archivos multi-fichero generados',
  )
  assert.ok(
    uiDoc.includes('Evidencia Visual de DOM'),
    'El documento debe contener la sección de Evidencia Visual de DOM',
  )

  const adsDoc = getVirtualFile('doc/fase-3-construccion-pruebas/EVIDENCIA_PRUEBAS_COMP_GOOGLE_ADS_SLOT.md')
  assert.ok(adsDoc, 'Debe existir EVIDENCIA_PRUEBAS_COMP_GOOGLE_ADS_SLOT.md')
  assert.ok(
    adsDoc.includes('google-ads-container') || adsDoc.includes('Google Ads'),
    'El documento debe certificar el espacio reservado para publicidad',
  )

  const landscapeDoc = getVirtualFile('doc/fase-6-cierre-entrega/01_LANDSCAPE_ARQUITECTURA.md')
  assert.ok(landscapeDoc, 'Debe existir landscape de arquitectura')
  assert.ok(
    landscapeDoc.includes('comp_tetris_engine') &&
      landscapeDoc.includes('comp_tetris_mobile_ui') &&
      landscapeDoc.includes('comp_google_ads_slot') &&
      landscapeDoc.includes('comp_pwa_shell'),
    'El landscape final debe contener los 4 componentes verificados',
  )

  console.log('--- Todas las verificaciones del caso de uso PWA Tetris Mobile con Google Ads pasaron exitosamente ---')
}

runTetrisPwaTests().catch((err) => {
  console.error('Error en pruebas de PWA Tetris Multi-Fichero:', err)
  process.exit(1)
})

