# LocalLoop AI

> **Minimalist, Local-First Agentic Harness in a Progressive Web App (PWA)**  
> Built with Vanilla TypeScript, LangGraph.js, Engram-TS, IndexedDB (Dexie), Web Workers, and the File System Access API.

**[English](README.md)** | **[Español](README.es.md)**

---

## Overview

**LocalLoop** is a 100% client-side, decentralized agentic workspace designed to run directly in modern browsers as a Single Page Application (SPA) and Progressive Web App (PWA). It connects to local or OpenAI-compatible LLM/SLM runtimes (such as **Ollama**, **LM Studio**, **vLLM**, or **llama.cpp**) without requiring a backend server.

The entire execution loop runs inside a dedicated **Web Worker**, keeping the UI responsive while orchestrating cyclic **LangGraph.js** state graphs, persistent episodic memory via **Engram-TS** + **IndexedDB**, local workspace file editing via the **File System Access API**, isolated JavaScript execution, and external tool discovery via **Model Context Protocol (MCP)**.

---

## Key Features

- **100% Client-Side & Private**: Zero server cost. All sessions, checkpoints, episodic memories, and settings live locally in the browser (`IndexedDB` & `localStorage`).
- **Web Worker Agent Execution**: The LangGraph.js loop and streaming LLM calls run in a background Web Worker (`agent.worker.ts`) with a fallback runner, ensuring the main UI thread never freezes.
- **4-Capability Cyclic State Graph (`LangGraph.js`)**:
  1. **Typed State Container (`AgentState`)**: Tracks conversation history, active skill, pending tool calls, session status, and turn/token budgets.
  2. **Decision Node (`llm_router`)**: Streams completions and thoughts (`<think>...</think>`) from your local LLM and decides whether to invoke tools or finish the task.
  3. **Tool Runtime Node (`tool_runtime`)**: Executes file system tools, episodic memory operations, sandboxed JS, fractal sub-agent delegation, or MCP tools.
  4. **Turn & Token Budget Edge (`halt_budget_exceeded`)**: Built-in infinite loop protection that safely halts the graph and persists a checkpoint if `maxTurns` or `maxTokenBudget` is reached.
- **Dual-Layer Persistence on IndexedDB**:
  - **LangGraph Checkpointer (`IndexedDBSaver`)**: Saves every graph state transition and supports time-travel inspection.
  - **Episodic & Fractal Sub-Agent Memory (`engram-ts` + `Lunr`)**: Full-text searchable episodic memory and hierarchical sub-agent scope delegation (`delegate_subagent_scope`) with concurrency gating (`SlmConcurrencyGate`).
- **Direct Local Workspace Access (`File System Access API`)**:
  - Mount any local folder via `window.showDirectoryPicker()`.
  - **Human-in-the-Loop (`confirm` mode)** or **Automatic (`auto` mode)** file writing, with side-by-side diff inspection, approval, or rejection in the Workspace tray.
- **Isolated JavaScript Sandbox**: Executes agent-generated snippets (`run_sandboxed_js`) inside an ephemeral, network-blocked (`connect-src 'none'`) Web Worker with strict timeouts.
- **MCP (Model Context Protocol) Client**: Connect HTTP/JSON-RPC and SSE MCP servers to dynamically expose external tools to the agent.
- **White-Label Branding & Bilingual UI (`ES` / `EN`)**: Customize company name, SVG/URL logo, typography (`Inter` or `Roboto`), and 5 semantic theme colors for both Light and Dark modes.

---

