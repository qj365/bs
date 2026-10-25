import type { Config } from '../config';
import type { SimEvent } from '../sim';

export interface DramaScore {
  score: number;
  /** Short human-readable reasons, e.g. "4 lần suýt thoát". */
  why: string[];
}

/**
 * Rates how gripping a run is, from its events alone:
 * - near misses (the ball *almost* got out), especially late in the video,
 * - a finish that comes right after a near miss ("last-second" escapes),
 * - escalation: things happen faster towards the end,
 * - for King of the Hill, a long final duel,
 * - for timeline events, twists that land before the ending.
 * Pure function so it can run in the search worker and in tests.
 */
export function dramaScore(cfg: Config, events: SimEvent[], finishTime: number, target: number): DramaScore {
  const end = finishTime > 0 ? finishTime : Math.max(1, events.length ? events[events.length - 1].t : target);
  const why: string[] = [];
  let score = 0;

  const near = events.filter((e) => e.kind === 'nearmiss');
  const late = near.filter((e) => e.t > end * 0.65);
  score += Math.min(near.length, 10) * 1 + Math.min(late.length, 6) * 2;
  if (near.length) why.push(`${near.length} lần suýt thoát${late.length ? ` (${late.length} lần ở cuối)` : ''}`);

  if (finishTime > 0 && near.length) {
    const gap = finishTime - near[near.length - 1].t;
    if (gap >= 0 && gap < 2) {
      score += 3;
      why.push('thoát ngay sau một lần suýt');
    } else if (gap >= 0 && gap < 4) {
      score += 1.5;
    }
  }

  const musical = events.filter((e) => e.kind === 'bounce' || e.kind === 'hit' || e.kind === 'break' || e.kind === 'merge');
  const third = end / 3;
  const early = musical.filter((e) => e.t < third).length;
  const final = musical.filter((e) => e.t >= end - third).length;
  if (early > 0) {
    const ratio = final / early;
    if (ratio > 1.15) {
      score += Math.min(2, ratio - 1) * 2;
      why.push(`nhịp nhanh dần ×${ratio.toFixed(1)}`);
    }
  }

  if (cfg.mode === 'koth' && finishTime > 0) {
    const outs = events.filter((e) => e.kind === 'escape').map((e) => e.t);
    if (outs.length >= 2) {
      const duel = finishTime - outs[outs.length - 2];
      score += Math.min(duel, 15) / 5;
      if (duel > 5) why.push(`trận chung kết kéo dài ${duel.toFixed(0)}s`);
    }
  }

  const twists = events.filter((e) => e.kind === 'chaos' && e.t < end - 1).length;
  if (twists) {
    score += Math.min(twists, 3) * 0.5;
    why.push(`${twists} biến cố`);
  }

  if (finishTime > 0) score -= 0.05 * Math.abs(finishTime - target);
  return { score: Math.round(score * 100) / 100, why };
}
