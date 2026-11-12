import Dexie, { type Table } from 'dexie'
import {
  Engram,
  type CreateMemoryInput,
  type MemoryDocument,
  type MemoryHeader,
  type MemoryRecord,
  type MemorySearchResult,
  type MemoryStore,
} from 'engram-ts'
import { trace } from '../diagnostics'
import type { OpenAiToolSpec } from '../llm/llm-client'

export const WEB_GUIDANCE_DB_NAME = 'localloop-web-guidance'
export const WEB_GUIDANCE_PROJECT = 'modern-web-guidance'
export const GITHUB_RELEASES_LATEST_URL =
  'https://api.github.com/repos/GoogleChrome/modern-web-guidance/releases/latest'
export const GITHUB_RELEASES_LIST_URL =
  'https://api.github.com/repos/GoogleChrome/modern-web-guidance/releases'
export const GITHUB_TAGS_URL =
  'https://api.github.com/repos/GoogleChrome/modern-web-guidance/tags'
export const JSDELIVR_PACKAGE_URL =
  'https://data.jsdelivr.com/v1/packages/gh/GoogleChrome/modern-web-guidance'

export interface WebGuidanceReleaseMetadata {
  key: 'release_meta'
  version: string
  releaseUrl: string
  zipUrl: string
  syncedAt: string
  documentCount: number
}

export interface WebGuidanceSyncResult {
  updated: boolean
  version: string
  documentCount: number
  source: 'cache' | 'github-git-tree' | 'github-release-zip' | 'builtin-seed'
  releaseUrl?: string
  error?: string
}

export interface ExtractedSkillDocument {
  /** Ruta relativa canónica dentro de modern-web-guidance (ej. "SKILL.md", "guides/css/css-layout.md") */
  relativePath: string
  /** Ruta completa desde la carpeta skills (ej. "skills/modern-web-guidance/guides/css/css-layout.md") */
  skillsPath: string
  title: string
  description: string
  category: string
  slug: string
  content: string
  referencedPaths: string[]
  tags: string[]
}

class WebGuidanceDatabase extends Dexie {
  headers!: Table<MemoryHeader, string>
  records!: Table<MemoryRecord, string>
  metadata!: Table<WebGuidanceReleaseMetadata, string>

  constructor(name = WEB_GUIDANCE_DB_NAME) {
    super(name)
    this.version(1).stores({
      headers: 'id, project, type, updatedAt',
      records: 'id, memoryId, createdAt, *tags',
      metadata: 'key',
    })
  }
}

/**
 * Normaliza cualquier ruta de documento o referencia relativa dentro del árbol de `modern-web-guidance`.
 * Resuelve segmentos `.` y `..` respecto a `basePath` (si se proporciona) para que las referencias
 * internas entre documentos de las skills sigan funcionando de forma transparente.
 */
