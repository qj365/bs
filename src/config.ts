export type Mode =
  | 'escape' | 'infinite' | 'grow' | 'destruction' | 'accumulation' | 'collision'
  | 'spiral' | 'trail' | 'merge' | 'koth' | 'symmetric';
export type Instrument =
  | 'marimba' | 'piano' | 'bell' | 'pluck' | 'guitar' | 'harp' | 'musicbox' | 'organ' | 'synth' | 'pop' | 'chip'
  | 'glass' | 'marble' | 'wood' | 'drop' | 'sample';
export type NoteMode = 'melody' | 'scale' | 'random' | 'size';
export type ColorMode = 'rainbow' | 'solid' | 'cycle';
export type ScaleName = 'major' | 'minor' | 'pentatonic' | 'blues' | 'japanese' | 'chromatic';
export type SpikeEffect = 'bounce' | 'destroy' | 'freeze';
export type ImpactMode = 'strings' | 'chain';
export type Backend = 'auto' | 'gpu' | 'cpu';
export type SafeZone = 'none' | 'tiktok' | 'shorts';
export type Corner = 'tl' | 'tr' | 'bl' | 'br' | 'center';
export type ChaosKind = 'gravityFlip' | 'gravityScale' | 'blackHole' | 'wind' | 'speedBurst' | 'spawn' | 'reverse' | 'widenGap';

/** A twist that happens at a given second of the video. */
export interface ChaosEvent {
  t: number;
  kind: ChaosKind;
  value: number;
}

export const CHAOS_KINDS: Record<ChaosKind, { label: string; banner: string; value: string; def: number }> = {
  gravityFlip: { label: 'Đảo ngược trọng lực', banner: '⚠️ TRỌNG LỰC ĐẢO NGƯỢC!', value: '—', def: 0 },
  gravityScale: { label: 'Nhân trọng lực', banner: '⚠️ TRỌNG LỰC ×{v}!', value: 'hệ số', def: 2 },
  blackHole: { label: 'Lỗ đen', banner: '🕳️ LỖ ĐEN!', value: 'giây', def: 3 },
  wind: { label: 'Gió (3 giây)', banner: '💨 GIÓ MẠNH!', value: 'lực (âm = sang trái)', def: 1500 },
  speedBurst: { label: 'Tăng tốc tất cả', banner: '⚡ TĂNG TỐC ×{v}!', value: 'hệ số', def: 1.6 },
  spawn: { label: 'Thêm bóng', banner: '➕ THÊM {v} BÓNG!', value: 'số bóng', def: 10 },
  reverse: { label: 'Đảo chiều xoay', banner: '🔄 ĐẢO CHIỀU!', value: '—', def: 0 },
  widenGap: { label: 'Mở rộng khe', banner: '🚪 KHE MỞ RỘNG!', value: 'độ', def: 20 },
};

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

  // Obstacles & extras
  spikeArc: number; // degrees, 0 = no spikes
  spikeEffect: SpikeEffect;
  spikeSize: number;
  ringHp: number; // glass ring: hits before it shatters, 0 = solid
  powerups: boolean;
  powerupInterval: number;
  impactLines: number; // lines kept per ball, 0 = off
  impactMode: ImpactMode;
  explodeCount: number;
  spiralTurns: number;
  spiralSpeed: number; // degrees / second
  gemCount: number;
  arenaSides: number; // 0 = circle, 3–12 = regular polygon
  spikeGrow: number; // spike length added per second
  heroBall: boolean;
  heroRadius: number;
  heroColor: string;
  portals: boolean;
  portalSize: number;
  magnet: number;
  wind: number;
  chaos: ChaosEvent[];

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
  subtitle: string;
  subtitleSize: number;
  subtitleFrom: number; // seconds; 0 = always shown
  watermark: string;
  watermarkPos: Corner;
  watermarkOpacity: number;

  // Audio
  sound: boolean;
  instrument: Instrument;
  sampleBaseNote: number;
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
  stereo: boolean;
  musicVolume: number;
  beatSync: boolean;
  beatStride: number; // 0 = auto, else use every Nth beat

  // Battle (split screen)
  battle: number; // 1 = single arena, 2 or 4 = side-by-side race

  // Output
  resolution: string; // "WxH"
  fps: number;
  duration: number;
  bitrate: number; // Mbps
  stopOnFinish: boolean;
  endHold: number;
  safeZone: SafeZone;
  showSafeZone: boolean;
  previewScale: number;
  renderer: Backend;
  encoder: Backend;
  exportCaption: boolean;
  exportCover: boolean;
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

  spikeArc: 0,
  spikeEffect: 'destroy',
  spikeSize: 14,
  ringHp: 0,
  powerups: false,
  powerupInterval: 3,
  impactLines: 0,
  impactMode: 'strings',
  explodeCount: 200,
  spiralTurns: 5,
  spiralSpeed: 90,
  gemCount: 12,
  arenaSides: 0,
  spikeGrow: 0,
  heroBall: false,
  heroRadius: 40,
  heroColor: '#ffffff',
  portals: false,
  portalSize: 34,
  magnet: 0,
  wind: 0,
  chaos: [],

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
  subtitle: '',
  subtitleSize: 44,
  subtitleFrom: 0,
  watermark: '',
  watermarkPos: 'br',
  watermarkOpacity: 0.6,

  sound: true,
  instrument: 'marimba',
  sampleBaseNote: 60,
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
  stereo: true,
  musicVolume: 0.8,
  beatSync: true,
  beatStride: 0,

  battle: 1,

  resolution: '1080x1920',
  fps: 60,
  duration: 30,
  bitrate: 12,
  stopOnFinish: true,
  endHold: 2,
  safeZone: 'none',
  showSafeZone: false,
  previewScale: 0.5,
  renderer: 'auto',
  encoder: 'auto',
  exportCaption: true,
  exportCover: true,
};

