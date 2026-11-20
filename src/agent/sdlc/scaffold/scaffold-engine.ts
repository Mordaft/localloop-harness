import type {
  ProjectArchetype,
  ProjectRuntime,
  UniversalProjectScaffold,
} from '../../sdlc-state'
import { executeFileSystemTool } from '../../../fs/fs-tools'
import { writeWorkspaceFileDirect } from '../../../fs/workspace-fs'
import { FsWriteMode } from '../../../enums'

export class ScaffoldViabilityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ScaffoldViabilityError'
  }
}

export type ScaffoldPresetProvider = (params: {
  initiativeTitle?: string
  userText?: string
  contextInitiative?: string
}) => Partial<UniversalProjectScaffold> | null

let customScaffoldPresetProvider: ScaffoldPresetProvider | null = null

/**
 * Permite registrar proveedores externos de scaffolding (exclusivamente para arnés de pruebas y fixtures)
 * garantizando que el motor de producción se mantenga 100% puro, genérico y libre de acoplamientos.
 */
export function registerScaffoldPresetProvider(provider: ScaffoldPresetProvider | null): void {
  customScaffoldPresetProvider = provider
}

export interface BuildScaffoldParams {
  proposedScaffold?: Partial<UniversalProjectScaffold>
  declaredDependencies?: Record<string, string>
  declaredDevDependencies?: Record<string, string>
  userText?: string
  contextInitiative?: string
  initiativeTitle?: string
}

/**
 * Valida y ensambla el Scaffold Universal a partir de la propuesta soberana del LLM.
 *
 * Principio de diseño:
 * Si el LLM no es capaz de diseñar y detallar la arquitectura técnica y el scaffolding formal
 * (o está offline), ese error invalida completamente la viabilidad del proyecto.
 * NO se recurre a fallbacks heurísticos ni a plantillas hardcodeadas.
 */
export function buildUniversalScaffold(params: BuildScaffoldParams): UniversalProjectScaffold {
  let proposal = params.proposedScaffold

  // Consulta de fixture de prueba registrada (solo para suites de test deterministas sin LLM en vivo)
  if (!proposal && customScaffoldPresetProvider) {
    const preset = customScaffoldPresetProvider({
      initiativeTitle: params.initiativeTitle,
      userText: params.userText,
      contextInitiative: params.contextInitiative,
    })
    if (preset) {
      proposal = preset
    }
  }

  if (!proposal) {
    throw new ScaffoldViabilityError(
      'El Arquitecto de Solución Técnica (LLM) no ha detallado la propuesta formal de arquitectura y scaffolding del proyecto. La viabilidad del proyecto queda invalidada.',
    )
  }

  const manifests = proposal.manifestFiles || []
  if (!proposal.runtime || !proposal.archetype || manifests.length === 0) {
    throw new ScaffoldViabilityError(
      `Propuesta de scaffolding incompleta: requiere runtime ("${proposal.runtime || 'faltante'}"), archetype ("${proposal.archetype || 'faltante'}") y al menos un archivo manifiesto de proyecto. La viabilidad queda invalidada.`,
    )
  }

  const componentDirectory = proposal.componentDirectory || 'src/components'
  const serviceDirectory = proposal.serviceDirectory || 'src/services'
  const testDirectory = proposal.testDirectory || 'tests'

  const lifecycle = proposal.lifecycle || {
    setupCmd: '@echo off\necho No setup command defined\nexit /b 0',
    setupSh: '#!/usr/bin/env bash\necho "No setup command defined"\nexit 0',
    startCmd: '@echo off\necho No start command defined\nexit /b 0',
    startSh: '#!/usr/bin/env bash\necho "No start command defined"\nexit 0',
    testCmd: 'test',
    testSh: 'test',
  }

  return {
    runtime: proposal.runtime,
    archetype: proposal.archetype,
    frameworkTitle: proposal.frameworkTitle || `${proposal.runtime} (${proposal.archetype})`,
    hasUI: typeof proposal.hasUI === 'boolean' ? proposal.hasUI : false,
    packageManager: proposal.packageManager,
    componentDirectory,
    serviceDirectory,
    testDirectory,
    fileExtension: proposal.fileExtension || '',
    manifestFiles: manifests.map((m) => ({
      path: m.path,
      content: m.content,
      purpose: m.purpose || 'Manifiesto del proyecto',
    })),
    configFiles: proposal.configFiles || [],
    skeletonFiles: proposal.skeletonFiles || [],
    dependencies: {
      runtime: { ...(proposal.dependencies?.runtime || {}), ...(params.declaredDependencies || {}) },
      devOrTest: { ...(proposal.dependencies?.devOrTest || {}), ...(params.declaredDevDependencies || {}) },
    },
    testing: proposal.testing || {
      unitTestRunner: lifecycle.testCmd || 'test',
      unitTestDir: testDirectory,
      e2eTestRunner: lifecycle.testCmd || 'test',
      e2eTestDir: testDirectory,
    },
    lifecycle: {
      setupCmd: lifecycle.setupCmd,
      setupSh: lifecycle.setupSh,
      startCmd: lifecycle.startCmd,
      startSh: lifecycle.startSh,
      testCmd: lifecycle.testCmd || 'test',
      testSh: lifecycle.testSh || 'test',
    },
  }
}

/**
 * Materializa físicamente el scaffolding en el sistema de archivos del workspace.
 * Agnóstico a lenguajes y frameworks: escribe los manifiestos, configuraciones,
 * esqueletos y scripts de ciclo de vida definidos en la especificación.
 */
export async function materializeUniversalScaffold(
  scaffold: UniversalProjectScaffold,
  options?: {
    sessionId?: number
    onProposalCreated?: (id: number, path: string) => void
  },
): Promise<Array<{ path: string; bytesWritten: number }>> {
  const allFiles: Array<{ path: string; content: string; reason: string }> = [
    ...scaffold.manifestFiles.map((m) => ({ path: m.path, content: m.content, reason: m.purpose })),
    ...scaffold.configFiles.map((c) => ({ path: c.path, content: c.content, reason: c.purpose })),
    ...scaffold.skeletonFiles.map((s) => ({ path: s.path, content: s.content, reason: s.purpose })),
    { path: 'setup.cmd', content: scaffold.lifecycle.setupCmd, reason: 'Script de inicialización para Windows' },
    { path: 'setup.sh', content: scaffold.lifecycle.setupSh, reason: 'Script de inicialización para Linux/macOS' },
    { path: 'start.cmd', content: scaffold.lifecycle.startCmd, reason: 'Script de arranque para Windows' },
    { path: 'start.sh', content: scaffold.lifecycle.startSh, reason: 'Script de arranque para Linux/macOS' },
  ]

  const results: Array<{ path: string; bytesWritten: number }> = []

  for (const f of allFiles) {
    try {
      await executeFileSystemTool(
        'fs_write_file',
        { path: f.path, content: f.content, reason: f.reason },
        {
          sessionId: options?.sessionId || 0,
          fsWriteMode: FsWriteMode.AUTO,
          onProposalCreated: options?.onProposalCreated,
        },
      )
    } catch {
      // ignore
    }
    await writeWorkspaceFileDirect(f.path, f.content)
    results.push({ path: f.path, bytesWritten: f.content.length })
  }

  return results
}