export function resolveWebGuidancePath(targetPath: string, basePath?: string): string {
  let raw = (targetPath || '').trim().replace(/\\/g, '/')
  // Eliminar fragmentos (#...) o query strings (?...)
  raw = raw.split('#')[0].split('?')[0].trim()
  if (!raw) return ''

  const isExplicitRelative = raw.startsWith('./') || raw.startsWith('../')

  // Si se proporciona un documento base y la referencia es relativa (o no incluye carpeta raíz conocida)
  if (basePath && (isExplicitRelative || (!raw.includes('/') && raw.toLowerCase() !== 'skill.md'))) {
    const cleanBase = resolveWebGuidancePath(basePath)
    const baseParts = cleanBase.split('/').filter(Boolean)
    // Quitar el nombre de archivo de basePath para quedarnos con su directorio
    baseParts.pop()

    const relParts = raw.split('/').filter(Boolean)
    for (const part of relParts) {
      if (part === '.') continue
      if (part === '..') {
        baseParts.pop()
      } else {
        baseParts.push(part)
      }
    }
    return baseParts.join('/')
  }

  // Limpiar prefijos de repositorio o carpeta skills/modern-web-guidance
  raw = raw.replace(/^\/+/, '')
  const skillPrefixMatch = raw.match(/(?:^|\/)skills\/modern-web-guidance\/(.+)$/i)
  if (skillPrefixMatch && skillPrefixMatch[1]) {
    raw = skillPrefixMatch[1]
  } else {
    raw = raw
      .replace(/^modern-web-guidance\//i, '')
      .replace(/^skills\//i, '')
  }

  const segments = raw.split('/').filter(Boolean)
  const resolved: string[] = []
  for (const seg of segments) {
    if (seg === '.') continue
    if (seg === '..') {
      resolved.pop()
    } else {
      resolved.push(seg)
    }
  }

  return resolved.join('/')
}

/**
 * Filtra las rutas de un archivo ZIP de release de GitHub para obtener únicamente
 * el árbol de `skills/modern-web-guidance` dentro de la carpeta `skills`,
 * excluyendo explícitamente `chrome-extensions` y cualquier archivo fuera de `skills`.
 */
export function extractModernWebGuidanceRelativePath(zipEntryPath: string): string | null {
  const normalized = zipEntryPath.replace(/\\/g, '/').replace(/^\/+/, '').trim()
  if (!normalized || normalized.endsWith('/')) {
    return null
  }

  // Excluir explícitamente chrome-extensions en cualquier nivel
  if (/(?:^|\/)chrome-extensions(?:\/|$)/i.test(normalized)) {
    return null
  }

  // Debe pertenecer a la carpeta skills/modern-web-guidance/
  const match = normalized.match(/(?:^|\/)skills\/modern-web-guidance\/(.+)$/i)
  if (!match || !match[1]) {
    return null
  }

  const relPath = resolveWebGuidancePath(match[1])
  if (!relPath) return null

  // Ignorar archivos ocultos o binarios no textuales
  const lower = relPath.toLowerCase()
  if (
    lower.startsWith('.') ||
    lower.includes('/.') ||
    /\.(png|jpg|jpeg|gif|webp|ico|woff|woff2|ttf|eot|otf|zip|gz|pdf)$/i.test(lower)
  ) {
    return null
  }

  return relPath
}

/**
 * Extrae metadatos (título, descripción, categoría, referencias relativas y tags) de un documento Markdown de skill/guía.
 */
export function parseSkillMarkdownDocument(
  relativePath: string,
  rawContent: string,
): ExtractedSkillDocument {
  const normalizedPath = resolveWebGuidancePath(relativePath)
  const skillsPath = `skills/modern-web-guidance/${normalizedPath}`
  const content = rawContent.replace(/\r\n/g, '\n').trim()

  const pathParts = normalizedPath.split('/')
  const fileName = pathParts[pathParts.length - 1] || normalizedPath
  const slug = fileName.replace(/\.md$/i, '')
  const category =
    pathParts.length >= 3 && pathParts[0] === 'guides'
      ? pathParts[1]
      : pathParts.length >= 2
        ? pathParts[0]
        : 'core'

  let title = slug
  let description = ''
  const extraTags: string[] = []

  // 1. Parsear YAML frontmatter si existe
  let bodyContent = content
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/)
  if (fmMatch) {
    const fmText = fmMatch[1]
    bodyContent = fmMatch[2].trim()
    const nameMatch = fmText.match(/^(?:name|title):\s*(.+)$/m)
    if (nameMatch && nameMatch[1]) {
      title = nameMatch[1].trim().replace(/^["']|["']$/g, '')
    }
    const descMatch = fmText.match(/^description:\s*[>|]?\s*\n?([\s\S]*?)(?:\n[a-zA-Z0-9_-]+:|$)/m)
    if (descMatch && descMatch[1]) {
      description = descMatch[1]
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/^["']|["']$/g, '')
    }
  }

  // 2. Buscar primer encabezado # Título si el título sigue siendo el slug
  const h1Match = bodyContent.match(/^#\s+(.+)$/m)
  if (h1Match && h1Match[1]) {
    const h1Text = h1Match[1].trim()
    if (title === slug || normalizedPath.toLowerCase() === 'skill.md') {
      title = h1Text
    }
  }

  // 3. Si no había descripción en frontmatter, tomar el primer párrafo útil
  if (!description) {
    const paragraphs = bodyContent
      .split(/\n{2,}/)
      .map((p) => p.trim())
      .filter((p) => p.length > 0 && !p.startsWith('#') && !p.startsWith('```') && !p.startsWith('---'))
    if (paragraphs.length > 0) {
      description = paragraphs[0].replace(/\n+/g, ' ').slice(0, 320)
    }
  }

  // 4. Extraer referencias relativas a otros documentos .md dentro del contenido
  const referencedSet = new Set<string>()
  const mdLinkRegex = /\[[^\]]+\]\(([^)\s]+?\.md(?:#[^)]*)?)\)/gi
  let match: RegExpExecArray | null
  while ((match = mdLinkRegex.exec(content)) !== null) {
    const rawHref = match[1]
    if (!rawHref) continue
    if (/^https?:\/\//i.test(rawHref)) {
      const ghMatch = rawHref.match(/skills\/modern-web-guidance\/([^\s)#]+\.md)/i)
      if (ghMatch && ghMatch[1]) {
        referencedSet.add(resolveWebGuidancePath(ghMatch[1]))
      }
      continue
    }
    const resolvedRef = resolveWebGuidancePath(rawHref, normalizedPath)
    if (resolvedRef && !resolvedRef.includes('chrome-extensions')) {
      referencedSet.add(resolvedRef)
    }
  }

  // También detectar menciones en backticks o texto tipo `guides/.../*.md` o `references/.../*.md`
  const inlineRefRegex = /\b((?:guides|references)\/[a-zA-Z0-9_.\-/]+\.md)\b/g
  while ((match = inlineRefRegex.exec(content)) !== null) {
    if (match[1]) {
      const resolvedRef = resolveWebGuidancePath(match[1], normalizedPath)
      if (resolvedRef && !resolvedRef.includes('chrome-extensions')) {
        referencedSet.add(resolvedRef)
      }
    }
  }

  const tags = Array.from(
    new Set([
      normalizedPath,
      skillsPath,
      `path:${normalizedPath}`,
      `category:${category}`,
      `slug:${slug}`,
      category,
      slug,
      ...slug.split('-').filter((w) => w.length > 2),
      ...extraTags,
    ]),
  )

  return {
    relativePath: normalizedPath,
    skillsPath,
    title,
    description,
    category,
    slug,
    content,
    referencedPaths: Array.from(referencedSet),
    tags,
  }
}

/**
 * Implementación de `MemoryStore` para `engram-ts` cuya entidad en IndexedDB (`headers`)
 * está indexada directamente por la **ruta relativa** del documento (`header.id = relativePath`).
 * De este modo:
 * - `engram.getById(relativePath)` realiza lectura directa O(1) por clave primaria en IndexedDB.
 * - `LunrMemoryIndex` de `engram-ts` indexa `this.ref('id')` usando la ruta relativa y permite
 *   búsqueda full-text ultrarrápida por palabras clave.
 */
export class WebGuidanceMemoryStore implements MemoryStore {
  private readonly database?: WebGuidanceDatabase
  private readonly memHeaders = new Map<string, MemoryHeader>()
  private readonly memRecords = new Map<string, MemoryRecord[]>()
  private memMeta?: WebGuidanceReleaseMetadata

  constructor(databaseName = WEB_GUIDANCE_DB_NAME, forceInMemory = false) {
    if (!forceInMemory && typeof indexedDB !== 'undefined') {
      this.database = new WebGuidanceDatabase(databaseName)
    }
  }

  private resolvePrimaryKey(input: CreateMemoryInput & { id?: string }): string {
    if (typeof input.id === 'string' && input.id.trim()) {
      return resolveWebGuidancePath(input.id.trim())
    }
    const pathTag = (input.tags ?? []).find((t) => t.startsWith('path:'))
    if (pathTag) {
      return resolveWebGuidancePath(pathTag.slice(5))
    }
    const firstRecordTitle = input.records[0]?.title
    if (firstRecordTitle && (firstRecordTitle.endsWith('.md') || firstRecordTitle.includes('/'))) {
      return resolveWebGuidancePath(firstRecordTitle)
    }
    return resolveWebGuidancePath(input.title)
  }

  async create(input: CreateMemoryInput & { id?: string }): Promise<MemoryHeader> {
    const now = new Date().toISOString()
    const id = this.resolvePrimaryKey(input)
    const header: MemoryHeader = {
      id,
      title: input.title.trim(),
      type: input.type.trim(),
      project: input.project.trim(),
      tags: [...(input.tags ?? [])],
      recordCount: input.records.length,
      createdAt: now,
      updatedAt: now,
    }
    const records: MemoryRecord[] = input.records.map((record, idx) => ({
      ...record,
      id: `${id}#${idx}`,
      memoryId: id,
      tags: [...(record.tags ?? [])],
      createdAt: record.createdAt ?? now,
    }))

    if (this.database) {
      await this.database.transaction('rw', this.database.headers, this.database.records, async () => {
        await this.database!.headers.put(header)
        await this.database!.records.where('memoryId').equals(id).delete()
        await this.database!.records.bulkPut(records)
      })
    } else {
      this.memHeaders.set(id, header)
      this.memRecords.set(id, records)
    }

    return header
  }

  async bulkSaveSkillDocuments(
    docs: ExtractedSkillDocument[],
    meta?: WebGuidanceReleaseMetadata,
  ): Promise<number> {
    const now = new Date().toISOString()
    const headers: MemoryHeader[] = []
    const allRecords: MemoryRecord[] = []

    for (const doc of docs) {
      const id = doc.relativePath
      const header: MemoryHeader = {
        id,
        title: `${doc.title} (${doc.relativePath})`,
        type: doc.relativePath.toLowerCase() === 'skill.md' ? 'web_guidance_skill' : `web_guidance_${doc.category}`,
        project: WEB_GUIDANCE_PROJECT,
        tags: doc.tags,
        recordCount: 1,
        createdAt: now,
        updatedAt: now,
      }
      const record: MemoryRecord = {
        id: `${id}#0`,
        memoryId: id,
        title: doc.relativePath,
        content: doc.content,
        tags: [
          ...doc.tags,
          ...(doc.referencedPaths.map((ref) => `ref:${ref}`)),
        ],
        createdAt: now,
      }
      headers.push(header)
      allRecords.push(record)
    }

    if (this.database) {
      await this.database.transaction(
        'rw',
        this.database.headers,
        this.database.records,
        this.database.metadata,
        async () => {
          await this.database!.headers.clear()
          await this.database!.records.clear()
          await this.database!.headers.bulkPut(headers)
          await this.database!.records.bulkPut(allRecords)
          if (meta) {
            await this.database!.metadata.put(meta)
          }
        },
      )
    } else {
      this.memHeaders.clear()
      this.memRecords.clear()
      for (const h of headers) {
        this.memHeaders.set(h.id, h)
      }
      for (const r of allRecords) {
        const list = this.memRecords.get(r.memoryId) ?? []
        list.push(r)
        this.memRecords.set(r.memoryId, list)
      }
      if (meta) {
        this.memMeta = meta
      }
    }

    return headers.length
  }

  async getHeader(id: string): Promise<MemoryHeader | undefined> {
    const normalized = resolveWebGuidancePath(id)
    if (this.database) {
      return (await this.database.headers.get(normalized)) ?? (await this.database.headers.get(id))
    }
    return this.memHeaders.get(normalized) ?? this.memHeaders.get(id)
  }

  async getDocument(id: string): Promise<MemoryDocument | undefined> {
    const normalized = resolveWebGuidancePath(id)
    if (this.database) {
      let header = await this.database.headers.get(normalized)
      let targetKey = normalized
      if (!header && normalized !== id) {
        header = await this.database.headers.get(id)
        targetKey = id
      }
      if (!header) return undefined
      const records = await this.database.records.where('memoryId').equals(targetKey).sortBy('createdAt')
      return { header, records }
    }

    const header = this.memHeaders.get(normalized) ?? this.memHeaders.get(id)
    if (!header) return undefined
    const records = [...(this.memRecords.get(header.id) ?? [])].sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    )
    return { header, records }
  }

  async listHeaders(): Promise<MemoryHeader[]> {
    if (this.database) {
      return this.database.headers.toArray()
    }
    return [...this.memHeaders.values()]
  }

  async listRecords(): Promise<MemoryRecord[]> {
    if (this.database) {
      return this.database.records.toArray()
    }
    const all: MemoryRecord[] = []
    for (const list of this.memRecords.values()) {
      all.push(...list)
    }
    return all
  }

  async getMetadata(): Promise<WebGuidanceReleaseMetadata | undefined> {
    if (this.database) {
      return this.database.metadata.get('release_meta')
    }
    return this.memMeta
  }

  async setMetadata(meta: WebGuidanceReleaseMetadata): Promise<void> {
    if (this.database) {
      await this.database.metadata.put(meta)
      return
    }
    this.memMeta = meta
  }

  async clear(): Promise<void> {
    if (this.database) {
      await this.database.transaction(
        'rw',
        this.database.headers,
        this.database.records,
        this.database.metadata,
        async () => {
          await this.database!.headers.clear()
          await this.database!.records.clear()
          await this.database!.metadata.clear()
        },
      )
    }
    this.memHeaders.clear()
    this.memRecords.clear()
    this.memMeta = undefined
  }

  close(): void {
    if (this.database) {
      this.database.close()
    }
    this.memHeaders.clear()
    this.memRecords.clear()
  }
}

/**
 * Descomprime un bloque DEFLATE crudo (`deflate-raw`) usando `DecompressionStream` estándar Web/Node.
 */
async function inflateRawBytes(compressed: Uint8Array): Promise<Uint8Array> {
  if (typeof DecompressionStream !== 'undefined') {
    const ds = new DecompressionStream('deflate-raw')
    const writer = ds.writable.getWriter()
    const copy = new Uint8Array(compressed.byteLength)
    copy.set(compressed)
    void writer.write(copy)
    void writer.close()

    const reader = ds.readable.getReader()
    const chunks: Uint8Array[] = []
    let totalLen = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) {
        chunks.push(value)
        totalLen += value.byteLength
      }
    }
    const result = new Uint8Array(totalLen)
    let offset = 0
    for (const chunk of chunks) {
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
    return result
  }

  throw new Error('DecompressionStream no disponible en este entorno.')
}

/**
 * Extrae del buffer de un archivo ZIP únicamente los documentos pertenecientes al árbol
 * `skills/modern-web-guidance` (excluyendo `chrome-extensions` y archivos fuera de `skills`).
 */
export async function extractModernWebGuidanceFromZip(
  zipBuffer: ArrayBuffer | Uint8Array,
): Promise<ExtractedSkillDocument[]> {
  const bytes = zipBuffer instanceof Uint8Array ? zipBuffer : new Uint8Array(zipBuffer)
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const decoder = new TextDecoder('utf-8')
  const extracted: ExtractedSkillDocument[] = []
  const seenPaths = new Set<string>()

  // 1. Localizar End of Central Directory (EOCD) signature: 0x06054b50
  let eocdOffset = -1
  const minEocdOffset = Math.max(0, bytes.byteLength - 65557)
  for (let i = bytes.byteLength - 22; i >= minEocdOffset; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i
      break
    }
  }

  if (eocdOffset !== -1) {
    const totalEntries = view.getUint16(eocdOffset + 10, true)
    const cdOffset = view.getUint32(eocdOffset + 16, true)
    let ptr = cdOffset

    for (let idx = 0; idx < totalEntries && ptr + 46 <= bytes.byteLength; idx++) {
      const sig = view.getUint32(ptr, true)
      if (sig !== 0x02014b50) break

      const compressionMethod = view.getUint16(ptr + 10, true)
      const compressedSize = view.getUint32(ptr + 20, true)
      const fileNameLen = view.getUint16(ptr + 28, true)
      const extraLen = view.getUint16(ptr + 30, true)
      const commentLen = view.getUint16(ptr + 32, true)
      const localHeaderOffset = view.getUint32(ptr + 42, true)

      const fileNameBytes = bytes.subarray(ptr + 46, ptr + 46 + fileNameLen)
      const entryName = decoder.decode(fileNameBytes)
      ptr += 46 + fileNameLen + extraLen + commentLen

      const relPath = extractModernWebGuidanceRelativePath(entryName)
      if (!relPath || seenPaths.has(relPath)) continue

      if (localHeaderOffset + 30 > bytes.byteLength) continue
      const localSig = view.getUint32(localHeaderOffset, true)
      if (localSig !== 0x04034b50) continue

      const localNameLen = view.getUint16(localHeaderOffset + 26, true)
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true)
      const dataStart = localHeaderOffset + 30 + localNameLen + localExtraLen
      const dataEnd = dataStart + compressedSize
      if (dataEnd > bytes.byteLength) continue

      const rawSlice = bytes.subarray(dataStart, dataEnd)
      let uncompressedBytes: Uint8Array
      if (compressionMethod === 0) {
        uncompressedBytes = rawSlice
      } else if (compressionMethod === 8) {
        uncompressedBytes = await inflateRawBytes(rawSlice)
      } else {
        continue
      }

      const textContent = decoder.decode(uncompressedBytes)
      if (textContent.trim().length > 0) {
        seenPaths.add(relPath)
        extracted.push(parseSkillMarkdownDocument(relPath, textContent))
      }
    }
  } else {
    // Fallback: lectura secuencial de Local File Headers (0x04034b50)
    let ptr = 0
    while (ptr + 30 <= bytes.byteLength) {
      const sig = view.getUint32(ptr, true)
      if (sig !== 0x04034b50) break

      const compressionMethod = view.getUint16(ptr + 8, true)
      const compressedSize = view.getUint32(ptr + 18, true)
      const fileNameLen = view.getUint16(ptr + 26, true)
      const extraLen = view.getUint16(ptr + 28, true)

      const entryName = decoder.decode(bytes.subarray(ptr + 30, ptr + 30 + fileNameLen))
      const dataStart = ptr + 30 + fileNameLen + extraLen
      const dataEnd = dataStart + compressedSize
      if (dataEnd > bytes.byteLength) break

      const relPath = extractModernWebGuidanceRelativePath(entryName)
      if (relPath && !seenPaths.has(relPath)) {
        const rawSlice = bytes.subarray(dataStart, dataEnd)
        let uncompressedBytes: Uint8Array | undefined
        if (compressionMethod === 0) {
          uncompressedBytes = rawSlice
        } else if (compressionMethod === 8) {
          uncompressedBytes = await inflateRawBytes(rawSlice)
        }
        if (uncompressedBytes) {
          const textContent = decoder.decode(uncompressedBytes)
          if (textContent.trim().length > 0) {
            seenPaths.add(relPath)
            extracted.push(parseSkillMarkdownDocument(relPath, textContent))
          }
        }
      }

      ptr = dataEnd
    }
  }

  return extracted
}

/**
 * Construye un archivo ZIP válido en memoria (método Stored = 0) a partir de un mapa de rutas y contenidos.
 * Útil tanto para pruebas deterministas como para empaquetado local.
 */
export function createZipArchive(files: Record<string, string | Uint8Array>): Uint8Array {
  const encoder = new TextEncoder()
  const entries = Object.entries(files).map(([name, content]) => {
    const nameBytes = encoder.encode(name.replace(/\\/g, '/'))
    const dataBytes = typeof content === 'string' ? encoder.encode(content) : content
    return { nameBytes, dataBytes }
  })

  let localHeadersSize = 0
  let centralDirSize = 0
  for (const entry of entries) {
    localHeadersSize += 30 + entry.nameBytes.byteLength + entry.dataBytes.byteLength
    centralDirSize += 46 + entry.nameBytes.byteLength
  }

  const totalSize = localHeadersSize + centralDirSize + 22
  const out = new Uint8Array(totalSize)
  const view = new DataView(out.buffer)

  let localOffset = 0
  const offsets: number[] = []

  for (const entry of entries) {
    offsets.push(localOffset)
    const size = entry.dataBytes.byteLength
    view.setUint32(localOffset, 0x04034b50, true) // Local file header signature
    view.setUint16(localOffset + 4, 20, true) // Version needed
    view.setUint16(localOffset + 6, 0, true) // Flags
    view.setUint16(localOffset + 8, 0, true) // Compression method: 0 (Stored)
    view.setUint16(localOffset + 10, 0, true) // Mod time
    view.setUint16(localOffset + 12, 0, true) // Mod date
    view.setUint32(localOffset + 14, 0, true) // CRC-32
    view.setUint32(localOffset + 18, size, true) // Compressed size
    view.setUint32(localOffset + 22, size, true) // Uncompressed size
    view.setUint16(localOffset + 26, entry.nameBytes.byteLength, true)
    view.setUint16(localOffset + 28, 0, true) // Extra field length

    out.set(entry.nameBytes, localOffset + 30)
    out.set(entry.dataBytes, localOffset + 30 + entry.nameBytes.byteLength)
    localOffset += 30 + entry.nameBytes.byteLength + size
  }

  const cdStart = localOffset
  let cdPtr = cdStart

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]
    const size = entry.dataBytes.byteLength
    view.setUint32(cdPtr, 0x02014b50, true) // Central directory file header signature
    view.setUint16(cdPtr + 4, 20, true) // Version made by
    view.setUint16(cdPtr + 6, 20, true) // Version needed
    view.setUint16(cdPtr + 8, 0, true) // Flags
    view.setUint16(cdPtr + 10, 0, true) // Compression method: 0 (Stored)
    view.setUint16(cdPtr + 12, 0, true) // Mod time
    view.setUint16(cdPtr + 14, 0, true) // Mod date
    view.setUint32(cdPtr + 16, 0, true) // CRC-32
    view.setUint32(cdPtr + 20, size, true) // Compressed size
    view.setUint32(cdPtr + 22 + 2, size, true) // Uncompressed size
    view.setUint16(cdPtr + 28, entry.nameBytes.byteLength, true)
    view.setUint16(cdPtr + 30, 0, true) // Extra length
    view.setUint16(cdPtr + 32, 0, true) // Comment length
    view.setUint16(cdPtr + 34, 0, true) // Disk number
    view.setUint16(cdPtr + 36, 0, true) // Internal attrs
    view.setUint32(cdPtr + 38, 0, true) // External attrs
    view.setUint32(cdPtr + 42, offsets[i], true) // Relative offset of local header

    out.set(entry.nameBytes, cdPtr + 46)
    cdPtr += 46 + entry.nameBytes.byteLength
  }

  // End of Central Directory Record (EOCD)
  view.setUint32(cdPtr, 0x06054b50, true)
  view.setUint16(cdPtr + 4, 0, true)
  view.setUint16(cdPtr + 6, 0, true)
  view.setUint16(cdPtr + 8, entries.length, true)
  view.setUint16(cdPtr + 10, entries.length, true)
  view.setUint32(cdPtr + 12, cdPtr - cdStart, true)
  view.setUint32(cdPtr + 16, cdStart, true)
  view.setUint16(cdPtr + 20, 0, true)

  return out
}

let sharedGuidanceStore: WebGuidanceMemoryStore | undefined
let sharedGuidanceEngram: Engram | undefined
let loadedDocumentsCount = 0

export function getWebGuidanceStore(): WebGuidanceMemoryStore {
  if (!sharedGuidanceStore) {
    sharedGuidanceStore = new WebGuidanceMemoryStore(WEB_GUIDANCE_DB_NAME)
  }
  return sharedGuidanceStore
}

export function getWebGuidanceEngram(customStore?: WebGuidanceMemoryStore): Engram {
  if (customStore) {
    return new Engram({ store: customStore })
  }
  if (!sharedGuidanceEngram) {
    sharedGuidanceEngram = new Engram({ store: getWebGuidanceStore() })
  }
  return sharedGuidanceEngram
}

export function hasLoadedWebGuidanceDocs(): boolean {
  return loadedDocumentsCount > 0
}

export function setLoadedWebGuidanceDocsCount(count: number): void {
  loadedDocumentsCount = Math.max(0, count)
}

export async function refreshWebGuidanceEngram(
  customStore?: WebGuidanceMemoryStore,
): Promise<Engram> {
  const isShared = !customStore || customStore === sharedGuidanceStore
  const store = customStore ?? getWebGuidanceStore()
  const engram = !isShared ? new Engram({ store }) : getWebGuidanceEngram()
  if (isShared) {
    sharedGuidanceEngram = engram
  }
  try {
    const internal = engram as unknown as { searchIndex?: { refresh: () => Promise<void> } }
    if (internal.searchIndex && typeof internal.searchIndex.refresh === 'function') {
      await internal.searchIndex.refresh()
    }
  } catch (err) {
    console.warn('[WebGuidance] Error refrescando índice Lunr de engram-ts:', err)
  }
  const headers = await store.listHeaders().catch(() => [])
  if (isShared) {
    loadedDocumentsCount = headers.length
  }
  return engram
}

export async function resetWebGuidanceDatabase(): Promise<void> {
  if (sharedGuidanceEngram) {
    try {
      sharedGuidanceEngram.close()
    } catch {
      // Ignore
    }
    sharedGuidanceEngram = undefined
  }
  if (sharedGuidanceStore) {
    try {
      await sharedGuidanceStore.clear()
      sharedGuidanceStore.close()
    } catch {
      // Ignore
    }
    sharedGuidanceStore = undefined
  }
  loadedDocumentsCount = 0
  if (typeof indexedDB !== 'undefined') {
    try {
      await Dexie.delete(WEB_GUIDANCE_DB_NAME)
    } catch {
      // Ignore
    }
  }
}

/**
 * Carga un conjunto de documentos extraídos de `modern-web-guidance` en `engram-ts`,
 * indexándolos por su ruta relativa y construyendo el índice Lunr para búsqueda rápida.
 */
export async function indexWebGuidanceDocumentsInEngram(
  docs: ExtractedSkillDocument[],
  options?: {
    version?: string
    releaseUrl?: string
    zipUrl?: string
    store?: WebGuidanceMemoryStore
  },
): Promise<{ count: number; version: string; engram: Engram }> {
  const store = options?.store ?? getWebGuidanceStore()
  const version = options?.version ?? 'local-custom'
  const meta: WebGuidanceReleaseMetadata = {
    key: 'release_meta',
    version,
    releaseUrl: options?.releaseUrl ?? GITHUB_RELEASES_LATEST_URL,
    zipUrl: options?.zipUrl ?? '',
    syncedAt: new Date().toISOString(),
    documentCount: docs.length,
  }

  const count = await store.bulkSaveSkillDocuments(docs, meta)
  const engram = await refreshWebGuidanceEngram(store)
  if (!options?.store || options.store === sharedGuidanceStore) {
    loadedDocumentsCount = count
  }

  trace('web_guidance.engram.indexed', {
    version,
    count,
    pathsSample: docs.slice(0, 5).map((d) => d.relativePath),
  })

  return { count, version, engram }
}

interface GithubReleaseAsset {
  name?: string
  browser_download_url?: string
  content_type?: string
}

interface GithubReleaseResponse {
  tag_name?: string
  name?: string
  html_url?: string
  zipball_url?: string
  published_at?: string
  assets?: GithubReleaseAsset[]
}

/**
 * Consulta la última versión publicada en GitHub Releases (`releases/latest`, con fallback a `/releases` o `/tags`).
 */
export async function fetchLatestWebGuidanceReleaseInfo(
  releasesUrl = GITHUB_RELEASES_LATEST_URL,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<{ version: string; zipUrl: string; releaseUrl: string }> {
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
  }

  const res = await fetchImpl(releasesUrl, { method: 'GET', headers })
  if (res.ok) {
    const data = (await res.json()) as GithubReleaseResponse | GithubReleaseResponse[]
    const release = Array.isArray(data) ? data[0] : data
    if (release) {
      const version = String(release.tag_name || release.name || '').trim()
      const zipAsset = Array.isArray(release.assets)
        ? release.assets.find(
            (a) =>
              typeof a.browser_download_url === 'string' &&
              a.browser_download_url.toLowerCase().endsWith('.zip'),
          )
        : undefined
      const zipUrl =
        zipAsset?.browser_download_url ||
        release.zipball_url ||
        (version
          ? `https://codeload.github.com/GoogleChrome/modern-web-guidance/zip/refs/tags/${encodeURIComponent(version)}`
          : '')
      if (version && zipUrl) {
        return {
          version,
          zipUrl,
          releaseUrl: release.html_url || releasesUrl,
        }
      }
    }
  }

  // Fallback a lista de releases o tags si releases/latest devolvió 404
  if (releasesUrl === GITHUB_RELEASES_LATEST_URL) {
    const listRes = await fetchImpl(GITHUB_RELEASES_LIST_URL, { method: 'GET', headers }).catch(
      () => null,
    )
    if (listRes && listRes.ok) {
      const listData = (await listRes.json()) as GithubReleaseResponse[]
      if (Array.isArray(listData) && listData.length > 0) {
        const first = listData[0]
        const version = String(first.tag_name || first.name || '').trim()
        const zipAsset = Array.isArray(first.assets)
          ? first.assets.find((a) => a.browser_download_url?.toLowerCase().endsWith('.zip'))
          : undefined
        const zipUrl =
          zipAsset?.browser_download_url ||
          first.zipball_url ||
          `https://codeload.github.com/GoogleChrome/modern-web-guidance/zip/refs/tags/${encodeURIComponent(version)}`
        if (version) {
          return {
            version,
            zipUrl,
            releaseUrl: first.html_url || GITHUB_RELEASES_LIST_URL,
          }
        }
      }
    }

    const tagsRes = await fetchImpl(GITHUB_TAGS_URL, { method: 'GET', headers }).catch(() => null)
    if (tagsRes && tagsRes.ok) {
      const tagsData = (await tagsRes.json()) as Array<{ name?: string; zipball_url?: string }>
      if (Array.isArray(tagsData) && tagsData.length > 0 && tagsData[0].name) {
        const version = tagsData[0].name.trim()
        return {
          version,
          zipUrl:
            tagsData[0].zipball_url ||
            `https://codeload.github.com/GoogleChrome/modern-web-guidance/zip/refs/tags/${encodeURIComponent(version)}`,
          releaseUrl: GITHUB_TAGS_URL,
        }
      }
    }

    // Fallback CORS-safe sin límite de cuota vía jsDelivr Package Metadata API
    const jsDelivrRes = await fetchImpl(JSDELIVR_PACKAGE_URL, { method: 'GET' }).catch(() => null)
    if (jsDelivrRes && jsDelivrRes.ok) {
      const pkgData = (await jsDelivrRes.json()) as {
        tags?: { latest?: string }
        versions?: string[]
      }
      const rawVersion = (pkgData.tags?.latest || pkgData.versions?.[0] || '').trim()
      if (rawVersion) {
        const version = rawVersion.startsWith('v') ? rawVersion : `v${rawVersion}`
        return {
          version,
          zipUrl: `https://api.github.com/repos/GoogleChrome/modern-web-guidance/git/trees/${encodeURIComponent(version)}?recursive=1`,
          releaseUrl: JSDELIVR_PACKAGE_URL,
        }
      }
    }
  }

  throw new Error(`No se pudo obtener la información de release desde ${releasesUrl} (status ${res.status}).`)
}

interface GithubGitTreeEntry {
  path?: string
  mode?: string
  type?: string
  sha?: string
  size?: number
  url?: string
}

interface GithubGitTreeResponse {
  sha?: string
  url?: string
  tree?: GithubGitTreeEntry[]
  truncated?: boolean
}

interface JsDelivrFlatFileEntry {
  name?: string
  hash?: string
  size?: number
}

interface JsDelivrFlatResponse {
  files?: JsDelivrFlatFileEntry[]
}

/**
 * Obtiene la lista de rutas relativas dentro de `skills/modern-web-guidance/**` (excluyendo `chrome-extensions`)
 * usando la GitHub Git Trees API (`?recursive=1`) con fallback automático a jsDelivr Flat Package API,
 * y descarga el contenido Markdown desde `raw.githubusercontent.com` (con fallback a `cdn.jsdelivr.net`).
 * Ambos orígenes envían `Access-Control-Allow-Origin: *`, evitando el bloqueo CORS de `codeload.github.com`.
 */
export async function fetchModernWebGuidanceViaGitTree(
  version: string,
  fetchImpl: typeof fetch = globalThis.fetch,
  concurrency = 6,
): Promise<ExtractedSkillDocument[]> {
  const versionCandidates = Array.from(
    new Set([
      version.trim(),
      version.trim().replace(/^v/i, ''),
      version.trim().startsWith('v') ? version.trim() : `v${version.trim()}`,
      'main',
    ]),
  ).filter(Boolean)

  let resolvedRef = version.trim()
  const relativePathsSet = new Set<string>()

  // 1. Intentar obtener el árbol recursivo mediante GitHub Git Trees API (1 sola petición CORS *)
  for (const candidate of versionCandidates) {
    const treeUrl = `https://api.github.com/repos/GoogleChrome/modern-web-guidance/git/trees/${encodeURIComponent(candidate)}?recursive=1`
    try {
      const treeRes = await fetchImpl(treeUrl, {
        method: 'GET',
        headers: { Accept: 'application/vnd.github+json' },
      })
      if (treeRes.ok) {
        const treeData = (await treeRes.json()) as GithubGitTreeResponse
        if (Array.isArray(treeData.tree)) {
          for (const item of treeData.tree) {
            if (item.type && item.type !== 'blob') continue
            if (!item.path) continue
            const relPath = extractModernWebGuidanceRelativePath(item.path)
            if (relPath) {
              relativePathsSet.add(relPath)
            }
          }
          if (relativePathsSet.size > 0) {
            resolvedRef = candidate
            break
          }
        }
      }
    } catch {
      // Continuar con siguiente candidato o fallback jsDelivr
    }
  }

  // 2. Fallback a jsDelivr Flat Structure API si GitHub Git Trees API no devolvió rutas (p. ej. rate-limit)
  if (relativePathsSet.size === 0) {
    for (const candidate of versionCandidates) {
      const flatUrl = `https://data.jsdelivr.com/v1/packages/gh/GoogleChrome/modern-web-guidance@${encodeURIComponent(candidate)}?structure=flat`
      try {
        const flatRes = await fetchImpl(flatUrl, { method: 'GET' })
        if (flatRes.ok) {
          const flatData = (await flatRes.json()) as JsDelivrFlatResponse
          if (Array.isArray(flatData.files)) {
            for (const file of flatData.files) {
              if (!file.name) continue
              const relPath = extractModernWebGuidanceRelativePath(file.name)
              if (relPath) {
                relativePathsSet.add(relPath)
              }
            }
            if (relativePathsSet.size > 0) {
              resolvedRef = candidate
              break
            }
          }
        }
      } catch {
        // Ignorar
      }
    }
  }

  const relativePaths = Array.from(relativePathsSet).sort((a, b) => a.localeCompare(b))
  if (relativePaths.length === 0) {
    throw new Error(
      `No se encontraron archivos bajo skills/modern-web-guidance para la versión ${version} vía Git Trees API.`,
    )
  }

  trace('web_guidance.sync.git_tree_resolved', {
    version: resolvedRef,
    filesToDownload: relativePaths.length,
  })

  // 3. Descargar los archivos .md en paralelo acotado desde raw.githubusercontent.com (con fallback a cdn.jsdelivr.net)
  const extractedDocs: ExtractedSkillDocument[] = []
  const maxWorkers = Math.max(1, Math.min(concurrency, relativePaths.length))
  let cursor = 0

  const downloadSingleDoc = async (relPath: string): Promise<ExtractedSkillDocument | null> => {
    const rawUrls = [
      `https://raw.githubusercontent.com/GoogleChrome/modern-web-guidance/${encodeURIComponent(resolvedRef)}/skills/modern-web-guidance/${relPath}`,
      `https://cdn.jsdelivr.net/gh/GoogleChrome/modern-web-guidance@${encodeURIComponent(resolvedRef)}/skills/modern-web-guidance/${relPath}`,
    ]
    const strippedRef = resolvedRef.replace(/^v/i, '')
    if (strippedRef && strippedRef !== resolvedRef) {
      rawUrls.push(
        `https://cdn.jsdelivr.net/gh/GoogleChrome/modern-web-guidance@${encodeURIComponent(strippedRef)}/skills/modern-web-guidance/${relPath}`,
      )
    }

    for (const url of rawUrls) {
      try {
        const res = await fetchImpl(url, { method: 'GET' })
        if (res.ok) {
          const content = await res.text()
          if (content.trim().length > 0) {
            return parseSkillMarkdownDocument(relPath, content)
          }
        }
      } catch {
        // Probar siguiente espejo CORS
      }
    }
    return null
  }

  const workers = Array.from({ length: maxWorkers }, async () => {
    while (cursor < relativePaths.length) {
      const idx = cursor
      cursor += 1
      const relPath = relativePaths[idx]
      if (!relPath) continue
      const doc = await downloadSingleDoc(relPath)
      if (doc) {
        extractedDocs.push(doc)
      }
    }
  })

  await Promise.all(workers)
  extractedDocs.sort((a, b) => a.relativePath.localeCompare(b.relativePath))

  if (extractedDocs.length === 0) {
    throw new Error(
      `No se pudo descargar ningún documento Markdown de skills/modern-web-guidance (${version}).`,
    )
  }

  return extractedDocs
}

export interface WebGuidanceSyncOptions {
  releasesUrl?: string
  forceDownload?: boolean
  store?: WebGuidanceMemoryStore
  fetchImpl?: typeof fetch
}

/**
 * Sincroniza el árbol de skills de `modern-web-guidance` (excluyendo `chrome-extensions`)
 * consultando la última versión publicada en GitHub Releases y descargando su ZIP solo cuando
 * no está cargado o existe una nueva versión disponible.
 */
export async function syncModernWebGuidance(
  options?: WebGuidanceSyncOptions,
): Promise<WebGuidanceSyncResult> {
  const store = options?.store ?? getWebGuidanceStore()
  const fetchImpl = options?.fetchImpl ?? globalThis.fetch
  const releasesUrl = options?.releasesUrl ?? GITHUB_RELEASES_LATEST_URL

  try {
    const [localMeta, existingHeaders] = await Promise.all([
      store.getMetadata(),
      store.listHeaders(),
    ])

    const releaseInfo = await fetchLatestWebGuidanceReleaseInfo(releasesUrl, fetchImpl)

    // Control de versión: si coincide la versión de la release con la de IndexedDB y ya hay documentos, no re-descargamos
    if (
      !options?.forceDownload &&
      localMeta &&
      localMeta.version === releaseInfo.version &&
      existingHeaders.length > 0
    ) {
      await refreshWebGuidanceEngram(store)
      trace('web_guidance.sync.up_to_date', {
        version: releaseInfo.version,
        documentCount: existingHeaders.length,
      })
      return {
        updated: false,
        version: releaseInfo.version,
        documentCount: existingHeaders.length,
        source: 'cache',
        releaseUrl: releaseInfo.releaseUrl,
      }
    }

    let extractedDocs: ExtractedSkillDocument[] = []
    let syncSource: 'github-git-tree' | 'github-release-zip' = 'github-git-tree'

    // 1. Vía principal compatible con CORS en navegador: GitHub Git Trees API + raw.githubusercontent.com / jsDelivr
    try {
      extractedDocs = await fetchModernWebGuidanceViaGitTree(releaseInfo.version, fetchImpl)
      syncSource = 'github-git-tree'
    } catch (gitTreeErr) {
      // 2. Fallback a descarga y extracción de archivo ZIP (para entornos sin restricción CORS o tests con ZIP local)
      trace('web_guidance.sync.downloading_zip', {
        version: releaseInfo.version,
        zipUrl: releaseInfo.zipUrl,
        fallbackReason: gitTreeErr instanceof Error ? gitTreeErr.message : String(gitTreeErr),
      })

      const zipResponse = await fetchImpl(releaseInfo.zipUrl, { method: 'GET' })
      if (!zipResponse.ok) {
        throw new Error(
          `Error obteniendo skills de modern-web-guidance (${zipResponse.status}) desde Git Trees API y ${releaseInfo.zipUrl}`,
        )
      }

      const zipArrayBuffer = await zipResponse.arrayBuffer()
      extractedDocs = await extractModernWebGuidanceFromZip(zipArrayBuffer)
      syncSource = 'github-release-zip'
    }

    if (extractedDocs.length === 0) {
      throw new Error('No se encontraron documentos bajo skills/modern-web-guidance.')
    }

    const indexed = await indexWebGuidanceDocumentsInEngram(extractedDocs, {
      version: releaseInfo.version,
      releaseUrl: releaseInfo.releaseUrl,
      zipUrl: releaseInfo.zipUrl,
      store,
    })

    return {
      updated: true,
      version: indexed.version,
      documentCount: indexed.count,
      source: syncSource,
      releaseUrl: releaseInfo.releaseUrl,
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    trace('web_guidance.sync.warning', { error: errMsg })

    // Si ya teníamos documentos en IndexedDB de una sincronización previa, mantener el índice activo
    const existingHeaders = await store.listHeaders().catch(() => [])
    const localMeta = await store.getMetadata().catch(() => undefined)
    if (existingHeaders.length > 0) {
      await refreshWebGuidanceEngram(store)
      return {
        updated: false,
        version: localMeta?.version ?? 'cached',
        documentCount: existingHeaders.length,
        source: 'cache',
        error: errMsg,
      }
    }

    return {
      updated: false,
      version: 'none',
      documentCount: 0,
      source: 'cache',
      error: errMsg,
    }
  }
}

export interface SearchWebGuidanceResultItem {
  /** Ruta relativa del documento en IndexedDB / engram-ts (lista para pasar a read_web_guidance_doc) */
  path: string
  title: string
  type: string
  score: number
  tags: string[]
  excerpt: string
}

/**
 * Ejecuta la búsqueda por texto sobre el índice Lunr de `engram-ts` (`search_web_guidance`).
 */
export async function searchWebGuidance(params: {
  query: string
  category?: string
  limit?: number
  store?: WebGuidanceMemoryStore
}): Promise<{
  version: string
  query: string
  count: number
  results: SearchWebGuidanceResultItem[]
}> {
  const store = params.store ?? getWebGuidanceStore()
  const engram = getWebGuidanceEngram(params.store)
  const limit = Math.min(25, Math.max(1, params.limit ?? 8))
  const rawQuery = (params.query || '').trim()
  const categoryFilter = params.category?.trim().toLowerCase()

  const meta = await store.getMetadata().catch(() => undefined)
  const version = meta?.version ?? 'uninitialized'

  let searchMatches: MemorySearchResult[] = []
  try {
    searchMatches = await engram.search({
      query: rawQuery,
      project: WEB_GUIDANCE_PROJECT,
      limit: limit * 3,
    })
  } catch {
    searchMatches = []
  }

  // Fallback si la consulta tiene varios términos y Lunr fue demasiado estricto o la consulta contenía caracteres especiales
  if (searchMatches.length === 0 && rawQuery.length > 0) {
    const terms = rawQuery
      .toLowerCase()
      .replace(/[^a-z0-9\s_-]/gi, ' ')
      .split(/\s+/)
      .filter((w) => w.length >= 2)

    for (const term of terms) {
      try {
        const partial = await engram.search({
          query: term,
          project: WEB_GUIDANCE_PROJECT,
          limit: limit * 2,
        })
        for (const item of partial) {
          if (!searchMatches.some((m) => m.header.id === item.header.id)) {
            searchMatches.push(item)
          }
        }
      } catch {
        // Ignorar
      }
    }

    // Fallback léxico sobre cabeceras si Lunr sigue vacío
    if (searchMatches.length === 0) {
      const allHeaders = await store.listHeaders().catch(() => [])
      const qLower = rawQuery.toLowerCase()
      searchMatches = allHeaders
        .filter(
          (h) =>
            h.id.toLowerCase().includes(qLower) ||
            h.title.toLowerCase().includes(qLower) ||
            h.tags.some((t) => t.toLowerCase().includes(qLower)) ||
            terms.some(
              (term) =>
                h.id.toLowerCase().includes(term) ||
                h.title.toLowerCase().includes(term) ||
                h.tags.some((t) => t.toLowerCase().includes(term)),
            ),
        )
        .map((header) => ({ header, score: 0.5 }))
    }
  }

  if (categoryFilter) {
    searchMatches = searchMatches.filter(
      (m) =>
        m.header.type.toLowerCase().includes(categoryFilter) ||
        m.header.id.toLowerCase().startsWith(`guides/${categoryFilter}/`) ||
        m.header.tags.some((t) => t.toLowerCase() === categoryFilter || t.toLowerCase() === `category:${categoryFilter}`),
    )
  }

  const sliced = searchMatches.slice(0, limit)
  const results: SearchWebGuidanceResultItem[] = []

  for (const match of sliced) {
    const doc = await engram.getById(match.header.id)
    const content = doc?.records[0]?.content ?? ''
    const cleanExcerpt = content
      .replace(/^---[\s\S]*?---\n?/, '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 260)

    results.push({
      path: match.header.id,
      title: match.header.title,
      type: match.header.type,
      score: Number(match.score.toFixed(4)),
      tags: match.header.tags.filter((t) => !t.startsWith('path:') && !t.startsWith('skills/')),
      excerpt: cleanExcerpt,
    })
  }

  return {
    version,
    query: rawQuery,
    count: results.length,
    results,
  }
}

/**
 * Lectura directa de un documento de `modern-web-guidance` por su ruta relativa (`read_web_guidance_doc`).
 * Soporta rutas canónicas (`guides/css/css-layout.md`, `SKILL.md`), rutas con prefijo
 * (`skills/modern-web-guidance/guides/...`), enlaces relativos (`./css-layout.md`, `../accessibility/...`)
 * proporcionando `basePath`, o el identificador corto de la guía (`css-layout`).
 */
export async function readWebGuidanceDoc(params: {
  path: string
  basePath?: string
  store?: WebGuidanceMemoryStore
}): Promise<{
  found: boolean
  path: string
  title?: string
  type?: string
  version: string
  content?: string
  referencedPaths?: string[]
  error?: string
  suggestions?: string[]
}> {
  const store = params.store ?? getWebGuidanceStore()
  const engram = getWebGuidanceEngram(params.store)
  const meta = await store.getMetadata().catch(() => undefined)
  const version = meta?.version ?? 'uninitialized'

  const resolvedPath = resolveWebGuidancePath(params.path, params.basePath)
  if (!resolvedPath) {
    return {
      found: false,
      path: params.path,
      version,
      error: 'La ruta solicitada está vacía.',
    }
  }

  // 1. Lectura O(1) directa por clave primaria en IndexedDB a través de engram-ts
  let doc = await engram.getById(resolvedPath)

  // 2. Si no tenía extensión .md, probar añadiendo .md
  if (!doc && !resolvedPath.toLowerCase().endsWith('.md')) {
    doc = await engram.getById(`${resolvedPath}.md`)
  }

  // 3. Si es una referencia relativa o un slug corto (ej. "navigation-drawer" o "../accessibility/foo.md" sin basePath)
  if (!doc) {
    const allHeaders = await store.listHeaders().catch(() => [])
    const lowerTarget = resolvedPath.toLowerCase()
    const lowerWithMd = lowerTarget.endsWith('.md') ? lowerTarget : `${lowerTarget}.md`

    const matchedHeader = allHeaders.find((h) => {
      const hLower = h.id.toLowerCase()
      return (
        hLower === lowerTarget ||
        hLower === lowerWithMd ||
        hLower === `guides/${lowerTarget}` ||
        hLower === `guides/${lowerWithMd}` ||
        hLower.endsWith(`/${lowerTarget}`) ||
        hLower.endsWith(`/${lowerWithMd}`)
      )
    })

    if (matchedHeader) {
      doc = await engram.getById(matchedHeader.id)
    }
  }

  if (!doc || doc.records.length === 0) {
    const suggestionsSearch = await searchWebGuidance({
      query: resolvedPath.replace(/[\/._-]/g, ' '),
      limit: 5,
      store,
    }).catch(() => ({ results: [] }))

    return {
      found: false,
      path: resolvedPath,
      version,
      error: `Documento de modern-web-guidance no encontrado en la ruta "${resolvedPath}".`,
      suggestions: suggestionsSearch.results.map((r) => r.path),
    }
  }

  const record = doc.records[0]
  const referencedPaths = (record.tags ?? [])
    .filter((t) => t.startsWith('ref:'))
    .map((t) => t.slice(4))

  return {
    found: true,
    path: doc.header.id,
    title: doc.header.title,
    type: doc.header.type,
    version,
    content: record.content,
    referencedPaths,
  }
}

/**
 * Especificaciones OpenAI Tool Calling para `search_web_guidance` y `read_web_guidance_doc`.
 */
export function getWebGuidanceToolSpecs(): OpenAiToolSpec[] {
  return [
    {
      type: 'function',
      function: {
        name: 'search_web_guidance',
        description:
          'Busca guías y skills de buenas prácticas web modernas (modern-web-guidance) por palabras clave usando el índice full-text Lunr de engram-ts. Devuelve las rutas relativas indexadas para su posterior lectura con read_web_guidance_doc.',
        parameters: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description:
                'Palabras clave sobre la capacidad o patrón web (ej. "dialog modal light dismiss", "container queries", "popover", "form validation user-invalid", "cls layout shift").',
            },
            category: {
              type: 'string',
              description:
                'Filtro opcional de disciplina o carpeta (ej. "css", "html", "forms", "accessibility", "ui-components", "performance", "security", "built-in-ai").',
            },
            limit: {
              type: 'integer',
              description: 'Número máximo de resultados a devolver (por defecto 8).',
            },
          },
          required: ['query'],
        },
      },
    },
    {
      type: 'function',
      function: {
        name: 'read_web_guidance_doc',
        description:
          'Lee directamente el contenido Markdown completo de una skill o guía de modern-web-guidance desde IndexedDB/engram-ts por su ruta relativa (ej. "SKILL.md", "guides/css/css-layout.md" o una referencia relativa desde otro documento).',
        parameters: {
          type: 'object',
          properties: {
            path: {
              type: 'string',
              description:
                'Ruta relativa del documento en modern-web-guidance (ej. "SKILL.md", "guides/ui-components/dialog.md", "./css-layout.md").',
            },
            basePath: {
              type: 'string',
              description:
                'Ruta relativa opcional del documento actual cuando "path" es un enlace relativo como "./otro.md" o "../accessibility/accessible-error-announcement.md".',
            },
          },
          required: ['path'],
        },
      },
    },
  ]
}

/**
 * Ejecutor unificado de las herramientas `search_web_guidance` y `read_web_guidance_doc`.
 */
export async function executeWebGuidanceTool(
  toolName: string,
  args: Record<string, unknown>,
  customStore?: WebGuidanceMemoryStore,
): Promise<string> {
  if (toolName === 'search_web_guidance') {
    const query = String(args.query ?? '')
    const category = typeof args.category === 'string' ? args.category : undefined
    const limit = typeof args.limit === 'number' ? args.limit : undefined
    const res = await searchWebGuidance({ query, category, limit, store: customStore })
    return JSON.stringify(res)
  }

  if (toolName === 'read_web_guidance_doc') {
    const path = String(args.path ?? args.id ?? '')
    const basePath = typeof args.basePath === 'string' ? args.basePath : undefined
    const res = await readWebGuidanceDoc({ path, basePath, store: customStore })
    return JSON.stringify(res)
  }

  return JSON.stringify({ error: `Herramienta de Web Guidance desconocida: ${toolName}` })
}
