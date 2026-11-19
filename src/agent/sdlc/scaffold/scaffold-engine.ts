import type {
  ProjectArchetype,
  ProjectRuntime,
  UniversalProjectScaffold,
} from '../../sdlc-state'
import { executeFileSystemTool } from '../../../fs/fs-tools'
import { writeWorkspaceFileDirect } from '../../../fs/workspace-fs'
import { FsWriteMode } from '../../../enums'

export interface ArchetypeClassification {
  runtime: ProjectRuntime
  archetype: ProjectArchetype
  hasUI: boolean
  frameworkTitle: string
}

/**
 * Clasifica de forma analítica el runtime, arquetipo y necesidad de UI
 * a partir de la intención del usuario y requerimientos de negocio.
 */
export function detectProjectArchetype(
  userText: string,
  contextInitiative = '',
): ArchetypeClassification {
  const combined = `${userText} ${contextInitiative}`.toLowerCase()

  // 1. Detección de Runtime / Lenguaje
  let runtime: ProjectRuntime = 'node'
  if (/\b(?:godot|c#|csharp|\.net|dotnet)\b/i.test(combined)) {
    runtime = 'csharp'
  } else if (/\b(?:go|golang)\b/i.test(combined)) {
    runtime = 'go'
  } else if (/\b(?:python|fastapi|flask|django|pyproject)\b/i.test(combined)) {
    runtime = 'python'
  } else if (/\b(?:rust|cargo)\b/i.test(combined)) {
    runtime = 'rust'
  } else if (/\b(?:flutter|dart)\b/i.test(combined)) {
    runtime = 'dart'
  }

  // 2. Detección de presencia de interfaz de usuario (UI)
  const explicitUiKeywords =
    /\b(?:web|ui|frontend|portal|html|css|react|vue|svelte|angular|phaser|tailwind|dom|canvas|view|pantalla|interfaz|pwa)\b/i
  const explicitBackendKeywords =
    /\b(?:backend|servicio|servicios|service|services|microservice|microservicio|daemon|worker|cli|api|rest|grpc|redis|database|bbdd|cache)\b/i

  let hasUI = false
  if (runtime === 'csharp') {
    // Para Godot / C#, es aplicación nativa de escritorio o consola, no UI web/DOM
    hasUI = false
  } else if (runtime === 'node') {
    // Para Node, si pide explícitamente backend/cli sin UI, no lleva UI. Si no, por defecto en Node suele ser WebApp
    const isBackendOnly =
      explicitBackendKeywords.test(combined) &&
      !explicitUiKeywords.test(combined) &&
      /\b(?:backend\s*only|sin\s*ui|sin\s*frontend|api\s*only|cli|daemon)\b/i.test(combined)
    hasUI = !isBackendOnly
  } else {
    // Para Go, Python, Rust: SOLO lleva UI si se pide explícitamente frontend / webapp
    hasUI = explicitUiKeywords.test(combined) && /\b(?:fullstack|frontend|con\s*ui|con\s*web)\b/i.test(combined)
  }

  // 3. Detección de Arquetipo
  let archetype: ProjectArchetype = 'API_SERVICE'
  const isWebGame = /\b(?:phaser|pixi|three|canvas|html5|webgl)\b/i.test(combined)
  const isDesktopGame =
    !isWebGame &&
    (/\b(?:godot|unity|unreal)\b/i.test(combined) ||
      (/\b(?:juego|game)\b/i.test(combined) &&
        /\b(?:escritorio|desktop|nativo|c#|csharp|c\+\+|godot|window)\b/i.test(combined)))

  if (isDesktopGame) {
    archetype = 'GAME_DESKTOP'
    hasUI = false
  } else if (hasUI || isWebGame) {
    archetype = 'WEB_APP'
    hasUI = true
  } else if (/\b(?:cli|consola|terminal|command\s*line|herramienta\s*cli)\b/i.test(combined)) {
    archetype = 'CLI_TOOL'
  } else if (/\b(?:worker|consumer|daemon|cola|queue|background)\b/i.test(combined)) {
    archetype = 'WORKER_SERVICE'
  } else {
    archetype = 'API_SERVICE'
  }

  // 4. Título descriptivo del marco de trabajo
  let frameworkTitle = 'Desarrollo de Software'
  if (runtime === 'csharp') {
    const isGodot = /\bgodot\b/i.test(combined) || archetype === 'GAME_DESKTOP'
    frameworkTitle = isGodot ? 'Godot 4 + C# (.NET 8)' : 'C# (.NET 8)'
  } else if (runtime === 'go') {
    const hasRedis = /\bredis\b/i.test(combined)
    frameworkTitle = `GoLang (Go Modules)${hasRedis ? ' + Redis' : ''}`
  } else if (runtime === 'python') {
    frameworkTitle = 'Python (FastAPI / Pytest)'
  } else if (runtime === 'rust') {
    frameworkTitle = 'Rust (Cargo)'
  } else if (runtime === 'dart') {
    frameworkTitle = 'Flutter + Dart'
  } else {
    if (/\bangular\b/i.test(combined)) frameworkTitle = 'Angular con Material'
    else if (/\breact\b/i.test(combined)) frameworkTitle = 'React + TypeScript'
    else if (/\bvue\b/i.test(combined)) frameworkTitle = 'Vue 3 + TypeScript'
    else if (/\bsvelte\b/i.test(combined)) frameworkTitle = 'Svelte + TypeScript'
    else if (/\bphaser\b/i.test(combined)) frameworkTitle = 'HTML5 + TypeScript + Phaser'
    else if (!hasUI) frameworkTitle = 'Node.js Backend / CLI'
    else frameworkTitle = 'HTML5 + TypeScript + TailwindCSS'
  }

  return { runtime, archetype, hasUI, frameworkTitle }
}

/**
 * Construye el Scaffold Universal agnóstico al lenguaje (Go, Node, Python, etc.)
 * con manifiestos, esqueleto de código, scripts de ciclo de vida y arnés de pruebas.
 */
export function buildUniversalScaffold(params: {
  userText: string
  contextInitiative?: string
  initiativeTitle?: string
  declaredDependencies?: Record<string, string>
  declaredDevDependencies?: Record<string, string>
  proposedScaffold?: Partial<UniversalProjectScaffold>
}): UniversalProjectScaffold {
  const { userText, contextInitiative = '', initiativeTitle = 'LocalLoop Project' } = params
  const cleanTitle = initiativeTitle.replace(/[<>"'&]/g, '').trim() || 'LocalLoop Project'
  const classification = detectProjectArchetype(userText, contextInitiative)
  const combined = `${userText} ${contextInitiative}`.toLowerCase()

  // Si el LLM ya propuso una arquitectura y scaffolding formal a través de propose_project_scaffold,
  // la propuesta del LLM es la fuente de verdad primaria y se adopta de forma íntegra y soberana.
  if (params.proposedScaffold && params.proposedScaffold.manifestFiles && params.proposedScaffold.manifestFiles.length > 0) {
    const p = params.proposedScaffold
    return {
      runtime: p.runtime || classification.runtime,
      archetype: p.archetype || classification.archetype,
      frameworkTitle: p.frameworkTitle || classification.frameworkTitle,
      hasUI: typeof p.hasUI === 'boolean' ? p.hasUI : classification.hasUI,
      packageManager: p.packageManager,
      componentDirectory: p.componentDirectory || (classification.runtime === 'csharp' ? 'scripts' : 'src/components'),
      serviceDirectory: p.serviceDirectory || (classification.runtime === 'csharp' ? 'scripts' : 'src/services'),
      testDirectory: p.testDirectory || 'tests',
      fileExtension: p.fileExtension || (classification.runtime === 'csharp' ? 'cs' : classification.runtime === 'go' ? 'go' : classification.runtime === 'python' ? 'py' : 'ts'),
      manifestFiles: p.manifestFiles,
      configFiles: p.configFiles || [],
      skeletonFiles: p.skeletonFiles || [],
      dependencies: p.dependencies || {
        runtime: params.declaredDependencies || {},
        devOrTest: params.declaredDevDependencies || {},
      },
      testing: p.testing || {
        unitTestRunner: p.lifecycle?.testCmd || 'test',
        unitTestDir: p.testDirectory || 'tests',
        e2eTestRunner: p.lifecycle?.testCmd || 'test',
        e2eTestDir: p.testDirectory || 'tests',
      },
      lifecycle: p.lifecycle || {
        setupCmd: '@echo off\necho Setup...',
        setupSh: '#!/usr/bin/env bash\necho "Setup..."',
        startCmd: '@echo off\necho Start...',
        startSh: '#!/usr/bin/env bash\necho "Start..."',
        testCmd: 'test',
        testSh: 'test',
      },
    }
  }

  const { runtime, archetype, hasUI } = classification

  // ==========================================
  // ARQUETIPO: C# / GODOT (.NET)
  // ==========================================
  if (runtime === 'csharp') {
    const moduleSlug =
      cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'game'
    const isGodot = /\bgodot\b/i.test(combined) || archetype === 'GAME_DESKTOP'

    const csprojContent = `<Project Sdk="${isGodot ? 'Godot.NET.Sdk/4.3.0' : 'Microsoft.NET.Sdk'}">
  <PropertyGroup>
    <TargetFramework>net8.0</TargetFramework>
    <EnableDynamicLoading>true</EnableDynamicLoading>
    <Nullable>enable</Nullable>
  </PropertyGroup>
</Project>
`
    const projectGodotContent = `; Engine configuration file.
; It's best edited using the editor UI and not directly,
; but can also be edited by text editors.

config_version=5

[application]

config/name="${cleanTitle}"
run/main_scene="res://scenes/Main.tscn"
config/features=PackedStringArray("4.3", "C#")

[rendering]

renderer/rendering_method="forward_plus"
`
    const mainTscnContent = `[gd_scene load_steps=2 format=3]

[ext_resource type="Script" path="res://scripts/Main.cs" id="1_main"]

[node name="Main" type="Node2D"]
script = ExtResource("1_main")
`
    const mainCsContent = `using Godot;

public partial class Main : Node2D
{
    public override void _Ready()
    {
        GD.Print("[Godot C#] ${cleanTitle} inicializado con exito.");
    }
}
`
    const manifestFiles = [
      { path: `${moduleSlug}.csproj`, content: csprojContent, purpose: 'Manifiesto de proyecto .NET C#' },
    ]
    if (isGodot) {
      manifestFiles.unshift({ path: 'project.godot', content: projectGodotContent, purpose: 'Manifiesto principal de Godot Engine' })
    }

    const configFiles: Array<{ path: string; content: string; purpose: string }> = []
    if (isGodot) {
      configFiles.push({ path: 'scenes/Main.tscn', content: mainTscnContent, purpose: 'Escena principal de inicio de Godot' })
    }

    const skeletonFiles = [
      { path: 'scripts/Main.cs', content: mainCsContent, purpose: 'Punto de entrada de script C#' },
    ]

    const setupCmd = `@echo off
echo ========================================================
echo   LocalLoop - Setup Inicial (${classification.frameworkTitle})
echo ========================================================
where dotnet >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] .NET SDK no esta instalado en el PATH.
    exit /b 1
)
echo [1/2] Restaurando dependencias .NET...
call dotnet restore
echo [2/2] Compilando solucion C#...
call dotnet build
echo Setup completado exitosamente.
`
    const setupSh = `#!/usr/bin/env bash
set -e
echo "========================================================"
echo "  LocalLoop - Setup Inicial (${classification.frameworkTitle})"
echo "========================================================"
if ! command -v dotnet &> /dev/null; then
    echo "[ERROR] .NET SDK no está instalado en el PATH."
    exit 1
fi
echo "[1/2] Restaurando dependencias .NET..."
dotnet restore
echo "[2/2] Compilando solución C#..."
dotnet build
echo "Setup completado exitosamente."
`
    const startCmd = `@echo off
echo Iniciando ${classification.frameworkTitle}...
where godot >nul 2>nul
if %ERRORLEVEL% equ 0 (
    call godot --path .
) else (
    echo [INFO] Binario 'godot' no detectado en PATH. Compilando con dotnet...
    call dotnet build
)
`
    const startSh = `#!/usr/bin/env bash
echo "Iniciando ${classification.frameworkTitle}..."
if command -v godot &> /dev/null; then
    godot --path .
else
    echo "[INFO] 'godot' no detectado en PATH. Compilando con dotnet..."
    dotnet build
fi
`

    return {
      runtime: 'csharp',
      archetype,
      frameworkTitle: classification.frameworkTitle,
      hasUI: false,
      componentDirectory: 'scripts',
      serviceDirectory: 'scripts',
      testDirectory: 'tests',
      fileExtension: 'cs',
      manifestFiles,
      configFiles,
      skeletonFiles,
      dependencies: {
        runtime: params.declaredDependencies || {},
        devOrTest: params.declaredDevDependencies || {},
      },
      testing: {
        unitTestRunner: 'dotnet test',
        unitTestDir: 'tests',
        e2eTestRunner: 'dotnet test',
        e2eTestDir: 'tests',
      },
      lifecycle: {
        setupCmd,
        setupSh,
        startCmd,
        startSh,
        testCmd: 'dotnet test',
        testSh: 'dotnet test',
      },
    }
  }

  // ==========================================
  // ARQUETIPO: GOLANG (Go Modules)
  // ==========================================
  if (runtime === 'go') {
    const moduleSlug =
      cleanTitle
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '') || 'service'
    const hasRedis = /\bredis\b/i.test(combined)

    const runtimeDeps: Record<string, string> = { ...(params.declaredDependencies || {}) }
    if (hasRedis && !runtimeDeps['github.com/redis/go-redis/v9']) {
      runtimeDeps['github.com/redis/go-redis/v9'] = 'v9.5.1'
    }

    const goModRequire = Object.entries(runtimeDeps)
      .map(([pkg, ver]) => `\t${pkg} ${ver}`)
      .join('\n')

    const goModContent = `module ${moduleSlug}

go 1.22

${goModRequire ? `require (\n${goModRequire}\n)\n` : ''}`

    const configFiles: Array<{ path: string; content: string; purpose: string }> = []
    if (hasRedis) {
      configFiles.push({
        path: 'docker-compose.yml',
        content: `version: '3.8'

services:
  redis:
    image: redis:7-alpine
    container_name: ${moduleSlug}-redis
    ports:
      - "6379:6379"
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
`,
        purpose: 'Entorno de base de datos temporal Redis en contenedor local',
      })
    }

    const mainGoContent = `package main

import (
\t"context"
\t"fmt"
\t"log"
\t"net/http"
\t"os"
\t"os/signal"
\t"syscall"
\t"time"
)

func main() {
\tlog.Printf("[GoLang Service] Iniciando %s...", "${cleanTitle}")

\tmux := http.NewServeMux()

\t// Healthcheck y endpoint de estado del servicio
\tmux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
\t\tw.Header().Set("Content-Type", "application/json")
\t\tw.WriteHeader(http.StatusOK)
\t\tfmt.Fprintf(w, "{\\"status\\":\\"UP\\",\\"service\\":\\"%s\\",\\"time\\":\\"%s\\"}", "${cleanTitle}", time.Now().UTC().Format(time.RFC3339))
\t})

\tmux.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
\t\tw.Header().Set("Content-Type", "application/json")
\t\tfmt.Fprintf(w, "{\\"message\\":\\"Bienvenido a %s\\",\\"status\\":\\"READY\\"}", "${cleanTitle}")
\t})

\tport := os.Getenv("PORT")
\tif port == "" {
\t\tport = "8080"
\t}

\tserver := &http.Server{
\t\tAddr:         ":" + port,
\t\tHandler:      mux,
\t\tReadTimeout:  10 * time.Second,
\t\tWriteTimeout: 10 * time.Second,
\t}

\tgo func() {
\t\tlog.Printf("🚀 Servidor escuchando en http://localhost:%s", port)
\t\tif err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
\t\t\tlog.Fatalf("Error en servidor HTTP: %v", err)
\t\t}
\t}()

\t// Graceful shutdown
\tstop := make(chan os.Signal, 1)
\tsignal.Notify(stop, os.Interrupt, syscall.SIGTERM)
\t<-stop

\tlog.Println("Cerrando servicio de forma ordenada...")
\tctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
\tdefer cancel()
\tif err := server.Shutdown(ctx); err != nil {
\t\tlog.Printf("Aviso cerrando servidor: %v", err)
\t}
\tlog.Println("Servidor cerrado.")
}
`

    const redisServiceContent = hasRedis
      ? `package cache

import (
\t"context"
\t"fmt"
\t"time"

\t"github.com/redis/go-redis/v9"
)

type RedisClient struct {
\tclient *redis.Client
}

func NewRedisClient(addr string) (*RedisClient, error) {
\tif addr == "" {
\t\taddr = "localhost:6379"
\t}
\trdb := redis.NewClient(&redis.Options{
\t\tAddr: addr,
\t})

\tctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
\tdefer cancel()

\tif err := rdb.Ping(ctx).Err(); err != nil {
\t\treturn nil, fmt.Errorf("error conectando a Redis en %s: %w", addr, err)
\t}

\treturn &RedisClient{client: rdb}, nil
}

func (r *RedisClient) Set(ctx context.Context, key string, value interface{}, expiration time.Duration) error {
\treturn r.client.Set(ctx, key, value, expiration).Err()
}

func (r *RedisClient) Get(ctx context.Context, key string) (string, error) {
\treturn r.client.Get(ctx, key).Result()
}
`
      : ''

    const skeletonFiles = [
      {
        path: 'cmd/server/main.go',
        content: mainGoContent,
        purpose: 'Punto de entrada principal del servicio en GoLang',
      },
    ]

    if (hasRedis && redisServiceContent) {
      skeletonFiles.push({
        path: 'internal/cache/redis.go',
        content: redisServiceContent,
        purpose: 'Adaptador de persistencia temporal y caché con Redis',
      })
    }

    const e2eTestContent = `package e2e_test

import (
\t"net/http"
\t"net/http/httptest"
\t"testing"
)

func TestServiceHealthCheckE2E(t *testing.T) {
\tmux := http.NewServeMux()
\tmux.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
\t\tw.WriteHeader(http.StatusOK)
\t\tw.Write([]byte("{\\"status\\":\\"UP\\"}"))
\t})

\treq := httptest.NewRequest("GET", "/health", nil)
\tw := httptest.NewRecorder()
\tmux.ServeHTTP(w, req)

\tif w.Code != http.StatusOK {
\t\tt.Fatalf("Esperado status 200, obtenido %d", w.Code)
\t}
}
`

    return {
      runtime: 'go',
      archetype,
      frameworkTitle: classification.frameworkTitle,
      hasUI: false,
      componentDirectory: 'internal/service',
      serviceDirectory: 'internal/service',
      testDirectory: 'tests/e2e',
      fileExtension: 'go',
      manifestFiles: [
        {
          path: 'go.mod',
          content: goModContent,
          purpose: 'Módulo principal Go y registro de dependencias',
        },
      ],
      configFiles,
      skeletonFiles,
      dependencies: {
        runtime: runtimeDeps,
        devOrTest: params.declaredDevDependencies || {},
      },
      testing: {
        unitTestRunner: 'go test -v ./internal/...',
        unitTestDir: 'internal',
        e2eTestRunner: 'go test -v ./tests/e2e/...',
        e2eTestDir: 'tests/e2e',
      },
      lifecycle: {
        setupCmd: `@echo off
echo ========================================================
echo   LocalLoop - Setup Inicial (GoLang + Go Modules)
echo ========================================================
where go >nul 2>nul
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Go no esta instalado en el PATH.
    exit /b 1
)
echo [1/2] Sincronizando dependencias Go (go mod tidy)...
call go mod tidy
${hasRedis ? 'if exist docker-compose.yml (\n    echo [2/2] Iniciando contenedor Redis...\n    call docker compose up -d redis 2>nul\n)' : ''}
echo Setup completado exitosamente.`,
        setupSh: `#!/usr/bin/env bash
set -e
echo "========================================================"
echo "  LocalLoop - Setup Inicial (GoLang + Go Modules)"
echo "========================================================"
if ! command -v go &> /dev/null; then
    echo "[ERROR] Go no está instalado o no se encuentra en el PATH."
    exit 1
fi
echo "[1/2] Sincronizando dependencias Go (go mod tidy)..."
go mod tidy
${hasRedis ? 'if [ -f docker-compose.yml ]; then\n    echo "[2/2] Iniciando contenedor Redis..."\n    docker compose up -d redis 2>/dev/null || true\nfi' : ''}
echo "Setup completado exitosamente."`,
        startCmd: `@echo off
echo Iniciando servicio GoLang...
call go run ./cmd/server/main.go`,
        startSh: `#!/usr/bin/env bash
echo "Iniciando servicio GoLang..."
go run ./cmd/server/main.go`,
        testCmd: 'go test -v ./...',
        testSh: 'go test -v ./...',
      },
    }
  }

  // ==========================================
  // ARQUETIPO: PYTHON
  // ==========================================
  if (runtime === 'python') {
    const pyprojectContent = `[project]
name = "${cleanTitle.toLowerCase().replace(/[^a-z0-9]+/g, '-')}"
version = "0.1.0"
description = "${cleanTitle} generado por LocalLoop SDLC"
dependencies = [
    "fastapi>=0.110.0",
    "uvicorn>=0.28.0",
]

[build-system]
requires = ["setuptools>=61.0"]
build-backend = "setuptools.build_meta"
`
    const mainPyContent = `from fastapi import FastAPI
import uvicorn

app = FastAPI(title="${cleanTitle}")

@app.get("/health")
def health():
    return {"status": "UP", "service": "${cleanTitle}"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
`

    return {
      runtime: 'python',
      archetype,
      frameworkTitle: classification.frameworkTitle,
      hasUI: false,
      componentDirectory: 'src/services',
      serviceDirectory: 'src/services',
      testDirectory: 'tests',
      manifestFiles: [
        { path: 'pyproject.toml', content: pyprojectContent, purpose: 'Configuración de proyecto Python' },
        { path: 'requirements.txt', content: "fastapi>=0.110.0\nuvicorn>=0.28.0\npytest>=8.0.0\n", purpose: 'Dependencias pip' },
      ],
      configFiles: [],
      skeletonFiles: [
        { path: 'src/main.py', content: mainPyContent, purpose: 'Punto de entrada de servicio FastAPI' },
      ],
      dependencies: { runtime: {}, devOrTest: {} },
      testing: {
        unitTestRunner: 'pytest tests/unit',
        unitTestDir: 'tests/unit',
        e2eTestRunner: 'pytest tests/e2e',
        e2eTestDir: 'tests/e2e',
      },
      lifecycle: {
        setupCmd: `@echo off\npip install -r requirements.txt`,
        setupSh: `#!/usr/bin/env bash\npip install -r requirements.txt`,
        startCmd: `@echo off\nuvicorn src.main:app --reload`,
        startSh: `#!/usr/bin/env bash\nuvicorn src.main:app --reload`,
        testCmd: 'pytest',
        testSh: 'pytest',
      },
    }
  }

  // ==========================================
  // ARQUETIPO: NODE.JS / WEBAPP O CLI
  // ==========================================
  const isAngular = /\bangular\b/i.test(combined)
  const isReact = /\breact\b/i.test(combined)
  const isVue = /\bvue\b/i.test(combined)
  const isSvelte = /\bsvelte\b/i.test(combined)
  const isPhaser = /\bphaser\b/i.test(combined)
  const hasTailwind =
    /\btailwind(?:css)?\b/i.test(combined) ||
    (!isAngular && !isReact && !isVue && !isSvelte && hasUI)

  const packageManager =
    /\bpnpm\b/i.test(userText) ? 'pnpm' : /\byarn\b/i.test(userText) ? 'yarn' : 'npm'
  const bundler = isAngular || !hasUI ? 'none' : 'vite'
  const testRunner = bundler === 'vite' ? 'vitest' : 'node:test'

  const dependencies: Record<string, string> = { ...(params.declaredDependencies || {}) }
  const devDependencies: Record<string, string> = {
    typescript: '^5.4.0',
    ...(params.declaredDevDependencies || {}),
  }

  if (isPhaser) dependencies['phaser'] = '^3.80.1'
  if (isAngular) {
    dependencies['@angular/core'] = '^18.0.0'
    dependencies['@angular/material'] = '^18.0.0'
  }
  if (isReact) {
    dependencies['react'] = '^18.3.1'
    dependencies['react-dom'] = '^18.3.1'
    devDependencies['@types/react'] = '^18.3.1'
    devDependencies['@types/react-dom'] = '^18.3.1'
    if (bundler === 'vite') devDependencies['@vitejs/plugin-react'] = '^4.2.1'
  }
  if (isVue) {
    dependencies['vue'] = '^3.4.0'
    if (bundler === 'vite') devDependencies['@vitejs/plugin-vue'] = '^5.0.0'
  }
  if (/\b(?:dexie|indexeddb)\b/i.test(combined) && !dependencies['dexie']) {
    dependencies['dexie'] = '^4.0.11'
  }
  if (bundler === 'vite') devDependencies['vite'] = '^5.2.0'
  if (testRunner === 'vitest') devDependencies['vitest'] = '^1.6.0'
  if (hasTailwind) {
    devDependencies['tailwindcss'] = '^3.4.3'
    devDependencies['postcss'] = '^8.4.38'
    devDependencies['autoprefixer'] = '^10.4.19'
  }

  const devCmd = bundler === 'vite' ? 'vite' : 'node dist/src/main.js'
  const buildCmd = bundler === 'vite' ? 'vite build' : 'tsc'
  const testCmd = testRunner === 'vitest' ? 'vitest run' : 'node --test'

  const packageJson = {
    name: 'localloop-app',
    version: '0.1.0',
    private: true,
    type: 'module',
    description: `${cleanTitle} - ${classification.frameworkTitle}`,
    scripts: {
      dev: devCmd,
      build: buildCmd,
      typecheck: 'tsc --noEmit',
      start: bundler === 'vite' ? `${packageManager === 'pnpm' ? 'pnpm dev' : 'npm run dev'}` : 'node dist/src/main.js',
      test: testCmd,
      ...(bundler === 'vite' ? { preview: 'vite preview' } : {}),
    },
    dependencies,
    devDependencies,
  }

  const tsconfigJson = {
    compilerOptions: {
      target: 'ES2022',
      module: bundler === 'none' && !isAngular ? 'NodeNext' : 'ESNext',
      moduleResolution: bundler === 'none' && !isAngular ? 'NodeNext' : 'bundler',
      outDir: './dist',
      rootDir: '.',
      lib: hasUI ? ['ES2022', 'DOM', 'DOM.Iterable'] : ['ES2022'],
      esModuleInterop: true,
      allowSyntheticDefaultImports: true,
      resolveJsonModule: true,
      forceConsistentCasingInFileNames: true,
      strict: false,
      noImplicitAny: false,
      skipLibCheck: true,
      ...(isReact ? { jsx: 'react-jsx' } : {}),
      ...(isAngular ? { experimentalDecorators: true, emitDecoratorMetadata: true } : {}),
    },
    include: ['src/**/*', 'tests/**/*'],
    exclude: ['node_modules', 'dist'],
  }

  const configFiles: Array<{ path: string; content: string; purpose: string }> = [
    { path: 'tsconfig.json', content: JSON.stringify(tsconfigJson, null, 2), purpose: 'Configuración TypeScript' },
  ]

  if (bundler === 'vite') {
    configFiles.push({
      path: 'vite.config.ts',
      content: `/// <reference types="vitest" />\nimport { defineConfig } from 'vite';\n\nexport default defineConfig({\n  server: { port: 3000, open: false },\n  test: { globals: true, environment: 'node' },\n});\n`,
      purpose: 'Configuración Bundler Vite',
    })
  }

  if (hasTailwind) {
    configFiles.push({
      path: 'tailwind.config.js',
      content: `/** @type {import('tailwindcss').Config} */\nexport default {\n  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx,html}'],\n  theme: { extend: {} },\n  plugins: [],\n};\n`,
      purpose: 'Configuración TailwindCSS',
    })
    configFiles.push({
      path: 'postcss.config.js',
      content: `export default {\n  plugins: { tailwindcss: {}, autoprefixer: {} },\n};\n`,
      purpose: 'Configuración PostCSS',
    })
  }

  const skeletonFiles: Array<{ path: string; content: string; purpose: string }> = []

  if (hasUI) {
    if (bundler === 'vite') {
      const styleCss = hasTailwind
        ? `@tailwind base;\n@tailwind components;\n@tailwind utilities;\n\n:root { color-scheme: light; }\nbody { margin: 0; font-family: system-ui, sans-serif; }\n`
        : `:root { color-scheme: light; }\nbody { margin: 0; font-family: system-ui, sans-serif; background: #f8fafc; color: #0f172a; }\n`
      skeletonFiles.push({
        path: 'src/style.css',
        content: styleCss,
        purpose: 'Estilos base del producto',
      })

      const scriptSrc = isReact ? '/src/main.tsx' : '/src/main.ts'
      const indexHtml = `<!DOCTYPE html>
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
      <div class="max-w-7xl mx-auto flex items-center justify-between">
        <div class="flex items-center space-x-3">
          <span class="text-xl">🚀</span>
          <h1 class="text-lg font-bold text-slate-800">${cleanTitle}</h1>
        </div>
        <span class="px-2.5 py-1 bg-slate-100 rounded-full border border-slate-200 text-xs font-medium text-slate-600">
          ${classification.frameworkTitle}
        </span>
      </div>
    </header>
    <main id="app-workspace" class="flex-1 max-w-7xl w-full mx-auto p-6 space-y-6">
      <div id="components-viewport" class="grid gap-6"></div>
    </main>
    <footer class="bg-white border-t border-slate-200 px-6 py-3 text-center text-xs text-slate-400">
      ${cleanTitle} &copy; ${new Date().getFullYear()}
    </footer>
  </div>
  <script type="module" src="${scriptSrc}"></script>
</body>
</html>
`
      skeletonFiles.push({
        path: 'index.html',
        content: indexHtml,
        purpose: 'Esqueleto y punto de entrada HTML de la WebApp',
      })

      if (isReact) {
        skeletonFiles.push({
          path: 'src/App.tsx',
          content: `import React from 'react'\n\nexport default function App() {\n  return (\n    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col">\n      <header className="bg-white border-b border-slate-200 px-6 py-4 shadow-sm">\n        <h1 className="text-lg font-bold">${cleanTitle}</h1>\n      </header>\n      <main id="app-workspace" className="p-6"><div id="components-viewport"></div></main>\n    </div>\n  )\n}\n`,
          purpose: 'Componente raíz App Shell de React',
        })
        skeletonFiles.push({
          path: 'src/main.tsx',
          content: `import React from 'react'\nimport ReactDOM from 'react-dom/client'\nimport App from './App'\nimport './style.css'\n\nReactDOM.createRoot(document.getElementById('root') || document.getElementById('app')!).render(\n  <React.StrictMode><App /></React.StrictMode>\n)\n`,
          purpose: 'Bootstrap TypeScript de React',
        })
      } else {
        skeletonFiles.push({
          path: 'src/main.ts',
          content: `import './style.css'\n\nexport function bootstrapApplication(): { initialized: string[]; mounted: number } {\n  console.log('[App] ${cleanTitle} inicializada.');\n  return { initialized: [], mounted: 0 };\n}\n\nif (typeof document !== 'undefined') {\n  if (document.readyState === 'loading') {\n    document.addEventListener('DOMContentLoaded', () => bootstrapApplication());\n  } else {\n    bootstrapApplication();\n  }\n}\n`,
          purpose: 'Bootstrap TypeScript de la WebApp',
        })
      }
    }
  } else {
    // Node Backend / CLI sin UI
    skeletonFiles.push({
      path: 'src/main.ts',
      content: `/**\n * ${cleanTitle} - Node.js Backend / CLI Daemon\n */\nconsole.log('[Service] Iniciando ${cleanTitle}...');\n\nexport function startService() {\n  console.log('[Service] Servicio en ejecucion.');\n}\n\nstartService();\n`,
      purpose: 'Punto de entrada daemon / servicio de Node.js',
    })
  }

  const componentsDir = isAngular ? 'src/app/components' : 'src/components'
  const servicesDir = isAngular ? 'src/app/services' : 'src/services'

  const setupCmd = `@echo off
echo ========================================================
echo   LocalLoop - Setup Inicial del Proyecto
echo   Marco de Referencia: ${classification.frameworkTitle}
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

  const setupSh = `#!/usr/bin/env bash
set -e
echo "========================================================"
echo "  LocalLoop - Setup Inicial del Proyecto"
echo "  Marco de Referencia: ${classification.frameworkTitle}"
echo "========================================================"
echo ""

if ! command -v node &> /dev/null; then
    echo "[ERROR] Node.js no está instalado o no se encuentra en el PATH."
    exit 1
fi

if command -v ${packageManager} &> /dev/null; then
    PKG_RUNNER=${packageManager}
else
    echo "[AVISO] ${packageManager} no encontrado en el PATH. Usando npm..."
    PKG_RUNNER=npm
fi

echo "[1/3] Creando estructura de directorios..."
mkdir -p src
mkdir -p ${componentsDir}
mkdir -p ${servicesDir}
mkdir -p tests
mkdir -p public

echo "[2/3] Instalando dependencias con $PKG_RUNNER install..."
$PKG_RUNNER install || npm install

echo "[3/3] Setup completado exitosamente."
`

  const startCmd = `@echo off
echo ========================================================
echo   LocalLoop - Arranque de Aplicacion y Prueba E2E
echo   Marco Tecnologico: ${classification.frameworkTitle}
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

  const startSh = `#!/usr/bin/env bash
set -e
echo "========================================================"
echo "  LocalLoop - Arranque de Aplicación y Prueba E2E"
echo "  Marco Tecnológico: ${classification.frameworkTitle}"
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
    runtime: 'node',
    archetype,
    frameworkTitle: classification.frameworkTitle,
    hasUI,
    packageManager,
    componentDirectory: componentsDir,
    serviceDirectory: servicesDir,
    testDirectory: 'tests',
    fileExtension: 'ts',
    manifestFiles: [
      {
        path: 'package.json',
        content: JSON.stringify(packageJson, null, 2),
        purpose: 'Manifiesto de paquetes y scripts npm',
      },
    ],
    configFiles,
    skeletonFiles,
    dependencies: {
      runtime: dependencies,
      devOrTest: devDependencies,
    },
    testing: {
      unitTestRunner: testRunner,
      unitTestDir: 'tests',
      e2eTestRunner: hasUI ? 'npx playwright test' : testCmd,
      e2eTestDir: 'tests/e2e',
    },
    lifecycle: {
      setupCmd,
      setupSh,
      startCmd,
      startSh,
      testCmd,
      testSh: testCmd,
    },
  }
}

/**
 * Materializa físicamente el scaffolding en el sistema de archivos del workspace.
 */
export async function materializeUniversalScaffold(
  scaffold: UniversalProjectScaffold,
  options?: {
    sessionId?: number
    onProposalCreated?: (id: number, path: string) => void
  },
): Promise<Array<{ path: string; bytesWritten: number }>> {
  const allFiles: Array<{ path: string; content: string; reason: string }> = [
    ...scaffold.manifestFiles.map((m) => ({ path: m.path, content: m.content, reason: m.purpose })),
    ...scaffold.configFiles.map((c) => ({ path: c.path, content: c.content, reason: c.purpose })),
    ...scaffold.skeletonFiles.map((s) => ({ path: s.path, content: s.content, reason: s.purpose })),
    { path: 'setup.cmd', content: scaffold.lifecycle.setupCmd, reason: 'Script de inicialización para Windows' },
    { path: 'setup.sh', content: scaffold.lifecycle.setupSh, reason: 'Script de inicialización para Linux/macOS' },
  ]

  const results: Array<{ path: string; bytesWritten: number }> = []

  for (const f of allFiles) {
    try {
      await executeFileSystemTool(
        'fs_write_file',
        { path: f.path, content: f.content, reason: f.reason },
        {
          sessionId: options?.sessionId || 0,
          fsWriteMode: FsWriteMode.AUTO,
          onProposalCreated: options?.onProposalCreated,
        },
      )
    } catch {
      // ignore
    }
    await writeWorkspaceFileDirect(f.path, f.content)
    results.push({ path: f.path, bytesWritten: f.content.length })
  }

  return results
}
