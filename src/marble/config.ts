import type { Backend, Instrument } from '../config';
import { MELODIES } from '../audio/melodies';
import { DEFAULT_COURSE, stepsToNotes, type MarbleNote } from './choreo';

/** Settings for the 3D marble music machine. */
export interface MarbleConfig {
  /** Built-in melody key, or 'midi' for the loaded MIDI file. */
  song: string;
  bpm: number;
  /** Repeat the melody this many times. */
  repeats: number;
  /** Semitones added to every note. */
  transpose: number;
  seed: number;

  gravity: number;
  width: number;
  descent: number;
  rollGap: number;
  restGap: number;
  splitPitch: number;

  bgColor: string;
  fog: number;
  /** Bars not played yet. */
  barColor: string;
  /** Bars after the ball has hit them. */
  playedColor: string;
  holderColor: string;
  ballColor: string;
  stripeColor: string;
  cameraDistance: number;
  /** Degrees around the shaft (0 = straight from the front). */
  cameraAngle: number;
  /** Degrees above the ball. */
  cameraElevation: number;
  light: number;
  shadows: boolean;
  flash: boolean;

  title: string;
  titleSize: number;
  subtitle: string;
  subtitleSize: number;
  textColor: string;

  sound: boolean;
  volume: number;
  reverb: number;
  lowInstrument: Instrument;
  highInstrument: Instrument;
  rollSound: boolean;

  resolution: string;
  fps: number;
  bitrate: number;
  encoder: Backend;
}

export const DEFAULT_MARBLE: MarbleConfig = {
  song: 'canon',
  bpm: 132,
  repeats: 1,
  transpose: 0,
  seed: 7,
  gravity: DEFAULT_COURSE.gravity,
  width: DEFAULT_COURSE.width,
  descent: DEFAULT_COURSE.descent,
  rollGap: DEFAULT_COURSE.rollGap,
  restGap: DEFAULT_COURSE.restGap,
  splitPitch: DEFAULT_COURSE.splitPitch,
  bgColor: '#3a4458',
  fog: 0.45,
  barColor: '#ffa515',
  playedColor: '#f4f4f2',
  holderColor: '#101216',
  ballColor: '#555a63',
  stripeColor: '#d8262c',
  cameraDistance: 3.4,
  cameraAngle: 25,
  cameraElevation: 12,
  light: 1,
  shadows: true,
  flash: true,
  title: 'Did you recognize the music? 🎶',
  titleSize: 30,
  subtitle: '',
  subtitleSize: 22,
  textColor: '#ffffff',
  sound: true,
  volume: 0.8,
  reverb: 0.25,
  lowInstrument: 'marimba',
  highInstrument: 'musicbox',
  rollSound: true,
  resolution: '1080x1920',
  fps: 60,
  bitrate: 12,
  encoder: 'auto',
};

/** Loaded MIDI notes (absolute times), set by the UI. */
export interface MidiSong {
  name: string;
  notes: MarbleNote[];
}

/** The notes the course is built from. */
export function songNotes(cfg: MarbleConfig, midi: MidiSong | null): MarbleNote[] {
  let base: MarbleNote[];
  let loop: number;
  if (cfg.song === 'midi' && midi && midi.notes.length > 0) {
    base = midi.notes;
    loop = base[base.length - 1].t + 0.6;
  } else {
    const steps = (MELODIES[cfg.song] ?? MELODIES.canon).notes;
    base = stepsToNotes(steps, cfg.bpm);
    loop = steps.length * (60 / Math.max(20, cfg.bpm));
  }
  const out: MarbleNote[] = [];
  const reps = Math.max(1, Math.min(20, Math.round(cfg.repeats)));
  for (let r = 0; r < reps; r++) {
    for (const n of base) out.push({ t: n.t + r * loop, midi: n.midi.map((m) => m + cfg.transpose) });
  }
  return out;
}

export function courseOptions(cfg: MarbleConfig) {
  return {
    seed: cfg.seed,
    gravity: cfg.gravity,
    width: cfg.width,
    descent: cfg.descent,
    rollGap: cfg.rollGap,
    restGap: cfg.restGap,
    splitPitch: cfg.splitPitch,
  };
}

export function sanitizeMarble(raw: unknown): MarbleConfig {
  const out: MarbleConfig = { ...DEFAULT_MARBLE };
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  const dst = out as unknown as Record<string, unknown>;
  for (const k of Object.keys(DEFAULT_MARBLE)) {
    const v = src[k];
    if (v !== undefined && typeof v === typeof dst[k]) dst[k] = v;
  }
  return out;
}

/** MIDI notes grouped into chords with their real start times. */
export function midiToNotes(notes: { time: number; midi: number }[]): MarbleNote[] {
  const sorted = [...notes].sort((a, b) => a.time - b.time || b.midi - a.midi);
  const out: MarbleNote[] = [];
  for (const n of sorted) {
    const last = out[out.length - 1];
    if (last && n.time - last.t < 0.03) {
      if (last.midi.length < 4 && !last.midi.includes(n.midi)) last.midi.push(n.midi);
    } else {
      out.push({ t: n.time, midi: [n.midi] });
    }
  }
  return out;
}
