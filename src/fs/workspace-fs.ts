import { trace } from '../diagnostics'
import { getSavedWorkspaceHandle, saveWorkspaceHandle } from '../memory/app-db'

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
  '.localloop',
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

export function setVirtualFile(path: string, content: string): void {
  const normalized = path.replace(/^\/+/, '').replace(/\\/g, '/')
  virtualFileSystem.set(normalized, content)
}

export function getVirtualFile(path: string): string | undefined {
  const normalized = path.replace(/^\/+/, '').replace(/\\/g, '/')
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
    return [...virtualFileSystem.entries()].map(([path, content]) => ({
      path,
      name: path.split('/').pop() ?? path,
      extension: path.split('.').pop()?.toLowerCase() ?? 'txt',
      size: content.length,
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
  filePath: string,
  create = false,
): Promise<FileSystemFileHandle> {
  const normalized = filePath.replace(/^\/+/, '').replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  if (parts.length === 0) throw new Error('Ruta de archivo vacía.')

  let currentDir = root
  for (let i = 0; i < parts.length - 1; i += 1) {
    currentDir = await currentDir.getDirectoryHandle(parts[i], { create })
  }
  return currentDir.getFileHandle(parts[parts.length - 1], { create })
}

export async function readWorkspaceFile(
  filePath: string,
  lineStart?: number,
  lineEnd?: number,
): Promise<{ content: string; numberedContent: string; totalLines: number; startLine: number; endLine: number }> {
  const normalized = filePath.replace(/^\/+/, '').replace(/\\/g, '/')
  let rawText = ''

  if (activeDirectoryHandle) {
    const fileHandle = await resolveFileHandle(activeDirectoryHandle, normalized, false)
    const file = await fileHandle.getFile()
    rawText = await file.text()
  } else if (virtualFileSystem.has(normalized)) {
    rawText = virtualFileSystem.get(normalized)!
  } else {
    throw new Error(`El archivo "${normalized}" no existe en el workspace actual.`)
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

export async function writeWorkspaceFileDirect(filePath: string, content: string): Promise<void> {
  const normalized = filePath.replace(/^\/+/, '').replace(/\\/g, '/')
  virtualFileSystem.set(normalized, content)

  if (activeDirectoryHandle) {
    const fileHandle = await resolveFileHandle(activeDirectoryHandle, normalized, true)
    const writable = await fileHandle.createWritable()
    await writable.write(content)
    await writable.close()
    trace('fs.file.written_to_disk', { path: normalized, bytes: content.length })
  } else {
    trace('fs.file.written_to_virtual', { path: normalized, bytes: content.length })
  }
}
