import type { UniversalProjectScaffold } from '../../sdlc-state'

export const defaultTsconfigJson = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    skipLibCheck: true,
  },
}

export interface InferScaffoldContextParams {
  initiativeTitle?: string
  userText?: string
  contextInitiative?: string
  content?: string
  phase0Data?: any
  marketArchStandard?: string
  declaredDependencies?: Record<string, string>
  declaredDevDependencies?: Record<string, string>
}

export interface ResolveScaffoldParams {
  rawProposed?: Partial<UniversalProjectScaffold>
  llmContent?: string
  initiativeTitle?: string
  initiativeNarrative?: string
  phase0Data?: any
  marketArchStandard?: string
  declaredDependencies?: Record<string, string>
  declaredDevDependencies?: Record<string, string>
}

/**
 * Extrae bloques de herramientas o propuestas de scaffolding en formato JSON o manifiestos
 * incluidos en el texto o bloques de código Markdown generados por el LLM.
 */
export function extractScaffoldProposalFromText(content: string): Partial<UniversalProjectScaffold> | null {
  if (!content || typeof content !== 'string') return null

  // 1. Buscar bloques de código ```json ... ``` o ``` ... ```
  const codeBlockRegex = /```(?:json)?\s*([\s\S]*?)```/gi
  let match: RegExpExecArray | null

  while ((match = codeBlockRegex.exec(content)) !== null) {
    const rawCode = match[1]?.trim()
    if (!rawCode || (!rawCode.startsWith('{') && !rawCode.startsWith('['))) continue

    try {
      const parsed = JSON.parse(rawCode)

      // Caso A: { name: 'propose_project_scaffold', args / arguments: { ... } }
      if (parsed && typeof parsed === 'object') {
        if (parsed.name === 'propose_project_scaffold') {
          const args = parsed.args || parsed.arguments
          if (args && typeof args === 'object') {
            return args as Partial<UniversalProjectScaffold>
          }
        }

        // Caso B: { propose_project_scaffold: { ... } }
        if (parsed.propose_project_scaffold && typeof parsed.propose_project_scaffold === 'object') {
          return parsed.propose_project_scaffold as Partial<UniversalProjectScaffold>
        }

        // Caso C: Objeto directo con runtime, archetype o manifestFiles
        if (
          (parsed.runtime && parsed.archetype) ||
          (Array.isArray(parsed.manifestFiles) && parsed.manifestFiles.length > 0)
        ) {
          return parsed as Partial<UniversalProjectScaffold>
        }

        // Caso D: Array de tool calls [{ name: 'propose_project_scaffold', ... }]
        if (Array.isArray(parsed)) {
          const found = parsed.find(
            (p) =>
              p &&
              typeof p === 'object' &&
              (p.name === 'propose_project_scaffold' || p.tool === 'propose_project_scaffold'),
          )
          if (found) {
            const args = found.args || found.arguments || found.parameters
            if (args && typeof args === 'object') {
              return args as Partial<UniversalProjectScaffold>
            }
          }
        }
      }
    } catch {
      // Ignorar bloques JSON inválidos y continuar buscando
    }
  }

  // 2. Extraer manifiestos de bloques de código Markdown con nombre de fichero (ej. ```json package.json)
  const fileBlocksRegex = /```(?:[a-z0-9_-]+)?\s*(?:(?:file|filename|path)[:=]\s*)?([a-zA-Z0-9_\-\.\/]+)\s*\n([\s\S]*?)```/gi
  const extractedFiles: Array<{ path: string; content: string; purpose: string }> = []

  while ((match = fileBlocksRegex.exec(content)) !== null) {
    const fileName = match[1]?.trim()
    const fileContent = match[2]?.trim()
    if (!fileName || !fileContent) continue

    const lower = fileName.toLowerCase()
    if (
      lower.endsWith('package.json') ||
      lower.endsWith('tsconfig.json') ||
      lower.endsWith('pyproject.toml') ||
      lower.endsWith('requirements.txt') ||
      lower.endsWith('go.mod') ||
      lower.endsWith('.csproj') ||
      lower.endsWith('project.godot') ||
      lower.endsWith('vite.config.ts') ||
      lower.endsWith('vite.config.js')
    ) {
      extractedFiles.push({
        path: fileName,
        content: fileContent,
        purpose: `Manifiesto o configuración extraída (${fileName})`,
      })
    }
  }

  if (extractedFiles.length > 0) {
    const hasPackageJson = extractedFiles.some((f) => f.path.toLowerCase().endsWith('package.json'))
    const hasPyproject = extractedFiles.some((f) => f.path.toLowerCase().endsWith('pyproject.toml') || f.path.toLowerCase().endsWith('requirements.txt'))
    const hasGoMod = extractedFiles.some((f) => f.path.toLowerCase().endsWith('go.mod'))
    const hasCsproj = extractedFiles.some((f) => f.path.toLowerCase().endsWith('.csproj') || f.path.toLowerCase().endsWith('project.godot'))

    let runtime = 'node'
    let archetype = 'WEB_APP'
    if (hasPyproject) {
      runtime = 'python'
      archetype = 'API_SERVICE'
    } else if (hasGoMod) {
      runtime = 'go'
      archetype = 'API_SERVICE'
    } else if (hasCsproj) {
      runtime = 'csharp'
      archetype = 'GAME_DESKTOP'
    } else if (hasPackageJson) {
      runtime = 'node'
      archetype = 'WEB_APP'
    }

    return {
      runtime,
      archetype,
      manifestFiles: extractedFiles,
    }
  }

  return null
}

