import type { SupportedLanguage, TranslationDictionary } from './types'
import { es } from './locales/es'
import { en } from './locales/en'
import { SessionStatus, type SessionStatus as SessionStatusType } from '../enums'

export type { SupportedLanguage, TranslationDictionary } from './types'

const STORAGE_KEY = 'localloop-lang'

const dictionaries: Record<SupportedLanguage, TranslationDictionary> = {
  es,
  en,
}

function detectInitialLanguage(): SupportedLanguage {
  if (typeof window === 'undefined' || typeof localStorage === 'undefined') return 'es'
  const saved = localStorage.getItem(STORAGE_KEY)
  if (saved === 'es' || saved === 'en') return saved
  if (typeof navigator !== 'undefined' && navigator.language && navigator.language.toLowerCase().startsWith('en')) {
    return 'en'
  }
  return 'es'
}

let currentLanguage: SupportedLanguage = detectInitialLanguage()

if (typeof document !== 'undefined') {
  document.documentElement.lang = currentLanguage
}

type LanguageListener = (lang: SupportedLanguage) => void
const listeners: LanguageListener[] = []

export function getLanguage(): SupportedLanguage {
  return currentLanguage
}

export function setLanguage(lang: SupportedLanguage) {
  if (lang !== 'es' && lang !== 'en') return
  currentLanguage = lang
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, lang)
  }
  if (typeof document !== 'undefined') {
    document.documentElement.lang = lang
  }
  for (const listener of [...listeners]) {
    try {
      listener(lang)
    } catch (error) {
      console.error('Error in language listener:', error)
    }
  }
}

export function toggleLanguage(): SupportedLanguage {
  const nextLang: SupportedLanguage = currentLanguage === 'es' ? 'en' : 'es'
  setLanguage(nextLang)
  return nextLang
}

export function onLanguageChange(listener: LanguageListener): () => void {
  listeners.push(listener)
  return () => {
    const index = listeners.indexOf(listener)
    if (index >= 0) listeners.splice(index, 1)
  }
}

function resolvePath(obj: unknown, path: string): unknown {
  const segments = path.split('.')
  let current: unknown = obj
  for (const segment of segments) {
    if (current && typeof current === 'object' && segment in current) {
      current = (current as Record<string, unknown>)[segment]
    } else {
      return undefined
    }
  }
  return current
}

export function initI18n(): void {
  currentLanguage = detectInitialLanguage()
  if (typeof document !== 'undefined') {
    document.documentElement.lang = currentLanguage
  }
}

export function formatText(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (match, key) => {
    return key in params ? String(params[key]) : match
  })
}

export function t(): TranslationDictionary
export function t(path: string, params?: Record<string, string | number>): string
export function t(
  path?: string,
  params?: Record<string, string | number>,
): TranslationDictionary | string {
  const langDict = dictionaries[currentLanguage]
  if (!path) {
    return langDict
  }
  const fallbackDict = dictionaries.es

  let raw = resolvePath(langDict, path)
  if (typeof raw !== 'string') {
    raw = resolvePath(fallbackDict, path)
  }
  if (typeof raw !== 'string') {
    return path
  }

  if (!params) return raw
  return formatText(raw, params)
}

export function tStatus(status: SessionStatusType | number | string): string {
  const dict = dictionaries[currentLanguage].domain.statuses
  switch (status) {
    case SessionStatus.RUNNING:
    case 'running':
      return dict.running
    case SessionStatus.WAITING_APPROVAL:
    case 'waiting_approval':
      return dict.waitingApproval
    case SessionStatus.COMPLETED:
    case 'completed':
      return dict.completed
    case SessionStatus.BUDGET_EXCEEDED:
    case 'budget_exceeded':
      return dict.budgetExceeded
    case SessionStatus.ERROR:
    case 'error':
      return dict.error
    case SessionStatus.IDLE:
    case 'idle':
    default:
      return dict.idle
  }
}

export const translateStatus = tStatus

export function formatRelativeTime(dateInput?: string | number | Date | null): string {
  if (!dateInput) {
    return currentLanguage === 'es' ? 'Ahora' : 'Just now'
  }
  if (typeof dateInput === 'string' && (dateInput.toLowerCase() === 'ahora' || dateInput.toLowerCase() === 'now')) {
    return currentLanguage === 'es' ? 'Ahora' : 'Just now'
  }

  const timestamp = typeof dateInput === 'string' || typeof dateInput === 'number'
    ? new Date(dateInput).getTime()
    : dateInput.getTime()

  if (Number.isNaN(timestamp)) {
    return currentLanguage === 'es' ? 'Ahora' : 'Just now'
  }

  const diffSeconds = Math.round((timestamp - Date.now()) / 1000)
  const absSeconds = Math.abs(diffSeconds)

  if (absSeconds < 45) {
    return currentLanguage === 'es' ? 'Ahora' : 'Just now'
  }

  const rtf = new Intl.RelativeTimeFormat(currentLanguage, { numeric: 'auto' })

  let formatted: string
  if (absSeconds < 3600) {
    const minutes = Math.round(diffSeconds / 60)
    formatted = rtf.format(minutes, 'minute')
  } else if (absSeconds < 86400) {
    const hours = Math.round(diffSeconds / 3600)
    formatted = rtf.format(hours, 'hour')
  } else if (absSeconds < 2592000) {
    const days = Math.round(diffSeconds / 86400)
    formatted = rtf.format(days, 'day')
  } else if (absSeconds < 31536000) {
    const months = Math.round(diffSeconds / 2592000)
    formatted = rtf.format(months, 'month')
  } else {
    const years = Math.round(diffSeconds / 31536000)
    formatted = rtf.format(years, 'year')
  }

  return formatted.charAt(0).toUpperCase() + formatted.slice(1)
}

export const formatUpdatedTime = formatRelativeTime