/** Extras that each mode starts without unless its own defaults turn them on. */
const FEATURE_RESET: Partial<Config> = {
  spikeArc: 0, spikeEffect: 'destroy', ringHp: 0, powerups: false, impactLines: 0,
  portals: false, magnet: 0, wind: 0, chaos: [], spikeGrow: 0,
  paintTrail: false, ballCollisions: false, speedBoost: 1, restitution: 1,
};

/** Per-mode starting values: picking a mode applies these on top of the current config. */
export const MODE_DEFAULTS: Record<Mode, Partial<Config>> = {
  escape: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 12, gapAngle: 40, rotationSpeed: 60,
    initialBalls: 1, ballRadius: 16, maxBalls: 400, spawnOnEscape: 2,
    gravity: 1800, initialSpeed: 900,
    trailLength: 8, colorMode: 'rainbow',
    title: 'Mỗi lần thoát ra = thêm 2 bóng', counterLabel: 'Bóng: ', endText: '',
  },
  infinite: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 10, gapAngle: 36, rotationSpeed: 70,
    initialBalls: 1, ballRadius: 9, maxBalls: 1500, spawnOnEscape: 1,
    gravity: 1500, initialSpeed: 900,
    trailLength: 4, colorMode: 'rainbow',
    title: '1 quả bóng → 1500 quả', counterLabel: 'Bóng: ', endText: '1500 BÓNG!',
  },
  grow: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 1, ballRadius: 20, growAmount: 4,
    gravity: 1600, speedBoost: 1.004, initialSpeed: 700,
    trailLength: 10, colorMode: 'cycle',
    title: 'Bóng to dần mỗi lần nảy', counterLabel: 'Kích thước: ', endText: '100%!',
  },
  destruction: {
    ...FEATURE_RESET,
    ringRadius: 470, ringThickness: 8, ringCount: 14, ringSpacing: 26, gapAngle: 50, rotationSpeed: 70,
    alternateRotation: true, initialBalls: 1, ballRadius: 12,
    gravity: 1500, initialSpeed: 800,
    trailLength: 14, colorMode: 'solid', ballColor: '#ffffff',
    title: 'Phá hết các vòng', counterLabel: 'Vòng: ', endText: 'PHÁ XONG!',
  },
  accumulation: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 12, gapAngle: 0, rotationSpeed: 45,
    spikeArc: 150, spikeEffect: 'freeze', spikeSize: 16, ringHp: 70,
    initialBalls: 1, ballRadius: 15, maxBalls: 250, spawnInterval: 0.9,
    gravity: 1400, initialSpeed: 800, ballCollisions: true,
    trailLength: 6, colorMode: 'rainbow',
    title: 'Chạm gai là dính — vỡ kính là thoát!', counterLabel: 'Dính gai: ', endText: 'KÍNH VỠ!',
  },
  collision: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 12, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 2, ballRadius: 12, explodeCount: 220, teamNames: 'Red, Blue',
    gravity: 0, initialSpeed: 1000, ballCollisions: true,
    trailLength: 12, colorMode: 'rainbow',
    title: 'Khi 2 quả bóng chạm nhau…', counterLabel: 'Bóng: ', endText: 'BÙM!', endHold: 4,
  },
  spiral: {
    ...FEATURE_RESET,
    ringRadius: 460, ringThickness: 6, spiralTurns: 5, spiralSpeed: 90, gemCount: 12,
    initialBalls: 1, ballRadius: 11, restitution: 0.9,
    gravity: 1500, initialSpeed: 300,
    trailLength: 12, colorMode: 'cycle',
    title: 'Thoát khỏi vòng xoắn ốc', counterLabel: 'Điểm: ', endText: 'THOÁT!',
  },
  trail: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 1, ballRadius: 14, growAmount: 0.6,
    gravity: 1600, initialSpeed: 900,
    trailLength: 0, paintTrail: true, colorMode: 'cycle',
    title: 'Tô kín vòng tròn', counterLabel: 'Kích thước: ', endText: 'KÍN!',
  },
  merge: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 0, ballRadius: 18, maxBalls: 150, spawnInterval: 0.5,
    gravity: 1400, restitution: 0.55, initialSpeed: 0, ballCollisions: true,
    trailLength: 0, colorMode: 'rainbow',
    title: 'Bóng cùng cỡ gộp lại', counterLabel: 'Điểm: ', endText: 'GỘP TỐI ĐA!',
  },
  koth: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 14, gapAngle: 18, rotationSpeed: 45,
    initialBalls: 4, ballRadius: 34, teamNames: 'Red, Blue, Green, Yellow',
    gravity: 900, initialSpeed: 700, ballCollisions: true,
    trailLength: 10, colorMode: 'rainbow',
    title: 'Ai trụ lại cuối cùng?', counterLabel: 'Còn lại: ', endText: '{winner} THẮNG!',
  },
  symmetric: {
    ...FEATURE_RESET,
    ringRadius: 420, ringThickness: 10, gapAngle: 0, rotationSpeed: 0,
    initialBalls: 30, ballRadius: 10, dropSpread: 0.01,
    gravity: 1600, initialSpeed: 0,
    trailLength: 20, colorMode: 'rainbow',
    title: '30 quả bóng, lệch nhau 0.01px', counterLabel: '', endText: '',
  },
};

