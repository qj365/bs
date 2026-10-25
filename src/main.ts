import './style.css';
import {
  cloneConfig, DEFAULT_CONFIG, MODE_DEFAULTS, MODE_INFO, parseResolution, sanitizeConfig, VARIANTS, type Config, type Mode,
} from './config';
import { MELODIES } from './audio/melodies';
import { musicName, setMusic, setUserSample, userSampleName } from './audio/synth';
import { formatTime } from './render/hud';
import { computeLayout, SAFE_ZONES } from './sim';
import { pickAudioCodec, pickVideoCodec } from './export/codecs';
import { startExport, type ExportJob } from './export/exporter';
import type { ExportPlan } from './export/protocol';
import type { SearchResult } from './search/protocol';
import { findLoopInWorker, findSeedInWindow, startSearch, type SearchJob } from './search/client';
import { modeFinishes, randomConfig, type HookLang, type RandomLocks, type RandomResult } from './random';
import { Scene } from './scene';
import { unwarpTime, warpTime, type Warp } from './sync';
import { analyzeMusic, computeBeatWarp, type MusicAnalysis } from './viral/beatsync';
import { makeCaption } from './viral/caption';
import { abVariants, coverTime, partPlans, probeFinish, type ABKind } from './viral/plans';
import { parsePrompt } from './viral/prompt';
import { ChaosEditor } from './ui/chaos-editor';
import { MidiEditor } from './ui/midi-editor';
import { Panel } from './ui/panel';
import { Preview } from './ui/preview';
import { idbGet, idbSet, lsGet, lsSet } from './ui/storage';

const STORAGE_KEY = 'ball-studio-config-v2';
const AUDIO_KEYS = new Set<keyof Config>([
  'sound', 'instrument', 'noteMode', 'melodyName', 'scale', 'baseNote', 'transpose', 'volume', 'reverb',
  'sampleBaseNote', 'minNoteGap', 'ballHitSound', 'sfx', 'stereo', 'musicVolume',
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
      const who = t.stats.winner >= 0 ? ` · 🏆 ${String.fromCharCode(65 + t.stats.winner)}` : '';
      const done = t.stats.finished ? ` · ✅ kết thúc ở ${unwarpTime(warp, t.stats.finishTime).toFixed(1)}s${who}` : '';
      $('stats').textContent = `${t.stats.alive} bóng · ${t.fps.toFixed(0)} fps${done}`;
      $('renderer-badge').textContent = `Vẽ: ${t.renderer.toUpperCase()}`;
    }
  },
  (msg) => toast(msg),
);

// ---------------------------------------------------------------- music & beat sync

let music: MusicAnalysis | null = null;
let warp: Warp | null = null;
let beatInfo = '';

/** Recomputes the beat-sync warp for the current settings and hands it to the preview. */
async function updateTiming(): Promise<void> {
  warp = null;
  beatInfo = '';
  if (music && cfg.beatSync) {
    const bw = await computeBeatWarp(cfg, music);
    if (bw && bw.matched > 0) {
      warp = bw.warp;
      beatInfo = `khớp ${bw.matched}/${bw.considered} nhịp (mỗi ${bw.stride} nhịp)`;
    }
  }
  preview.setTiming(warp, music && cfg.beatSync ? music.duration : Infinity);
  panel?.refreshInfo();
}

async function restartPreview(): Promise<void> {
  await updateTiming();
  await preview.restart();
  updateSafeOverlay();
}

let restartTimer = 0;
function scheduleRestart(): void {
  clearTimeout(restartTimer);
  restartTimer = window.setTimeout(() => void restartPreview(), 120);
}

async function userAction(fn: () => Promise<void> | void): Promise<void> {
  await preview.ensureAudio();
  $('audio-hint').hidden = true;
  await fn();
}

$('btn-play').addEventListener('click', () => void userAction(() => preview.togglePlay()));
$('btn-restart').addEventListener('click', () => void userAction(restartAndPlay));

