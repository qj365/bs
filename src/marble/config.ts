import type { Backend, Instrument } from '../config';
import { MELODIES } from '../audio/melodies';
import { DEFAULT_COURSE, stepsToNotes, type CourseLayout, type CourseOptions, type MarbleNote } from './choreo';

export type BarStyle = 'wood' | 'plain' | 'glass' | 'metal' | 'neon';
/** played: one colour until hit, another after · pitch: rainbow by note · random: random colour per bar */
export type ColorMode = 'played' | 'pitch' | 'random';
export type BallStyle = 'steel' | 'gold' | 'glass' | 'glow' | 'plastic';
/** side: classic view · top: looking down the shaft · orbit: slowly circles the ball · close: low and near */
export type CameraMode = 'side' | 'top' | 'orbit' | 'close';
export type Backdrop = 'wall' | 'void';

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
  layout: CourseLayout;

  /** Last applied theme (for the UI). */
  theme: string;
  barStyle: BarStyle;
  colorMode: ColorMode;
  ballStyle: BallStyle;
  cameraMode: CameraMode;
  backdrop: Backdrop;
  sparks: boolean;
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
  layout: 'zigzag',
  theme: 'classic',
  barStyle: 'wood',
  colorMode: 'played',
  ballStyle: 'steel',
  cameraMode: 'side',
  backdrop: 'wall',
  sparks: false,
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

export function courseOptions(cfg: MarbleConfig): Partial<CourseOptions> {
  return {
    seed: cfg.seed,
    gravity: cfg.gravity,
    width: cfg.width,
    descent: cfg.descent,
    rollGap: cfg.rollGap,
    restGap: cfg.restGap,
    splitPitch: cfg.splitPitch,
    layout: cfg.layout,
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

/** Ready-made looks; each only sets visual keys, so the song and course stay. */
export const MARBLE_THEMES: { id: string; label: string; overrides: Partial<MarbleConfig> }[] = [
  {
    id: 'classic', label: '🟧 Cổ điển (cam → trắng)',
    overrides: { barStyle: 'wood', colorMode: 'played', barColor: '#ffa515', playedColor: '#f4f4f2', bgColor: '#3a4458', holderColor: '#101216', ballStyle: 'steel', ballColor: '#555a63', stripeColor: '#d8262c', backdrop: 'wall', fog: 0.45, light: 1, sparks: false },
  },
  {
    id: 'neon', label: '🌃 Neon đêm',
    overrides: { barStyle: 'neon', colorMode: 'pitch', bgColor: '#07060f', holderColor: '#2a2a3a', ballStyle: 'glow', ballColor: '#ffffff', stripeColor: '#00e5ff', backdrop: 'void', fog: 0.55, light: 0.7, sparks: true },
  },
  {
    id: 'crystal', label: '💎 Pha lê',
    overrides: { barStyle: 'glass', colorMode: 'pitch', bgColor: '#1b2a3c', holderColor: '#c8d4e4', ballStyle: 'steel', ballColor: '#d8dde6', stripeColor: '#7fd7ff', backdrop: 'wall', fog: 0.4, light: 1.2, sparks: true },
  },
  {
    id: 'candy', label: '🍬 Kẹo ngọt',
    overrides: { barStyle: 'plain', colorMode: 'random', bgColor: '#f7c6dc', holderColor: '#ffffff', ballStyle: 'plastic', ballColor: '#ff4f8b', stripeColor: '#ffffff', backdrop: 'wall', fog: 0.3, light: 1.2, sparks: false },
  },
  {
    id: 'gold', label: '🏆 Vàng kim',
    overrides: { barStyle: 'metal', colorMode: 'played', barColor: '#d9a21b', playedColor: '#fff2c2', bgColor: '#17120d', holderColor: '#2b2118', ballStyle: 'gold', ballColor: '#e0b030', stripeColor: '#1a1a1a', backdrop: 'wall', fog: 0.5, light: 1.1, sparks: true },
  },
  {
    id: 'ocean', label: '🌊 Đại dương',
    overrides: { barStyle: 'glass', colorMode: 'played', barColor: '#36c2ff', playedColor: '#e6fbff', bgColor: '#0a2b40', holderColor: '#0b1a26', ballStyle: 'glass', ballColor: '#bdefff', stripeColor: '#ffffff', backdrop: 'void', fog: 0.6, light: 1, sparks: false },
  },
  {
    id: 'forest', label: '🌲 Rừng gỗ',
    overrides: { barStyle: 'wood', colorMode: 'played', barColor: '#8cc152', playedColor: '#f6efd9', bgColor: '#1d3123', holderColor: '#2b1d12', ballStyle: 'steel', ballColor: '#6b6f74', stripeColor: '#e8b23a', backdrop: 'wall', fog: 0.5, light: 1, sparks: false },
  },
  {
    id: 'rainbow', label: '🌈 Cầu vồng',
    overrides: { barStyle: 'wood', colorMode: 'pitch', bgColor: '#2c2f3a', holderColor: '#101216', ballStyle: 'steel', ballColor: '#8a909a', stripeColor: '#ffffff', backdrop: 'wall', fog: 0.45, light: 1.05, sparks: false },
  },
  {
    id: 'sunset', label: '🌅 Hoàng hôn',
    overrides: { barStyle: 'plain', colorMode: 'played', barColor: '#ff6a3d', playedColor: '#ffe3b8', bgColor: '#3d1f3f', holderColor: '#1a0f1c', ballStyle: 'gold', ballColor: '#ffcf6e', stripeColor: '#7a1f4f', backdrop: 'void', fog: 0.5, light: 1, sparks: true },
  },
];

export function applyTheme(cfg: MarbleConfig, id: string): void {
  const theme = MARBLE_THEMES.find((t) => t.id === id);
  if (!theme) return;
  Object.assign(cfg, theme.overrides);
  cfg.theme = id;
}
