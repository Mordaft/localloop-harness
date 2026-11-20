import assert from 'node:assert'
import {
  buildUniversalScaffold,
  ScaffoldViabilityError,
  ScaffoldAssistanceRequiredError,
  resolveValidationCommand,
} from '../src/agent/sdlc/scaffold/scaffold-engine'
import { clearVirtualFiles, getVirtualFile } from '../src/fs/workspace-fs'
import type { UniversalProjectScaffold } from '../src/agent/sdlc-state'

async function runScaffoldEngineIterativeValidationTests(): Promise<void> {
  console.log('=== Iniciando Pruebas del Motor de Scaffolding con Validación Iterativa (LLD) ===\n')

  // -------------------------------------------------------------------------
  // Test 1: Comprobación síncrona de viabilidad si falta la propuesta del LLM
  // -------------------------------------------------------------------------
  console.log('[Test 1] Verificando excepción síncrona estricta si falta la propuesta...')
  clearVirtualFiles()

  assert.throws(
    () => {
      buildUniversalScaffold({
        userText: 'Proyecto sin propuesta formal',
      })
    },
    (err: any) => err instanceof ScaffoldViabilityError,
    'Debe lanzar ScaffoldViabilityError síncronamente si no hay propuesta ni preset',
  )
  console.log('✓ Excepción síncrona verificada.')

  // -------------------------------------------------------------------------
  // Test 2: El LLD copia físicamente los ficheros antes de la validación
  // -------------------------------------------------------------------------
  console.log('[Test 2] Verificando que el LLD copia los ficheros antes de validar...')
  clearVirtualFiles()

  const validProposal: Partial<UniversalProjectScaffold> = {
    runtime: 'node',
    archetype: 'API_SERVICE',
    hasUI: false,
    frameworkTitle: 'Fastify Microservice',
    componentDirectory: 'src/modules',
    serviceDirectory: 'src/services',
    testDirectory: 'tests',
    manifestFiles: [
      { path: 'package.json', content: '{"name":"fastify-service","version":"1.0.0"}', purpose: 'Manifiesto Node' },
    ],
    configFiles: [
      { path: 'tsconfig.json', content: '{"compilerOptions":{"target":"es2022"}}', purpose: 'Config TypeScript' },
    ],
    skeletonFiles: [
      { path: 'src/index.ts', content: 'console.log("Server starting");', purpose: 'Punto de entrada' },
    ],
    lifecycle: {
      setupCmd: '@echo off\ncall npm install',
      setupSh: '#!/usr/bin/env bash\nnpm install',
      startCmd: '@echo off\nnode dist/index.js',
      startSh: '#!/usr/bin/env bash\nnode dist/index.js',
      testCmd: 'npm test',
      testSh: 'npm test',
    },
  }

  const progressEvents: string[] = []
  let executedCommand = ''

  const scaffold1 = await buildUniversalScaffold({
    proposedScaffold: validProposal,
    initiativeTitle: 'Fastify Service',
    onProgress: (info) => {
      progressEvents.push(`${info.status}:${info.iteration}`)
    },
    executeCommand: async (cmd) => {
      executedCommand = cmd
      // Verificar que los ficheros ya existen en el workspace cuando se ejecuta el comando
      assert.ok(getVirtualFile('package.json'), 'package.json debe existir al validar')
      assert.ok(getVirtualFile('tsconfig.json'), 'tsconfig.json debe existir al validar')
      assert.ok(getVirtualFile('src/index.ts'), 'src/index.ts debe existir al validar')
      assert.ok(getVirtualFile('setup.cmd'), 'setup.cmd debe existir al validar')
      assert.ok(getVirtualFile('setup.sh'), 'setup.sh debe existir al validar')

      return {
        ok: true,
        output: 'added 25 packages in 1.2s',
        exitCode: 0,
      }
    },
  })

  assert.strictEqual(scaffold1.runtime, 'node')
  assert.strictEqual(scaffold1.validationResult?.ok, true)
  assert.strictEqual(scaffold1.validationResult?.attempts, 1)
  assert.ok(progressEvents.includes('COPYING:1'), 'Debe emitir progreso COPYING en iteración 1')
  assert.ok(progressEvents.includes('EXECUTING:1'), 'Debe emitir progreso EXECUTING en iteración 1')
  assert.ok(progressEvents.includes('SUCCESS:1'), 'Debe emitir progreso SUCCESS en iteración 1')
  console.log('✓ Ficheros copiados y validación exitosa en intento 1 verificada.')

  // -------------------------------------------------------------------------
  // Test 3: Proceso iterativo con corrección por LLD (Éxito en intento 2)
  // -------------------------------------------------------------------------
  console.log('[Test 3] Verificando proceso iterativo con corrección y reintento (intento 2)...')
  clearVirtualFiles()

  let commandRunCount = 0
  let repairCount = 0

  const scaffold2 = await buildUniversalScaffold({
    proposedScaffold: validProposal,
    initiativeTitle: 'Fastify Service',
    executeCommand: async (cmd) => {
      commandRunCount++
      if (commandRunCount === 1) {
        return {
          ok: false,
          output: 'npm ERR! missing dependency fastify in package.json',
          exitCode: 1,
        }
      }
      return {
        ok: true,
        output: 'added fastify@4.28.0 in 0.8s',
        exitCode: 0,
      }
    },
    repairScaffold: async ({ attempt, error, scaffold }) => {
      repairCount++
      assert.strictEqual(attempt, 1, 'La auto-reparación debe invocarse tras intento 1')
      assert.ok(error.includes('missing dependency'), 'Debe recibir el error de la validación')
      // LLD corrige el package.json
      return {
        manifestFiles: [
          {
            path: 'package.json',
            content: '{"name":"fastify-service","dependencies":{"fastify":"^4.28.0"}}',
            purpose: 'Manifiesto Node corregido con fastify',
          },
        ],
      }
    },
  })

  assert.strictEqual(scaffold2.validationResult?.ok, true)
  assert.strictEqual(scaffold2.validationResult?.attempts, 2)
  assert.strictEqual(commandRunCount, 2, 'Debe haber ejecutado el comando 2 veces')
  assert.strictEqual(repairCount, 1, 'Debe haber ejecutado reparación 1 vez')

  // Verificar que el package.json físico/virtual en workspace fue actualizado con la versión reparada
  const updatedPkg = getVirtualFile('package.json')
  assert.ok(updatedPkg?.includes('fastify'), 'El archivo en workspace debe tener el contenido corregido')
  console.log('✓ Bucle iterativo de auto-reparación por LLD verificado exitosamente.')

  // -------------------------------------------------------------------------
  // Test 4: Máximo de 3 iteraciones antes de pedir asistencia al usuario
  // -------------------------------------------------------------------------
  console.log('[Test 4] Verificando límite de 3 iteraciones y solicitud de asistencia al usuario...')
  clearVirtualFiles()

  let attemptsExecuted = 0
  let assistanceRequested = false
  let receivedValidationResult: any = null

  await assert.rejects(
    async () => {
      await buildUniversalScaffold({
        proposedScaffold: validProposal,
        initiativeTitle: 'Failing Project',
        executeCommand: async () => {
          attemptsExecuted++
          return {
            ok: false,
            output: `npm ERR! 404 Not Found - attempt ${attemptsExecuted}`,
            exitCode: 1,
          }
        },
        onUserAssistanceRequired: async (reason, result) => {
          assistanceRequested = true
          receivedValidationResult = result
        },
      })
    },
    (err: any) => {
      assert.ok(err instanceof ScaffoldAssistanceRequiredError, 'Debe lanzar ScaffoldAssistanceRequiredError')
      assert.strictEqual(err.requiresUserAssistance, true)
      assert.ok(err.message.includes('3 intentos'), 'El mensaje debe indicar los 3 intentos fallidos')
      return true
    },
    'Debe rechazar con ScaffoldAssistanceRequiredError tras agotar las 3 iteraciones',
  )

  assert.strictEqual(attemptsExecuted, 3, 'Debe haber realizado exactamente 3 iteraciones antes de detenerse')
  assert.strictEqual(assistanceRequested, true, 'Debe haber llamado a onUserAssistanceRequired')
  assert.strictEqual(receivedValidationResult?.attempts, 3)
  assert.strictEqual(receivedValidationResult?.ok, false)
  console.log('✓ Detención tras 3 iteraciones y solicitud de asistencia al usuario verificadas.')

  // -------------------------------------------------------------------------
  // Test 5: Resolución de comandos de validación según plataforma
  // -------------------------------------------------------------------------
  console.log('[Test 5] Verificando resolución de comandos de validación...')
  const dummyScaffold = {
    lifecycle: {
      setupCmd: 'dotnet restore && dotnet build',
      setupSh: 'dotnet restore && dotnet build',
      startCmd: 'godot',
      startSh: 'godot',
      testCmd: 'dotnet test',
      testSh: 'dotnet test',
    },
  } as any

  const cmd = resolveValidationCommand(dummyScaffold)
  assert.ok(cmd.includes('dotnet restore'), 'Debe resolver el comando de setup del scaffold')

  const customCmd = resolveValidationCommand(dummyScaffold, 'custom validate command')
  assert.strictEqual(customCmd, 'custom validate command', 'Debe respetar el comando personalizado')
  console.log('✓ Resolución de comandos verificada.')

  // -------------------------------------------------------------------------
  // Test 6: Robustez ante entradas malformadas del LLM (ej. path: -1, content como objeto)
  // -------------------------------------------------------------------------
  console.log('[Test 6] Verificando robustez ante path: -1 y content como objeto...')
  clearVirtualFiles()

  const malformedProposal: any = {
    runtime: 'node',
    archetype: 'API_SERVICE',
    hasUI: false,
    frameworkTitle: 'Node Service',
    manifestFiles: [
      {
        path: -1,
        content: {
          name: -1,
          version: 0.1,
          type: -1,
          scripts: { test: 'vitest run' },
          dependencies: { fastify: '^4.0.0' },
        },
        purpose: -1,
      },
    ],
    configFiles: [
      {
        path: -1,
        content: { compilerOptions: { target: 'es2022' } },
        purpose: -1,
      },
    ],
    lifecycle: {
      setupCmd: -1,
      setupSh: -1,
      startCmd: -1,
      startSh: -1,
      testCmd: -1,
      testSh: -1,
    },
  }

  const scaffold6 = await buildUniversalScaffold({
    proposedScaffold: malformedProposal,
    initiativeTitle: 'LocalLoop App',
    executeCommand: async (cmd) => {
      // Verificar que los ficheros se materializaron con nombres y contenidos saneados sin crashear
      const pkgJson = getVirtualFile('package.json')
      assert.ok(pkgJson, 'Debe haber normalizado el manifest a package.json')
      assert.ok(typeof pkgJson === 'string', 'package.json debe ser un string')
      const parsed = JSON.parse(pkgJson)
      assert.strictEqual(parsed.name, 'localloop-app', 'El nombre debe ser reemplazado desde -1')
      assert.strictEqual(parsed.version, '0.1.0', 'La versión 0.1 debe formatearse a 0.1.0')
      assert.strictEqual(parsed.type, 'module', 'type: -1 debe reemplazarse por module')

      return {
        ok: true,
        output: 'Scaffold con datos saneados validado correctamente',
        exitCode: 0,
      }
    },
  })

  assert.strictEqual(scaffold6.validationResult?.ok, true)
  assert.strictEqual(scaffold6.validationResult?.attempts, 1)
  console.log('✓ Saneamiento y validación de proposal con path: -1 y content objeto verificados.')

  // -------------------------------------------------------------------------
  // Test 7: Manejo de extensiones bloqueadas por Chromium File System Access API (.cmd, .sh)
  // -------------------------------------------------------------------------
  console.log('[Test 7] Verificando protección ante "Name is not allowed" de Chromium...')
  clearVirtualFiles()

  const {
    setWorkspaceDirectoryHandle,
    writeWorkspaceFileDirect,
    readWorkspaceFile,
  } = await import('../src/fs/workspace-fs')

  // Mock de FileSystemDirectoryHandle que emula la restricción de Chromium para .cmd y .sh
  const mockDiskHandle = {
    name: 'test-folder',
    async getFileHandle(name: string, options?: { create?: boolean }) {
      if (name.endsWith('.cmd') || name.endsWith('.sh') || name.endsWith('.bat')) {
        throw new TypeError("Failed to execute 'getFileHandle' on 'FileSystemDirectoryHandle': Name is not allowed.")
      }
      return {
        async createWritable() {
          let written = ''
          return {
            async write(data: string) { written += data },
            async close() {},
          }
        },
        async getFile() {
          return {
            async text() { return `// Content of ${name}` },
          }
        },
      }
    },
    async getDirectoryHandle() {
      return this
    },
  } as unknown as FileSystemDirectoryHandle

  setWorkspaceDirectoryHandle(mockDiskHandle)

  try {
    // Escribir setup.cmd (bloqueado por Chromium)
    await writeWorkspaceFileDirect('setup.cmd', '@echo off\necho setup')

    // Debe haberse guardado en virtualFileSystem
    const vContent = getVirtualFile('setup.cmd')
    assert.strictEqual(vContent, '@echo off\necho setup', 'setup.cmd debe estar en virtualFileSystem')

    // Leer setup.cmd no debe crashear
    const readRes = await readWorkspaceFile('setup.cmd')
    assert.ok(readRes.content.includes('@echo off'), 'readWorkspaceFile debe recuperar setup.cmd desde memoria virtual')
    console.log('✓ Archivos con extensiones bloqueadas por el navegador manejados sin excepción.')
  } finally {
    setWorkspaceDirectoryHandle(undefined)
  }

  console.log('\n=== Todas las Pruebas de Scaffolding Iterativo (LLD) Pasaron con Éxito ===')
}

runScaffoldEngineIterativeValidationTests().catch((err) => {
  console.error('Fallo en pruebas de scaffolding iterativo:', err)
  process.exit(1)
})
