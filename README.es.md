# LocalLoop AI

> **Arnés Agéntico Minimalista y Local-First en formato Progressive Web App (PWA)**  
> Desarrollado con Vanilla TypeScript, LangGraph.js, Engram-TS, IndexedDB (Dexie), Web Workers y File System Access API.

**[English](README.md)** | **[Español](README.es.md)**

---

## Descripción General

**LocalLoop** es un entorno de trabajo agéntico 100 % descentralizado y ejecutado en el cliente, diseñado como una Single Page Application (SPA) y Progressive Web App (PWA). Se conecta directamente a motores LLM/SLM locales o compatibles con la API de OpenAI (como **Ollama**, **LM Studio**, **vLLM** o **llama.cpp**) garantizando privacidad total, coste cero de servidor y persistencia local extendida.

Todo el bucle de ejecución del agente corre aislado dentro de un **Web Worker** dedicado, manteniendo la interfaz de usuario fluida mientras orquesta grafos de estado cíclicos con **LangGraph.js**, memoria episódica persistente mediante **Engram-TS** + **IndexedDB**, lectura y edición directa de archivos locales con **File System Access API**, ejecución aislada de código JavaScript en sandbox e integración con servidores **Model Context Protocol (MCP)**.

---

## Características Principales

- **100 % en el Navegador y Privado**: Sin servidores intermedios. Todas las sesiones, checkpoints del grafo, memorias episódicas y ajustes se almacenan localmente en el navegador (`IndexedDB` y `localStorage`).
- **Ejecución en Segundo Plano (Web Worker)**: El ciclo de LangGraph.js y el streaming del LLM se ejecutan en un hilo secundario (`agent.worker.ts`) con soporte de fallback, evitando bloqueos en el hilo principal de la UI.
- **Grafo de Estado Cíclico con 4 Capacidades (`LangGraph.js`)**:
  1. **Contenedor de Estado Tipado (`AgentState`)**: Gestiona el historial de mensajes, la skill activa, las llamadas a herramientas pendientes, el estado de la sesión y el presupuesto de turnos y tokens.
  2. **Nodo de Decisión (`llm_router`)**: Recibe en streaming la respuesta y el razonamiento (`<think>...</think>`) del modelo local y decide si finalizar la tarea o invocar herramientas.
  3. **Nodo Ejecutor de Herramientas (`tool_runtime`)**: Orquesta operaciones sobre el sistema de archivos local, consultas/escrituras en memoria episódica, ejecución en el sandbox JS, delegación en sub-agentes fractales o herramientas MCP.
  4. **Borde de Presupuesto de Turnos/Tokens (`halt_budget_exceeded`)**: Protección nativa contra bucles infinitos que detiene el grafo de forma segura y persiste el checkpoint cuando se alcanza `maxTurns` o `maxTokenBudget`.
- **Doble Capa de Persistencia sobre IndexedDB**:
  - **Checkpointer de LangGraph (`IndexedDBSaver`)**: Guarda cada transición de estado del grafo permitiendo inspección y *time-travel*.
  - **Memoria Episódica y Sub-Agentes Fractales (`engram-ts` + `Lunr`)**: Búsqueda de texto completo sobre episodios previos y delegación jerárquica de subtareas (`delegate_subagent_scope`) con control de concurrencia para SLMs (`SlmConcurrencyGate`).
- **Acceso Directo al Sistema de Archivos Local (`File System Access API`)**:
  - Vincula cualquier directorio local mediante `window.showDirectoryPicker()`.
  - Soporta dos modos de escritura: **Confirmación Humana (`confirm`)** con bandeja interactiva de revisión de cambios (diff original vs. propuesto) o **Escritura Automática (`auto`)**.
- **Sandbox de Código JavaScript**: Ejecuta scripts generados por el agente (`run_sandboxed_js`) en un Web Worker efímero sin acceso a red (`connect-src 'none'`) y con límite estricto de tiempo de ejecución.
- **Integración con Ecosistema MCP (Model Context Protocol)**: Conecta servidores MCP externos vía HTTP/JSON-RPC o SSE para exponer sus herramientas automáticamente al grafo de LangGraph.
- **Marca Blanca (White-Label) e Internacionalización (`ES` / `EN`)**: Personalización inmediata del nombre de la organización, logotipo (SVG o URL), tipografía (`Inter` o `Roboto`) y 5 colores semánticos de tema en sus variantes **Claro** y **Oscuro**.

---

## Arquitectura del Sistema

