import {
  cloneConfig, MODE_DEFAULTS, MODE_INFO, VARIANTS, type ChaosEvent, type ChaosKind, type Config, type Instrument, type Mode,
  type ScaleName,
} from './config';
import { MELODIES } from './audio/melodies';

export interface RandomLocks {
  mode: boolean;
  look: boolean;
  audio: boolean;
  text: boolean;
}

export type HookLang = 'vi' | 'en';

export interface Palette {
  name: string;
  bg: string;
  ring: string;
  ball: string;
  ringRainbow: boolean;
  colorMode: Config['colorMode'];
  text: string;
}

/** Hand-picked colour combinations that read well on phone screens. */
export const PALETTES: Palette[] = [
  { name: 'Neon đêm', bg: '#0b0b12', ring: '#ffffff', ball: '#ff3b6b', ringRainbow: true, colorMode: 'rainbow', text: '#ffffff' },
  { name: 'Trắng tối giản', bg: '#000000', ring: '#ffffff', ball: '#ffffff', ringRainbow: false, colorMode: 'solid', text: '#ffffff' },
  { name: 'Hoàng hôn', bg: '#1a0b1e', ring: '#ff9e3d', ball: '#ffd166', ringRainbow: false, colorMode: 'cycle', text: '#ffe8c2' },
  { name: 'Đại dương', bg: '#04121f', ring: '#3ec7ff', ball: '#7cf3ff', ringRainbow: false, colorMode: 'rainbow', text: '#e6fbff' },
  { name: 'Matrix', bg: '#020a04', ring: '#38ff7a', ball: '#a6ffbf', ringRainbow: false, colorMode: 'solid', text: '#c9ffd9' },
  { name: 'Kẹo ngọt', bg: '#1b1029', ring: '#ff8ad8', ball: '#8af7ff', ringRainbow: false, colorMode: 'rainbow', text: '#fff0fb' },
  { name: 'Lửa', bg: '#120604', ring: '#ff4d1a', ball: '#ffb21a', ringRainbow: false, colorMode: 'cycle', text: '#fff1e0' },
  { name: 'Băng giá', bg: '#0a1020', ring: '#bfe3ff', ball: '#ffffff', ringRainbow: false, colorMode: 'solid', text: '#ffffff' },
  { name: 'Vàng sang', bg: '#0d0b06', ring: '#e8c15a', ball: '#fff3c4', ringRainbow: false, colorMode: 'solid', text: '#fff3c4' },
  { name: 'Cầu vồng sáng', bg: '#f4f1ea', ring: '#202020', ball: '#ff3b6b', ringRainbow: false, colorMode: 'rainbow', text: '#111111' },
];

