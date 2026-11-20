import { trace } from '../diagnostics'
import { getSavedWorkspaceHandle, listFileProposals, saveWorkspaceHandle } from '../memory/app-db'

export interface WorkspaceFileEntry {
  path: string
  name: string
  extension: string
  size?: number
}

const IGNORED_DIRS = new Set([
  '.git',
  'node_modules',
  'dist',
  'build',
  '.vite',
  '.next',
  'coverage',
])

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'woff',
  'woff2',
  'ttf',
  'eot',
  'otf',
  'pdf',
  'zip',
  'tar',
  'gz',
  'exe',
  'dll',
  'so',
  'dylib',
  'wasm',
])

let activeDirectoryHandle: FileSystemDirectoryHandle | undefined
const virtualFileSystem = new Map<string, string>()

export function setWorkspaceDirectoryHandle(handle: FileSystemDirectoryHandle | undefined): void {
  activeDirectoryHandle = handle
}

export function getWorkspaceDirectoryHandle(): FileSystemDirectoryHandle | undefined {
  return activeDirectoryHandle
}

export function getActiveWorkspaceName(): string {
  return activeDirectoryHandle?.name || 'localloop-workspace'
}

export function sanitizeWorkspacePath(rawPath: unknown): string {
  if (typeof rawPath === 'string') {
    return rawPath.replace(/^\/+/, '').replace(/\\/g, '/').trim()
  }
  if (rawPath && typeof rawPath === 'object') {
    const obj = rawPath as Record<string, unknown>
    if (typeof obj.path === 'string') {
      return obj.path.replace(/^\/+/, '').replace(/\\/g, '/').trim()
    }
    if (typeof obj.filePath === 'string') {
      return obj.filePath.replace(/^\/+/, '').replace(/\\/g, '/').trim()
    }
    if (typeof obj.targetPath === 'string') {
      return obj.targetPath.replace(/^\/+/, '').replace(/\\/g, '/').trim()
    }
  }
  if (typeof rawPath === 'number' && Number.isFinite(rawPath)) {
    return ''
  }
  const str = String(rawPath ?? '').trim()
  if (str === 'undefined' || str === 'null' || str === '[object Object]' || str === '-1') {
    return ''
  }
  return str.replace(/^\/+/, '').replace(/\\/g, '/').trim()
}

export function setVirtualFile(path: unknown, content: unknown): void {
  const normalized = sanitizeWorkspacePath(path)
  if (!normalized) return
  const stringContent =
    typeof content === 'string'
      ? content
      : typeof content === 'object' && content !== null
        ? JSON.stringify(content, null, 2)
        : String(content ?? '')
  virtualFileSystem.set(normalized, stringContent)
}

export function getVirtualFile(path: unknown): string | undefined {
  const normalized = sanitizeWorkspacePath(path)
  if (!normalized) return undefined
  return virtualFileSystem.get(normalized)
}

export function clearVirtualFiles(): void {
  virtualFileSystem.clear()
}

/**
 * Requests interactive access to a local folder using File System Access API (`window.showDirectoryPicker`).
 */
export async function pickWorkspaceDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  if (typeof window === 'undefined' || !('showDirectoryPicker' in window)) {
    throw new Error('Tu navegador no soporta File System Access API (window.showDirectoryPicker).')
  }
  const picker = (
    window as unknown as {
      showDirectoryPicker: (options?: { mode?: 'read' | 'readwrite' }) => Promise<FileSystemDirectoryHandle>
    }
  ).showDirectoryPicker
  const handle = await picker({ mode: 'readwrite' })
  activeDirectoryHandle = handle
  await saveWorkspaceHandle(handle)
  trace('fs.workspace.picked', { name: handle.name })
  return handle
}

/**
 * Restores a previously saved `FileSystemDirectoryHandle` from IndexedDB if permissions are granted.
 */
export async function restoreSavedWorkspaceDirectory(): Promise<FileSystemDirectoryHandle | undefined> {
  if (activeDirectoryHandle) return activeDirectoryHandle
  const saved = await getSavedWorkspaceHandle()
  if (!saved?.handle) return undefined
  try {
    const permHandle = saved.handle as unknown as {
      queryPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
      requestPermission?: (opts: { mode: 'read' | 'readwrite' }) => Promise<PermissionState>
    }
    if (typeof permHandle.queryPermission === 'function') {
      const state = await permHandle.queryPermission({ mode: 'readwrite' })
      if (state === 'granted') {
        activeDirectoryHandle = saved.handle
        return saved.handle
      }
    } else {
      activeDirectoryHandle = saved.handle
      return saved.handle
    }
  } catch {
    // Permission not yet re-granted
  }
  return undefined
}

export async function listWorkspaceFiles(maxFiles = 200): Promise<WorkspaceFileEntry[]> {
  const handle = activeDirectoryHandle
  if (!handle) {
    const fileMap = new Map<string, number>()
    for (const [path, content] of virtualFileSystem.entries()) {
      fileMap.set(path, content.length)
    }
    try {
      const proposals = await listFileProposals()
      for (const p of proposals) {
        if (!fileMap.has(p.path)) {
          fileMap.set(p.path, p.proposedContent.length)
        }
      }
    } catch {
      // ignore
    }
    return [...fileMap.entries()].map(([path, size]) => ({
      path,
      name: path.split('/').pop() ?? path,
      extension: path.split('.').pop()?.toLowerCase() ?? 'txt',
      size,
    }))
  }

  const results: WorkspaceFileEntry[] = []

  async function walk(dir: FileSystemDirectoryHandle, prefix: string): Promise<void> {
    if (results.length >= maxFiles) return
    const entriesIter = (
      dir as unknown as {
        values: () => AsyncIterable<FileSystemHandle>
      }
    ).values()

    for await (const entry of entriesIter) {
      if (results.length >= maxFiles) break
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.kind === 'directory') {
        if (IGNORED_DIRS.has(entry.name)) continue
        await walk(entry as FileSystemDirectoryHandle, relPath)
      } else if (entry.kind === 'file') {
        const ext = entry.name.includes('.') ? entry.name.split('.').pop()!.toLowerCase() : 'txt'
        if (BINARY_EXTENSIONS.has(ext)) continue
        results.push({
          path: relPath,
          name: entry.name,
          extension: ext,
        })
      }
    }
  }

  await walk(handle, '')
  return results.sort((a, b) => a.path.localeCompare(b.path))
}

