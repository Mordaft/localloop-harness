import { heroIcon } from '../config/heroicons'
import { getTraceEntries } from '../diagnostics'
import { FileProposalStatus } from '../enums'
import { approveAndApplyFileProposal, rejectFileProposal } from '../fs/fs-tools'
import {
  getWorkspaceDirectoryHandle,
  listWorkspaceFiles,
  pickWorkspaceDirectory,
  readWorkspaceFile,
  restoreSavedWorkspaceDirectory,
} from '../fs/workspace-fs'
import { t, translateStatus } from '../i18n'
import {
  getSessionById,
  listFileProposals,
  listSessionMessages,
  updateSessionMetrics,
  type StoredChatMessage,
  type StoredFileWriteProposal,
} from '../memory/app-db'
import {
  executeBrowserSandbox,
  executeSandboxedJs,
  getLastBrowserSandboxResult,
} from '../sandbox/code-runner'
import {
  cancelAgentSession,
  getSessionThinkingState,
  isSessionRunning,
  runAgentSessionTurn,
  syncWorkerEnvironment,
} from '../worker/agent-bridge'
import { bindLangToggle, renderLangToggle, renderSidebar, statusClass, toggleTheme } from './shared'

type InspectorTab = 'proposals' | 'tools' | 'preview'
let activeInspectorTab: InspectorTab = 'proposals'
let selectedFilePath = ''
let selectedFileContent = ''
let sandboxOutput = ''
let browserSandboxHtmlInput = '<div id="card" class="box"><h2>Hola LocalLoop</h2><button id="btn">Incrementar</button><span id="count">0</span></div>'
let browserSandboxCodeInput = `const btn = document.getElementById('btn');
const count = document.getElementById('count');
btn.addEventListener('click', () => { count.textContent = String(Number(count.textContent) + 1); });
btn.click();
console.log('Nuevo contador:', count.textContent);
return count.textContent;`
let browserSandboxSelectorInput = '#card, #count'