```
┌──────────────────────────────────────────────────────────────────────┐
│                           Navegador (PWA)                            │
│                                                                      │
│  ┌────────────────────────┐         ┌─────────────────────────────┐  │
│  │       UI Thread        │         │         Web Worker          │  │
│  │    (Hilo Principal)    │◄───────►│ (Bucle de Ejecución Agente) │  │
│  └───────────┬────────────┘  RPC /  └──────────────┬──────────────┘  │
│              │              Streams                │                 │
│              ▼                                     ▼                 │
│  ┌────────────────────────┐         ┌─────────────────────────────┐  │
│  │ File System Access API │         │       LangGraph Core        │  │
│  │  (Handle de Directorio │         │   llm_router ⇄ tool_runtime │  │
│  │   y Revisión de Diffs) │         │     ↘ halt_budget_exceeded  │  │
│  └────────────────────────┘         └──────┬───────────────┬──────┘  │
│                                            │               │         │
│                                            ▼               ▼         │
│                              ┌──────────────────┐ ┌────────────────┐ │
│                              │  IndexedDBSaver  │ │   Engram-TS    │ │
│                              │   (Checkpoints)  │ │(Memoria Lunr y │ │
│                              └──────────────────┘ │Scopes Fractal) │ │
│                                                   └────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## Funcionamiento de la Aplicación

### 1. Pantallas y Flujo de Trabajo

LocalLoop utiliza enrutamiento basado en hash (`src/main.ts`) estructurado en cuatro vistas principales:

1. **Panel de Sesiones (`#/sessions`)**:
   - Vincula la carpeta local de tu proyecto mediante la **File System Access API**.
   - Selecciona la **Skill Especialista** con la que operará el agente:
     - `skill_general`: Agente Generalista Full-Stack
     - `skill_architect`: Arquitecto SOLID & Modularidad
     - `skill_coder`: Implementador & Refactorizador
     - `skill_security`: Auditor de Seguridad & Sandboxing
   - Crea nuevas sesiones agénticas, supervisa en tiempo real el indicador de pensamiento (*thinking pill*), consulta el consumo de turnos/tokens y gestiona las sesiones existentes.
2. **Workspace del Agente (`#/sessions/:id`)**:
   - **Flujo de Conversación y Razonamiento**: Visualiza en tiempo real las respuestas en streaming, los bloques desplegables de pensamiento (`<think>`) y las invocaciones a herramientas con sus argumentos y resultados.
   - **Bandeja de Propuestas de Archivos (Human-in-the-Loop)**: Cuando el modo de escritura está en `confirm`, cualquier llamada a `fs_write_file` registra una propuesta pendiente. Desde la bandeja lateral puedes comparar el contenido original y el propuesto y pulsar **Aprobar y Escribir en Disco** o **Rechazar**.
   - **Inspector de Checkpoints (Time-Travel)**: Examina cada paso persistido del grafo (`turnsUsed`, `tokensUsed` y estado interno) almacenado en `IndexedDBSaver`.
3. **Explorador de Memoria (`#/memory`)**:
   - Realiza búsquedas full-text con **Lunr** sobre las memorias episódicas de `engram-ts`, filtra por proyecto/sesión, registra memorias manualmente o inspecciona los hallazgos generados por sub-agentes fractales.
   - Permite **exportar e importar** toda la base de datos de memoria (`IndexedDB` + `engram-ts`) en formato `.json`.
4. **Ajustes (`#/settings`)**:
   - **Motor LLM / SLM**: Configura `baseUrl` (por ejemplo, `http://localhost:11434/v1`), identificador del modelo, temperatura, `maxTokens`, límite de turnos (`maxTurns`), presupuesto de tokens (`maxTokenBudget`), profundidad fractal (`maxDepth`), concurrencia (`maxConcurrency`), modo de escritura en disco (`confirm` o `auto`) y *system prompt*. Incluye botón para verificar la conexión en vivo (`GET /models`).
   - **Servidores MCP**: Añade, activa/desactiva y verifica servidores Model Context Protocol externos.
   - **Personalización de Marca (White-Label)**: Configura el nombre de la empresa, logotipo SVG o URL, fuente (`Inter` / `Roboto`) y los 5 pares de colores de tema (Claro/Oscuro) con previsualización instantánea.

---

### 2. Herramientas Nativas del Agente

En cada ciclo `llm_router` → `tool_runtime`, el agente dispone del siguiente conjunto de herramientas:

| Categoría | Herramienta | Descripción |
| :--- | :--- | :--- |
| **Sistema de Archivos** | `fs_list_dir` | Lista los archivos del directorio local vinculado (con filtro opcional por prefijo). |
| **Sistema de Archivos** | `fs_read_file` | Lee el contenido completo o un rango de líneas numeradas de un archivo local. |
| **Sistema de Archivos** | `fs_write_file` | Crea o modifica un archivo local (genera propuesta sujeta a aprobación en modo `confirm` o escribe directamente en modo `auto`). |
| **Sistema de Archivos** | `fs_search` | Busca texto o patrones en todos los archivos del workspace local. |
| **Memoria Episódica** | `memory_search` | Búsqueda full-text sobre la memoria episódica persistente (`engram-ts` / `Lunr`). |
| **Memoria Episódica** | `memory_get` | Recupera el documento completo de una memoria de `engram-ts` por su UUID. |
| **Memoria Episódica** | `memory_save` | Guarda decisiones arquitectónicas, hallazgos o resúmenes en `engram-ts`. |
| **Sub-Agentes Fractales** | `delegate_subagent_scope` | Delega el análisis profundo de un módulo o subtarea a un árbol de sub-agentes con caché en `engram-ts` y semáforo de concurrencia. |
| **Sandbox de Código** | `run_sandboxed_js` | Ejecuta código JavaScript aislado en un Web Worker sin red (`connect-src 'none'`), capturando `console.log` y errores con timeout. |
| **Ecosistema MCP** | `mcp_<servidor>_<tool>` | Herramientas cargadas dinámicamente desde los servidores MCP activos. |

