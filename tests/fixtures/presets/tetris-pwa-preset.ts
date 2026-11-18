import type { ComponentNode } from '../../../src/agent/sdlc-state'
import type { GeneratedComponentArtifacts } from '../../../src/agent/sdlc/codegen/component-codegen'
import type { ComponentDesignResult } from '../../../src/agent/sdlc/codegen/component-design'

/**
 * Fixture de prueba: Generación de código para el caso de Tetris Mobile PWA y Google Ads
 */
export function getTetrisPwaCodePreset(comp: ComponentNode): GeneratedComponentArtifacts | null {
  if (
    comp.id.includes('tetris_engine') ||
    (comp.id.includes('tetris') && !comp.id.includes('ui') && !comp.id.includes('ads') && !comp.id.includes('pwa')) ||
    (comp.name.toLowerCase().includes('tetris') && comp.name.toLowerCase().includes('motor'))
  ) {
    const className = 'TetrisEngine'
    const typesCode = `export type TetrominoType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';

export interface Point {
  x: number;
  y: number;
}

export interface TetrominoPiece {
  type: TetrominoType;
  matrix: number[][];
  x: number;
  y: number;
}

export interface TetrisGameState {
  board: number[][];
  score: number;
  lines: number;
  level: number;
  gameOver: boolean;
  paused: boolean;
}
`
    const engineCode = `import type { TetrominoType, TetrominoPiece, TetrisGameState, Point } from './tetris-types';

export const TETROMINO_SHAPES: Record<TetrominoType, number[][]> = {
  I: [[0, 0, 0, 0], [1, 1, 1, 1], [0, 0, 0, 0], [0, 0, 0, 0]],
  J: [[2, 0, 0], [2, 2, 2], [0, 0, 0]],
  L: [[0, 0, 3], [3, 3, 3], [0, 0, 0]],
  O: [[4, 4], [4, 4]],
  S: [[0, 5, 5], [5, 5, 0], [0, 0, 0]],
  T: [[0, 6, 0], [6, 6, 6], [0, 0, 0]],
  Z: [[7, 7, 0], [0, 7, 7], [0, 0, 0]],
};

export class TetrisEngine {
  public static readonly COLS = 10;
  public static readonly ROWS = 20;

  private board: number[][];
  private currentPiece: TetrominoPiece | null = null;
  private score = 0;
  private lines = 0;
  private level = 1;
  private gameOver = false;
  private paused = false;

  constructor() {
    this.board = this.createEmptyBoard();
  }

  public createEmptyBoard(): number[][] {
    return Array.from({ length: TetrisEngine.ROWS }, () => Array(TetrisEngine.COLS).fill(0));
  }

  public spawnPiece(type: TetrominoType = 'T'): boolean {
    const shape = TETROMINO_SHAPES[type].map((row) => [...row]);
    const piece: TetrominoPiece = {
      type,
      matrix: shape,
      x: Math.floor((TetrisEngine.COLS - shape[0].length) / 2),
      y: 0,
    };
    if (this.checkCollision(piece.matrix, piece.x, piece.y)) {
      this.gameOver = true;
      return false;
    }
    this.currentPiece = piece;
    return true;
  }

  public move(dir: 'LEFT' | 'RIGHT' | 'DOWN'): boolean {
    if (!this.currentPiece || this.gameOver || this.paused) return false;
    const dx = dir === 'LEFT' ? -1 : dir === 'RIGHT' ? 1 : 0;
    const dy = dir === 'DOWN' ? 1 : 0;
    if (!this.checkCollision(this.currentPiece.matrix, this.currentPiece.x + dx, this.currentPiece.y + dy)) {
      this.currentPiece.x += dx;
      this.currentPiece.y += dy;
      return true;
    }
    if (dir === 'DOWN') {
      this.lockPiece();
    }
    return false;
  }

  public rotate(): boolean {
    if (!this.currentPiece || this.gameOver || this.paused) return false;
    const rotated = this.currentPiece.matrix[0].map((_, i) =>
      this.currentPiece!.matrix.map((row) => row[i]).reverse()
    );
    if (!this.checkCollision(rotated, this.currentPiece.x, this.currentPiece.y)) {
      this.currentPiece.matrix = rotated;
      return true;
    }
    return false;
  }

  public hardDrop(): number {
    let dropped = 0;
    while (this.move('DOWN')) {
      dropped++;
    }
    return dropped;
  }

  public tick(): boolean {
    return this.move('DOWN');
  }

  private checkCollision(matrix: number[][], offsetX: number, offsetY: number): boolean {
    for (let y = 0; y < matrix.length; y++) {
      for (let x = 0; x < matrix[y].length; x++) {
        if (matrix[y][x] !== 0) {
          const newX = offsetX + x;
          const newY = offsetY + y;
          if (newX < 0 || newX >= TetrisEngine.COLS || newY >= TetrisEngine.ROWS) {
            return true;
          }
          if (newY >= 0 && this.board[newY][newX] !== 0) {
            return true;
          }
        }
      }
    }
    return false;
  }

  private lockPiece(): void {
    if (!this.currentPiece) return;
    for (let y = 0; y < this.currentPiece.matrix.length; y++) {
      for (let x = 0; x < this.currentPiece.matrix[y].length; x++) {
        if (this.currentPiece.matrix[y][x] !== 0) {
          const boardY = this.currentPiece.y + y;
          const boardX = this.currentPiece.x + x;
          if (boardY >= 0 && boardY < TetrisEngine.ROWS && boardX >= 0 && boardX < TetrisEngine.COLS) {
            this.board[boardY][boardX] = this.currentPiece.matrix[y][x];
          }
        }
      }
    }
    this.clearLines();
    this.spawnPiece();
  }

  private clearLines(): number {
    let linesCleared = 0;
    for (let y = TetrisEngine.ROWS - 1; y >= 0; y--) {
      if (this.board[y].every((cell) => cell !== 0)) {
        this.board.splice(y, 1);
        this.board.unshift(Array(TetrisEngine.COLS).fill(0));
        linesCleared++;
        y++;
      }
    }
    if (linesCleared > 0) {
      this.lines += linesCleared;
      const points = [0, 100, 300, 500, 800];
      this.score += (points[linesCleared] || 1000) * this.level;
      this.level = Math.floor(this.lines / 10) + 1;
    }
    return linesCleared;
  }

  public getState(): TetrisGameState {
    return {
      board: this.board.map((r) => [...r]),
      score: this.score,
      lines: this.lines,
      level: this.level,
      gameOver: this.gameOver,
      paused: this.paused,
    };
  }
}
`
    const testScript = `
      ${engineCode.replace(/import .*/g, '').replace(/export /g, '')}
      const engine = new TetrisEngine();
      if (!engine || typeof engine.spawnPiece !== 'function') throw new Error('Motor Tetris no instanciable');
      const spawned = engine.spawnPiece('T');
      if (!spawned) throw new Error('Fallo al generar pieza inicial');
      const moved = engine.move('LEFT');
      const rotated = engine.rotate();
      const state = engine.getState();
      if (state.board.length !== 20 || state.board[0].length !== 10) throw new Error('Dimensiones de tablero inválidas');
      ({ pass: true, assertions: 4, state: { score: state.score, lines: state.lines } });
    `
    const vitestEngineTest = `import { describe, it, expect, beforeEach } from 'vitest';
import { TetrisEngine } from '../src/games/tetris-engine';

describe('TetrisEngine (Reglas SRS y Matriz)', () => {
  let engine: TetrisEngine;

  beforeEach(() => {
    engine = new TetrisEngine();
  });

  it('inicializa un tablero vacío de 10 columnas por 20 filas', () => {
    const state = engine.getState();
    expect(state.board.length).toBe(20);
    expect(state.board[0].length).toBe(10);
    expect(state.score).toBe(0);
    expect(state.gameOver).toBe(false);
  });

  it('genera una pieza y permite moverla a la izquierda y derecha', () => {
    const spawned = engine.spawnPiece('T');
    expect(spawned).toBe(true);
    expect(engine.move('LEFT')).toBe(true);
    expect(engine.move('RIGHT')).toBe(true);
  });

  it('permite rotar la pieza', () => {
    engine.spawnPiece('T');
    expect(engine.rotate()).toBe(true);
  });

  it('hardDrop baja la pieza hasta el fondo', () => {
    engine.spawnPiece('I');
    const dropped = engine.hardDrop();
    expect(dropped).toBeGreaterThan(0);
  });
});
`
    return {
      className,
      code: engineCode,
      testScript,
      files: [
        { path: 'src/games/tetris-types.ts', content: typesCode, description: 'Tipos e Interfaces del Motor Tetris' },
        { path: 'src/games/tetris-engine.ts', content: engineCode, description: 'Lógica Central del Motor Tetris' },
        { path: 'tests/tetris-engine.test.ts', content: vitestEngineTest, description: 'Pruebas Unitarias Vitest del Motor Tetris' },
      ],
    }
  } else if (
    comp.id.includes('tetris_mobile_ui') ||
    comp.id.includes('mobile_ui') ||
    (comp.name.toLowerCase().includes('tetris') &&
      (comp.name.toLowerCase().includes('ui') ||
        comp.name.toLowerCase().includes('móvil') ||
        comp.name.toLowerCase().includes('interfaz') ||
        comp.name.toLowerCase().includes('canvas')))
  ) {
    const className = 'TetrisMobileView'
    const htmlContent = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Neon Tetris Mobile PWA</title>
  <link rel="stylesheet" href="src/styles/tetris-mobile.css">
</head>
<body class="tetris-mobile-body">
  <header id="tetris-header" class="tetris-header">
    <div class="brand-title">NEON TETRIS MOBILE</div>
    <div class="stats-panel">
      <div class="stat-item">SCORE <span id="score-val" class="stat-num">0</span></div>
      <div class="stat-item">LINES <span id="lines-val" class="stat-num">0</span></div>
      <div class="stat-item">LVL <span id="level-val" class="stat-num">1</span></div>
    </div>
  </header>

  <main id="game-stage" class="game-stage">
    <canvas id="tetris-canvas" width="240" height="480" class="neon-canvas"></canvas>
  </main>

  <nav id="touch-controls" class="touch-controls-bar">
    <button id="btn-left" class="touch-btn">◄</button>
    <button id="btn-rotate" class="touch-btn">↻</button>
    <button id="btn-right" class="touch-btn">►</button>
    <button id="btn-drop" class="touch-btn drop-btn">▼</button>
  </nav>
</body>
</html>`

    const cssContent = `/* Estilos Modernos Neon Glassmorphism para Tetris Mobile PWA */
:root {
  --neon-cyan: #38bdf8;
  --neon-glow: rgba(56, 189, 248, 0.4);
  --bg-slate: #0f172a;
}
body.tetris-mobile-body {
  margin: 0;
  padding: 0;
  background-color: var(--bg-slate);
  color: #f8fafc;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  min-height: 100vh;
  touch-action: manipulation;
  overflow: hidden;
}
.tetris-header {
  width: 100%;
  padding: 10px 0;
  text-align: center;
  background: rgba(30, 41, 59, 0.8);
  backdrop-filter: blur(8px);
  border-bottom: 1px solid rgba(56, 189, 248, 0.25);
}
.brand-title {
  font-size: 16px;
  font-weight: 900;
  letter-spacing: 2px;
  color: var(--neon-cyan);
  text-shadow: 0 0 12px var(--neon-glow);
}
.stats-panel {
  display: flex;
  justify-content: space-around;
  font-family: monospace;
  font-size: 13px;
  margin-top: 6px;
}
.stat-num {
  font-weight: bold;
  color: #38bdf8;
}
.game-stage {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 8px;
}
.neon-canvas {
  background: #020617;
  border: 2px solid var(--neon-cyan);
  border-radius: 12px;
  box-shadow: 0 0 24px var(--neon-glow);
  display: block;
}
.touch-controls-bar {
  width: 100%;
  max-width: 380px;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  padding: 8px 16px 16px;
  box-sizing: border-box;
}
.touch-btn {
  background: rgba(30, 41, 59, 0.9);
  border: 1px solid rgba(56, 189, 248, 0.35);
  border-radius: 14px;
  color: var(--neon-cyan);
  font-size: 22px;
  font-weight: 900;
  padding: 14px 0;
  text-align: center;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.4);
  cursor: pointer;
  user-select: none;
}
.touch-btn:active {
  background: var(--neon-cyan);
  color: #0f172a;
}
.touch-btn.drop-btn {
  background: rgba(14, 165, 233, 0.25);
  border-color: #38bdf8;
}
`

    const tsCode = `export class TetrisMobileView {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private onInputCallback: ((action: 'LEFT' | 'RIGHT' | 'ROTATE' | 'DROP') => void) | null = null;

  public mount(canvasSelector: string | HTMLElement = '#tetris-canvas', controlsSelector: string | HTMLElement = '#touch-controls'): boolean {
    if (typeof canvasSelector === 'string') {
      this.canvas = typeof document !== 'undefined' ? document.querySelector<HTMLCanvasElement>(canvasSelector) : null;
    } else {
      this.canvas = canvasSelector instanceof HTMLCanvasElement ? canvasSelector : (canvasSelector?.querySelector?.('canvas') || null);
    }
    if (this.canvas && typeof this.canvas.getContext === 'function') {
      this.ctx = this.canvas.getContext('2d');
    }
    this.bindTouchControls(typeof controlsSelector === 'string' ? controlsSelector : '#touch-controls');
    return Boolean(this.canvas);
  }

  public bindTouchControls(selector: string): void {
    if (typeof document === 'undefined') return;
    const bindBtn = (id: string, action: 'LEFT' | 'RIGHT' | 'ROTATE' | 'DROP') => {
      const btn = document.querySelector(id);
      if (btn) {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.onInputCallback?.(action);
        });
      }
    };
    bindBtn('#btn-left', 'LEFT');
    bindBtn('#btn-right', 'RIGHT');
    bindBtn('#btn-rotate', 'ROTATE');
    bindBtn('#btn-drop', 'DROP');
  }

  public onInput(cb: (action: 'LEFT' | 'RIGHT' | 'ROTATE' | 'DROP') => void): void {
    this.onInputCallback = cb;
  }

  public render(matrix: number[][]): void {
    if (!this.ctx || !this.canvas) return;
    const ctx = this.ctx;
    const w = this.canvas.width;
    const h = this.canvas.height;
    ctx.fillStyle = '#020617';
    ctx.fillRect(0, 0, w, h);

    const rows = matrix.length;
    const cols = matrix[0] ? matrix[0].length : 10;
    const cellW = w / cols;
    const cellH = h / rows;

    const colors = ['', '#38bdf8', '#0ea5e9', '#06b6d4', '#14b8a6', '#22c55e', '#a855f7', '#ec4899'];
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const val = matrix[r][c];
        if (val > 0) {
          ctx.fillStyle = colors[val] || '#38bdf8';
          ctx.shadowColor = '#38bdf8';
          ctx.shadowBlur = 6;
          ctx.fillRect(c * cellW + 1, r * cellH + 1, cellW - 2, cellH - 2);
        }
      }
    }
    ctx.shadowBlur = 0;
  }
}
`
    const testScript = `
      const canvas = document.querySelector('#tetris-canvas');
      if (!canvas) throw new Error('Canvas #tetris-canvas no encontrado en el DOM');
      const controls = document.querySelector('#touch-controls');
      if (!controls) throw new Error('Barra táctil #touch-controls no encontrada');
      const buttons = document.querySelectorAll('.touch-btn');
      if (buttons.length < 4) throw new Error('Se esperaban 4 botones táctiles');
      const rotateBtn = document.querySelector('#btn-rotate');
      if (!rotateBtn) throw new Error('Botón de rotación ausente');
      console.log('Validación de DOM de Tetris Mobile UI superada con éxito.');
      ({ pass: true, canvasVerified: true, touchControlsCount: buttons.length });
    `
    return {
      className,
      code: tsCode,
      testScript,
      isBrowserComponent: true,
      browserTest: {
        html: htmlContent,
        css: cssContent,
        code: testScript,
        domSelector: '#game-stage',
        selectors: ['#tetris-canvas', '#touch-controls', '.touch-btn', '#btn-rotate', '#score-val'],
        captureScreenshot: true,
      },
      files: [
        { path: 'public/tetris-view.html', content: htmlContent, description: 'Estructura HTML5 Móvil de la Vista Tetris' },
        { path: 'src/styles/tetris-mobile.css', content: cssContent, description: 'Estilos CSS Neon Responsive para Móviles' },
        { path: 'src/components/tetris-view.ts', content: tsCode, description: 'Controlador de Canvas y Eventos Táctiles' },
      ],
    }
  } else if (
    comp.id.includes('ads') ||
    comp.name.toLowerCase().includes('ads') ||
    comp.name.toLowerCase().includes('publicidad') ||
    comp.name.toLowerCase().includes('anuncio')
  ) {
    const className = 'GoogleAdsSlotManager'
    const htmlAds = `<aside id="google-ads-container" class="google-ads-slot-wrapper" style="min-height:50px;width:100%;max-width:420px;margin:0 auto;background:#0f172a;border-top:1px solid #334155;text-align:center;padding:4px 0;overflow:hidden;">
  <div class="ad-label" style="font-size:9px;color:#64748b;text-transform:uppercase;margin-bottom:2px;">Publicidad (Google Ads)</div>
  <ins class="adsbygoogle"
       style="display:inline-block;width:320px;height:50px;"
       data-ad-client="ca-pub-1234567890123456"
       data-ad-slot="9876543210"
       data-ad-format="horizontal"
       data-full-width-responsive="false"></ins>
