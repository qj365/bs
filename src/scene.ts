import { CHAOS_KINDS, cloneConfig, parseResolution, type Backend, type Config } from './config';
import { createRenderer, type FrameRenderer } from './render';
import { drawOverlay, drawTitle, formatTime, type HudState } from './render/hud';
import { GpuRenderer } from './render/renderer';
import { hslToRgb, type AnyCanvas } from './render/types';
import { CHAOS_BY_INDEX, counterValue, endMessage, Simulation, type SimEvent, type Stats } from './sim';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

/** One arena of a split-screen battle, in output pixels. */
export interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  cfg: Config;
  label: string;
  color: string;
}

const LETTERS = ['A', 'B', 'C', 'D'];

/** Splits the frame for a 2- or 4-arena race; a single arena fills the frame. */
export function battleCells(cfg: Config): { cells: Cell[]; header: number } {
  const { width: W, height: H } = parseResolution(cfg.resolution);
  const n = cfg.battle === 4 ? 4 : cfg.battle === 2 ? 2 : 1;
  if (n === 1) return { cells: [{ x: 0, y: 0, w: W, h: H, cfg, label: '', color: '#ffffff' }], header: 0 };
  const portrait = H > W * 1.2;
  const header = Math.round(H * (portrait ? 0.15 : 0.13));
  const footer = Math.round(H * 0.03);
  const cols = n === 4 || !portrait ? 2 : 1;
  const rows = n === 4 || portrait ? 2 : 1;
  const w = Math.floor(W / cols / 2) * 2;
  const h = Math.floor((H - header - footer) / rows / 2) * 2;
  const cells: Cell[] = [];
  for (let k = 0; k < n; k++) {
    const c = cloneConfig(cfg);
    c.resolution = `${w}x${h}`;
    c.seed = cfg.seed + k * 1009;
    c.battle = 1;
    c.title = '';
    c.showTimer = false;
    c.watermark = '';
    c.safeZone = 'none';
    c.endText = '';
    c.ringRadius = Math.min(cfg.ringRadius, 460);
    const [r, g, b] = hslToRgb((k * 360) / n, 0.85, 0.6);
    cells.push({
      x: (k % cols) * w + Math.floor((W - cols * w) / 2),
      y: header + Math.floor(k / cols) * h,
      w, h, cfg: c, label: LETTERS[k],
      color: `rgb(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)})`,
    });
  }
  return { cells, header };
}

export interface FrameExtras {
  /** Caption over the lower part of the frame. */
  overlay?: string;
  /** Blend this image over the frame (seamless loops). */
  fade?: { image: CanvasImageSource; alpha: number };
}

/**
 * Everything that is drawn into one video frame: one simulation per arena, a
 * renderer per arena, and — for battles, captions or loop fades — a 2D
 * compositor that assembles the final picture. Shared by preview and export.
 */
export class Scene {
  readonly output: AnyCanvas;
  readonly cells: Cell[];
  private header: number;
  private ctx: Ctx2D | null;
  private headerCache: { key: string; canvas: OffscreenCanvas } | null = null;

  private constructor(
    readonly sims: Simulation[],
    readonly renderers: FrameRenderer[],
    layout: { cells: Cell[]; header: number },
    output: AnyCanvas,
    private cfg: Config,
  ) {
    this.cells = layout.cells;
    this.header = layout.header;
    this.output = output;
    this.ctx = renderers.length === 1 && renderers[0].canvas === output
      ? null
      : (output.getContext('2d', { alpha: false }) as Ctx2D);
  }

