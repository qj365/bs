import type { Config, Instrument } from '../config';
import { Rng } from '../rng';
import type { SimEvent } from '../sim';
import { MELODIES, SCALES } from './melodies';

const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const noiseCache = new WeakMap<BaseAudioContext, AudioBuffer>();

function noiseBuffer(ctx: BaseAudioContext): AudioBuffer {
  let buf = noiseCache.get(ctx);
  if (!buf) {
    buf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = buf.getChannelData(0);
    const rng = new Rng(12345);
    for (let i = 0; i < d.length; i++) d[i] = rng.next() * 2 - 1;
    noiseCache.set(ctx, buf);
  }
  return buf;
}

/** Shapes a node's gain: fast attack, exponential decay. */
function envelope(ctx: BaseAudioContext, when: number, peak: number, decay: number): GainNode {
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, when);
  g.gain.linearRampToValueAtTime(peak, when + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, when + decay);
  return g;
}

function osc(ctx: BaseAudioContext, type: OscillatorType, freq: number, when: number, dur: number, dest: AudioNode): OscillatorNode {
  const o = ctx.createOscillator();
  o.type = type;
  o.frequency.setValueAtTime(freq, when);
  o.connect(dest);
  o.start(when);
  o.stop(when + dur + 0.05);
  return o;
}

/** Plays one note on the chosen instrument. Everything is synthesized, so there are no sample files. */
export function playNote(ctx: BaseAudioContext, out: AudioNode, inst: Instrument, midi: number, when: number, vel: number): void {
  const f = mtof(midi);
  const v = Math.max(0.05, Math.min(1, vel));
  switch (inst) {
    case 'marimba': {
      const g = envelope(ctx, when, 0.5 * v, 0.55);
      g.connect(out);
      osc(ctx, 'sine', f, when, 0.55, g);
      const g2 = envelope(ctx, when, 0.12 * v, 0.12);
      g2.connect(out);
      osc(ctx, 'sine', f * 4, when, 0.12, g2);
      break;
    }
    case 'piano': {
      const g = envelope(ctx, when, 0.32 * v, 1.4);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(Math.min(f * 8, 12000), when);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.5, 200), when + 1.2);
      g.connect(lp).connect(out);
      osc(ctx, 'triangle', f, when, 1.4, g);
      osc(ctx, 'sine', f * 2, when, 1.4, g).detune.setValueAtTime(4, when);
      break;
    }
    case 'bell': {
      // Two-operator FM gives a glassy bell.
      const g = envelope(ctx, when, 0.3 * v, 2.2);
      g.connect(out);
      const carrier = osc(ctx, 'sine', f, when, 2.2, g);
      const modGain = ctx.createGain();
      modGain.gain.setValueAtTime(f * 2.5, when);
      modGain.gain.exponentialRampToValueAtTime(1, when + 1.8);
      modGain.connect(carrier.frequency);
      osc(ctx, 'sine', f * 3.5, when, 2.2, modGain);
      break;
    }
    case 'pluck': {
      const g = envelope(ctx, when, 0.28 * v, 0.7);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 4;
      lp.frequency.setValueAtTime(Math.min(f * 10, 14000), when);
      lp.frequency.exponentialRampToValueAtTime(Math.max(f, 150), when + 0.35);
      g.connect(lp).connect(out);
      osc(ctx, 'sawtooth', f, when, 0.7, g);
      break;
    }
    case 'pop': {
      const g = envelope(ctx, when, 0.6 * v, 0.14);
      g.connect(out);
      const o = osc(ctx, 'sine', f * 2, when, 0.14, g);
      o.frequency.exponentialRampToValueAtTime(f, when + 0.05);
      break;
    }
    case 'chip': {
      const g = envelope(ctx, when, 0.14 * v, 0.22);
      g.connect(out);
      osc(ctx, 'square', f, when, 0.22, g);
      break;
    }
  }
}

function playBreak(ctx: BaseAudioContext, out: AudioNode, when: number): void {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const bp = ctx.createBiquadFilter();
  bp.type = 'bandpass';
  bp.frequency.setValueAtTime(2400, when);
  bp.frequency.exponentialRampToValueAtTime(300, when + 0.35);
  bp.Q.value = 0.8;
  const g = envelope(ctx, when, 0.5, 0.4);
  src.connect(bp).connect(g).connect(out);
  src.start(when);
  src.stop(when + 0.45);
}

function playWhoosh(ctx: BaseAudioContext, out: AudioNode, when: number): void {
  const g = envelope(ctx, when, 0.18, 0.3);
  g.connect(out);
  const o = osc(ctx, 'triangle', 300, when, 0.3, g);
  o.frequency.exponentialRampToValueAtTime(1400, when + 0.25);
}

/** Decides which notes each event plays. Deterministic, so preview and export sound the same. */
class NotePicker {
  private step = 0;
  private dir = 1;
  private rng: Rng;
  private melody: number[][];

  constructor(private cfg: Config) {
    this.rng = new Rng(cfg.seed + 101);
    this.melody = cfg.melodyName === 'custom' && cfg.melody.length > 0
      ? cfg.melody
      : (MELODIES[cfg.melodyName] ?? MELODIES.ode).notes;
  }

