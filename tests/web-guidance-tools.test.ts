import assert from 'node:assert/strict'
import { compiledSDLCGraph, setRequireLiveLlm, streamLlmPhase } from '../src/agent/sdlc-graph'
import type { SDLCStateType } from '../src/agent/sdlc-state'
import { getAllMasterToolSpecs } from '../src/agent/skills/runtime-loader'
import { getSkillDefinition } from '../src/agent/skills/skills-tree'
import { SlmConcurrencyGate, procesarNodoScope } from '../src/llm/llm-client'
import { AgentScopeStorage, createIsolatedEngram } from '../src/memory/engram-memory'
import {
  createZipArchive,
  executeWebGuidanceTool,
  extractModernWebGuidanceFromZip,
  extractModernWebGuidanceRelativePath,
  getWebGuidanceStore,
  hasLoadedWebGuidanceDocs,
  readWebGuidanceDoc,
  resetWebGuidanceDatabase,
  resolveWebGuidancePath,
  searchWebGuidance,
  syncModernWebGuidance,
} from '../src/memory/web-guidance-manager'
import { checkForUpdates } from '../src/pwa-update'

console.log('--- Iniciando pruebas de Modern Web Guidance + engram-ts (Lunr + IndexedDB) ---')

const SAMPLE_FILES: Record<string, string> = {
  'GoogleChrome-modern-web-guidance-9f8e7d6/README.md':
    '# Root Repo Readme\nShould be ignored because it is outside skills/modern-web-guidance.',
  'GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/SKILL.md': `---
name: modern-web-guidance
description: Search tool for modern web development best practices.
---
# Modern Web Guidance Skill
Consulta [Popovers and Dialogs](./guides/html-dom/popovers-dialogs.md) y [CSS Layout](./guides/css/css-layout.md).
`,
  'GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/guides/html-dom/popovers-dialogs.md': `---
title: Popovers and Dialogs
tags: [html, dialog, popover, modal]
---
# Native Dialog and Popover API
Use \`<dialog>\` with \`showModal()\` for modal dialogs and the \`popover\` attribute for non-modal overlays.
See also [CSS Layout](../css/css-layout.md) and [Accessible Error Announcement](../accessibility/accessible-error-announcement.md).
`,
  'GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/guides/css/css-layout.md': `---
title: Modern CSS Layout and Container Queries
tags: [css, container-queries, subgrid, anchor-positioning]
---
# Container Queries and Subgrid
Use \`@container\` queries for component-driven responsive design and \`grid-template-columns: subgrid\` for nested alignment.
`,
  'GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/guides/accessibility/accessible-error-announcement.md': `---
title: Accessible Error Announcements
tags: [a11y, aria, forms]
---
# Accessible Form Validation
Associate error messages with \`aria-describedby\` and \`aria-invalid="true"\`.
`,
  'GoogleChrome-modern-web-guidance-9f8e7d6/skills/chrome-extensions/SKILL.md': `---
name: chrome-extensions
description: Build Chrome Extensions with Manifest V3.
---
# Chrome Extensions Skill
THIS MUST BE EXCLUDED FROM INDEXING.
`,
  'GoogleChrome-modern-web-guidance-9f8e7d6/skills/chrome-extensions/references/mv3-service-worker.md':
    '# MV3 Service Worker\nShould also be excluded.',
}

