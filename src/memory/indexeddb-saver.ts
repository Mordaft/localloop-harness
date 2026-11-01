import Dexie, { type Table } from 'dexie'
import {
  BaseCheckpointSaver,
  copyCheckpoint,
  type Checkpoint,
  type CheckpointMetadata,
  type CheckpointTuple,
} from '@langchain/langgraph'
import { trace } from '../diagnostics'

export const CHECKPOINT_DB_NAME = 'localloop-checkpoints'

export interface StoredCheckpointRow {
  pk: string // `${threadId}::${checkpointNs}::${checkpointId}`
  threadId: string
  checkpointNs: string
  checkpointId: string
  parentCheckpointId?: string
  checkpointBytes: Uint8Array
  metadataBytes: Uint8Array
  createdAt: string
}

export interface StoredCheckpointWriteRow {
  pk: string // `${threadId}::${checkpointNs}::${checkpointId}::${taskId}::${idx}`
  threadId: string
  checkpointNs: string
  checkpointId: string
  taskId: string
  idx: number
  channel: string
  valueBytes: Uint8Array
  taskPath: string
}

export interface CheckpointSummaryItem {
  threadId: string
  checkpointNs: string
  checkpointId: string
  parentCheckpointId?: string
  createdAt: string
  step?: number
  source?: string
}

class CheckpointDexieDatabase extends Dexie {
  checkpoints!: Table<StoredCheckpointRow, string>
  checkpointWrites!: Table<StoredCheckpointWriteRow, string>

  constructor(dbName = CHECKPOINT_DB_NAME) {
    super(dbName)
    this.version(1).stores({
      checkpoints: 'pk, threadId, [threadId+checkpointNs], [threadId+checkpointNs+checkpointId], createdAt',
      checkpointWrites: 'pk, threadId, [threadId+checkpointNs+checkpointId]',
    })
  }
}

const WRITES_IDX_MAP: Record<string, number> = {
  __error__: -1,
  __scheduled__: -2,
  __interrupt__: -3,
  __resume__: -4,
}

function compareCodePointStrings(a: string, b: string): number {
  const aPoints = Array.from(a)
  const bPoints = Array.from(b)
  const len = Math.min(aPoints.length, bPoints.length)
  for (let i = 0; i < len; i += 1) {
    const diff = aPoints[i].codePointAt(0)! - bPoints[i].codePointAt(0)!
    if (diff !== 0) return diff
  }
  return aPoints.length - bPoints.length
}

function compareWriteRows(a: StoredCheckpointWriteRow, b: StoredCheckpointWriteRow): number {
  const pathDiff = compareCodePointStrings(a.taskPath ?? '', b.taskPath ?? '')
  if (pathDiff !== 0) return pathDiff
  const taskDiff = compareCodePointStrings(a.taskId, b.taskId)
  if (taskDiff !== 0) return taskDiff
  return a.idx - b.idx
}

/**
 * Browser-first persistent LangGraph Checkpointer backed by IndexedDB (Dexie.js),
 * with automatic in-memory fallback for environments without IndexedDB (e.g. Node unit tests).
 */
export class IndexedDBSaver extends BaseCheckpointSaver {
  private readonly db?: CheckpointDexieDatabase
  private readonly memoryCheckpoints = new Map<string, StoredCheckpointRow>()
  private readonly memoryWrites = new Map<string, StoredCheckpointWriteRow>()

  constructor(options?: { dbName?: string; forceInMemory?: boolean }) {
    super()
    const hasIndexedDb = typeof indexedDB !== 'undefined' && !options?.forceInMemory
    if (hasIndexedDb) {
      this.db = new CheckpointDexieDatabase(options?.dbName ?? CHECKPOINT_DB_NAME)
    }
  }

  private makeCheckpointPk(threadId: string, checkpointNs: string, checkpointId: string): string {
    return `${threadId}::${checkpointNs}::${checkpointId}`
  }