export const MODE_INFO: Record<Mode, { label: string; icon: string; desc: string }> = {
  escape: { label: 'Classic', icon: '⭕', desc: 'Bóng thoát qua khe → sinh thêm bóng' },
  infinite: { label: 'Infinite Loop', icon: '♾️', desc: '1 bóng nhân bản thành hàng nghìn' },
  grow: { label: 'Lớn dần', icon: '🎈', desc: 'Mỗi lần nảy bóng to thêm' },
  destruction: { label: 'Destruction', icon: '💥', desc: 'Phá từng vòng đồng tâm' },
  accumulation: { label: 'Accumulation', icon: '📌', desc: 'Chạm gai thì dính, vòng kính vỡ thì thoát' },
  collision: { label: 'Collision', icon: '☄️', desc: '2 bóng chạm nhau → nổ tung' },
  spiral: { label: 'Spiral', icon: '🌀', desc: 'Thoát xoắn ốc, phá kim cương nhân điểm' },
  trail: { label: 'Trail', icon: '🖌️', desc: 'Vệt màu loang kín vòng' },
  merge: { label: 'Merge', icon: '🫧', desc: 'Bóng cùng cỡ gộp lại' },
  koth: { label: 'King of the Hill', icon: '👑', desc: 'Đội nào trụ lại cuối cùng' },
  symmetric: { label: 'Symmetric Drop', icon: '🦋', desc: 'Lệch 0.01px → hỗn loạn' },
};

