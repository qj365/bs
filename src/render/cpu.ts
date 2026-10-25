import type { Config } from '../config';
import {
  BALL_STRIDE, GEM_STRIDE, PARTICLE_STRIDE, POWERUP_STRIDE, RING_STRIDE, SEG_STRIDE, type Layout, type RenderData,
} from '../sim';
import { Hud, type HudState } from './hud';
import { hslToRgb, isDark, POWERUP_HUES, wallColor, type AnyCanvas, type FrameRenderer } from './types';

type Ctx2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const css = ([r, g, b]: [number, number, number], a = 1) =>
  `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`;

/**
 * Canvas 2D renderer: runs entirely on the CPU. Slower than the WebGL2 renderer
 * with many balls, but works on machines without WebGL2 (old GPUs, remote
 * desktop, blocklisted drivers) and produces the same picture.
 */
export class CpuRenderer implements FrameRenderer {
  readonly kind = 'cpu' as const;
  private ctx: Ctx2D;
  private paint: OffscreenCanvas;
  private paintCtx: OffscreenCanvasRenderingContext2D;
  private hud: Hud;
  private glowCache = new Map<string, OffscreenCanvas>();
  private colorCache = new Map<number, string>();

  constructor(readonly canvas: AnyCanvas, private layout: Layout) {
    const ctx = canvas.getContext('2d', { alpha: false }) as Ctx2D | null;
    if (!ctx) throw new Error('Canvas 2D không khả dụng.');
    this.ctx = ctx;
    this.paint = new OffscreenCanvas(canvas.width, canvas.height);
    this.paintCtx = this.paint.getContext('2d')!;
    this.hud = new Hud(canvas.width, canvas.height);
  }

  private get px(): number {
    return this.canvas.width / this.layout.W;
  }

  private hue(h: number, l = 0.6): string {
    const key = Math.round(((h % 360) + 360) % 360) * 100 + Math.round(l * 100);
    let c = this.colorCache.get(key);
    if (!c) {
      c = css(hslToRgb(((h % 360) + 360) % 360, 0.9, l));
      this.colorCache.set(key, c);
    }
    return c;
  }

  private ballColor(cfg: Config, hue: number, bounces: number): string {
    if (cfg.colorMode === 'solid') return cfg.ballColor;
    return this.hue(cfg.colorMode === 'cycle' ? hue + bounces * 25 : hue);
  }