  private scaleNote(index: number): number {
    const scale = SCALES[this.cfg.scale] ?? SCALES.pentatonic;
    const octave = Math.floor(index / scale.length);
    const deg = ((index % scale.length) + scale.length) % scale.length;
    return this.cfg.baseNote + octave * 12 + scale[deg];
  }

  next(e: SimEvent): number[] {
    const t = this.cfg.transpose;
    const scaleLen = (SCALES[this.cfg.scale] ?? SCALES.pentatonic).length;
    switch (this.cfg.noteMode) {
      case 'melody': {
        const chord = this.melody[this.step % this.melody.length] ?? [60];
        this.step++;
        return chord.map((n) => n + t);
      }
      case 'scale': {
        // Walk up two octaves and back down.
        const span = scaleLen * 2;
        const note = this.scaleNote(this.step) + t;
        this.step += this.dir;
        if (this.step >= span || this.step <= 0) this.dir = -this.dir;
        return [note];
      }
      case 'random':
        return [this.scaleNote(Math.floor(this.rng.next() * scaleLen * 2)) + t];
      case 'size': {
        // Bigger balls and higher merge levels sound lower.
        const idx = e.kind === 'merge' ? scaleLen * 2 - e.level : Math.round(scaleLen * 2 * (1 - Math.min(e.r / 200, 1)));
        return [this.scaleNote(Math.max(0, idx)) + t];
      }
    }
  }
}

/** Builds master volume → compressor (+ optional reverb) and returns the input node. */
export function buildMaster(ctx: BaseAudioContext, cfg: Config): AudioNode {
  const input = ctx.createGain();
  input.gain.value = cfg.volume;
  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 10;
  comp.ratio.value = 4;
  comp.attack.value = 0.003;
  comp.release.value = 0.15;
  input.connect(comp);
  comp.connect(ctx.destination);
  if (cfg.reverb > 0) {
    const conv = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    const rng = new Rng(777);
    for (let c = 0; c < 2; c++) {
      const d = ir.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (rng.next() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    conv.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = cfg.reverb;
    input.connect(conv).connect(wet).connect(comp);
  }
  return input;
}

/** Turns simulation events into sound, with a minimum gap so thousands of balls stay pleasant. */
export class SoundPlayer {
  private picker: NotePicker;
  private lastNote = -Infinity;
  private lastSfx = -Infinity;

  constructor(private ctx: BaseAudioContext, private out: AudioNode, private cfg: Config) {
    this.picker = new NotePicker(cfg);
  }

  handle(e: SimEvent, when: number): void {
    const cfg = this.cfg;
    if (!cfg.sound) return;
    const vel = e.kind === 'bounce' || e.kind === 'hit' ? 0.45 + Math.min(e.strength / 2000, 0.55) : 0.85;
    const notes = () => {
      if (when - this.lastNote < cfg.minNoteGap) return;
      this.lastNote = when;
      for (const n of this.picker.next(e)) playNote(this.ctx, this.out, cfg.instrument, n, when, vel);
    };
    switch (e.kind) {
      case 'bounce':
      case 'merge':
        notes();
        break;
      case 'hit':
        if (cfg.ballHitSound) notes();
        break;
      case 'break':
        if (cfg.sfx && when - this.lastSfx > 0.05) {
          this.lastSfx = when;
          playBreak(this.ctx, this.out, when);
        }
        notes();
        break;
      case 'escape':
        if (cfg.sfx && when - this.lastSfx > 0.05) {
          this.lastSfx = when;
          playWhoosh(this.ctx, this.out, when);
        }
        break;
      case 'finish':
        if (cfg.sfx) {
          const base = cfg.baseNote + cfg.transpose + 12;
          [0, 4, 7, 12].forEach((iv, i) => playNote(this.ctx, this.out, cfg.instrument, base + iv, when + i * 0.09, 0.9));
        }
        break;
    }
  }
}

/** Renders the whole soundtrack offline (much faster than real time) for export. */
export async function renderSoundtrack(cfg: Config, events: SimEvent[], duration: number, sampleRate = 48000): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext(2, Math.max(1, Math.ceil(duration * sampleRate)), sampleRate);
  const player = new SoundPlayer(ctx, buildMaster(ctx, cfg), cfg);
  for (const e of events) if (e.t < duration) player.handle(e, e.t);
  return ctx.startRendering();
}

/** Real-time audio for the preview. */
export class LiveAudio {
  readonly ctx: AudioContext;
  private master: AudioNode | null = null;
  private player: SoundPlayer | null = null;

  constructor() {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
  }

  reset(cfg: Config): void {
    this.master?.disconnect();
    this.master = buildMaster(this.ctx, cfg);
    this.player = new SoundPlayer(this.ctx, this.master, cfg);
  }

  /** Schedules events that happened at sim time e.t, given the sim time now. */
  play(events: SimEvent[], simNow: number): void {
    if (!this.player || this.ctx.state !== 'running') return;
    const base = this.ctx.currentTime + 0.03;
    for (const e of events) this.player.handle(e, Math.max(this.ctx.currentTime, base + (e.t - simNow)));
  }
}
