import '../style.css';
import { parseMidi } from '../audio/midi';
import { parseResolution } from '../config';
import { pickAudioCodec, pickVideoCodec } from '../export/codecs';
import { formatTime } from '../render/hud';
import { Panel } from '../ui/panel';
import { idbGet, idbSet, lsGet, lsSet } from '../ui/storage';
import { MarbleLiveAudio } from './audio';
import { buildCourse, type Course } from './choreo';
import { applyTheme, courseOptions, DEFAULT_MARBLE, midiToNotes, sanitizeMarble, songNotes, type MarbleConfig, type MidiSong } from './config';
import { startMarbleExport, type MarbleExportJob } from './exporter';
import { randomMarble } from './random';
import { MARBLE_GROUPS } from './schema';
import { Rng } from '../rng';
import { drawMarbleText, MarbleScene } from './scene3d';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const STORE_KEY = 'marble-config';
const PREVIEW_H = 960;

let cfg: MarbleConfig = sanitizeMarble(JSON.parse(lsGet(STORE_KEY) ?? 'null'));
let midi: MidiSong | null = null;
let course: Course = buildCourse([], courseOptions(cfg));
let time = 0; // video seconds (0 = course start)
let playing = false;
let lastFrame = 0;
let job: MarbleExportJob | null = null;

const view = $<HTMLCanvasElement>('view');
const textLayer = $<HTMLCanvasElement>('text-layer');
const textCtx = textLayer.getContext('2d')!;
const scrub = $<HTMLInputElement>('scrub');
let scene: MarbleScene | null = null;
try {
  scene = new MarbleScene(view, view.width, view.height);
} catch (err) {
  console.error(err);
  $('stats').textContent = '⚠ Trình duyệt không hỗ trợ WebGL — không xem trước được cảnh 3D';
}
let audio: MarbleLiveAudio | null = null;

const duration = () => Math.max(0.1, course.end - course.start);

function save(): void {
  lsSet(STORE_KEY, JSON.stringify(cfg));
}

/** Matches the preview canvas to the export aspect ratio. */
function sizeCanvases(): void {
  const { width, height } = parseResolution(cfg.resolution);
  const h = PREVIEW_H;
  const w = Math.round((h * width) / height);
  if (view.width !== w || view.height !== h) {
    view.width = textLayer.width = w;
    view.height = textLayer.height = h;
    scene?.resize(w, h);
  }
}

function drawText(): void {
  textCtx.clearRect(0, 0, textLayer.width, textLayer.height);
  drawMarbleText(textCtx, cfg, textLayer.width, textLayer.height);
}

/** Rebuilds the course (song / layout changed). */
function rebuild(): void {
  const notes = songNotes(cfg, midi);
  course = buildCourse(notes, courseOptions(cfg));
  scene?.setCourse(course, cfg);
  scrub.max = String(duration());
  time = Math.min(time, duration());
  audio?.seek(course, course.start + time);
  const rows = course.bars.filter((b) => b.inRow).length;
  $('stats').textContent = `${course.hits.length} nốt · ${course.bars.length} phím (${rows} trên ray) · ${course.ramps.length} máng · ${formatTime(duration())}`;
  draw();
}

function draw(): void {
  scene?.render(course.start + time);
  scrub.value = String(time);
  $('time-label').textContent = `${formatTime(time)} / ${formatTime(duration())}`;
}

function setPlaying(on: boolean): void {
  playing = on;
  $('btn-play').textContent = on ? '⏸' : '▶';
  if (on) {
    if (time >= duration() - 0.01) time = 0;
    void ensureAudio();
    audio?.seek(course, course.start + time);
    lastFrame = performance.now();
  }
}

async function ensureAudio(): Promise<void> {
  if (!audio) {
    audio = new MarbleLiveAudio();
    audio.reset(cfg);
  }
  if (audio.ctx.state !== 'running') await audio.ctx.resume().catch(() => undefined);
  if (audio.ctx.state === 'running') $('audio-hint').hidden = true;
  audio.seek(course, course.start + time);
}

function loop(now: number): void {
  if (playing) {
    time += Math.min(0.1, (now - lastFrame) / 1000);
    if (time >= duration()) {
      time = duration();
      setPlaying(false);
    }
    audio?.play(course, course.start + time);
  }
  lastFrame = now;
  if (playing || needsDraw) {
    needsDraw = false;
    draw();
  }
  requestAnimationFrame(loop);
}
let needsDraw = true;

const LOOK_KEYS = new Set<keyof MarbleConfig>([
  'bgColor', 'fog', 'barColor', 'playedColor', 'ballColor', 'stripeColor', 'light', 'shadows', 'flash', 'cameraDistance',
  'barStyle', 'colorMode', 'ballStyle', 'backdrop', 'theme',
]);

