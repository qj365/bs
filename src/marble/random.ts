import type { Instrument } from '../config';
import { MELODIES } from '../audio/melodies';
import { Rng } from '../rng';
import type { CourseLayout } from './choreo';
import { applyTheme, MARBLE_THEMES, type BallShape, type CameraMode, type MarbleConfig, type Striker } from './config';

export interface MarbleLocks {
  /** Keep the song, tempo and repeats. */
  music: boolean;
  /** Keep theme, materials, colours and camera. */
  look: boolean;
  /** Keep title and subtitle. */
  text: boolean;
}

const HOOKS = {
  vi: [
    'Bạn có nhận ra bài này không? 🎶', 'Nghe đến cuối nhé 🎧', 'Bài này tên gì? 🤔', 'Âm thanh đã tai nhất hôm nay ✨',
    'Thử đoán bài hát 🎵', 'Đeo tai nghe vào 🎧', 'Không thể ngừng xem 😵‍💫', 'Viên bi chơi nhạc 🎹',
  ],
  en: [
    'Did you recognize the music? 🎶', 'Wait for it… 🎧', 'Name this song 🤔', 'Most satisfying sound ✨',
    'Guess the song 🎵', 'Turn your sound on 🔊', 'Can you stop watching? 😵‍💫', 'Marble plays music 🎹',
  ],
};

const SUBS = {
  vi: ['', '', 'Bình luận tên bài 👇', 'Phần 2? 👀', 'Âm thanh đã tai 🎧'],
  en: ['', '', 'Comment the song 👇', 'Part 2? 👀', 'So satisfying 🎧'],
};

/** Instrument pairs that sound good together (low notes, high notes). */
const INSTRUMENT_PAIRS: [Instrument, Instrument][] = [
  ['marimba', 'musicbox'], ['marimba', 'bell'], ['wood', 'glass'], ['harp', 'bell'], ['piano', 'musicbox'],
  ['marimba', 'glass'], ['pluck', 'bell'], ['marble', 'glass'], ['chip', 'chip'], ['piano', 'piano'],
];

const LAYOUTS: CourseLayout[] = ['zigzag', 'zigzag', 'spiral', 'scatter', 'stairs'];
const CAMERAS: CameraMode[] = ['side', 'side', 'top', 'orbit', 'close'];
const STRIKERS: Striker[] = ['bar', 'bar', 'bar', 'mixed', 'mixed', 'bell', 'drum', 'glass', 'tube', 'gong', 'pad'];
const SHAPES: BallShape[] = ['sphere', 'sphere', 'sphere', 'cube', 'dice', 'gem', 'diamond', 'capsule', 'egg', 'star'];

const pick = <T>(rng: Rng, list: readonly T[]): T => list[Math.floor(rng.next() * list.length)];

/**
 * A fresh random marble video: theme, course layout, camera, song, tempo and
 * hook. Output settings (resolution, fps, encoder…) are always kept.
 */
export function randomMarble(base: MarbleConfig, rng: Rng, locks: MarbleLocks, lang: 'vi' | 'en' = 'en', hasMidi = false): MarbleConfig {
  const c: MarbleConfig = { ...base };
  c.seed = rng.int(0, 99999);
  c.layout = pick(rng, LAYOUTS);
  c.width = +(c.layout === 'zigzag' ? rng.range(0.38, 0.6) : rng.range(0.45, 0.8)).toFixed(2);
  c.descent = +rng.range(0.55, 1.1).toFixed(2);
  c.gravity = +rng.range(5, 8).toFixed(1);

  if (!locks.music) {
    const songs = Object.keys(MELODIES);
    c.song = hasMidi && rng.next() < 0.3 ? 'midi' : pick(rng, songs);
    c.bpm = rng.int(110, 200);
    c.repeats = rng.int(1, 2);
    c.transpose = pick(rng, [0, 0, 0, 12, -12, 5, 7]);
  }
  if (!locks.look) {
    applyTheme(c, pick(rng, MARBLE_THEMES).id);
    c.cameraMode = pick(rng, CAMERAS);
    c.striker = pick(rng, STRIKERS);
    c.ballShape = pick(rng, SHAPES);
    c.cameraAngle = rng.int(-40, 40);
    c.cameraElevation = rng.int(5, 25);
    c.cameraDistance = +rng.range(2.8, 4.2).toFixed(1);
    const [lo, hi] = pick(rng, INSTRUMENT_PAIRS);
    c.lowInstrument = lo;
    c.highInstrument = hi;
  }
  if (!locks.text) {
    c.title = pick(rng, HOOKS[lang]);
    c.subtitle = pick(rng, SUBS[lang]);
  }
  return c;
}
