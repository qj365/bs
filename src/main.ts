import './style.css';
import {
  cloneConfig, DEFAULT_CONFIG, MODE_DEFAULTS, MODE_INFO, parseResolution, sanitizeConfig, VARIANTS, type Config, type Mode,
} from './config';
import { MELODIES } from './audio/melodies';
import { setUserSample, userSampleName } from './audio/synth';
import { formatTime } from './render/hud';
import { computeLayout, SAFE_ZONES } from './sim';
import { pickAudioCodec, pickVideoCodec } from './export/codecs';
import { startExport, type ExportJob } from './export/exporter';
import type { SearchResult } from './search/protocol';
import { findSeedInWindow, startSearch, type SearchJob } from './search/client';
import { modeFinishes, randomConfig, type HookLang, type RandomLocks } from './random';
import { MidiEditor } from './ui/midi-editor';
import { Panel } from './ui/panel';
import { Preview } from './ui/preview';
import { idbGet, idbSet, lsGet, lsSet } from './ui/storage';

const STORAGE_KEY = 'ball-studio-config-v2';
const AUDIO_KEYS = new Set<keyof Config>([
  'sound', 'instrument', 'noteMode', 'melodyName', 'scale', 'baseNote', 'transpose', 'volume', 'reverb',
  'sampleBaseNote', 'minNoteGap', 'ballHitSound', 'sfx',
]);
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSaved(): Config {
  const raw = lsGet(STORAGE_KEY);
  if (raw) {
    try {
      return sanitizeConfig(JSON.parse(raw));
    } catch {
      // Corrupted data: fall back to defaults.
    }
  }
  return cloneConfig(DEFAULT_CONFIG);
}

let cfg = loadSaved();
let saveTimer = 0;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => lsSet(STORAGE_KEY, JSON.stringify(cfg)), 300);
}

// ---------------------------------------------------------------- undo / redo

const history = { stack: [JSON.stringify(cfg)], index: 0, timer: 0 };

function recordHistory(): void {
  clearTimeout(history.timer);
  history.timer = window.setTimeout(() => {
    const snap = JSON.stringify(cfg);
    if (snap === history.stack[history.index]) return;
    history.stack.length = history.index + 1;
    history.stack.push(snap);
    if (history.stack.length > 100) history.stack.shift();
    history.index = history.stack.length - 1;
    updateUndoButtons();
  }, 400);
}

function updateUndoButtons(): void {
  $<HTMLButtonElement>('btn-undo').disabled = history.index <= 0;
  $<HTMLButtonElement>('btn-redo').disabled = history.index >= history.stack.length - 1;
}

async function stepHistory(dir: -1 | 1): Promise<void> {
  clearTimeout(history.timer);
  const next = history.index + dir;
  if (next < 0 || next >= history.stack.length) return;
  history.index = next;
  await replaceConfig(sanitizeConfig(JSON.parse(history.stack[next])), false);
  updateUndoButtons();
}

// ---------------------------------------------------------------- preview

let lastStats = 0;
const preview = new Preview(
  $('canvas-box'),
  () => cfg,
  (t) => {
    const scrub = $<HTMLInputElement>('scrub');
    if (!scrubbing) {
      scrub.max = String(cfg.duration);
      scrub.value = String(t.time);
    }
    $('btn-play').textContent = t.playing ? '⏸' : '▶';
    const now = performance.now();
    if (now - lastStats > 250) {
      lastStats = now;
      $('time-label').textContent = `${formatTime(t.time)} / ${formatTime(t.end)}`;
      const done = t.stats.finished ? ` · ✅ kết thúc ở ${t.stats.finishTime.toFixed(1)}s` : '';
      $('stats').textContent = `${t.stats.alive} bóng · ${t.fps.toFixed(0)} fps${done}`;
      $('renderer-badge').textContent = `Vẽ: ${t.renderer.toUpperCase()}`;
    }
  },
  (msg) => toast(msg),
);

let restartTimer = 0;
function scheduleRestart(): void {
  clearTimeout(restartTimer);
  restartTimer = window.setTimeout(() => void preview.restart().then(updateSafeOverlay), 120);
}