const panel = new Panel<MarbleConfig>($('panel'), cfg, {
  onChange(key, live) {
    save();
    if (key === 'seed') $<HTMLInputElement>('seed-input').value = String(cfg.seed);
    if (key === 'theme') {
      applyTheme(cfg, cfg.theme);
      save();
      panel.refresh();
    }
    if (key === 'resolution') sizeCanvases();
    if (key === 'title' || key === 'titleSize' || key === 'subtitle' || key === 'subtitleSize' || key === 'textColor' || key === 'resolution') drawText();
    if (key === 'lowInstrument' || key === 'highInstrument' || key === 'volume' || key === 'reverb') audio?.reset(cfg);
    if (key === 'song' && cfg.song === 'midi' && !midi) toast('Hãy nạp file MIDI trước — đang dùng bài mặc định.');
    if (!live || key === 'holderColor') rebuild();
    else if (LOOK_KEYS.has(key)) {
      scene?.applyLook(cfg);
      needsDraw = true;
    } else needsDraw = true;
  },
  onAction(name) {
    if (name === 'midi') $<HTMLInputElement>('file-midi').click();
  },
  actionInfo(name) {
    return name === 'midi' && midi ? `${midi.name} · ${midi.notes.length} nốt` : '';
  },
}, MARBLE_GROUPS);

// Hidden file input for MIDI.
const midiInput = document.createElement('input');
midiInput.type = 'file';
midiInput.accept = '.mid,.midi,audio/midi';
midiInput.id = 'file-midi';
midiInput.hidden = true;
document.body.append(midiInput);
midiInput.addEventListener('change', async () => {
  const file = midiInput.files?.[0];
  midiInput.value = '';
  if (!file) return;
  try {
    const data = await file.arrayBuffer();
    loadMidi(file.name, data);
    void idbSet('marble-midi', { name: file.name, data });
    toast(`Đã nạp ${file.name}: ${midi!.notes.length} nốt`);
  } catch (err) {
    toast('Không đọc được file MIDI: ' + (err instanceof Error ? err.message : String(err)));
  }
});

function loadMidi(name: string, data: ArrayBuffer): void {
  const tracks = parseMidi(data);
  const notes = midiToNotes(tracks.flatMap((t) => t.notes));
  if (notes.length === 0) throw new Error('file không có nốt nào');
  const t0 = notes[0].t;
  midi = { name, notes: notes.map((n) => ({ t: n.t - t0, midi: n.midi })) };
  cfg.song = 'midi';
  save();
  panel.refresh();
  rebuild();
}

// ---------------------------------------------------------------- controls

$('btn-play').addEventListener('click', () => setPlaying(!playing));
$('btn-restart').addEventListener('click', () => {
  time = 0;
  setPlaying(true);
});
scrub.addEventListener('input', () => {
  time = Number(scrub.value);
  audio?.seek(course, course.start + time);
  needsDraw = true;
});

function setSeed(seed: number): void {
  cfg.seed = Math.max(0, Math.floor(seed));
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  save();
  panel.refresh();
  rebuild();
}
$('seed-prev').addEventListener('click', () => setSeed(cfg.seed - 1));
$('seed-next').addEventListener('click', () => setSeed(cfg.seed + 1));
$('btn-seed').addEventListener('click', () => setSeed(Math.floor(Math.random() * 100000)));
$<HTMLInputElement>('seed-input').addEventListener('change', (e) => setSeed(Number((e.target as HTMLInputElement).value) || 0));

$('btn-save').addEventListener('click', () => {
  download(new Blob([JSON.stringify(cfg, null, 2)], { type: 'application/json' }), `marble-${cfg.seed}.json`);
});
$<HTMLInputElement>('file-preset').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  if (!file) return;
  try {
    applyConfig(sanitizeMarble(JSON.parse(await file.text())));
    toast('Đã mở preset');
  } catch {
    toast('File preset không hợp lệ');
  }
});
$('btn-reset').addEventListener('click', () => applyConfig({ ...DEFAULT_MARBLE }));

function applyConfig(next: MarbleConfig): void {
  cfg = next;
  panel.setConfig(cfg);
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  save();
  sizeCanvases();
  drawText();
  audio?.reset(cfg);
  rebuild();
}

$<HTMLInputElement>('settings-filter').addEventListener('input', (e) => panel.setFilter((e.target as HTMLInputElement).value));

// ---------------------------------------------------------------- export

$('btn-export').addEventListener('click', () => void exportCurrent());