  private makeWritePk(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
    taskId: string,
    idx: number,
  ): string {
    return `${threadId}::${checkpointNs}::${checkpointId}::${taskId}::${idx}`
  }

  private async getCheckpointRowsForNamespace(
    threadId: string,
    checkpointNs: string,
  ): Promise<StoredCheckpointRow[]> {
    if (this.db) {
      const rows = await this.db.checkpoints
        .where('[threadId+checkpointNs]')
        .equals([threadId, checkpointNs])
        .toArray()
      return rows.sort((a, b) => b.checkpointId.localeCompare(a.checkpointId))
    }
    const rows = [...this.memoryCheckpoints.values()].filter(
      (r) => r.threadId === threadId && r.checkpointNs === checkpointNs,
    )
    return rows.sort((a, b) => b.checkpointId.localeCompare(a.checkpointId))
  }

  private async getWriteRowsForCheckpoint(
    threadId: string,
    checkpointNs: string,
    checkpointId: string,
  ): Promise<StoredCheckpointWriteRow[]> {
    if (this.db) {
      const rows = await this.db.checkpointWrites
        .where('[threadId+checkpointNs+checkpointId]')
        .equals([threadId, checkpointNs, checkpointId])
        .toArray()
      return rows.sort(compareWriteRows)
    }
    const rows = [...this.memoryWrites.values()].filter(
      (r) => r.threadId === threadId && r.checkpointNs === checkpointNs && r.checkpointId === checkpointId,
    )
    return rows.sort(compareWriteRows)
  }

  private async deserializePendingWrites(
    rows: StoredCheckpointWriteRow[],
  ): Promise<Array<[string, string, unknown]>> {
    return Promise.all(
      rows.map(async (row): Promise<[string, string, unknown]> => [
        row.taskId,
        row.channel,
        await this.serde.loadsTyped('json', row.valueBytes),
      ]),
    )
  }

  override async getTuple(config: {
    configurable?: {
      thread_id?: string
      checkpoint_ns?: string
      checkpoint_id?: string
    }
  }): Promise<CheckpointTuple | undefined> {
    const threadId = config.configurable?.thread_id
    if (!threadId) return undefined
    const checkpointNs = config.configurable?.checkpoint_ns ?? ''
    const requestedId = config.configurable?.checkpoint_id

    let targetRow: StoredCheckpointRow | undefined
    if (requestedId) {
      const pk = this.makeCheckpointPk(threadId, checkpointNs, requestedId)
      targetRow = this.db ? await this.db.checkpoints.get(pk) : this.memoryCheckpoints.get(pk)
    } else {
      const rows = await this.getCheckpointRowsForNamespace(threadId, checkpointNs)
      targetRow = rows[0]
    }

    if (!targetRow) return undefined

    const [checkpoint, metadata, writeRows] = await Promise.all([
      this.serde.loadsTyped('json', targetRow.checkpointBytes) as Promise<Checkpoint>,
      this.serde.loadsTyped('json', targetRow.metadataBytes) as Promise<CheckpointMetadata>,
      this.getWriteRowsForCheckpoint(threadId, checkpointNs, targetRow.checkpointId),
    ])

    const pendingWrites = await this.deserializePendingWrites(writeRows)

    const tuple: CheckpointTuple = {
      config: {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: targetRow.checkpointId,
        },
      },
      checkpoint,
      metadata,
      pendingWrites,
    }

    if (targetRow.parentCheckpointId !== undefined) {
      tuple.parentConfig = {
        configurable: {
          thread_id: threadId,
          checkpoint_ns: checkpointNs,
          checkpoint_id: targetRow.parentCheckpointId,
        },
      }
    }

