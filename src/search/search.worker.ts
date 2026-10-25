import type { Config } from '../config';
import { Simulation, type SimEvent } from '../sim';
import { dramaScore } from '../viral/drama';
import { findLoop, sampleRun } from '../viral/loop';
import { countNotes, type SearchIn, type SearchOut, type SearchResult } from './protocol';

interface WorkerScope {
  postMessage(msg: SearchOut): void;
  onmessage: ((ev: MessageEvent<SearchIn>) => void) | null;
}
const ctx = self as unknown as WorkerScope;
let stopped = false;

ctx.onmessage = (ev) => {
  const msg = ev.data;
  if (msg.type === 'stop') {
    stopped = true;
    return;
  }
  stopped = false;
  if (msg.type === 'loop') {
    loop(msg).catch((err) => ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
    return;
  }
  run(msg).catch((err) => ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};

/**
 * Runs the simulation headless (no drawing) for many seeds and ranks them by how
 * close they end to the target: a duration in seconds, or a number of notes so the
 * melody finishes exactly when the video does.
 */
async function run(msg: Extract<SearchIn, { type: 'start' }>): Promise<void> {
  const { cfg, target, seedFrom, count } = msg;
  const drama = target.kind === 'drama';
  const maxT = drama
    ? (target.max ?? cfg.duration) + 0.5
    : target.kind === 'duration' ? target.value + Math.max(10, target.value * 0.5) : Math.min(cfg.duration * 3, 600);
  let sim: Simulation | null = null;
  const results: SearchResult[] = [];
  const t0 = performance.now();
  for (let i = 0; i < count; i++) {
    if (stopped) break;
    const seed = seedFrom + i;
    const c: Config = { ...cfg, seed };
    if (sim) sim.reset(c);
    else sim = await Simulation.create(c);
    const notes = countNotes(c);
    const all: SimEvent[] = [];
    let t = 0;
    let finished = false;
    while (t < maxT) {
      t += 0.25;
      sim.advanceTo(t);
      const ev = sim.drainEvents();
      notes.add(ev);
      if (drama) for (const e of ev) all.push(e);
      const st = sim.stats();
      if (st.finished) {
        finished = true;
        break;
      }
    }
    if (drama) {
      const st = sim.stats();
      const inWindow = finished ? st.finishTime >= (target.min ?? 0) : !finishes(c);
      if (inWindow) {
        const d = dramaScore(c, all, finished ? st.finishTime : -1, target.value);
        results.push({ seed, finishTime: finished ? st.finishTime : maxT, notes: notes.count, error: -d.score, score: d.score, why: d.why });
        results.sort((a, b) => a.error - b.error);
        results.length = Math.min(results.length, 10);
      }
    } else if (finished) {
      const st = sim.stats();
      const value = target.kind === 'duration' ? st.finishTime : notes.count;
      results.push({ seed, finishTime: st.finishTime, notes: notes.count, error: Math.abs(value - target.value) });
      results.sort((a, b) => a.error - b.error);
      results.length = Math.min(results.length, 10);
    }
    if (i % 10 === 9 || i === count - 1) {
      // Yield so a "stop" message can get through.
      await new Promise((r) => setTimeout(r, 0));
      ctx.postMessage({ type: 'progress', done: i + 1, total: count, results, rate: (i + 1) / ((performance.now() - t0) / 1000) });
    }
  }
  ctx.postMessage({ type: 'done', results });
}

/** Modes that never end on their own are judged over the whole window. */
function finishes(cfg: Config): boolean {
  return !(cfg.mode === 'symmetric' || cfg.mode === 'merge' || (cfg.mode === 'trail' && cfg.growAmount <= 0));
}

async function loop(msg: Extract<SearchIn, { type: 'loop' }>): Promise<void> {
  const { samples, sim } = await sampleRun(msg.cfg, msg.seconds);
  const result = findLoop(msg.cfg, samples, msg.minLen, msg.maxLen, sim.cfg.ringRadius);
  ctx.postMessage({ type: 'loop', result });
}