  private glowSprite(color: string): OffscreenCanvas {
    let s = this.glowCache.get(color);
    if (!s) {
      s = new OffscreenCanvas(64, 64);
      const c = s.getContext('2d')!;
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, color);
      g.addColorStop(1, 'rgba(0,0,0,0)');
      c.globalAlpha = 0.6;
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      if (this.glowCache.size > 512) this.glowCache.clear();
      this.glowCache.set(color, s);
    }
    return s;
  }

  resetPaint(): void {
    this.paintCtx.clearRect(0, 0, this.paint.width, this.paint.height);
  }

  paintOnly(cfg: Config, data: RenderData): void {
    if (!cfg.paintTrail) return;
    const c = this.paintCtx;
    const k = this.px;
    c.lineCap = 'round';
    const b = data.balls;
    for (let i = 0; i < data.ballCount; i++) {
      const o = i * BALL_STRIDE;
      c.strokeStyle = this.ballColor(cfg, b[o + 3], b[o + 6]);
      c.lineWidth = b[o + 2] * 2 * k;
      c.beginPath();
      c.moveTo(b[o + 4] * k, b[o + 5] * k);
      c.lineTo(b[o] * k + 0.01, b[o + 1] * k);
      c.stroke();
    }
  }

  private segments(cfg: Config, data: Float32Array, count: number, solid?: string): void {
    const c = this.ctx;
    const k = this.px;
    c.lineCap = 'round';
    for (let i = 0; i < count; i++) {
      const o = i * SEG_STRIDE;
      c.globalAlpha = data[o + 6];
      c.strokeStyle = solid ?? this.ballColor(cfg, data[o + 5], data[o + 7]);
      c.lineWidth = Math.max(data[o + 4] * 2 * k, 0.75);
      c.beginPath();
      c.moveTo(data[o] * k, data[o + 1] * k);
      c.lineTo(data[o + 2] * k + 0.01, data[o + 3] * k);
      c.stroke();
    }
    c.globalAlpha = 1;
  }

  private rings(cfg: Config, data: RenderData, time: number): void {
    const c = this.ctx;
    const k = this.px;
    const r = data.rings;
    for (let i = 0; i < data.ringCount; i++) {
      const o = i * RING_STRIDE;
      const [cx, cy, R, th, rot, gap, hue, flash, spikeCenter, spikeArc, glass, spikeLen, sides, toothWidth] =
        Array.from(r.subarray(o, o + RING_STRIDE));
      const base = cfg.ringRainbow ? this.hue(hue + time * 40) : cfg.ringColor;
      const glassy = glass >= 0;
      const poly = sides >= 3;
      const step = poly ? (Math.PI * 2) / sides : 0;
      const apo = poly ? R * Math.cos(Math.PI / sides) : R;
      // A point on the wall at world angle `a`, pulled `inset` towards the centre.
      const wallPoint = (a: number, inset: number): [number, number] => {
        let rad = R - inset;
        if (poly) {
          const local = a - rot;
          const phi = Math.round(local / step) * step;
          rad = (apo - inset) / Math.cos(local - phi);
        }
        return [(cx + Math.cos(a) * rad) * k, (cy + Math.sin(a) * rad) * k];
      };
      c.lineCap = gap > 0 ? 'round' : 'butt';
      c.lineJoin = 'miter';
      const outline = () => {
        c.beginPath();
        if (!poly) {
          if (gap > 0) c.arc(cx * k, cy * k, R * k, rot + gap / 2, rot + Math.PI * 2 - gap / 2);
          else c.arc(cx * k, cy * k, R * k, 0, Math.PI * 2);
          return;
        }
        const a0 = rot + gap / 2;
        const a1 = rot + Math.PI * 2 - gap / 2;
        c.moveTo(...wallPoint(a0, 0));
        // Corners sit halfway between side normals.
        for (let v = 0; v < sides; v++) {
          const av = rot + (v + 0.5) * step;
          if (av > a0 && av < a1) c.lineTo(...wallPoint(av, 0));
        }
        c.lineTo(...wallPoint(a1, 0));
        if (gap <= 0) c.closePath();
      };
      if (cfg.glow) {
        c.globalAlpha = 0.25;
        c.strokeStyle = base;
        c.lineWidth = th * 3 * k;
        outline();
        c.stroke();
      }
      c.globalAlpha = glassy ? 0.6 : 1;
      c.strokeStyle = base;
      c.lineWidth = th * k;
      outline();
      c.stroke();
      if (flash > 0) {
        c.globalAlpha = flash * 0.7;
        c.strokeStyle = '#ffffff';
        outline();
        c.stroke();
      }
      c.globalAlpha = 1;
      if (glassy) {
        // Cracks spread as the glass loses hit points.
        const cracks = Math.floor((1 - glass) * 28);
        c.strokeStyle = '#ffffff';
        c.lineWidth = 1.2;
        for (let n = 0; n < cracks; n++) {
          const a = fract(Math.sin((n + 1) * 127.1) * 43758.5453) * Math.PI * 2;
          c.beginPath();
          c.moveTo(...wallPoint(a, th / 2));
          c.lineTo(...wallPoint(a, -th / 2));
          c.stroke();
        }
      }
      if (spikeArc > 0 && spikeLen > 0) {
        const width = Math.max(toothWidth, 4);
        const inSpikes = (a: number) => {
          const d = Math.atan2(Math.sin(a - spikeCenter), Math.cos(a - spikeCenter));
          const g = Math.atan2(Math.sin(a - rot), Math.cos(a - rot));
          return Math.abs(d) < spikeArc / 2 && !(gap > 0 && Math.abs(g) < gap / 2);
        };
        c.fillStyle = flash > 0.3 ? '#ffffff' : '#ff4059';
        c.beginPath();
        const inner = th / 2;
        if (poly) {
          const half = (apo - inner) * Math.tan(Math.PI / sides);
          for (let e = 0; e < sides; e++) {
            const phi = rot + e * step;
            const [nx, ny] = [Math.cos(phi), Math.sin(phi)];
            const [tx, ty] = [-ny, nx];
            const teeth = Math.max(1, Math.floor((2 * half) / width));
            const w = (2 * half) / teeth;
            for (let t = 0; t < teeth; t++) {
              const s0 = -half + t * w, s1 = s0 + w, sm = (s0 + s1) / 2;
              const mx = nx * (apo - inner) + tx * sm, my = ny * (apo - inner) + ty * sm;
              if (!inSpikes(Math.atan2(my, mx))) continue;
              const p = (s: number, d: number): [number, number] =>
                [(cx + nx * (apo - inner - d) + tx * s) * k, (cy + ny * (apo - inner - d) + ty * s) * k];
              c.moveTo(...p(s0, 0));
              c.lineTo(...p(sm, spikeLen));
              c.lineTo(...p(s1, 0));
            }
          }
        } else {
          const rin = R - inner;
          const teeth = Math.max(1, Math.floor((Math.PI * 2 * rin) / width));
          const da = (Math.PI * 2) / teeth;
          for (let t = 0; t < teeth; t++) {
            const a0 = rot + t * da, a1 = a0 + da, am = (a0 + a1) / 2;
            if (!inSpikes(am)) continue;
            c.moveTo((cx + Math.cos(a0) * rin) * k, (cy + Math.sin(a0) * rin) * k);
            c.lineTo((cx + Math.cos(am) * (rin - spikeLen)) * k, (cy + Math.sin(am) * (rin - spikeLen)) * k);
            c.lineTo((cx + Math.cos(a1) * rin) * k, (cy + Math.sin(a1) * rin) * k);
          }
        }
        c.fill();
      }
    }
  }

  render(cfg: Config, data: RenderData, hud: HudState): void {
    const c = this.ctx;
    const k = this.px;
    const { width, height } = this.canvas;
    this.paintOnly(cfg, data);

    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.fillStyle = cfg.bgColor;
    c.fillRect(0, 0, width, height);
    if (cfg.paintTrail) c.drawImage(this.paint, 0, 0);

    this.segments(cfg, data.lines, data.lineCount);
    if (data.trailCount > 0) {
      if (isDark(cfg.bgColor)) c.globalCompositeOperation = 'lighten';
      this.segments(cfg, data.trails, data.trailCount);
      c.globalCompositeOperation = 'source-over';
    }
    this.segments(cfg, data.walls, data.wallCount, css(wallColor(cfg, hud.time)));
    this.rings(cfg, data, hud.time);

    // Gems as faceted diamonds.
    for (let i = 0; i < data.gemCount; i++) {
      const o = i * GEM_STRIDE;
      const [x, y, s, hue, , mult] = Array.from(data.gems.subarray(o, o + GEM_STRIDE));
      const r = s * 1.15 * k;
      c.fillStyle = this.hue(hue + mult * 25, 0.72);
      c.beginPath();
      c.moveTo(x * k, y * k - r);
      c.lineTo(x * k + r, y * k);
      c.lineTo(x * k, y * k + r);
      c.lineTo(x * k - r, y * k);
      c.closePath();
      c.fill();
    }

    for (let i = 0; i < data.powerupCount; i++) {
      const o = i * POWERUP_STRIDE;
      const [x, y, r, kind, life, pulse] = Array.from(data.powerups.subarray(o, o + POWERUP_STRIDE));
      const rr = r * (1 + 0.08 * pulse) * k;
      c.globalAlpha = Math.min(1, life * 4);
      const col = this.hue(POWERUP_HUES[Math.min(6, Math.max(0, kind | 0))], 0.58);
      c.fillStyle = col;
      c.globalAlpha *= 0.28;
      c.beginPath();
      c.arc(x * k, y * k, rr, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = Math.min(1, life * 4);
      c.strokeStyle = col;
      c.lineWidth = rr * 0.24;
      c.beginPath();
      c.arc(x * k, y * k, rr * 0.86, 0, Math.PI * 2);
      c.stroke();
      c.globalAlpha = 1;
    }

    if (cfg.particles) {
      const p = data.particles;
      for (let i = 0; i < data.particleCount; i++) {
        const o = i * PARTICLE_STRIDE;
        c.globalAlpha = p[o + 4];
        c.fillStyle = cfg.colorMode === 'solid' ? cfg.ballColor : this.hue(p[o + 3], 0.62);
        c.beginPath();
        c.arc(p[o] * k, p[o + 1] * k, p[o + 2] * k, 0, Math.PI * 2);
        c.fill();
      }
      c.globalAlpha = 1;
    }

    const b = data.balls;
    for (let i = 0; i < data.ballCount; i++) {
      const o = i * BALL_STRIDE;
      const x = b[o] * k, y = b[o + 1] * k, r = b[o + 2] * k;
      const flags = b[o + 7];
      const col = flags >= 2 ? cfg.heroColor : this.ballColor(cfg, b[o + 3], b[o + 6]);
      if (cfg.glow) c.drawImage(this.glowSprite(col), x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
      c.fillStyle = col;
      c.beginPath();
      c.arc(x, y, r, 0, Math.PI * 2);
      c.fill();
      if (cfg.ballOutline || flags % 2 >= 1) {
        c.strokeStyle = '#ffffff';
        c.lineWidth = r * 0.22;
        c.beginPath();
        c.arc(x, y, r * 0.89, 0, Math.PI * 2);
        c.stroke();
      }
    }

    this.hud.update(cfg, this.layout, hud);
    if (!this.hud.empty) c.drawImage(this.hud.canvas, 0, 0);
  }

  dispose(): void {
    this.glowCache.clear();
  }
}

function fract(x: number): number {
  return x - Math.floor(x);
}