export const HOOKS: Record<Mode, Record<HookLang, string[]>> = {
  escape: {
    vi: ['Mỗi lần thoát ra = thêm 2 bóng', 'Bao lâu thì đầy màn hình?', 'Đừng để chúng thoát ra!', 'Đợi đến cuối nhé…'],
    en: ['Every escape = 2 more balls', 'How long until it fills up?', "Don't let them escape!", 'Wait for the end…'],
  },
  infinite: {
    vi: ['1 quả bóng → hàng nghìn quả', 'Nó sẽ không bao giờ dừng…', 'Đếm thử xem có bao nhiêu bóng?'],
    en: ['1 ball → thousands', 'It never stops…', 'Can you count them all?'],
  },
  grow: {
    vi: ['Bóng to dần mỗi lần nảy', 'Liệu nó có lấp kín vòng?', 'Càng nảy càng to…'],
    en: ['It grows with every bounce', 'Will it fill the circle?', 'Bigger with every hit…'],
  },
  destruction: {
    vi: ['Phá hết các vòng', 'Bao lâu để phá hết?', 'Từng vòng một…'],
    en: ['Break every ring', 'How long to break them all?', 'One ring at a time…'],
  },
  accumulation: {
    vi: ['Chạm gai là dính — vỡ kính là thoát!', 'Kính sắp vỡ rồi…', 'Bao nhiêu bóng sẽ bị kẹt?'],
    en: ['Touch a spike and you stick', 'The glass is about to break…', 'How many will get stuck?'],
  },
  collision: {
    vi: ['Khi 2 quả bóng chạm nhau…', 'Chờ đến lúc chúng va vào nhau', 'Đừng bỏ lỡ cái kết!'],
    en: ['When the two balls collide…', 'Wait for the collision', "Don't miss the ending!"],
  },
  spiral: {
    vi: ['Thoát khỏi vòng xoắn ốc', 'Liệu bóng có ra được ngoài?', 'Phá kim cương để nhân điểm!'],
    en: ['Escape the spiral', 'Will it make it out?', 'Smash the gems for multipliers!'],
  },
  trail: {
    vi: ['Tô kín vòng tròn', 'Xem nó vẽ gì nè', 'Thỏa mãn đến từng giây'],
    en: ['Paint the whole circle', 'Watch what it draws', 'Oddly satisfying'],
  },
  merge: {
    vi: ['Bóng cùng cỡ gộp lại', 'Lên được cấp cao nhất không?', 'Gộp, gộp và gộp…'],
    en: ['Same size balls merge', 'Can it reach the max level?', 'Merge, merge, merge…'],
  },
  koth: {
    vi: ['Ai trụ lại cuối cùng?', 'Chọn màu của bạn ở comment!', 'Màu nào sẽ thắng?'],
    en: ['Who survives the longest?', 'Pick your colour in the comments!', 'Which colour wins?'],
  },
  symmetric: {
    vi: ['30 quả bóng, lệch nhau 0.01px', 'Hiệu ứng cánh bướm', 'Từ trật tự đến hỗn loạn'],
    en: ['30 balls, 0.01px apart', 'The butterfly effect', 'From order to chaos'],
  },
};

const END_TEXT: Partial<Record<Mode, Record<HookLang, string>>> = {
  escape: { vi: 'THOÁT RỒI!', en: 'ESCAPED!' },
  infinite: { vi: 'ĐẦY RỒI!', en: 'FULL!' },
  grow: { vi: '100%!', en: '100%!' },
  destruction: { vi: 'PHÁ XONG!', en: 'ALL BROKEN!' },
  accumulation: { vi: 'KÍNH VỠ!', en: 'GLASS BROKEN!' },
  collision: { vi: 'BÙM!', en: 'BOOM!' },
  spiral: { vi: 'THOÁT!', en: 'ESCAPED!' },
  trail: { vi: 'KÍN!', en: 'FILLED!' },
  merge: { vi: 'GỘP TỐI ĐA!', en: 'MAX MERGE!' },
  koth: { vi: '{winner} THẮNG!', en: '{winner} WINS!' },
};

const COUNTER_EN: Partial<Record<Mode, string>> = {
  escape: 'Balls: ', infinite: 'Balls: ', grow: 'Size: ', trail: 'Size: ', destruction: 'Rings: ',
  accumulation: 'Stuck: ', collision: 'Balls: ', spiral: 'Score: ', merge: 'Score: ', koth: 'Left: ',
};

/** How often each mode is picked; the most viral formats come up more. */
const MODE_WEIGHTS: Record<Mode, number> = {
  escape: 3, infinite: 2, grow: 2, destruction: 2, accumulation: 2, collision: 2, spiral: 2, trail: 1.5, merge: 1, koth: 2, symmetric: 1,
};

const INSTRUMENTS: Instrument[] = [
  'marimba', 'piano', 'bell', 'musicbox', 'harp', 'guitar', 'pluck', 'organ', 'synth', 'pop', 'chip', 'glass', 'marble', 'wood', 'drop',
];

