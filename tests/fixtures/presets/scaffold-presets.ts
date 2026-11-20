import type { UniversalProjectScaffold } from '../../../src/agent/sdlc-state'

const defaultTsconfigJson = {
  compilerOptions: {
    target: 'ES2022',
    module: 'ESNext',
    moduleResolution: 'bundler',
    lib: ['ES2022', 'DOM', 'DOM.Iterable'],
    skipLibCheck: true,
  },
}

/**
 * Fixture de prueba para resolución de scaffolding en tests deterministas offline (sin LLM vivo).
 * Mantiene el código de producción de scaffold-engine.ts 100% puro y genérico.
 */
export function getTestPresetScaffold(params: {
  initiativeTitle?: string
  userText?: string
  contextInitiative?: string
}): Partial<UniversalProjectScaffold> | null {
  const combined = `${params.initiativeTitle || ''} ${params.userText || ''} ${params.contextInitiative || ''}`.toLowerCase()

  // 1. Caso de prueba: Godot Engine 4 + C#
  if (/\b(?:godot|c#|csharp|\.net)\b/i.test(combined)) {
    const cleanTitle = (params.initiativeTitle || 'Cyberpunk Runner Game').trim()
    const moduleSlug =
      cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'game'

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
          content: `using Godot;\n\npublic partial class Main : Node2D\n{\n    public override void _Ready()\n    {\n        GD.Print("[Godot C#] Cyberpunk Runner Game inicializado con exito.");\n    }\n}\n`,
          purpose: 'Punto de entrada C#',
        },
      ],
      dependencies: { runtime: {}, devOrTest: {} },
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

  // 2. Caso de prueba: GoLang + Redis
  if (/\b(?:go|golang)\b/i.test(combined)) {
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
          content: `module session-cache-microservice\n\ngo 1.22\n\nrequire (\n\tgithub.com/redis/go-redis/v9 v9.5.1\n)\n`,
          purpose: 'Módulo principal Go y registro de dependencias',
        },
      ],
      configFiles: [
        {
          path: 'docker-compose.yml',
          content: `version: '3.8'\nservices:\n  redis:\n    image: redis:7-alpine\n    container_name: session-cache-redis\n    ports:\n      - "6379:6379"\n`,
          purpose: 'Entorno de base de datos temporal Redis',
        },
      ],
      skeletonFiles: [
        {
          path: 'cmd/server/main.go',
          content: `package main\n\nimport (\n\t"fmt"\n\t"net/http"\n)\n\nfunc main() {\n\tmux := http.NewServeMux()\n\tmux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {\n\t\tw.WriteHeader(http.StatusOK)\n\t\tfmt.Fprintf(w, "{\\"status\\":\\"UP\\"}")\n\t})\n\ts := &http.Server{Addr: ":8080", Handler: mux}\n\ts.ListenAndServe()\n}\n`,
          purpose: 'Punto de entrada principal del servicio en GoLang',
        },
        {
          path: 'internal/cache/redis.go',
          content: `package cache\n\nimport "github.com/redis/go-redis/v9"\n\ntype RedisClient struct {\n\tclient *redis.Client\n}\n\nfunc NewRedisClient(addr string) (*RedisClient, error) {\n\treturn &RedisClient{}, nil\n}\n`,
          purpose: 'Adaptador Redis',
        },
      ],
      dependencies: {
        runtime: { 'github.com/redis/go-redis/v9': 'v9.5.1' },
        devOrTest: {},
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

  // 3. Caso de prueba: Angular con Material
  if (/\bangular\b/i.test(combined)) {
    return {
      runtime: 'node',
      archetype: 'WEB_APP',
      frameworkTitle: 'Angular con Material',
      hasUI: true,
      packageManager: 'npm',
      componentDirectory: 'src/app/components',
      serviceDirectory: 'src/app/services',
      testDirectory: 'tests',
      fileExtension: 'ts',
      manifestFiles: [
        {
          path: 'package.json',
          content: JSON.stringify(
            {
              name: 'localloop-angular-app',
              version: '0.1.0',
              scripts: {
                build: 'tsc',
                test: 'node --test',
                start: 'npm run dev',
                dev: 'node dist/src/main.js',
              },
              dependencies: {
                '@angular/core': '^18.0.0',
                '@angular/material': '^18.0.0',
              },
              devDependencies: {
                typescript: '^5.4.0',
              },
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
      skeletonFiles: [],
      dependencies: {
        runtime: { '@angular/core': '^18.0.0', '@angular/material': '^18.0.0' },
        devOrTest: { typescript: '^5.4.0' },
      },
      testing: {
        unitTestRunner: 'node:test',
        unitTestDir: 'tests',
        e2eTestRunner: 'node:test',
        e2eTestDir: 'tests',
      },
      lifecycle: {
        setupCmd: `@echo off\necho LocalLoop setup\ncall npm install\n`,
        setupSh: `#!/usr/bin/env bash\necho "LocalLoop setup"\nnpm install\n`,
        startCmd: `@echo off\ncall npm run dev\n`,
        startSh: `#!/usr/bin/env bash\nnpm run dev\n`,
        testCmd: 'node --test',
        testSh: 'node --test',
      },
    }
  }

  // 4. Caso de prueba: Phaser + TypeScript (Tetris Phaser Game)
  if (/\bphaser\b/i.test(combined)) {
    const pkgManager = /\bpnpm\b/i.test(combined) ? 'pnpm' : 'npm'
    const phaserPackageJson = {
      name: 'localloop-phaser-app',
      version: '0.1.0',
      type: 'module',
      scripts: {
        dev: 'vite',
        build: 'vite build',
        start: `${pkgManager} dev`,
        test: 'vitest run',
      },
      dependencies: {
        phaser: '^3.80.1',
      },
      devDependencies: {
        typescript: '^5.4.0',
        vite: '^5.2.0',
        vitest: '^1.6.0',
        tailwindcss: '^3.4.3',
      },
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
          content: JSON.stringify(phaserPackageJson, null, 2),
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
      skeletonFiles: [],
      dependencies: {
        runtime: { phaser: '^3.80.1' },
        devOrTest: { typescript: '^5.4.0', vite: '^5.2.0', vitest: '^1.6.0', tailwindcss: '^3.4.3' },
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

  // 5. Caso de prueba general WebApp / TypeScript (Tetris PWA, Billing ERP, etc.)
  const packageJson = {
    name: 'localloop-app',
    version: '0.1.0',
    type: 'module',
    scripts: {
      dev: 'vite',
      build: 'vite build',
      start: 'npm run dev',
      test: 'vitest run',
    },
    dependencies: {
      dexie: '^4.0.11',
    },
    devDependencies: {
      typescript: '^5.4.0',
      vite: '^5.2.0',
      vitest: '^1.6.0',
      tailwindcss: '^3.4.3',
    },
  }

  return {
    runtime: 'node',
    archetype: 'WEB_APP',
    frameworkTitle: 'HTML5 + TypeScript + TailwindCSS',
    hasUI: true,
    packageManager: 'npm',
    componentDirectory: 'src/components',
    serviceDirectory: 'src/services',
    testDirectory: 'tests',
    fileExtension: 'ts',
    manifestFiles: [
      {
        path: 'package.json',
        content: JSON.stringify(packageJson, null, 2),
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
  <title>LocalLoop App</title>
  <link rel="stylesheet" href="/src/style.css" />
</head>
<body class="bg-slate-50 text-slate-900 min-h-screen">
  <div id="app" class="min-h-screen flex flex-col">
    <header class="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">
      <h1 class="text-lg font-bold text-slate-800">LocalLoop App</h1>
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
        content: `import './style.css'\n\nexport function bootstrapApplication(): { initialized: string[]; mounted: number } {\n  console.log('[App] inicializada.');\n  return { initialized: [], mounted: 0 };\n}\n\nif (typeof document !== 'undefined') {\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', () => bootstrapApplication());\n  } else {\n    bootstrapApplication();\n  }\n}\n`,
        purpose: 'Bootstrap TypeScript de la WebApp',
      },
    ],
    dependencies: {
      runtime: { dexie: '^4.0.11' },
      devOrTest: { typescript: '^5.4.0', vite: '^5.2.0' },
    },
    testing: {
      unitTestRunner: 'vitest',
      unitTestDir: 'tests',
      e2eTestRunner: 'vitest run',
      e2eTestDir: 'tests/e2e',
    },
    lifecycle: {
      setupCmd: `@echo off\necho LocalLoop setup\ncall npm install\n`,
      setupSh: `#!/usr/bin/env bash\necho "LocalLoop setup"\nnpm install\n`,
      startCmd: `@echo off\ncall npm run dev\n`,
      startSh: `#!/usr/bin/env bash\nnpm run dev\n`,
      testCmd: 'vitest run',
      testSh: 'vitest run',
    },
  }
}