</aside>`

    const cssAds = `.google-ads-slot-wrapper {
  min-height: 50px;
  width: 100%;
  max-width: 420px;
  margin: 0 auto;
  background: #0f172a;
  border-top: 1px solid rgba(51, 65, 85, 0.8);
  text-align: center;
  padding: 4px 0 6px;
  overflow: hidden;
  box-sizing: border-box;
  flex-shrink: 0;
}
.ad-label {
  font-size: 9px;
  letter-spacing: 0.1em;
  color: #64748b;
  text-transform: uppercase;
  margin-bottom: 2px;
}
.adsbygoogle {
  background: rgba(30, 41, 59, 0.5);
  border-radius: 4px;
}
`

    const tsAds = `export interface GoogleAdsConfig {
  adClient: string;
  adSlot: string;
  minHeightPx?: number;
}

export class GoogleAdsSlotManager {
  private config: GoogleAdsConfig;

  constructor(config: GoogleAdsConfig = { adClient: 'ca-pub-1234567890123456', adSlot: '9876543210', minHeightPx: 50 }) {
    this.config = config;
  }

  public renderSlotMarkup(): string {
    return \`<aside id="google-ads-container" class="google-ads-slot-wrapper" style="min-height: \${this.config.minHeightPx || 50}px">
      <div class="ad-label">Publicidad (Google Ads)</div>
      <ins class="adsbygoogle"
           style="display: inline-block; width: 320px; height: 50px;"
           data-ad-client="\${this.config.adClient}"
           data-ad-slot="\${this.config.adSlot}"></ins>
    </aside>\`;
  }

  public verifyLayoutShiftSafe(element: HTMLElement): boolean {
    if (!element) return false;
    const height = element.getBoundingClientRect ? element.getBoundingClientRect().height : 50;
    return height >= (this.config.minHeightPx || 50);
  }
}
`
    const testScriptAds = `
      const adContainer = document.querySelector('#google-ads-container');
      if (!adContainer) throw new Error('Contenedor #google-ads-container no encontrado');
      const adIns = document.querySelector('ins.adsbygoogle');
      if (!adIns) throw new Error('Etiqueta ins.adsbygoogle requerida no encontrada');
      const adClient = adIns.getAttribute('data-ad-client');
      if (!adClient || !adClient.startsWith('ca-pub-')) throw new Error('Atributo data-ad-client no válido');
      const label = document.querySelector('.ad-label');
      if (!label) throw new Error('Etiqueta identificadora de publicidad ausente');
      console.log('Espacio publicitario de Google Ads verificado y protegido contra CLS.');
      ({ pass: true, adSlotVerified: true, client: adClient });
    `
    const vitestAdsTest = `import { describe, it, expect, beforeEach } from 'vitest';
import { GoogleAdsSlotManager } from '../src/components/google-ads-slot';

describe('GoogleAdsSlotManager (Prevención CLS)', () => {
  let manager: GoogleAdsSlotManager;

  beforeEach(() => {
    manager = new GoogleAdsSlotManager();
  });

  it('genera markup seguro con altura mínima fijada', () => {
    const markup = manager.renderSlotMarkup();
    expect(markup).toContain('id="google-ads-container"');
    expect(markup).toContain('class="google-ads-slot-wrapper"');
    expect(markup).toContain('data-ad-client="ca-pub-1234567890123456"');
  });

  it('valida que el contenedor respete la altura mínima contra CLS', () => {
    const fakeEl = { getBoundingClientRect: () => ({ height: 60 }) } as any;
    expect(manager.verifyLayoutShiftSafe(fakeEl)).toBe(true);
  });
});
`
    return {
      className,
      code: tsAds,
      testScript: testScriptAds,
      isBrowserComponent: true,
      browserTest: {
        html: htmlAds,
        css: cssAds,
        code: testScriptAds,
        domSelector: '#google-ads-container',
        selectors: ['#google-ads-container', 'ins.adsbygoogle', '.ad-label'],
        captureScreenshot: true,
      },
      files: [
        { path: 'src/components/google-ads-slot.ts', content: tsAds, description: 'Gestor del Espacio Publicitario Google Ads' },
        { path: 'public/ads-slot.html', content: htmlAds, description: 'Markup del Contenedor de Anuncios' },
        { path: 'src/styles/ads-slot.css', content: cssAds, description: 'Estilos de Prevención de CLS para Publicidad' },
        { path: 'tests/google-ads-slot.test.ts', content: vitestAdsTest, description: 'Pruebas Unitarias Vitest del Slot Google Ads' },
      ],
    }
  } else if (
    comp.id.includes('pwa') ||
    comp.id.includes('shell') ||
    comp.name.toLowerCase().includes('pwa') ||
    comp.name.toLowerCase().includes('manifest')
  ) {
    const className = 'PwaAppShell'
    const htmlIndex = `<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no, viewport-fit=cover">
  <meta name="theme-color" content="#0f172a">
  <meta name="apple-mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
  <title>Modern Neon Tetris Mobile PWA</title>
  <link rel="manifest" href="public/manifest.webmanifest">
  <link rel="stylesheet" href="src/styles/tetris-mobile.css">
  <link rel="stylesheet" href="src/styles/ads-slot.css">
</head>
<body class="tetris-mobile-body">
  <header id="tetris-header" class="tetris-header">
    <div class="brand-title">NEON TETRIS MOBILE</div>
    <div class="stats-panel">
      <div>SCORE <span id="score-val" class="stat-num">0</span></div>
      <div>LINES <span id="lines-val" class="stat-num">0</span></div>
      <div>LVL <span id="level-val" class="stat-num">1</span></div>
    </div>
  </header>

  <main id="game-stage" class="game-stage">
    <canvas id="tetris-canvas" width="240" height="480" class="neon-canvas"></canvas>
  </main>

  <nav id="touch-controls" class="touch-controls-bar">
    <button id="btn-left" class="touch-btn">◄</button>
    <button id="btn-rotate" class="touch-btn">↻</button>
    <button id="btn-right" class="touch-btn">►</button>
    <button id="btn-drop" class="touch-btn drop-btn">▼</button>
  </nav>

  <aside id="google-ads-container" class="google-ads-slot-wrapper">
    <div class="ad-label">Publicidad (Google Ads)</div>
    <ins class="adsbygoogle"
         style="display: inline-block; width: 320px; height: 50px;"
         data-ad-client="ca-pub-1234567890123456"
         data-ad-slot="9876543210"></ins>
  </aside>

  <script type="module" src="src/main.ts"></script>
</body>
</html>`

    const manifestJson = `{
  "name": "Modern Neon Tetris Mobile PWA",
  "short_name": "NeonTetris",
  "description": "Juego de Tetris moderno para móviles con controles táctiles y diseño neon.",
  "start_url": "/",
  "display": "standalone",
  "orientation": "portrait",
  "background_color": "#0f172a",
  "theme_color": "#0f172a",
  "icons": [
    {
      "src": "/icons/icon-192.png",
      "sizes": "192x192",
      "type": "image/png"
    },
    {
      "src": "/icons/icon-512.png",
      "sizes": "512x512",
      "type": "image/png"
    }
  ]
}`

    const swJs = `const CACHE_NAME = 'tetris-pwa-v1';
const STATIC_ASSETS = [
  '/',
  '/index.html',
  '/public/manifest.webmanifest',
  '/src/styles/tetris-mobile.css',
  '/src/styles/ads-slot.css',
  '/src/games/tetris-engine.ts',
  '/src/components/tetris-view.ts'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request))
  );
});
`
    const mainTs = `// PWA Neon Tetris Mobile Bootstrap
import { TetrisEngine } from './games/tetris-engine';
import { TetrisMobileView } from './components/tetris-view';
import { GoogleAdsSlotManager } from './components/google-ads-slot';

export class NeonTetrisApp {
  private engine: TetrisEngine;
  private view: TetrisMobileView;
  private adsManager: GoogleAdsSlotManager;
  private tickInterval: any = null;

  constructor() {
    this.engine = new TetrisEngine();
    this.view = new TetrisMobileView();
    this.adsManager = new GoogleAdsSlotManager();
  }

  public start(): void {
    console.log('[NeonTetris] Iniciando juego PWA y componentes...');

    // 1. Montar vista Canvas y controles táctiles
    this.view.mount('#tetris-canvas', '#touch-controls');

    // 2. Conectar controles táctiles con el motor
    this.view.onInput((action) => {
      if (this.engine.getState().gameOver) {
        this.engine = new TetrisEngine();
        this.engine.spawnPiece('T');
      } else {
        if (action === 'LEFT') this.engine.move('LEFT');
        else if (action === 'RIGHT') this.engine.move('RIGHT');
        else if (action === 'ROTATE') this.engine.rotate();
        else if (action === 'DROP') this.engine.hardDrop();
      }
      this.updateUI();
    });

    // 3. Conectar teclado para pruebas en PC (Flechas y Espacio)
    if (typeof window !== 'undefined') {
      window.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowLeft') { e.preventDefault(); this.engine.move('LEFT'); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); this.engine.move('RIGHT'); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); this.engine.rotate(); }
        else if (e.key === 'ArrowDown') { e.preventDefault(); this.engine.move('DOWN'); }
        else if (e.key === ' ') { e.preventDefault(); this.engine.hardDrop(); }
        this.updateUI();
      });
    }

    // 4. Iniciar pieza y bucle de juego
    this.engine.spawnPiece('T');
    this.updateUI();
    this.tickInterval = setInterval(() => {
      if (!this.engine.getState().gameOver && !this.engine.getState().paused) {
        this.engine.tick();
        this.updateUI();
      }
    }, 800);

    // 5. Inicializar slot de Google Ads protegido contra CLS
    this.adsManager.initializeAdSlot('google-ads-container', {
      adClient: 'ca-pub-1234567890123456',
      adSlot: '9876543210',
      format: 'horizontal',
      minHeightPx: 50,
    });
  }

  private updateUI(): void {
    const state = this.engine.getState();
    this.view.render(state.board);
    const scoreEl = document.getElementById('score-val');
    const linesEl = document.getElementById('lines-val');
    const levelEl = document.getElementById('level-val');
    if (scoreEl) scoreEl.textContent = String(state.score);
    if (linesEl) linesEl.textContent = String(state.lines);
    if (levelEl) levelEl.textContent = String(state.level);
  }
}

export function bootstrapNeonTetris(): void {
  const app = new NeonTetrisApp();
  app.start();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrapNeonTetris);
  } else {
    bootstrapNeonTetris();
  }
}
`

    const testScriptShell = `
      const canvas = document.querySelector('#tetris-canvas');
      const touch = document.querySelector('#touch-controls');
      const ads = document.querySelector('#google-ads-container');
      if (!canvas || !touch || !ads) throw new Error('Componentes integrados en el shell no encontrados');
      console.log('PWA Shell integrado con Tetris y Google Ads verificado.');
      ({ pass: true, shellIntegrated: true });
    `
    return {
      className,
      code: htmlIndex,
      testScript: testScriptShell,
      isBrowserComponent: true,
      browserTest: {
        html: htmlIndex,
        selectors: ['#tetris-canvas', '#touch-controls', '#google-ads-container', '.touch-btn', 'ins.adsbygoogle'],
        captureScreenshot: true,
      },
      files: [
        { path: 'index.html', content: htmlIndex, description: 'Documento Principal PWA Integrado' },
        { path: 'src/main.ts', content: mainTs, description: 'Punto de Entrada TypeScript Principal de la PWA' },
        { path: 'public/manifest.webmanifest', content: manifestJson, description: 'Web App Manifest PWA' },
        { path: 'public/sw.js', content: swJs, description: 'Service Worker Offline de la PWA' },
      ],
    }
  }