    return tuple
  }

  override async *list(
    config: {
      configurable?: {
        thread_id?: string
        checkpoint_ns?: string
        checkpoint_id?: string
      }
    },
    options?: {
      limit?: number
      before?: { configurable?: { checkpoint_id?: string } }
      filter?: Record<string, unknown>
    },
  ): AsyncGenerator<CheckpointTuple> {
    const threadId = config.configurable?.thread_id
    const checkpointNs = config.configurable?.checkpoint_ns
    const checkpointId = config.configurable?.checkpoint_id
    const beforeId = options?.before?.configurable?.checkpoint_id
    let remaining = options?.limit

    let allRows: StoredCheckpointRow[]
    if (this.db) {
      allRows = threadId
        ? await this.db.checkpoints.where('threadId').equals(threadId).toArray()
        : await this.db.checkpoints.toArray()
    } else {
      allRows = [...this.memoryCheckpoints.values()].filter((r) => !threadId || r.threadId === threadId)
    }

    allRows.sort((a, b) => b.checkpointId.localeCompare(a.checkpointId))

    for (const row of allRows) {
      if (checkpointNs !== undefined && row.checkpointNs !== checkpointNs) continue
      if (checkpointId && row.checkpointId !== checkpointId) continue
      if (beforeId && row.checkpointId >= beforeId) continue

      const metadata = (await this.serde.loadsTyped('json', row.metadataBytes)) as CheckpointMetadata
      if (
        options?.filter &&
        !Object.entries(options.filter).every(
          ([k, v]) => (metadata as unknown as Record<string, unknown>)[k] === v,
        )
      ) {
        continue
      }

      if (remaining !== undefined) {
        if (remaining <= 0) break
        remaining -= 1
      }

      const [checkpoint, writeRows] = await Promise.all([
        this.serde.loadsTyped('json', row.checkpointBytes) as Promise<Checkpoint>,
        this.getWriteRowsForCheckpoint(row.threadId, row.checkpointNs, row.checkpointId),
      ])
      const pendingWrites = await this.deserializePendingWrites(writeRows)

      const tuple: CheckpointTuple = {
        config: {
          configurable: {
            thread_id: row.threadId,
            checkpoint_ns: row.checkpointNs,
            checkpoint_id: row.checkpointId,
          },
        },
        checkpoint,
        metadata,
        pendingWrites,
      }
      if (row.parentCheckpointId !== undefined) {
        tuple.parentConfig = {
          configurable: {
            thread_id: row.threadId,
            checkpoint_ns: row.checkpointNs,
            checkpoint_id: row.parentCheckpointId,
          },
        }
      }
      yield tuple
    }
  }

  override async put(
    config: {
      configurable?: {
        thread_id?: string
        checkpoint_ns?: string
        checkpoint_id?: string
      }
    },
    checkpoint: Checkpoint,
    metadata: CheckpointMetadata,
  ): Promise<{
    configurable: {
      thread_id: string
      checkpoint_ns: string
      checkpoint_id: string
    }
  }> {
    const threadId = config.configurable?.thread_id
    if (!threadId) {
      throw new Error('IndexedDBSaver.put requiere configurable.thread_id')
    }
    const checkpointNs = config.configurable?.checkpoint_ns ?? ''
    const prepared = copyCheckpoint(checkpoint)

    const [[, checkpointBytes], [, metadataBytes]] = await Promise.all([
      this.serde.dumpsTyped(prepared),
      this.serde.dumpsTyped(metadata),
    ])

    const row: StoredCheckpointRow = {
      pk: this.makeCheckpointPk(threadId, checkpointNs, checkpoint.id),
      threadId,
      checkpointNs,
      checkpointId: checkpoint.id,
      parentCheckpointId: config.configurable?.checkpoint_id,
      checkpointBytes,
      metadataBytes,
      createdAt: checkpoint.ts || new Date().toISOString(),
    }

    if (this.db) {
      await this.db.checkpoints.put(row)
    } else {
      this.memoryCheckpoints.set(row.pk, row)
    }

    trace('checkpoint.put', {
      threadId,
      checkpointNs,
      checkpointId: checkpoint.id,
      parentCheckpointId: row.parentCheckpointId,
    })

    return {
      configurable: {
        thread_id: threadId,
        checkpoint_ns: checkpointNs,
        checkpoint_id: checkpoint.id,
      },
    }
  }

  override async putWrites(
    config: {
      configurable?: {
        thread_id?: string
        checkpoint_ns?: string
        checkpoint_id?: string
      }
    },
    writes: Array<[string, unknown]>,
    taskId: string,
    taskPath = '',
  ): Promise<void> {
    const threadId = config.configurable?.thread_id
    const checkpointId = config.configurable?.checkpoint_id
    if (!threadId || !checkpointId) {
      throw new Error('IndexedDBSaver.putWrites requiere thread_id y checkpoint_id')
    }
    const checkpointNs = config.configurable?.checkpoint_ns ?? ''

    const rowsToSave: StoredCheckpointWriteRow[] = []
    for (let i = 0; i < writes.length; i += 1) {
      const [channel, value] = writes[i]
      const mappedIdx = WRITES_IDX_MAP[channel] ?? i
      const pk = this.makeWritePk(threadId, checkpointNs, checkpointId, taskId, mappedIdx)
      if (mappedIdx >= 0) {
        const exists = this.db
          ? Boolean(await this.db.checkpointWrites.get(pk))
          : this.memoryWrites.has(pk)
        if (exists) continue
      }
      const [, valueBytes] = await this.serde.dumpsTyped(value)
      rowsToSave.push({
        pk,
        threadId,
        checkpointNs,
        checkpointId,
        taskId,
        idx: mappedIdx,
        channel,
        valueBytes,
        taskPath,
      })
    }

    if (rowsToSave.length > 0) {
      if (this.db) {
        await this.db.checkpointWrites.bulkPut(rowsToSave)
      } else {
        for (const r of rowsToSave) {
          this.memoryWrites.set(r.pk, r)
        }
      }
    }
  }

  override async deleteThread(threadId: string): Promise<void> {
    if (this.db) {
      await this.db.transaction('rw', this.db.checkpoints, this.db.checkpointWrites, async () => {
        await this.db!.checkpoints.where('threadId').equals(threadId).delete()
        await this.db!.checkpointWrites.where('threadId').equals(threadId).delete()
      })
    } else {
      for (const [k, row] of this.memoryCheckpoints.entries()) {
        if (row.threadId === threadId) this.memoryCheckpoints.delete(k)
      }
      for (const [k, row] of this.memoryWrites.entries()) {
        if (row.threadId === threadId) this.memoryWrites.delete(k)
      }
    }
  }

  /**
   * Lists compact checkpoint summaries across all threads for the Memory Explorer UI.
   */
  async listAllSummaries(limit = 50): Promise<CheckpointSummaryItem[]> {
    let rows: StoredCheckpointRow[]
    if (this.db) {
      rows = await this.db.checkpoints.toArray()
    } else {
      rows = [...this.memoryCheckpoints.values()]
    }
    rows.sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const sliced = rows.slice(0, limit)
    const summaries: CheckpointSummaryItem[] = []
    for (const row of sliced) {
      let step: number | undefined
      let source: string | undefined
      try {
        const meta = (await this.serde.loadsTyped('json', row.metadataBytes)) as CheckpointMetadata
        step = meta?.step
        source = meta?.source
      } catch {
        // Ignore metadata decode error
      }
      summaries.push({
        threadId: row.threadId,
        checkpointNs: row.checkpointNs,
        checkpointId: row.checkpointId,
        parentCheckpointId: row.parentCheckpointId,
        createdAt: row.createdAt,
        step,
        source,
      })
    }
    return summaries
  }

  async clearAll(): Promise<void> {
    this.memoryCheckpoints.clear()
    this.memoryWrites.clear()
    if (this.db) {
      await this.db.checkpoints.clear()
      await this.db.checkpointWrites.clear()
    }
  }
}

let sharedCheckpointer: IndexedDBSaver | undefined

export function getSharedIndexedDBSaver(): IndexedDBSaver {
  if (!sharedCheckpointer) {
    sharedCheckpointer = new IndexedDBSaver()
  }
  return sharedCheckpointer
}
