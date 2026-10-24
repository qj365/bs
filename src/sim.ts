import wasmUrl from './wasm/ball_sim.wasm?url';
import { type Config, type Mode, parseResolution } from './config';

// Parameter slots — must match the P_* constants in sim/src/lib.rs.
const P = {
  mode: 0, seed: 1, w: 2, h: 3, cx: 4, cy: 5,
  ringRadius: 6, ringThickness: 7, ringCount: 8, ringSpacing: 9, gapAngle: 10, rotationSpeed: 11, alternate: 12,
  initialBalls: 13, ballRadius: 14, maxBalls: 15, spawnOnEscape: 16, grow: 17, spawnInterval: 18, dropSpread: 19,
  gravity: 20, restitution: 21, speedBoost: 22, initialSpeed: 23, maxSpeed: 24, ballCollisions: 25,
  teamCount: 26, teamHues: 27,
} as const;
const MAX_TEAMS = 16;

const MODE_INDEX: Record<Mode, number> = {
  escape: 0, grow: 1, destruction: 2, trail: 3, merge: 4, koth: 5, symmetric: 6,
};

// Floats per record — must match the *_STRIDE constants in lib.rs.
export const BALL_STRIDE = 8;
export const TRAIL_STRIDE = 8;
export const RING_STRIDE = 8;
export const PARTICLE_STRIDE = 6;
export const EVENT_STRIDE = 6;

export type EventKind = 'bounce' | 'hit' | 'escape' | 'break' | 'merge' | 'finish';
const EVENT_KINDS: EventKind[] = ['bounce', 'hit', 'escape', 'break', 'merge', 'finish'];

export interface SimEvent {
  t: number;
  kind: EventKind;
  strength: number;
  r: number;
  level: number;
  team: number;
}

export interface RenderData {
  balls: Float32Array;
  ballCount: number;
  trails: Float32Array;
  trailCount: number;
  rings: Float32Array;
  ringCount: number;
  particles: Float32Array;
  particleCount: number;
}

export interface Stats {
  counter: number;
  finished: boolean;
  finishTime: number;
  winnerTeam: number;
  time: number;
  inside: number;
  ringsTotal: number;
  ringsBroken: number;
  fillPercent: number;
  alive: number;
}

interface SimExports {
  memory: WebAssembly.Memory;
  param_count(): number;
  params_ptr(): number;
  init(): void;
  advance_to(t: number): void;
  build_render(trailLen: number): void;
  stat(i: number): number;
  clear_events(): void;
  balls_ptr(): number; balls_len(): number;
  trails_ptr(): number; trails_len(): number;
  rings_ptr(): number; rings_len(): number;
  particles_ptr(): number; particles_len(): number;
  events_ptr(): number; events_len(): number;
}

/** World size in simulation units: the short side is always 1080. */
export interface Layout {
  W: number;
  H: number;
  cx: number;
  cy: number;
  width: number;
  height: number;
}

export function computeLayout(cfg: Config): Layout {
  const { width, height } = parseResolution(cfg.resolution);
  const k = 1080 / Math.min(width, height);
  const W = width * k;
  const H = height * k;
  // Portrait videos leave room for the title above the arena.
  const cy = H > W * 1.2 ? H * 0.53 : H / 2;
  return { W, H, cx: W / 2, cy, width, height };
}

const COLOR_HUES: [RegExp, number][] = [
  [/red|đỏ|do\b/i, 0],
  [/orange|cam/i, 28],
  [/yellow|vàng|vang/i, 52],
  [/green|lục|xanh lá/i, 125],
  [/cyan|lam/i, 185],
  [/blue|dương|duong|xanh/i, 220],
  [/purple|tím|tim\b/i, 275],
  [/pink|hồng|hong/i, 320],
];

export function teamNames(cfg: Config): string[] {
  return cfg.teamNames.split(',').map((s) => s.trim()).filter(Boolean);
}

/** Team hue from its name when it names a colour ("Red", "Xanh"...), otherwise evenly spaced. */
export function teamHues(cfg: Config): number[] {
  const n = Math.min(cfg.initialBalls, MAX_TEAMS);
  const names = teamNames(cfg);
  const hues: number[] = [];
  for (let i = 0; i < n; i++) {
    const name = names[i] ?? '';
    const match = COLOR_HUES.find(([re]) => re.test(name));
    hues.push(match ? match[1] : (i * 360) / n);
  }
  return hues;
}

let modulePromise: Promise<WebAssembly.Module> | null = null;

function loadModule(): Promise<WebAssembly.Module> {
  modulePromise ??= WebAssembly.compileStreaming(fetch(wasmUrl)).catch(async () => {
    // Some servers send .wasm without the application/wasm MIME type.
    const bytes = await (await fetch(wasmUrl)).arrayBuffer();
    return WebAssembly.compile(bytes);
  });
  return modulePromise;
}

/** One simulation instance backed by its own WASM instance (and memory). */
export class Simulation {
  readonly layout: Layout;