  /**
   * `make(w, h, visible)` creates canvases: the visible one is the frame you see or
   * encode; the others are per-arena drawing surfaces. `composite` forces a 2D
   * compositor even for one arena (needed for loop fades).
   */
  static async create(
    cfg: Config, backend: Backend, make: (w: number, h: number, visible: boolean) => AnyCanvas,
    opts: { composite?: boolean; scale?: number } = {},
  ): Promise<Scene> {
    const layout = battleCells(cfg);
    const sims = await Promise.all(layout.cells.map((c) => Simulation.create(c.cfg)));
    const { width, height } = parseResolution(cfg.resolution);
    const scale = opts.scale ?? 1;
    const even = (v: number) => Math.max(2, Math.round((v * scale) / 2) * 2);
    const single = layout.cells.length === 1 && !opts.composite;
    const renderers = layout.cells.map((c, k) =>
      createRenderer(backend, () => make(even(c.w), even(c.h), single), sims[k].layout));
    const output = single ? renderers[0].canvas : make(even(width), even(height), true);
    return new Scene(sims, renderers, layout, output, cfg);
  }

  get kind(): 'gpu' | 'cpu' {
    return this.renderers[0].kind;
  }

  get layout() {
    return this.sims[0].layout;
  }

  /** WebGL context of the output, when it is a GPU canvas (for readPixels fallbacks). */
  get outputGl(): WebGL2RenderingContext | null {
    const r = this.renderers[0];
    return !this.ctx && r instanceof GpuRenderer ? r.gl : null;
  }

  reset(cfg: Config): void {
    this.cfg = cfg;
    const layout = battleCells(cfg);
    layout.cells.forEach((c, k) => {
      this.cells[k].cfg = c.cfg;
      this.sims[k].reset(c.cfg);
      this.renderers[k].resetPaint();
    });
  }

  advanceTo(t: number): void {
    for (const s of this.sims) s.advanceTo(t);
  }

  /** Events from every arena, tagged with their arena and a stereo position (-1 … 1). */
  drainEvents(): SimEvent[] {
    const { width } = parseResolution(this.cfg.resolution);
    const out: SimEvent[] = [];
    this.sims.forEach((sim, k) => {
      const cell = this.cells[k];
      const L = sim.layout;
      for (const e of sim.drainEvents()) {
        e.arena = k;
        const px = cell.x + (e.x / L.W) * cell.w;
        e.x = px;
        (e as SimEvent & { pan: number }).pan = Math.max(-1, Math.min(1, (px / width) * 2 - 1));
        out.push(e);
      }
    });
    return out;
  }

  paintOnly(cfg: Config): void {
    if (!cfg.paintTrail) return;
    this.sims.forEach((sim, k) => this.renderers[k].paintOnly(this.cells[k].cfg, sim.renderData(0)));
  }

  /** Combined stats. In a battle the first arena to finish wins the race. */
  stats(): Stats & { winner: number } {
    const all = this.sims.map((s) => s.stats());
    if (all.length === 1) return { ...all[0], winner: -1 };
    let winner = -1;
    let first = Infinity;
    all.forEach((st, k) => {
      if (st.finished && st.finishTime < first) {
        first = st.finishTime;
        winner = k;
      }
    });
    const base = all[0];
    return {
      ...base,
      finished: winner >= 0,
      finishTime: winner >= 0 ? first : -1,
      winnerTeam: winner,
      alive: all.reduce((s, x) => s + x.alive, 0),
      inside: all.reduce((s, x) => s + x.inside, 0),
      bounces: all.reduce((s, x) => s + x.bounces, 0),
      nearMisses: all.reduce((s, x) => s + x.nearMisses, 0),
      winner,
    };
  }

  private banner(cfg: Config, st: Stats): string {
    if (st.lastChaosKind < 0 || st.time - st.lastChaosTime > 1.8) return '';
    const kind = CHAOS_BY_INDEX[st.lastChaosKind];
    const ev = cfg.chaos.find((e) => e.kind === kind && Math.abs(e.t - st.lastChaosTime) < 0.05);
    return CHAOS_KINDS[kind].banner.replace('{v}', String(ev?.value ?? ''));
  }

