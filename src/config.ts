export type Mode = 'escape' | 'grow' | 'destruction' | 'trail' | 'merge' | 'koth' | 'symmetric';
export type Instrument = 'marimba' | 'piano' | 'bell' | 'pluck' | 'pop' | 'chip';
export type NoteMode = 'melody' | 'scale' | 'random' | 'size';
export type ColorMode = 'rainbow' | 'solid' | 'cycle';
export type ScaleName = 'major' | 'minor' | 'pentatonic' | 'blues' | 'japanese' | 'chromatic';

export interface Config {
  mode: Mode;
  seed: number;

  // Arena
  ringRadius: number;
  ringThickness: number;
  ringCount: number;
  ringSpacing: number;
  gapAngle: number; // degrees
  rotationSpeed: number; // degrees / second
  alternateRotation: boolean;

  // Balls
  initialBalls: number;
  ballRadius: number;
  maxBalls: number;
  spawnOnEscape: number;
  growAmount: number;
  spawnInterval: number;
  teamNames: string;
  dropSpread: number;

  // Physics
  gravity: number;
  restitution: number;
  speedBoost: number;
  initialSpeed: number;
  maxSpeed: number;
  ballCollisions: boolean;

  // Visuals
  bgColor: string;
  ringColor: string;
  ringRainbow: boolean;
  colorMode: ColorMode;
  ballColor: string;
  glow: boolean;
  trailLength: number;
  paintTrail: boolean;
  particles: boolean;
  ballOutline: boolean;

  // Text
  title: string;
  titleSize: number;
  textColor: string;
  showCounter: boolean;
  counterLabel: string;
  showTimer: boolean;
  endText: string;

  // Audio
  sound: boolean;
  instrument: Instrument;
  noteMode: NoteMode;
  melodyName: string;
  melody: number[][];
  scale: ScaleName;
  baseNote: number;
  transpose: number;
  volume: number;
  reverb: number;
  minNoteGap: number;
  ballHitSound: boolean;
  sfx: boolean;

  // Output
  resolution: string; // "WxH"
  fps: number;
  duration: number;
  bitrate: number; // Mbps
  stopOnFinish: boolean;
  endHold: number;
  previewScale: number;
}

export const DEFAULT_CONFIG: Config = {
  mode: 'escape',
  seed: 1,

  ringRadius: 420,
  ringThickness: 12,
  ringCount: 12,
  ringSpacing: 28,
  gapAngle: 40,
  rotationSpeed: 60,
  alternateRotation: true,

  initialBalls: 1,
  ballRadius: 16,
  maxBalls: 400,
  spawnOnEscape: 2,
  growAmount: 2,
  spawnInterval: 0.6,
  teamNames: 'Red, Blue, Green, Yellow',
  dropSpread: 0.01,

  gravity: 1800,
  restitution: 1,
  speedBoost: 1,
  initialSpeed: 900,
  maxSpeed: 3200,
  ballCollisions: false,

  bgColor: '#0b0b12',
  ringColor: '#ffffff',
  ringRainbow: true,
  colorMode: 'rainbow',
  ballColor: '#ff3b6b',
  glow: true,
  trailLength: 12,
  paintTrail: false,
  particles: true,
  ballOutline: false,

  title: 'Mỗi lần thoát ra = thêm 2 bóng',
  titleSize: 64,
  textColor: '#ffffff',
  showCounter: true,
  counterLabel: 'Bóng: ',
  showTimer: false,
  endText: '',

  sound: true,
  instrument: 'marimba',
  noteMode: 'melody',
  melodyName: 'ode',
  melody: [],
  scale: 'pentatonic',
  baseNote: 60,
  transpose: 0,
  volume: 0.7,
  reverb: 0.25,
  minNoteGap: 0.04,
  ballHitSound: false,
  sfx: true,

  resolution: '1080x1920',
  fps: 60,
  duration: 30,
  bitrate: 12,
  stopOnFinish: true,
  endHold: 2,
  previewScale: 0.5,
};

