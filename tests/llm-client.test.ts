import assert from 'node:assert/strict'
import {
  SlmConcurrencyGate,
  safeParseJsonObject,
  streamChatCompletion,
} from '../src/llm/llm-client'

console.log('--- Iniciando pruebas de Cliente LLM OpenAI-Compatible Streaming ---')

async function runTests() {
  // Test 1: safeParseJsonObject resilience
  {
    const parsed = safeParseJsonObject('Texto previo {"path":"README.md","line":10} texto posterior')
    assert.deepEqual(parsed, { path: 'README.md', line: 10 })
  }

  // Test 2: SSE streaming, <think> extraction & tool_calls delta assembly
  {
    const ssePayload = [
      'data: {"choices":[{"delta":{"content":"<think>Pensando en el archivo...</think>Voy a leer el archivo."}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_1","function":{"name":"fs_read_file","arguments":"{\\"path\\":"}}]}}]}\n\n',
      'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"README.md\\"}"}}]}}]}\n\n',
      'data: [DONE]\n\n',
    ].join('')

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode(ssePayload))
        controller.close()
      },
    })

    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () =>
      new Response(stream, {
        status: 200,
        headers: { 'Content-Type': 'text/event-stream' },
      })) as typeof fetch

    try {
      const thoughts: string[] = []
      const res = await streamChatCompletion({
        scopeId: 'test_sse',
        messages: [{ role: 'user', content: 'Lee README.md' }],
        onThinking: (t) => {
          thoughts.push(t)
        },
      })

      assert.equal(res.thoughtBuffer, 'Pensando en el archivo...')
      assert.equal(res.contentBuffer, 'Voy a leer el archivo.')
      assert.ok(thoughts.length > 0)
      assert.equal(res.toolCalls.length, 1)
      assert.equal(res.toolCalls[0].name, 'fs_read_file')
      assert.deepEqual(res.toolCalls[0].args, { path: 'README.md' })
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // Test 3: SlmConcurrencyGate acquire/release
  {
    const gate = new SlmConcurrencyGate(2)
    let active = 0
    let maxObserved = 0

    await Promise.all(
      [1, 2, 3, 4].map(async () => {
        const release = await gate.acquire()
        try {
          active += 1
          maxObserved = Math.max(maxObserved, active)
          await new Promise((r) => setTimeout(r, 15))
          active -= 1
        } finally {
          release()
        }
      }),
    )

    assert.ok(maxObserved <= 2, 'La concurrencia no debe superar 2')
  }

  console.log('✓ Todas las pruebas de Cliente LLM pasaron exitosamente.')
}

void runTests()