async function runTests() {
  await resetWebGuidanceDatabase()

  // Test 1: Path filtering & relative path resolution
  {
    assert.equal(
      extractModernWebGuidanceRelativePath(
        'GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/SKILL.md',
      ),
      'SKILL.md',
    )
    assert.equal(
      extractModernWebGuidanceRelativePath(
        'GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/guides/css/css-layout.md',
      ),
      'guides/css/css-layout.md',
    )
    assert.equal(
      extractModernWebGuidanceRelativePath(
        'GoogleChrome-modern-web-guidance-9f8e7d6/skills/chrome-extensions/SKILL.md',
      ),
      null,
      'Debe excluir chrome-extensions del árbol de skills',
    )
    assert.equal(
      extractModernWebGuidanceRelativePath('GoogleChrome-modern-web-guidance-9f8e7d6/README.md'),
      null,
      'Debe excluir archivos fuera de skills/modern-web-guidance',
    )

    assert.equal(
      resolveWebGuidancePath('../css/css-layout.md', 'guides/html-dom/popovers-dialogs.md'),
      'guides/css/css-layout.md',
      'Debe resolver referencias relativas "../" respecto al documento actual',
    )
    assert.equal(
      resolveWebGuidancePath('./guides/html-dom/popovers-dialogs.md', 'SKILL.md'),
      'guides/html-dom/popovers-dialogs.md',
      'Debe resolver referencias "./" desde SKILL.md',
    )
  }

  // Test 2: ZIP extraction excludes chrome-extensions and keeps relative paths
  {
    const zipBytes = createZipArchive(SAMPLE_FILES)
    const extracted = await extractModernWebGuidanceFromZip(zipBytes.buffer as ArrayBuffer)
    const paths = extracted.map((d) => d.relativePath).sort()

    assert.deepEqual(paths, [
      'SKILL.md',
      'guides/accessibility/accessible-error-announcement.md',
      'guides/css/css-layout.md',
      'guides/html-dom/popovers-dialogs.md',
    ])
    assert.ok(
      !paths.some((p) => p.includes('chrome-extensions')),
      'Ningún archivo de chrome-extensions debe ser extraído',
    )
  }

  // Test 2b: CORS-safe GitHub Git Trees API + raw.githubusercontent.com sync (excludes chrome-extensions, no zipball call)
  {
    await resetWebGuidanceDatabase()
    let gitTreeCalls = 0
    let rawCalls = 0
    let zipballCalls = 0

    const mockCorsSafeFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/releases/latest')) {
        return new Response(
          JSON.stringify({
            tag_name: 'v1.0.0',
            name: 'Release v1.0.0',
            zipball_url:
              'https://api.github.com/repos/GoogleChrome/modern-web-guidance/zipball/v1.0.0',
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/git/trees/v1.0.0?recursive=1')) {
        gitTreeCalls += 1
        return new Response(
          JSON.stringify({
            sha: '9f8e7d6',
            tree: [
              { path: 'README.md', type: 'blob' },
              { path: 'skills/modern-web-guidance/SKILL.md', type: 'blob' },
              {
                path: 'skills/modern-web-guidance/guides/html-dom/popovers-dialogs.md',
                type: 'blob',
              },
              { path: 'skills/modern-web-guidance/guides/css/css-layout.md', type: 'blob' },
              {
                path: 'skills/modern-web-guidance/guides/accessibility/accessible-error-announcement.md',
                type: 'blob',
              },
              { path: 'skills/chrome-extensions/SKILL.md', type: 'blob' },
              { path: 'skills/chrome-extensions/references/mv3-service-worker.md', type: 'blob' },
            ],
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (
        url.startsWith(
          'https://raw.githubusercontent.com/GoogleChrome/modern-web-guidance/v1.0.0/skills/modern-web-guidance/',
        )
      ) {
        rawCalls += 1
        const relPath = url.split('/skills/modern-web-guidance/')[1]
        const sampleKey = `GoogleChrome-modern-web-guidance-9f8e7d6/skills/modern-web-guidance/${relPath}`
        const content = SAMPLE_FILES[sampleKey]
        if (content) {
          return new Response(content, { status: 200 })
        }
      }
      if (url.includes('/zipball/')) {
        zipballCalls += 1
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    const syncTreeRes = await syncModernWebGuidance({ fetchImpl: mockCorsSafeFetch })
    assert.equal(syncTreeRes.updated, true)
    assert.equal(syncTreeRes.source, 'github-git-tree')
    assert.equal(syncTreeRes.version, 'v1.0.0')
    assert.equal(syncTreeRes.documentCount, 4)
    assert.equal(gitTreeCalls, 1, 'Debe consultar el árbol Git recursivo en una sola llamada')
    assert.equal(rawCalls, 4, 'Solo debe descargar los 4 archivos de modern-web-guidance')
    assert.equal(
      zipballCalls,
      0,
      'No debe invocar el endpoint zipball bloqueado por CORS cuando Git Trees API responde',
    )
    const extCheck = await readWebGuidanceDoc({ path: 'chrome-extensions/SKILL.md' })
    assert.equal(extCheck.found, false, 'chrome-extensions no debe haberse descargado ni indexado')
  }

  // Test 3: GitHub release version check, conditional ZIP download fallback, and engram-ts indexing by relative path
  {
    await resetWebGuidanceDatabase()
    assert.equal(hasLoadedWebGuidanceDocs(), false)

    const zipBytes = createZipArchive(SAMPLE_FILES)
    let releaseTag = 'v1.0.0'
    let releaseApiCalls = 0
    let zipDownloadCalls = 0

    const mockFetch: typeof fetch = (async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/releases/latest')) {
        releaseApiCalls += 1
        return new Response(
          JSON.stringify({
            tag_name: releaseTag,
            name: `Release ${releaseTag}`,
            published_at: '2026-05-01T10:00:00Z',
            zipball_url: `https://api.github.com/repos/GoogleChrome/modern-web-guidance/zipball/${releaseTag}`,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        )
      }
      if (url.includes('/zipball/')) {
        zipDownloadCalls += 1
        return new Response(zipBytes, {
          status: 200,
          headers: { 'Content-Type': 'application/zip' },
        })
      }
      return new Response('Not found', { status: 404 })
    }) as typeof fetch

    // 3a. Initial sync on app startup downloads and indexes v1.0.0
    const sync1 = await syncModernWebGuidance({ fetchImpl: mockFetch })
    assert.equal(sync1.updated, true)
    assert.equal(sync1.version, 'v1.0.0')
    assert.equal(sync1.documentCount, 4)
    assert.equal(sync1.source, 'github-release-zip')
    assert.equal(releaseApiCalls, 1)
    assert.equal(zipDownloadCalls, 1)
    assert.equal(hasLoadedWebGuidanceDocs(), true)
    const meta1 = await getWebGuidanceStore().getMetadata()
    assert.equal(meta1?.version, 'v1.0.0')

    // 3b. Subsequent sync when version has not changed skips ZIP download
    const sync2 = await syncModernWebGuidance({ fetchImpl: mockFetch })
    assert.equal(sync2.updated, false)
    assert.equal(sync2.version, 'v1.0.0')
    assert.equal(sync2.source, 'cache')
    assert.equal(releaseApiCalls, 2)
    assert.equal(zipDownloadCalls, 1, 'No debe volver a descargar el ZIP si la versión coincide')

    // 3c. Sync via Settings checkForUpdates when a new release v1.1.0 is published
    releaseTag = 'v1.1.0'
    const updateCheck = await checkForUpdates({ fetchImpl: mockFetch })
    assert.equal(updateCheck.webGuidanceSync?.updated, true)
    assert.equal(updateCheck.webGuidanceSync?.version, 'v1.1.0')
    assert.equal(updateCheck.webGuidanceSync?.source, 'github-release-zip')
    assert.equal(zipDownloadCalls, 2, 'Debe descargar el nuevo ZIP cuando cambia la versión')
  }

  // Test 4: search_web_guidance (Lunr index) & read_web_guidance_doc (relative path + basePath references)
  {
    const searchRes = await searchWebGuidance({ query: 'popover showModal dialog', limit: 5 })
    assert.ok(searchRes.results.length > 0, 'Lunr debe encontrar documentos por palabras clave')
    assert.equal(searchRes.results[0].path, 'guides/html-dom/popovers-dialogs.md')

    const toolSearchJson = JSON.parse(
      await executeWebGuidanceTool('search_web_guidance', {
        query: 'container queries subgrid',
        limit: 3,
      }),
    )
    assert.ok(toolSearchJson.count >= 1)
    assert.equal(toolSearchJson.results[0].path, 'guides/css/css-layout.md')

    // Direct read by relative path
    const dialogDoc = await readWebGuidanceDoc({ path: 'guides/html-dom/popovers-dialogs.md' })
    assert.equal(dialogDoc.found, true, 'Debe recuperar el documento por su ruta relativa')
    assert.equal(dialogDoc.path, 'guides/html-dom/popovers-dialogs.md')
    assert.ok(dialogDoc.content?.includes('showModal()'))
    assert.ok(
      dialogDoc.referencedPaths?.includes('guides/css/css-layout.md'),
      'Las referencias relativas en el markdown deben resolverse a rutas canónicas del índice',
    )
    assert.ok(
      dialogDoc.referencedPaths?.includes(
        'guides/accessibility/accessible-error-announcement.md',
      ),
    )

    // Relative read using basePath (following a link inside a guide)
    const toolRelativeReadJson = JSON.parse(
      await executeWebGuidanceTool('read_web_guidance_doc', {
        path: '../accessibility/accessible-error-announcement.md',
        basePath: 'guides/html-dom/popovers-dialogs.md',
      }),
    )
    assert.equal(toolRelativeReadJson.found, true)
    assert.equal(
      toolRelativeReadJson.path,
      'guides/accessibility/accessible-error-announcement.md',
    )
    assert.ok(toolRelativeReadJson.content.includes('aria-describedby'))

    // Confirm chrome-extensions is not present
    const extDoc = await readWebGuidanceDoc({ path: 'chrome-extensions/SKILL.md' })
    assert.equal(extDoc.found, false)
  }

  // Test 5: Skills Tree & Runtime Loader registration + SDLC iterative loop (2-3 iterations)
  {
    const masterSpecs = getAllMasterToolSpecs()
    assert.ok(masterSpecs.has('search_web_guidance'))
    assert.ok(masterSpecs.has('read_web_guidance_doc'))
    const designerSkill = getSkillDefinition('ComponentTechnical_Designer')
    const implementerSkill = getSkillDefinition('Component_Implementer')
    assert.ok(designerSkill?.allowedTools.includes('search_web_guidance'))
    assert.ok(implementerSkill?.allowedTools.includes('read_web_guidance_doc'))

    const state: SDLCStateType = {
      sessionId: 77,
      threadId: 'thread-web-guidance-sdlc',
      currentPhase: '3_COMPONENT_CONSTRUCTION',
      activeSkill: 'Component_Implementer',
      activeComponentId: 'comp_modal',
      discoveryInputValid: true,
      useCases: [],
      marketArchStandard: 'CLEAN_ARCHITECTURE',
      mcpServerConfig: { connected: false },
      componentsGraph: {},
      projectPlan: { milestones: [], backlog: [] },
      technicalDesigns: {},
      gatekeeperDecisions: {},
      technicalDebtList: [],
      unitEvidences: {},
      e2eEvidences: null,
      businessApproval: null,
      rcaDiagnosis: null,
      progressEvents: [],
      discoveryCompleted: true,
      messages: [],
      pendingToolCalls: [],
      turnsUsed: 0,
      maxTurns: 20,
    }

    let llmCalls = 0
    const observedMessagesCount: number[] = []
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      llmCalls += 1
      const body = init?.body ? JSON.parse(String(init.body)) : {}
      observedMessagesCount.push(Array.isArray(body.messages) ? body.messages.length : 0)

      let sse = ''
      if (llmCalls === 1) {
        const args = JSON.stringify({ query: 'popover dialog showModal', limit: 2 })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_wg_search","function":{"name":"search_web_guidance","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else if (llmCalls === 2) {
        const args = JSON.stringify({ path: 'guides/html-dom/popovers-dialogs.md' })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_wg_read","function":{"name":"read_web_guidance_doc","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else {
        sse = [
          'data: {"choices":[{"delta":{"content":"Implementado con <dialog> y showModal() según la guía oficial."}}]}\n\n',
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
      const phaseRes = await streamLlmPhase({
        sessionId: state.sessionId,
        phaseName: 'Fase 3: Construcción de Componente',
        sdlcPhase: '3_COMPONENT_CONSTRUCTION',
        systemPrompt: 'Eres un implementador frontend.',
        userPrompt: 'Construye el diálogo modal accesible.',
        maxToolIterations: 3,
        defaultFallback: () => ({ content: 'fallback' }),
      })

      assert.equal(llmCalls, 3, 'Debe ejecutar 3 iteraciones (search -> read -> respuesta final)')
      assert.ok(phaseRes.content.includes('showModal()'))
      assert.equal(phaseRes.toolCalls.length, 2)
      assert.ok(
        observedMessagesCount[1] > observedMessagesCount[0],
        'La segunda iteración debe recibir el resultado de search_web_guidance',
      )
      assert.ok(
        observedMessagesCount[2] > observedMessagesCount[1],
        'La tercera iteración debe recibir el documento de read_web_guidance_doc',
      )
    } finally {
      globalThis.fetch = originalFetch
    }
  }

  // Test 6: procesarNodoScope (Sub-Agente Fractal) iterative loop (search -> read -> ejecutar_tarea_atomica)
  {
    const engram = createIsolatedEngram()
    const storage = new AgentScopeStorage({
      engram,
      project: 'session-wg-scope',
      filePath: 'src/ui/modal.ts',
      scopeId: 'scope_modal_ui',
    })

    let scopeLlmCalls = 0
    const originalFetch = globalThis.fetch

    globalThis.fetch = (async () => {
      scopeLlmCalls += 1
      let sse = ''
      if (scopeLlmCalls === 1) {
        const args = JSON.stringify({ query: 'dialog popover', limit: 2 })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"sub_wg_1","function":{"name":"search_web_guidance","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else if (scopeLlmCalls === 2) {
        const args = JSON.stringify({ path: 'guides/html-dom/popovers-dialogs.md' })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"sub_wg_2","function":{"name":"read_web_guidance_doc","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
          'data: [DONE]\n\n',
        ].join('')
      } else {
        const args = JSON.stringify({
          skill_a_usar: 'skill_coder',
          argumentos: {
            foco: 'modal_dialog',
            tarea_realizada: '<dialog id="app-modal"><p>Contenido</p></dialog>',
            prueba_automatizada:
              'const html = "<dialog id=\\"app-modal\\"></dialog>"; if (!html.includes("<dialog")) throw new Error("Falta dialog"); return true;',
            modo_sandbox: 'js',
            evidencia_prueba: 'Verificado uso de <dialog> nativo conforme a modern-web-guidance.',
            sumario_ejecutivo: 'Modal nativo implementado tras consultar modern-web-guidance.',
            findings: [],
          },
        })
        sse = [
          `data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"sub_atomic","function":{"name":"ejecutar_tarea_atomica","arguments":${JSON.stringify(args)}}}]}}]}\n\n`,
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
      const result = await procesarNodoScope(
        {
          id_subtarea: 'task_modal_ui',
          descripcion: 'Implementar componente modal siguiendo modern-web-guidance',
          prueba_aceptacion: 'Debe emplear <dialog> nativo',
          skill_requerida: 'skill_coder',
        },
        storage,
        {
          targetPath: 'src/ui/modal.ts',
          codeContent: '',
          baseInstructions: 'Usa modern-web-guidance antes de implementar UI.',
          maxDepth: 1,
          maxConcurrency: 1,
          concurrencyGate: new SlmConcurrencyGate(1),
          enableWebGuidance: true,
        },
        false,
      )

      assert.equal(
        scopeLlmCalls,
        3,
        'El sub-agente debe iterar (search -> read -> ejecutar_tarea_atomica) en máx 3 pasos',
      )
      assert.ok(result.entregable_atomico?.tarea_realizada.includes('<dialog'))
      assert.equal(result.entregable_atomico?.evidencia_prueba.exito, true)
    } finally {
      globalThis.fetch = originalFetch
      await resetWebGuidanceDatabase()
    }
  }

  // Test 7: Cuando requireLiveLlm está activo y el LLM local está desconectado, no avanza silenciosamente al HITL
  {
    const originalFetch = globalThis.fetch
    globalThis.fetch = (async () => {
      throw new Error('fetch failed: ECONNREFUSED 127.0.0.1:11434')
    }) as typeof fetch

    setRequireLiveLlm(true)
    try {
      await assert.rejects(
        async () => {
          await compiledSDLCGraph.invoke(
            {
              sessionId: 999,
              threadId: `thread-offline-llm-${Date.now()}`,
              discoveryInputValid: true,
              marketArchStandard: 'CLEAN_ARCHITECTURE',
              useCases: [
                {
                  id: 'UC-1',
                  title: 'Caso de prueba',
                  actor: 'Usuario',
                  happyPath: ['Paso 1'],
                  exceptions: [],
                  expectedBusinessOutcome: 'Éxito',
                  acceptanceCriteriaGherkin: 'Given X When Y Then Z',
                },
              ],
            },
            { configurable: { thread_id: `thread-offline-llm-${Date.now()}` } },
          )
        },
        /No se pudo conectar con el servidor LLM local/,
        'Debe detenerse y lanzar error claro si el LLM local está desconectado en sesión real',
      )
    } finally {
      setRequireLiveLlm(false)
      globalThis.fetch = originalFetch
    }
  }

  console.log(
    '✅ Todas las pruebas de Modern Web Guidance + engram-ts pasaron correctamente.',
  )
}

runTests().catch((err) => {
  console.error('❌ Error en tests/web-guidance-tools.test.ts:', err)
  process.exit(1)
})
