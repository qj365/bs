import type { Config } from '../config';
import { POWERUP_STRIDE, type Layout } from '../sim';
import { POWERUP_ICONS } from './types';

export interface HudState {
  counter: string;
  time: number;
  end: string;
  /** Power-up records (x y r kind …) from the simulation, for drawing their icons. */
  powerups?: Float32Array;
  powerupCount?: number;
  /** Short-lived announcement (timeline events), shown under the title. */
  banner?: string;
  /** Caption over the lower part of the frame (e.g. "Xem phần 2 👀"). */
  overlay?: string;
}

type Canvas2D = OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

const FONT_FAMILY = '"Segoe UI", system-ui, -apple-system, Roboto, Arial, sans-serif';

/**
 * Draws the text overlay (title, counter, timer, end message, power-up icons,
 * watermark) on a 2D canvas. It only redraws when the content actually changes;
 * `version` lets the GPU renderer skip re-uploading the texture otherwise.
 */
export class Hud {
  readonly canvas: OffscreenCanvas;
  private ctx: Canvas2D;
  private key = '';
  version = 0;
  empty = true;

  constructor(private width: number, private height: number) {
    this.canvas = new OffscreenCanvas(width, height);
    this.ctx = this.canvas.getContext('2d')!;
  }

  update(cfg: Config, layout: Layout, s: HudState): void {
    const timer = cfg.showTimer ? formatTime(s.time) : '';
    const counter = cfg.showCounter && s.counter !== '' ? cfg.counterLabel + s.counter : '';
    const icons: number[] = [];
    for (let i = 0; i < (s.powerupCount ?? 0); i++) {
      const o = i * POWERUP_STRIDE;
      const p = s.powerups!;
      if (p[o + 3] < 4) icons.push(Math.round(p[o]), Math.round(p[o + 1]), Math.round(p[o + 2]), p[o + 3]);
    }
    const key = [
      cfg.title, cfg.titleSize, cfg.textColor, counter, timer, s.end, cfg.ringRadius,
      cfg.watermark, cfg.watermarkPos, cfg.watermarkOpacity, layout.cy, icons.join(','), s.banner ?? '', s.overlay ?? '',
    ].join('\u0001');
    if (key === this.key) return;
    this.key = key;
    this.version++;

    const ctx = this.ctx;
    const k = this.width / layout.W; // pixels per world unit
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    this.empty = !cfg.title && !counter && !timer && !s.end && !cfg.watermark && icons.length === 0 && !s.banner && !s.overlay;
    const midX = ((layout.safe.left + layout.W - layout.safe.right) / 2) * k;

    const size = cfg.titleSize * k;
    if (cfg.title.trim()) {
      ctx.font = `800 ${size}px ${FONT_FAMILY}`;
      const lines = wrap(ctx, cfg.title, (layout.W - layout.safe.left - layout.safe.right) * 0.9 * k);
      const top = layout.safe.top * k;
      const arenaTop = (layout.cy - cfg.ringRadius) * k;
      const lineH = size * 1.18;
      // Center the title block in the space between the safe top and the arena.
      const space = Math.max(arenaTop - top, size * 2);
      let y = top + Math.max(size * 0.9, space / 2 - ((lines.length - 1) * lineH) / 2);
      for (const line of lines) {
        this.outlined(line, midX, y, size, cfg.textColor);
        y += lineH;
      }
    }

    const small = size * 0.85;
    const bottomLimit = this.height - layout.safe.bottom * k;
    let y = (layout.cy + cfg.ringRadius) * k + small * 1.4;
    if (y > bottomLimit - small) y = bottomLimit - small * 1.6;
    if (counter) {
      ctx.font = `800 ${small}px ${FONT_FAMILY}`;
      this.outlined(counter, midX, y, small, cfg.textColor);
      y += small * 1.25;
    }
    if (timer) {
      ctx.font = `700 ${small * 0.8}px ${FONT_FAMILY}`;
      this.outlined(timer, midX, Math.min(y, bottomLimit - small), small * 0.8, cfg.textColor);
    }

    for (let i = 0; i < icons.length; i += 4) {
      const r = icons[i + 2] * k;
      ctx.font = `900 ${r * 0.95}px ${FONT_FAMILY}`;
      this.outlined(POWERUP_ICONS[icons[i + 3] & 3], icons[i] * k, icons[i + 1] * k, r * 0.7, '#ffffff');
    }

    if (cfg.watermark.trim()) {
      const ws = size * 0.5;
      ctx.font = `700 ${ws}px ${FONT_FAMILY}`;
      const pad = ws * 1.2;
      const left = layout.safe.left * k + pad;
      const right = this.width - layout.safe.right * k - pad;
      const top = layout.safe.top * k + pad;
      const bottom = bottomLimit - pad;
      const pos = {
        tl: [left, top, 'left'], tr: [right, top, 'right'], bl: [left, bottom, 'left'],
        br: [right, bottom, 'right'], center: [this.width / 2, this.height / 2, 'center'],
      }[cfg.watermarkPos] as [number, number, CanvasTextAlign];
      ctx.save();
      ctx.globalAlpha = Math.max(0, Math.min(1, cfg.watermarkOpacity));
      ctx.textAlign = pos[2];
      this.outlined(cfg.watermark, pos[0], pos[1], ws, cfg.textColor);
      ctx.restore();
    }

    if (s.banner) {
      const bs = size * 0.62;
      ctx.font = `900 ${bs}px ${FONT_FAMILY}`;
      const w = Math.min(this.width * 0.9, ctx.measureText(s.banner).width + bs * 1.2);
      const y = Math.max(layout.safe.top * k + bs, (layout.cy - cfg.ringRadius) * k - bs * 0.2);
      ctx.fillStyle = 'rgba(255,59,107,0.85)';
      roundRect(ctx, midX - w / 2, y - bs * 0.75, w, bs * 1.5, bs * 0.5);
      ctx.fill();
      this.outlined(s.banner, midX, y, bs, '#ffffff');
    }

    if (s.overlay) {
      drawOverlay(ctx, s.overlay, midX, bottomLimit - size * 2.2, size, this.width);
    }

    if (s.end) {
      const big = size * 1.35;
      ctx.font = `900 ${big}px ${FONT_FAMILY}`;
      const lines = wrap(ctx, s.end, layout.W * 0.85 * k);
      const lineH = big * 1.15;
      const blockH = lines.length * lineH + big * 0.6;
      const w = Math.min(this.width * 0.92, Math.max(...lines.map((l) => ctx.measureText(l).width)) + big);
      const cy = layout.cy * k;
      ctx.fillStyle = 'rgba(0,0,0,0.55)';
      roundRect(ctx, midX - w / 2, cy - blockH / 2, w, blockH, big * 0.4);
      ctx.fill();
      let ly = cy - ((lines.length - 1) * lineH) / 2;
      for (const line of lines) {
        this.outlined(line, midX, ly, big, cfg.textColor);
        ly += lineH;
      }
    }
  }

