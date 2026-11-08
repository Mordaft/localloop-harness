import assert from 'node:assert'
import { compiledSDLCGraph } from '../src/agent/sdlc-graph'
import { getVirtualFile, clearVirtualFiles } from '../src/fs/workspace-fs'

async function runFrameworkSetupTests() {
  console.log('--- Iniciando pruebas de Iteración de Framework en Fase 1 y Arranque E2E en Fase 4 ---')
  clearVirtualFiles()

  const threadConfig = {
    configurable: {
      thread_id: `thread-framework-test-${Date.now()}`,
    },
  }

  // 1. Iniciar con Fase 0 válida para entrar directamente a Fase 1
  console.log('[Test 1] Iniciando SDLC Graph hasta la pausa interactiva de Fase 1...')
  const p0State = {
    sessionId: 901,
    threadId: threadConfig.configurable.thread_id,
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        featureTitle: 'Portal Web de Gestión de Clientes',
        rawBusinessLanguageText: 'Aplicación web interactiva para administración de clientes y pedidos.',
        needsList: [{ id: 'N-1', description: 'Portal accesible y modular', expectedImpact: 'Mayor rapidez' }],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: { title: 'Monolito Antiguo', description: 'Monolito Antiguo', limitationsOrCapabilities: [] },
        desiredSituation: { title: 'Arquitectura Frontend Moderna', description: 'Arquitectura Frontend Moderna', limitationsOrCapabilities: [] },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_customer_ui',
            name: 'Interfaz de Clientes',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Componente visual con formulario y listado.',
            dependsOn: [],
          },
          {
            componentId: 'comp_order_service',
            name: 'Servicio de Pedidos',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Lógica y contratos de pedidos.',
            dependsOn: ['comp_customer_ui'],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-PORTAL',
        title: 'Gestión Completa de Clientes y Pedidos',
        actor: 'Operador',
        happyPath: ['Ver clientes', 'Crear pedido', 'Confirmar'],
        exceptions: [],
        expectedBusinessOutcome: 'Reducción de tiempos operativos.',
        acceptanceCriteriaGherkin: 'Given portal cargado, When crea pedido, Then pedido confirmado.',
      },
    ],
  }

  const runPhase1 = await compiledSDLCGraph.invoke(p0State, threadConfig)

  // Verificar que pausó en Fase 1
  assert.strictEqual(
    runPhase1.currentPhase,
    '1_STRATEGY_AND_PLAN',
    'El grafo debe pausar en 1_STRATEGY_AND_PLAN para recibir feedback del framework',
  )
  assert.strictEqual(runPhase1.phase1FrameworkAgreed, false, 'phase1FrameworkAgreed debe ser false antes de responder')

  // Verificar que el mensaje contiene la propuesta y la solicitud de iteración
  const lastMsg = runPhase1.messages[runPhase1.messages.length - 1].content
  assert.ok(
    lastMsg.includes('Marco de Referencia') || lastMsg.includes('Framework sugerido'),
    'El mensaje de Fase 1 debe incluir la propuesta del marco de referencia',
  )
  console.log('✓ Fase 1 generó la propuesta técnica y pausó a la espera de la decisión del usuario.')

  // 2. Responder en conversación abierta seleccionando Angular con Material
  console.log('[Test 2] El usuario responde en el chat seleccionando Angular con Material...')
  await compiledSDLCGraph.updateState(threadConfig, {
    messages: [
      ...runPhase1.messages,
      { role: 'user', content: 'Prefiero usar Angular con Material para este portal corporativo.' },
    ],
  })

  const runAfterFramework = await compiledSDLCGraph.invoke(null, threadConfig)

  // 3. Verificar que se formalizó el marco tecnológico Angular
  assert.ok(runAfterFramework.frameworkConfig, 'frameworkConfig debe estar definido en el estado')
  assert.ok(
    runAfterFramework.frameworkConfig?.framework.includes('Angular'),
    `El marco acordado debe ser Angular, obtenido: ${runAfterFramework.frameworkConfig?.framework}`,
  )
  assert.strictEqual(runAfterFramework.phase1FrameworkAgreed, true, 'phase1FrameworkAgreed debe ser true')

  // 4. Verificar generación de setup.cmd y setup.sh en la raíz
  const setupCmd = getVirtualFile('setup.cmd')
  const setupSh = getVirtualFile('setup.sh')
  const packageJson = getVirtualFile('package.json')
  const tsconfigJson = getVirtualFile('tsconfig.json')

  assert.ok(setupCmd, 'setup.cmd debe existir en la raíz')
  assert.ok(setupCmd.includes('setup.cmd') || setupCmd.includes('LocalLoop') || setupCmd.includes('@echo off'), 'setup.cmd debe contener comandos batch')
  assert.ok(setupCmd.includes('npm install'), 'setup.cmd debe incluir llamada a npm install')

  assert.ok(setupSh, 'setup.sh debe existir en la raíz')
  assert.ok(setupSh.includes('#!/usr/bin/env bash'), 'setup.sh debe ser un script bash')
  assert.ok(setupSh.includes('npm install'), 'setup.sh debe incluir npm install')

  assert.ok(packageJson, 'package.json debe existir en la raíz')
  assert.ok(tsconfigJson, 'tsconfig.json debe existir en la raíz')
  console.log('✓ setup.cmd, setup.sh, package.json y tsconfig.json verificados exitosamente en la raíz.')

  // 5. Verificar que las rutas de los componentes se asignaron acordes a Angular (src/app/...)
  const customerComp = runAfterFramework.componentsGraph['comp_customer_ui']
  const orderComp = runAfterFramework.componentsGraph['comp_order_service']
  assert.ok(customerComp.targetPath?.startsWith('src/app/components'), `Ruta de componente UI Angular incorrecta: ${customerComp.targetPath}`)
  assert.ok(orderComp.targetPath?.startsWith('src/app/services'), `Ruta de servicio Angular incorrecta: ${orderComp.targetPath}`)
  console.log(`✓ Convenciones de carpetas Angular verificadas: ${customerComp.targetPath} y ${orderComp.targetPath}`)

  // 6. Verificar que el flujo llegó a la pausa de Fase 4 (HITL de Aprobación Formal de Negocio)
  assert.strictEqual(runAfterFramework.currentPhase, '4_E2E_BUSINESS_AUDIT')

  // 7. Verificar generación de start.cmd y start.sh en la raíz y actualización de index.html
  const startCmd = getVirtualFile('start.cmd')
  const startSh = getVirtualFile('start.sh')
  const indexHtml = getVirtualFile('index.html')

  assert.ok(startCmd, 'start.cmd debe existir en la raíz')
  assert.ok(startCmd.includes('start.cmd') || startCmd.includes('LocalLoop') || startCmd.includes('npm'), 'start.cmd debe contener comandos de arranque')

  assert.ok(startSh, 'start.sh debe existir en la raíz')
  assert.ok(startSh.includes('#!/usr/bin/env bash'), 'start.sh debe ser script de arranque bash')

  assert.ok(indexHtml, 'index.html debe existir en la raíz')
  assert.ok(indexHtml.includes('LocalLoop SDLC'), 'index.html debe contener el punto de montaje')
  console.log('✓ start.cmd, start.sh e index.html verificados exitosamente en la raíz del workspace.')

  // 8. Aprobar formalmente y verificar cierre en Fase 6
  console.log('[Test 3] Otorgando aprobación formal de negocio...')
  await compiledSDLCGraph.updateState(threadConfig, {
    businessApproval: {
      approved: true,
      stakeholderComments: 'Portal validado localmente con éxito mediante start.cmd.',
      evaluatedAt: new Date().toISOString(),
    },
  })
  const runFinal = await compiledSDLCGraph.invoke(null, threadConfig)
  assert.strictEqual(runFinal.currentPhase, 'COMPLETED')
  console.log('✓ Ciclo completado exitosamente.')

  // 9. Test 4: Verificación específica del stack Tetris / Phaser / pnpm / Vite / Vitest
  console.log('[Test 4] Verificando resolución dinámica de stack: Phaser + Vanilla TS + Tailwind + pnpm + Vite + Vitest...')
  clearVirtualFiles()
  const tetrisThreadConfig = {
    configurable: {
      thread_id: `thread-tetris-stack-${Date.now()}`,
    },
  }

  const tetrisState = {
    sessionId: 902,
    threadId: tetrisThreadConfig.configurable.thread_id,
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        featureTitle: 'PWA Tetris Móvil Moderno con Google Ads',
        rawBusinessLanguageText: 'Juego Tetris PWA para smartphones con diseño moderno neón, controles táctiles y monetización con banner de Google Ads.',
        needsList: [{ id: 'NEED-1', description: 'Motor de juego fluido en TypeScript', expectedImpact: 'Inmersión' }],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: { title: 'Sin controles táctiles', description: 'Juegos legados', limitationsOrCapabilities: [] },
        desiredSituation: { title: 'PWA Mobile-First con Canvas y Phaser', description: 'Nueva app', limitationsOrCapabilities: [] },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_tetris_engine',
            name: 'Motor Core Tetris',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Lógica matemática de matriz 10x30 y tetrominós.',
            dependsOn: [],
          },
          {
            componentId: 'comp_pwa_shell',
            name: 'PWA Shell',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Shell PWA integrada con scripts y manifest.',
            dependsOn: ['comp_tetris_engine'],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-TETRIS',
        title: 'Jugar Partida Tetris en Móvil',
        actor: 'Jugador',
        happyPath: ['Abrir PWA', 'Mover piezas', 'Hacer línea'],
        exceptions: [],
        expectedBusinessOutcome: 'Partida fluida.',
        acceptanceCriteriaGherkin: 'Given PWA iniciada, When juega, Then suma puntos.',
      },
    ],
  }

  const runTetrisPhase1 = await compiledSDLCGraph.invoke(tetrisState, tetrisThreadConfig)
  assert.strictEqual(runTetrisPhase1.currentPhase, '1_STRATEGY_AND_PLAN')

  // El usuario responde con la instrucción exacta de Prueba 7:
  await compiledSDLCGraph.updateState(tetrisThreadConfig, {
    messages: [
      ...runTetrisPhase1.messages,
      {
        role: 'user',
        content: 'El stack tecnologico debe ser HTML5, Vanilla TypeScript + Tailwind + Framework para juegos Phaser. El marco de desarrollo sera pnpm, Vite y Vitest.',
      },
    ],
  })

  const runAfterTetrisFramework = await compiledSDLCGraph.invoke(null, tetrisThreadConfig)

  // Validaciones del stack dinámico
  assert.strictEqual(runAfterTetrisFramework.frameworkConfig?.packageManager, 'pnpm', 'Debe detectar pnpm como package manager')
  assert.strictEqual(runAfterTetrisFramework.frameworkConfig?.bundler, 'vite', 'Debe detectar Vite como bundler')
  assert.strictEqual(runAfterTetrisFramework.frameworkConfig?.testRunner, 'vitest', 'Debe detectar Vitest como test runner')

  const tetrisPackageJson = JSON.parse(getVirtualFile('package.json')!)
  assert.ok(tetrisPackageJson.dependencies['phaser'], 'package.json debe incluir dependencia phaser')
  assert.ok(tetrisPackageJson.devDependencies['vite'], 'package.json debe incluir devDependencia vite')
  assert.ok(tetrisPackageJson.devDependencies['vitest'], 'package.json debe incluir devDependencia vitest')
  assert.ok(tetrisPackageJson.devDependencies['tailwindcss'], 'package.json debe incluir devDependencia tailwindcss')
  assert.strictEqual(tetrisPackageJson.scripts['test'], 'vitest run', 'El script de test debe ser vitest run')
  assert.strictEqual(tetrisPackageJson.scripts['start'], 'pnpm dev', 'El script de start debe ser pnpm dev')

  const tetrisViteConfig = getVirtualFile('vite.config.ts')
  assert.ok(tetrisViteConfig, 'vite.config.ts debe ser generado')
  assert.ok(tetrisViteConfig.includes('defineConfig'), 'vite.config.ts debe contener defineConfig')

  const tetrisSetupCmd = getVirtualFile('setup.cmd')
  assert.ok(tetrisSetupCmd?.includes('pnpm'), 'setup.cmd debe invocar pnpm')

  const tetrisStartCmd = getVirtualFile('start.cmd')
  assert.ok(tetrisStartCmd?.includes('pnpm dev') || tetrisStartCmd?.includes('pnpm'), 'start.cmd debe iniciar con pnpm dev')

  // Validar que index.html contiene el canvas del juego (preservado por comp_pwa_shell) y e2e-report.html fue generado
  const tetrisIndexHtml = getVirtualFile('index.html')
  assert.ok(tetrisIndexHtml?.includes('tetris-canvas'), 'index.html debe preservar el Canvas y la UI del juego Tetris')
  assert.ok(tetrisIndexHtml?.includes('main.ts'), 'index.html debe cargar main.ts')

  const tetrisE2eReport = getVirtualFile('e2e-report.html')
  assert.ok(tetrisE2eReport, 'e2e-report.html debe existir sin pisar index.html')

  // Validar que los tests unitarios físicos fueron generados para Vitest
  const tetrisEngineTest = getVirtualFile('tests/tetris-engine.test.ts')
  assert.ok(tetrisEngineTest, 'tests/tetris-engine.test.ts debe existir en el workspace para ejecución con pnpm test')
  assert.ok(tetrisEngineTest.includes('describe(') && tetrisEngineTest.includes('vitest'), 'El archivo de test debe contener tests Vitest válidos')

  console.log('✓ Resolución dinámica de stack Phaser + TypeScript + Tailwind + pnpm + Vite + Vitest validada con éxito.')
  console.log('--- Todas las pruebas de Framework en Fase 1 y Arranque E2E en Fase 4 pasaron con éxito ---')
}

void runFrameworkSetupTests()

