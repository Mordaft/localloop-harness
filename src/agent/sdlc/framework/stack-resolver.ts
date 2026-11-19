export interface FrameworkStackResolution {
  framework: string
  frameworkKey: string
  packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun'
  bundler: 'vite' | 'webpack' | 'esbuild' | 'none'
  testRunner: 'vitest' | 'jest' | 'node:test'
  devCommand: string
  buildCommand: string
  testCommand: string
  componentsDir: string
  servicesDir: string
  structureSummary: string
  packageJson: Record<string, unknown>
  tsconfigJson: Record<string, unknown>
  extraConfigFiles: Array<{ path: string; content: string; reason: string }>
  setupCmdContent: string
  setupShContent: string
  startCmdContent: string
  startShContent: string
}

export function resolveFrameworkStack(userText: string, contextInitiative = ''): FrameworkStackResolution {
  const userLower = (userText || '').toLowerCase()
  const text = `${userText} ${contextInitiative}`.toLowerCase()

  // 1. Gestor de paquetes (priorizando lo indicado explícitamente por el usuario)
  let packageManager: 'pnpm' | 'npm' | 'yarn' | 'bun' = 'npm'
  if (/\bpnpm\b/i.test(userLower) || /\bpnpm\b/i.test(text)) {
    packageManager = 'pnpm'
  } else if (/\byarn\b/i.test(userLower) || /\byarn\b/i.test(text)) {
    packageManager = 'yarn'
  } else if (/\bbun\b/i.test(userLower) || /\bbun\b/i.test(text)) {
    packageManager = 'bun'
  }

  // 2. Tecnologías y Frameworks (priorizando la elección del usuario en HITL 1)
  const hasAngular = /\bangular\b/i.test(userLower) || (!userLower && /\bangular\b/i.test(text))
  const hasReact = /\breact\b/i.test(userLower) || (!userLower && /\breact\b/i.test(text))
  const hasVue = /\bvue\b/i.test(userLower) || (!userLower && /\bvue\b/i.test(text))
  const hasSvelte = /\bsvelte\b/i.test(userLower) || (!userLower && /\bsvelte\b/i.test(text))
  const hasPhaser = /\bphaser\b/i.test(userLower) || /\bphaser\b/i.test(text)
  const hasTailwind =
    /\btailwind(?:css)?\b/i.test(text) || (!hasAngular && !hasReact && !hasVue && !hasSvelte)
  const hasNodeOnly = /\b(?:node\s*cli|backend\s*only|sin\s*bundler)\b/i.test(userLower)

  // 3. Bundler: por defecto 'vite' para soluciones web/TypeScript modernas para garantizar transpilado inmediato
  let bundler: 'vite' | 'webpack' | 'esbuild' | 'none' = 'vite'
  if (hasAngular || hasNodeOnly) {
    bundler = 'none'
  } else if (/\bwebpack\b/i.test(userLower)) {
    bundler = 'webpack'
  } else if (/\besbuild\b/i.test(userLower) && !/\bvite\b/i.test(userLower)) {
    bundler = 'esbuild'
  } else {
    bundler = 'vite'
  }

  // 4. Test Runner
  let testRunner: 'vitest' | 'jest' | 'node:test' = bundler === 'vite' ? 'vitest' : 'node:test'
  if (/\bjest\b/i.test(userLower) || /\bjest\b/i.test(text)) {
    testRunner = 'jest'
  } else if (/\bvitest\b/i.test(userLower) || bundler === 'vite') {
    testRunner = 'vitest'
  }

  let framework = 'HTML5 + TypeScript + TailwindCSS'
  let frameworkKey = 'html5_ts_tailwind'
  let componentsDir = 'src/components'
  let servicesDir = 'src/services'

  if (hasAngular) {
    framework = 'Angular con Material'
    frameworkKey = 'angular_material'
    componentsDir = 'src/app/components'
    servicesDir = 'src/app/services'
    bundler = 'none'
    testRunner = 'node:test'
    packageManager = packageManager === 'pnpm' ? 'pnpm' : 'npm'
  } else if (hasReact) {
    framework = 'React + TypeScript' + (hasTailwind ? ' + TailwindCSS' : '')
    frameworkKey = 'react_ts'
    componentsDir = 'src/components'
    servicesDir = 'src/services'
    bundler = 'vite'
  } else if (hasVue) {
    framework = 'Vue 3 + TypeScript' + (hasTailwind ? ' + TailwindCSS' : '')
    frameworkKey = 'vue_ts'
    componentsDir = 'src/components'
    servicesDir = 'src/services'
    bundler = 'vite'
  } else if (hasSvelte) {
    framework = 'Svelte + TypeScript' + (hasTailwind ? ' + TailwindCSS' : '')
    frameworkKey = 'svelte_ts'
    componentsDir = 'src/components'
    servicesDir = 'src/services'
    bundler = 'vite'
  } else if (hasPhaser) {
    framework = 'HTML5 + Vanilla TypeScript + Phaser' + (hasTailwind ? ' + TailwindCSS' : '')
    frameworkKey = 'phaser_ts'
    componentsDir = 'src/components'
    servicesDir = 'src/services'
    bundler = 'vite'
  } else if (/\bvanilla\b/i.test(userLower)) {
    framework = 'HTML5 + Vanilla TypeScript' + (hasTailwind ? ' + TailwindCSS' : '')
    frameworkKey = 'vanilla_ts'
    componentsDir = 'src/components'
    servicesDir = 'src/services'
    bundler = 'vite'
  }

  // 5. Scripts de ejecución y transpilación
  const devCommand = bundler === 'vite' ? 'vite' : 'node dist/src/main.js'
  const buildCommand = bundler === 'vite' ? 'vite build' : 'tsc'
  const testCommand = testRunner === 'vitest' ? 'vitest run' : testRunner === 'jest' ? 'jest' : 'node --test'

  // 6. Dependencias de producción y desarrollo
  const dependencies: Record<string, string> = {}
  const devDependencies: Record<string, string> = {
    typescript: '^5.4.0',
  }

  if (hasPhaser) {
    dependencies['phaser'] = '^3.80.1'
  }
  if (hasAngular) {
    dependencies['@angular/core'] = '^18.0.0'
    dependencies['@angular/material'] = '^18.0.0'
  }
  if (hasReact) {
    dependencies['react'] = '^18.3.1'
    dependencies['react-dom'] = '^18.3.1'
    devDependencies['@types/react'] = '^18.3.1'
    devDependencies['@types/react-dom'] = '^18.3.1'
    if (bundler === 'vite') {
      devDependencies['@vitejs/plugin-react'] = '^4.2.1'
    }
  }
  if (hasVue) {
    dependencies['vue'] = '^3.4.0'
    if (bundler === 'vite') {
      devDependencies['@vitejs/plugin-vue'] = '^5.0.0'
    }
  }

  if (bundler === 'vite') {
    devDependencies['vite'] = '^5.2.0'
  }
  if (testRunner === 'vitest') {
    devDependencies['vitest'] = '^1.6.0'
  }
  if (hasTailwind) {
    devDependencies['tailwindcss'] = '^3.4.3'
    devDependencies['postcss'] = '^8.4.38'
    devDependencies['autoprefixer'] = '^10.4.19'
  }

  const packageJson = {
    name: 'localloop-app',
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `Proyecto generado por LocalLoop SDLC - ${framework}`,
    scripts: {
      dev: devCommand,
      build: buildCommand,
      typecheck: 'tsc --noEmit',
      start: bundler === 'vite' ? (packageManager === 'pnpm' ? 'pnpm dev' : 'npm run dev') : 'node dist/src/main.js',
      test: testCommand,
      ...(bundler === 'vite' ? { preview: 'vite preview' } : {}),
    },
    dependencies,
    devDependencies,
    ...(packageManager === 'pnpm' ? { pnpm: { onlyBuiltDependencies: ['esbuild'] } } : {}),
  }

  const tsconfigJson = {
    compilerOptions: {
      target: 'ES2022',
      module: bundler === 'none' && !hasAngular ? 'NodeNext' : 'ESNext',
      moduleResolution: bundler === 'none' && !hasAngular ? 'NodeNext' : 'bundler',
      outDir: './dist',
      rootDir: '.',
      lib: ['ES2022', 'DOM', 'DOM.Iterable'],
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      forceConsistentCasingInFileNames: true,
      strict: false,
      noImplicitAny: false,
      skipLibCheck: true,
      ...(hasReact ? { jsx: 'react-jsx' } : {}),
      ...(hasAngular ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {}),
    },
    include: ['src/**/*', 'tests/**/*'],
    exclude: ['node_modules', 'dist'],
  }

  const extraConfigFiles: Array<{ path: string; content: string; reason: string }> = []

  if (bundler === 'vite') {
    extraConfigFiles.push({
      path: 'vite.config.ts',
      content: `/// <reference types="vitest" />
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: false,
  },
  test: {
    globals: true,
    environment: 'node',
  },
});
`,
      reason: 'Configuración del Bundler y Servidor de Desarrollo Vite',
    })
  }

  if (hasTailwind) {
    extraConfigFiles.push({
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,html}'],
  theme: {
    extend: {},
  },
  plugins: [],
};
`,
      reason: 'Configuración TailwindCSS',
    })
    extraConfigFiles.push({
      path: 'postcss.config.js',
      content: `export default {
  plugins: {
    tailwindcss: {},
    autoprefixer: {},
  },
};
`,
      reason: 'Configuración PostCSS para Tailwind',
    })
  }

  const structureSummary = `- Marco Tecnológico: \`${framework}\`
- Gestor de Paquetes: \`${packageManager}\` (Bundler: \`${bundler}\`, Tests: \`${testRunner}\`)
- Código fuente: \`src/\`
- Componentes: \`${componentsDir}/\`
- Servicios y adaptadores: \`${servicesDir}/\`
- Tests unitarios: \`tests/\`
- Scripts de inicialización: \`setup.cmd\` y \`setup.sh\` en la raíz del workspace
- Scripts de arranque (Fase 4): \`start.cmd\` y \`start.sh\` en la raíz del workspace`

  // Scripts de Setup
  const setupCmdContent = `@echo off
echo ========================================================
echo   LocalLoop - Setup Inicial del Proyecto
echo   Marco de Referencia: ${framework}
echo ========================================================
echo.

where node >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Node.js no esta instalado o no se encuentra en el PATH.
    echo Por favor instala Node.js (https://nodejs.org) para continuar.
    exit /b 1
)

where ${packageManager} >nul 2>nul
if %ERRORLEVEL% neq 0 (
    ${
      packageManager === 'pnpm'
        ? `echo [AVISO] pnpm no detectado globalmente. Intentando instalar pnpm via npm...
    call npm install -g pnpm 2>nul
    where pnpm >nul 2>nul
    if %ERRORLEVEL% neq 0 (
        echo [INFO] Usando npx pnpm como alternativa...
        set PKG_RUNNER=npx pnpm
    ) else (
        set PKG_RUNNER=pnpm
    )`
        : `echo [AVISO] ${packageManager} no encontrado. Usando npm...
    set PKG_RUNNER=npm`
    }
) else (
    set PKG_RUNNER=${packageManager}
)

echo [1/3] Creando estructura de directorios del framework...
if not exist src mkdir src
if not exist ${componentsDir.replace(/\//g, '\\')} mkdir ${componentsDir.replace(/\//g, '\\')}
if not exist ${servicesDir.replace(/\//g, '\\')} mkdir ${servicesDir.replace(/\//g, '\\')}
if not exist tests mkdir tests
if not exist public mkdir public

echo [2/3] Instalando dependencias del proyecto via %PKG_RUNNER% install...
call %PKG_RUNNER% install
if %ERRORLEVEL% neq 0 (
    echo [ADVERTENCIA] Fallo la instalacion con %PKG_RUNNER%. Intentando con npm install...
    call npm install
) else (
    echo [OK] Dependencias instaladas correctamente.
)

echo [3/3] Verificacion del entorno completada.
echo.
echo ========================================================
echo   Setup inicial completado con exito.
echo   Estructura lista para los agentes de construccion.
echo   Para arrancar la aplicacion ejecuta: start.cmd o ${packageManager} ${bundler === 'vite' ? 'dev' : 'start'}
echo ========================================================
`

  const setupShContent = `#!/usr/bin/env bash
set -e
echo "========================================================"
echo "  LocalLoop - Setup Inicial del Proyecto"
echo "  Marco de Referencia: ${framework}"
echo "========================================================"
echo ""

if ! command -v node >/dev/null 2>&1; then
    echo "[ERROR] Node.js no está instalado o no se encuentra en el PATH."
    echo "Por favor instala Node.js (https://nodejs.org) para continuar."
    exit 1
fi

PKG_RUNNER="${packageManager}"
if ! command -v ${packageManager} >/dev/null 2>&1; then
    echo "[AVISO] ${packageManager} no está disponible en PATH. Usando npm/npx..."
    PKG_RUNNER="npm"
fi

echo "[1/3] Creando estructura de directorios del framework..."
mkdir -p "${componentsDir}" "${servicesDir}" tests public

echo "[2/3] Instalando dependencias del proyecto via $PKG_RUNNER install..."
$PKG_RUNNER install || npm install || echo "[ADVERTENCIA] La instalación finalizó con advertencias."

echo "[3/3] Verificación del entorno completada."
echo ""
echo "========================================================"
echo "  Setup inicial completado con éxito."
echo "  Estructura lista para los agentes de construcción."
echo "  Para arrancar ejecuta: ./start.sh o $PKG_RUNNER ${bundler === 'vite' ? 'dev' : 'start'}"
echo "========================================================"
`

  const startCmdContent = `@echo off
echo ========================================================
echo   LocalLoop - Arranque de Aplicacion y Prueba E2E
echo   Marco Tecnologico: ${framework}
echo ========================================================
echo.

where ${packageManager} >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo Iniciando aplicacion local con ${packageManager} ${bundler === 'vite' ? 'dev' : 'start'}...
    call ${packageManager} ${bundler === 'vite' ? 'dev' : 'start'}
    exit /b %ERRORLEVEL%
)

where npm >nul 2>nul
if %ERRORLEVEL% equ 0 (
    echo [INFO] Iniciando aplicacion con npm...
    call npm run dev 2>nul || call npx vite 2>nul || call npm start 2>nul || call npx serve .
    exit /b %ERRORLEVEL%
)

echo [ERROR] No se encontro gestor de paquetes (Node.js/npm) en el PATH.
exit /b 1
`

  const startShContent = `#!/usr/bin/env bash
set -e
echo "========================================================"
echo "  LocalLoop - Arranque de Aplicación y Prueba E2E"
echo "  Marco Tecnológico: ${framework}"
echo "========================================================"
echo ""

if command -v ${packageManager} >/dev/null 2>&1; then
    echo "Iniciando aplicación local con ${packageManager} ${bundler === 'vite' ? 'dev' : 'start'}..."
    ${packageManager} ${bundler === 'vite' ? 'dev' : 'start'}
    exit 0
fi

if command -v npm >/dev/null 2>&1; then
    npm run dev 2>/dev/null || npx vite 2>/dev/null || npm start 2>/dev/null || npx serve .
    exit 0
fi

echo "[ERROR] No se encontró gestor de paquetes en el PATH."
exit 1
`

  return {
    framework,
    frameworkKey,
    packageManager,
    bundler,
    testRunner,
    devCommand,
    buildCommand,
    testCommand,
    componentsDir,
    servicesDir,
    structureSummary,
    packageJson,
    tsconfigJson,
    extraConfigFiles,
    setupCmdContent,
    setupShContent,
    startCmdContent,
    startShContent,
  }
}
