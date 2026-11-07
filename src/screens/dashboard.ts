import { heroIcon } from '../config/heroicons'
import { SessionStatus } from '../enums'
import {
  getWorkspaceDirectoryHandle,
  pickWorkspaceDirectory,
  restoreSavedWorkspaceDirectory,
} from '../fs/workspace-fs'
import { formatText, formatUpdatedTime, t, translateStatus } from '../i18n'
import {
  createSession,
  deleteSession,
  getDashboardKpis,
  listSessions,
  updateSessionMetrics,
  type AgentSession,
} from '../memory/app-db'
import {
  cancelAgentSession,
  getSessionThinkingState,
  isSessionRunning,
  runAgentSessionTurn,
  syncWorkerEnvironment,
} from '../worker/agent-bridge'
import { bindLangToggle, renderLangToggle, renderSidebar, statusClass, toggleTheme } from './shared'

type SessionTab = 'active' | 'completed'
let currentTab: SessionTab = 'active'

function renderThinkingPill(sessionId: number): string {
  const i18n = t()
  const state = getSessionThinkingState(sessionId)
  const isThinking = Boolean(state?.isThinking)
  const rawThought = state?.thought ?? ''
  const snippet =
    rawThought.length > 90 ? `…${rawThought.slice(-90)}` : rawThought || i18n.sessions.card.agentThinking

  const phaseLabel =
    state?.phase === 'executing_tools'
      ? `${i18n.sessions.card.executingTools} (${state.activeTool ?? 'tool'})`
      : i18n.sessions.card.agentThinking

  return `
    <div data-thinking-pill="${sessionId}" class="${isThinking ? 'mt-2.5 flex' : 'hidden'} items-center gap-2 rounded-lg border border-primary/25 bg-primary/10 px-2.5 py-1.5 text-xs text-primary transition-all">
      <span class="relative flex h-2 w-2 shrink-0">
        <span class="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary opacity-75"></span>
        <span class="relative inline-flex h-2 w-2 rounded-full bg-primary"></span>
      </span>
      <span data-thinking-phase="${sessionId}" class="shrink-0 font-semibold">${phaseLabel}:</span>
      <span data-thinking-text="${sessionId}" class="truncate font-mono text-[11px] text-text-secondary">${snippet.replace(/</g, '&lt;')}</span>
    </div>
  `
}

export function updateThinkingPillInDom(sessionId: number): void {
  const pill = document.querySelector<HTMLElement>(`[data-thinking-pill="${sessionId}"]`)
  if (!pill) return

  const i18n = t()
  const state = getSessionThinkingState(sessionId)
  if (!state?.isThinking) {
    pill.classList.add('hidden')
    pill.classList.remove('flex')
    return
  }

  pill.classList.remove('hidden')
  pill.classList.add('flex')

  const phaseEl = pill.querySelector<HTMLElement>(`[data-thinking-phase="${sessionId}"]`)
  const textEl = pill.querySelector<HTMLElement>(`[data-thinking-text="${sessionId}"]`)
  if (phaseEl) {
    phaseEl.textContent =
      state.phase === 'executing_tools'
        ? `${i18n.sessions.card.executingTools} (${state.activeTool ?? 'tool'}):`
        : `${i18n.sessions.card.agentThinking}:`
  }
  if (textEl) {
    const raw = state.thought.trim()
    textEl.textContent = raw.length > 90 ? `…${raw.slice(-90)}` : raw || i18n.sessions.card.agentThinking
  }
}

