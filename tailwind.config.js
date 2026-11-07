/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,html}'],
  theme: {
    extend: {
      colors: {
        primary: 'rgb(var(--color-primary, 2 132 199) / <alpha-value>)',
        secondary: 'rgb(var(--color-secondary, 79 70 229) / <alpha-value>)',
        accent: 'rgb(var(--color-accent, 5 150 105) / <alpha-value>)',
        info: 'rgb(var(--color-info, 8 145 178) / <alpha-value>)',
        warning: 'rgb(var(--color-warning, 217 119 6) / <alpha-value>)',
        'bg-app': 'rgb(var(--color-bg-app, 245 248 246) / <alpha-value>)',
        'bg-card': 'rgb(var(--color-bg-card, 255 255 255) / <alpha-value>)',
        'bg-elevated': 'rgb(var(--color-bg-elevated, 255 255 255) / <alpha-value>)',
        'bg-sidebar': 'rgb(var(--color-bg-sidebar, 245 248 246) / <alpha-value>)',
        'text-primary': 'rgb(var(--color-text-primary, 28 41 38) / <alpha-value>)',
        'text-secondary': 'rgb(var(--color-text-secondary, 119 130 126) / <alpha-value>)',
        'text-muted': 'rgb(var(--color-text-muted, 119 130 126) / <alpha-value>)',
        'border-default': 'rgb(var(--color-border-default, 225 232 228) / <alpha-value>)',
        bg: {
          app: 'rgb(var(--color-bg-app, 245 248 246) / <alpha-value>)',
          card: 'rgb(var(--color-bg-card, 255 255 255) / <alpha-value>)',
          elevated: 'rgb(var(--color-bg-elevated, 255 255 255) / <alpha-value>)',
          sidebar: 'rgb(var(--color-bg-sidebar, 245 248 246) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--color-text-primary, 28 41 38) / <alpha-value>)',
          secondary: 'rgb(var(--color-text-secondary, 119 130 126) / <alpha-value>)',
          muted: 'rgb(var(--color-text-muted, 119 130 126) / <alpha-value>)',
        },
        border: {
          default: 'rgb(var(--color-border-default, 225 232 228) / <alpha-value>)',
        },
        brand: {
          primary: {
            light: 'var(--brand-primary-light, #1c2926)',
            dark: 'var(--brand-primary-dark, #edf5ef)',
          },
          secondary: {
            light: 'var(--brand-secondary-light, #c4f36b)',
            dark: 'var(--brand-secondary-dark, #b3df5e)',
          },
          accent: {
            light: 'var(--brand-accent-light, #87b743)',
            dark: 'var(--brand-accent-dark, #a9d85c)',
          },
          info: {
            light: 'var(--brand-info-light, #6395e6)',
            dark: 'var(--brand-info-dark, #8fb5f0)',
          },
          warning: {
            light: 'var(--brand-warning-light, #f0bd46)',
            dark: 'var(--brand-warning-dark, #f4ca68)',
          },
          canvas: {
            light: 'var(--brand-canvas-light, #f5f8f6)',
            dark: 'var(--brand-canvas-dark, #15211e)',
          },
          surface: {
            light: 'var(--brand-surface-light, #ffffff)',
            dark: 'var(--brand-surface-dark, #24332e)',
          },
          muted: {
            light: 'var(--brand-muted-light, #77827e)',
            dark: 'var(--brand-muted-dark, #a4b2aa)',
          },
          line: {
            light: 'var(--brand-line-light, #e1e8e4)',
            dark: 'var(--brand-line-dark, #35453e)',
          },
        },
      },
      fontFamily: {
        sans: ['var(--brand-font-sans, "Inter")', 'Roboto', 'DM Sans', 'sans-serif'],
        display: ['Space Grotesk', 'var(--brand-font-sans, "Inter")', 'sans-serif'],
      },
    },
  },
  plugins: [],
}
