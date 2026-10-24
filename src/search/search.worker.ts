import type { Config } from '../config';
import { Simulation } from '../sim';
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
  run(msg).catch((err) => ctx.postMessage({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};

/**
 * Runs the simulation headless (no drawing) for many seeds and ranks them by how
 * close they end to the target: a duration in seconds, or a number of notes so the
 * melody finishes exactly when the video does.
 */
async function run(msg: Extract<SearchIn, { type: 'start' }>): Promise<void> {
  const { cfg, target, seedFrom, count } = msg;
  const maxT = target.kind === 'duration' ? target.value + Math.max(10, target.value * 0.5) : Math.min(cfg.duration * 3, 600);
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
    let t = 0;
    let finished = false;
    while (t < maxT) {
      t += 0.25;
      sim.advanceTo(t);
      notes.add(sim.drainEvents());
      const st = sim.stats();
      if (st.finished) {
        finished = true;
        break;
      }
    }
    if (finished) {
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