/** A few well-spaced twists for a video of roughly `duration` seconds. */
export function randomChaos(r: () => number, duration: number, mode: Mode): ChaosEvent[] {
  const kinds: ChaosKind[] = ['gravityFlip', 'blackHole', 'wind', 'speedBurst', 'reverse', 'gravityScale'];
  if (mode === 'escape' || mode === 'koth' || mode === 'destruction') kinds.push('widenGap');
  if (mode === 'escape' || mode === 'infinite') kinds.push('spawn');
  const n = 2 + Math.floor(r() * 2);
  const out: ChaosEvent[] = [];
  for (let k = 0; k < n; k++) {
    const kind = kinds[Math.floor(r() * kinds.length) % kinds.length];
    const t = Math.round(((k + 1) / (n + 1)) * Math.max(8, duration) * (0.85 + r() * 0.3));
    const value = {
      gravityFlip: 0, gravityScale: r() < 0.5 ? 2 : 0.4, blackHole: 2 + Math.round(r() * 2), wind: (r() < 0.5 ? -1 : 1) * 1500,
      speedBurst: 1.5, spawn: 10, reverse: 0, widenGap: 20,
    }[kind];
    out.push({ t, kind, value });
  }
  return out;
}
const SCALES: ScaleName[] = ['pentatonic', 'major', 'minor', 'japanese', 'blues'];

/** Modes whose runs end on their own (others just play for the chosen duration). */
export function modeFinishes(cfg: Config): boolean {
  switch (cfg.mode) {
    case 'symmetric':
      return false;
    case 'trail':
      return cfg.growAmount > 0;
    case 'merge':
      return false; // reaching the top level takes far longer than a short video
    default:
      return true;
  }
}

export interface RandomResult {
  cfg: Config;
  /** Human-readable summary of what was picked. */
  summary: string;
}

type Rand = () => number;

const LOOK_KEYS = ['bgColor', 'ringColor', 'ballColor', 'ringRainbow', 'textColor', 'colorMode', 'glow', 'ballOutline'] as const;
const TEXT_KEYS = ['title', 'endText', 'counterLabel', 'showCounter', 'titleSize', 'showTimer'] as const;

/** Mode defaults also carry colours and text; put locked groups back afterwards. */
function restore(cfg: Config, from: Config, keys: readonly (keyof Config)[]): void {
  for (const k of keys) (cfg as unknown as Record<string, unknown>)[k] = from[k];
}

const pick = <T>(r: Rand, list: readonly T[]): T => list[Math.floor(r() * list.length) % list.length];
const range = (r: Rand, a: number, b: number) => a + (b - a) * r();
const round = (v: number, step: number) => Math.round(v / step) * step;

function pickMode(r: Rand): Mode {
  const entries = Object.entries(MODE_WEIGHTS) as [Mode, number][];
  let x = r() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [mode, w] of entries) {
    x -= w;
    if (x <= 0) return mode;
  }
  return 'escape';
}

/**
 * Builds a new random-but-sensible configuration. Output settings (resolution,
 * fps, bitrate, backends, safe zone, watermark) are always kept, and any locked
 * group keeps its current values.
 */
