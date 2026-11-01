# localloop

Este documento recopila de forma estructurada toda la arquitectura, el diseño técnico y los componentes que hemos analizado para implementar tu arnés agéntico minimalista en formato PWA, optimizado para integrarse directamente en tu espacio de trabajo de Antigravity IDE.
markdown

## Requisitos Técnicos: Arnés Agéntico Minimalista en PWA
**Entorno de Ejecución:** Cliente Completo (Progressive Web App)
- La aplicación será una SPA (Single Page Application) y PWA (Progressive Web Application).
- La aplicación será desarrollada con Vanilla TypeScript, HTML5.
- Para los estilos utilizaremos Tailwind CSS e iconografía usando Heroicons.
- Usaremos una fuente legible y moderna, como Roboto o Inter.
- Debe ser trivial configurar un logotipo de empresa, y 5 colores de tema a utilizar, en sus variantes claro y oscuro.



---

## 1. Arquitectura del Sistema e Infraestructura PWA

El arnés se ejecuta de forma descentralizada en el dispositivo del usuario, garantizando privacidad, coste cero de servidor y persistencia local extendida.

Use code with caution.
┌────────────────────────────────────────────────────────┐
│                      Navegador (PWA)                   │
│  ┌────────────────┐         ┌───────────────────────┐  │
│  │   UI Thread    │         │      Web Worker       │  │
│  │ (Main Thread)  │         │ (Agent Execution Loop)│  │
│  └───────┬────────┘         └───────────┬───────────┘  │
│          │                              │              │
│          │ (PostMessage handles)        │              │
│          ▼                              ▼              │
│ ┌──────────────────┐         ┌──────────────────────┐  │
│ │ File System API  │         │    LangGraph Core    │  │
│ │  (Local Files)   │         │ (State/Nodos/Bordes) │  │
│ └──────────────────┘         └──────────┬───────────┘  │
│                                         │              │
│                                         ▼              │
│                              ┌──────────────────────┐  │
│                              │  IndexedDBSaver (DB) │  │
│                              │  (Engrams & Memory)  │  │
│                              └──────────────────────┘  │
└────────────────────────────────────────────────────────┘

*   **Service Worker:** Encargado del almacenamiento en caché agresivo de los assets de la aplicación y del bundle completo de LangGraph.js, garantizando la funcionalidad offline y tiempos de carga instantáneos.
*   **Web Workers (Agente en Background):** El bucle de ejecución de LangGraph y las llamadas de red corren de forma aislada en un hilo secundario para evitar congelar o bloquear la interfaz gráfica del usuario de Antigravity IDE durante procesos agénticos largos.

---

## 2. Las 4 Capacidades Básicas (Esqueleto del Grafo)

El ciclo clásico `while True` se mapea nativamente en LangGraph.js mediante un Grafo de Estado Cíclico estructurado en los siguientes componentes:

*   **State Definition (El Contenedor):** Un objeto de estado tipado de forma estricta que fluye a través de los nodos, almacenando el historial de mensajes, el balance del presupuesto de tokens/turnos y los identificadores de tareas.
*   **Nodo de Decisión (LLM Router):** Invoca al modelo de lenguaje. Si el LLM decide finalizar la tarea, encauza el flujo hacia el nodo de cierre; si decide que requiere una habilidad, redirige el flujo al ejecutor de herramientas.
*   **Nodo Ejecutor (Tool Runtime):** Orquesta la llamada a las funciones locales o remotas declaradas mediante esquemas estrictos de validación.
*   **Turn/Token Budget Edge (Protección contra Bucles Infinitos):** Borde condicional que evalúa en cada ciclo el contador de turnos actuales. Si se superan los 10–15 turnos permitidos sin resolución, fuerza la detención del grafo y persiste el estado de error.

---

## 3. Capa de Memoria Avanzada (Engrams) sobre IndexedDB

Usaremos el modulo typescript que hemos desarrollado en local anteriormente engram-ts. Para dar soporte a la memoria episódica y permitir que el arnés orqueste esquemas complejos de subagentes sin perder contexto, se implementa una extensión del almacenamiento del grafo adaptada al navegador.

---

## 4. Sistema de Archivos Local (Workspace del Agente)

Para que la PWA actúe con la misma potencia operativa que un arnés clásico de servidor (DsH o Pi) sin romper la seguridad del navegador:

*   **File System Access API:** El arnés solicita acceso interactivo una única vez mediante `window.showDirectoryPicker()`. 
*   **Persistencia del Handle:** El controlador del directorio obtenido se almacena temporalmente para que el Web Worker secundario pueda realizar lecturas completas del código fuente, modificaciones directas de archivos y guardado en disco del código generado por el agente de forma síncrona.
*   **Sandboxing de Código:** La ejecución experimental de scripts de código generados por el agente se aísla mediante Web Workers adicionales o iframes con atributos `sandbox` estrictos, mitigando riesgos de inyección y vulnerabilidades en la aplicación principal.

---

## 5. Integración con Skills y Ecosistema MCP (Model Context Protocol)

El arnés básico está diseñado para expandirse de forma modular y asimilar herramientas y contextos externos estandarizados.

*   **MCP sobre Entornos Web:** Dado que la PWA carece de acceso a procesos del sistema nativos vía `stdio` (Standard Input/Output), el arnés utiliza el transporte **`SSEClientTransport`** (o conexiones basadas en WebSockets).
*   **Abstracción de Herramientas:** Los servidores MCP externos (locales instalados en la máquina del usuario o remotos en la nube) se exponen al grafo de LangGraph envolviendo las peticiones del protocolo dentro de herramientas nativas de LangChain (`tool()`).
*   **Orquestación Multiaugmentada:** Soporte nativo para conectar subgrafos independientes (Sub-Agentes especialistas), donde cada uno puede heredar el checkpointer de IndexedDB y consultar servidores MCP dedicados para resolver subtareas delegadas por el agente raíz.
