import { applyBrandCssVariables, getBrandConfig } from '../config/brand-config'
import { heroIcon } from '../config/heroicons'
import { SessionStatus } from '../enums'
import { t, toggleLanguage } from '../i18n'
import { updateMermaidTheme } from '../mermaid'

export type NavSection = 'sessions' | 'memory' | 'settings'

export function toggleTheme(): void {
  const isDark = document.documentElement.classList.toggle('dark')
  localStorage.setItem('theme', isDark ? 'dark' : 'light')
  applyBrandCssVariables()
  updateMermaidTheme(isDark)
}

export function renderLangToggle(): string {
  const i18n = t()
  return `
    <button id="lang-toggle" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-card px-2.5 py-2 text-xs font-semibold text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary" title="${i18n.common.toggleLang}">
      ${heroIcon('globe-alt', 'h-4 w-4 text-primary')}
      <span>${i18n.common.langCode}</span>
    </button>
  `
}

export function bindLangToggle(rerender: () => void): void {
  document.querySelector<HTMLButtonElement>('#lang-toggle')?.addEventListener('click', () => {
    toggleLanguage()
    rerender()
  })
}

export function renderBrandLogoSvg(sizeClass = 'h-7 w-7'): string {
  const brand = getBrandConfig()
  const raw = brand.logoSvgOrUrl?.trim() ?? ''
  if (raw.startsWith('<svg')) {
    return `<div class="${sizeClass} flex items-center justify-center text-primary overflow-hidden">${raw}</div>`
  }
  if (raw.startsWith('http://') || raw.startsWith('https://') || raw.startsWith('data:image/') || raw.startsWith('/')) {
    return `<img src="${raw}" alt="${brand.companyName}" class="${sizeClass} rounded object-contain" />`
  }
  return `
    <svg viewBox="0 0 64 64" fill="none" xmlns="http://www.w3.org/2000/svg" class="${sizeClass}">
      <rect width="64" height="64" rx="14" fill="rgb(var(--color-bg-elevated))"/>
      <path d="M22 24C16.477 24 12 28.477 12 34C12 39.523 16.477 44 22 44C26.5 44 29.8 40.5 32 37L35.5 31C37.7 27.5 41 24 45.5 24C51.023 24 55.5 28.477 55.5 34C55.5 39.523 51.023 44 45.5 44C41 44 37.7 40.5 35.5 37" stroke="rgb(var(--color-primary))" stroke-width="5" stroke-linecap="round"/>
      <circle cx="22" cy="34" r="4" fill="rgb(var(--color-accent))"/>
      <circle cx="45.5" cy="34" r="4" fill="rgb(var(--color-primary))"/>
    </svg>
  `
}

export function statusClass(status: number | string): string {
  const i18n = t()
  if (status === SessionStatus.COMPLETED || status === i18n.domain.statuses.completed) {
    return 'bg-accent/15 text-accent border border-accent/30'
  }
  if (status === SessionStatus.WAITING_APPROVAL || status === i18n.domain.statuses.waitingApproval) {
    return 'bg-warning/15 text-warning border border-warning/30'
  }
  if (status === SessionStatus.BUDGET_EXCEEDED || status === i18n.domain.statuses.budgetExceeded) {
    return 'bg-warning/20 text-warning border border-warning/40'
  }
  if (status === SessionStatus.ERROR || status === i18n.domain.statuses.error) {
    return 'bg-red-500/15 text-red-500 border border-red-500/30'
  }
  if (status === SessionStatus.RUNNING || status === i18n.domain.statuses.running) {
    return 'bg-primary/15 text-primary border border-primary/30'
  }
  return 'bg-secondary/15 text-secondary border border-secondary/30'
}

export function renderSidebar(active: NavSection): string {
  const i18n = t()
  const brand = getBrandConfig()
  const itemClass = (tab: NavSection) =>
    tab === active
      ? 'flex w-full items-center gap-3 rounded-lg bg-primary/15 px-3 py-2.5 text-left text-sm font-medium text-primary border border-primary/30'
      : 'flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary'

  return `
    <aside class="flex w-64 shrink-0 flex-col justify-between border-r border-border-default bg-bg-sidebar p-4">
      <div>
        <div class="mb-6 flex items-center gap-3 px-2 py-1">
          <div class="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 border border-primary/25 shadow-sm">
            ${renderBrandLogoSvg('h-7 w-7')}
          </div>
          <div class="min-w-0">
            <p class="truncate font-display text-sm font-bold tracking-tight text-text-primary">${brand.companyName}</p>
            <p class="text-[11px] text-text-muted">${i18n.sidebar.workspace}</p>
          </div>
        </div>

        <nav class="space-y-1.5">
          <a href="#/sessions" class="${itemClass('sessions')}">
            ${heroIcon('cpu-chip', 'h-4 w-4 shrink-0')}
            <span>${i18n.sidebar.sessions}</span>
          </a>
          <a href="#/memory" class="${itemClass('memory')}">
            ${heroIcon('circle-stack', 'h-4 w-4 shrink-0')}
            <span>${i18n.sidebar.memory}</span>
          </a>
          <a href="#/settings" class="${itemClass('settings')}">
            ${heroIcon('cog-6-tooth', 'h-4 w-4 shrink-0')}
            <span>${i18n.sidebar.settings}</span>
          </a>
        </nav>
      </div>

      <div class="rounded-xl border border-border-default bg-bg-card p-3">
        <div class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 items-center justify-center rounded-full bg-accent/15 text-xs font-bold text-accent border border-accent/30">LL</div>
          <div class="min-w-0 flex-1">
            <p class="truncate text-xs font-medium text-text-primary">${i18n.sidebar.localSession}</p>
            <p class="inline-flex items-center gap-1 text-[11px] text-accent">
              <span class="h-1.5 w-1.5 rounded-full bg-accent animate-pulse"></span>
              ${i18n.sidebar.workerReady}
            </p>
          </div>
        </div>
        <div class="mt-2.5 flex items-center justify-between border-t border-border-subtle pt-2 text-[10px] text-text-muted">
          <span>LangGraph.js + Engram</span>
          <span class="font-mono font-semibold text-text-secondary">v${__APP_VERSION__}</span>
        </div>
      </div>
    </aside>
  `
}