---

## Puesta en Marcha

### Requisitos Previos

- **Node.js** (v20+ recomendado) y **pnpm**
- Un navegador moderno basado en Chromium (Chrome, Edge, Brave) para soporte completo de `window.showDirectoryPicker()` (File System Access API)
- Un servidor LLM local compatible con la API de OpenAI (p. ej. [Ollama](https://ollama.com/) en `http://localhost:11434/v1` o [LM Studio](https://lmstudio.ai/) en `http://localhost:1234/v1`) con CORS habilitado

### Instalación

```bash
pnpm install
```

### Servidor de Desarrollo

```bash
pnpm dev
```

### Compilación para Producción y Previsualización

```bash
pnpm run build
pnpm run preview
```

### Ejecución de Pruebas

La suite de pruebas verifica el cliente LLM y el motor de sub-agentes fractales, el checkpointer `IndexedDBSaver`, la memoria persistente con `engram-ts`, el grafo cíclico de `LangGraph` y su corte por presupuesto, las herramientas del sistema de archivos, la integridad de las traducciones (`i18n`) y las reglas de caché del Service Worker de la PWA:

```bash
pnpm test
```

---

## Estructura del Proyecto

```text
localloop/
├── public/
│   ├── sw.js                  # Service Worker offline-first (caché del App Shell y exclusión de LLM/MCP)
│   ├── manifest.webmanifest   # Manifiesto de la PWA
│   └── favicon.svg
├── src/
│   ├── agent/
│   │   ├── agent-graph.ts     # Grafo cíclico en LangGraph.js (llm_router, tool_runtime, budget edge)
│   │   └── skills-registry.ts # Registro de skills especialistas integradas
│   ├── config/
│   │   ├── brand-config.ts    # Configuración de marca blanca, logotipo, tipografía y 5 colores (Claro/Oscuro)
│   │   └── heroicons.ts       # Iconografía SVG basada en Heroicons
│   ├── fs/
│   │   ├── workspace-fs.ts    # Gestión de FileSystemDirectoryHandle y persistencia en IndexedDB
│   │   └── fs-tools.ts        # Herramientas fs_list_dir, fs_read_file, fs_write_file, fs_search y aprobaciones
│   ├── i18n/
│   │   ├── index.ts           # Sistema reactivo de internacionalización (ES / EN)
│   │   └── locales/           # Diccionarios completos en español (es.ts) e inglés (en.ts)
│   ├── llm/
│   │   ├── llm-client.ts      # Cliente OpenAI en streaming, parser <think> y motor fractal de scopes
│   │   └── llm-config.ts      # Configuración y validación de parámetros del motor LLM/SLM
│   ├── mcp/
│   │   └── mcp-client.ts      # Cliente Model Context Protocol (JSON-RPC / SSE)
│   ├── memory/
│   │   ├── app-db.ts          # Esquema Dexie sobre IndexedDB (sesiones, mensajes, propuestas, MCP)
│   │   ├── engram-memory.ts   # Integración de PersistentEngram, índice Lunr y AgentScopeStorage
│   │   └── indexeddb-saver.ts # Implementación de BaseCheckpointSaver para LangGraph.js en IndexedDB
│   ├── sandbox/
│   │   └── code-runner.ts     # Sandbox JS en Web Worker aislado sin acceso a red
│   ├── screens/
│   │   ├── dashboard.ts       # Vista del Panel de Sesiones
│   │   ├── workspace.ts       # Vista del Workspace de Sesión, revisión de diffs y checkpoints
│   │   ├── memory-explorer.ts # Explorador de Memoria Engram-TS y exportación/importación JSON
│   │   ├── settings.ts        # Pantalla de configuración de LLM, MCP y Marca Blanca
│   │   └── shared.ts          # Barra lateral, selector de tema claro/oscuro y selector de idioma
│   ├── worker/
│   │   ├── agent.worker.ts    # Punto de entrada del Web Worker del agente
│   │   ├── agent-bridge.ts    # Puente de comunicación entre el hilo principal y el Web Worker
│   │   └── session-runner.ts  # Orquestador de sesiones y reanudación tras confirmación humana
│   ├── diagnostics.ts         # Telemetría estructurada en memoria (__localloop_diagnostics)
│   └── main.ts                # Enrutador SPA y gestor de actualizaciones de la PWA
└── tests/                     # Pruebas unitarias y de integración automatizadas
```