async function resolveFileHandle(
  root: FileSystemDirectoryHandle,
  filePath: unknown,
  create = false,
): Promise<FileSystemFileHandle> {
  const normalized = sanitizeWorkspacePath(filePath)
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('Ruta de archivo vacía o inválida.')

  let currentDir = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create })
  }
  return currentDir.getFileHandle(parts[parts.length - 1], { create })
}

export async function readWorkspaceFile(
  filePath: unknown,
  lineStart?: number,
  lineEnd?: number,
): Promise<{ content: string; numberedContent: string; totalLines: number; startLine: number; endLine: number }> {
  const normalized = sanitizeWorkspacePath(filePath)
  if (!normalized) {
    throw new Error('Ruta de archivo vacía o inválida.')
  }
  let rawText = ''

  if (activeDirectoryHandle) {
    try {
      const fileHandle = await resolveFileHandle(activeDirectoryHandle, normalized, false)
      const file = await fileHandle.getFile()
      rawText = await file.text()
    } catch (err: unknown) {
      if (virtualFileSystem.has(normalized)) {
        rawText = virtualFileSystem.get(normalized)!
      } else {
        try {
          const companionHandle = await resolveFileHandle(activeDirectoryHandle, `${normalized}.txt`, false)
          const compFile = await companionHandle.getFile()
          rawText = await compFile.text()
        } catch {
          try {
            const proposals = await listFileProposals()
            const match = [...proposals].reverse().find((p) => p.path === normalized)
            if (match) {
              rawText = match.proposedContent
            } else {
              throw err
            }
          } catch {
            throw new Error(`El archivo "${normalized}" no existe en el workspace actual.`)
          }
        }
      }
    }
  } else if (virtualFileSystem.has(normalized)) {
    rawText = virtualFileSystem.get(normalized)!
  } else {
    try {
      const proposals = await listFileProposals()
      const match = [...proposals].reverse().find((p) => p.path === normalized)
      if (match) {
        rawText = match.proposedContent
      } else {
        throw new Error(`El archivo "${normalized}" no existe en el workspace actual.`)
      }
    } catch {
      throw new Error(`El archivo "${normalized}" no existe en el workspace actual.`)
    }
  }

  const allLines = rawText.split('\n')
  const totalLines = allLines.length
  const start = lineStart && lineStart >= 1 ? Math.min(lineStart, totalLines) : 1
  const end = lineEnd && lineEnd >= start ? Math.min(lineEnd, totalLines) : totalLines
  const sliced = allLines.slice(start - 1, end)
  const numberedContent = sliced.map((l, idx) => `L${start + idx}: ${l}`).join('\n')

  return {
    content: sliced.join('\n'),
    numberedContent,
    totalLines,
    startLine: start,
    endLine: end,
  }
}

export async function writeWorkspaceFileDirect(filePath: unknown, content: unknown): Promise<void> {
  const normalized = sanitizeWorkspacePath(filePath)
  if (!normalized) {
    throw new Error('Ruta de archivo vacía o inválida.')
  }
  const stringContent =
    typeof content === 'string'
      ? content
      : typeof content === 'object' && content !== null
        ? JSON.stringify(content, null, 2)
        : String(content ?? '')

  virtualFileSystem.set(normalized, stringContent)

  if (activeDirectoryHandle) {
    try {
      const fileHandle = await resolveFileHandle(activeDirectoryHandle, normalized, true)
      const writable = await fileHandle.createWritable()
      await writable.write(stringContent)
      await writable.close()
      trace('fs.file.written_to_disk', { path: normalized, bytes: stringContent.length })
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err)
      // El navegador (Chromium/Edge) bloquea la creación directa en disco de extensiones ejecutables o de script
      // (.cmd, .bat, .sh, .exe, etc.) mediante File System Access API arrojando "Name is not allowed" o SecurityError.
      if (
        errMsg.includes('Name is not allowed') ||
        errMsg.includes('not allowed') ||
        errMsg.includes('SecurityError') ||
        (err instanceof Error && (err.name === 'TypeError' || err.name === 'SecurityError'))
      ) {
        trace('fs.file.disk_restricted_by_browser', {
          path: normalized,
          reason:
            'El navegador restringe la escritura en disco de este archivo por motivos de seguridad (File System Access API). El archivo se preserva en el sistema virtual.',
          error: errMsg,
        })

        // Guardar archivo complementario legible en disco con sufijo .txt para inspección directa por parte del usuario
        try {
          const companionPath = `${normalized}.txt`
          const compHandle = await resolveFileHandle(activeDirectoryHandle, companionPath, true)
          const compWritable = await compHandle.createWritable()
          await compWritable.write(stringContent)
          await compWritable.close()
          trace('fs.file.written_companion_to_disk', { path: companionPath, bytes: stringContent.length })
        } catch {
          // Si el archivo complementario tampoco puede escribirse, continuar sin bloquear
        }
        return
      }
      throw err
    }
  } else {
    trace('fs.file.written_to_virtual', { path: normalized, bytes: stringContent.length })
  }
}
