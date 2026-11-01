import Dexie, { type Table } from 'dexie'
import {
  FileProposalStatus,
  McpTransportType,
  SessionStatus,
  type FileProposalStatus as FileProposalStatusType,
  type McpTransportType as McpTransportTypeValue,
  type SessionStatus as SessionStatusType,
} from '../enums'
import { getLlmConfig } from '../llm/llm-config'
import { getPersistentEngram, resetEngramMemoryDatabase } from './engram-memory'
import { CHECKPOINT_DB_NAME, getSharedIndexedDBSaver } from './indexeddb-saver'

export interface AgentSession {
  id?: number
  threadId: string
  title: string
  goal: string
  workspaceName: string
  skill: string
  status: SessionStatusType
  turnsUsed: number
  maxTurns: number
  tokensUsed: number
  maxTokenBudget: number
  model: string
  createdAt: string
  updated: string
}

export interface StoredChatMessage {
  id?: number
  sessionId: number
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  thought?: string
  toolName?: string
  toolCallId?: string
  createdAt: string
}

export interface StoredFileWriteProposal {
  id?: number
  sessionId: number
  path: string
  originalContent: string
  proposedContent: string
  reason: string
  status: FileProposalStatusType
  createdAt: string
}

export interface StoredWorkspaceHandle {
  id: string // 'active-workspace' or `session-${id}`
  name: string
  handle: FileSystemDirectoryHandle
  updatedAt: string
}

export interface StoredMcpServer {
  id?: number
  name: string
  url: string
  transport: McpTransportTypeValue
  enabled: boolean
  createdAt: string
}

class LocalLoopDatabase extends Dexie {
  sessions!: Table<AgentSession, number>
  messages!: Table<StoredChatMessage, number>
  fileProposals!: Table<StoredFileWriteProposal, number>
  workspaceHandles!: Table<StoredWorkspaceHandle, string>
  mcpServers!: Table<StoredMcpServer, number>

  constructor() {
    super('localloop-app-db')
    this.version(1).stores({
      sessions: '++id, threadId, status, updated',
      messages: '++id, sessionId, createdAt',
      fileProposals: '++id, sessionId, status, [sessionId+path]',
      workspaceHandles: 'id, updatedAt',
      mcpServers: '++id, name, enabled',
    })
  }
}

const hasIndexedDb = typeof indexedDB !== 'undefined'
const database = hasIndexedDb ? new LocalLoopDatabase() : undefined

// Fallback in-memory stores for Node unit test environments
const memSessions: AgentSession[] = []
const memMessages: StoredChatMessage[] = []
const memProposals: StoredFileWriteProposal[] = []
const memHandles = new Map<string, StoredWorkspaceHandle>()
const memMcpServers: StoredMcpServer[] = []
let memAutoId = 1

export async function listSessions(): Promise<AgentSession[]> {
  if (database) {
    const all = await database.sessions.toArray()
    return all.sort((a, b) => b.updated.localeCompare(a.updated))
  }
  return [...memSessions].sort((a, b) => b.updated.localeCompare(a.updated))
}

export async function getSessionById(id: number): Promise<AgentSession | undefined> {
  if (database) return database.sessions.get(id)
  return memSessions.find((s) => s.id === id)
}

