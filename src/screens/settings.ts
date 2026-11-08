import {
  getBrandConfig,
  resetBrandConfig,
  rgbTripletToHex,
  saveBrandConfig,
  type BrandFontFamily,
} from '../config/brand-config'
import { heroIcon } from '../config/heroicons'
import { FsWriteMode, type FsWriteMode as FsWriteModeType } from '../enums'
import { formatText, t } from '../i18n'
import { getLlmConfig, saveLlmConfig, testLlmConnection } from '../llm/llm-config'
import {
  addMcpServer,
  deleteMcpServer,
  listMcpServers,
  resetDatabaseAndCache,
} from '../memory/app-db'
import { applyPwaUpdate, checkForPwaUpdates, isPwaUpdateReady } from '../pwa-update'
import { syncWorkerEnvironment } from '../worker/agent-bridge'
import { bindLangToggle, renderLangToggle, renderSidebar, toggleTheme } from './shared'

export async function renderSettingsScreen(root: HTMLElement, rerender: () => void): Promise<void> {
  const config = getLlmConfig()
  const brand = getBrandConfig()
  const mcpServers = await listMcpServers()
  const i18n = t()
  const updateReady = isPwaUpdateReady()

  root.innerHTML = `
    <div class="flex min-h-screen bg-bg-app text-text-primary">
      ${renderSidebar('settings')}

      <div class="flex flex-1 flex-col">
        <header class="sticky top-0 z-30 flex items-center justify-between border-b border-border-default bg-bg-app/90 px-8 py-4 backdrop-blur shadow-sm">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-primary">${i18n.settings.eyebrow}</p>
            <h1 class="font-display text-2xl font-bold text-text-primary">${i18n.settings.title}</h1>
          </div>
          <div class="flex items-center gap-3">
            <span id="header-status" class="hidden text-xs font-medium md:inline"></span>
            <button type="submit" form="llm-settings-form" id="save-llm-btn-header" class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-md shadow-primary/20 transition hover:opacity-95 active:scale-95" title="${i18n.settings.saveBtn}">
              ${heroIcon('check-circle', 'h-3.5 w-3.5')}
              <span>${i18n.settings.saveBtn}</span>
            </button>
            <div class="h-4 w-px bg-border-default"></div>
            <span class="rounded-lg border border-border-default bg-bg-card px-3 py-1.5 text-xs text-text-secondary">${i18n.settings.localOnly}</span>
            ${renderLangToggle()}
            <button id="theme-toggle" class="rounded-lg border border-border-default bg-bg-card p-2 text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary" title="${i18n.common.toggleTheme}">
              ${heroIcon('sun-moon', 'h-4 w-4')}
            </button>
          </div>
        </header>

        <main class="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-6 px-8 py-7">
          <div class="rounded-2xl border border-primary/25 bg-primary/10 p-5">
            <p class="text-sm font-semibold text-text-primary">${i18n.settings.introTitle}</p>
            <p class="mt-1 text-xs leading-relaxed text-text-secondary">${i18n.settings.introDesc}</p>
          </div>

          <form id="llm-settings-form" class="space-y-6">
            <!-- 1. OpenAI-Compatible Runtime -->
            <section class="rounded-2xl border border-border-default bg-bg-card p-6">
              <div class="mb-5 border-b border-border-subtle pb-4">
                <p class="text-xs uppercase tracking-widest text-primary">${i18n.settings.connEyebrow}</p>
                <h2 class="mt-1 font-display text-lg font-bold text-text-primary">${i18n.settings.connTitle}</h2>
                <p class="mt-0.5 text-xs text-text-muted">${i18n.settings.connDesc}</p>
              </div>

              <div class="grid grid-cols-1 gap-5 md:grid-cols-2">
                <div class="md:col-span-2">
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="runtimeUrl">${i18n.settings.runtimeUrlLabel}</label>
                  <input id="runtimeUrl" name="runtimeUrl" value="${config.baseUrl}" placeholder="http://127.0.0.1:1234/v1" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.runtimeUrlHint}</p>
                </div>

                <div class="md:col-span-2">
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="model">${i18n.settings.modelLabel}</label>
                  <div class="flex items-center gap-2">
                    <select id="model" name="model" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary" required>
                      <option value="${config.model}" selected>${config.model}</option>
                    </select>
                    <button type="button" id="refresh-models-btn" class="inline-flex shrink-0 items-center justify-center rounded-lg border border-border-default bg-bg-app p-2.5 text-text-secondary transition hover:border-primary/40 hover:bg-bg-elevated hover:text-text-primary" title="${i18n.settings.refreshModelsTitle}">
                      ${heroIcon('arrow-path', 'h-4 w-4')}
                    </button>
                  </div>
                  <p id="model-hint" class="mt-1 text-[11px] text-text-muted">${i18n.settings.loadingModels}</p>
                </div>

                <div class="md:col-span-2">
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="renderThinking">${i18n.settings.renderThinkingLabel}</label>
                  <select id="renderThinking" name="renderThinking" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none transition focus:border-primary">
                    <option value="false" ${!config.renderThinking ? 'selected' : ''}>${i18n.settings.renderThinkingDisabled}</option>
                    <option value="true" ${config.renderThinking ? 'selected' : ''}>${i18n.settings.renderThinkingEnabled}</option>
                  </select>
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.renderThinkingHint}</p>
                </div>
              </div>

              <!-- Test connection inside LLM / SLM Engine group -->
              <div class="mt-5 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-4">
                <div class="flex items-center gap-2.5">
                  <button type="button" id="test-llm-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-app px-3.5 py-2 text-xs font-medium text-text-primary transition hover:border-primary/40 hover:bg-bg-elevated active:scale-95">
                    ${heroIcon('bolt', 'h-3.5 w-3.5 text-primary')}
                    <span>${i18n.settings.testBtn}</span>
                  </button>
                  <span id="test-llm-status" class="text-xs"></span>
                </div>
                <span class="text-[11px] text-text-muted">OpenAI /v1 specification</span>
              </div>
            </section>

            <!-- 2. Turn / Token Budget & Concurrency -->
            <section class="rounded-2xl border border-border-default bg-bg-card p-6">
              <div class="mb-5 border-b border-border-subtle pb-4">
                <p class="text-xs uppercase tracking-widest text-primary">${i18n.settings.budgetEyebrow}</p>
                <h2 class="mt-1 font-display text-lg font-bold text-text-primary">${i18n.settings.budgetTitle}</h2>
                <p class="mt-0.5 text-xs text-text-muted">${i18n.settings.budgetDesc}</p>
              </div>

              <div class="grid grid-cols-1 gap-5 md:grid-cols-3">
                <div>
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="maxTurns">${i18n.settings.maxTurnsLabel}</label>
                  <input id="maxTurns" name="maxTurns" type="number" min="1" max="50" step="1" value="${config.maxTurns}" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.maxTurnsHint}</p>
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="maxTokenBudget">${i18n.settings.maxTokenBudgetLabel}</label>
                  <input id="maxTokenBudget" name="maxTokenBudget" type="number" min="2048" max="512000" step="1024" value="${config.maxTokenBudget}" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.maxTokenBudgetHint}</p>
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="temperature">${i18n.settings.tempLabel}</label>
                  <input id="temperature" name="temperature" type="number" min="0" max="1" step="0.05" value="${config.temperature}" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.tempHint}</p>
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="maxTokens">${i18n.settings.maxTokensLabel}</label>
                  <input id="maxTokens" name="maxTokens" type="number" min="256" max="32768" step="128" value="${config.maxTokens}" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.maxTokensHint}</p>
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="maxDepth">${i18n.settings.maxDepthLabel}</label>
                  <input id="maxDepth" name="maxDepth" type="number" min="1" max="5" step="1" value="${config.maxDepth}" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.maxDepthHint}</p>
                </div>

                <div>
                  <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="maxConcurrency">${i18n.settings.maxConcurrencyLabel}</label>
                  <input id="maxConcurrency" name="maxConcurrency" type="number" min="1" max="8" step="1" value="${config.maxConcurrency}" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary" required />
                  <p class="mt-1 text-[11px] text-text-muted">${i18n.settings.maxConcurrencyHint}</p>
                </div>
              </div>
            </section>

            <!-- 3. File System Write Policy (Default Human Confirmation, Configurable) -->
            <section class="rounded-2xl border border-border-default bg-bg-card p-6">
              <div class="mb-4 border-b border-border-subtle pb-4">
                <p class="text-xs uppercase tracking-widest text-warning">${i18n.settings.fsPolicyEyebrow}</p>
                <h2 class="mt-1 font-display text-lg font-bold text-text-primary">${i18n.settings.fsPolicyTitle}</h2>
                <p class="mt-0.5 text-xs text-text-muted">${i18n.settings.fsPolicyDesc}</p>
              </div>

              <div>
                <label class="mb-1.5 block text-xs font-medium text-text-secondary" for="fsWriteMode">${i18n.settings.fsWriteModeLabel}</label>
                <select id="fsWriteMode" name="fsWriteMode" class="w-full rounded-lg border border-border-default bg-bg-app px-3.5 py-2.5 text-sm text-text-primary outline-none focus:border-primary">
                  <option value="${FsWriteMode.CONFIRM}" ${config.fsWriteMode === FsWriteMode.CONFIRM ? 'selected' : ''}>
                    ${i18n.settings.fsWriteModeConfirm}
                  </option>
                  <option value="${FsWriteMode.AUTO}" ${config.fsWriteMode === FsWriteMode.AUTO ? 'selected' : ''}>
                    ${i18n.settings.fsWriteModeAuto}
                  </option>
                </select>
                <p class="mt-1.5 text-[11px] text-text-muted">${i18n.settings.fsWriteModeHint}</p>
              </div>
            </section>

            <!-- Save Controls (Sticky docked bottom bar) -->
            <div class="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-default bg-bg-card/95 px-5 py-3.5 backdrop-blur shadow-xl">
              <p id="settings-status" class="text-xs text-text-muted">${i18n.settings.statusNotice}</p>
              <button type="submit" id="save-llm-btn" class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white shadow-lg shadow-primary/20 transition hover:opacity-95 active:scale-95">
                ${heroIcon('check-circle', 'h-3.5 w-3.5')}
                <span>${i18n.settings.saveBtn}</span>
              </button>
            </div>
          </form>

          <!-- 5. MCP Servers Registry -->
          <section class="rounded-2xl border border-border-default bg-bg-card p-6 space-y-4">
            <div class="border-b border-border-subtle pb-4">
              <p class="text-xs uppercase tracking-widest text-accent">${i18n.settings.mcpEyebrow}</p>
              <h2 class="mt-1 font-display text-lg font-bold text-text-primary">${i18n.settings.mcpTitle}</h2>
              <p class="mt-0.5 text-xs text-text-muted">${i18n.settings.mcpDesc}</p>
            </div>

            <div class="space-y-2">
              ${
                mcpServers.length > 0
                  ? mcpServers
                      .map(
                        (srv) => `
                        <div class="flex items-center justify-between rounded-xl border border-border-default bg-bg-app px-3.5 py-2.5 text-xs">
                          <div>
                            <span class="font-semibold text-text-primary">${srv.name}</span>
                            <span class="ml-2 font-mono text-[11px] text-text-muted">${srv.url}</span>
                          </div>
                          <button data-delete-mcp="${srv.id}" class="rounded-lg p-1 text-text-muted hover:text-red-500">
                            ${heroIcon('trash', 'h-4 w-4')}
                          </button>
                        </div>
                      `,
                      )
                      .join('')
                  : `<p class="text-xs text-text-muted">No hay servidores MCP externos registrados.</p>`
              }
            </div>

            <form id="mcp-add-form" class="grid grid-cols-1 gap-3 md:grid-cols-5">
              <input id="mcp-name" placeholder="${i18n.settings.mcpNamePlaceholder}" required class="md:col-span-2 rounded-lg border border-border-default bg-bg-app px-3 py-2 text-xs text-text-primary outline-none focus:border-primary" />
              <input id="mcp-url" placeholder="${i18n.settings.mcpUrlPlaceholder}" required class="md:col-span-2 rounded-lg border border-border-default bg-bg-app px-3 py-2 text-xs text-text-primary outline-none focus:border-primary" />
              <button type="submit" class="inline-flex items-center justify-center gap-1.5 rounded-lg bg-accent px-3 py-2 text-xs font-semibold text-slate-950">
                ${heroIcon('plus', 'h-3.5 w-3.5')}
                <span>${i18n.settings.mcpAddBtn}</span>
              </button>
            </form>
          </section>

          <!-- 6. Brand & 5-Color Theme Configurator -->
          <section class="rounded-2xl border border-border-default bg-bg-card p-6 space-y-5">
            <div class="flex items-start justify-between border-b border-border-subtle pb-4">
              <div>
                <p class="text-xs uppercase tracking-widest text-primary">${i18n.settings.brandEyebrow}</p>
                <h2 class="mt-1 font-display text-lg font-bold text-text-primary">${i18n.settings.brandTitle}</h2>
                <p class="mt-0.5 text-xs text-text-muted">${i18n.settings.brandDesc}</p>
              </div>
              <button type="button" id="reset-brand-btn" class="rounded-lg border border-border-default bg-bg-app px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-bg-elevated">
                ${i18n.settings.resetBrandBtn}
              </button>
            </div>

            <form id="brand-settings-form" class="space-y-4">
              <div class="grid grid-cols-1 gap-4 md:grid-cols-2">
                <div>
                  <label class="mb-1 block text-xs font-medium text-text-secondary" for="brand-company">${i18n.settings.companyNameLabel}</label>
                  <input id="brand-company" name="companyName" value="${brand.companyName}" class="w-full rounded-lg border border-border-default bg-bg-app px-3 py-2 text-xs text-text-primary outline-none focus:border-primary" />
                </div>
                <div>
                  <label class="mb-1 block text-xs font-medium text-text-secondary" for="brand-font">${i18n.settings.fontFamilyLabel}</label>
                  <select id="brand-font" name="fontFamily" class="w-full rounded-lg border border-border-default bg-bg-app px-3 py-2 text-xs text-text-primary outline-none focus:border-primary">
                    <option value="Inter" ${brand.fontFamily === 'Inter' ? 'selected' : ''}>Inter (UI Moderna)</option>
                    <option value="Roboto" ${brand.fontFamily === 'Roboto' ? 'selected' : ''}>Roboto (Clásica Técnica)</option>
                  </select>
                </div>
                <div class="md:col-span-2">
                  <label class="mb-1 block text-xs font-medium text-text-secondary" for="brand-logo">${i18n.settings.logoSvgLabel}</label>
                  <input id="brand-logo" name="logoSvgOrUrl" value="${brand.logoSvgOrUrl.replace(/"/g, '&quot;')}" placeholder="<svg ...> o https://..." class="w-full rounded-lg border border-border-default bg-bg-app px-3 py-2 font-mono text-xs text-text-primary outline-none focus:border-primary" />
                </div>
              </div>

              <div class="grid grid-cols-2 gap-4 md:grid-cols-5">
                ${(['primary', 'secondary', 'accent', 'info', 'warning'] as const)
                  .map(
                    (colorKey) => `
                    <div class="rounded-xl border border-border-default bg-bg-app p-3 space-y-2">
                      <p class="text-xs font-semibold capitalize text-text-primary">${colorKey}</p>
                      <div class="flex items-center justify-between text-[11px] text-text-muted">
                        <span>Light</span>
                        <input type="color" name="light_${colorKey}" value="${rgbTripletToHex(brand.colors[colorKey].light)}" class="h-6 w-10 cursor-pointer rounded border border-border-default bg-transparent" />
                      </div>
                      <div class="flex items-center justify-between text-[11px] text-text-muted">
                        <span>Dark</span>
                        <input type="color" name="dark_${colorKey}" value="${rgbTripletToHex(brand.colors[colorKey].dark)}" class="h-6 w-10 cursor-pointer rounded border border-border-default bg-transparent" />
                      </div>
                    </div>
                  `,
                  )
                  .join('')}
              </div>

              <div class="flex justify-end">
                <button type="submit" class="inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-white">
                  ${heroIcon('paint-brush', 'h-3.5 w-3.5')}
                  <span>Aplicar Marca y Paleta</span>
                </button>
              </div>
            </form>
          </section>

          <!-- 7. Storage & PWA Reset -->
          <section class="rounded-2xl border border-red-500/25 bg-bg-card p-6">
            <div class="flex flex-wrap items-center justify-between gap-4">
              <div>
                <p class="text-xs uppercase tracking-widest text-red-500">${i18n.settings.storageEyebrow}</p>
                <h2 class="mt-1 font-display text-lg font-bold text-text-primary">${i18n.settings.storageTitle}</h2>
                <p class="mt-0.5 text-xs text-text-muted">${i18n.settings.storageDesc}</p>
              </div>
              <div class="flex items-center gap-2.5">
                <button type="button" id="check-pwa-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-border-default bg-bg-app px-3.5 py-2 text-xs font-medium text-text-primary hover:bg-bg-elevated">
                  ${heroIcon('arrow-path', 'h-3.5 w-3.5 text-primary')}
                  <span>${updateReady ? i18n.pwa.updateBtn : i18n.pwa.checkUpdatesBtn}</span>
                </button>
                <button type="button" id="reset-db-btn" class="inline-flex items-center gap-1.5 rounded-lg border border-red-500/35 bg-red-500/10 px-4 py-2 text-xs font-semibold text-red-500 hover:bg-red-500/20">
                  ${heroIcon('trash', 'h-3.5 w-3.5')}
                  <span>${i18n.settings.resetDataBtn}</span>
                </button>
              </div>
            </div>
          </section>
        </main>
      </div>
    </div>
  `

  bindLangToggle(rerender)
  root.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', toggleTheme)

  const runtimeUrlInput = root.querySelector<HTMLInputElement>('#runtimeUrl')!
  const modelSelect = root.querySelector<HTMLSelectElement>('#model')!
  const modelHint = root.querySelector<HTMLElement>('#model-hint')!
  const statusEl = root.querySelector<HTMLElement>('#settings-status')!
  const headerStatusEl = root.querySelector<HTMLElement>('#header-status')
  const testLlmBtn = root.querySelector<HTMLButtonElement>('#test-llm-btn')
  const testLlmStatus = root.querySelector<HTMLElement>('#test-llm-status')
  const saveBtnHeader = root.querySelector<HTMLButtonElement>('#save-llm-btn-header')
  const saveBtnBottom = root.querySelector<HTMLButtonElement>('#save-llm-btn')
  const saveBtns = [saveBtnHeader, saveBtnBottom].filter((b): b is HTMLButtonElement => !!b)

  async function populateModelsList(selectedModel?: string) {
    const url = runtimeUrlInput.value.trim()
    if (!url) return
    modelHint.textContent = i18n.settings.loadingModels
    try {
      const res = await testLlmConnection({ baseUrl: url })
      const availableModels = (res.data ?? []).map((item) => item.id)
      const currentVal = selectedModel ?? (modelSelect.value || config.model)
      const models = availableModels.length > 0 ? [...availableModels] : [currentVal]
      if (!models.includes(currentVal)) models.unshift(currentVal)
      modelSelect.innerHTML = models
        .map((m: string) => `<option value="${m}" ${m === currentVal ? 'selected' : ''}>${m}</option>`)
        .join('')
      modelHint.textContent = formatText(i18n.settings.modelsAvailable, {
        count: availableModels.length,
      })
    } catch {
      modelHint.textContent = i18n.settings.modelsError
    }
  }

  void populateModelsList(config.model)

  root.querySelector<HTMLButtonElement>('#refresh-models-btn')?.addEventListener('click', () => {
    void populateModelsList()
  })

  testLlmBtn?.addEventListener('click', async () => {
    const url = runtimeUrlInput.value.trim()
    if (!url) {
      if (testLlmStatus) {
        testLlmStatus.textContent = i18n.settings.errorRequired
        testLlmStatus.className = 'text-xs font-medium text-red-500'
      }
      return
    }

    if (testLlmBtn) testLlmBtn.disabled = true
    if (testLlmStatus) {
      testLlmStatus.textContent = i18n.settings.testConnectionTesting
      testLlmStatus.className = 'text-xs text-text-muted animate-pulse'
    }

    try {
      const res = await testLlmConnection({ baseUrl: url })
      const count = res.data?.length ?? 0
      if (testLlmStatus) {
        testLlmStatus.textContent = formatText(i18n.settings.testConnectionSuccess, { count })
        testLlmStatus.className = 'text-xs font-medium text-accent'
      }
      void populateModelsList()
    } catch (err) {
      if (testLlmStatus) {
        testLlmStatus.textContent = err instanceof Error ? `✕ ${err.message}` : `✕ ${i18n.settings.errorTest}`
        testLlmStatus.className = 'text-xs font-medium text-red-500'
      }
    } finally {
      if (testLlmBtn) testLlmBtn.disabled = false
    }
  })

  root.querySelector<HTMLFormElement>('#llm-settings-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget as HTMLFormElement)
    try {
      saveLlmConfig({
        baseUrl: String(fd.get('runtimeUrl') ?? config.baseUrl),
        model: String(fd.get('model') ?? config.model),
        renderThinking: fd.get('renderThinking') === 'true',
        temperature: Number(fd.get('temperature') ?? config.temperature),
        maxTokens: Number(fd.get('maxTokens') ?? config.maxTokens),
        maxTurns: Number(fd.get('maxTurns') ?? config.maxTurns),
        maxTokenBudget: Number(fd.get('maxTokenBudget') ?? config.maxTokenBudget),
        maxDepth: Number(fd.get('maxDepth') ?? config.maxDepth),
        maxConcurrency: Number(fd.get('maxConcurrency') ?? config.maxConcurrency),
        fsWriteMode: (fd.get('fsWriteMode') as FsWriteModeType) ?? FsWriteMode.CONFIRM,
        systemPrompt: config.systemPrompt,
      })
      syncWorkerEnvironment()

      const successNotice = i18n.settings.savedSuccess
      const btnSuccessText = i18n.settings.saveBtnSuccess

      if (statusEl) {
        statusEl.textContent = successNotice
        statusEl.className = 'text-xs font-medium text-accent'
      }
      if (headerStatusEl) {
        headerStatusEl.textContent = successNotice
        headerStatusEl.className = 'hidden text-xs font-medium text-accent md:inline'
      }

      saveBtns.forEach((btn) => {
        const span = btn.querySelector('span')
        if (span) span.textContent = btnSuccessText
        btn.classList.add('bg-accent')
        btn.classList.remove('bg-primary')
      })

      setTimeout(() => {
        if (statusEl) {
          statusEl.textContent = i18n.settings.statusNotice
          statusEl.className = 'text-xs text-text-muted'
        }
        if (headerStatusEl) {
          headerStatusEl.textContent = ''
          headerStatusEl.className = 'hidden text-xs text-text-muted md:inline'
        }
        saveBtns.forEach((btn) => {
          const span = btn.querySelector('span')
          if (span) span.textContent = i18n.settings.saveBtn
          btn.classList.remove('bg-accent')
          btn.classList.add('bg-primary')
        })
      }, 3000)
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : i18n.settings.errorSave
      if (statusEl) {
        statusEl.textContent = errorMsg
        statusEl.className = 'text-xs font-medium text-red-500'
      }
      if (headerStatusEl) {
        headerStatusEl.textContent = errorMsg
        headerStatusEl.className = 'hidden text-xs font-medium text-red-500 md:inline'
      }
    }
  })

  root.querySelector<HTMLFormElement>('#mcp-add-form')?.addEventListener('submit', async (ev) => {
    ev.preventDefault()
    const nameInput = root.querySelector<HTMLInputElement>('#mcp-name')
    const urlInput = root.querySelector<HTMLInputElement>('#mcp-url')
    if (!nameInput?.value.trim() || !urlInput?.value.trim()) return
    await addMcpServer({
      name: nameInput.value.trim(),
      url: urlInput.value.trim(),
    })
    rerender()
  })

  root.querySelectorAll<HTMLButtonElement>('[data-delete-mcp]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = Number(btn.dataset.deleteMcp)
      if (!id) return
      await deleteMcpServer(id)
      rerender()
    })
  })

  root.querySelector<HTMLFormElement>('#brand-settings-form')?.addEventListener('submit', (ev) => {
    ev.preventDefault()
    const fd = new FormData(ev.currentTarget as HTMLFormElement)
    saveBrandConfig({
      companyName: String(fd.get('companyName') ?? brand.companyName).trim() || 'LocalLoop',
      productHighlight: brand.productHighlight,
      fontFamily: (fd.get('fontFamily') as BrandFontFamily) ?? 'Inter',
      logoSvgOrUrl: String(fd.get('logoSvgOrUrl') ?? ''),
      colors: {
        primary: {
          light: String(fd.get('light_primary') ?? '#0284c7'),
          dark: String(fd.get('dark_primary') ?? '#38bdf8'),
        },
        secondary: {
          light: String(fd.get('light_secondary') ?? '#4f46e5'),
          dark: String(fd.get('dark_secondary') ?? '#818cf8'),
        },
        accent: {
          light: String(fd.get('light_accent') ?? '#059669'),
          dark: String(fd.get('dark_accent') ?? '#34d399'),
        },
        info: {
          light: String(fd.get('light_info') ?? '#0891b2'),
          dark: String(fd.get('dark_info') ?? '#22d3ee'),
        },
        warning: {
          light: String(fd.get('light_warning') ?? '#d97706'),
          dark: String(fd.get('dark_warning') ?? '#fbbf24'),
        },
      },
    })
    rerender()
  })

  root.querySelector<HTMLButtonElement>('#reset-brand-btn')?.addEventListener('click', () => {
    resetBrandConfig()
    rerender()
  })

  root.querySelector<HTMLButtonElement>('#check-pwa-btn')?.addEventListener('click', async () => {
    if (isPwaUpdateReady()) {
      await applyPwaUpdate()
    } else {
      await checkForPwaUpdates()
      rerender()
    }
  })

  root.querySelector<HTMLButtonElement>('#reset-db-btn')?.addEventListener('click', async () => {
    if (window.confirm(i18n.settings.resetDataConfirm)) {
      await resetDatabaseAndCache()
    }
  })
}
