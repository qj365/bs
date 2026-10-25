import { CHAOS_KINDS, MODE_INFO, type ChaosEvent, type Config, type Instrument, type Mode } from '../config';
import { MELODIES } from '../audio/melodies';
import { PALETTES, type HookLang, type Palette } from '../random';

/** What a free-text description asked for. */
export interface PromptIntent {
  mode?: Mode;
  palette?: Palette;
  instrument?: Instrument;
  melody?: string;
  lang?: HookLang;
  title?: string;
  minSeconds?: number;
  maxSeconds?: number;
  overrides: Partial<Config>;
  /** Recognised keywords, shown back to the user. */
  tags: string[];
}

/** Lower-case and strip Vietnamese diacritics so "Lớn dần" matches "lon dan". */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/đ/g, 'd').replace(/Đ/g, 'd').toLowerCase();
}

const MODE_WORDS: [Mode, string[]][] = [
  ['infinite', ['vo tan', 'infinite', 'nhan ban', 'hang nghin', 'thousand', 'vo han']],
  ['accumulation', ['accumulation', 'bi dinh', 'dinh gai', 'stuck', 'mac ket']],
  ['collision', ['va nhau', 'va cham', 'collision', 'no tung', 'explode', 'boom', 'hai bong', '2 bong']],
  ['spiral', ['xoan', 'spiral']],
  ['destruction', ['pha vong', 'destruction', 'destroy', 'nhieu vong', 'break the rings']],
  ['grow', ['lon dan', 'to dan', 'grow', 'bigger', 'phong to']],
  ['trail', ['to mau', 'trail', 'paint', 'loang', 've tranh']],
  ['merge', ['gop', 'merge', 'suika']],
  ['koth', ['doi', 'team', 'king of the hill', 'vua', 'ai thang', 'who wins', 'quoc gia', 'country']],
  ['symmetric', ['hon loan', 'butterfly', 'canh buom', 'symmetric', 'doi xung']],
  ['escape', ['thoat', 'escape', 'classic', 'nhan doi']],
];

const PALETTE_WORDS: [string, string[]][] = [
  ['Neon đêm', ['neon', 'dem']],
  ['Trắng tối giản', ['toi gian', 'minimal', 'trang den', 'black and white']],
  ['Hoàng hôn', ['hoang hon', 'sunset']],
  ['Đại dương', ['dai duong', 'ocean', 'bien', 'xanh duong']],
  ['Matrix', ['matrix', 'xanh la', 'hacker']],
  ['Kẹo ngọt', ['keo', 'candy', 'pastel', 'hong']],
  ['Lửa', ['lua', 'fire', 'do cam']],
  ['Băng giá', ['bang gia', 'ice', 'lanh', 'frozen']],
  ['Vàng sang', ['vang', 'gold', 'sang trong', 'luxury']],
  ['Cầu vồng sáng', ['nen sang', 'light mode', 'nen trang']],
];

const INSTRUMENT_WORDS: [Instrument, string[]][] = [
  ['piano', ['piano', 'duong cam']],
  ['bell', ['chuong', 'bell']],
  ['musicbox', ['hop nhac', 'music box']],
  ['harp', ['dan hac', 'harp']],
  ['guitar', ['guitar', 'ghi ta']],
  ['organ', ['organ']],
  ['synth', ['synth', 'dien tu', 'edm']],
  ['chip', ['8-bit', '8 bit', 'chiptune', 'game']],
  ['glass', ['tieng thuy tinh', 'glass sound', 'leng keng']],
  ['marble', ['bi ve', 'marble', 'vien bi']],
  ['wood', ['tieng go', 'wood', 'mo go']],
  ['drop', ['giot nuoc', 'water drop', 'nuoc']],
  ['marimba', ['marimba']],
];

const MELODY_WORDS: [string, string[]][] = [
  ['twinkle', ['twinkle', 'ngoi sao nho', 'lap lanh']],
  ['ode', ['ode to joy', 'beethoven', 'niem vui']],
  ['furelise', ['fur elise', 'elise']],
  ['canon', ['canon', 'pachelbel']],
  ['jingle', ['jingle', 'giang sinh', 'noel', 'christmas']],
  ['greensleeves', ['greensleeves']],
];

const has = (text: string, words: string[]) => words.some((w) => new RegExp(`(^|[^a-z0-9])${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([^a-z0-9]|$)`).test(text));

/**
 * Understands short descriptions in Vietnamese or English, e.g.
 * "bóng lớn dần có gai, màu neon, piano, 30 giây" or
 * "4 teams battle, sunset colours, english, 20-40s".
 */
