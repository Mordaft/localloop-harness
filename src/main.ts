import { applyBrandCssVariables } from './config/brand-config'
import { heroIcon } from './config/heroicons'
import { installDiagnosticsGlobal } from './diagnostics'
import { initI18n, onLanguageChange, t } from './i18n'
import { syncModernWebGuidance } from './memory/web-guidance-manager'
import { applyPwaUpdate, initPwaUpdate, isPwaUpdateReady, onPwaUpdateReady } from './pwa-update'
import { renderSessionsDashboard, updateThinkingPillInDom } from './screens/dashboard'
import { renderMemoryExplorer } from './screens/memory-explorer'
import { renderSettingsScreen } from './screens/settings'
import { renderAgentWorkspace } from './screens/workspace'
import './style.css'
import {
  isSessionRunning,
  onAgentProgress,
  onAgentThinking,
  syncWorkerEnvironment,
} from './worker/agent-bridge'

const savedTheme = localStorage.getItem('theme')
if (savedTheme === 'light') {
  document.documentElement.classList.remove('dark')
} else {
  document.documentElement.classList.add('dark')
}

initI18n()
applyBrandCssVariables()
installDiagnosticsGlobal()
initPwaUpdate()
void syncModernWebGuidance().then((res) => {
  if (res.updated) {
    syncWorkerEnvironment()
  }
})

const app = document.querySelector<HTMLDivElement>('#app')

if (!app) {
  throw new Error('Root #app element not found')
}

type Route =
  | { name: 'sessions' }
  | { name: 'workspace'; sessionId: number }
  | { name: 'memory' }
  | { name: 'settings' }

function parseHashRoute(hash: string): Route {
  const normalized = hash.replace(/^#/, '') || '/sessions'

  if (normalized === '/sessions' || normalized === '/') {
    return { name: 'sessions' }
  }

  if (normalized === '/memory') {
    return { name: 'memory' }
  }

  if (normalized === '/settings') {
    return { name: 'settings' }
  }

  const sessionMatch = normalized.match(/^\/sessions\/(\d+)$/)
  if (sessionMatch) {
    return { name: 'workspace', sessionId: Number(sessionMatch[1]) }
  }

  return { name: 'sessions' }
}

function renderPwaUpdateBanner(): void {
  const existing = document.getElementById('pwa-update-banner')
  if (!isPwaUpdateReady()) {
    existing?.remove()
    return
  }
  const i18n = t()
  const banner = existing ?? document.createElement('div')
  banner.id = 'pwa-update-banner'
  banner.className =
    'fixed bottom-4 right-4 z-50 flex items-center gap-3 rounded-xl border border-primary/40 bg-bg-card px-4 py-3 text-xs text-text-primary shadow-2xl shadow-primary/20'
  banner.innerHTML = `
    <span class="inline-flex h-2 w-2 rounded-full bg-primary animate-ping"></span>
    <span class="font-medium">${i18n.pwa.updateAvailable}</span>
    <button id="pwa-banner-apply-btn" class="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 font-semibold text-white transition hover:opacity-95">
      ${heroIcon('arrow-path', 'h-3.5 w-3.5')}
      <span>${i18n.pwa.updateBtn}</span>
    </button>
  `
  if (!existing) {
    document.body.appendChild(banner)
  }
  banner
    .querySelector<HTMLButtonElement>('#pwa-banner-apply-btn')
    ?.addEventListener('click', async (ev) => {
      const btn = ev.currentTarget as HTMLButtonElement
      btn.disabled = true
      btn.textContent = i18n.pwa.updating
      await applyPwaUpdate()
    })
}

async function renderCurrentRoute(): Promise<void> {
  const route = parseHashRoute(window.location.hash)

  if (route.name === 'sessions') {
    await renderSessionsDashboard(app!, () => {
      void renderCurrentRoute()
    })
  } else if (route.name === 'workspace') {
    await renderAgentWorkspace(app!, route.sessionId, () => {
      void renderCurrentRoute()
    })
  } else if (route.name === 'memory') {
    await renderMemoryExplorer(app!, () => {
      void renderCurrentRoute()
    })
  } else {
    await renderSettingsScreen(app!, () => {
      void renderCurrentRoute()
    })
  }

  renderPwaUpdateBanner()
}

window.addEventListener('hashchange', () => {
  void renderCurrentRoute()
})

onAgentProgress((sessionId) => {
  const openDialog = document.querySelector<HTMLDialogElement>('dialog[open]')
  if (openDialog) return

  const route = parseHashRoute(window.location.hash)
  // Si estamos observando la sesión en ejecución en el workspace, evitamos destruir y regenerar
  // todo el DOM en cada paso intermedio, dejando que la cola de streaming selectiva actualice el chat.
  if (route.name === 'workspace' && route.sessionId === sessionId && isSessionRunning(sessionId)) {
    return
  }

  void renderCurrentRoute()
})

onAgentThinking((state) => {
  updateThinkingPillInDom(state.sessionId)
})

onPwaUpdateReady(() => {
  renderPwaUpdateBanner()
})

onLanguageChange(() => {
  renderPwaUpdateBanner()
})

if (!window.location.hash) {
  window.location.hash = '#/sessions'
} else {
  void renderCurrentRoute()
}
