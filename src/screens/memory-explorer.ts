import type { MemoryHeader } from 'engram-ts'
import { heroIcon } from '../config/heroicons'
import { formatUpdatedTime, t } from '../i18n'
import {
  getPersistentEngram,
  getPersistentMemoryStore,
  refreshPersistentEngram,
} from '../memory/engram-memory'
import { getSharedIndexedDBSaver } from '../memory/indexeddb-saver'
import { bindLangToggle, renderLangToggle, renderSidebar, toggleTheme } from './shared'

let currentSearchQuery = ''

export async function renderMemoryExplorer(root: HTMLElement, rerender: () => void): Promise<void> {
  const i18n = t()
  const engram = await refreshPersistentEngram().catch(() => getPersistentEngram())
  const store = getPersistentMemoryStore()
  const saver = getSharedIndexedDBSaver()

  let engramResults: Array<{ header: MemoryHeader; score: number }> = []
  const q = currentSearchQuery.trim().toLowerCase()

  if (q) {
    try {
      engramResults = await engram.search({ query: currentSearchQuery, limit: 60 })
    } catch {
      engramResults = []
    }
    // Fallback directo sobre IndexedDB si Lunr no encuentra coincidencias
    if (engramResults.length === 0) {
      try {
        const directHeaders = await store.listHeaders()
        engramResults = directHeaders
          .filter(
            (h: MemoryHeader) =>
              h.title.toLowerCase().includes(q) ||
              h.type.toLowerCase().includes(q) ||
              h.project.toLowerCase().includes(q) ||
              h.tags.some((tag: string) => tag.toLowerCase().includes(q)),
          )
          .slice(0, 60)
          .map((header: MemoryHeader) => ({ header, score: 1 }))
      } catch {
        // Ignorar fallo de listHeaders
      }
    }
  } else {
    // Si no hay búsqueda, consultar directamente a Dexie (IndexedDB)
    // para obtener las memorias más recientes de forma inmediata sin depender del índice Lunr
    try {
      const directHeaders = await store.listHeaders()
      engramResults = directHeaders.slice(0, 60).map((header: MemoryHeader) => ({ header, score: 0 }))
    } catch {
      engramResults = await engram.search({ query: '', limit: 60 }).catch(() => [])
    }
  }

  const checkpoints = await saver.listAllSummaries().catch(() => [])

  root.innerHTML = `
    <div class="flex min-h-screen bg-bg-app text-text-primary">
      ${renderSidebar('memory')}

      <div class="flex flex-1 flex-col">
        <header class="flex items-center justify-between border-b border-border-default bg-bg-app/85 px-8 py-5 backdrop-blur">
          <div>
            <p class="text-xs uppercase tracking-[0.2em] text-primary">${i18n.memory.eyebrow}</p>
            <h1 class="font-display text-2xl font-bold text-text-primary">${i18n.memory.title}</h1>
          </div>
          <div class="flex items-center gap-2.5">
            ${renderLangToggle()}
            <button id="theme-toggle" class="rounded-lg border border-border-default bg-bg-card p-2 text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary" title="${i18n.common.toggleTheme}">
              ${heroIcon('sun-moon', 'h-4 w-4')}
            </button>
          </div>
        </header>

        <main class="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-8 py-7">
          <p class="text-sm text-text-secondary">${i18n.memory.subtitle}</p>

          <!-- Search Bar -->
          <div class="relative">
            <div class="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5 text-text-muted">
              ${heroIcon('magnifying-glass', 'h-4 w-4')}
            </div>
            <input
              id="memory-search-input"
              type="search"
              value="${currentSearchQuery.replace(/"/g, '&quot;')}"
              placeholder="${i18n.memory.searchPlaceholder}"
              class="w-full rounded-xl border border-border-default bg-bg-card py-2.5 pl-10 pr-4 text-sm text-text-primary outline-none transition focus:border-primary"
            />
          </div>

          <!-- Engram Memories Table -->
          <section class="rounded-2xl border border-border-default bg-bg-card p-6">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h2 class="font-display text-base font-bold text-text-primary">${i18n.memory.engramsTitle}</h2>
                <p class="text-xs text-text-muted">${i18n.memory.engramsSubtitle}</p>
              </div>
              <div class="flex items-center gap-2">
                <button
                  id="refresh-memory-btn"
                  class="flex items-center gap-1 rounded-lg border border-border-default bg-bg-app px-2.5 py-1 text-xs text-text-secondary transition hover:bg-bg-elevated hover:text-text-primary"
                  title="Sincronizar con IndexedDB"
                >
                  ${heroIcon('arrow-path', 'h-3.5 w-3.5')}
                  <span>Sincronizar</span>
                </button>
                <span class="rounded-lg bg-primary/15 px-2.5 py-1 font-mono text-xs font-semibold text-primary">
                  ${engramResults.length}
                </span>
              </div>
            </div>

            ${
              engramResults.length > 0
                ? `
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                      <thead class="border-b border-border-default text-text-muted">
                        <tr>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colTitle}</th>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colType}</th>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colProject}</th>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colTags}</th>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colRecords}</th>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colUpdated}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-border-subtle">
                        ${engramResults
                          .map(
                            (r) => `
                            <tr class="hover:bg-bg-elevated/40">
                              <td class="py-3 pr-3 font-medium text-text-primary">${r.header.title}</td>
                              <td class="py-3 pr-3">
                                <span class="rounded bg-accent/15 px-2 py-0.5 font-mono text-[10px] text-accent">${r.header.type}</span>
                              </td>
                              <td class="py-3 pr-3 font-mono text-[11px] text-text-secondary">${r.header.project}</td>
                              <td class="py-3 pr-3">
                                <div class="flex flex-wrap gap-1">
                                  ${r.header.tags
                                    .slice(0, 4)
                                    .map(
                                      (tag: string) =>
                                        `<span class="rounded border border-border-default bg-bg-app px-1.5 py-0.5 font-mono text-[10px] text-text-muted">${tag}</span>`,
                                    )
                                    .join('')}
                                </div>
                              </td>
                              <td class="py-3 pr-3 font-mono text-text-secondary">${r.header.recordCount}</td>
                              <td class="py-3 font-mono text-[11px] text-text-muted">${formatUpdatedTime(r.header.updatedAt)}</td>
                            </tr>
                          `,
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                `
                : `<p class="rounded-xl border border-dashed border-border-default p-8 text-center text-xs text-text-muted">${i18n.memory.emptyEngrams}</p>`
            }
          </section>

          <!-- LangGraph Checkpoints Table -->
          <section class="rounded-2xl border border-border-default bg-bg-card p-6">
            <div class="mb-4 flex items-center justify-between">
              <div>
                <h2 class="font-display text-base font-bold text-text-primary">${i18n.memory.checkpointsTitle}</h2>
                <p class="text-xs text-text-muted">${i18n.memory.checkpointsSubtitle}</p>
              </div>
              <span class="rounded-lg bg-accent/15 px-2.5 py-1 font-mono text-xs font-semibold text-accent">
                ${checkpoints.length}
              </span>
            </div>

            ${
              checkpoints.length > 0
                ? `
                  <div class="overflow-x-auto">
                    <table class="w-full text-left text-xs">
                      <thead class="border-b border-border-default text-text-muted">
                        <tr>
                          <th class="pb-2.5 font-semibold">Thread ID</th>
                          <th class="pb-2.5 font-semibold">Checkpoint ID</th>
                          <th class="pb-2.5 font-semibold">Parent ID</th>
                          <th class="pb-2.5 font-semibold">${i18n.memory.colUpdated}</th>
                        </tr>
                      </thead>
                      <tbody class="divide-y divide-border-subtle font-mono text-[11px]">
                        ${checkpoints
                          .slice(0, 30)
                          .map(
                            (cp) => `
                            <tr class="hover:bg-bg-elevated/40">
                              <td class="py-2.5 pr-3 text-primary">${cp.threadId}</td>
                              <td class="py-2.5 pr-3 text-text-secondary">${cp.checkpointId}</td>
                              <td class="py-2.5 pr-3 text-text-muted">${cp.parentCheckpointId || '—'}</td>
                              <td class="py-2.5 text-text-muted">${formatUpdatedTime(cp.createdAt)}</td>
                            </tr>
                          `,
                          )
                          .join('')}
                      </tbody>
                    </table>
                  </div>
                `
                : `<p class="rounded-xl border border-dashed border-border-default p-8 text-center text-xs text-text-muted">${i18n.memory.emptyCheckpoints}</p>`
            }
          </section>
        </main>
      </div>
    </div>
  `

  bindLangToggle(rerender)
  root.querySelector<HTMLButtonElement>('#theme-toggle')?.addEventListener('click', toggleTheme)
  root.querySelector<HTMLButtonElement>('#refresh-memory-btn')?.addEventListener('click', () => {
    rerender()
  })

  const searchInput = root.querySelector<HTMLInputElement>('#memory-search-input')
  searchInput?.addEventListener('change', () => {
    currentSearchQuery = searchInput.value.trim()
    rerender()
  })
  searchInput?.addEventListener('search', () => {
    currentSearchQuery = searchInput.value.trim()
    rerender()
  })
  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      currentSearchQuery = searchInput.value.trim()
      rerender()
    }
  })
}