export function parsePrompt(input: string): PromptIntent {
  const text = normalize(input);
  const intent: PromptIntent = { overrides: {}, tags: [] };
  const o = intent.overrides;
  const tag = (t: string) => intent.tags.push(t);

  const quoted = /["“”«»']([^"“”«»']{3,80})["“”«»']/.exec(input);
  if (quoted) {
    intent.title = quoted[1].trim();
    tag(`tiêu đề "${intent.title}"`);
  }
  const clean = quoted ? text.replace(normalize(quoted[0]), ' ') : text;

  for (const [mode, words] of MODE_WORDS) {
    if (has(clean, words)) {
      intent.mode = mode;
      tag(MODE_INFO[mode].label);
      break;
    }
  }
  for (const [name, words] of PALETTE_WORDS) {
    if (has(clean, words)) {
      intent.palette = PALETTES.find((p) => p.name === name);
      tag(`màu ${name}`);
      break;
    }
  }
  for (const [inst, words] of INSTRUMENT_WORDS) {
    if (has(clean, words)) {
      intent.instrument = inst;
      tag(`nhạc cụ ${inst}`);
      break;
    }
  }
  for (const [key, words] of MELODY_WORDS) {
    if (has(clean, words)) {
      intent.melody = key;
      tag(MELODIES[key].label);
      break;
    }
  }
  if (has(clean, ['english', 'tieng anh', 'in english'])) {
    intent.lang = 'en';
    tag('English');
  } else if (has(clean, ['tieng viet', 'vietnamese'])) {
    intent.lang = 'vi';
  }

  const range = /(\d{1,3})\s*(?:-|–|den|to)\s*(\d{1,3})\s*(?:s|giay|sec|seconds)\b/.exec(clean);
  const single = /(\d{1,3})\s*(?:s|giay|sec|seconds)\b/.exec(clean);
  if (range) {
    intent.minSeconds = Math.min(+range[1], +range[2]);
    intent.maxSeconds = Math.max(+range[1], +range[2]);
    tag(`${intent.minSeconds}–${intent.maxSeconds}s`);
  } else if (single) {
    const v = +single[1];
    intent.minSeconds = Math.max(3, Math.round(v * 0.85));
    intent.maxSeconds = Math.round(v * 1.15) + 1;
    tag(`~${v}s`);
  }

  // "2 quả bóng va chạm nổ 500 bóng": the biggest number is the one that matters.
  const ballNums = [...clean.matchAll(/(\d{1,4})\s*(?:qua\s*)?(?:bong|balls?)\b/g)].map((m) => +m[1]);
  const balls = ballNums.length ? [String(Math.max(...ballNums)), String(Math.max(...ballNums))] : null;
  const teams = /(\d{1,2})\s*(?:doi|teams?)\b/.exec(clean);
  if (teams) {
    const n = Math.max(2, Math.min(16, +teams[1]));
    intent.mode ??= 'koth';
    o.initialBalls = n;
    o.teamNames = ['Red', 'Blue', 'Green', 'Yellow', 'Orange', 'Purple', 'Pink', 'Cyan'].slice(0, Math.min(n, 8)).join(', ');
    tag(`${n} đội`);
  } else if (balls) {
    const n = Math.max(1, Math.min(5000, +balls[1]));
    if (intent.mode === 'collision') o.explodeCount = n;
    else if (intent.mode === 'infinite' || intent.mode === 'escape') o.maxBalls = n;
    else o.initialBalls = n;
    tag(`${n} bóng`);
  }

  const chaos: ChaosEvent[] = [];
  const addChaos = (kind: ChaosEvent['kind'], t: number) => chaos.push({ t, kind, value: CHAOS_KINDS[kind].def });
  if (has(clean, ['gai', 'spike', 'spikes'])) {
    o.spikeArc = 90;
    o.spikeEffect = intent.mode === 'accumulation' ? 'freeze' : 'destroy';
    tag('gai');
  }
  if (has(clean, ['kinh', 'glass'])) {
    o.ringHp = 50;
    tag('vòng kính');
  }
  if (has(clean, ['cong', 'portal', 'portals', 'dich chuyen', 'teleport'])) {
    o.portals = true;
    tag('cổng dịch chuyển');
  }
  if (has(clean, ['nam cham', 'magnet'])) {
    o.magnet = 900;
    tag('nam châm');
  }
  if (has(clean, ['day', 'string', 'strings'])) {
    o.impactLines = 40;
    tag('dây va chạm');
  }
  if (has(clean, ['vat pham', 'power up', 'powerup', 'powerups'])) {
    o.powerups = true;
    tag('vật phẩm');
  }
  if (has(clean, ['dao trong luc', 'dao nguoc', 'gravity flip', 'upside down'])) addChaos('gravityFlip', 10);
  if (has(clean, ['lo den', 'black hole'])) addChaos('blackHole', 15);
  if (has(clean, ['gio', 'wind'])) addChaos('wind', 8);
  if (has(clean, ['bien co', 'bat ngo', 'twist', 'su kien', 'plot twist']) && chaos.length === 0) {
    addChaos('gravityFlip', 8);
    addChaos('blackHole', 16);
    addChaos('speedBurst', 24);
  }
  if (chaos.length) {
    o.chaos = chaos.sort((a, b) => a.t - b.t);
    tag(`${chaos.length} biến cố`);
  }
  const battle4 = has(clean, ['4 dau truong', '4 arenas', '4 man hinh', '2x2']);
  if (battle4 || has(clean, ['dau doi', 'chia man hinh', 'split screen', 'split', 'race', 'vs', 'doi dau'])) {
    o.battle = battle4 ? 4 : 2;
    tag(`đấu ${o.battle} màn`);
  }
  if (has(clean, ['theo nhac', 'beat', 'nhip', 'khop nhac', 'beat sync'])) {
    o.beatSync = true;
    tag('khớp nhịp nhạc');
  }
  return intent;
}
