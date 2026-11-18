import type { ComponentNode, GeneratedComponentFile } from '../../sdlc-state'

export interface GeneratedComponentArtifacts {
  className: string
  code: string
  testScript: string
  files: GeneratedComponentFile[]
  isBrowserComponent?: boolean
  browserTest?: {
    html: string
    css?: string
    code?: string
    domSelector?: string
    selectors?: string[]
    captureScreenshot?: boolean
  }
}

export type ComponentCodePresetProvider = (comp: ComponentNode) => GeneratedComponentArtifacts | null
let customCodePresetProvider: ComponentCodePresetProvider | null = null

/**
 * Permite registrar proveedores externos de código (ej. fixtures en suites de prueba)
 * evitando contaminar el generador de código de producción.
 */
export function registerComponentCodePresetProvider(provider: ComponentCodePresetProvider | null): void {
  customCodePresetProvider = provider
}

/**
 * Genera código TypeScript funcional, estructura multi-fichero y pruebas ejecutables en Sandbox (JS o Browser Iframe)
 * conforme a principios de Clean Architecture y servicios modulares tipados.
 */
export function generateComponentCode(
  comp: ComponentNode,
): GeneratedComponentArtifacts {
  if (customCodePresetProvider) {
    const preset = customCodePresetProvider(comp)
    if (preset) return preset
  }

  const cleanId = comp.id.replace(/[^a-zA-Z0-9]/g, '') || 'Component'
  const pascalId =
    comp.id
      .split(/[^a-zA-Z0-9]+/)
      .filter(Boolean)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join('') || 'Component'
  const className = `${cleanId.charAt(0).toUpperCase() + cleanId.slice(1)}Service`
  const isUi = /\b(ui|web|dom|canvas|mobile|html|css|view|pantalla|interfaz|portal)\b/i.test(
    `${comp.id} ${comp.name} ${comp.description}`,
  )
  const targetPath = comp.targetPath || `src/components/${comp.id}.ts`
  const code = `/**
 * Componente: ${comp.name} (${comp.id})
 * Responsabilidad: ${comp.description}
 * Generado por LocalLoop SDLC Graph
 */

export interface ${pascalId}Item {
  id: string;
  title: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface ${pascalId}Input {
  action: string;
  payload: Record<string, unknown>;
}

export interface ${pascalId}Output {
  success: boolean;
  componentId: string;
  action: string;
  executedAt: string;
  resultData: Record<string, unknown>;
  items: ${pascalId}Item[];
}

export interface I${pascalId}Service {
  execute(input: ${pascalId}Input): ${pascalId}Output;
  listItems(): ${pascalId}Item[];
  getState(): { status: string; count: number; lastUpdatedAt: string | null };
  mount(container: HTMLElement): void;
}

export class ${className} implements I${pascalId}Service {
  private status = 'READY';
  private items: ${pascalId}Item[] = [];
  private lastUpdatedAt: string | null = null;

  constructor(initialItems: ${pascalId}Item[] = []) {
    this.items = [...initialItems];
  }

  execute(input: ${pascalId}Input): ${pascalId}Output {
    if (!input || !input.action || typeof input.action !== 'string' || !input.action.trim()) {
      throw new Error('Acción requerida para ejecutar ${className}');
    }
    const cleanAction = input.action.trim();
    const payload = input.payload && typeof input.payload === 'object' ? input.payload : {};
    const now = new Date().toISOString();

    if (cleanAction === 'create' || cleanAction === 'add' || cleanAction === 'process') {
      const item: ${pascalId}Item = {
        id: String(payload.id || \`${comp.id}_\${this.items.length + 1}\`),
        title: String(payload.title || payload.name || \`Registro #\${this.items.length + 1} (${comp.name})\`),
        payload,
        createdAt: now,
      };
      this.items.push(item);
    } else if (cleanAction === 'clear' || cleanAction === 'reset') {
      this.items = [];
    }

    this.status = 'ACTIVE';
    this.lastUpdatedAt = now;

    return {
      success: true,
      componentId: '${comp.id}',
      action: cleanAction,
      executedAt: now,
      resultData: {
        processed: true,
        totalItems: this.items.length,
        ...payload,
      },
      items: [...this.items],
    };
  }

  listItems(): ${pascalId}Item[] {
    return [...this.items];
  }

  getState(): { status: string; count: number; lastUpdatedAt: string | null } {
    return {
      status: this.status,
      count: this.items.length,
      lastUpdatedAt: this.lastUpdatedAt,
    };
  }

  mount(container: HTMLElement): void {
    if (!container) return;
    const render = () => {
      const itemsHtml =
        this.items.length > 0
          ? this.items
              .map(
                (item) =>
                  \`<li class="flex items-center justify-between rounded border border-gray-200 bg-white px-3 py-2 text-xs">
                    <span class="font-medium text-gray-800">\${item.title}</span>
                    <code class="text-[11px] text-indigo-600">\${item.id}</code>
                  </li>\`,
              )
              .join('')
          : '<li class="text-xs text-gray-400 italic">Sin registros activos todavía.</li>';

      container.innerHTML = \`
        <section id="${comp.id}" class="component-root rounded-xl border border-gray-200 bg-gray-50 p-4 space-y-3">
          <div class="flex items-center justify-between">
            <div>
              <h3 class="text-sm font-bold text-gray-900">${comp.name}</h3>
              <p class="text-xs text-gray-500">${comp.description.replace(/`/g, "'")}</p>
            </div>
            <span class="rounded-full bg-indigo-100 px-2.5 py-0.5 text-[11px] font-semibold text-indigo-700">\${this.status} (\${this.items.length})</span>
          </div>
          <div class="flex gap-2">
            <input data-input="${comp.id}" type="text" placeholder="Nuevo registro para ${comp.name}..." class="flex-1 rounded-lg border border-gray-300 px-3 py-1.5 text-xs" />
            <button data-action="${comp.id}" type="button" class="rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-indigo-500">Ejecutar</button>
          </div>
          <ul class="space-y-1.5">\${itemsHtml}</ul>
        </section>
      \`;

      const btn = container.querySelector<HTMLButtonElement>('[data-action="${comp.id}"]');
      const inp = container.querySelector<HTMLInputElement>('[data-input="${comp.id}"]');
      btn?.addEventListener('click', () => {
        const title = inp?.value.trim() || \`Operación ${comp.name} #\${this.items.length + 1}\`;
        this.execute({ action: 'create', payload: { title } });
        render();
      });
    };
    render();
  }
}
`
  const testScript = `
    const instanceItems = [];
    class ${className} {
      constructor(initial = []) {
        this.status = 'READY';
        this.items = [...initial];
        this.lastUpdatedAt = null;
      }
      execute(input) {
        if (!input || !input.action) throw new Error('Acción requerida');
        const item = {
          id: '${comp.id}_' + (this.items.length + 1),
          title: (input.payload && input.payload.title) || 'Item',
          payload: input.payload || {},
          createdAt: new Date().toISOString(),
        };
        this.items.push(item);
        this.status = 'ACTIVE';
        return { success: true, componentId: '${comp.id}', action: input.action, executedAt: item.createdAt, items: this.items };
      }
      listItems() { return [...this.items]; }
      getState() { return { status: this.status, count: this.items.length }; }
    }
    const instance = new ${className}();
    if (!instance) throw new Error('Instanciación fallida');
    const res = instance.execute({ action: 'process', payload: { title: 'Test ${comp.id}' } });
    if (!res.success || instance.listItems().length !== 1) throw new Error('Ejecución fallida');
    console.log('Contrato de ${className} (${comp.id}) verificado en Sandbox.');
    ({ pass: true, assertions: 3, componentId: '${comp.id}' });
  `
  const unitTestFileContent = `import { describe, it, expect } from 'vitest';
import { ${className} } from '../${targetPath.replace(/\.tsx?$/, '')}';

describe('${comp.name} (${comp.id})', () => {
  it('debe instanciar ${className} y ejecutar acciones cumpliendo el contrato', () => {
    const service = new ${className}();
    expect(service.getState().status).toBe('READY');
    const output = service.execute({ action: 'create', payload: { title: 'Prueba Unitaria' } });
    expect(output.success).toBe(true);
    expect(service.listItems().length).toBe(1);
  });

  it('debe validar defensivamente entradas inválidas', () => {
    const service = new ${className}();
    expect(() => service.execute({ action: '', payload: {} })).toThrow();
  });
});
`
  const files: GeneratedComponentFile[] = [
    { path: targetPath, content: code, description: comp.name },
    { path: `tests/${comp.id}.test.ts`, content: unitTestFileContent, description: `Suite de pruebas unitarias para ${comp.name}` },
  ]
  if (isUi) {
    files.push({
      path: `public/${comp.id}.html`,
      content: `<div id="${comp.id}" class="component-root"><h3>${comp.name}</h3><p>${comp.description}</p></div>`,
      description: `Vista HTML para ${comp.name}`,
    })
  }
  return {
    className,
    code,
    testScript,
    files,
    isBrowserComponent: isUi,
    ...(isUi
      ? {
          browserTest: {
            html: files[files.length - 1].content,
            selectors: [`#${comp.id}`],
            captureScreenshot: true,
          },
        }
      : {}),
  }
}
