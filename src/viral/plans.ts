import { cloneConfig, type Config } from '../config';
import type { ExportPlan } from '../export/protocol';
import { HOOKS, PALETTES, type HookLang } from '../random';
import { battleCells } from '../scene';
import { Simulation } from '../sim';
import { unwarpTime, warpTime, type Warp } from '../sync';

/** When (video seconds) the run finishes — the first arena in a battle — or -1. */
export async function probeFinish(cfg: Config, warp: Warp | null, module?: WebAssembly.Module): Promise<number> {
  const cells = battleCells(cfg).cells;
  const sims = await Promise.all(cells.map((c) => (module ? Simulation.fromModule(module, c.cfg) : Simulation.create(c.cfg))));
  for (let v = 0.25; v <= cfg.duration; v += 0.25) {
    const s = warpTime(warp, v);
    let best = Infinity;
    for (const sim of sims) {
      sim.advanceTo(s);
      sim.drainEvents();
      const st = sim.stats();
      if (st.finished) best = Math.min(best, st.finishTime);
    }
    if (best < Infinity) return unwarpTime(warp, best);
  }
  return -1;
}

export interface PartPlans {
  part1: ExportPlan;
  part2: ExportPlan;
  cut: number;
}

/**
 * Splits a video into a cliff-hanger and its ending: Part 1 stops just before the
 * decisive moment with a "watch part 2" caption, Part 2 starts with a short recap.
 */
export function partPlans(finish: number, duration: number, endHold: number, lang: HookLang, warp: Warp | null): PartPlans {
  const end = finish > 0 ? Math.min(duration, finish + endHold) : duration;
  const cut = finish > 0 ? Math.max(2, finish - 1.2) : Math.max(2, duration * 0.6);
  const recap = Math.max(0, cut - 2);
  const w = warp ?? undefined;
  return {
    cut,
    part1: { end: cut, warp: w, overlay: { text: lang === 'en' ? 'Watch part 2 👀' : 'Xem phần 2 👀', from: Math.max(0, cut - 2.2) } },
    part2: { start: recap, end, warp: w, overlay: { text: lang === 'en' ? 'Part 2' : 'Phần 2', from: 0, to: 2 } },
  };
}

export type ABKind = 'hook' | 'palette' | 'both';

/** Same run, different hooks and/or colours — for A/B testing what performs best. */
export function abVariants(cfg: Config, kind: ABKind, count: number, lang: HookLang): { label: string; cfg: Config }[] {
  const hooks = [cfg.title, ...HOOKS[cfg.mode][lang].filter((h) => h !== cfg.title)];
  const palettes = PALETTES.filter((p) => p.bg !== cfg.bgColor);
  const out: { label: string; cfg: Config }[] = [];
  for (let k = 0; k < Math.max(2, Math.min(3, count)); k++) {
    const c = cloneConfig(cfg);
    if (k > 0 && (kind === 'hook' || kind === 'both')) c.title = hooks[k % hooks.length];
    if (k > 0 && (kind === 'palette' || kind === 'both')) {
      const p = palettes[(k * 3) % palettes.length];
      Object.assign(c, { bgColor: p.bg, ringColor: p.ring, ballColor: p.ball, ringRainbow: p.ringRainbow, textColor: p.text });
    }
    out.push({ label: String.fromCharCode(65 + k), cfg: c });
  }
  return out;
}

/** Cover image moment: just before the ending, or 60% in. */
export function coverTime(finish: number, duration: number): number {
  return finish > 0 ? Math.max(0, finish - 0.3) : duration * 0.6;
}