async function restartAndPlay(): Promise<void> {
  await restartPreview();
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
const chaosEditor = new ChaosEditor();

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
    } else if (name === 'chaos') {
      chaosEditor.open(cfg, (events) => {
        cfg.chaos = events;
        panel.refresh();
        save();
        recordHistory();
        scheduleRestart();
        toast(events.length ? `Đã lưu ${events.length} biến cố` : 'Đã xóa biến cố');
      });
    } else if (name === 'music') {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'audio/*';
      input.addEventListener('change', async () => {
        const f = input.files?.[0];
        if (!f) return;
        if (f.size > 40 * 1024 * 1024) {
          toast('File nhạc quá lớn (tối đa 40 MB).');
          return;
        }
        try {
          await loadMusic(f.name, await f.arrayBuffer(), true);
          toast(`Đã nạp "${f.name}" · ${music!.bpm.toFixed(0)} BPM`);
        } catch {
          toast('Không đọc được file nhạc.');
        }
      });
      input.click();
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
    if (name === 'chaos') return cfg.chaos.length ? `${cfg.chaos.length} biến cố` : 'Chưa có';
    if (name === 'music') {
      if (!music) return 'Chưa có nhạc nền';
      return `${musicName()} · ${music.bpm.toFixed(0)} BPM · ${music.duration.toFixed(0)}s${beatInfo ? ' · ' + beatInfo : ''}`;
    }
    return '';
  },
});

async function loadMusic(name: string, data: ArrayBuffer, persist: boolean): Promise<void> {
  music = await analyzeMusic(data);
  setMusic(name, data);
  if (persist) void idbSet('music', { name, data });
  await restartPreview();
  await preview.resetAudio();
}

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
  await restartPreview();
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

function captionLang(): HookLang {
  return $<HTMLSelectElement>('rand-lang').value === 'en' ? 'en' : 'vi';
}