async function userAction(fn: () => Promise<void> | void): Promise<void> {
  await preview.ensureAudio();
  $('audio-hint').hidden = true;
  await fn();
}

$('btn-play').addEventListener('click', () => void userAction(() => preview.togglePlay()));
$('btn-restart').addEventListener('click', () => void userAction(restartAndPlay));

async function restartAndPlay(): Promise<void> {
  await preview.restart();
  preview.setPlaying(true);
}

let scrubbing = false;
const scrub = $<HTMLInputElement>('scrub');
scrub.addEventListener('pointerdown', () => {
  scrubbing = true;
  preview.setPlaying(false);
});
scrub.addEventListener('input', () => void preview.seek(Number(scrub.value)));
scrub.addEventListener('change', () => (scrubbing = false));
scrub.addEventListener('pointerup', () => (scrubbing = false));

async function setSeed(seed: number): Promise<void> {
  cfg.seed = Math.max(0, Math.floor(seed));
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  save();
  recordHistory();
  await userAction(restartAndPlay);
}

$('seed-prev').addEventListener('click', () => void setSeed(cfg.seed - 1));
$('seed-next').addEventListener('click', () => void setSeed(cfg.seed + 1));
$('btn-seed').addEventListener('click', () => void setSeed(Math.floor(Math.random() * 1_000_000)));
$<HTMLInputElement>('seed-input').addEventListener('change', (e) => void setSeed(Number((e.target as HTMLInputElement).value) || 0));

function updateSafeOverlay(): void {
  const el = $('safe-overlay');
  const layout = computeLayout(cfg);
  const portrait = layout.H > layout.W * 1.2;
  el.hidden = !cfg.showSafeZone || !portrait;
  if (el.hidden) return;
  // Show the zone being targeted, or the TikTok one as a guide when none is chosen.
  const z = cfg.safeZone === 'none' ? SAFE_ZONES.tiktok : SAFE_ZONES[cfg.safeZone];
  const pct = (v: number, of: number) => `${(v / of) * 100}%`;
  (el.querySelector('.sz-top') as HTMLElement).style.height = pct(z.top, layout.H);
  (el.querySelector('.sz-bottom') as HTMLElement).style.height = pct(z.bottom, layout.H);
  (el.querySelector('.sz-left') as HTMLElement).style.width = pct(z.left, layout.W);
  (el.querySelector('.sz-right') as HTMLElement).style.width = pct(z.right, layout.W);
}

// ---------------------------------------------------------------- modes & variants

function buildModeGrid(): void {
  const grid = $('mode-grid');
  grid.innerHTML = '';
  for (const [mode, info] of Object.entries(MODE_INFO) as [Mode, (typeof MODE_INFO)[Mode]][]) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'mode-card' + (cfg.mode === mode ? ' active' : '');
    b.dataset.mode = mode;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(cfg.mode === mode));
    b.title = info.desc;
    b.innerHTML = `<span class="icon">${info.icon}</span><span class="name">${info.label}</span><span class="desc">${info.desc}</span>`;
    b.addEventListener('click', () => void applyPreset(mode, {}));
    grid.append(b);
  }
  const variants = $('variants');
  variants.innerHTML = '';
  const list = [{ id: 'default', label: 'Mặc định', overrides: {} }, ...VARIANTS.filter((v) => v.mode === cfg.mode)];
  for (const v of list) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.dataset.variant = v.id;
    chip.textContent = v.label;
    chip.addEventListener('click', () => void applyPreset(cfg.mode, v.overrides));
    variants.append(chip);
  }
}

async function applyPreset(mode: Mode, overrides: Partial<Config>): Promise<void> {
  cfg.mode = mode;
  Object.assign(cfg, MODE_DEFAULTS[mode], overrides);
  buildModeGrid();
  panel.refresh();
  save();
  recordHistory();
  await userAction(restartAndPlay);
}

// ---------------------------------------------------------------- settings panel

const midiEditor = new MidiEditor();

function currentMelody(): number[][] {
  if (cfg.melodyName === 'custom' && cfg.melody.length > 0) return cfg.melody;
  return (MELODIES[cfg.melodyName] ?? MELODIES.ode).notes;
}