/** Per-mode starting values: picking a mode applies these on top of the current config. */
export const MODE_DEFAULTS: Record<Mode, Partial<Config>> = {
  escape: {
    ringRadius: 420, ringThickness: 12, gapAngle: 40, rotationSpeed: 60,
    initialBalls: 1, ballRadius: 16, maxBalls: 400, spawnOnEscape: 2,
    gravity: 1800, restitution: 1, speedBoost: 1, initialSpeed: 900, ballCollisions: false,
    trailLength: 8, paintTrail: false, colorMode: 'rainbow',
    title: 'Mỗi lần thoát ra = thêm 2 bóng', counterLabel: 'Bóng: ', endText: '',
  },
  grow: {
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 1, ballRadius: 20, growAmount: 4,
    gravity: 1600, restitution: 1, speedBoost: 1.004, initialSpeed: 700, ballCollisions: false,
    trailLength: 10, paintTrail: false, colorMode: 'cycle',
    title: 'Bóng to dần mỗi lần nảy', counterLabel: 'Kích thước: ', endText: '100%!',
  },
  destruction: {
    ringRadius: 470, ringThickness: 8, ringCount: 14, ringSpacing: 26, gapAngle: 50, rotationSpeed: 70,
    alternateRotation: true, initialBalls: 1, ballRadius: 12,
    gravity: 1500, restitution: 1, speedBoost: 1, initialSpeed: 800, ballCollisions: false,
    trailLength: 14, paintTrail: false, colorMode: 'solid', ballColor: '#ffffff',
    title: 'Phá hết các vòng', counterLabel: 'Vòng: ', endText: 'PHÁ XONG!',
  },
  trail: {
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 1, ballRadius: 14, growAmount: 0.6,
    gravity: 1600, restitution: 1, speedBoost: 1, initialSpeed: 900, ballCollisions: false,
    trailLength: 0, paintTrail: true, colorMode: 'cycle',
    title: 'Tô kín vòng tròn', counterLabel: 'Kích thước: ', endText: 'KÍN!',
  },
  merge: {
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 0, ballRadius: 18, maxBalls: 150, spawnInterval: 0.5,
    gravity: 1400, restitution: 0.55, speedBoost: 1, initialSpeed: 0, ballCollisions: true,
    trailLength: 0, paintTrail: false, colorMode: 'rainbow',
    title: 'Bóng cùng cỡ gộp lại', counterLabel: 'Điểm: ', endText: '',
  },
  koth: {
    ringRadius: 420, ringThickness: 14, gapAngle: 18, rotationSpeed: 45,
    initialBalls: 4, ballRadius: 34, teamNames: 'Red, Blue, Green, Yellow',
    gravity: 900, restitution: 1, speedBoost: 1, initialSpeed: 700, ballCollisions: true,
    trailLength: 10, paintTrail: false, colorMode: 'rainbow',
    title: 'Ai trụ lại cuối cùng?', counterLabel: 'Còn lại: ', endText: '{winner} THẮNG!',
  },
  symmetric: {
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 30, ballRadius: 10, dropSpread: 0.01,
    gravity: 1600, restitution: 1, speedBoost: 1, initialSpeed: 0, ballCollisions: false,
    trailLength: 20, paintTrail: false, colorMode: 'rainbow',
    title: '30 quả bóng, lệch nhau 0.01px', counterLabel: '', endText: '',
  },
};

export const MODE_LABELS: Record<Mode, string> = {
  escape: 'Thoát vòng (nhân bóng)',
  grow: 'Bóng lớn dần',
  destruction: 'Phá vòng (Destruction)',
  trail: 'Vệt màu loang (Trail)',
  merge: 'Gộp bóng (Merge)',
  koth: 'Vua của vòng (King of the Hill)',
  symmetric: 'Thả đối xứng (hỗn loạn)',
};

export function parseResolution(res: string): { width: number; height: number } {
  const [w, h] = res.split('x').map(Number);
  return { width: w || 1080, height: h || 1920 };
}

export function cloneConfig(c: Config): Config {
  return { ...c, melody: c.melody.map((ch) => ch.slice()) };
}

/** Merge an untrusted object (e.g. a loaded preset file) onto defaults, keeping only known keys of the right type. */
export function sanitizeConfig(raw: unknown): Config {
  const out = cloneConfig(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
    const v = src[key];
    if (v === undefined) continue;
    if (key === 'melody') {
      if (Array.isArray(v)) {
        out.melody = v
          .filter(Array.isArray)
          .map((ch) => (ch as unknown[]).filter((n): n is number => typeof n === 'number' && isFinite(n)));
      }
      continue;
    }
    if (typeof v === typeof DEFAULT_CONFIG[key]) {
      if (typeof v === 'number' && !isFinite(v)) continue;
      (out as unknown as Record<string, unknown>)[key] = v;
    }
  }
  return out;
}