/**
 * Infiere y construye una propuesta formal de UniversalProjectScaffold a partir de los datos
 * de contexto de la iniciativa, narrativa de Fase 0, requerimientos y dependencias declaradas.
 */
export function inferUniversalScaffoldFromContext(
  params: InferScaffoldContextParams,
): UniversalProjectScaffold {
  const combined = `${params.initiativeTitle || ''} ${params.userText || ''} ${params.contextInitiative || ''} ${params.content || ''}`.toLowerCase()
  const cleanTitle = (params.initiativeTitle || 'localloop-app').trim()
  const moduleSlug =
    cleanTitle
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'localloop-app'

  const pkgManager = /\bpnpm\b/i.test(combined) ? 'pnpm' : 'npm'
  const mergedRuntimeDeps = { ...(params.declaredDependencies || {}) }
  const mergedDevDeps = { ...(params.declaredDevDependencies || {}) }

  // 1. Stack: Godot Engine 4.x + C# (.NET 8)
  if (/\b(?:godot|c#|csharp|\.net|dotnet)\b/i.test(combined)) {
    return {
      runtime: 'csharp',
      archetype: 'GAME_DESKTOP',
      frameworkTitle: 'Godot 4 + C# (.NET 8)',
      hasUI: false,
      componentDirectory: 'scripts',
      serviceDirectory: 'scripts',
      testDirectory: 'tests',
      fileExtension: 'cs',
      manifestFiles: [
        {
          path: 'project.godot',
          content: `; Engine configuration file.\nconfig_version=5\n\n[application]\nconfig/name="${cleanTitle}"\nrun/main_scene="res://scenes/Main.tscn"\nconfig/features=PackedStringArray("4.3", "C#")\n\n[rendering]\nrenderer/rendering_method="forward_plus"\n`,
          purpose: 'Manifiesto principal de Godot Engine',
        },
        {
          path: `${moduleSlug}.csproj`,
          content: `<Project Sdk="Godot.NET.Sdk/4.3.0">\n  <PropertyGroup>\n    <TargetFramework>net8.0</TargetFramework>\n    <EnableDynamicLoading>true</EnableDynamicLoading>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n`,
          purpose: 'Manifiesto de proyecto .NET C#',
        },
      ],
      configFiles: [
        {
          path: 'scenes/Main.tscn',
          content: `[gd_scene load_steps=2 format=3]\n[ext_resource type="Script" path="res://scripts/Main.cs" id="1_main"]\n[node name="Main" type="Node2D"]\nscript = ExtResource("1_main")\n`,
          purpose: 'Escena principal de inicio de Godot',
        },
      ],
      skeletonFiles: [
        {
          path: 'scripts/Main.cs',
          content: `using Godot;\n\npublic partial class Main : Node2D\n{\n    public override void _Ready()\n    {\n        GD.Print("[Godot C#] ${cleanTitle} inicializado con exito.");\n    }\n}\n`,
          purpose: 'Punto de entrada C#',
        },
      ],
      dependencies: {
        runtime: mergedRuntimeDeps,
        devOrTest: mergedDevDeps,
      },
      testing: {
        unitTestRunner: 'dotnet test',
        unitTestDir: 'tests',
        e2eTestRunner: 'dotnet test',
        e2eTestDir: 'tests',
      },
      lifecycle: {
        setupCmd: `@echo off\nwhere dotnet >nul 2>nul\ncall dotnet restore\ncall dotnet build\n`,
        setupSh: `#!/usr/bin/env bash\ndotnet restore\ndotnet build\n`,
        startCmd: `@echo off\ngodot --path .\n`,
        startSh: `#!/usr/bin/env bash\ngodot --path .\n`,
        testCmd: 'dotnet test',
        testSh: 'dotnet test',
      },
    }
  }

  // 2. Stack: GoLang + Redis / Microservicio
  if (/\b(?:go|golang)\b/i.test(combined)) {
    const goDeps: Record<string, string> = {
      'github.com/redis/go-redis/v9': 'v9.5.1',
      ...mergedRuntimeDeps,
    }
    const goModRequires = Object.entries(goDeps)
      .map(([mod, ver]) => `\t${mod} ${ver}`)
      .join('\n')

    return {
      runtime: 'go',
      archetype: 'API_SERVICE',
      frameworkTitle: 'GoLang (Go Modules) + Redis',
      hasUI: false,
      componentDirectory: 'internal/service',
      serviceDirectory: 'internal/service',
      testDirectory: 'tests/e2e',
      fileExtension: 'go',
      manifestFiles: [
        {
          path: 'go.mod',
          content: `module ${moduleSlug}\n\ngo 1.22\n\nrequire (\n${goModRequires}\n)\n`,
          purpose: 'Módulo principal Go y registro de dependencias',
        },
      ],
      configFiles: [
        {
          path: 'docker-compose.yml',
          content: `version: '3.8'\nservices:\n  redis:\n    image: redis:7-alpine\n    container_name: ${moduleSlug}-redis\n    ports:\n      - "6379:6379"\n`,
          purpose: 'Entorno de base de datos temporal Redis',
        },
      ],
      skeletonFiles: [
        {
          path: 'cmd/server/main.go',
          content: `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n\nfunc main() {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {\n\t\tw.WriteHeader(http.StatusOK)\n\t\tfmt.Fprintf(w, "{\\"status\\":\\"UP\\"}")\n\t})\n\ts := &http.Server{Addr: ":8080", Handler: mux}\n\ts.ListenAndServe()\n}\n`,
          purpose: 'Punto de entrada principal del servicio en GoLang',
        },
      ],
      dependencies: {
        runtime: goDeps,
        devOrTest: mergedDevDeps,
      },
      testing: {
        unitTestRunner: 'go test -v ./internal/...',
        unitTestDir: 'internal',
        e2eTestRunner: 'go test -v ./tests/e2e/...',
        e2eTestDir: 'tests/e2e',
      },
      lifecycle: {
        setupCmd: `@echo off\ncall go mod tidy\ncall docker compose up -d redis 2>nul\n`,
        setupSh: `#!/usr/bin/env bash\ngo mod tidy\n`,
        startCmd: `@echo off\ncall go run ./cmd/server/main.go\n`,
        startSh: `#!/usr/bin/env bash\ngo run ./cmd/server/main.go\n`,
        testCmd: 'go test -v ./...',
        testSh: 'go test -v ./...',
      },
    }
  }

  // 3. Stack: Python / FastAPI
  if (/\b(?:python|fastapi|flask|django|uvicorn)\b/i.test(combined)) {
    const pythonDeps: Record<string, string> = {
      fastapi: '^0.111.0',
      uvicorn: '^0.30.1',
      pydantic: '^2.7.0',
      ...mergedRuntimeDeps,
    }
    const pyprojectContent = `[project]\nname = "${moduleSlug}"\nversion = "0.1.0"\ndescription = "${cleanTitle}"\ndependencies = [\n${Object.keys(pythonDeps).map((d) => `    "${d}",`).join('\n')}\n]\n\n[build-system]\nrequires = ["setuptools"]\nbuild-backend = "setuptools.build_meta"\n`
    const requirementsTxt = Object.keys(pythonDeps).join('\n') + '\npytest>=8.0.0\n'

    return {
      runtime: 'python',
      archetype: 'API_SERVICE',
      frameworkTitle: 'Python 3 + FastAPI',
      hasUI: false,
      componentDirectory: 'app/routers',
      serviceDirectory: 'app/services',
      testDirectory: 'tests',
      fileExtension: 'py',
      manifestFiles: [
        {
          path: 'pyproject.toml',
          content: pyprojectContent,
          purpose: 'Manifiesto pyproject.toml',
        },
        {
          path: 'requirements.txt',
          content: requirementsTxt,
          purpose: 'Dependencias pip',
        },
      ],
      configFiles: [
        {
          path: '.env.example',
          content: `PORT=8000\nENV=development\n`,
          purpose: 'Variables de entorno de ejemplo',
        },
      ],
      skeletonFiles: [
        {
          path: 'app/main.py',
          content: `from fastapi import FastAPI\n\napp = FastAPI(title="${cleanTitle}")\n\n@app.get("/health")\ndef health_check():\n    return {"status": "ok", "app": "${cleanTitle}"}\n`,
          purpose: 'Punto de entrada FastAPI',
        },
      ],
      dependencies: {
        runtime: pythonDeps,
        devOrTest: { pytest: '^8.0.0', ...mergedDevDeps },
      },
      testing: {
        unitTestRunner: 'pytest',
        unitTestDir: 'tests',
        e2eTestRunner: 'pytest tests/',
        e2eTestDir: 'tests',
      },
      lifecycle: {
        setupCmd: `@echo off\npython -m pip install -r requirements.txt\n`,
        setupSh: `#!/usr/bin/env bash\npython3 -m pip install -r requirements.txt\n`,
        startCmd: `@echo off\nuvicorn app.main:app --reload\n`,
        startSh: `#!/usr/bin/env bash\nuvicorn app.main:app --reload\n`,
        testCmd: 'pytest',
        testSh: 'pytest',
      },
    }
  }

  // 4. Stack: Angular con Material
  if (/\bangular\b/i.test(combined)) {
    const angularDeps: Record<string, string> = {
      '@angular/core': '^18.0.0',
      '@angular/material': '^18.0.0',
      ...mergedRuntimeDeps,
    }
    const angularDevDeps: Record<string, string> = {
      typescript: '^5.4.0',
      ...mergedDevDeps,
    }

    return {
      runtime: 'node',
      archetype: 'WEB_APP',
      frameworkTitle: 'Angular con Material',
      hasUI: true,
      packageManager: pkgManager,
      componentDirectory: 'src/app/components',
      serviceDirectory: 'src/app/services',
      testDirectory: 'tests',
      fileExtension: 'ts',
      manifestFiles: [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name: moduleSlug,
              version: '0.1.0',
              scripts: {
                build: 'tsc',
                test: 'node --test',
                start: `${pkgManager} run dev`,
                dev: 'node dist/src/main.js',
              },
              dependencies: angularDeps,
              devDependencies: angularDevDeps,
            },
            null,
            2,
          ),
          purpose: 'Manifiesto package.json',
        },
      ],
      configFiles: [
        {
          path: 'tsconfig.json',
          content: JSON.stringify(
            {
              compilerOptions: {
                target: 'ES2022',
                outDir: './dist',
                skipLibCheck: true,
                experimentalDecorators: true,
                emitDecoratorMetadata: true,
              },
            },
            null,
            2,
          ),
          purpose: 'Configuración TypeScript',
        },
      ],
      skeletonFiles: [
        {
          path: 'src/main.ts',
          content: `console.log("[Angular] ${cleanTitle} bootstrap");\nexport function bootstrap() { return true; }\n`,
          purpose: 'Bootstrap Angular',
        },
      ],
      dependencies: {
        runtime: angularDeps,
        devOrTest: angularDevDeps,
      },
      testing: {
        unitTestRunner: 'node:test',
        unitTestDir: 'tests',
        e2eTestRunner: 'node:test',
        e2eTestDir: 'tests',
      },
      lifecycle: {
        setupCmd: `@echo off\necho LocalLoop setup\ncall ${pkgManager} install\n`,
        setupSh: `#!/usr/bin/env bash\necho "LocalLoop setup"\n${pkgManager} install\n`,
        startCmd: `@echo off\ncall ${pkgManager} run dev\n`,
        startSh: `#!/usr/bin/env bash\n${pkgManager} run dev\n`,
        testCmd: 'node --test',
        testSh: 'node --test',
      },
    }
  }

  // 5. Stack: Phaser + TypeScript
  if (/\bphaser\b/i.test(combined)) {
    const phaserDeps: Record<string, string> = {
      phaser: '^3.80.1',
      ...mergedRuntimeDeps,
    }
    const phaserDevDeps: Record<string, string> = {
      typescript: '^5.4.0',
      vite: '^5.2.0',
      vitest: '^1.6.0',
      tailwindcss: '^3.4.3',
      ...mergedDevDeps,
    }

    return {
      runtime: 'node',
      archetype: 'WEB_APP',
      frameworkTitle: 'HTML5 + Vanilla TypeScript + Phaser + TailwindCSS',
      hasUI: true,
      packageManager: pkgManager,
      componentDirectory: 'src/components',
      serviceDirectory: 'src/services',
      testDirectory: 'tests',
      fileExtension: 'ts',
      manifestFiles: [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name: moduleSlug,
              version: '0.1.0',
              type: 'module',
              scripts: {
                dev: 'vite',
                build: 'vite build',
                start: `${pkgManager} dev`,
                test: 'vitest run',
              },
              dependencies: phaserDeps,
              devDependencies: phaserDevDeps,
            },
            null,
            2,
          ),
          purpose: 'Manifiesto package.json',
        },
      ],
      configFiles: [
        {
          path: 'tsconfig.json',
          content: JSON.stringify(defaultTsconfigJson, null, 2),
          purpose: 'Configuración TypeScript',
        },
        {
          path: 'vite.config.ts',
          content: `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`,
          purpose: 'Configuración Vite',
        },
      ],
      skeletonFiles: [
        {
          path: 'src/main.ts',
          content: `import Phaser from 'phaser';\nconsole.log("[Phaser] Juego inicializado.");\nexport const game = new Phaser.Game({ width: 800, height: 600 });\n`,
          purpose: 'Punto de entrada Phaser',
        },
      ],
      dependencies: {
        runtime: phaserDeps,
        devOrTest: phaserDevDeps,
      },
      testing: {
        unitTestRunner: 'vitest',
        unitTestDir: 'tests',
        e2eTestRunner: 'vitest run',
        e2eTestDir: 'tests/e2e',
      },
      lifecycle: {
        setupCmd: `@echo off\necho LocalLoop setup\nwhere ${pkgManager} >nul 2>nul\ncall ${pkgManager} install\n`,
        setupSh: `#!/usr/bin/env bash\necho "LocalLoop setup"\n${pkgManager} install\n`,
        startCmd: `@echo off\necho LocalLoop start\ncall ${pkgManager} dev\n`,
        startSh: `#!/usr/bin/env bash\necho "LocalLoop start"\n${pkgManager} dev\n`,
        testCmd: 'vitest run',
        testSh: 'vitest run',
      },
    }
  }

  // 6. Stack: React + Vite + TypeScript
  if (/\b(?:react|next\.?js)\b/i.test(combined)) {
    const reactDeps: Record<string, string> = {
      react: '^18.3.1',
      'react-dom': '^18.3.1',
      ...mergedRuntimeDeps,
    }
    const reactDevDeps: Record<string, string> = {
      '@types/react': '^18.3.3',
      '@types/react-dom': '^18.3.0',
      typescript: '^5.4.0',
      vite: '^5.2.0',
      vitest: '^1.6.0',
      tailwindcss: '^3.4.3',
      ...mergedDevDeps,
    }

    return {
      runtime: 'node',
      archetype: 'WEB_APP',
      frameworkTitle: 'React + TypeScript + Vite + TailwindCSS',
      hasUI: true,
      packageManager: pkgManager,
      componentDirectory: 'src/components',
      serviceDirectory: 'src/services',
      testDirectory: 'tests',
      fileExtension: 'tsx',
      manifestFiles: [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name: moduleSlug,
              version: '0.1.0',
              type: 'module',
              scripts: {
                dev: 'vite',
                build: 'vite build',
                start: `${pkgManager} dev`,
                test: 'vitest run',
              },
              dependencies: reactDeps,
              devDependencies: reactDevDeps,
            },
            null,
            2,
          ),
          purpose: 'Manifiesto package.json',
        },
      ],
      configFiles: [
        {
          path: 'tsconfig.json',
          content: JSON.stringify(
            {
              compilerOptions: {
                ...defaultTsconfigJson.compilerOptions,
                jsx: 'react-jsx',
              },
            },
            null,
            2,
          ),
          purpose: 'Configuración TypeScript con JSX',
        },
        {
          path: 'vite.config.ts',
          content: `import { defineConfig } from 'vite';\nexport default defineConfig({});\n`,
          purpose: 'Configuración Vite',
        },
      ],
      skeletonFiles: [
        {
          path: 'index.html',
          content: `<!DOCTYPE html>\n<html lang="es">\n<head><meta charset="UTF-8" /><title>${cleanTitle}</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body>\n</html>\n`,
          purpose: 'Entrada HTML',
        },
        {
          path: 'src/main.tsx',
          content: `import React from 'react';\nimport ReactDOM from 'react-dom/client';\nimport App from './App';\n\nReactDOM.createRoot(document.getElementById('root')!).render(<App />);\n`,
          purpose: 'Entrada React',
        },
        {
          path: 'src/App.tsx',
          content: `import React from 'react';\n\nexport default function App() {\n  return <div><h1>${cleanTitle}</h1></div>;\n}\n`,
          purpose: 'Componente principal React',
        },
      ],
      dependencies: {
        runtime: reactDeps,
        devOrTest: reactDevDeps,
      },
      testing: {
        unitTestRunner: 'vitest',
        unitTestDir: 'tests',
        e2eTestRunner: 'vitest run',
        e2eTestDir: 'tests/e2e',
      },
      lifecycle: {
        setupCmd: `@echo off\necho LocalLoop setup\ncall ${pkgManager} install\n`,
        setupSh: `#!/usr/bin/env bash\necho "LocalLoop setup"\n${pkgManager} install\n`,
        startCmd: `@echo off\ncall ${pkgManager} dev\n`,
        startSh: `#!/usr/bin/env bash\n${pkgManager} dev\n`,
        testCmd: 'vitest run',
        testSh: 'vitest run',
      },
    }
  }

  // 7. Stack Estándar Universal: HTML5 + TypeScript + Vite + TailwindCSS + Dexie.js
  const webDeps: Record<string, string> = {
    dexie: '^4.0.11',
    ...mergedRuntimeDeps,
  }
  const webDevDeps: Record<string, string> = {
    typescript: '^5.4.0',
    vite: '^5.2.0',
    vitest: '^1.6.0',
    tailwindcss: '^3.4.3',
    ...mergedDevDeps,
  }

  return {
    runtime: 'node',
    archetype: 'WEB_APP',
    frameworkTitle: 'HTML5 + TypeScript + TailwindCSS',
    hasUI: true,
    packageManager: pkgManager,
    componentDirectory: 'src/components',
    serviceDirectory: 'src/services',
    testDirectory: 'tests',
    fileExtension: 'ts',
    manifestFiles: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: moduleSlug,
            version: '0.1.0',
            type: 'module',
            scripts: {
              dev: 'vite',
              build: 'vite build',
              start: `${pkgManager} run dev`,
              test: 'vitest run',
            },
            dependencies: webDeps,
            devDependencies: webDevDeps,
          },
          null,
          2,
        ),
        purpose: 'Manifiesto de paquetes y scripts npm',
      },
    ],
    configFiles: [
      {
        path: 'tsconfig.json',
        content: JSON.stringify(defaultTsconfigJson, null, 2),
        purpose: 'Configuración TypeScript',
      },
      {
        path: 'vite.config.ts',
        content: `export default {};\n`,
        purpose: 'Configuración Vite',
      },
    ],
    skeletonFiles: [
      {
        path: 'src/style.css',
        content: `:root { color-scheme: light; }\nbody { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; }\n`,
        purpose: 'Estilos base del producto',
      },
      {
        path: 'index.html',
        content: `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${cleanTitle}</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen">
  <div id="app" class="min-h-screen flex flex-col">
    <header class="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
      <h1 class="text-lg font-bold text-slate-800">${cleanTitle}</h1>
    </header>
    <main id="app-workspace" class="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
      <div id="components-viewport" class="grid gap-6"></div>
    </main>
  </div>
  <script type="module" src="/src/main.ts"></script>
</body>
</html>
`,
        purpose: 'Esqueleto y punto de entrada HTML de la WebApp',
      },
      {
        path: 'src/main.ts',
        content: `import './style.css'\n\nexport function bootstrapApplication(): { initialized: string[]; mounted: number } {\n  console.log('[App] ${cleanTitle} inicializada.');\n  return { initialized: [], mounted: 0 };\n}\n\nif (typeof document !== 'undefined') {\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', () => bootstrapApplication());\n  } else {\n    bootstrapApplication();\n  }\n}\n`,
        purpose: 'Bootstrap TypeScript de la WebApp',
      },
    ],
    dependencies: {
      runtime: webDeps,
      devOrTest: webDevDeps,
    },
    testing: {
      unitTestRunner: 'vitest',
      unitTestDir: 'tests',
      e2eTestRunner: 'vitest run',
      e2eTestDir: 'tests/e2e',
    },
    lifecycle: {
      setupCmd: `@echo off\necho LocalLoop setup\ncall ${pkgManager} install\n`,
      setupSh: `#!/usr/bin/env bash\necho "LocalLoop setup"\n${pkgManager} install\n`,
      startCmd: `@echo off\ncall ${pkgManager} dev\n`,
      startSh: `#!/usr/bin/env bash\n${pkgManager} dev\n`,
      testCmd: 'vitest run',
      testSh: 'vitest run',
    },
  }
}

