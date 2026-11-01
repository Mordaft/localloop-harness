import { emptyCheckpoint } from '@langchain/langgraph-checkpoint'
import assert from 'node:assert/strict'
import { IndexedDBSaver } from '../src/memory/indexeddb-saver'

console.log('--- Iniciando pruebas de IndexedDBSaver (LangGraph BaseCheckpointSaver) ---')

async function runTests() {
  const saver = new IndexedDBSaver('test-checkpoints-db')
  const cp1 = emptyCheckpoint()
  cp1.id = 'cp-1'

  const savedCfg1 = await saver.put(
    { configurable: { thread_id: 'thread-alpha', checkpoint_ns: '' } },
    cp1,
    { source: 'input', step: 0, parents: {} },
    {},
  )

  assert.equal(savedCfg1.configurable?.checkpoint_id, 'cp-1')

  await saver.putWrites(savedCfg1, [['messages', { role: 'user', content: 'Hola' }]], 'task-1')

  const tuple1 = await saver.getTuple({
    configurable: { thread_id: 'thread-alpha', checkpoint_ns: '' },
  })
  assert.ok(tuple1, 'Debe recuperar el checkpoint guardado')
  assert.equal(tuple1.checkpoint.id, 'cp-1')
  assert.equal(tuple1.pendingWrites?.length, 1)
  assert.equal(tuple1.pendingWrites?.[0][1], 'messages')

  const cp2 = emptyCheckpoint()
  cp2.id = 'cp-2'
  await saver.put(
    {
      configurable: {
        thread_id: 'thread-alpha',
        checkpoint_ns: '',
        checkpoint_id: 'cp-1',
      },
    },
    cp2,
    { source: 'loop', step: 1, parents: {} },
    {},
  )

  const latest = await saver.getTuple({
    configurable: { thread_id: 'thread-alpha' },
  })
  assert.equal(latest?.checkpoint.id, 'cp-2')
  assert.equal(latest?.parentConfig?.configurable?.checkpoint_id, 'cp-1')

  const history: string[] = []
  for await (const item of saver.list({ configurable: { thread_id: 'thread-alpha' } })) {
    history.push(item.checkpoint.id)
  }
  assert.deepEqual(history, ['cp-2', 'cp-1'])

  const summaries = await saver.listAllSummaries()
  assert.equal(summaries.length, 2)

  await saver.deleteThread('thread-alpha')
  const afterDelete = await saver.getTuple({
    configurable: { thread_id: 'thread-alpha' },
  })
  assert.equal(afterDelete, undefined)

  console.log('✓ Todas las pruebas de IndexedDBSaver pasaron exitosamente.')
}

void runTests()