function renderSessionCard(session: AgentSession): string {
  const i18n = t()
  const id = session.id ?? 0
  const running = isSessionRunning(id)
  const isCompleted =
    session.status === SessionStatus.COMPLETED || session.status === SessionStatus.BUDGET_EXCEEDED
  const progressPct =
    session.maxTurns > 0
      ? Math.min(100, Math.round((session.turnsUsed / session.maxTurns) * 100))
      : 0

  return `
    <article
      data-session-card="${id}"
      class="group relative flex flex-col justify-between rounded-xl border border-border-default bg-bg-card p-5 transition hover:border-primary/40 hover:bg-bg-elevated/60"
    >
      <div>
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0 flex-1">
            <div class="flex flex-wrap items-center gap-2">
              <span class="rounded-md px-2 py-0.5 text-[11px] font-semibold ${statusClass(session.status)}">
                ${translateStatus(session.status)}
              </span>
              <span class="rounded-md border border-border-default bg-bg-app px-2 py-0.5 font-mono text-[11px] text-text-secondary">
                ${session.skill}
              </span>
              <span class="inline-flex items-center gap-1 text-xs text-text-muted">
                ${heroIcon('folder-open', 'h-3.5 w-3.5 text-primary')}
                ${session.workspaceName}
              </span>
            </div>
            <a href="#/sessions/${id}" class="mt-2 block font-display text-base font-bold text-text-primary transition group-hover:text-primary">
              ${session.title}
            </a>
            <p class="mt-1 line-clamp-2 text-xs text-text-secondary">${session.goal}</p>
          </div>

          <div class="flex items-center gap-1.5">
            ${isCompleted && !running
      ? `<button data-reopen-session="${id}" class="rounded-lg border border-border-default bg-bg-app px-2.5 py-1.5 text-xs font-medium text-text-secondary transition hover:border-primary/40 hover:text-primary" title="${i18n.common.reopen}">
                    ${i18n.common.reopen}
                  </button>`
      : ''
    }
            <button
              data-delete-session="${id}"
              class="rounded-lg border border-border-default bg-bg-app p-1.5 text-text-muted transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-500"
              title="${i18n.common.delete}"
            >
              ${heroIcon('trash', 'h-4 w-4')}
            </button>
          </div>
        </div>

        ${renderThinkingPill(id)}
      </div>

      <div class="mt-4 border-t border-border-subtle pt-3">
        <div class="mb-1.5 flex items-center justify-between text-xs text-text-muted">
          <span>${formatText(i18n.sessions.card.turnsCount, { used: session.turnsUsed, max: session.maxTurns, tokens: session.tokensUsed })}</span>
          <span class="font-mono text-[11px]">${formatUpdatedTime(session.updated)}</span>
        </div>
        <div class="h-1.5 w-full overflow-hidden rounded-full bg-bg-app" aria-label="${i18n.sessions.card.progressAria}">
          <div class="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-all duration-300" style="width: ${progressPct}%"></div>
        </div>
      </div>
    </article>
  `
}