export const MODE_LABELS: Record<Mode, string> = Object.fromEntries(
  Object.entries(MODE_INFO).map(([k, v]) => [k, `${v.icon} ${v.label}`]),
) as Record<Mode, string>;

/** Ready-made variations ("sub-modes") layered on top of a mode's defaults. */
export interface Variant {
  id: string;
  mode: Mode;
  label: string;
  overrides: Partial<Config>;
}

export const VARIANTS: Variant[] = [
  { id: 'will-escape', mode: 'escape', label: 'Bóng có thoát được không?', overrides: { spawnOnEscape: 0, gapAngle: 14, title: 'Quả bóng có thoát ra được không?', counterLabel: '', endText: 'THOÁT RỒI!' } },
  { id: 'escape-glass', mode: 'escape', label: 'Vòng kính', overrides: { gapAngle: 0, ringHp: 40, spawnOnEscape: 0, title: 'Kính vỡ sau 40 lần va', endText: 'KÍNH VỠ!' } },
  { id: 'escape-strings', mode: 'escape', label: 'Dây va chạm', overrides: { impactLines: 40, spawnOnEscape: 0, gapAngle: 12, trailLength: 0, glow: false, title: 'Mỗi lần chạm = 1 sợi dây' } },
  { id: 'escape-portals', mode: 'escape', label: 'Cổng dịch chuyển', overrides: { portals: true, spawnOnEscape: 1, title: 'Đi qua cổng là sang phía bên kia!' } },
  { id: 'escape-chaos', mode: 'escape', label: 'Biến cố', overrides: { spawnOnEscape: 0, gapAngle: 16, title: 'Chuyện gì sẽ xảy ra ở giây thứ 10?', chaos: [{ t: 10, kind: 'gravityFlip', value: 0 }, { t: 18, kind: 'blackHole', value: 3 }, { t: 25, kind: 'widenGap', value: 25 }] } },
  { id: 'escape-powerups', mode: 'escape', label: 'Vật phẩm', overrides: { powerups: true, powerupInterval: 2.5, title: 'Ăn vật phẩm để mạnh hơn' } },
  { id: 'grow-spikes', mode: 'grow', label: 'Lớn dần + gai', overrides: { spikeArc: 70, spikeEffect: 'destroy', rotationSpeed: 0, title: 'Đừng chạm gai!', endText: 'KẾT THÚC!' } },
  { id: 'grow-magnet', mode: 'grow', label: 'Nam châm', overrides: { magnet: 900, gravity: 600, title: 'Nam châm ở giữa kéo bóng lại' } },
  { id: 'grow-strings', mode: 'grow', label: 'Lớn dần + dây', overrides: { impactLines: 64, impactMode: 'chain', trailLength: 0 } },
  { id: 'destruction-glass', mode: 'destruction', label: 'Vòng kính', overrides: { gapAngle: 0, ringHp: 6, ringCount: 10, title: 'Mỗi vòng chịu 6 lần va' } },
  { id: 'destruction-fast', mode: 'destruction', label: 'Tăng tốc', overrides: { speedBoost: 1.01, ringCount: 20, ringSpacing: 18 } },
  {
    id: 'heptagon-grow', mode: 'accumulation', label: '7 cạnh + gai mọc',
    overrides: {
      arenaSides: 7, ringColor: '#ffffff', ringRainbow: false, ringThickness: 8, rotationSpeed: 18, glow: false,
      spikeArc: 200, spikeEffect: 'destroy', spikeSize: 10, spikeGrow: 3, ringHp: 0,
      heroBall: true, heroRadius: 44, heroColor: '#ffffff', ballRadius: 9, spawnInterval: 0.25, maxBalls: 300,
      colorMode: 'rainbow', trailLength: 0, title: 'Gai mọc dài dần…', subtitle: 'Did you recognize the music?', subtitleFrom: 0,
      counterLabel: 'Bóng: ', endText: '',
    },
  },
  { id: 'accumulation-many', mode: 'accumulation', label: 'Nhiều bóng', overrides: { spawnInterval: 0.35, ballRadius: 10, ringHp: 150 } },
  { id: 'collision-mega', mode: 'collision', label: 'Nổ 1000 bóng', overrides: { explodeCount: 1000, ballCollisions: false } },
  { id: 'spiral-fast', mode: 'spiral', label: 'Xoắn nhanh', overrides: { spiralSpeed: 160, spiralTurns: 7, gemCount: 20 } },
  { id: 'trail-strings', mode: 'trail', label: 'Tô + dây', overrides: { impactLines: 30 } },
  { id: 'koth-wind', mode: 'koth', label: 'Gió & biến cố', overrides: { chaos: [{ t: 8, kind: 'wind', value: 1600 }, { t: 15, kind: 'wind', value: -1600 }, { t: 22, kind: 'speedBurst', value: 1.5 }] } },
  { id: 'koth-8', mode: 'koth', label: '8 đội', overrides: { initialBalls: 8, ballRadius: 24, teamNames: 'Red, Blue, Green, Yellow, Orange, Purple, Pink, Cyan' } },
  { id: 'symmetric-100', mode: 'symmetric', label: '100 bóng', overrides: { initialBalls: 100, ballRadius: 6, trailLength: 10, title: '100 quả bóng, lệch nhau 0.01px' } },
];

