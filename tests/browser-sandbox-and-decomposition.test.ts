import assert from 'node:assert/strict'
import { createAgentWorkflow } from '../src/agent/agent-graph'
import { SessionStatus } from '../src/enums'
import {
  SlmConcurrencyGate,
  buildStep1ScopeTools,
  procesarNodoScope,
} from '../src/llm/llm-client'
import { AgentScopeStorage, createIsolatedEngram } from '../src/memory/engram-memory'
import { IndexedDBSaver } from '../src/memory/indexeddb-saver'
import {
  executeBrowserSandbox,
  getBrowserSandboxToolSpec,
} from '../src/sandbox/browser-sandbox'

console.log(
  '--- Iniciando pruebas de Descomposición Obligatoria por Pruebas y Browser Iframe Sandbox ---',
)

async function runTests() {
  // Test 1: buildStep1ScopeTools forces task-list creation (descomponer_en_subtareas) at root scope
  {
    const forcedTools = buildStep1ScopeTools(true, false, true)
    const toolNames = forcedTools.map((t) => t.function.name)
    assert.deepEqual(
      toolNames,
      ['descomponer_en_subtareas'],
      'En el nivel raíz con descomposición forzada solo debe ofrecerse descomponer_en_subtareas',
    )

    const childTools = buildStep1ScopeTools(true, false, false)
    const childToolNames = childTools.map((t) => t.function.name)
    assert.ok(childToolNames.includes('descomponer_en_subtareas'))
    assert.ok(childToolNames.includes('ejecutar_tarea_atomica'))
  }

  // Test 2: procesarNodoScope enforces task list with prueba_aceptacion, delegates each item to a sub-agent,
  // and each atomic sub-agent delivers tarea_realizada, prueba_automatizada, and verified evidencia_prueba.
  {
    const engram = createIsolatedEngram()
    const rootStorage = new AgentScopeStorage({
      engram,
      project: 'session-tdd-1',
      filePath: 'src/counter.ts',
      scopeId: 'root_counter',
    })

    let callCount = 0
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      callCount += 1
      let sse = ''
      if (callCount === 1) {
        // Root scope: decomposes into 2 tasks, each with its acceptance test
        const args = JSON.stringify({
          justificacion: 'Dividir en dos tareas verificables con pruebas de aceptación',
          subtareas: [
            {
              id_subtarea: 'task_increment',
              descripcion: 'Implementar función incrementar(n) que sume 1',
              prueba_aceptacion: 'incrementar(4) debe devolver exactamente 5',
              skill_requerida: 'skill_coder',
            },
            {
              id_subtarea: 'task_dom_render',
              descripcion: 'Renderizar botón y contador en el DOM del navegador',
              prueba_aceptacion: 'Al hacer click en #btn-inc el texto de #val pasa de 0 a 1',
              skill_requerida: 'skill_coder',
            },
          ],
        })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_root_plan","function":{"name":"descomponer_en_subtareas","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else if (callCount === 2) {
        // Sub-agent 1: atomic task delivering tarea_realizada, prueba_automatizada (JS), evidencia_prueba
        const args = JSON.stringify({
          skill_a_usar: 'skill_coder',
          argumentos: {
            foco: 'incrementar',
            tarea_realizada: 'export function incrementar(n) { return n + 1; }',
            prueba_automatizada:
              'const inc = (n) => n + 1; if (inc(4) !== 5) throw new Error("Fallo"); console.log("inc(4) === 5 OK"); return inc(4);',
            modo_sandbox: 'js',
            evidencia_prueba: 'Se ejecutó la prueba unitaria verificando inc(4) === 5.',
            sumario_ejecutivo: 'Función incrementar implementada y verificada.',
            findings: [],
          },
        })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_sub_1","function":{"name":"ejecutar_tarea_atomica","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else {
        // Sub-agent 2: atomic task delivering tarea_realizada, prueba_automatizada (Browser Iframe), evidencia_prueba
        const args = JSON.stringify({
          skill_a_usar: 'skill_coder',
          argumentos: {
            foco: 'dom_render',
            tarea_realizada: '<button id="btn-inc">+</button><span id="val">0</span>',
            html_prueba: '<button id="btn-inc">+</button><span id="val">0</span>',
            selector_dom: '#val',
            modo_sandbox: 'browser_iframe',
            prueba_automatizada:
              'const btn = document.getElementById("btn-inc"); const val = document.getElementById("val"); btn.addEventListener("click", () => { val.textContent = "1"; }); btn.click(); console.log("DOM actualizado a:", val.textContent); return val.textContent;',
            evidencia_prueba: 'Prueba en iframe confirmó que #val cambia a 1 tras click.',
            sumario_ejecutivo: 'Componente DOM probado en Browser Iframe Sandbox.',
            findings: [],
          },
        })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_sub_2","function":{"name":"ejecutar_tarea_atomica","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      }

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
      const rootResult = await procesarNodoScope(
        {
          id_subtarea: 'root_counter',
          descripcion: 'Crear módulo de contador y vista DOM',
          prueba_aceptacion: 'La lógica incrementa correctamente y el DOM refleja el cambio',
        },
        rootStorage,
        {
          targetPath: 'src/counter.ts',
          codeContent: 'export const placeholder = true;',
          baseInstructions: 'Sigue TDD estricto.',
          maxDepth: 2,
          maxConcurrency: 2,
          concurrencyGate: new SlmConcurrencyGate(2),
        },
        true,
      )

      assert.equal(rootResult.isAggregated, true)
      assert.ok(rootResult.entregables_subagentes)
      assert.equal(rootResult.entregables_subagentes.length, 2)

      const firstSub = rootResult.entregables_subagentes[0]
      assert.equal(firstSub.prueba_aceptacion, 'incrementar(4) debe devolver exactamente 5')
      assert.ok(firstSub.entregable_atomico)
      assert.ok(firstSub.entregable_atomico.tarea_realizada.includes('incrementar'))
      assert.ok(firstSub.entregable_atomico.prueba_automatizada.includes('inc(4)'))
      assert.equal(firstSub.entregable_atomico.evidencia_prueba.ejecutada, true)
      assert.equal(firstSub.entregable_atomico.evidencia_prueba.exito, true)
      assert.equal(firstSub.entregable_atomico.evidencia_prueba.modo, 'js_sandbox')
      assert.ok(
        firstSub.entregable_atomico.evidencia_prueba.logs.some((l) => l.includes('inc(4) === 5 OK')),
      )

      const secondSub = rootResult.entregables_subagentes[1]
      assert.ok(secondSub.entregable_atomico)
      assert.equal(
        secondSub.entregable_atomico.evidencia_prueba.modo,
        'browser_iframe_sandbox',
      )
      assert.equal(secondSub.entregable_atomico.evidencia_prueba.exito, true)
      assert.ok(secondSub.entregable_atomico.evidencia_prueba.screenshotDataUrl?.startsWith('data:image/'))
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // Test 3: Browser Iframe Sandbox tool (run_browser_sandbox) queries DOM, captures logs & screenshot
  {
    const spec = getBrowserSandboxToolSpec()
    assert.equal(spec.function.name, 'run_browser_sandbox')

    const sandboxRes = await executeBrowserSandbox({
      html: '<div id="panel" class="hero"><h1 id="title">Hola Mundo</h1><button id="action">Cambiar</button></div>',
      css: '.hero { padding: 16px; background: #f8fafc; }',
      code: `
        const title = document.getElementById('title');
        const btn = document.getElementById('action');
        btn.addEventListener('click', () => {
          title.textContent = 'Texto Actualizado en Iframe';
        });
        btn.click();
        console.log('Estado del título:', title.textContent);
        return { updated: title.textContent };
      `,
      domSelector: '#title',
      captureScreenshot: true,
    })

    assert.equal(sandboxRes.ok, true)
    assert.ok(
      sandboxRes.logs.some((l) => l.includes('Estado del título: Texto Actualizado en Iframe')),
    )
    assert.ok(sandboxRes.returnValue?.includes('Texto Actualizado en Iframe'))
    assert.ok(sandboxRes.dom.queriedElements.length >= 1)
    assert.equal(sandboxRes.dom.queriedElements[0].id, 'title')
    assert.equal(sandboxRes.dom.queriedElements[0].textContent, 'Texto Actualizado en Iframe')
    assert.ok(
      sandboxRes.screenshotDataUrl && sandboxRes.screenshotDataUrl.startsWith('data:image/'),
      'Debe devolver una captura del área renderizada en formato data:image/*',
    )
  }

  // Test 4: AgentGraph enforces plan_and_delegate_tasks on Turn 1 and prevents post-decomposition loops on Turn 2+
  {
    let turnCall = 0
    const observedToolChoices: Array<unknown> = []
    const observedToolNamesPerCall: Array<string[]> = []
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      turnCall += 1
      const parsedBody = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {}
      observedToolChoices.push(parsedBody.tool_choice)
      const toolsArr = Array.isArray(parsedBody.tools)
        ? (parsedBody.tools as Array<{ function?: { name?: string } }>).map(
            (t) => t.function?.name ?? '',
          )
        : []
      observedToolNamesPerCall.push(toolsArr)

      let sse = ''
      if (turnCall === 1) {
        // Turn 1: Root agent calls plan_and_delegate_tasks
        const planArgs = JSON.stringify({
          workGoal: 'Validar componente de saludo',
          tasks: [
            {
              id: 't1',
              description: 'Crear saludo en DOM',
              acceptanceTest: 'El nodo #greeting contiene Hola LocalLoop',
              skill: 'skill_coder',
            },
          ],
        })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_plan_1","function":{"name":"plan_and_delegate_tasks","arguments":${JSON.stringify(planArgs)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else if (turnCall === 2) {
        // Sub-agent for task t1: executes atomic task with automated test and evidence (testing flat args too)
        const subArgs = JSON.stringify({
          skill_a_usar: 'skill_coder',
          foco: 'saludo_dom',
          tarea_realizada: '<div id="greeting">Hola LocalLoop</div>',
          html_prueba: '<div id="greeting">Hola LocalLoop</div>',
          selector_dom: '#greeting',
          modo_sandbox: 'browser_iframe',
          prueba_automatizada:
            'const el = document.getElementById("greeting"); if (el.textContent !== "Hola LocalLoop") throw new Error("No coincide"); console.log("Saludo verificado:", el.textContent); return el.textContent;',
          evidencia_prueba: 'Verificado en iframe que #greeting muestra Hola LocalLoop.',
          sumario_ejecutivo: 'Saludo DOM completado y probado.',
        })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_atomic_t1","function":{"name":"ejecutar_tarea_atomica","arguments":${JSON.stringify(subArgs)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else {
        // Turn 2 of Root agent: finishes after receiving sub-agent deliverables
        sse = [
          'data: {"choices":[{"delta":{"content":"Lista de tareas completada con su prueba automatizada y evidencia en iframe."}}]}\n\n',
          'data: [DONE]\n\n',
        ].join('')
      }

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
      const saver = new IndexedDBSaver('test-mandatory-decomposition-cp')
      const workflow = createAgentWorkflow(saver)
      const finalState = await workflow.invoke(
        {
          sessionId: 701,
          threadId: 'thread-701',
          skill: 'skill_coder',
          messages: [{ role: 'user', content: 'Implementa y prueba un componente de saludo' }],
          turnsUsed: 0,
          maxTurns: 6,
          tokensUsed: 0,
          maxTokenBudget: 32000,
          pendingToolCalls: [],
          requiresHumanConfirmation: false,
          taskPlanCreated: false,
          status: SessionStatus.RUNNING,
        },
        { configurable: { thread_id: 'thread-701' } },
      )

      assert.equal(observedToolChoices[0], 'required', 'El primer turno sin lista de tareas debe forzar tool_choice=required')
      assert.deepEqual(
        observedToolNamesPerCall[1],
        ['ejecutar_tarea_atomica'],
        'El sub-agente delegado tras la primera descomposición debe ejecutar su tarea atómica sin entrar en bucle de re-descomposición',
      )
      assert.equal(
        observedToolChoices[2],
        'auto',
        'Tras completar la descomposición, el siguiente turno del grafo debe pasar a tool_choice=auto',
      )
      assert.ok(
        !observedToolNamesPerCall[2].includes('plan_and_delegate_tasks') &&
          !observedToolNamesPerCall[2].includes('delegate_subagent_scope'),
        'Tras la primera descomposición, plan_and_delegate_tasks y delegate_subagent_scope deben retirarse para evitar bucles',
      )
      assert.equal(finalState.taskPlanCreated, true)
      assert.equal(finalState.status, SessionStatus.COMPLETED)
      const toolMsg = finalState.messages.find((m) => m.role === 'tool' && m.name === 'plan_and_delegate_tasks')
      assert.ok(toolMsg, 'Debe existir el resultado de plan_and_delegate_tasks')
      assert.ok(toolMsg.content.includes('task_list_delegated_and_completed'))
      assert.ok(toolMsg.content.includes('browser_iframe_sandbox'))
      assert.ok(
        toolMsg.content.includes('[captura_disponible_en_inspector_ui]'),
        'El base64 pesado debe compactarse en el mensaje del LLM para no desbordar el contexto en el siguiente paso',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  console.log(
    '✓ Todas las pruebas de Descomposición Obligatoria por Pruebas y Browser Iframe Sandbox pasaron exitosamente.',
  )
}

void runTests()

