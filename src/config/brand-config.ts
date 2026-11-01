export type BrandFontFamily = 'Inter' | 'Roboto'

export interface ThemeColorPair {
  light: string
  dark: string
}

export interface BrandConfig {
  companyName: string
  productHighlight: string
  logoSvgOrUrl: string
  fontFamily: BrandFontFamily
  colors: {
    primary: ThemeColorPair
    secondary: ThemeColorPair
    accent: ThemeColorPair
    info: ThemeColorPair
    warning: ThemeColorPair
  }
}

const STORAGE_KEY = 'localloop-brand-config'

export const defaultBrandConfig: BrandConfig = {
  companyName: 'LocalLoop',
  productHighlight: 'AI',
  logoSvgOrUrl: '',
  fontFamily: 'Inter',
  colors: {
    primary: { light: '#0284c7', dark: '#38bdf8' },
    secondary: { light: '#4f46e5', dark: '#818cf8' },
    accent: { light: '#059669', dark: '#34d399' },
    info: { light: '#0891b2', dark: '#22d3ee' },
    warning: { light: '#d97706', dark: '#fbbf24' },
  },
}

export function hexToRgbTriplet(hex: string): string {
  const clean = hex.replace('#', '').trim()
  if (clean.length === 3) {
    const r = parseInt(clean[0] + clean[0], 16)
    const g = parseInt(clean[1] + clean[1], 16)
    const b = parseInt(clean[2] + clean[2], 16)
    return `${r} ${g} ${b}`
  }
  if (clean.length === 6) {
    const r = parseInt(clean.slice(0, 2), 16)
    const g = parseInt(clean.slice(2, 4), 16)
    const b = parseInt(clean.slice(4, 6), 16)
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      return `${r} ${g} ${b}`
    }
  }
  return '56 189 248'
}

export function rgbTripletToHex(value: string): string {
  const trimmed = value.trim()
  if (trimmed.startsWith('#')) return trimmed
  const parts = trimmed.split(/\s+/).map(Number)
  if (parts.length >= 3 && parts.every((n) => Number.isFinite(n))) {
    return (
      '#' +
      parts
        .slice(0, 3)
        .map((n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0'))
        .join('')
    )
  }
  return '#38bdf8'
}

function isValidHexOrCssColor(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length >= 3
}

export function getBrandConfig(): BrandConfig {
  if (typeof localStorage === 'undefined') return structuredClone(defaultBrandConfig)
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return structuredClone(defaultBrandConfig)
  try {
    const parsed = JSON.parse(raw) as Partial<BrandConfig>
    return {
      companyName:
        typeof parsed.companyName === 'string' && parsed.companyName.trim()
          ? parsed.companyName.trim()
          : defaultBrandConfig.companyName,
      productHighlight:
        typeof parsed.productHighlight === 'string'
          ? parsed.productHighlight.trim()
          : defaultBrandConfig.productHighlight,
      logoSvgOrUrl: typeof parsed.logoSvgOrUrl === 'string' ? parsed.logoSvgOrUrl.trim() : '',
      fontFamily: parsed.fontFamily === 'Roboto' ? 'Roboto' : 'Inter',
      colors: {
        primary: {
          light: isValidHexOrCssColor(parsed.colors?.primary?.light)
            ? parsed.colors!.primary.light
            : defaultBrandConfig.colors.primary.light,
          dark: isValidHexOrCssColor(parsed.colors?.primary?.dark)
            ? parsed.colors!.primary.dark
            : defaultBrandConfig.colors.primary.dark,
        },
        secondary: {
          light: isValidHexOrCssColor(parsed.colors?.secondary?.light)
            ? parsed.colors!.secondary.light
            : defaultBrandConfig.colors.secondary.light,
          dark: isValidHexOrCssColor(parsed.colors?.secondary?.dark)
            ? parsed.colors!.secondary.dark
            : defaultBrandConfig.colors.secondary.dark,
        },
        accent: {
          light: isValidHexOrCssColor(parsed.colors?.accent?.light)
            ? parsed.colors!.accent.light
            : defaultBrandConfig.colors.accent.light,
          dark: isValidHexOrCssColor(parsed.colors?.accent?.dark)
            ? parsed.colors!.accent.dark
            : defaultBrandConfig.colors.accent.dark,
        },
        info: {
          light: isValidHexOrCssColor(parsed.colors?.info?.light)
            ? parsed.colors!.info.light
            : defaultBrandConfig.colors.info.light,
          dark: isValidHexOrCssColor(parsed.colors?.info?.dark)
            ? parsed.colors!.info.dark
            : defaultBrandConfig.colors.info.dark,
        },
        warning: {
          light: isValidHexOrCssColor(parsed.colors?.warning?.light)
            ? parsed.colors!.warning.light
            : defaultBrandConfig.colors.warning.light,
          dark: isValidHexOrCssColor(parsed.colors?.warning?.dark)
            ? parsed.colors!.warning.dark
            : defaultBrandConfig.colors.warning.dark,
        },
      },
    }
  } catch {
    return structuredClone(defaultBrandConfig)
  }
}

export function saveBrandConfig(config: BrandConfig): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config))
  }
  applyBrandCssVariables(config)
}

export function resetBrandConfig(): BrandConfig {
  if (typeof localStorage !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY)
  }
  const fresh = structuredClone(defaultBrandConfig)
  applyBrandCssVariables(fresh)
  return fresh
}

export function applyBrandCssVariables(config: BrandConfig = getBrandConfig()): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const isDark = root.classList.contains('dark')
  const { colors, fontFamily } = config

  root.style.setProperty('--font-sans-family', `'${fontFamily}', system-ui, sans-serif`)
  root.style.setProperty(
    '--color-primary',
    hexToRgbTriplet(isDark ? colors.primary.dark : colors.primary.light),
  )
  root.style.setProperty(
    '--color-secondary',
    hexToRgbTriplet(isDark ? colors.secondary.dark : colors.secondary.light),
  )
  root.style.setProperty(
    '--color-accent',
    hexToRgbTriplet(isDark ? colors.accent.dark : colors.accent.light),
  )
  root.style.setProperty(
    '--color-info',
    hexToRgbTriplet(isDark ? colors.info.dark : colors.info.light),
  )
  root.style.setProperty(
    '--color-warning',
    hexToRgbTriplet(isDark ? colors.warning.dark : colors.warning.light),
  )
}
