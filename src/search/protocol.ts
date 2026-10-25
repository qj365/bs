import type { Config } from '../config';
import type { SimEvent } from '../sim';

export interface SearchTarget {
  /**
   * "duration": end after `value` seconds; "notes": after `value` notes;
   * "drama": the most gripping run that ends between `min` and `max` seconds.
   */
  kind: 'duration' | 'notes' | 'drama';
  value: number;
  min?: number;
  max?: number;
}

export interface SearchResult {
  seed: number;
  finishTime: number;
  notes: number;
  error: number;
  /** Drama score and its reasons (drama searches only). */
  score?: number;
  why?: string[];
}

export type SearchIn =
  | { type: 'start'; cfg: Config; target: SearchTarget; seedFrom: number; count: number }
  | { type: 'loop'; cfg: Config; minLen: number; maxLen: number; seconds: number }
  | { type: 'stop' };

export type SearchOut =
  | { type: 'progress'; done: number; total: number; results: SearchResult[]; rate: number }
  | { type: 'done'; results: SearchResult[] }
  | { type: 'loop'; result: { start: number; end: number; error: number } | null }
  | { type: 'error'; message: string };

/** Counts notes exactly like SoundPlayer does (same event kinds and minimum gap). */
export function countNotes(cfg: Config): { count: number; add(events: SimEvent[]): void } {
  let last = -Infinity;
  return {
    count: 0,
    add(events) {
      for (const e of events) {
        const musical = e.kind === 'bounce' || e.kind === 'merge' || e.kind === 'break' || e.kind === 'gem'
          || (e.kind === 'hit' && cfg.ballHitSound);
        if (musical && e.t - last >= cfg.minNoteGap) {
          last = e.t;
          this.count++;
        }
      }
    },
  };
}