export async function createSession(input: {
  title: string
  goal: string
  workspaceName?: string
  skill?: string
}): Promise<number> {
  const now = new Date().toISOString()
  const config = getLlmConfig()
  const session: AgentSession = {
    threadId: `thread-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    title: input.title.trim(),
    goal: input.goal.trim(),
    workspaceName: input.workspaceName?.trim() || 'Workspace local',
    skill: input.skill || 'skill_general',
    status: SessionStatus.IDLE,
    turnsUsed: 0,
    maxTurns: config.maxTurns,
    tokensUsed: 0,
    maxTokenBudget: config.maxTokenBudget,
    model: config.model,
    createdAt: now,
    updated: now,
  }

  let sessionId: number
  if (database) {
    sessionId = await database.sessions.add(session)
  } else {
    sessionId = memAutoId++
    memSessions.push({ ...session, id: sessionId })
  }

  await appendSessionMessage({
    sessionId,
    role: 'user',
    content: input.goal.trim(),
  })

  return sessionId
}

export async function updateSessionMetrics(
  id: number,
  changes: Partial<Pick<AgentSession, 'status' | 'turnsUsed' | 'tokensUsed' | 'workspaceName' | 'model'>>,
): Promise<void> {
  const updated = new Date().toISOString()
  if (database) {
    await database.sessions.update(id, { ...changes, updated })
    return
  }
  const target = memSessions.find((s) => s.id === id)
  if (target) {
    Object.assign(target, changes, { updated })
  }
}

export async function deleteSession(id: number): Promise<void> {
  const session = await getSessionById(id)
  if (session?.threadId) {
    await getSharedIndexedDBSaver().deleteThread(session.threadId)
  }
  if (database) {
    await database.transaction('rw', database.sessions, database.messages, database.fileProposals, async () => {
      await database.sessions.delete(id)
      await database.messages.where('sessionId').equals(id).delete()
      await database.fileProposals.where('sessionId').equals(id).delete()
    })
    return
  }
  const idx = memSessions.findIndex((s) => s.id === id)
  if (idx >= 0) memSessions.splice(idx, 1)
}

export async function listSessionMessages(sessionId: number): Promise<StoredChatMessage[]> {
  if (database) {
    const msgs = await database.messages.where('sessionId').equals(sessionId).toArray()
    return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  return memMessages.filter((m) => m.sessionId === sessionId)
}

export async function appendSessionMessage(
  msg: Omit<StoredChatMessage, 'id' | 'createdAt'>,
): Promise<number> {
  const entry: StoredChatMessage = {
    ...msg,
    createdAt: new Date().toISOString(),
  }
  if (database) {
    const id = await database.messages.add(entry)
    await database.sessions.update(msg.sessionId, { updated: entry.createdAt })
    return id
  }
  const id = memAutoId++
  memMessages.push({ ...entry, id })
  return id
}

export async function listFileProposals(sessionId?: number): Promise<StoredFileWriteProposal[]> {
  if (database) {
    const rows =
      sessionId !== undefined
        ? await database.fileProposals.where('sessionId').equals(sessionId).toArray()
        : await database.fileProposals.toArray()
    return rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  }
  return memProposals.filter((p) => sessionId === undefined || p.sessionId === sessionId)
}

export async function createFileProposal(
  input: Omit<StoredFileWriteProposal, 'id' | 'createdAt'>,
): Promise<number> {
  const row: StoredFileWriteProposal = {
    ...input,
    createdAt: new Date().toISOString(),
  }
  if (database) {
    return database.fileProposals.add(row)
  }
  const id = memAutoId++
  memProposals.push({ ...row, id })
  return id
}

export async function updateFileProposalStatus(
  id: number,
  status: FileProposalStatusType,
): Promise<StoredFileWriteProposal | undefined> {
  if (database) {
    await database.fileProposals.update(id, { status })
    return database.fileProposals.get(id)
  }
  const target = memProposals.find((p) => p.id === id)
  if (target) target.status = status
  return target
}

export async function saveWorkspaceHandle(
  handle: FileSystemDirectoryHandle,
  key = 'active-workspace',
): Promise<void> {
  const row: StoredWorkspaceHandle = {
    id: key,
    name: handle.name,
    handle,
    updatedAt: new Date().toISOString(),
  }
  if (database) {
    await database.workspaceHandles.put(row)
    return
  }
  memHandles.set(key, row)
}

export async function getSavedWorkspaceHandle(
  key = 'active-workspace',
): Promise<StoredWorkspaceHandle | undefined> {
  if (database) {
    return database.workspaceHandles.get(key)
  }
  return memHandles.get(key)
}

export async function listMcpServers(): Promise<StoredMcpServer[]> {
  if (database) {
    return database.mcpServers.toArray()
  }
  return [...memMcpServers]
}

export async function addMcpServer(input: {
  name: string
  url: string
  transport?: McpTransportTypeValue
}): Promise<number> {
  const row: StoredMcpServer = {
    name: input.name.trim(),
    url: input.url.trim(),
    transport: input.transport ?? McpTransportType.SSE,
    enabled: true,
    createdAt: new Date().toISOString(),
  }
  if (database) {
    return database.mcpServers.add(row)
  }
  const id = memAutoId++
  memMcpServers.push({ ...row, id })
  return id
}

export async function deleteMcpServer(id: number): Promise<void> {
  if (database) {
    await database.mcpServers.delete(id)
    return
  }
  const idx = memMcpServers.findIndex((s) => s.id === id)
  if (idx >= 0) memMcpServers.splice(idx, 1)
}

export async function getDashboardKpis(): Promise<{
  activeSessions: number
  pendingApprovals: number
  engramMemories: number
}> {
  const [sessions, proposals] = await Promise.all([listSessions(), listFileProposals()])
  const activeSessions = sessions.filter(
    (s) => s.status !== SessionStatus.COMPLETED && s.status !== SessionStatus.BUDGET_EXCEEDED,
  ).length
  const pendingApprovals = proposals.filter((p) => p.status === FileProposalStatus.PENDING).length

  let engramMemories = 0
  try {
    const engram = getPersistentEngram()
    const results = await engram.search({ query: '', limit: 200 })
    engramMemories = results.length
  } catch {
    engramMemories = 0
  }

  return { activeSessions, pendingApprovals, engramMemories }
}

export async function resetDatabaseAndCache(): Promise<void> {
  try {
    if (database) await database.delete()
    await Dexie.delete(CHECKPOINT_DB_NAME)
    await resetEngramMemoryDatabase()
  } catch (err) {
    console.warn('[DB] Error eliminando bases de datos Dexie:', err)
  }

  try {
    if (typeof window !== 'undefined' && 'caches' in window) {
      const cacheKeys = await caches.keys()
      await Promise.all(cacheKeys.map((key) => caches.delete(key)))
    }
  } catch (err) {
    console.warn('[DB] Error eliminando caches:', err)
  }

  try {
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((reg) => reg.unregister()))
    }
  } catch (err) {
    console.warn('[DB] Error desregistrando service workers:', err)
  }

  try {
    if (typeof localStorage !== 'undefined') localStorage.clear()
    if (typeof sessionStorage !== 'undefined') sessionStorage.clear()
  } catch (err) {
    console.warn('[DB] Error limpiando storage:', err)
  }

  if (typeof window !== 'undefined') {
    window.location.reload()
  }
}