const panel = new Panel($('panel'), cfg, {
  onChange(key, live) {
    save();
    recordHistory();
    if (key === 'showSafeZone' || key === 'safeZone' || key === 'resolution') updateSafeOverlay();
    if (live) {
      if (AUDIO_KEYS.has(key)) void preview.resetAudio();
      updateInfo();
      if (key === 'encoder') void showCodecSupport();
      return;
    }
    if (key === 'resolution') void showCodecSupport();
    scheduleRestart();
  },
  onAction(name) {
    if (name === 'editor') {
      midiEditor.open(cfg, currentMelody(), (melody) => {
        cfg.melody = melody;
        cfg.melodyName = 'custom';
        cfg.noteMode = 'melody';
        panel.refresh();
        save();
        recordHistory();
        void preview.resetAudio();
        toast(`Đã dùng giai điệu ${melody.length} nốt`);
      });
    } else if (name === 'sample') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        if (f.size > 20 * 1024 * 1024) {
          toast('File quá lớn (tối đa 20 MB).');
          return;
        }
        const data = await f.arrayBuffer();
        setUserSample(f.name, data);
        void idbSet('sample', { name: f.name, data });
        cfg.instrument = 'sample';
        panel.refresh();
        save();
        await preview.resetAudio();
        toast(`Đã nạp "${f.name}" làm nhạc cụ`);
      });
      input.click();
    }
  },
  actionInfo(name) {
    if (name === 'sample') return userSampleName() ? `Đang dùng: ${userSampleName()}` : 'Chưa có file';
    if (name === 'editor') return cfg.melodyName === 'custom' && cfg.melody.length ? `${cfg.melody.length} nốt` : '';
    return '';
  },
});

const filter = $<HTMLInputElement>('settings-filter');
filter.addEventListener('input', () => panel.setFilter(filter.value));

async function replaceConfig(next: Config, record = true): Promise<void> {
  cfg = next;
  panel.setConfig(cfg);
  buildModeGrid();
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  save();
  if (record) recordHistory();
  updateInfo();
  updateSafeOverlay();
  await preview.restart();
  await preview.resetAudio();
}

$('btn-undo').addEventListener('click', () => void stepHistory(-1));
$('btn-redo').addEventListener('click', () => void stepHistory(1));

$('btn-save').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' });
  download(blob, `preset-${cfg.mode}-${cfg.seed}.json`);
});

$<HTMLInputElement>('file-preset').addEventListener('change', async (ev) => {
  const input = ev.target as HTMLInputElement;
  const f = input.files?.[0];
  input.value = '';
  if (!f) return;
  try {
    await replaceConfig(sanitizeConfig(JSON.parse(await f.text())));
    toast(`Đã mở preset "${f.name}"`);
  } catch {
    toast('File preset không hợp lệ.');
  }
});

$('btn-reset').addEventListener('click', () => {
  const next = cloneConfig(DEFAULT_CONFIG);
  next.mode = cfg.mode;
  Object.assign(next, MODE_DEFAULTS[cfg.mode]);
  void replaceConfig(next);
});

const help = $<HTMLDialogElement>('help-dialog');
$('btn-help').addEventListener('click', () => help.showModal());

// ---------------------------------------------------------------- export

let job: ExportJob | null = null;
let cancelled = false;

function updateInfo(): void {
  const { width, height } = parseResolution(cfg.resolution);
  const mb = (cfg.bitrate * cfg.duration) / 8;
  $('export-info').textContent =
    `${width}×${height} · ${cfg.fps}fps · tối đa ${cfg.duration}s · ${cfg.bitrate} Mbps (≤ ~${mb.toFixed(0)} MB) · ` +
    `vẽ ${cfg.renderer.toUpperCase()} · mã hóa ${cfg.encoder.toUpperCase()}`;
}

