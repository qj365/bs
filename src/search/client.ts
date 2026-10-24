import { cloneConfig, type Config } from '../config';
import type { SearchIn, SearchOut, SearchResult, SearchTarget } from './protocol';

export interface SearchJob {
  promise: Promise<SearchResult[]>;
  /** Stops early; the promise then resolves with the best results so far. */
  stop(): void;
}

export interface SearchProgress {
  done: number;
  total: number;
  rate: number;
  results: SearchResult[];
}

/** Runs a seed search in a worker (seeds seedFrom … seedFrom+count-1). */
export function startSearch(
  cfg: Config, target: SearchTarget, seedFrom: number, count: number, onProgress?: (p: SearchProgress) => void,
): SearchJob {
  const worker = new Worker(new URL('./search.worker.ts', import.meta.url), { type: 'module' });
  const promise = new Promise<SearchResult[]>((resolve, reject) => {
    worker.onmessage = (ev: MessageEvent<SearchOut>) => {
      const m = ev.data;
      if (m.type === 'progress') {
        onProgress?.(m);
      } else if (m.type === 'done') {
        worker.terminate();
        resolve(m.results);
      } else {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker lỗi'));
    };
  });
  const start: SearchIn = { type: 'start', cfg: cloneConfig(cfg), target, seedFrom, count };
  worker.postMessage(start);
  return { promise, stop: () => worker.postMessage({ type: 'stop' } satisfies SearchIn) };
}

/**
 * Finds a seed whose run ends between minS and maxS seconds (closest to the middle).
 * Returns null when none of the tried seeds lands in the window.
 */
export async function findSeedInWindow(cfg: Config, minS: number, maxS: number, tries: number): Promise<SearchResult | null> {
  const target = (minS + maxS) / 2;
  const results = await startSearch(cfg, { kind: 'duration', value: target }, cfg.seed, tries).promise;
  return results.find((r) => r.finishTime >= minS && r.finishTime <= maxS) ?? null;
}
