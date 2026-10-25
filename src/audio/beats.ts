/**
 * Beat detection for beat-synced videos: spectral-flux onset envelope →
 * tempo from autocorrelation → beat phase → each beat snapped to the
 * strongest nearby onset. Pure functions on raw samples, so it also runs in tests.
 */

const TARGET_RATE = 11025;
const FRAME = 1024;
const HOP = 256;

export interface BeatInfo {
  beats: number[];
  bpm: number;
  /** Onset envelope (one value per hop) — exposed for tests and debugging. */
  envelope: Float32Array;
  hopSeconds: number;
}

function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
}

/** Mixes channels to mono and resamples to ~11 kHz by averaging. */
export function toMono(channels: Float32Array[], sampleRate: number): { data: Float32Array; rate: number } {
  const step = Math.max(1, Math.round(sampleRate / TARGET_RATE));
  const n = Math.floor(channels[0].length / step);
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (const ch of channels) for (let k = 0; k < step; k++) sum += ch[i * step + k];
    out[i] = sum / (step * channels.length);
  }
  return { data: out, rate: sampleRate / step };
}

export function onsetEnvelope(data: Float32Array): Float32Array {
  const frames = Math.max(0, Math.floor((data.length - FRAME) / HOP));
  const env = new Float32Array(frames);
  const re = new Float32Array(FRAME), im = new Float32Array(FRAME);
  let prev = new Float32Array(FRAME / 2);
  const win = new Float32Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (FRAME - 1)));
  for (let f = 0; f < frames; f++) {
    for (let i = 0; i < FRAME; i++) {
      re[i] = data[f * HOP + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    const mag = new Float32Array(FRAME / 2);
    let flux = 0;
    for (let k = 1; k < FRAME / 2; k++) {
      mag[k] = Math.log1p(Math.hypot(re[k], im[k]) * 10);
      const d = mag[k] - prev[k];
      if (d > 0) flux += d;
    }
    env[f] = flux;
    prev = mag;
  }
  // Remove the slowly varying loudness so only sharp onsets remain.
  const out = new Float32Array(frames);
  const w = 16;
  for (let f = 0; f < frames; f++) {
    let s = 0, c = 0;
    for (let k = Math.max(0, f - w); k < Math.min(frames, f + w); k++) {
      s += env[k];
      c++;
    }
    out[f] = Math.max(0, env[f] - s / c);
  }
  return out;
}

export function detectBeats(channels: Float32Array[], sampleRate: number): BeatInfo {
  const { data, rate } = toMono(channels, sampleRate);
  const env = onsetEnvelope(data);
  const hop = HOP / rate;
  if (env.length < 32) return { beats: [], bpm: 0, envelope: env, hopSeconds: hop };

  // Tempo: autocorrelation over 70–180 BPM, gently preferring ~120 BPM.
  let bestLag = 0, best = -Infinity;
  const minLag = Math.floor(60 / 180 / hop), maxLag = Math.ceil(60 / 70 / hop);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    const bpm = 60 / (lag * hop);
    const weight = Math.exp(-0.5 * Math.pow(Math.log2(bpm / 120) / 0.9, 2));
    const score = (s / (env.length - lag)) * weight;
    if (score > best) {
      best = score;
      bestLag = lag;
    }
  }
  // Refine the period to sub-hop precision with a parabola through the peak.
  const ac = (lag: number) => {
    let s = 0;
    for (let i = lag; i < env.length; i++) s += env[i] * env[i - lag];
    return s / (env.length - lag);
  };
  const y0 = ac(bestLag - 1), y1 = ac(bestLag), y2 = ac(bestLag + 1);
  const denom = y0 - 2 * y1 + y2;
  const period = bestLag + (denom !== 0 ? (0.5 * (y0 - y2)) / denom : 0);

  // Phase: the offset whose beat grid collects the most onset energy.
  let bestPhase = 0, bestSum = -Infinity;
  for (let ph = 0; ph < period; ph += 0.5) {
    let s = 0;
    for (let t = ph; t < env.length; t += period) s += env[Math.round(t)] ?? 0;
    if (s > bestSum) {
      bestSum = s;
      bestPhase = ph;
    }
  }

  // Snap each grid beat to the strongest onset within ±12% of a period.
  const beats: number[] = [];
  const radius = Math.max(1, Math.round(period * 0.12));
  for (let t = bestPhase; t < env.length; t += period) {
    const c = Math.round(t);
    let bi = c, bv = -1;
    for (let k = Math.max(0, c - radius); k <= Math.min(env.length - 1, c + radius); k++) {
      if (env[k] > bv) {
        bv = env[k];
        bi = k;
      }
    }
    // Sub-hop precision: parabola through the peak and its neighbours.
    const a = env[bi - 1] ?? env[bi], b = env[bi], c2 = env[bi + 1] ?? env[bi];
    const den = a - 2 * b + c2;
    const frac = den !== 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c2)) / den)) : 0;
    // Onsets are measured at the start of the analysis frame; centre them.
    beats.push((bi + frac + FRAME / HOP / 2) * hop);
  }
  return { beats, bpm: 60 / (period * hop), envelope: env, hopSeconds: hop };
}