async function runExport(over: Partial<Config>, label: string, prefix: string): Promise<boolean> {
  const c = { ...cloneConfig(cfg), ...over };
  const bar = $<HTMLProgressElement>('export-bar');
  const status = $('export-status');
  job = startExport(c, (p) => {
    bar.max = p.total;
    bar.value = p.frame;
    const pct = Math.round((p.frame / p.total) * 100);
    status.textContent = `${prefix}${p.status}${p.fps ? ` · ${pct}% · ${p.fps.toFixed(0)} khung/giây` : ''}`;
  });
  try {
    const r = await job.promise;
    const name = `ball-${c.mode}-seed${c.seed}${label}.mp4`;
    download(r.blob, name);
    const speed = r.duration / r.seconds;
    status.textContent = `${prefix}✅ ${name}: ${r.duration.toFixed(1)}s video trong ${r.seconds.toFixed(1)}s (×${speed.toFixed(1)} thời gian thực) · ${(r.blob.size / 1e6).toFixed(1)} MB · ${r.video}${r.audio ? ' + ' + r.audio : ''}`;
    return true;
  } catch (err) {
    status.textContent = `${prefix}❌ ${err instanceof Error ? err.message : String(err)}`;
    return false;
  } finally {
    job = null;
  }
}

const EXPORT_BUTTONS = ['btn-export', 'btn-dual', 'btn-batch', 'btn-random-batch'];

async function exporting(fn: () => Promise<void>): Promise<void> {
  cancelled = false;
  for (const id of EXPORT_BUTTONS) $<HTMLButtonElement>(id).disabled = true;
  $<HTMLButtonElement>('btn-cancel').hidden = false;
  try {
    await fn();
  } finally {
    for (const id of EXPORT_BUTTONS) $<HTMLButtonElement>(id).disabled = false;
    $<HTMLButtonElement>('btn-cancel').hidden = true;
  }
}

$('btn-export').addEventListener('click', () => void exporting(async () => void (await runExport({}, '', ''))));

$('btn-dual').addEventListener('click', () =>
  void exporting(async () => {
    if (!(await runExport({ safeZone: 'tiktok' }, '-tiktok', '[1/2 TikTok] '))) return;
    if (!cancelled) await runExport({ safeZone: 'shorts' }, '-shorts', '[2/2 Shorts] ');
  }),
);

$('btn-batch').addEventListener('click', () =>
  void exporting(async () => {
    const n = Math.max(1, Math.min(50, Number($<HTMLInputElement>('batch-count').value) || 1));
    for (let i = 0; i < n && !cancelled; i++) {
      if (!(await runExport({ seed: cfg.seed + i }, '', `[${i + 1}/${n}] `))) break;
    }
  }),
);

$('btn-cancel').addEventListener('click', () => {
  cancelled = true;
  job?.cancel();
});

// ---------------------------------------------------------------- seed search

let searchJob: SearchJob | null = null;

function renderResults(results: SearchResult[]): void {
  const list = $('search-results');
  list.innerHTML = '';
  for (const r of results) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'result';
    btn.dataset.seed = String(r.seed);
    btn.innerHTML = `<b>Seed ${r.seed}</b> · kết thúc ${r.finishTime.toFixed(2)}s · ${r.notes} nốt <span class="hint">lệch ${r.error.toFixed(2)}</span>`;
    btn.addEventListener('click', () => void setSeed(r.seed));
    li.append(btn);
    list.append(li);
  }
}

$<HTMLSelectElement>('search-kind').addEventListener('change', (e) => {
  const kind = (e.target as HTMLSelectElement).value;
  $<HTMLInputElement>('search-value').value = kind === 'notes' ? String(currentMelody().length) : String(cfg.duration);
});