function escapeHtml(raw: string): string {
  return raw
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

function renderMessageItem(msg: StoredChatMessage): string {
  if (msg.role === 'user') {
    return `
      <div class="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-3 text-xs text-white shadow-sm">
        <p class="whitespace-pre-wrap leading-relaxed">${escapeHtml(msg.content)}</p>
      </div>
    `
  }

  if (msg.role === 'tool') {
    return `
      <div class="rounded-xl border border-border-default bg-bg-app/80 px-3.5 py-2.5 font-mono text-[11px] text-text-secondary">
        <div class="flex items-center gap-2 text-accent">
          ${heroIcon('wrench-screwdriver', 'h-3.5 w-3.5')}
          <span class="font-semibold">${escapeHtml(msg.toolName ?? 'tool')}</span>
        </div>
        <pre class="mt-1.5 max-h-36 overflow-auto whitespace-pre-wrap text-[10px] text-text-muted">${escapeHtml(msg.content)}</pre>
      </div>
    `
  }

  return `
    <div class="max-w-[92%] rounded-2xl rounded-bl-sm border border-border-default bg-bg-card px-4 py-3 text-xs text-text-primary shadow-sm space-y-2">
      ${
        msg.thought
          ? `
            <details class="rounded-lg border border-primary/20 bg-primary/5 px-3 py-1.5 text-[11px] text-text-secondary">
              <summary class="cursor-pointer font-semibold text-primary select-none">Razonamiento interno (&lt;think&gt;)</summary>
              <pre class="mt-1.5 whitespace-pre-wrap font-mono text-[10px] text-text-muted">${escapeHtml(msg.thought)}</pre>
            </details>
          `
          : ''
      }
      <div class="whitespace-pre-wrap leading-relaxed">${escapeHtml(msg.content)}</div>
    </div>
  `
}

function renderProposalCard(proposal: StoredFileWriteProposal): string {
  const i18n = t()
  const isPending = proposal.status === FileProposalStatus.PENDING
  const isApplied = proposal.status === FileProposalStatus.APPLIED

  const badgeClass = isPending
    ? 'bg-warning/15 text-warning border-warning/30'
    : isApplied
      ? 'bg-accent/15 text-accent border-accent/30'
      : 'bg-red-500/15 text-red-500 border-red-500/30'

  const badgeLabel = isPending
    ? i18n.workspace.pendingBadge
    : isApplied
      ? i18n.workspace.appliedBadge
      : i18n.workspace.rejectedBadge

  return `
    <div class="rounded-xl border border-border-default bg-bg-app p-3.5 space-y-2.5">
      <div class="flex items-start justify-between gap-2">
        <div class="min-w-0">
          <p class="truncate font-mono text-xs font-semibold text-text-primary">${escapeHtml(proposal.path)}</p>
          <p class="text-[11px] text-text-secondary">${escapeHtml(proposal.reason)}</p>
        </div>
        <span class="shrink-0 rounded border px-2 py-0.5 text-[10px] font-semibold ${badgeClass}">
          ${badgeLabel}
        </span>
      </div>

      <pre class="max-h-44 overflow-auto rounded-lg border border-border-subtle bg-bg-card p-2.5 font-mono text-[10px] text-text-secondary">${escapeHtml(proposal.proposedContent)}</pre>

      ${
        isPending && proposal.id
          ? `
            <div class="flex items-center gap-2 pt-1">
              <button data-approve-proposal="${proposal.id}" class="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-slate-950 transition hover:opacity-95">
                ${heroIcon('check-circle', 'h-3.5 w-3.5')}
                <span>${i18n.workspace.approveWriteBtn}</span>
              </button>
              <button data-reject-proposal="${proposal.id}" class="inline-flex items-center justify-center gap-1 rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs font-medium text-text-secondary transition hover:border-red-500/40 hover:text-red-500">
                <span>${i18n.workspace.rejectWriteBtn}</span>
              </button>
            </div>
          `
          : ''
      }
    </div>
  `
}

export async function renderAgentWorkspace(
  root: HTMLElement,
  sessionId: number,
  rerender: () => void,
): Promise<void> {
  await restoreSavedWorkspaceDirectory()
  const [session, messages, proposals, files] = await Promise.all([
    getSessionById(sessionId),
    listSessionMessages(sessionId),
    listFileProposals(sessionId),
    listWorkspaceFiles(),
  ])

  const i18n = t()
  if (!session) {
    window.location.hash = '#/sessions'
    return
  }

  const handle = getWorkspaceDirectoryHandle()
  const running = isSessionRunning(sessionId)
  const thinkingState = getSessionThinkingState(sessionId)
  const pendingProposalsCount = proposals.filter(
    (p) => p.status === FileProposalStatus.PENDING,
  ).length
  const traces = getTraceEntries().slice(-25).reverse()

  root.innerHTML = `
    <div class="flex h-screen overflow-hidden bg-bg-app text-text-primary">
      ${renderSidebar('sessions')}

      <div class="flex flex-1 flex-col overflow-hidden">
        <!-- Top Header -->
        <header class="flex shrink-0 items-center justify-between border-b border-border-default bg-bg-app/90 px-6 py-3.5">
          <div class="flex items-center gap-3 min-w-0">
            <a href="#/sessions" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-card px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary">
              ${heroIcon('arrow-left', 'h-3.5 w-3.5')}
              <span>${i18n.common.backToSessions}</span>
            </a>
            <div class="min-w-0">
              <div class="flex items-center gap-2">
                <h1 class="truncate font-display text-base font-bold text-text-primary">${escapeHtml(session.title)}</h1>
                <span class="rounded-md px-2 py-0.5 text-[10px] font-semibold ${statusClass(session.status)}">
                  ${translateStatus(session.status)}
                </span>
              </div>
              <p class="truncate text-[11px] text-text-muted">${escapeHtml(session.goal)}</p>
            </div>
          </div>

          <div class="flex items-center gap-3">
            <div class="hidden sm:flex items-center gap-3 rounded-xl border border-border-default bg-bg-card px-3 py-1.5 text-xs">
              <span class="text-text-muted">${i18n.workspace.turnsBudgetLabel}: <strong class="font-mono text-primary">${session.turnsUsed}/${session.maxTurns}</strong></span>
              <span class="text-border-default">|</span>
              <span class="text-text-muted">${i18n.workspace.tokensBudgetLabel}: <strong class="font-mono text-accent">${session.tokensUsed}/${session.maxTokenBudget}</strong></span>
            </div>
            ${renderLangToggle()}
            <button id="theme-toggle" class="rounded-lg border border-border-default bg-bg-card p-2 text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary" title="${i18n.common.toggleTheme}">
              ${heroIcon('sun-moon', 'h-4 w-4')}
            </button>
          </div>
        </header>

        <!-- 3-Column Workspace Body -->
        <div class="grid flex-1 grid-cols-12 overflow-hidden">
          <!-- Column 1: Local File System Tree -->
          <section class="col-span-3 flex flex-col border-r border-border-default bg-bg-sidebar/50 overflow-hidden">
            <div class="flex items-center justify-between border-b border-border-default px-4 py-3">
              <div class="flex items-center gap-2 min-w-0">
                ${heroIcon('folder-open', 'h-4 w-4 text-primary shrink-0')}
                <span class="truncate text-xs font-semibold text-text-primary">
                  ${handle ? escapeHtml(handle.name) : i18n.workspace.filesPanelTitle}
                </span>
              </div>
              <button id="workspace-pick-dir-btn" class="rounded-lg border border-border-default bg-bg-card px-2 py-1 text-[11px] font-medium text-primary hover:bg-bg-elevated">
                ${handle ? i18n.workspace.relinkFolderBtn : i18n.workspace.linkFolderBtn}
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-3 space-y-1">
              ${
                files.length > 0
                  ? files
                      .map(
                        (f) => `
                        <button
                          data-open-file="${escapeHtml(f.path)}"
                          class="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left font-mono text-xs transition ${
                            selectedFilePath === f.path
                              ? 'bg-primary/15 text-primary font-semibold'
                              : 'text-text-secondary hover:bg-bg-elevated hover:text-text-primary'
                          }"
                        >
                          ${heroIcon('document-text', 'h-3.5 w-3.5 shrink-0 text-text-muted')}
                          <span class="truncate">${escapeHtml(f.path)}</span>
                        </button>
                      `,
                      )
                      .join('')
                  : `
                    <div class="rounded-xl border border-dashed border-border-default p-4 text-center">
                      <p class="text-xs font-semibold text-text-primary">${i18n.workspace.noFolderLinked}</p>
                      <p class="mt-1 text-[11px] text-text-muted">${i18n.workspace.noFolderLinkedHint}</p>
                    </div>
                  `
              }
            </div>
          </section>

          <!-- Column 2: Chat & LangGraph Loop -->
          <section class="col-span-5 flex flex-col border-r border-border-default bg-bg-app overflow-hidden">
            <div class="flex items-center justify-between border-b border-border-default px-4 py-3">
              <div class="flex items-center gap-2">
                ${heroIcon('bolt', 'h-4 w-4 text-primary')}
                <span class="text-xs font-semibold text-text-primary">${i18n.workspace.chatPanelTitle}</span>
              </div>
              <span class="font-mono text-[11px] text-text-muted">${escapeHtml(session.threadId)}</span>
            </div>

            <div id="chat-messages-scroll" class="flex-1 overflow-y-auto p-4 space-y-3">
              ${messages.map((m) => renderMessageItem(m)).join('')}

              <div data-thinking-pill="${sessionId}" class="${
                thinkingState?.isThinking ? 'flex' : 'hidden'
              } items-center gap-2 rounded-xl border border-primary/30 bg-primary/10 px-3 py-2 text-xs text-primary">
                <span class="h-2 w-2 rounded-full bg-primary animate-ping"></span>
                <span data-thinking-phase="${sessionId}" class="font-semibold">${i18n.sessions.card.agentThinking}:</span>
                <span data-thinking-text="${sessionId}" class="truncate font-mono text-[11px] text-text-secondary">${escapeHtml(
                  thinkingState?.thought ?? '',
                )}</span>
              </div>
            </div>

            <form id="chat-prompt-form" class="border-t border-border-default bg-bg-card p-3">
              <div class="flex items-end gap-2">
                <textarea
                  id="chat-prompt-input"
                  rows="2"
                  placeholder="${i18n.workspace.promptPlaceholder}"
                  class="flex-1 resize-none rounded-xl border border-border-default bg-bg-app px-3 py-2 text-xs text-text-primary outline-none focus:border-primary"
                ></textarea>
                ${
                  running
                    ? `
                      <button type="button" id="stop-agent-btn" class="inline-flex items-center gap-1.5 rounded-xl bg-red-500 px-3.5 py-2 text-xs font-semibold text-white hover:opacity-95">
                        ${heroIcon('stop', 'h-4 w-4')}
                        <span>${i18n.common.stop}</span>
                      </button>
                    `
                    : `
                      <button type="submit" class="inline-flex items-center gap-1.5 rounded-xl bg-primary px-4 py-2 text-xs font-semibold text-white shadow-sm hover:opacity-95">
                        ${heroIcon('play', 'h-4 w-4')}
                        <span>${i18n.common.send}</span>
                      </button>
                    `
                }
              </div>
            </form>
          </section>

          <!-- Column 3: Inspector (Proposals / Tools / File Preview) -->
          <section class="col-span-4 flex flex-col bg-bg-sidebar/40 overflow-hidden">
            <div class="flex items-center gap-1 border-b border-border-default px-3 py-2">
              <button data-inspector-tab="proposals" class="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                activeInspectorTab === 'proposals'
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:bg-bg-elevated'
              }">
                ${i18n.workspace.tabProposals} (${pendingProposalsCount})
              </button>
              <button data-inspector-tab="tools" class="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                activeInspectorTab === 'tools'
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:bg-bg-elevated'
              }">
                ${i18n.workspace.tabTools}
              </button>
              <button data-inspector-tab="preview" class="rounded-lg px-2.5 py-1.5 text-xs font-semibold transition ${
                activeInspectorTab === 'preview'
                  ? 'bg-primary text-white'
                  : 'text-text-secondary hover:bg-bg-elevated'
              }">
                ${i18n.workspace.tabPreview}
              </button>
            </div>

            <div class="flex-1 overflow-y-auto p-4 space-y-3">
              ${
                activeInspectorTab === 'proposals'
                  ? proposals.length > 0
                    ? proposals.map((p) => renderProposalCard(p)).join('')
                    : `<p class="rounded-xl border border-dashed border-border-default p-6 text-center text-xs text-text-muted">${i18n.workspace.emptyProposals}</p>`
                  : ''
              }

              ${
                activeInspectorTab === 'tools'
                  ? (() => {
                      const lastIframeRes = getLastBrowserSandboxResult()
                      return `
                    <div class="rounded-xl border border-border-default bg-bg-card p-3.5 space-y-2.5">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-text-primary">Sandbox Navegador (Iframe DOM + Captura)</span>
                        <button id="run-browser-sandbox-btn" class="rounded-lg bg-accent px-2.5 py-1 text-[11px] font-semibold text-slate-950">
                          Probar en Iframe
                        </button>
                      </div>
                      <div class="space-y-1.5">
                        <label class="block text-[10px] font-semibold uppercase text-text-muted">HTML del Iframe</label>
                        <textarea id="browser-sandbox-html" rows="2" class="w-full rounded-lg border border-border-default bg-bg-app p-2 font-mono text-[11px] text-text-primary">${escapeHtml(browserSandboxHtmlInput)}</textarea>
                        <label class="block text-[10px] font-semibold uppercase text-text-muted">Prueba JS (DOM / Eventos)</label>
                        <textarea id="browser-sandbox-code" rows="3" class="w-full rounded-lg border border-border-default bg-bg-app p-2 font-mono text-[11px] text-text-primary">${escapeHtml(browserSandboxCodeInput)}</textarea>
                        <label class="block text-[10px] font-semibold uppercase text-text-muted">Selector CSS a consultar</label>
                        <input id="browser-sandbox-selector" value="${escapeHtml(browserSandboxSelectorInput)}" class="w-full rounded-lg border border-border-default bg-bg-app px-2 py-1 font-mono text-[11px] text-text-primary" />
                      </div>
                      ${
                        lastIframeRes
                          ? `
                            <div class="space-y-2 pt-1">
                              <div class="flex items-center justify-between text-[11px]">
                                <span class="font-semibold ${lastIframeRes.ok ? 'text-accent' : 'text-red-500'}">
                                  ${lastIframeRes.ok ? '✓ Ejecución Iframe OK' : '✗ Error en Iframe'} (${lastIframeRes.durationMs}ms)
                                </span>
                                <span class="font-mono text-[10px] text-text-muted">Elementos: ${lastIframeRes.dom.queriedElements.length}</span>
                              </div>
                              ${
                                lastIframeRes.screenshotDataUrl
                                  ? `
                                    <div class="space-y-1">
                                      <p class="text-[10px] font-semibold uppercase text-text-muted">Captura del área renderizada</p>
                                      <img src="${lastIframeRes.screenshotDataUrl}" alt="Captura del Sandbox Iframe" class="max-h-40 w-full rounded-lg border border-border-default bg-white object-contain" />
                                    </div>
                                  `
                                  : ''
                              }
                              <pre class="max-h-40 overflow-auto rounded-lg border border-border-subtle bg-bg-app p-2 font-mono text-[10px] text-text-secondary">${escapeHtml(
                                JSON.stringify(
                                  {
                                    logs: lastIframeRes.logs,
                                    returnValue: lastIframeRes.returnValue,
                                    domText: lastIframeRes.dom.text,
                                    queriedElements: lastIframeRes.dom.queriedElements.map((el) => ({
                                      selector: el.selector,
                                      tag: el.tagName,
                                      text: el.textContent,
                                      rect: el.rect,
                                    })),
                                  },
                                  null,
                                  2,
                                ),
                              )}</pre>
                            </div>
                          `
                          : ''
                      }
                    </div>

                    <div class="rounded-xl border border-border-default bg-bg-card p-3.5 space-y-2.5">
                      <div class="flex items-center justify-between">
                        <span class="text-xs font-semibold text-text-primary">Sandbox JS Worker (Aislado)</span>
                        <button id="run-sandbox-demo-btn" class="rounded-lg bg-primary px-2.5 py-1 text-[11px] font-semibold text-white">
                          ${i18n.workspace.runSandboxBtn}
                        </button>
                      </div>
                      <textarea id="sandbox-code-input" rows="3" class="w-full rounded-lg border border-border-default bg-bg-app p-2 font-mono text-[11px] text-text-primary">console.log("LocalLoop Sandbox OK"); return 21 * 2;</textarea>
                      ${
                        sandboxOutput
                          ? `<pre class="rounded-lg border border-border-subtle bg-bg-app p-2 font-mono text-[10px] text-accent">${escapeHtml(sandboxOutput)}</pre>`
                          : ''
                      }
                    </div>

                    <div class="space-y-1.5">
                      <p class="text-xs font-semibold text-text-secondary">Trazas recientes del arnés</p>
                      ${
                        traces.length > 0
                          ? traces
                              .map(
                                (tr) => `
                                <div class="rounded-lg border border-border-default bg-bg-card px-3 py-2 font-mono text-[10px]">
                                  <div class="flex justify-between text-primary">
                                    <span>${escapeHtml(tr.step)}</span>
                                  <span class="text-text-muted">+${tr.elapsedMs}ms</span>
                                  </div>
                                  ${
                                    tr.detail
                                      ? `<pre class="mt-1 overflow-x-auto text-text-secondary">${escapeHtml(JSON.stringify(tr.detail))}</pre>`
                                      : ''
                                  }
                                </div>
                              `,
                              )
                              .join('')
                          : `<p class="text-xs text-text-muted">${i18n.workspace.emptyTools}</p>`
                      }
                    </div>
                  `
                    })()
                  : ''
              }

              ${
                activeInspectorTab === 'preview'
                  ? selectedFilePath
                    ? `
                      <div class="space-y-2">
                        <p class="font-mono text-xs font-semibold text-primary">${escapeHtml(selectedFilePath)}</p>
                        <pre class="max-h-[70vh] overflow-auto rounded-xl border border-border-default bg-bg-card p-3 font-mono text-[11px] text-text-secondary">${escapeHtml(selectedFileContent)}</pre>
                      </div>
                    `
                    : `<p class="rounded-xl border border-dashed border-border-default p-6 text-center text-xs text-text-muted">Selecciona un archivo del árbol izquierdo para inspeccionarlo.</p>`
                  : ''
              }
            </div>
          </section>
        </div>
      </div>
    </div>
  `

  bindLangToggle(rerender)
  root.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', toggleTheme)

  const chatScroll = root.querySelector<HTMLElement>('#chat-messages-scroll')
  if (chatScroll) {
    chatScroll.scrollTop = chatScroll.scrollHeight
  }

  root.querySelector<HTMLButtonElement>('#workspace-pick-dir-btn')?.addEventListener('click', async () => {
    try {
      const picked = await pickWorkspaceDirectory()
      if (picked) {
        await updateSessionMetrics(sessionId, { workspaceName: picked.name })
        syncWorkerEnvironment()
        rerender()
      }
    } catch (err) {
      console.warn('[FS] Directory picker cancelled:', err)
    }
  })

  root.querySelectorAll<HTMLButtonElement>('[data-open-file]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const path = btn.dataset.openFile
      if (!path) return
      try {
        const res = await readWorkspaceFile(path, 1, 300)
        selectedFilePath = path
        selectedFileContent = res.numberedContent
        activeInspectorTab = 'preview'
        rerender()
      } catch (err) {
        selectedFilePath = path
        selectedFileContent = err instanceof Error ? err.message : String(err)
        activeInspectorTab = 'preview'
        rerender()
      }
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-inspector-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      activeInspectorTab = (btn.dataset.inspectorTab as InspectorTab) || 'proposals'
      rerender()
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-approve-proposal]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.approveProposal)
      if (!id) return
      await approveAndApplyFileProposal(id)
      rerender()
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-reject-proposal]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.rejectProposal)
      if (!id) return
      await rejectFileProposal(id)
      rerender()
    })
  })

  root.querySelector<HTMLButtonElement>('#run-browser-sandbox-btn')?.addEventListener('click', async () => {
    const htmlEl = root.querySelector<HTMLTextAreaElement>('#browser-sandbox-html')
    const codeEl = root.querySelector<HTMLTextAreaElement>('#browser-sandbox-code')
    const selEl = root.querySelector<HTMLInputElement>('#browser-sandbox-selector')
    browserSandboxHtmlInput = htmlEl?.value ?? ''
    browserSandboxCodeInput = codeEl?.value ?? ''
    browserSandboxSelectorInput = selEl?.value ?? ''
    await executeBrowserSandbox({
      html: browserSandboxHtmlInput,
      code: browserSandboxCodeInput,
      domSelector: browserSandboxSelectorInput,
      captureScreenshot: true,
    })
    rerender()
  })

  root.querySelector<HTMLButtonElement>('#run-sandbox-demo-btn')?.addEventListener('click', async () => {
    const codeEl = root.querySelector<HTMLTextAreaElement>('#sandbox-code-input')
    const code = codeEl?.value ?? ''
    const res = await executeSandboxedJs(code, 3000)
    sandboxOutput = JSON.stringify(res, null, 2)
    rerender()
  })

  root.querySelector<HTMLButtonElement>('#stop-agent-btn')?.addEventListener('click', () => {
    cancelAgentSession(sessionId)
    rerender()
  })

  root.querySelector<HTMLFormElement>('#chat-prompt-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const input = root.querySelector<HTMLTextAreaElement>('#chat-prompt-input')
    const text = input?.value.trim() ?? ''
    if (!text) return
    input!.value = ''
    void runAgentSessionTurn(sessionId, text)
    rerender()
  })
}