/** Exports the current config; resolves to false if it failed or was cancelled. */
async function exportCurrent(label = ''): Promise<boolean> {
  if (job) return false;
  const notes = songNotes(cfg, midi);
  const from = Math.max(0, Number($<HTMLInputElement>('clip-from').value) || 0);
  const toRaw = Number($<HTMLInputElement>('clip-to').value) || 0;
  const to = toRaw > from ? Math.min(toRaw, duration()) : duration();
  if (to - from < 0.1) {
    toast('Đoạn xuất quá ngắn');
    return false;
  }
  const bar = $<HTMLProgressElement>('export-bar');
  const status = $('export-status');
  setPlaying(false);
  $('btn-export').setAttribute('disabled', '');
  $('btn-cancel').hidden = false;
  const started = performance.now();
  job = startMarbleExport(cfg, notes, { start: from, end: to }, (frame, total, fps, text) => {
    bar.value = frame / total;
    status.textContent = label + (fps > 0 ? `${text} · ${frame}/${total} khung · ${fps.toFixed(0)} khung/giây` : text);
  });
  return job.promise.then((res) => {
    const name = `marble-${cfg.theme}-${cfg.layout}-${cfg.song}-${cfg.seed}.mp4`;
    download(res.blob, name);
    bar.value = 1;
    status.textContent = `✅ ${name} · ${res.duration.toFixed(1)} giây · ${(res.blob.size / 1e6).toFixed(1)} MB · ${res.video}${res.audio ? ' + ' + res.audio : ''} · mất ${((performance.now() - started) / 1000).toFixed(1)} giây`;
    document.body.dataset.exported = String(res.blob.size);
    return true;
  }).catch((err: Error) => {
    status.textContent = '❌ ' + err.message;
    return false;
  }).finally(() => {
    job = null;
    $('btn-export').removeAttribute('disabled');
    $('btn-cancel').hidden = true;
  });
}

// ---------------------------------------------------------------- random

let batchStop = false;

function randomize(): void {
  const locks = {
    music: $<HTMLInputElement>('lock-music').checked,
    look: $<HTMLInputElement>('lock-look').checked,
    text: $<HTMLInputElement>('lock-text').checked,
  };
  const lang = $<HTMLSelectElement>('rand-lang').value as 'vi' | 'en';
  const rng = new Rng((Math.random() * 2 ** 31) >>> 0);
  applyConfig(randomMarble(cfg, rng, locks, lang, !!midi));
  const theme = $('panel').querySelector<HTMLSelectElement>('.row[data-key="theme"] select');
  $('random-status').textContent = `🎲 ${theme?.selectedOptions[0]?.textContent ?? cfg.theme} · ${cfg.layout} · camera ${cfg.cameraMode} · ${cfg.song} ${cfg.bpm} BPM · seed ${cfg.seed}`;
}

$('btn-random').addEventListener('click', randomize);
$('btn-random-batch').addEventListener('click', async () => {
  const n = Math.max(1, Math.min(50, Number($<HTMLInputElement>('random-count').value) || 1));
  batchStop = false;
  $('btn-random-batch').setAttribute('disabled', '');
  for (let i = 0; i < n && !batchStop; i++) {
    randomize();
    const ok = await exportCurrent(`Video ${i + 1}/${n} · `);
    if (!ok) break;
  }
  $('btn-random-batch').removeAttribute('disabled');
});
$('btn-cancel').addEventListener('click', () => {
  batchStop = true;
  job?.cancel();
});

// ---------------------------------------------------------------- keys

document.addEventListener('keydown', (e) => {
  const t = e.target as HTMLElement;
  if (t.closest('input, textarea, select')) return;
  if (e.code === 'Space') {
    e.preventDefault();
    setPlaying(!playing);
  } else if (e.key === 'g' || e.key === 'G') {
    randomize();
  } else if (e.key === 'r' || e.key === 'R') {
    time = 0;
    setPlaying(true);
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
  el.textContent = v ? `Video: ${v.label} · Âm thanh: ${a?.label ?? 'không hỗ trợ'}` : 'Trình duyệt này không xuất được video — hãy dùng Chrome/Edge bản mới';
  el.classList.toggle('bad', !v);
}

// Read-only hooks for automated tests.
(window as unknown as { __marble: unknown }).__marble = {
  config: () => ({ ...cfg }),
  time: () => time,
  playing: () => playing,
  duration,
  hits: () => course.hits.length,
  bars: () => course.bars.length,
};

async function boot(): Promise<void> {
  const saved = await idbGet<{ name: string; data: ArrayBuffer }>('marble-midi');
  if (saved?.data) {
    try {
      const song = cfg.song;
      loadMidi(saved.name, saved.data);
      cfg.song = song;
      panel.refresh();
    } catch {
      // A stored file that no longer parses is ignored.
    }
  }
  $<HTMLInputElement>('seed-input').value = String(cfg.seed);
  sizeCanvases();
  drawText();
  rebuild();
  void showCodecSupport();
  requestAnimationFrame(loop);
  document.body.dataset.ready = 'true';
}

void boot();