$('btn-search').addEventListener('click', async () => {
  searchJob?.stop();
  const kind = $<HTMLSelectElement>('search-kind').value as 'duration' | 'notes';
  const value = Number($<HTMLInputElement>('search-value').value) || 30;
  const count = Math.max(10, Math.min(20000, Number($<HTMLInputElement>('search-count').value) || 500));
  const bar = $<HTMLProgressElement>('search-bar');
  const status = $('search-status');
  $<HTMLButtonElement>('btn-search').disabled = true;
  $<HTMLButtonElement>('btn-search-stop').hidden = false;
  status.textContent = 'Đang tìm…';
  renderResults([]);
  const job = startSearch(cfg, { kind, value }, cfg.seed, count, (p) => {
    bar.max = p.total;
    bar.value = p.done;
    status.textContent = `Đã thử ${p.done}/${p.total} seed · ${p.rate.toFixed(0)} seed/giây`;
    renderResults(p.results);
  });
  searchJob = job;
  try {
    const results = await job.promise;
    status.textContent = results.length
      ? `Xong. Bấm một kết quả để xem. Tốt nhất: seed ${results[0].seed} (lệch ${results[0].error.toFixed(2)}).`
      : 'Không seed nào kết thúc trong khoảng thời gian này — thử chỉnh thông số hoặc tăng số seed.';
    renderResults(results);
  } catch (err) {
    status.textContent = `Lỗi: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    $<HTMLButtonElement>('btn-search').disabled = false;
    $<HTMLButtonElement>('btn-search-stop').hidden = true;
  }
});

$('btn-search-stop').addEventListener('click', () => searchJob?.stop());

// ---------------------------------------------------------------- random videos

const LOCKS_KEY = 'ball-studio-random-v1';
const lockIds = { mode: 'lock-mode', look: 'lock-look', audio: 'lock-audio', text: 'lock-text' } as const;

(() => {
  try {
    const saved = JSON.parse(lsGet(LOCKS_KEY) ?? '{}') as Record<string, unknown>;
    for (const [k, id] of Object.entries(lockIds)) $<HTMLInputElement>(id).checked = saved[k] === true;
    if (saved.lang === 'en') $<HTMLSelectElement>('rand-lang').value = 'en';
    if (typeof saved.min === 'number') $<HTMLInputElement>('rand-min').value = String(saved.min);
    if (typeof saved.max === 'number') $<HTMLInputElement>('rand-max').value = String(saved.max);
  } catch {
    // Ignore bad saved options.
  }
})();

function randomOptions(): { locks: RandomLocks; lang: HookLang; min: number; max: number } {
  const locks = Object.fromEntries(
    Object.entries(lockIds).map(([k, id]) => [k, $<HTMLInputElement>(id).checked]),
  ) as unknown as RandomLocks;
  const lang = $<HTMLSelectElement>('rand-lang').value === 'en' ? 'en' : 'vi';
  let min = Math.max(3, Number($<HTMLInputElement>('rand-min').value) || 15);
  let max = Math.max(min + 1, Number($<HTMLInputElement>('rand-max').value) || 40);
  max = Math.min(max, 600);
  min = Math.min(min, max - 1);
  lsSet(LOCKS_KEY, JSON.stringify({ ...locks, lang, min, max }));
  return { locks, lang, min, max };
}

/**
 * Picks a random configuration and, for modes that end on their own, searches for a
 * seed that ends inside the requested length (trying a few configurations if needed).
 * The video length is then set to just past that ending.
 */
async function makeRandom(status: (text: string) => void): Promise<string> {
  const { locks, lang, min, max } = randomOptions();
  let last = randomConfig(cfg, locks, lang);
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = attempt === 1 ? last : randomConfig(cfg, locks, lang);
    last = res;
    const next = res.cfg;
    if (!modeFinishes(next)) {
      next.duration = Math.round(min + Math.random() * (max - min));
      next.stopOnFinish = true;
      await replaceConfig(next);
      return `${res.summary} · ${next.duration}s`;
    }
    status(`🎲 Lần ${attempt}: ${res.summary} — đang tìm seed kết thúc trong ${min}–${max}s…`);
    const hit = await findSeedInWindow(next, min, max, 80);
    if (hit) {
      next.seed = hit.seed;
      next.stopOnFinish = true;
      next.duration = Math.min(600, Math.ceil(hit.finishTime + next.endHold + 1));
      await replaceConfig(next);
      return `${res.summary} · seed ${hit.seed} · kết thúc ${hit.finishTime.toFixed(1)}s`;
    }
  }
  // Nothing landed in the window: keep the last pick and simply cap its length.
  last.cfg.duration = max;
  await replaceConfig(last.cfg);
  return `${last.summary} · (không tìm được seed kết thúc trong ${min}–${max}s, video dài ${max}s)`;
}

let randomBusy = false;
async function randomize(): Promise<void> {
  if (randomBusy) return;
  randomBusy = true;
  $<HTMLButtonElement>('btn-random').disabled = true;
  const status = $('random-status');
  try {
    await preview.ensureAudio();
    $('audio-hint').hidden = true;
    const summary = await makeRandom((t) => (status.textContent = t));
    preview.setPlaying(true);
    status.textContent = `✅ ${summary}`;
  } catch (err) {
    status.textContent = `❌ ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    randomBusy = false;
    $<HTMLButtonElement>('btn-random').disabled = false;
  }
}

$('btn-random').addEventListener('click', () => void randomize());

$('btn-random-batch').addEventListener('click', () =>
  void exporting(async () => {
    const n = Math.max(1, Math.min(50, Number($<HTMLInputElement>('random-count').value) || 1));
    const status = $('random-status');
    $<HTMLButtonElement>('btn-random').disabled = true;
    try {
      for (let i = 0; i < n && !cancelled; i++) {
        const summary = await makeRandom((t) => (status.textContent = `[${i + 1}/${n}] ${t}`));
        status.textContent = `[${i + 1}/${n}] ${summary}`;
        if (!(await runExport({}, `-random${i + 1}`, `[${i + 1}/${n}] `))) break;
      }
    } finally {
      $<HTMLButtonElement>('btn-random').disabled = false;
    }
  }),
);

// ---------------------------------------------------------------- keyboard

document.addEventListener('keydown', (e) => {
  const target = e.target as HTMLElement;
  const typing = target.closest('input, textarea, select, [contenteditable]') && !(target instanceof HTMLInputElement && target.type === 'range');
  if ((e.ctrlKey || e.metaKey) && !typing) {
    if (e.key.toLowerCase() === 'z') {
      e.preventDefault();
      void stepHistory(e.shiftKey ? 1 : -1);
    } else if (e.key.toLowerCase() === 'y') {
      e.preventDefault();
      void stepHistory(1);
    }
    return;
  }
  if (typing || e.altKey || e.ctrlKey || e.metaKey || document.querySelector('dialog[open]')) return;
  switch (e.key) {
    case ' ':
      e.preventDefault();
      void userAction(() => preview.togglePlay());
      break;
    case 'r':
    case 'R':
      void userAction(restartAndPlay);
      break;
    case 'ArrowRight':
      void setSeed(cfg.seed + 1);
      break;
    case 'ArrowLeft':
      void setSeed(cfg.seed - 1);
      break;
    case 'n':
    case 'N':
      void setSeed(Math.floor(Math.random() * 1_000_000));
      break;
    case '.':
      void preview.seek(preview.time + 1);
      break;
    case ',':
      void preview.seek(preview.time - 1);
      break;
    case 'g':
    case 'G':
      void randomize();
      break;
    case 'e':
    case 'E':
      $('btn-export').click();
      break;
    case '/':
      e.preventDefault();
      filter.focus();
      break;
  }
});

// ---------------------------------------------------------------- helpers

function download(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

let toastTimer = 0;
function toast(text: string): void {
  const el = $('toast');
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (el.hidden = true), 3500);
}

async function showCodecSupport(): Promise<void> {
  const el = $('codec-status');
  const { width, height } = parseResolution(cfg.resolution);
  const v = await pickVideoCodec(width, height, cfg.fps, cfg.bitrate * 1e6, cfg.encoder);
  const a = await pickAudioCodec(48000);
  el.textContent = v
    ? `Video: ${v.label} · Âm thanh: ${a?.label ?? 'không hỗ trợ'}`
    : cfg.encoder === 'auto'
      ? 'Trình duyệt này không xuất được video — hãy dùng Chrome/Edge bản mới'
      : `Không có bộ mã hóa ${cfg.encoder.toUpperCase()} cho cấu hình này`;
  el.classList.toggle('bad', !v);
}

// Read-only hooks for automated tests.
(window as unknown as { __studio: unknown }).__studio = {
  config: () => cloneConfig(cfg),
  time: () => preview.time,
  renderer: () => preview.rendererKind,
  playing: () => preview.isPlaying,
};

async function boot(): Promise<void> {
  const saved = await idbGet<{ name: string; data: ArrayBuffer }>('sample');
  if (saved?.data) setUserSample(saved.name, saved.data);
  buildModeGrid();
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  panel.refresh();
  updateUndoButtons();
  updateInfo();
  updateSafeOverlay();
  void showCodecSupport();
  await preview.restart();
  document.body.dataset.ready = 'true';
}

void boot();