export async function renderSessionsDashboard(root: HTMLElement, rerender: () => void): Promise<void> {
  await restoreSavedWorkspaceDirectory()
  const [sessions, kpis] = await Promise.all([listSessions(), getDashboardKpis()])
  const i18n = t()
  const handle = getWorkspaceDirectoryHandle()

  const activeList = sessions.filter(
    (s) => s.status !== SessionStatus.COMPLETED && s.status !== SessionStatus.BUDGET_EXCEEDED,
  )
  const completedList = sessions.filter(
    (s) => s.status === SessionStatus.COMPLETED || s.status === SessionStatus.BUDGET_EXCEEDED,
  )
  const visibleSessions = currentTab === 'active' ? activeList : completedList

  root.innerHTML = `
    <div class="flex min-h-screen bg-bg-app text-text-primary">
      ${renderSidebar('sessions')}

      <div class="flex flex-1 flex-col">
        <header class="flex items-center justify-between border-b border-border-default bg-bg-app/85 px-8 py-5 backdrop-blur">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-primary">${i18n.sessions.eyebrow}</p>
            <h1 class="font-display text-2xl font-bold text-text-primary">${i18n.sessions.title}</h1>
          </div>
          <div class="flex items-center gap-2.5">
            <button id="link-workspace-btn" class="inline-flex items-center gap-2 rounded-lg border border-border-default bg-bg-card px-3.5 py-2 text-xs font-semibold text-text-primary transition hover:border-primary/40 hover:bg-bg-elevated">
              ${heroIcon('folder-open', 'h-4 w-4 text-primary')}
              <span>${handle ? `${i18n.sessions.workspaceLinked}: ${handle.name}` : i18n.sessions.selectWorkspaceBtn}</span>
            </button>
            <button id="new-session-btn" class="inline-flex items-center gap-2 rounded-lg border border-border-default bg-bg-card px-3.5 py-2 text-xs font-semibold text-text-primary transition hover:border-primary/40 hover:bg-bg-elevated">
              ${heroIcon('plus', 'h-4 w-4')}
              <span>${i18n.sessions.newSession}</span>
            </button>
            ${renderLangToggle()}
            <button id="theme-toggle" class="rounded-lg border border-border-default bg-bg-card p-2 text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary" title="${i18n.common.toggleTheme}">
              ${heroIcon('sun-moon', 'h-4 w-4')}
            </button>
          </div>
        </header>

        <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-7">
          <section class="rounded-2xl border border-primary/25 bg-gradient-to-r from-primary/10 via-bg-card to-accent/10 p-6">
            <h2 class="font-display text-xl font-bold text-text-primary">${i18n.sessions.heroTitle}</h2>
            <p class="mt-1 max-w-3xl text-sm text-text-secondary">${i18n.sessions.heroSubtitle}</p>
          </section>

          <section class="grid grid-cols-1 gap-4 md:grid-cols-3">
            <div class="rounded-xl border border-border-default bg-bg-card p-4">
              <p class="text-xs font-medium text-text-muted">${i18n.sessions.stats.activeSessions}</p>
              <p class="mt-2 font-display text-2xl font-bold text-primary">${kpis.activeSessions}</p>
              <p class="mt-1 text-xs text-text-secondary">${i18n.sessions.stats.activeSessionsDetail}</p>
            </div>
            <div class="rounded-xl border border-border-default bg-bg-card p-4">
              <p class="text-xs font-medium text-text-muted">${i18n.sessions.stats.pendingApprovals}</p>
              <p class="mt-2 font-display text-2xl font-bold text-warning">${kpis.pendingApprovals}</p>
              <p class="mt-1 text-xs text-text-secondary">${i18n.sessions.stats.pendingApprovalsDetail}</p>
            </div>
            <div class="rounded-xl border border-border-default bg-bg-card p-4">
              <p class="text-xs font-medium text-text-muted">${i18n.sessions.stats.engramMemories}</p>
              <p class="mt-2 font-display text-2xl font-bold text-accent">${kpis.engramMemories}</p>
              <p class="mt-1 text-xs text-text-secondary">${i18n.sessions.stats.engramMemoriesDetail}</p>
            </div>
          </section>

          <section class="flex items-center justify-between border-b border-border-default pb-3">
            <div class="flex items-center gap-2">
              <button data-tab="active" class="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${currentTab === 'active'
      ? 'bg-primary text-white'
      : 'bg-bg-card text-text-secondary hover:bg-bg-elevated'
    }">
                ${i18n.sessions.tabs.active} (${activeList.length})
              </button>
              <button data-tab="completed" class="rounded-lg px-3.5 py-1.5 text-xs font-semibold transition ${currentTab === 'completed'
      ? 'bg-primary text-white'
      : 'bg-bg-card text-text-secondary hover:bg-bg-elevated'
    }">
                ${i18n.sessions.tabs.completed} (${completedList.length})
              </button>
            </div>
            <span class="text-xs text-text-muted">
              ${formatText(i18n.sessions.heading.registeredCount, { count: visibleSessions.length })}
            </span>
          </section>

          <section class="grid grid-cols-1 gap-4 md:grid-cols-2">
            ${visibleSessions.length > 0
      ? visibleSessions.map((s) => renderSessionCard(s)).join('')
      : `
                  <div class="col-span-full rounded-2xl border border-dashed border-border-default bg-bg-card/50 p-10 text-center">
                    <p class="font-display text-base font-semibold text-text-primary">
                      ${currentTab === 'completed' ? i18n.sessions.empty.completedTitle : i18n.sessions.empty.activeTitle}
                    </p>
                    <p class="mt-1 text-xs text-text-secondary">
                      ${currentTab === 'completed' ? i18n.sessions.empty.completedText : i18n.sessions.empty.activeText}
                    </p>
                  </div>
                `
    }
          </section>
        </main>

        <footer class="mt-auto flex items-center justify-between border-t border-border-default bg-bg-sidebar px-8 py-3 text-xs text-text-muted">
          <span>${i18n.sessions.footer.workerReady}</span>
          <span>${i18n.sessions.footer.localDataNotice}</span>
        </footer>
      </div>
    </div>
  `

  bindLangToggle(rerender)
  root.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', toggleTheme)

  root.querySelector<HTMLButtonElement>('#link-workspace-btn')?.addEventListener('click', async () => {
    try {
      await pickWorkspaceDirectory()
      syncWorkerEnvironment()
      rerender()
    } catch (err) {
      console.warn('[FS] Directory picker cancelled or unsupported:', err)
    }
  })

  root.querySelectorAll<HTMLButtonElement>('[data-tab]').forEach((btn) => {
    btn.addEventListener('click', () => {
      currentTab = (btn.dataset.tab as SessionTab) || 'active'
      rerender()
    })
  })

  root.querySelector<HTMLButtonElement>('#new-session-btn')?.addEventListener('click', async () => {
    const activeDir = getWorkspaceDirectoryHandle()
    const sessionGuid =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2, 10)

    const sessionId = await createSession({
      threadId: `session-${sessionGuid}`,
      title: 'Nueva sesión de desarrollo',
      goal: '',
      skill: 'ProjectRigor_Interviewer',
      workspaceName: activeDir?.name ?? 'Sandbox Virtual FS',
    })

    void runAgentSessionTurn(sessionId)
    window.location.hash = `#/sessions/${sessionId}`
  })

  root.querySelectorAll<HTMLButtonElement>('[data-delete-session]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      const id = Number(btn.dataset.deleteSession)
      if (!id) return
      cancelAgentSession(id)
      await deleteSession(id)
      rerender()
    })
  })

  root.querySelectorAll<HTMLButtonElement>('[data-reopen-session]').forEach((btn) => {
    btn.addEventListener('click', async (ev) => {
      ev.stopPropagation()
      const id = Number(btn.dataset.reopenSession)
      if (!id) return
      await updateSessionMetrics(id, { status: SessionStatus.IDLE })
      window.location.hash = `#/sessions/${id}`
    })
  })
}