## System Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                            Browser (PWA)                             │
│                                                                      │
│  ┌────────────────────────┐         ┌─────────────────────────────┐  │
│  │       UI Thread        │         │         Web Worker          │  │
│  │     (Main Thread)      │◄───────►│   (Agent Execution Loop)    │  │
│  └───────────┬────────────┘  RPC /  └──────────────┬──────────────┘  │
│              │              Streams                │                 │
│              ▼                                     ▼                 │
│  ┌────────────────────────┐         ┌─────────────────────────────┐  │
│  │ File System Access API │         │       LangGraph Core        │  │
│  │  (Directory Handle &   │         │   llm_router ⇄ tool_runtime │  │
│  │   Human Diff Review)   │         │     ↘ halt_budget_exceeded  │  │
│  └────────────────────────┘         └──────┬───────────────┬──────┘  │
│                                            │               │         │
│                                            ▼               ▼         │
│                              ┌──────────────────┐ ┌────────────────┐ │
│                              │  IndexedDBSaver  │ │   Engram-TS    │ │
│                              │   (Checkpoints)  │ │ (Lunr Memory & │ │
│                              └──────────────────┘ │ Fractal Scopes)│ │
│                                                   └────────────────┘ │
└──────────────────────────────────────────────────────────────────────┘
```

---

## How the Application Works

### 1. Screens & Navigation

LocalLoop uses hash-based routing (`src/main.ts`) divided into four primary views:

1. **Sessions Dashboard (`#/sessions`)**:
   - Connect a local directory using the **File System Access API**.
   - Select one of the built-in **Agent Skills**:
     - `skill_general`: Full-Stack Generalist Agent
     - `skill_architect`: SOLID & Modularity Architect
     - `skill_coder`: Implementer & Refactorer
     - `skill_security`: Security & Sandboxing Auditor
   - Launch new agentic sessions, monitor real-time thinking pills, inspect turn/token consumption, and manage existing sessions.
2. **Agent Workspace (`#/sessions/:id`)**:
   - **Conversation & Thought Stream**: View real-time streaming responses, collapsible reasoning blocks (`<think>`), and tool execution payloads.
   - **File Proposals Tray (Human-in-the-Loop)**: When `fsWriteMode` is set to `confirm`, any `fs_write_file` call creates a pending proposal. You can inspect the original vs. proposed content and click **Approve & Write to Disk** or **Reject**.
   - **LangGraph Checkpoints & Time-Travel**: Inspect every persisted graph step (`turnsUsed`, `tokensUsed`, state snapshot) stored by `IndexedDBSaver`.
3. **Memory Explorer (`#/memory`)**:
   - Search episodic memories using **Lunr** full-text search, filter by project/session, create manual memory records, or inspect hierarchical memories generated by sub-agents.
   - Export or import the entire memory database (`IndexedDB` + `engram-ts`) as a portable `.json` backup.
4. **Settings (`#/settings`)**:
   - **LLM / SLM Runtime**: Configure `baseUrl` (e.g., `http://localhost:11434/v1`), model name, temperature, `maxTokens`, `maxTurns`, `maxTokenBudget`, fractal `maxDepth`, `maxConcurrency`, `fsWriteMode` (`confirm` vs `auto`), and custom system prompt. Includes a live connection tester (`GET /models`).
   - **MCP Servers**: Register, toggle, and test external MCP servers.
   - **Corporate Branding**: Customize the application name, logo, font family, and 5 theme color pairs (Light/Dark) with live preview.

---

### 2. Built-in Agent Tools

During each cycle of `llm_router` → `tool_runtime`, the agent has access to the following tools:

| Category | Tool Name | Description |
| :--- | :--- | :--- |
| **File System** | `fs_list_dir` | Lists files in the mounted local workspace directory (with optional prefix filtering). |
| **File System** | `fs_read_file` | Reads a local file (full content or specific line range with line numbers). |
| **File System** | `fs_write_file` | Creates or updates a file (creates a reviewable proposal in `confirm` mode, or writes directly in `auto` mode). |
| **File System** | `fs_search` | Searches for text patterns across files in the local workspace. |
| **Episodic Memory** | `memory_search` | Full-text search across persistent `engram-ts` memories using Lunr. |
| **Episodic Memory** | `memory_get` | Retrieves the complete record of an `engram-ts` memory by UUID. |
| **Episodic Memory** | `memory_save` | Persists architectural decisions, findings, or summaries into `engram-ts`. |
| **Fractal Sub-Agents** | `delegate_subagent_scope` | Delegates complex file analysis or subtasks to a fractal sub-agent tree with `engram-ts` caching and SLM concurrency control. |
| **Code Sandbox** | `run_sandboxed_js` | Executes isolated JavaScript code in a network-blocked Web Worker with `console.log` capture and timeout protection. |
| **MCP Ecosystem** | `mcp_<server>_<tool>` | Dynamically loaded tools from any active Model Context Protocol server. |