  private constructor(private e: SimExports, readonly cfg: Config) {
    this.layout = computeLayout(cfg);
    // Grab the pointer first: the call may grow memory and detach older views.
    const ptr = e.params_ptr();
    const params = new Float64Array(e.memory.buffer, ptr, e.param_count());
    const L = this.layout;
    params.fill(0);
    params[P.mode] = MODE_INDEX[cfg.mode];
    params[P.seed] = cfg.seed;
    params[P.w] = L.W;
    params[P.h] = L.H;
    params[P.cx] = L.cx;
    params[P.cy] = L.cy;
    params[P.ringRadius] = cfg.ringRadius;
    params[P.ringThickness] = cfg.ringThickness;
    params[P.ringCount] = cfg.ringCount;
    params[P.ringSpacing] = cfg.ringSpacing;
    params[P.gapAngle] = cfg.gapAngle;
    params[P.rotationSpeed] = cfg.rotationSpeed;
    params[P.alternate] = cfg.alternateRotation ? 1 : 0;
    params[P.initialBalls] = cfg.initialBalls;
    params[P.ballRadius] = cfg.ballRadius;
    params[P.maxBalls] = cfg.maxBalls;
    params[P.spawnOnEscape] = cfg.spawnOnEscape;
    params[P.grow] = cfg.growAmount;
    params[P.spawnInterval] = cfg.spawnInterval;
    params[P.dropSpread] = cfg.dropSpread;
    params[P.gravity] = cfg.gravity;
    params[P.restitution] = cfg.restitution;
    params[P.speedBoost] = cfg.speedBoost;
    params[P.initialSpeed] = cfg.initialSpeed;
    params[P.maxSpeed] = cfg.maxSpeed;
    params[P.ballCollisions] = cfg.ballCollisions ? 1 : 0;
    const hues = cfg.mode === 'koth' ? teamHues(cfg) : [];
    params[P.teamCount] = hues.length;
    hues.forEach((h, i) => (params[P.teamHues + i] = h));
    e.init();
  }

  static async create(cfg: Config): Promise<Simulation> {
    const module = await loadModule();
    const instance = await WebAssembly.instantiate(module, {});
    return new Simulation(instance.exports as unknown as SimExports, cfg);
  }

  advanceTo(t: number): void {
    this.e.advance_to(t);
  }

  /** Returns and clears the events produced since the last call. */
  drainEvents(): SimEvent[] {
    const n = this.e.events_len();
    if (n === 0) return [];
    const ptr = this.e.events_ptr();
    const f = new Float32Array(this.e.memory.buffer, ptr, n * EVENT_STRIDE);
    const out: SimEvent[] = new Array(n);
    for (let i = 0; i < n; i++) {
      const o = i * EVENT_STRIDE;
      out[i] = { t: f[o], kind: EVENT_KINDS[f[o + 1]] ?? 'bounce', strength: f[o + 2], r: f[o + 3], level: f[o + 4], team: f[o + 5] };
    }
    this.e.clear_events();
    return out;
  }

  /** Fills the render buffers and returns zero-copy views into WASM memory (valid until the next sim call). */
  renderData(trailLength: number): RenderData {
    const e = this.e;
    e.build_render(Math.max(0, Math.floor(trailLength)));
    const ballCount = e.balls_len(), bp = e.balls_ptr();
    const trailCount = e.trails_len(), tp = e.trails_ptr();
    const ringCount = e.rings_len(), rp = e.rings_ptr();
    const particleCount = e.particles_len(), pp = e.particles_ptr();
    const buf = e.memory.buffer;
    return {
      balls: new Float32Array(buf, bp, ballCount * BALL_STRIDE),
      ballCount,
      trails: new Float32Array(buf, tp, trailCount * TRAIL_STRIDE),
      trailCount,
      rings: new Float32Array(buf, rp, ringCount * RING_STRIDE),
      ringCount,
      particles: new Float32Array(buf, pp, particleCount * PARTICLE_STRIDE),
      particleCount,
    };
  }

  stats(): Stats {
    const s = (i: number) => this.e.stat(i);
    return {
      counter: s(0),
      finished: s(1) === 1,
      finishTime: s(2),
      winnerTeam: s(3),
      time: s(4),
      inside: s(5),
      ringsTotal: s(6),
      ringsBroken: s(7),
      fillPercent: s(8),
      alive: s(9),
    };
  }
}

/** The counter text shown under the arena for the current mode. */
export function counterValue(cfg: Config, st: Stats): string {
  switch (cfg.mode) {
    case 'escape':
      return String(st.inside);
    case 'destruction':
      return `${st.ringsBroken}/${st.ringsTotal}`;
    case 'grow':
    case 'trail':
      return `${Math.floor(st.fillPercent)}%`;
    case 'merge':
      return String(st.counter);
    case 'koth':
      return String(st.inside);
    case 'symmetric':
      return String(st.alive);
  }
}

export function endMessage(cfg: Config, st: Stats): string {
  if (!st.finished || !cfg.endText) return '';
  const winner = teamNames(cfg)[st.winnerTeam] ?? '';
  return cfg.endText.replace('{winner}', winner).trim();
}
