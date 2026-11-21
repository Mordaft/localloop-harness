import assert from 'node:assert'
import {
  extractScaffoldProposalFromText,
  inferUniversalScaffoldFromContext,
  resolveScaffoldProposal,
} from '../src/agent/sdlc/scaffold/scaffold-inference'
import {
  buildUniversalScaffold,
  ScaffoldViabilityError,
  registerScaffoldPresetProvider,
} from '../src/agent/sdlc/scaffold/scaffold-engine'
import { clearVirtualFiles } from '../src/fs/workspace-fs'

async function runPhase1InferenceTests(): Promise<void> {
  console.log('=== Iniciando Pruebas de Inferencia de Scaffolding y Preservación de la Pastilla de Fase 1 ===\n')

  clearVirtualFiles()
  registerScaffoldPresetProvider(null)

  // -------------------------------------------------------------------------
  // Test 1: Extracción de proposal desde bloque JSON en contenido Markdown
  // -------------------------------------------------------------------------
  console.log('[Test 1] Extracción de proposal desde Markdown...')
  const llmContentWithToolJson = `
He analizado los requerimientos y propongo la siguiente solución técnica:

\`\`\`json
{
  "name": "propose_project_scaffold",
  "args": {
    "runtime": "node",
    "archetype": "WEB_APP",
    "frameworkTitle": "SolidJS + Vite",
    "manifestFiles": [
      {
        "path": "package.json",
        "content": "{\\"name\\": \\"solid-app\\"}",
        "purpose": "Manifiesto principal"
      }
    ]
  }
}
\`\`\`

Por favor aprueba la propuesta.
`
  const extracted = extractScaffoldProposalFromText(llmContentWithToolJson)
  assert.ok(extracted, 'Debe extraer la propuesta del bloque JSON')
  assert.strictEqual(extracted.runtime, 'node')
  assert.strictEqual(extracted.archetype, 'WEB_APP')
  assert.strictEqual(extracted.frameworkTitle, 'SolidJS + Vite')
  assert.strictEqual(extracted.manifestFiles?.[0]?.path, 'package.json')
  console.log('✓ Propuesta extraída correctamente de JSON en Markdown.')

  // -------------------------------------------------------------------------
  // Test 2: Inferencia contextual cuando el LLM solo emitió texto en prosa
  // -------------------------------------------------------------------------
  console.log('[Test 2] Inferencia contextual cuando el LLM solo emite texto en prosa...')
  const proseContent = `
Para esta iniciativa crearemos una plataforma web modular con HTML5, TypeScript y TailwindCSS.
Se utilizará Vite para el empaquetado y Dexie.js para la persistencia local.
`
  const resolved = resolveScaffoldProposal({
    rawProposed: undefined,
    llmContent: proseContent,
    initiativeTitle: 'Plataforma Web Modular',
    initiativeNarrative: 'Gestión ágil de operaciones.',
    declaredDependencies: { 'canvas-confetti': '^1.9.0' },
    declaredDevDependencies: { tailwindcss: '^3.4.0' },
  })

  assert.ok(resolved, 'Debe resolver un scaffold completo')
  assert.strictEqual(resolved.runtime, 'node')
  assert.strictEqual(resolved.archetype, 'WEB_APP')
  assert.ok(resolved.manifestFiles.length > 0, 'Debe tener al menos un manifiesto')
  const pkgManifest = resolved.manifestFiles.find((m) => m.path === 'package.json')
  assert.ok(pkgManifest, 'Debe contener package.json')
  assert.ok(pkgManifest.content.includes('canvas-confetti'), 'package.json debe incluir dependencias declaradas')
  assert.strictEqual(resolved.dependencies.runtime['canvas-confetti'], '^1.9.0')
  console.log('✓ Inferencia contextual y fusión de dependencias verificada.')

  // -------------------------------------------------------------------------
  // Test 3: Inferencia de stack específico (Python FastAPI)
  // -------------------------------------------------------------------------
  console.log('[Test 3] Inferencia de stack Python FastAPI...')
  const pythonResolved = resolveScaffoldProposal({
    rawProposed: undefined,
    llmContent: 'Construiremos un microservicio backend en Python con FastAPI y endpoints REST.',
    initiativeTitle: 'Servicio de Facturacion',
  })
  assert.strictEqual(pythonResolved.runtime, 'python')
  assert.strictEqual(pythonResolved.archetype, 'API_SERVICE')
  assert.ok(pythonResolved.manifestFiles.some((m) => m.path === 'pyproject.toml' || m.path === 'requirements.txt'))
  console.log('✓ Inferencia de stack Python FastAPI verificada.')

  // -------------------------------------------------------------------------
  // Test 4: Inferencia de stack Godot + C#
  // -------------------------------------------------------------------------
  console.log('[Test 4] Inferencia de stack Godot + C#...')
  const godotResolved = resolveScaffoldProposal({
    rawProposed: undefined,
    llmContent: 'Desarrollaremos un juego en Godot Engine con scripts en C# .NET.',
    initiativeTitle: 'Cyber Runner',
  })
  assert.strictEqual(godotResolved.runtime, 'csharp')
  assert.strictEqual(godotResolved.archetype, 'GAME_DESKTOP')
  assert.ok(godotResolved.manifestFiles.some((m) => m.path === 'project.godot'))
  console.log('✓ Inferencia de stack Godot + C# verificada.')

  // -------------------------------------------------------------------------
  // Test 5: buildUniversalScaffold con inferFromContext: true
  // -------------------------------------------------------------------------
  console.log('[Test 5] buildUniversalScaffold con inferFromContext: true no lanza ScaffoldViabilityError...')
  const scaffold = await buildUniversalScaffold({
    proposedScaffold: undefined, // Simula LLM que no ejecutó tool call
    initiativeTitle: 'App Modular',
    userText: 'Desarrollo web con TypeScript',
    skipMaterialize: true,
    inferFromContext: true,
  })

  assert.ok(scaffold, 'El scaffold debe construirse exitosamente sin fallar viabilidad')
  assert.strictEqual(scaffold.runtime, 'node')
  assert.strictEqual(scaffold.archetype, 'WEB_APP')
  assert.ok(scaffold.manifestFiles.length > 0)
  console.log('✓ buildUniversalScaffold con inferFromContext resolvió exitosamente.')

  // -------------------------------------------------------------------------
  // Test 6: Comprobación de que la invalidación estricta se mantiene sin inferFromContext
  // -------------------------------------------------------------------------
  console.log('[Test 6] Comprobación de excepción síncrona sin proposal ni inferFromContext...')
  assert.throws(
    () => {
      buildUniversalScaffold({
        userText: 'Texto sin proposal ni inferFromContext',
      })
    },
    (err: any) => err instanceof ScaffoldViabilityError,
    'Debe lanzar ScaffoldViabilityError si falta proposal y no se solicitó inferFromContext',
  )
  console.log('✓ Invalidación estricta sin proposal ni inferencia verificada.')

  console.log('\n=== Todas las Pruebas de Inferencia de Scaffolding Pasaron con Éxito ===')
}

runPhase1InferenceTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Error en pruebas:', err)
    process.exit(1)
  })
