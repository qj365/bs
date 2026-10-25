import { buildMaster, playNote } from '../audio/synth';
import { Rng } from '../rng';
import type { Course, Hit } from './choreo';
import { instrumentFor, type MarbleConfig } from './config';

let noise: AudioBuffer | null = null;

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  if (!noise || noise.sampleRate !== ctx.sampleRate) {
    noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = noise.getChannelData(0);
    const rng = new Rng(4242);
    for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
  }
  return noise;
}

/** One struck object: its own sound, or the low/high instrument for bars. */
export function playHit(ctx: BaseAudioContext, out: AudioNode, cfg: MarbleConfig, hit: Hit, when: number): void {
  const pan = ctx.createStereoPanner();
  pan.pan.value = hit.pan * 0.6;
  pan.connect(out);
  const inst = instrumentFor(cfg, hit.notes, hit.row, hit.kind === 'wood');
  const vel = 0.85 / Math.sqrt(hit.notes.length);
  for (const n of hit.notes) playNote(ctx, pan, inst, n, when, vel);
}

/** Soft rolling rumble while the ball runs along a ramp or rail. */
export function playRoll(ctx: BaseAudioContext, out: AudioNode, when: number, dur: number, offset = 0): void {
  if (dur - offset <= 0.05) return;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.value = 900;
  bp.Q.value = 0.8;
  const g = ctx.createGain();
  const start = when;
  const end = when + dur - offset;
  g.gain.setValueAtTime(0, start);
  g.gain.linearRampToValueAtTime(0.05, start + 0.06);
  g.gain.setValueAtTime(0.05, Math.max(start + 0.06, end - 0.1));
  g.gain.linearRampToValueAtTime(0, end);
  src.connect(bp).connect(g).connect(out);
  src.start(start);
  src.stop(end + 0.05);
}

/** Time ranges (course time) where the ball rolls. */
export function rollSpans(course: Course): [number, number][] {
  return course.segments.filter((s) => s.type !== 'fly').map((s) => [s.t0, s.t1]);
}

/**
 * Renders the soundtrack offline for export. Video time 0 corresponds to
 * course time `course.start + start`.
 */
export async function renderMarbleAudio(cfg: MarbleConfig, course: Course, start: number, duration: number, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const master = buildMaster(ctx, cfg);
  const t0 = course.start + start;
  for (const h of course.hits) {
    const v = h.t - t0;
    if (v >= 0 && v < duration) playHit(ctx, master, cfg, h, v);
  }
  if (cfg.rollSound) {
    for (const [a, b] of rollSpans(course)) {
      if (b - t0 > 0 && a - t0 < duration) playRoll(ctx, master, Math.max(0, a - t0), b - a, Math.max(0, t0 - a));
    }
  }
  return ctx.startRendering();
}

/** Real-time playback for the preview, scheduled a little ahead of the picture. */
export class MarbleLiveAudio {
  readonly ctx = new AudioContext({ latencyHint: 'interactive' });
  private master: AudioNode | null = null;
  private next = 0;
  private nextRoll = 0;
  private cfg: MarbleConfig | null = null;

  reset(cfg: MarbleConfig): void {
    this.cfg = cfg;
    this.master?.disconnect();
    this.master = buildMaster(this.ctx, cfg);
  }

  /** Jump to course time t without playing what came before. */
  seek(course: Course, t: number): void {
    this.next = course.hits.findIndex((h) => h.t >= t);
    if (this.next < 0) this.next = course.hits.length;
    const spans = rollSpans(course);
    this.nextRoll = spans.findIndex(([a]) => a >= t);
    if (this.nextRoll < 0) this.nextRoll = spans.length;
  }

  /** Schedules everything up to `t + ahead` (course time). */
  play(course: Course, t: number, ahead = 0.12): void {
    const cfg = this.cfg;
    if (!cfg || !this.master || this.ctx.state !== 'running' || !cfg.sound) return;
    const base = this.ctx.currentTime + 0.03;
    const hits = course.hits;
    while (this.next < hits.length && hits[this.next].t <= t + ahead) {
      const h = hits[this.next++];
      playHit(this.ctx, this.master, cfg, h, Math.max(this.ctx.currentTime, base + (h.t - t)));
    }
    if (cfg.rollSound) {
      const spans = rollSpans(course);
      while (this.nextRoll < spans.length && spans[this.nextRoll][0] <= t + ahead) {
        const [a, b] = spans[this.nextRoll++];
        playRoll(this.ctx, this.master, Math.max(this.ctx.currentTime, base + (a - t)), b - a);
      }
    }
  }
}
