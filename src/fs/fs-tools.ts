import { FileProposalStatus, FsWriteMode, type FsWriteMode as FsWriteModeType } from '../enums'
import type { OpenAiToolSpec } from '../llm/llm-client'
import { createFileProposal, listFileProposals, updateFileProposalStatus } from '../memory/app-db'
import { listWorkspaceFiles, readWorkspaceFile, writeWorkspaceFileDirect } from './workspace-fs'

export function getFileSystemToolSpecs(): OpenAiToolSpec[] {
  return [
    {
      type: 'function',
      function: {
        name: 'fs_list_dir',
        description: 'Lista los archivos de código y configuración disponibles en el directorio local del usuario.',
        parameters: {
          type: 'object',
          properties: {
            filterPrefix: {
              type: 'string',
              description: 'Prefijo o subdirectorio opcional para filtrar rutas.',
            },
          },
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_read_file',
        description: 'Lee el contenido de un archivo local completo o un rango de líneas.',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta relativa del archivo dentro del workspace.' },
            lineStart: { type: 'integer', minimum: 1 },
            lineEnd: { type: 'integer', minimum: 1 },
          },
          required: ['path'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_write_file',
        description:
          'Crea o actualiza un archivo en el workspace local. Por defecto genera una propuesta de cambio sujeta a confirmación humana (o escribe directamente si el modo automático está activo).',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Ruta relativa del archivo a crear o sobrescribir.' },
            content: { type: 'string', description: 'Contenido completo propuesto para el archivo.' },
            reason: { type: 'string', description: 'Explicación breve del cambio realizado.' },
          },
          required: ['path', 'content'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'fs_search',
        description: 'Busca un texto o patrón en todos los archivos del workspace local.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Texto a buscar en los ficheros.' },
          },
          required: ['query'],
        },
      },
    },
  ]
}

export async function executeFileSystemTool(
  toolName: string,
  args: Record<string, unknown>,
  options: {
    sessionId: number
    fsWriteMode: FsWriteModeType
    onProposalCreated?: (proposalId: number, path: string) => void
  },
): Promise<{ output: string; requiresHumanConfirmation?: boolean; proposalId?: number }> {
  if (toolName === 'fs_list_dir') {
    const prefix = typeof args.filterPrefix === 'string' ? args.filterPrefix.trim() : ''
    const files = await listWorkspaceFiles()
    const filtered = prefix ? files.filter((f) => f.path.startsWith(prefix)) : files
    return {
      output: JSON.stringify({
        totalFiles: filtered.length,
        files: filtered.map((f) => f.path),
      }),
    }
  }

  if (toolName === 'fs_read_file') {
    const path = String(args.path ?? '').trim()
    if (!path) throw new Error('fs_read_file requiere el argumento "path".')
    const lineStart = typeof args.lineStart === 'number' ? args.lineStart : undefined
    const lineEnd = typeof args.lineEnd === 'number' ? args.lineEnd : undefined
    const result = await readWorkspaceFile(path, lineStart, lineEnd)
    return {
      output: JSON.stringify({
        path,
        startLine: result.startLine,
        endLine: result.endLine,
        totalLines: result.totalLines,
        content: result.numberedContent,
      }),
    }
  }

  if (toolName === 'fs_write_file') {
    const path = String(args.path ?? '').trim()
    const proposedContent = String(args.content ?? '')
    const reason = String(args.reason ?? 'Actualización propuesta por el agente LocalLoop')
    if (!path) throw new Error('fs_write_file requiere el argumento "path".')

    let originalContent = ''
    try {
      const existing = await readWorkspaceFile(path)
      originalContent = existing.content
    } catch {
      originalContent = ''
    }

    if (options.fsWriteMode === FsWriteMode.AUTO) {
      await writeWorkspaceFileDirect(path, proposedContent)
      const proposalId = await createFileProposal({
        sessionId: options.sessionId,
        path,
        originalContent,
        proposedContent,
        reason,
        status: FileProposalStatus.APPLIED,
      })
      options.onProposalCreated?.(proposalId, path)
      return {
        output: JSON.stringify({
          status: 'written_to_disk',
          mode: 'auto',
          proposalId,
          path,
          bytesWritten: proposedContent.length,
        }),
        requiresHumanConfirmation: false,
        proposalId,
      }
    }

    // Default mode: Human Confirmation ('confirm')
    const proposalId = await createFileProposal({
      sessionId: options.sessionId,
      path,
      originalContent,
      proposedContent,
      reason,
      status: FileProposalStatus.PENDING,
    })
    options.onProposalCreated?.(proposalId, path)

    return {
      output: JSON.stringify({
        status: 'pending_human_confirmation',
        mode: 'confirm',
        proposalId,
        path,
        message:
          'El cambio ha sido registrado como propuesta pendiente de confirmación humana en la bandeja del Workspace.',
      }),
      requiresHumanConfirmation: true,
      proposalId,
    }
  }

  if (toolName === 'fs_search') {
    const query = String(args.query ?? '').trim().toLowerCase()
    if (!query) return { output: JSON.stringify({ matches: [] }) }
    const files = await listWorkspaceFiles(100)
    const matches: Array<{ path: string; line: number; preview: string }> = []
    for (const file of files) {
      try {
        const { content } = await readWorkspaceFile(file.path)
        const lines = content.split('\n')
        for (let i = 0; i < lines.length; i += 1) {
          if (lines[i].toLowerCase().includes(query)) {
            matches.push({
              path: file.path,
              line: i + 1,
              preview: lines[i].trim().slice(0, 140),
            })
            if (matches.length >= 30) break
          }
        }
      } catch {
        // Ignore unreadable file
      }
      if (matches.length >= 30) break
    }
    return {
      output: JSON.stringify({ query, matchesCount: matches.length, matches }),
    }
  }

  throw new Error(`Herramienta FS desconocida: ${toolName}`)
}

/**
 * Applies a pending human-confirmed file proposal to the local disk (FileSystemDirectoryHandle).
 */
export async function approveAndApplyFileProposal(
  proposalOrId:
    | number
    | {
        id: number
        path: string
        proposedContent: string
      },
): Promise<void> {
  if (typeof proposalOrId === 'number') {
    const all = await listFileProposals()
    const target = all.find((p) => p.id === proposalOrId)
    if (!target) {
      throw new Error(`Propuesta #${proposalOrId} no encontrada.`)
    }
    await writeWorkspaceFileDirect(target.path, target.proposedContent)
    await updateFileProposalStatus(proposalOrId, FileProposalStatus.APPLIED)
    return
  }
  await writeWorkspaceFileDirect(proposalOrId.path, proposalOrId.proposedContent)
  await updateFileProposalStatus(proposalOrId.id, FileProposalStatus.APPLIED)
}

export async function rejectFileProposal(proposalId: number): Promise<void> {
  await updateFileProposalStatus(proposalId, FileProposalStatus.REJECTED)
}