export function parseResolution(res: string): { width: number; height: number } {
  const [w, h] = res.split('x').map(Number);
  return { width: w || 1080, height: h || 1920 };
}

export function cloneConfig(c: Config): Config {
  return { ...c, melody: c.melody.map((ch) => ch.slice()), chaos: c.chaos.map((e) => ({ ...e })) };
}

/** Merge an untrusted object (e.g. a loaded preset file) onto defaults, keeping only known keys of the right type. */
export function sanitizeConfig(raw: unknown): Config {
  const out = cloneConfig(DEFAULT_CONFIG);
  if (!raw || typeof raw !== 'object') return out;
  const src = raw as Record<string, unknown>;
  for (const key of Object.keys(DEFAULT_CONFIG) as (keyof Config)[]) {
    const v = src[key];
    if (v === undefined) continue;
    if (key === 'chaos') {
      if (Array.isArray(v)) {
        out.chaos = v
          .filter((e): e is Record<string, unknown> => !!e && typeof e === 'object')
          .filter((e) => typeof e.t === 'number' && isFinite(e.t) && typeof e.value === 'number' && isFinite(e.value) && typeof e.kind === 'string' && e.kind in CHAOS_KINDS)
          .slice(0, 8)
          .map((e) => ({ t: e.t as number, kind: e.kind as ChaosKind, value: e.value as number }));
      }
      continue;
    }
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
  if (!(out.mode in MODE_DEFAULTS)) out.mode = 'escape';
  return out;
}
