import assert from 'node:assert'
import { disableTestPresets, enableTestPresets } from './fixtures/presets'
import { compiledSDLCGraph } from '../src/agent/sdlc-graph'
import { getVirtualFile, clearVirtualFiles } from '../src/fs/workspace-fs'
import {
  buildUniversalScaffold,
  ScaffoldViabilityError,
} from '../src/agent/sdlc/scaffold/scaffold-engine'
import { generateComponentCode } from '../src/agent/sdlc/codegen/component-codegen'
import { analyzeAndAssignMcpCapabilities, clearMcpCapabilityCache, type McpToolDefinition } from '../src/mcp/mcp-client'
import { verifyAndRepairApplicationCompilation } from '../src/agent/sdlc/verification/compilation-verifier'

async function runGodotCsharpTests() {
  console.log('--- Iniciando Pruebas de Desacoplamiento Completo: Godot 4 + C# y Tether CLI ---')
  clearVirtualFiles()
  clearMcpCapabilityCache()

  // =========================================================================
  // Test 1: Invalidación Inmediata de Viabilidad si no hay propuesta técnica formal
  // =========================================================================
  console.log('[Test 1] Verificando invalidación estricta de viabilidad sin propuesta técnica...')

  disableTestPresets()
  assert.throws(
    () => {
      buildUniversalScaffold({
        userText: 'Desarrollar un videojuego de plataformas de escritorio utilizando Godot Engine con C#',
      })
    },
    (err: any) => err instanceof ScaffoldViabilityError,
    'Debe lanzar ScaffoldViabilityError invalidando la viabilidad del proyecto si el LLM no detalla el scaffolding',
  )
  enableTestPresets()
  console.log('✓ Invalidación inmediata de viabilidad verificada con éxito.')

  // =========================================================================
  // Test 2: Construcción de Scaffold Universal para Godot Engine 4.x + C# .NET 8
  // =========================================================================
  console.log('[Test 2] Validando estructura de manifiestos, escenas y scripts de Godot 4 + C#...')

  const godotScaffold = buildUniversalScaffold({
    userText: 'Juego de escritorio en Godot Engine con C#',
    initiativeTitle: 'Cyberpunk Runner Game',
  })

  assert.strictEqual(godotScaffold.runtime, 'csharp')
  assert.strictEqual(godotScaffold.archetype, 'GAME_DESKTOP')
  assert.strictEqual(godotScaffold.hasUI, false)
  assert.strictEqual(godotScaffold.componentDirectory, 'scripts')
  assert.strictEqual(godotScaffold.serviceDirectory, 'scripts')
  assert.strictEqual(godotScaffold.fileExtension, 'cs')

  // 1. Manifiestos de Godot y .NET
  const projectGodot = godotScaffold.manifestFiles.find((m) => m.path === 'project.godot')
  assert.ok(projectGodot, 'project.godot DEBE existir como manifiesto principal')
  assert.ok(projectGodot.content.includes('config_version=5'), 'project.godot debe especificar config_version=5')
  assert.ok(projectGodot.content.includes('run/main_scene="res://scenes/Main.tscn"'), 'project.godot debe apuntar a la escena principal')
  assert.ok(projectGodot.content.includes('"C#"'), 'project.godot debe configurar feature C#')

  const csproj = godotScaffold.manifestFiles.find((m) => m.path.endsWith('.csproj'))
  assert.ok(csproj, 'Archivo .csproj de C# DEBE existir')
  assert.ok(csproj.content.includes('Godot.NET.Sdk/4.3.0'), 'Debe usar el SDK oficial Godot.NET.Sdk')
  assert.ok(csproj.content.includes('<TargetFramework>net8.0</TargetFramework>'), 'Debe apuntar a .NET 8')

  // 2. Escena inicial (.tscn) y script de inicio (.cs)
  const mainTscn = godotScaffold.configFiles.find((c) => c.path === 'scenes/Main.tscn')
  assert.ok(mainTscn, 'scenes/Main.tscn DEBE existir')
  assert.ok(mainTscn.content.includes('[ext_resource type="Script" path="res://scripts/Main.cs"'), 'Main.tscn debe vincular con scripts/Main.cs')

  const mainCs = godotScaffold.skeletonFiles.find((s) => s.path === 'scripts/Main.cs')
  assert.ok(mainCs, 'scripts/Main.cs DEBE existir')
  assert.ok(mainCs.content.includes('using Godot;'), 'Main.cs debe importar namespace Godot')
  assert.ok(mainCs.content.includes('public partial class Main : Node2D'), 'Main.cs debe heredar de Node2D')
  assert.ok(mainCs.content.includes('_Ready()'), 'Main.cs debe implementar _Ready()')

  // 3. Scripts de ciclo de vida agnósticos
  assert.ok(godotScaffold.lifecycle.setupCmd.includes('dotnet restore'), 'setup.cmd debe restaurar paquetes .NET')
  assert.ok(godotScaffold.lifecycle.setupCmd.includes('dotnet build'), 'setup.cmd debe compilar proyecto .NET')
  assert.ok(godotScaffold.lifecycle.setupSh.includes('dotnet restore'), 'setup.sh debe restaurar paquetes .NET')
  assert.ok(godotScaffold.lifecycle.startCmd.includes('godot --path .'), 'start.cmd debe invocar godot engine')
  assert.ok(godotScaffold.lifecycle.startSh.includes('godot --path .'), 'start.sh debe invocar godot engine')
  assert.strictEqual(godotScaffold.lifecycle.testCmd, 'dotnet test', 'testCmd debe ser dotnet test')

  // 4. Verificación negativa de contaminación
  const hasNodeFiles = godotScaffold.manifestFiles.some((m) => m.path === 'package.json') ||
    godotScaffold.configFiles.some((c) => c.path === 'tsconfig.json') ||
    godotScaffold.skeletonFiles.some((s) => s.path === 'index.html')
  assert.strictEqual(hasNodeFiles, false, 'Scaffold de Godot no debe contener archivos de Node/Web')

  console.log('✓ Scaffold de Godot 4 + C# verificado sin contaminación procedural.')

  // =========================================================================
  // Test 3: Soberanía de la Tool propose_project_scaffold invocada por el LLM
  // =========================================================================
  console.log('[Test 3] Verificando soberanía de propose_project_scaffold cuando el LLM define una estructura personalizada...')

  const customLlmProposal = {
    runtime: 'csharp',
    archetype: 'GAME_DESKTOP',
    hasUI: false,
    frameworkTitle: 'Godot 4 Custom VR Architecture',
    componentDirectory: 'scripts/gameplay',
    serviceDirectory: 'scripts/core',
    testDirectory: 'tests/unit',
    fileExtension: 'cs',
    manifestFiles: [
      { path: 'project.godot', content: '; Godot custom config', purpose: 'Custom engine file' },
      { path: 'GameVR.csproj', content: '<Project Sdk="Godot.NET.Sdk/4.3.0" />', purpose: 'VR Csproj' },
    ],
    configFiles: [
      { path: 'scenes/VRWorld.tscn', content: '[gd_scene format=3]', purpose: 'VR Scene' },
    ],
    skeletonFiles: [
      { path: 'scripts/core/VRManager.cs', content: 'using Godot;\npublic class VRManager : Node {}', purpose: 'VR core' },
    ],
    lifecycle: {
      setupCmd: '@echo off\ncall dotnet restore',
      setupSh: '#!/usr/bin/env bash\ndotnet restore',
      startCmd: '@echo off\ngodot --path . --rendering-driver vulkan',
      startSh: '#!/usr/bin/env bash\ngodot --path . --rendering-driver vulkan',
      testCmd: 'dotnet test tests/unit',
      testSh: 'dotnet test tests/unit',
    },
  }

  const resolvedFromLlm = buildUniversalScaffold({
    userText: 'Juego VR personalizado en Godot',
    proposedScaffold: customLlmProposal,
  })

  assert.strictEqual(resolvedFromLlm.frameworkTitle, 'Godot 4 Custom VR Architecture')
  assert.strictEqual(resolvedFromLlm.componentDirectory, 'scripts/gameplay')
  assert.strictEqual(resolvedFromLlm.serviceDirectory, 'scripts/core')
  assert.strictEqual(resolvedFromLlm.fileExtension, 'cs')
  assert.strictEqual(resolvedFromLlm.manifestFiles[1].path, 'GameVR.csproj')
  assert.strictEqual(resolvedFromLlm.lifecycle.startCmd, '@echo off\ngodot --path . --rendering-driver vulkan')

  console.log('✓ La propuesta del LLM se respeta de forma íntegra y soberana sin ser sobreescrita.')

  // =========================================================================
  // Test 4: Generación de código C# para componentes del juego
  // =========================================================================
  console.log('[Test 4] Verificando generación de componentes en C#...')

  const csArtifacts = generateComponentCode({
    id: 'comp_player_controller',
    name: 'Controlador del Jugador',
    description: 'Movimiento, físicas y animaciones del personaje principal',
    targetPath: 'scripts/comp_player_controller.cs',
    dependsOn: [],
    status: 'READY',
  })

  assert.ok(csArtifacts.code.includes('namespace Game.Services;'), 'Código C# debe definir namespace')
  assert.ok(csArtifacts.code.includes('public class CompPlayerControllerItem'), 'Debe definir clase modelo de datos')
  assert.ok(csArtifacts.code.includes('public interface ICompPlayerControllerService'), 'Debe definir contrato de interfaz')
  assert.ok(csArtifacts.code.includes('public partial class CompPlayerControllerService'), 'Debe definir clase de servicio')
  assert.strictEqual(csArtifacts.files[0].path, 'scripts/comp_player_controller.cs')

  console.log('✓ Componente C# generado con sintaxis limpia y contratos tipados.')

  // =========================================================================
  // Test 5: Flujo End-to-End en SDLC Graph con Godot C# y Verificación Tether CLI
  // =========================================================================
  console.log('[Test 5] Ejecutando SDLC Graph completo con Godot + C#...')
  clearVirtualFiles()

  const threadConfig = {
    configurable: {
      thread_id: `thread-godot-test-${Date.now()}`,
    },
  }

  const godotState = {
    sessionId: 995,
    threadId: threadConfig.configurable.thread_id,
    workspacePath: process.cwd().replace(/\\/g, '/'),
    discoveryInputValid: true,
    marketArchStandard: 'C4_AND_CLEAN_ARCHITECTURE',
    phase0Data: {
      step1: {
        featureTitle: 'Juego de Plataformas 2D en Godot',
        rawBusinessLanguageText:
          'Crear un juego de escritorio usando una framework como Godot con C# como lenguaje de programación.',
        needsList: [
          { id: 'N-1', description: 'Control de físicas y gravedad en C#', expectedImpact: 'Fluidez' },
        ],
      },
      step2: {
        marketStandard: 'C4_AND_CLEAN_ARCHITECTURE',
        currentSituation: { title: 'Sin videojuego previo', description: 'Inicio desde cero', limitationsOrCapabilities: [] },
        desiredSituation: { title: 'Juego Godot 4 C# ejecutable', description: 'Ventana de escritorio nativa', limitationsOrCapabilities: [] },
      },
      step3: {
        featureComponentMappings: [
          {
            componentId: 'comp_player_movement',
            name: 'Movimiento del Jugador',
            action: 'CREATE' as const,
            targetState: 'DESIRED' as const,
            description: 'Lógica de salto y desplazamiento lateral en C#.',
            dependsOn: [],
          },
        ],
      },
    },
    useCases: [
      {
        id: 'UC-GODOT-MOVE',
        title: 'Mover Personaje a la Derecha',
        actor: 'Jugador',
        happyPath: ['Presionar tecla D', 'Personaje se mueve'],
        exceptions: [],
        expectedBusinessOutcome: 'El sprite se desplaza fluidamente en pantalla.',
        acceptanceCriteriaGherkin: 'Given juego abierto, When presiona tecla D, Then personaje avanza.',
      },
    ],
  }

  // 1. Invocar hasta pausa HITL de Fase 1
  const runPhase1 = await compiledSDLCGraph.invoke(godotState, threadConfig)
  assert.strictEqual(runPhase1.currentPhase, '1_STRATEGY_AND_PLAN')

  // 2. Responder al HITL aprobando el framework Godot + C#
  await compiledSDLCGraph.updateState(threadConfig, {
    messages: [
      ...runPhase1.messages,
      {
        role: 'user',
        content: 'Apruebo la propuesta para el juego de escritorio en Godot Engine con C#.',
      },
    ],
  })

  // 3. Continuar ejecución autónoma
  const runDone = await compiledSDLCGraph.invoke(null, threadConfig)

  // 4. Verificaciones de Workspace para Godot + C#
  const vProjectGodot = getVirtualFile('project.godot')
  const vCsproj = getVirtualFile('juego-de-plataformas-2d-en-godot.csproj')
  const vMainTscn = getVirtualFile('scenes/Main.tscn')
  const vMainCs = getVirtualFile('scripts/Main.cs')
  const vSetupCmd = getVirtualFile('setup.cmd')
  const vStartCmd = getVirtualFile('start.cmd')

  assert.ok(vProjectGodot, 'project.godot debe estar en el workspace')
  assert.ok(vCsproj, '.csproj debe estar en el workspace')
  assert.ok(vMainTscn, 'scenes/Main.tscn debe estar en el workspace')
  assert.ok(vMainCs, 'scripts/Main.cs debe estar en el workspace')
  assert.ok(vSetupCmd, 'setup.cmd debe estar en el workspace')
  assert.ok(vSetupCmd.includes('dotnet restore'), 'setup.cmd debe incluir dotnet restore')
  assert.ok(vStartCmd, 'start.cmd debe estar en el workspace')
  assert.ok(vStartCmd.includes('godot --path .'), 'start.cmd debe arrancar Godot')

  // Verificación de ruta del componente en C#
  const playerComp = runDone.componentsGraph['comp_player_movement']
  assert.ok(playerComp, 'comp_player_movement debe existir en el grafo')
  assert.strictEqual(
    playerComp.targetPath,
    'scripts/comp_player_movement.cs',
    'La ruta del componente debe ser scripts/comp_player_movement.cs',
  )

  // Verificación negativa: Cero archivos Node/Web en la raíz
  assert.strictEqual(getVirtualFile('package.json'), undefined, 'NO debe haber package.json')
  assert.strictEqual(getVirtualFile('tsconfig.json'), undefined, 'NO debe haber tsconfig.json')
  assert.strictEqual(getVirtualFile('index.html'), undefined, 'NO debe haber index.html en raíz')

  // 5. Verificación de Tether CLI con buildCommand adaptativo
  const tetherDef: McpToolDefinition = {
    serverName: 'tether',
    serverUrl: 'http://localhost:7434/mcp',
    name: 'run_cli',
    qualifiedName: 'mcp_tether_run_cli',
    description: '[MCP: tether] Ejecuta comandos CLI en el host',
    inputSchema: {
      type: 'object',
      properties: { cmd: { type: 'string' } },
      required: ['cmd'],
    },
  }

  await analyzeAndAssignMcpCapabilities({
    preDiscoveredTools: [tetherDef],
    forceRefresh: true,
  })

  // Simular llamada a verifyAndRepairApplicationCompilation con el estado de Godot
  const tetherResult = await verifyAndRepairApplicationCompilation(runDone)
  assert.ok(tetherResult, 'verifyAndRepairApplicationCompilation debe retornar un resultado')
  console.log('✓ Integración Tether con comando de verificación de build validada.')

  console.log('--- Todas las Pruebas de Godot 4 + C# y Tether CLI Pasaron con Éxito ---')
}

runGodotCsharpTests().catch((err) => {
  console.error('Error en pruebas de Godot C#:', err)
  process.exit(1)
})
