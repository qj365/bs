/**
 * Time warping: a monotonic map from video time to simulation time, given as
 * anchor pairs [v0, s0, v1, s1, …]. Between anchors time runs linearly; after
 * the last one it runs at normal speed. Used to land bounces on music beats.
 */
export type Warp = number[];

export function warpTime(w: Warp | null | undefined, v: number): number {
  if (!w || w.length < 4) return v;
  const n = w.length / 2;
  if (v <= w[0]) return w[1] + (v - w[0]);
  for (let i = 0; i < n - 1; i++) {
    const v0 = w[i * 2], s0 = w[i * 2 + 1], v1 = w[i * 2 + 2], s1 = w[i * 2 + 3];
    if (v <= v1) return s0 + ((v - v0) * (s1 - s0)) / Math.max(v1 - v0, 1e-9);
  }
  return w[n * 2 - 1] + (v - w[n * 2 - 2]);
}

export function unwarpTime(w: Warp | null | undefined, s: number): number {
  if (!w || w.length < 4) return s;
  const n = w.length / 2;
  if (s <= w[1]) return w[0] + (s - w[1]);
  for (let i = 0; i < n - 1; i++) {
    const v0 = w[i * 2], s0 = w[i * 2 + 1], v1 = w[i * 2 + 2], s1 = w[i * 2 + 3];
    if (s <= s1) return v0 + ((s - s0) * (v1 - v0)) / Math.max(s1 - s0, 1e-9);
  }
  return w[n * 2 - 2] + (s - w[n * 2 - 1]);
}

export interface BeatWarp {
  warp: Warp;
  /** How many beats got a bounce on them. */
  matched: number;
  /** Beats considered (after the stride). */
  considered: number;
  stride: number;
  /** Mean |log2(speed)| — 0 means the video never changes speed. */
  wobble: number;
}

const MIN_SPEED = 0.55;
const MAX_SPEED = 1.8;

function warpForStride(bounces: number[], beats: number[], stride: number, until: number): BeatWarp {
  const warp: Warp = [0, 0];
  let v0 = 0, s0 = 0, bi = 0, matched = 0, considered = 0, wobble = 0;
  for (let k = 0; k < beats.length; k += stride) {
    const v1 = beats[k];
    if (v1 <= v0 + 0.05 || v1 > until) continue;
    considered++;
    const dv = v1 - v0;
    while (bi < bounces.length && bounces[bi] <= s0 + dv * MIN_SPEED) bi++;
    // Pick the bounce that needs the least speed change.
    let best = -1, bestErr = Infinity;
    for (let j = bi; j < bounces.length && bounces[j] < s0 + dv * MAX_SPEED; j++) {
      const err = Math.abs(Math.log2((bounces[j] - s0) / dv));
      if (err < bestErr) {
        bestErr = err;
        best = j;
      }
    }
    if (best < 0) continue;
    warp.push(v1, bounces[best]);
    wobble += bestErr;
    matched++;
    v0 = v1;
    s0 = bounces[best];
    bi = best + 1;
  }
  return { warp, matched, considered, stride, wobble: matched ? wobble / matched : 0 };
}

/**
 * Builds a warp so that bounces happen exactly on beats. `stride` 0 tries every
 * beat, every 2nd and every 4th, and keeps whichever matches the most beats with
 * the least speed wobble.
 */
export function buildBeatWarp(bounces: number[], beats: number[], stride: number, until: number): BeatWarp {
  const strides = stride > 0 ? [stride] : [1, 2, 4];
  let best: BeatWarp | null = null;
  let bestScore = -Infinity;
  for (const st of strides) {
    const w = warpForStride(bounces, beats, st, until);
    const coverage = w.considered ? w.matched / w.considered : 0;
    const score = coverage - 0.6 * w.wobble + 0.02 * w.matched / Math.max(1, st);
    if (score > bestScore) {
      bestScore = score;
      best = w;
    }
  }
  return best!;
}