---

## Getting Started

### Prerequisites

- **Node.js** (v20+ recommended) and **pnpm**
- A modern Chromium-based browser (Chrome, Edge, Brave) for full `window.showDirectoryPicker()` (File System Access API) support
- A local OpenAI-compatible LLM server (e.g., [Ollama](https://ollama.com/) running at `http://localhost:11434/v1` or [LM Studio](https://lmstudio.ai/) at `http://localhost:1234/v1`) with CORS enabled

### Installation

```bash
pnpm install
```

### Development Server

```bash
pnpm dev
```

### Production Build & Preview

```bash
pnpm run build
pnpm run preview
```

### Running Tests

The test suite validates the LLM client and fractal scope engine, `IndexedDBSaver` checkpointer, `engram-ts` memory persistence, `LangGraph` cyclic workflow & budget halting, file system tools, i18n dictionary completeness, and PWA Service Worker caching rules:

```bash
pnpm test
```

---

## Project Structure

```text
localloop/
├── public/
│   ├── sw.js                  # Offline-first PWA Service Worker (App Shell cache)
│   ├── manifest.webmanifest   # PWA Web App Manifest
│   └── favicon.svg
├── src/
│   ├── agent/
│   │   ├── agent-graph.ts     # LangGraph.js StateGraph (llm_router, tool_runtime, budget edge)
│   │   └── skills-registry.ts # Built-in specialist skills (general, architect, coder, security)
│   ├── config/
│   │   ├── brand-config.ts    # White-label theme colors (Light/Dark), logo & font settings
│   │   └── heroicons.ts       # Inline Heroicons SVG registry
│   ├── fs/
│   │   ├── workspace-fs.ts    # File System Access API handle management & IndexedDB persistence
│   │   └── fs-tools.ts        # fs_list_dir, fs_read_file, fs_write_file, fs_search & approvals
│   ├── i18n/
│   │   ├── index.ts           # Reactive i18n state (ES / EN)
│   │   └── locales/           # Full Spanish (es.ts) and English (en.ts) translations
│   ├── llm/
│   │   ├── llm-client.ts      # Streaming OpenAI client, <think> parser & fractal scope runner
│   │   └── llm-config.ts      # Runtime configuration & validation
│   ├── mcp/
│   │   └── mcp-client.ts      # Model Context Protocol client (JSON-RPC / SSE)
│   ├── memory/
│   │   ├── app-db.ts          # Dexie IndexedDB schema (sessions, messages, proposals, MCP)
│   │   ├── engram-memory.ts   # PersistentEngram + Lunr index + AgentScopeStorage
│   │   └── indexeddb-saver.ts # Custom BaseCheckpointSaver for LangGraph.js on IndexedDB
│   ├── sandbox/
│   │   └── code-runner.ts     # Isolated & CSP network-blocked Web Worker JS sandbox
│   ├── screens/
│   │   ├── dashboard.ts       # Sessions Dashboard view
│   │   ├── workspace.ts       # Active Session Workspace, Diff review & Checkpoint inspector
│   │   ├── memory-explorer.ts # Engram-TS Memory Explorer & JSON Backup/Restore
│   │   ├── settings.ts        # LLM, MCP & White-label Branding configuration screen
│   │   └── shared.ts          # Sidebar navigation, theme switcher & language toggle
│   ├── worker/
│   │   ├── agent.worker.ts    # Dedicated Web Worker entry point
│   │   ├── agent-bridge.ts    # Main-thread <-> Web Worker communication bridge
│   │   └── session-runner.ts  # Session orchestration & human-confirmation resume logic
│   ├── diagnostics.ts         # Structured ring-buffer telemetry (__localloop_diagnostics)
│   └── main.ts                # SPA router & PWA update banner initialization
└── tests/                     # Automated unit & integration tests
```