  return null
}

/**
 * Fixture de prueba: Generación de diseño para el caso de Tetris Mobile PWA y Google Ads
 */
export function getTetrisPwaDesignPreset(comp: ComponentNode, standard: string): ComponentDesignResult | null {
  if (
    comp.id.includes('tetris_engine') ||
    (comp.id.includes('tetris') && !comp.id.includes('ui') && !comp.id.includes('ads') && !comp.id.includes('pwa')) ||
    (comp.name.toLowerCase().includes('tetris') && comp.name.toLowerCase().includes('motor'))
  ) {
    return {
      approachName: `Game Loop & Matrix Core (${standard})`,
      description: `Motor desacoplado de Tetris con matriz 10x20, tetrominós estándar (I, J, L, O, S, T, Z), rotación SRS y cálculo de puntuación sin dependencias de DOM.`,
      contracts: [
        {
          name: 'ITetrisEngine',
          schema: `export type TetrominoType = 'I' | 'J' | 'L' | 'O' | 'S' | 'T' | 'Z';\n\nexport interface Point {\n  x: number;\n  y: number;\n}\n\nexport interface TetrisGameState {\n  matrix: number[][];\n  score: number;\n  lines: number;\n  level: number;\n  isGameOver: boolean;\n  isPaused: boolean;\n}\n\nexport interface ITetrisEngine {\n  initGame(): void;\n  spawnPiece(): boolean;\n  move(direction: 'LEFT' | 'RIGHT' | 'DOWN'): boolean;\n  rotate(): boolean;\n  hardDrop(): number;\n  tick(): boolean;\n  getState(): TetrisGameState;\n}`,
        },
      ],
      tradeOffAnalysis: 'Separación estricta entre la lógica de juego determinista y el renderizado en canvas para testing en sandbox.',
    }
  } else if (
    comp.id.includes('tetris_mobile_ui') ||
    comp.id.includes('mobile_ui') ||
    (comp.name.toLowerCase().includes('tetris') &&
      (comp.name.toLowerCase().includes('ui') ||
        comp.name.toLowerCase().includes('móvil') ||
        comp.name.toLowerCase().includes('interfaz') ||
        comp.name.toLowerCase().includes('canvas')))
  ) {
    return {
      approachName: `Canvas 2D & Touch Events Adapter (${standard})`,
      description: `Adaptador de interfaz visual para móviles: renderiza el tablero en Canvas HTML5 con tema oscuro neón y controles táctiles táctiles para smartphones.`,
      contracts: [
        {
          name: 'ITetrisMobileView',
          schema: `export interface ITetrisMobileView {\n  mount(canvasElement: HTMLCanvasElement, controlsElement: HTMLElement): void;\n  renderFrame(matrix: number[][], currentPiece?: unknown): void;\n  onDirectionInput(callback: (dir: 'LEFT' | 'RIGHT' | 'DOWN' | 'ROTATE') => void): void;\n  destroy(): void;\n}`,
        },
      ],
      tradeOffAnalysis: 'Renderizado en Canvas 2D nativo sin librerías externas pesadas; soporte táctil multi-touch directo.',
    }
  } else if (
    comp.id.includes('ads') ||
    comp.name.toLowerCase().includes('ads') ||
    comp.name.toLowerCase().includes('publicidad') ||
    comp.name.toLowerCase().includes('anuncio')
  ) {
    return {
      approachName: `Reserved Ad Space & CLS Guard (${standard})`,
      description: `Contenedor publicitario para Google Ads con espacio reservado fijo (320x50 móvil) para evitar Cumulative Layout Shift (CLS) sin interferir en los controles del juego.`,
      contracts: [
        {
          name: 'IGoogleAdsSlotManager',
          schema: `export interface AdSlotConfig {\n  adClient: string;\n  adSlot: string;\n  format: 'auto' | 'rectangle' | 'horizontal';\n  minHeightPx: number;\n}\n\nexport interface IGoogleAdsSlotManager {\n  initializeAdSlot(containerId: string, config: AdSlotConfig): Promise<boolean>;\n  refreshAd(): void;\n  isAdSlotRendered(): boolean;\n}`,
        },
      ],
      tradeOffAnalysis: 'Reserva de espacio preventivo fijo en el layout; aislamiento de scripts de terceros de Google Ads.',
    }
  } else if (
    comp.id.includes('pwa') ||
    comp.id.includes('shell') ||
    comp.name.toLowerCase().includes('pwa') ||
    comp.name.toLowerCase().includes('manifest')
  ) {
    return {
      approachName: `PWA Application Shell & Offline Cache (${standard})`,
      description: `Shell de aplicación web progresiva con Web App Manifest (display: standalone, portrait) y Service Worker para ejecución offline en smartphones.`,
      contracts: [
        {
          name: 'IPwaAppShell',
          schema: `export interface IPwaAppShell {\n  registerServiceWorker(): Promise<boolean>;\n  promptPwaInstall(): Promise<boolean>;\n  isStandalone(): boolean;\n}`,
        },
      ],
      tradeOffAnalysis: 'Configuración PWA nativa sin backend; caché local de assets críticos para juego offline.',
    }
  }

  return null
}