  render(cfg: Config, time: number, extras: FrameExtras = {}): void {
    const single = this.cells.length === 1;
    this.sims.forEach((sim, k) => {
      const cell = this.cells[k];
      const ccfg = single ? cfg : { ...cell.cfg, bgColor: cfg.bgColor, ringColor: cfg.ringColor, ballColor: cfg.ballColor, textColor: cfg.textColor };
      const st = sim.stats();
      const data = sim.renderData(cfg.trailLength);
      const hud: HudState = {
        counter: counterValue(ccfg, st),
        time,
        end: single ? endMessage(cfg, st) : '',
        powerups: data.powerups,
        powerupCount: data.powerupCount,
        banner: this.banner(cfg, st),
        overlay: single && !this.ctx ? extras.overlay : undefined,
      };
      this.renderers[k].render(ccfg, data, hud);
    });
    if (!this.ctx) return;
    this.composite(cfg, time, extras);
  }

  private composite(cfg: Config, time: number, extras: FrameExtras): void {
    const ctx = this.ctx!;
    const { width, height } = this.output;
    const k = width / parseResolution(cfg.resolution).width;
    ctx.globalAlpha = 1;
    ctx.fillStyle = cfg.bgColor;
    ctx.fillRect(0, 0, width, height);
    const single = this.cells.length === 1;
    this.cells.forEach((c, i) => ctx.drawImage(this.renderers[i].canvas, c.x * k, c.y * k, c.w * k, c.h * k));

    if (!single) {
      const titleSize = cfg.titleSize * (width / 1080) * 0.9;
      const key = `${cfg.title}|${titleSize}|${cfg.textColor}|${width}`;
      if (this.headerCache?.key !== key) {
        const canvas = new OffscreenCanvas(width, Math.max(1, Math.round(this.header * k)));
        const hctx = canvas.getContext('2d')!;
        if (cfg.title.trim()) drawTitle(hctx, cfg.title, width / 2, canvas.height / 2, titleSize, cfg.textColor, width * 0.9);
        this.headerCache = { key, canvas };
      }
      ctx.drawImage(this.headerCache.canvas, 0, 0);
      const st = this.stats();
      this.cells.forEach((c, i) => {
        const s = Math.round(Math.min(c.w, c.h) * k * 0.08);
        const x = c.x * k + s * 0.9, y = c.y * k + s * 0.9;
        ctx.fillStyle = c.color;
        ctx.beginPath();
        ctx.arc(x, y, s * 0.7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#000000';
        ctx.font = `900 ${s * 0.8}px "Segoe UI", system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.label, x, y + s * 0.03);
        if (st.winner === i) {
          ctx.strokeStyle = c.color;
          ctx.lineWidth = Math.max(3, s * 0.15);
          ctx.strokeRect(c.x * k + 2, c.y * k + 2, c.w * k - 4, c.h * k - 4);
        }
      });
      if (cfg.showTimer) {
        ctx.font = `700 ${titleSize * 0.6}px "Segoe UI", system-ui, sans-serif`;
        ctx.fillStyle = cfg.textColor;
        ctx.textAlign = 'right';
        ctx.fillText(formatTime(time), width - titleSize * 0.5, this.header * k - titleSize * 0.4);
      }
      if (st.winner >= 0) {
        const label = this.cells[st.winner].label;
        const text = cfg.endText.includes('{winner}') ? cfg.endText.replace('{winner}', label) : `${label} THẮNG!`;
        drawOverlay(ctx, text, width / 2, height / 2, titleSize * 1.2, width);
      }
    }
    if (extras.overlay) drawOverlay(ctx, extras.overlay, width / 2, height * 0.78, cfg.titleSize * (width / 1080), width);
    if (extras.fade && extras.fade.alpha > 0) {
      ctx.globalAlpha = Math.min(1, extras.fade.alpha);
      ctx.drawImage(extras.fade.image, 0, 0, width, height);
      ctx.globalAlpha = 1;
    }
  }

  dispose(): void {
    for (const r of this.renderers) r.dispose();
  }
}