export function randomConfig(base: Config, locks: RandomLocks, lang: HookLang, r: Rand = Math.random): RandomResult {
  const cfg = cloneConfig(base);
  const parts: string[] = [];

  // --- mode, variant and physics
  if (!locks.mode) {
    const mode = pickMode(r);
    cfg.mode = mode;
    Object.assign(cfg, MODE_DEFAULTS[mode]);
    const variants = VARIANTS.filter((v) => v.mode === mode);
    let variantLabel = '';
    if (variants.length > 0 && r() < 0.5) {
      const v = pick(r, variants);
      Object.assign(cfg, v.overrides);
      variantLabel = ` · ${v.label}`;
    }
    parts.push(`${MODE_INFO[mode].icon} ${MODE_INFO[mode].label}${variantLabel}`);

    // Gentle jitter around the mode's defaults keeps every result playable.
    cfg.ringRadius = round(Math.min(480, cfg.ringRadius * range(r, 0.88, 1.06)), 1);
    cfg.ringThickness = round(Math.max(4, cfg.ringThickness * range(r, 0.7, 1.4)), 1);
    cfg.ballRadius = round(Math.max(4, cfg.ballRadius * range(r, 0.8, 1.25)), 0.5);
    cfg.gravity = round(cfg.gravity * range(r, 0.85, 1.2), 10);
    cfg.initialSpeed = round(cfg.initialSpeed * range(r, 0.85, 1.2), 10);
    if (cfg.gapAngle > 0) cfg.gapAngle = round(Math.max(10, cfg.gapAngle * range(r, 0.7, 1.4)), 1);
    if (cfg.rotationSpeed !== 0) cfg.rotationSpeed = round(cfg.rotationSpeed * range(r, 0.7, 1.5) * (r() < 0.5 ? -1 : 1), 1);
    if (cfg.mode === 'destruction') cfg.ringCount = Math.round(range(r, 8, 18));
    if (cfg.mode === 'spiral') cfg.spiralTurns = round(range(r, 4, 7), 0.5);
    if (cfg.mode === 'koth' && !variantLabel) {
      const n = pick(r, [2, 3, 4, 4, 6]);
      cfg.initialBalls = n;
      cfg.teamNames = ['Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple'].slice(0, n).join(', ');
    }
    // Occasional extras on top of the plain modes.
    if (cfg.chaos.length === 0 && cfg.mode !== 'symmetric' && cfg.mode !== 'merge' && r() < 0.15) {
      cfg.chaos = randomChaos(r, 30, cfg.mode);
    }
    if (cfg.mode === 'escape' || cfg.mode === 'grow' || cfg.mode === 'destruction') {
      if (cfg.impactLines === 0 && r() < 0.15) cfg.impactLines = Math.round(range(r, 20, 50));
      if (!cfg.powerups && cfg.mode === 'escape' && r() < 0.15) cfg.powerups = true;
    }
  }

  if (locks.look) restore(cfg, base, LOOK_KEYS);
  if (locks.text) restore(cfg, base, TEXT_KEYS);

  // --- colours and effects
  if (!locks.look) {
    const p = pick(r, PALETTES);
    cfg.bgColor = p.bg;
    cfg.ringColor = p.ring;
    cfg.ballColor = p.ball;
    cfg.ringRainbow = p.ringRainbow;
    cfg.textColor = p.text;
    // Koth teams and merge levels are told apart by colour.
    cfg.colorMode = cfg.mode === 'koth' || cfg.mode === 'merge' || cfg.mode === 'collision' ? 'rainbow' : p.colorMode;
    cfg.glow = r() < 0.75;
    if (cfg.mode !== 'trail') cfg.trailLength = pick(r, [0, 6, 10, 14, 20]);
    cfg.ballOutline = r() < 0.15;
    parts.push(`🎨 ${p.name}`);
  }

  // --- sound
  if (!locks.audio) {
    cfg.sound = true;
    cfg.instrument = pick(r, INSTRUMENTS);
    if (r() < 0.75) {
      cfg.noteMode = 'melody';
      cfg.melodyName = pick(r, Object.keys(MELODIES));
      parts.push(`🎵 ${cfg.instrument} · ${MELODIES[cfg.melodyName].label}`);
    } else {
      cfg.noteMode = pick(r, ['scale', 'random'] as const);
      cfg.scale = pick(r, SCALES);
      cfg.baseNote = pick(r, [55, 57, 60, 62, 64]);
      parts.push(`🎵 ${cfg.instrument} · thang ${cfg.scale}`);
    }
    cfg.transpose = 0;
    cfg.reverb = round(range(r, 0.1, 0.4), 0.01);
  }

  // --- text
  if (!locks.text) {
    cfg.title = pick(r, HOOKS[cfg.mode][lang]);
    cfg.endText = END_TEXT[cfg.mode]?.[lang] ?? '';
    cfg.counterLabel = lang === 'en' ? COUNTER_EN[cfg.mode] ?? '' : MODE_DEFAULTS[cfg.mode].counterLabel ?? '';
    if (cfg.mode === 'symmetric') cfg.title = cfg.title.replace('30', String(cfg.initialBalls));
    cfg.showCounter = cfg.mode !== 'symmetric';
  }

  cfg.seed = Math.floor(r() * 1_000_000);
  return { cfg, summary: parts.join(' · ') };
}
