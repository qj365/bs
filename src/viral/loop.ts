import { cloneConfig, type Config } from '../config';
import { BALL_STRIDE, RING_STRIDE, Simulation } from '../sim';

const RATE = 30;

export interface LoopResult {
  start: number;
  end: number;
  /** Average mismatch between the first and last frame, in pixels (lower is better). */
  error: number;
}

interface Sample {
  t: number;
  balls: Float32Array; // x y vx vy per ball
  rings: Float32Array; // rotation per ring
}

/** Records the state of a run at 30 Hz (positions, velocities, ring angles). */
export async function sampleRun(cfg: Config, seconds: number, module?: WebAssembly.Module): Promise<{ samples: Sample[]; sim: Simulation }> {
  const c = cloneConfig(cfg);
  const sim = module ? await Simulation.fromModule(module, c) : await Simulation.create(c);
  const samples: Sample[] = [];
  for (let f = 0; f <= seconds * RATE; f++) {
    const t = f / RATE;
    sim.advanceTo(t);
    sim.drainEvents();
    const d = sim.renderData(0);
    const balls = new Float32Array(d.ballCount * 4);
    for (let i = 0; i < d.ballCount; i++) {
      const o = i * BALL_STRIDE;
      balls[i * 4] = d.balls[o];
      balls[i * 4 + 1] = d.balls[o + 1];
      balls[i * 4 + 2] = (d.balls[o] - d.balls[o + 4]) * RATE; // velocity from the previous sample
      balls[i * 4 + 3] = (d.balls[o + 1] - d.balls[o + 5]) * RATE;
    }
    const rings = new Float32Array(d.ringCount);
    for (let i = 0; i < d.ringCount; i++) rings[i] = d.rings[i * RING_STRIDE + 4];
    samples.push({ t, balls, rings });
  }
  return { samples, sim };
}

/**
 * Finds the segment [start, end] whose last frame looks most like its first, so
 * the clip can repeat seamlessly. Compares ball positions and velocities, ring
 * angles (with the ring's symmetry when it has no gap) and the rainbow colour phase.
 */
export function findLoop(cfg: Config, samples: Sample[], minLen: number, maxLen: number, ringRadius: number): LoopResult | null {
  let best: LoopResult | null = null;
  const symmetricRing = cfg.gapAngle === 0 && cfg.spikeArc === 0 && cfg.ringHp === 0;
  const huePeriod = 9; // rainbow cycles 40°/s → 9 s
  const searchStart = Math.max(1, Math.round(0.5 * RATE)); // skip the very first moments
  for (let i = searchStart; i < samples.length; i++) {
    const a = samples[i];
    if (a.t > samples[samples.length - 1].t - minLen) break;
    for (let j = i + Math.round(minLen * RATE); j < samples.length && samples[j].t - a.t <= maxLen; j++) {
      const b = samples[j];
      if (a.balls.length !== b.balls.length || a.balls.length === 0) continue;
      let err = 0;
      const n = a.balls.length / 4;
      for (let k = 0; k < a.balls.length; k += 4) {
        err += Math.hypot(a.balls[k] - b.balls[k], a.balls[k + 1] - b.balls[k + 1]);
        err += 0.08 * Math.hypot(a.balls[k + 2] - b.balls[k + 2], a.balls[k + 3] - b.balls[k + 3]);
      }
      err /= n;
      if (!symmetricRing) {
        for (let r = 0; r < a.rings.length; r++) {
          const d = Math.atan2(Math.sin(a.rings[r] - b.rings[r]), Math.cos(a.rings[r] - b.rings[r]));
          err += Math.abs(d) * ringRadius;
        }
      }
      if (cfg.ringRainbow) {
        const phase = ((b.t - a.t) % huePeriod) / huePeriod;
        err += Math.min(phase, 1 - phase) * 200;
      }
      if (!best || err < best.error) best = { start: a.t, end: b.t, error: err };
    }
  }
  return best ? { ...best, error: Math.round(best.error * 10) / 10 } : null;
}