/**
 * Resuelve y garantiza una propuesta completa de scaffolding:
 * 1. Comprueba si el objeto propuesto ya es completo y válido.
 * 2. Si falta o es incompleto, busca bloques JSON y manifiestos en el contenido del LLM.
 * 3. Si aún falta, genera la inferencia universal contextual combinando la definición de negocio.
 * 4. Fisiona dependencias declaradas y garantiza que los manifiestos nunca estén vacíos.
 */
export function resolveScaffoldProposal(
  params: ResolveScaffoldParams,
): UniversalProjectScaffold {
  let proposal: Partial<UniversalProjectScaffold> = { ...(params.rawProposed || {}) }

  const hasRuntime = Boolean(proposal.runtime && typeof proposal.runtime === 'string')
  const hasArchetype = Boolean(proposal.archetype && typeof proposal.archetype === 'string')
  const hasManifests = Array.isArray(proposal.manifestFiles) && proposal.manifestFiles.length > 0

  // Si la propuesta ya está completamente informada por una llamada a herramienta explícita
  if (hasRuntime && hasArchetype && hasManifests) {
    const baseInferred = inferUniversalScaffoldFromContext({
      initiativeTitle: params.initiativeTitle,
      userText: params.initiativeNarrative,
      content: params.llmContent,
      phase0Data: params.phase0Data,
      marketArchStandard: params.marketArchStandard,
      declaredDependencies: params.declaredDependencies,
      declaredDevDependencies: params.declaredDevDependencies,
    })

    return {
      ...baseInferred,
      ...proposal,
      runtime: proposal.runtime!,
      archetype: proposal.archetype!,
      manifestFiles: proposal.manifestFiles!,
      configFiles: proposal.configFiles || baseInferred.configFiles,
      skeletonFiles: proposal.skeletonFiles || baseInferred.skeletonFiles,
      lifecycle: {
        ...baseInferred.lifecycle,
        ...(proposal.lifecycle || {}),
      },
      dependencies: {
        runtime: {
          ...baseInferred.dependencies.runtime,
          ...(proposal.dependencies?.runtime || {}),
          ...(params.declaredDependencies || {}),
        },
        devOrTest: {
          ...baseInferred.dependencies.devOrTest,
          ...(proposal.dependencies?.devOrTest || {}),
          ...(params.declaredDevDependencies || {}),
        },
      },
    }
  }

  // Intentar extraer del texto Markdown generado por el LLM
  if (params.llmContent) {
    const extracted = extractScaffoldProposalFromText(params.llmContent)
    if (extracted) {
      proposal = {
        ...extracted,
        ...proposal,
      }
    }
  }

  // Si aún faltan campos críticos, inferir la base universal
  const baseInferred = inferUniversalScaffoldFromContext({
    initiativeTitle: params.initiativeTitle,
    userText: params.initiativeNarrative,
    content: params.llmContent,
    phase0Data: params.phase0Data,
    marketArchStandard: params.marketArchStandard,
    declaredDependencies: params.declaredDependencies,
    declaredDevDependencies: params.declaredDevDependencies,
  })

  const finalManifests =
    Array.isArray(proposal.manifestFiles) && proposal.manifestFiles.length > 0
      ? proposal.manifestFiles
      : baseInferred.manifestFiles

  const finalConfigs =
    Array.isArray(proposal.configFiles) && proposal.configFiles.length > 0
      ? proposal.configFiles
      : baseInferred.configFiles

  const finalSkeletons =
    Array.isArray(proposal.skeletonFiles) && proposal.skeletonFiles.length > 0
      ? proposal.skeletonFiles
      : baseInferred.skeletonFiles

  return {
    ...baseInferred,
    ...proposal,
    runtime: proposal.runtime || baseInferred.runtime,
    archetype: proposal.archetype || baseInferred.archetype,
    frameworkTitle: proposal.frameworkTitle || baseInferred.frameworkTitle,
    manifestFiles: finalManifests,
    configFiles: finalConfigs,
    skeletonFiles: finalSkeletons,
    dependencies: {
      runtime: {
        ...baseInferred.dependencies.runtime,
        ...(proposal.dependencies?.runtime || {}),
        ...(params.declaredDependencies || {}),
      },
      devOrTest: {
        ...baseInferred.dependencies.devOrTest,
        ...(proposal.dependencies?.devOrTest || {}),
        ...(params.declaredDevDependencies || {}),
      },
    },
    lifecycle: {
      ...baseInferred.lifecycle,
      ...(proposal.lifecycle || {}),
    },
  }
}
