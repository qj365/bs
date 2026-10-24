import { readFileSync } from 'node:fs';
import { cloneConfig, DEFAULT_CONFIG, MODE_DEFAULTS, VARIANTS, type Config, type Mode } from '../../src/config';
import { Simulation, type SimEvent, type Stats } from '../../src/sim';

let module: WebAssembly.Module | null = null;

export async function wasm(): Promise<WebAssembly.Module> {
  module ??= await WebAssembly.compile(readFileSync(new URL('../../src/wasm/ball_sim.wasm', import.meta.url)));
  return module;
}

export function modeConfig(mode: Mode, overrides: Partial<Config> = {}): Config {
  const cfg = cloneConfig(DEFAULT_CONFIG);
  cfg.mode = mode;
  Object.assign(cfg, MODE_DEFAULTS[mode], overrides);
  return cfg;
}

export function variantConfig(id: string, overrides: Partial<Config> = {}): Config {
  const v = VARIANTS.find((x) => x.id === id);
  if (!v) throw new Error('unknown variant ' + id);
  return modeConfig(v.mode, { ...v.overrides, ...overrides });
}

export interface RunResult {
  sim: Simulation;
  stats: Stats;
  events: SimEvent[];
}

/** Steps the simulation at 60 fps like the exporter does, building render data every frame. */
export async function run(cfg: Config, seconds: number, opts: { stopOnFinish?: boolean; sim?: Simulation } = {}): Promise<RunResult> {
  const sim = opts.sim ?? (await Simulation.fromModule(await wasm(), cfg));
  if (opts.sim) sim.reset(cfg);
  const events: SimEvent[] = [];
  for (let f = 1; f <= seconds * 60; f++) {
    sim.advanceTo(f / 60);
    events.push(...sim.drainEvents());
    const data = sim.renderData(cfg.trailLength);
    for (let i = 0; i < data.balls.length; i++) {
      if (!Number.isFinite(data.balls[i])) throw new Error(`NaN in ball buffer at t=${f / 60}`);
    }
    if (opts.stopOnFinish && sim.stats().finished) break;
  }
  return { sim, stats: sim.stats(), events };
}
