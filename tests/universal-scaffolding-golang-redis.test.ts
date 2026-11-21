import assert from 'node:assert'
import { disableTestPresets, enableTestPresets } from './fixtures/presets'
import { compiledSDLCGraph } from '../src/agent/sdlc-graph'
import { getVirtualFile, clearVirtualFiles } from '../src/fs/workspace-fs'
import {
  buildUniversalScaffold,
  materializeUniversalScaffold,
  ScaffoldViabilityError,
} from '../src/agent/sdlc/scaffold/scaffold-engine'
import { generateComponentCode } from '../src/agent/sdlc/codegen/component-codegen'

async function runUniversalScaffoldingTests() {
  console.log('--- Iniciando Pruebas de Scaffolding Universal y Ciclo de Vida Agnóstico ---')
  clearVirtualFiles()

  // =========================================================================
  // Test 1: Invalidación Estricta de Viabilidad sin Propuesta Técnica del LLM
  // =========================================================================
  console.log('[Test 1] Verificando invalidación estricta de viabilidad sin propuesta técnica...')

  disableTestPresets()
  assert.throws(
    () => {
      buildUniversalScaffold({
        userText: 'Crear microservicios backend en GoLang utilizando Redis como base de datos temporal',
      })
    },
    (err: any) => err instanceof ScaffoldViabilityError,
    'Debe lanzar ScaffoldViabilityError invalidando la viabilidad del proyecto si el LLM no detalla el scaffolding',
  )
  enableTestPresets()
  console.log('✓ Invalidación inmediata de viabilidad verificada con éxito.')

  // =========================================================================
  // Test 2: Construcción de Scaffold Universal para GoLang + Redis
  // =========================================================================
  console.log('[Test 2] Construyendo y validando Scaffold Universal GoLang + Redis...')

  const goScaffold = buildUniversalScaffold({
    userText: 'Servicio backend en GoLang con Redis para almacenamiento temporal',
    initiativeTitle: 'Session Cache Microservice',
  })

  assert.strictEqual(goScaffold.runtime, 'go')
  assert.strictEqual(goScaffold.hasUI, false)
  assert.strictEqual(goScaffold.componentDirectory, 'internal/service')
  assert.strictEqual(goScaffold.serviceDirectory, 'internal/service')

  // Manifiestos
  const goMod = goScaffold.manifestFiles.find((m) => m.path === 'go.mod')
  assert.ok(goMod, 'Debe incluir go.mod como manifiesto principal')
  assert.ok(goMod.content.includes('module session-cache-microservice'), 'go.mod debe definir el nombre de módulo')
  assert.ok(goMod.content.includes('github.com/redis/go-redis/v9'), 'go.mod debe requerir el cliente de redis')

  // Contenedores / BBDD temporal
  const dockerCompose = goScaffold.configFiles.find((c) => c.path === 'docker-compose.yml')
  assert.ok(dockerCompose, 'Debe incluir docker-compose.yml para levantar Redis localmente')
  assert.ok(dockerCompose.content.includes('redis:7-alpine'), 'docker-compose debe usar imagen redis:7-alpine')
  assert.ok(dockerCompose.content.includes('6379:6379'), 'docker-compose debe exponer puerto 6379')

  // Esqueleto de código y entrada
  const mainGo = goScaffold.skeletonFiles.find((s) => s.path === 'cmd/server/main.go')
  assert.ok(mainGo, 'Debe incluir cmd/server/main.go como punto de entrada Go')
  assert.ok(mainGo.content.includes('package main'), 'cmd/server/main.go debe ser package main')
  assert.ok(mainGo.content.includes('/health'), 'cmd/server/main.go debe proveer healthcheck HTTP')
  assert.ok(mainGo.content.includes('http.Server'), 'cmd/server/main.go debe inicializar servidor HTTP')

  const redisAdapter = goScaffold.skeletonFiles.find((s) => s.path === 'internal/cache/redis.go')
  assert.ok(redisAdapter, 'Debe incluir adaptador Redis en internal/cache/redis.go')
  assert.ok(redisAdapter.content.includes('RedisClient'), 'Adaptador debe definir RedisClient')
  assert.ok(redisAdapter.content.includes('NewRedisClient'), 'Adaptador debe incluir constructor NewRedisClient')

  // Ciclo de vida: setup, start, test
  assert.ok(goScaffold.lifecycle.setupCmd.includes('go mod tidy'), 'setup.cmd debe invocar go mod tidy')
  assert.ok(goScaffold.lifecycle.setupCmd.includes('docker compose up -d redis'), 'setup.cmd debe arrancar Redis')
  assert.ok(goScaffold.lifecycle.setupSh.includes('go mod tidy'), 'setup.sh debe invocar go mod tidy')
  assert.ok(goScaffold.lifecycle.startCmd.includes('go run ./cmd/server/main.go'), 'start.cmd debe ejecutar cmd/server/main.go')
  assert.ok(goScaffold.lifecycle.startSh.includes('go run ./cmd/server/main.go'), 'start.sh debe ejecutar cmd/server/main.go')
  assert.ok(goScaffold.lifecycle.testCmd.includes('go test'), 'testCmd debe ejecutar go test')

  // Verificar que NO hay archivos de Node/Web contaminando el scaffold de Go
  const noPackageJson = goScaffold.manifestFiles.some((m) => m.path === 'package.json')
  const noTsConfig = goScaffold.configFiles.some((c) => c.path === 'tsconfig.json')
  const noIndexHtml = goScaffold.skeletonFiles.some((s) => s.path === 'index.html')
  const noViteConfig = goScaffold.configFiles.some((c) => c.path === 'vite.config.ts')

  assert.strictEqual(noPackageJson, false, 'No debe haber package.json en scaffold de Go')
  assert.strictEqual(noTsConfig, false, 'No debe haber tsconfig.json en scaffold de Go')
  assert.strictEqual(noIndexHtml, false, 'No debe haber index.html en scaffold de Go')
  assert.strictEqual(noViteConfig, false, 'No debe haber vite.config.ts en scaffold de Go')

  console.log('✓ Scaffold Universal GoLang + Redis verificado exitosamente sin contaminación de Node/Web.')

  // =========================================================================
  // Test 3: Generación de Código GoLang para Componentes
  // =========================================================================
  console.log('[Test 3] Verificando generación de código GoLang para componentes...')

  const goCompArtifacts = generateComponentCode({
    id: 'comp_session_manager',
    name: 'Gestor de Sesiones Temporales',
    description: 'Gestión y expiración de sesiones temporales en caché',
    targetPath: 'internal/service/comp_session_manager.go',
    dependsOn: [],
    status: 'READY',
  })

  assert.ok(goCompArtifacts.code.includes('package service'), 'Código Go debe pertenecer a package service')
  assert.ok(goCompArtifacts.code.includes('type CompSessionManagerItem struct'), 'Debe declarar struct del modelo')
  assert.ok(goCompArtifacts.code.includes('type ICompSessionManagerService interface'), 'Debe declarar contrato de interfaz Go')
  assert.ok(goCompArtifacts.code.includes('func NewCompSessionManagerService()'), 'Debe declarar constructor del servicio')
  assert.ok(goCompArtifacts.code.includes('Execute(ctx context.Context'), 'Debe declarar método Execute con context.Context')
  assert.ok(goCompArtifacts.code.includes('GetStatus() string'), 'Debe declarar método GetStatus')
  assert.strictEqual(goCompArtifacts.files[0].path, 'internal/service/comp_session_manager.go')

  console.log('✓ Generador de código GoLang verificado con contratos y estructuras idiomáticas.')

  // =========================================================================
  // Test 4: Flujo End-to-End en SDLC Graph con GoLang + Redis
  // =========================================================================
  console.log('[Test 4] Ejecutando SDLC Graph completo con GoLang + Redis...')
  clearVirtualFiles()

  const threadConfig = {
    configurable: {
      thread_id: `thread-golang-redis-${Date.now()}`,
    },
  }

  const goSdlcState = {
    sessionId: 990,
    threadId: threadConfig.configurable.thread_id,
    workspacePath: process.cwd().replace(/\\/g, '/'),
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        featureTitle: 'Microservicio de Caché y Sesiones Temporales',
        rawBusinessLanguageText:
          'Crear unos servicios con GoLang utilizando Redis como base de datos temporal para gestión de sesiones con TTL.',
        needsList: [
          { id: 'N-1', description: 'Persistencia rápida de sesiones en memoria con TTL', expectedImpact: 'Baja latencia' },
          { id: 'N-2', description: 'Endpoints HTTP de alta concurrencia', expectedImpact: 'Escalabilidad' },
        ],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: { title: 'Sesiones en BBDD relacional lenta', description: 'Bottleneck', limitationsOrCapabilities: [] },
        desiredSituation: { title: 'Microservicio GoLang + Redis', description: 'Alta concurrencia', limitationsOrCapabilities: [] },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_session_service',
            name: 'Servicio de Sesiones Redis',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Servicio GoLang para lectura y escritura de sesiones en Redis.',
            dependsOn: [],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-GO-REDIS',
        title: 'Guardar y Recuperar Sesión en Caché Redis',
        actor: 'Cliente API',
        happyPath: ['POST /session', 'GET /session/:id'],
        exceptions: ['Sesión expirada'],
        expectedBusinessOutcome: 'Operación en menos de 5ms.',
        acceptanceCriteriaGherkin: 'Given Redis en puerto 6379, When cliente guarda sesion, Then sesion almacenada con TTL.',
      },
    ],
  }

  // 1. Invocar hasta pausa HITL de Fase 1
  const runPhase1 = await compiledSDLCGraph.invoke(goSdlcState, threadConfig)
  assert.strictEqual(runPhase1.currentPhase, '1_STRATEGY_AND_PLAN')
  assert.strictEqual(runPhase1.phase1FrameworkAgreed, false)

  // 2. Responder al HITL de Fase 1 confirmando la propuesta técnica de GoLang + Redis
  await compiledSDLCGraph.updateState(threadConfig, {
    messages: [
      ...runPhase1.messages,
      {
        role: 'user',
        content: 'Apruebo la propuesta de microservicios con GoLang y Redis como base de datos temporal.',
      },
    ],
  })

  // 3. Continuar ejecución del grafo autónomo
  const runCompleted = await compiledSDLCGraph.invoke(null, threadConfig)

  // 4. Verificaciones críticas de archivos en el workspace
  const virtualGoMod = getVirtualFile('go.mod')
  const virtualDockerCompose = getVirtualFile('docker-compose.yml')
  const virtualMainGo = getVirtualFile('cmd/server/main.go')
  const virtualRedisGo = getVirtualFile('internal/cache/redis.go')
  const virtualSetupCmd = getVirtualFile('setup.cmd')
  const virtualSetupSh = getVirtualFile('setup.sh')
  const virtualStartCmd = getVirtualFile('start.cmd')
  const virtualStartSh = getVirtualFile('start.sh')

  // Archivos de Go DEBEN existir
  assert.ok(virtualGoMod, 'go.mod DEBE existir en el workspace')
  assert.ok(virtualGoMod.includes('module'), 'go.mod debe tener directiva module')
  assert.ok(virtualDockerCompose, 'docker-compose.yml DEBE existir en el workspace')
  assert.ok(virtualDockerCompose.includes('redis:7-alpine'), 'docker-compose.yml debe incluir Redis')
  assert.ok(virtualMainGo, 'cmd/server/main.go DEBE existir en el workspace')
  assert.ok(virtualRedisGo, 'internal/cache/redis.go DEBE existir en el workspace')

  // Scripts de ciclo de vida DEBEN ser específicos de Go
  assert.ok(virtualSetupCmd, 'setup.cmd DEBE existir')
  assert.ok(virtualSetupCmd.includes('go mod tidy'), 'setup.cmd debe contener go mod tidy')
  assert.ok(virtualSetupSh, 'setup.sh DEBE existir')
  assert.ok(virtualSetupSh.includes('go mod tidy'), 'setup.sh debe contener go mod tidy')

  assert.ok(virtualStartCmd, 'start.cmd DEBE existir')
  assert.ok(virtualStartCmd.includes('go run ./cmd/server/main.go'), 'start.cmd debe arrancar el servicio Go')
  assert.ok(virtualStartSh, 'start.sh DEBE existir')
  assert.ok(virtualStartSh.includes('go run ./cmd/server/main.go'), 'start.sh debe arrancar el servicio Go')

  // Archivos de Node/Web NO DEBEN existir en absoluto
  const virtualPackageJson = getVirtualFile('package.json')
  const virtualTsConfig = getVirtualFile('tsconfig.json')
  const virtualViteConfig = getVirtualFile('vite.config.ts')
  const virtualRootIndexHtml = getVirtualFile('index.html')
  const virtualMainTs = getVirtualFile('src/main.ts')

  assert.strictEqual(virtualPackageJson, undefined, 'NO debe generarse package.json en proyecto GoLang')
  assert.strictEqual(virtualTsConfig, undefined, 'NO debe generarse tsconfig.json en proyecto GoLang')
  assert.strictEqual(virtualViteConfig, undefined, 'NO debe generarse vite.config.ts en proyecto GoLang')
  assert.strictEqual(virtualRootIndexHtml, undefined, 'NO debe generarse index.html en proyecto GoLang backend')
  assert.strictEqual(virtualMainTs, undefined, 'NO debe generarse src/main.ts en proyecto GoLang')

  // Rutas de componentes en el grafo
  const sessionComp = runCompleted.componentsGraph['comp_session_service']
  assert.ok(sessionComp, 'comp_session_service debe existir en el grafo')
  assert.strictEqual(
    sessionComp.targetPath,
    'internal/service/comp_session_service.go',
    'La ruta del componente Go debe ser internal/service/comp_session_service.go',
  )

  // Informe de auditoría E2E de LocalLoop debe estar estrictamente en .localloop/
  const virtualE2eReport = getVirtualFile('.localloop/e2e-report.html')
  const virtualSummaryJson = getVirtualFile('.localloop/evidences/e2e-summary.json')
  assert.ok(virtualE2eReport, '.localloop/e2e-report.html debe existir en .localloop')
  assert.ok(virtualSummaryJson, '.localloop/evidences/e2e-summary.json debe existir')
  const parsedSummary = JSON.parse(virtualSummaryJson)
  assert.strictEqual(parsedSummary.runtime, 'go', 'Resumen E2E debe registrar runtime go')
  assert.strictEqual(parsedSummary.hasUI, false, 'Resumen E2E debe registrar hasUI false')

  console.log('✓ Proyecto GoLang + Redis verificado de extremo a extremo: 0 archivos Node/Web, 100% Go idiomático.')

  // =========================================================================
  // Test 5: WebApp con Dexie.js (IndexedDB) y Skeleton Limpio
  // =========================================================================
  console.log('[Test 5] Verificando WebApp con Dexie.js (IndexedDB) y App Shell limpia...')
  clearVirtualFiles()

  const webThreadConfig = {
    configurable: {
      thread_id: `thread-webapp-dexie-${Date.now()}`,
    },
  }

  const webDexieState = {
    sessionId: 991,
    threadId: webThreadConfig.configurable.thread_id,
    workspacePath: process.cwd().replace(/\\/g, '/'),
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        featureTitle: 'Catálogo de Productos Offline con Dexie',
        rawBusinessLanguageText:
          'Desarrollar una aplicación web para catálogo de productos que funcione offline utilizando IndexedDB mediante dexie.js.',
        needsList: [
          { id: 'N-1', description: 'Almacenamiento offline en IndexedDB con dexie.js', expectedImpact: 'Disponibilidad offline' },
        ],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: { title: 'App online que falla sin red', description: 'Sin persistencia', limitationsOrCapabilities: [] },
        desiredSituation: { title: 'PWA con IndexedDB', description: 'Offline first', limitationsOrCapabilities: [] },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_catalog_ui',
            name: 'Interfaz del Catálogo',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Interfaz gráfica reactiva del catálogo con IndexedDB.',
            dependsOn: [],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-CATALOG-OFFLINE',
        title: 'Cargar Catálogo sin Conexión',
        actor: 'Usuario Final',
        happyPath: ['Abrir catálogo', 'Ver productos desde Dexie'],
        exceptions: [],
        expectedBusinessOutcome: 'Catálogo visible offline.',
        acceptanceCriteriaGherkin: 'Given sin conexión, When abre app, Then productos cargan desde IndexedDB.',
      },
    ],
  }

  const runWebPhase1 = await compiledSDLCGraph.invoke(webDexieState, webThreadConfig)
  await compiledSDLCGraph.updateState(webThreadConfig, {
    messages: [
      ...runWebPhase1.messages,
      { role: 'user', content: 'Apruebo la propuesta para la WebApp con Dexie e IndexedDB.' },
    ],
  })

  await compiledSDLCGraph.invoke(null, webThreadConfig)

  // Verificaciones WebApp
  const webPkgJson = getVirtualFile('package.json')
  assert.ok(webPkgJson, 'package.json debe existir para WebApp')
  const parsedPkg = JSON.parse(webPkgJson)
  assert.ok(parsedPkg.dependencies['dexie'], 'package.json debe incluir dexie como dependencia')

  const webIndexHtml = getVirtualFile('index.html')
  assert.ok(webIndexHtml, 'index.html debe existir para la WebApp')
  assert.ok(webIndexHtml.includes('id="app"'), 'index.html debe contener el contenedor #app del producto')
  assert.ok(webIndexHtml.includes('id="components-viewport"'), 'index.html debe contener el viewport para componentes')
  assert.ok(webIndexHtml.includes('/src/main.ts'), 'index.html debe enlazar con /src/main.ts')
  // Comprobar que no es el informe diagnóstico de E2E
  assert.strictEqual(
    webIndexHtml.includes('LocalLoop SDLC — Aplicación Lista para Prueba E2E'),
    false,
    'El index.html del producto NO debe ser sobreescrito por el informe E2E de diagnóstico',
  )

  const webStyleCss = getVirtualFile('src/style.css')
  assert.ok(webStyleCss, 'src/style.css debe existir como hoja de estilos del producto')

  console.log('✓ WebApp con Dexie.js y Skeleton de Producto limpia validada exitosamente.')
  console.log('--- Todas las Pruebas de Scaffolding Universal y Ciclo de Vida Agnóstico Pasaron con Éxito ---')
}

runUniversalScaffoldingTests().catch((err) => {
  console.error('Error ejecutando pruebas de scaffolding universal:', err)
  process.exit(1)
})