async function runExport(over: Partial<Config>, label: string, prefix: string, plan: ExportPlan = {}): Promise<boolean> {
  const c = { ...cloneConfig(cfg), ...over };
  const bar = $<HTMLProgressElement>('export-bar');
  const status = $('export-status');
  const ep: ExportPlan = { ...plan, music: music !== null };
  if (ep.warp === undefined && warp && c.beatSync && !ep.crossfade) ep.warp = warp;
  if (c.beatSync && music && ep.end === undefined) ep.end = Math.min(c.duration, music.duration);
  if (c.exportCover && ep.coverAt === undefined) {
    const finish = await probeFinish(c, ep.warp ?? null);
    const len = (ep.end ?? c.duration) - (ep.start ?? 0);
    ep.coverAt = Math.max(0, Math.min(len - 0.05, coverTime(finish, c.duration) - (ep.start ?? 0)));
  }
  job = startExport(c, ep, (p) => {
    bar.max = p.total;
    bar.value = p.frame;
    const pct = Math.round((p.frame / p.total) * 100);
    status.textContent = `${prefix}${p.status}${p.fps ? ` · ${pct}% · ${p.fps.toFixed(0)} khung/giây` : ''}`;
  });
  try {
    const r = await job.promise;
    const base = `ball-${c.mode}-seed${c.seed}${label}`;
    const name = `${base}.mp4`;
    download(r.blob, name);
    if (c.exportCaption) download(new Blob([makeCaption(c, captionLang())], { type: 'text/plain' }), `${base}.txt`);
    if (c.exportCover && r.cover) download(r.cover, `${base}.png`);
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

const EXPORT_BUTTONS = ['btn-export', 'btn-dual', 'btn-batch', 'btn-random-batch', 'btn-parts', 'btn-ab', 'btn-loop-export', 'btn-prompt'];

async function exporting(fn: () => Promise<void>): Promise<void> {
  cancelled = false;
  for (const id of EXPORT_BUTTONS) $<HTMLButtonElement>(id).disabled = true;
  $<HTMLButtonElement>('btn-cancel').hidden = false;
  preview.setSuspended(true);
  try {
    await fn();
  } finally {
    preview.setSuspended(false);
    for (const id of EXPORT_BUTTONS) $<HTMLButtonElement>(id).disabled = false;
    $<HTMLButtonElement>('btn-loop-export').disabled = !loopFound;
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
  return settle(() => randomConfig(cfg, locks, lang), min, max, status);
}

/** Tries generated configurations until one ends inside [min, max] seconds, then applies it. */
async function settle(generate: () => RandomResult, min: number, max: number, status: (text: string) => void): Promise<string> {
  let last = generate();
  for (let attempt = 1; attempt <= 6; attempt++) {
    const res = attempt === 1 ? last : generate();
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

// ---------------------------------------------------------------- viral tools

function viralStatus(text: string): void {
  $('viral-status').textContent = text;
}

// Describe the video in words.
$('btn-prompt').addEventListener('click', async () => {
  const text = $<HTMLTextAreaElement>('prompt-text').value.trim();
  if (!text) {
    toast('Hãy gõ mô tả video, ví dụ: "bóng lớn dần có gai, màu neon, piano, 30 giây"');
    return;
  }
  const intent = parsePrompt(text);
  $('prompt-tags').textContent = intent.tags.length ? `Hiểu: ${intent.tags.join(' · ')}` : 'Không nhận ra từ khóa nào — tạo ngẫu nhiên.';
  const opts = randomOptions();
  const lang = intent.lang ?? opts.lang;
  const min = intent.minSeconds ?? opts.min;
  const max = intent.maxSeconds ?? opts.max;
  const generate = (): RandomResult => {
    const base = cloneConfig(cfg);
    if (intent.mode) {
      base.mode = intent.mode;
      Object.assign(base, MODE_DEFAULTS[intent.mode]);
    }
    const res = randomConfig(base, {
      mode: !!intent.mode, look: !!intent.palette, audio: !!(intent.instrument || intent.melody), text: false,
    }, lang);
    const c = res.cfg;
    if (intent.palette) {
      const p = intent.palette;
      Object.assign(c, { bgColor: p.bg, ringColor: p.ring, ballColor: p.ball, ringRainbow: p.ringRainbow, textColor: p.text, colorMode: p.colorMode });
    }
    if (intent.instrument) c.instrument = intent.instrument;
    if (intent.melody) {
      c.noteMode = 'melody';
      c.melodyName = intent.melody;
    }
    Object.assign(c, intent.overrides);
    if (intent.title) c.title = intent.title;
    return res;
  };
  await userAction(async () => {
    const st = $('random-status');
    try {
      const summary = await settle(generate, min, max, (t) => (st.textContent = t));
      preview.setPlaying(true);
      st.textContent = `✅ ${summary}`;
    } catch (err) {
      st.textContent = `❌ ${err instanceof Error ? err.message : String(err)}`;
    }
  });
});

// Most dramatic seed.
let dramaJob: SearchJob | null = null;
$('btn-drama').addEventListener('click', async () => {
  dramaJob?.stop();
  const min = Math.max(3, Number($<HTMLInputElement>('drama-min').value) || 15);
  const max = Math.max(min + 1, Number($<HTMLInputElement>('drama-max').value) || 40);
  const count = Math.max(10, Math.min(5000, Number($<HTMLInputElement>('drama-count').value) || 300));
  const status = $('drama-status');
  const list = $('drama-results');
  const btn = $<HTMLButtonElement>('btn-drama');
  btn.disabled = true;
  const render = (results: SearchResult[]) => {
    list.innerHTML = '';
    for (const r of results.slice(0, 5)) {
      const li = document.createElement('li');
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'result';
      b.dataset.seed = String(r.seed);
      b.innerHTML = `<b>Seed ${r.seed}</b> · điểm ${r.score?.toFixed(1)} · ${r.finishTime.toFixed(1)}s <span class="hint">${(r.why ?? []).join(', ')}</span>`;
      b.addEventListener('click', async () => {
        cfg.duration = Math.min(600, Math.ceil(r.finishTime + cfg.endHold + 1));
        panel.refresh();
        await setSeed(r.seed);
      });
      li.append(b);
      list.append(li);
    }
  };
  const job = startSearch(cfg, { kind: 'drama', value: (min + max) / 2, min, max }, cfg.seed, count, (p) => {
    status.textContent = `Đang chấm điểm ${p.done}/${p.total} seed · ${p.rate.toFixed(0)} seed/giây`;
    render(p.results);
  });
  dramaJob = job;
  try {
    const results = await job.promise;
    render(results);
    status.textContent = results.length
      ? `Xong. Top ${Math.min(5, results.length)} video kịch tính nhất — bấm để xem.`
      : 'Không có seed nào kết thúc trong khoảng này.';
  } catch (err) {
    status.textContent = `Lỗi: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    btn.disabled = false;
  }
});

// Seamless loops.
let loopFound: { start: number; end: number; error: number } | null = null;
$('btn-loop').addEventListener('click', async () => {
  if (cfg.battle > 1) {
    $('loop-status').textContent = 'Video lặp chưa hỗ trợ chế độ chia màn hình.';
    return;
  }
  const min = Math.max(2, Number($<HTMLInputElement>('loop-min').value) || 6);
  const max = Math.max(min + 1, Number($<HTMLInputElement>('loop-max').value) || 15);
  const btn = $<HTMLButtonElement>('btn-loop');
  btn.disabled = true;
  $('loop-status').textContent = 'Đang tìm đoạn có khung đầu và cuối giống nhau nhất…';
  try {
    loopFound = await findLoopInWorker(cfg, min, max);
    if (!loopFound) {
      $('loop-status').textContent = 'Không tìm được đoạn lặp (số bóng thay đổi liên tục?). Thử chế độ ít bóng hoặc vòng kín.';
    } else {
      const q = loopFound.error < 8 ? 'rất mượt' : loopFound.error < 25 ? 'khá mượt' : 'hơi giật — thử seed khác';
      $('loop-status').textContent =
        `Đoạn ${loopFound.start.toFixed(2)}s → ${loopFound.end.toFixed(2)}s (dài ${(loopFound.end - loopFound.start).toFixed(1)}s) · lệch ${loopFound.error}px · ${q}`;
      await userAction(async () => {
        await preview.seek(loopFound!.start);
        preview.setPlaying(true);
      });
    }
  } catch (err) {
    $('loop-status').textContent = `Lỗi: ${err instanceof Error ? err.message : String(err)}`;
  } finally {
    btn.disabled = false;
    $<HTMLButtonElement>('btn-loop-export').disabled = !loopFound;
  }
});

$('btn-loop-export').addEventListener('click', () =>
  void exporting(async () => {
    if (!loopFound) return;
    await runExport(
      { showCounter: false, showTimer: false, paintTrail: false, beatSync: false, stopOnFinish: false },
      '-loop', '[Lặp] ',
      { start: loopFound.start, end: loopFound.end, crossfade: 0.3, warp: [] },
    );
  }),
);

// Part 1 / Part 2.
$('btn-parts').addEventListener('click', () =>
  void exporting(async () => {
    viralStatus('Đang tìm khoảnh khắc quyết định…');
    const finish = await probeFinish(cfg, warp);
    const plans = partPlans(finish, cfg.duration, cfg.endHold, captionLang(), warp);
    viralStatus(`Cắt ở ${plans.cut.toFixed(1)}s${finish > 0 ? ` (trước đoạn kết ở ${finish.toFixed(1)}s)` : ''}`);
    if (!(await runExport({}, '-part1', '[Phần 1] ', plans.part1))) return;
    if (!cancelled) await runExport({}, '-part2', '[Phần 2] ', plans.part2);
  }),
);

// A/B variants.
$('btn-ab').addEventListener('click', () =>
  void exporting(async () => {
    const kind = $<HTMLSelectElement>('ab-kind').value as ABKind;
    const count = Number($<HTMLSelectElement>('ab-count').value) || 2;
    const variants = abVariants(cfg, kind, count, captionLang());
    for (const v of variants) {
      if (cancelled) break;
      if (!(await runExport(v.cfg, `-${v.label}`, `[A/B ${v.label}] `))) break;
    }
  }),
);

// Caption and cover.
$('btn-caption').addEventListener('click', async () => {
  const text = makeCaption(cfg, captionLang());
  try {
    await navigator.clipboard.writeText(text);
    toast('Đã sao chép caption + hashtag');
  } catch {
    $<HTMLTextAreaElement>('prompt-text').value = text;
    toast('Không truy cập được clipboard — caption đã được đặt vào ô mô tả.');
  }
  viralStatus(text.replace(/\n+/g, ' · '));
});

$('btn-cover').addEventListener('click', async () => {
  viralStatus('Đang dựng ảnh bìa độ phân giải gốc…');
  const c = cloneConfig(cfg);
  const scene = await Scene.create(c, c.renderer, (w, h) => new OffscreenCanvas(w, h), { composite: true });
  const t = preview.time;
  for (let v = 1 / 60; v <= t + 1e-9; v += 1 / 60) {
    scene.advanceTo(warpTime(warp, v));
    scene.drainEvents();
    scene.paintOnly(c);
  }
  scene.advanceTo(warpTime(warp, t));
  scene.render(c, t);
  const blob = await (scene.output as OffscreenCanvas).convertToBlob({ type: 'image/png' });
  scene.dispose();
  download(blob, `ball-${c.mode}-seed${c.seed}-cover.png`);
  viralStatus(`Đã tải ảnh bìa tại ${t.toFixed(1)}s`);
});

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
  const song = await idbGet<{ name: string; data: ArrayBuffer }>('music');
  if (song?.data) {
    try {
      music = await analyzeMusic(song.data);
      setMusic(song.name, song.data);
    } catch {
      // A stored file that no longer decodes is simply ignored.
    }
  }
  buildModeGrid();
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  panel.refresh();
  updateUndoButtons();
  updateInfo();
  void showCodecSupport();
  await restartPreview();
  document.body.dataset.ready = 'true';
}

void boot();
