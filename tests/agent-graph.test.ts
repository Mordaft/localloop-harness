import assert from 'node:assert/strict'
import { createAgentWorkflow, routeAfterLlmRouter } from '../src/agent/agent-graph'
import { SessionStatus } from '../src/enums'
import { clearVirtualFiles, setVirtualFile } from '../src/fs/workspace-fs'
import { IndexedDBSaver } from '../src/memory/indexeddb-saver'

console.log('--- Iniciando pruebas de Grafo Cíclico LangGraph.js y Budget Edge ---')

async function runTests() {
  // Test 1: routeAfterLlmRouter conditional edge
  {
    const endRoute = routeAfterLlmRouter({
      sessionId: 1,
      threadId: 't-1',
      skill: 'skill_general',
      messages: [],
      turnsUsed: 2,
      maxTurns: 5,
      tokensUsed: 100,
      maxTokenBudget: 10000,
      pendingToolCalls: [],
      requiresHumanConfirmation: false,
      status: SessionStatus.COMPLETED,
    })
    assert.equal(endRoute, '__end__')

    const haltRoute = routeAfterLlmRouter({
      sessionId: 1,
      threadId: 't-1',
      skill: 'skill_general',
      messages: [],
      turnsUsed: 5,
      maxTurns: 5,
      tokensUsed: 100,
      maxTokenBudget: 10000,
      pendingToolCalls: [{ id: 'c1', name: 'fs_list_dir', args: {}, argumentsRaw: '{}' }],
      requiresHumanConfirmation: false,
      status: SessionStatus.RUNNING,
    })
    assert.equal(haltRoute, 'halt_budget_exceeded')
  }

  // Test 2: Cyclic router -> tool_runtime -> router -> END
  {
    clearVirtualFiles()
    setVirtualFile('README.md', '# LocalLoop Agentic Harness\n')

    let callIndex = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      callIndex += 1
      const sse =
        callIndex === 1
          ? [
              'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_read","function":{"name":"fs_read_file","arguments":"{\\"path\\":\\"README.md\\"}"}}]}}]}\n\n',
              'data: [DONE]\n\n',
            ].join('')
          : [
              'data: {"choices":[{"delta":{"content":"El archivo README contiene LocalLoop Agentic Harness."}}]}\n\n',
              'data: [DONE]\n\n',
            ].join('')

      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(sse))
            ctrl.close()
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as typeof fetch

    try {
      const saver = new IndexedDBSaver('test-workflow-cp')
      const workflow = createAgentWorkflow(saver)

      const finalState = await workflow.invoke(
        {
          sessionId: 501,
          threadId: 'thread-501',
          skill: 'skill_general',
          messages: [{ role: 'user', content: 'Lee README.md y dime qué contiene' }],
          turnsUsed: 0,
          maxTurns: 6,
          tokensUsed: 0,
          maxTokenBudget: 32000,
          pendingToolCalls: [],
          requiresHumanConfirmation: false,
          status: SessionStatus.RUNNING,
        },
        { configurable: { thread_id: 'thread-501' } },
      )

      assert.equal(finalState.status, SessionStatus.COMPLETED)
      assert.equal(finalState.turnsUsed, 2)
      assert.ok(finalState.messages.at(-1)?.content.includes('LocalLoop Agentic Harness'))

      const savedTuple = await saver.getTuple({ configurable: { thread_id: 'thread-501' } })
      assert.ok(savedTuple, 'El checkpoint del grafo debe haberse persistido en IndexedDBSaver')
    } finally {
      globalThis.fetch = originalFetch
      clearVirtualFiles()
    }
  }

  // Test 3: Halts infinite tool loops when turnsUsed reaches maxTurns (Capability 4)
  {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      const sse = [
        'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_loop","function":{"name":"fs_list_dir","arguments":"{}"}}]}}]}\n\n',
        'data: [DONE]\n\n',
      ].join('')
      const encoder = new TextEncoder()
      return new Response(
        new ReadableStream({
          start(ctrl) {
            ctrl.enqueue(encoder.encode(sse))
            ctrl.close()
          },
        }),
        { status: 200, headers: { 'Content-Type': 'text/event-stream' } },
      )
    }) as typeof fetch

    try {
      const saver = new IndexedDBSaver('test-budget-halt-cp')
      const workflow = createAgentWorkflow(saver)

      const finalState = await workflow.invoke(
        {
          sessionId: 502,
          threadId: 'thread-502',
          skill: 'skill_general',
          messages: [{ role: 'user', content: 'Bucle infinito de listado' }],
          turnsUsed: 0,
          maxTurns: 2,
          tokensUsed: 0,
          maxTokenBudget: 32000,
          pendingToolCalls: [],
          requiresHumanConfirmation: false,
          status: SessionStatus.RUNNING,
        },
        { configurable: { thread_id: 'thread-502' } },
      )

      assert.equal(finalState.status, SessionStatus.BUDGET_EXCEEDED)
      assert.equal(finalState.turnsUsed, 2)
      assert.ok(finalState.messages.at(-1)?.content.includes('Budget Edge Protection'))
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  console.log('✓ Todas las pruebas de Grafo Cíclico LangGraph.js pasaron exitosamente.')
}

void runTests()