  private outlined(text: string, x: number, y: number, size: number, color: string): void {
    const ctx = this.ctx;
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color;
    ctx.fillText(text, x, y);
  }
}

/** Big caption on a dark pill, used for "Part 2" style call-outs. */
export function drawOverlay(ctx: Canvas2D, text: string, x: number, y: number, size: number, maxWidth: number): void {
  const os = size * 1.05;
  ctx.save();
  ctx.font = `900 ${os}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const w = Math.min(maxWidth * 0.92, ctx.measureText(text).width + os * 1.4);
  ctx.fillStyle = 'rgba(0,0,0,0.7)';
  roundRect(ctx, x - w / 2, y - os * 0.85, w, os * 1.7, os * 0.5);
  ctx.fill();
  ctx.lineWidth = os * 0.16;
  ctx.strokeStyle = 'rgba(0,0,0,0.75)';
  ctx.strokeText(text, x, y);
  ctx.fillStyle = '#ffffff';
  ctx.fillText(text, x, y);
  ctx.restore();
}

export function drawTitle(ctx: Canvas2D, text: string, x: number, y: number, size: number, color: string, maxWidth: number): void {
  ctx.save();
  ctx.font = `800 ${size}px ${FONT_FAMILY}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  const lines = wrap(ctx, text, maxWidth);
  let ly = y - ((lines.length - 1) * size * 1.18) / 2;
  for (const line of lines) {
    ctx.lineWidth = size * 0.16;
    ctx.strokeStyle = 'rgba(0,0,0,0.75)';
    ctx.strokeText(line, x, ly);
    ctx.fillStyle = color;
    ctx.fillText(line, x, ly);
    ly += size * 1.18;
  }
  ctx.restore();
}

function wrap(ctx: Canvas2D, text: string, maxWidth: number): string[] {
  const out: string[] = [];
  for (const para of text.split('\n')) {
    let line = '';
    for (const word of para.split(/\s+/).filter(Boolean)) {
      const test = line ? line + ' ' + word : word;
      if (line && ctx.measureText(test).width > maxWidth) {
        out.push(line);
        line = word;
      } else {
        line = test;
      }
    }
    out.push(line);
  }
  return out;
}

function roundRect(ctx: Canvas2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export function formatTime(t: number): string {
  const m = Math.floor(t / 60);
  const s = t - m * 60;
  return `${m}:${s.toFixed(1).padStart(4, '0')}`;
}
