import type { Config } from '../config';
import type { RenderData } from '../sim';
import type { HudState } from './hud';

export type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

/** Common interface of the GPU (WebGL2) and CPU (Canvas 2D) renderers. */
export interface FrameRenderer {
  readonly kind: 'gpu' | 'cpu';
  readonly canvas: AnyCanvas;
  render(cfg: Config, data: RenderData, hud: HudState): void;
  /** Only updates the persistent paint layer (used when seeking without drawing every frame). */
  paintOnly(cfg: Config, data: RenderData): void;
  resetPaint(): void;
  dispose(): void;
}

export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

export function isDark(hex: string): boolean {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b < 0.5;
}

/** HSL → RGB in 0..1, same formula as the shaders. */
export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  return [f(0), f(8), f(4)];
}

/** Colour of the spiral walls: the ring colour, or a hue cycling with time in rainbow mode. */
export function wallColor(cfg: Config, time: number): [number, number, number] {
  return cfg.ringRainbow ? hslToRgb(((time * 40) % 360 + 360) % 360, 0.9, 0.6) : hexToRgb(cfg.ringColor);
}

/** split, speed, grow, shrink, portal A, portal B, magnet / black hole */
export const POWERUP_HUES = [130, 48, 205, 290, 28, 210, 285];
export const POWERUP_ICONS = ['×2', '⚡', '⬆', '⬇'];
