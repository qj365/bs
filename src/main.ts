import './style.css';
import { cloneConfig, DEFAULT_CONFIG, MODE_DEFAULTS, parseResolution, sanitizeConfig, type Config } from './config';
import { LiveAudio } from './audio/synth';
import { parseMidi, toChords } from './audio/midi';
import { Renderer } from './render/renderer';
import { formatTime } from './render/hud';
import { counterValue, endMessage, Simulation } from './sim';
import { pickAudioCodec, pickVideoCodec } from './export/codecs';
import { startExport, type ExportJob } from './export/exporter';
import { Panel } from './ui/panel';

const STORAGE_KEY = 'ball-studio-config-v1';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

function loadSaved(): Config {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeConfig(JSON.parse(raw));
  } catch {
    // Private mode or corrupted data: fall back to defaults.
  }
  return cloneConfig(DEFAULT_CONFIG);
}

let cfg = loadSaved();
let saveTimer = 0;
function save(): void {
  clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg));
    } catch {
      // Storage unavailable — nothing to do.
    }
  }, 300);
}

// ---------------------------------------------------------------- preview

const stage = $<HTMLDivElement>('canvas-wrap');
let canvas: HTMLCanvasElement | null = null;
let renderer: Renderer | null = null;
let rendererKey = '';
let sim: Simulation | null = null;
let simTime = 0;
let playing = true;
let lastTs = 0;
let restartToken = 0;
let audio: LiveAudio | null = null;
let fpsFrames = 0;
let fpsLast = performance.now();
let fpsValue = 0;

async function restart(): Promise<void> {
  const token = ++restartToken;
  const snapshot = cloneConfig(cfg);
  const next = await Simulation.create(snapshot);
  if (token !== restartToken) return;
  sim = next;

  const { width, height } = parseResolution(cfg.resolution);
  const pw = Math.max(2, Math.round((width * cfg.previewScale) / 2) * 2);
  const ph = Math.max(2, Math.round((height * cfg.previewScale) / 2) * 2);
  const key = `${pw}x${ph}`;
  if (key !== rendererKey || !renderer) {
    // A fresh canvas per size keeps GPU resources from leaking across WebGL contexts.
    renderer?.dispose();
    canvas?.remove();
    canvas = document.createElement('canvas');
    canvas.width = pw;
    canvas.height = ph;
    canvas.style.aspectRatio = `${width} / ${height}`;
    stage.append(canvas);
    renderer = new Renderer(canvas, sim.layout);
    rendererKey = key;
  } else {
    renderer.resetPaint();
  }
  simTime = 0;
  audio?.reset(cfg);
  updateInfo();
}

let restartTimer = 0;
function scheduleRestart(): void {
  clearTimeout(restartTimer);
  restartTimer = window.setTimeout(() => void restart(), 120);
}

function frame(ts: number): void {
  requestAnimationFrame(frame);
  if (!sim || !renderer) return;
  const dt = Math.min((ts - (lastTs || ts)) / 1000, 0.1);
  lastTs = ts;
  if (playing) {
    simTime += dt;
    const st = sim.stats();
    const endAt = cfg.stopOnFinish && st.finished ? Math.min(cfg.duration, st.finishTime + cfg.endHold) : cfg.duration;
    if (simTime >= endAt) {
      simTime = endAt;
      setPlaying(false);
    }
  }
  sim.advanceTo(simTime);
  const events = sim.drainEvents();
  if (playing && audio) audio.play(events, simTime);
  const st = sim.stats();
  renderer.render(cfg, sim.renderData(cfg.trailLength), {
    counter: counterValue(cfg, st),
    time: simTime,
    end: endMessage(cfg, st),
  });

  fpsFrames++;
  if (ts - fpsLast > 500) {
    fpsValue = (fpsFrames * 1000) / (ts - fpsLast);
    fpsFrames = 0;
    fpsLast = ts;
    $('stats').textContent = `${formatTime(simTime)} · ${st.alive} bóng · ${fpsValue.toFixed(0)} fps`;
  }
}

function setPlaying(p: boolean): void {
  playing = p;
  $('btn-play').textContent = p ? '⏸ Tạm dừng' : '▶ Phát';
}

async function ensureAudio(): Promise<void> {
  if (!audio) {
    audio = new LiveAudio();
    audio.reset(cfg);
  }
  if (audio.ctx.state !== 'running') await audio.ctx.resume();
}

$('btn-play').addEventListener('click', async () => {
  await ensureAudio();
  if (!playing && sim) {
    const st = sim.stats();
    const endAt = cfg.stopOnFinish && st.finished ? st.finishTime + cfg.endHold : cfg.duration;
    if (simTime >= Math.min(endAt, cfg.duration) - 1e-3) {
      await restart();
    }
  }
  setPlaying(!playing);
});

$('btn-restart').addEventListener('click', async () => {
  await ensureAudio();
  await restart();
  setPlaying(true);
});

$('btn-seed').addEventListener('click', async () => {
  await ensureAudio();
  cfg.seed = Math.floor(Math.random() * 1_000_000);
  panel.refresh();
  save();
  await restart();
  setPlaying(true);
});

// ---------------------------------------------------------------- settings

const panel = new Panel($('panel'), cfg, {
  onChange(key, live) {
    if (key === 'mode') {
      Object.assign(cfg, MODE_DEFAULTS[cfg.mode]);
      panel.refresh();
    }
    save();
    if (live) {
      if (['sound', 'instrument', 'noteMode', 'melodyName', 'scale', 'baseNote', 'transpose', 'volume', 'reverb'].includes(key)) {
        audio?.reset(cfg);
      }
      updateInfo();
      return;
    }
    scheduleRestart();
  },
  async onMidi(file) {
    try {
      const tracks = parseMidi(await file.arrayBuffer());
      const chords = toChords(tracks);
      if (chords.length === 0) throw new Error('File MIDI không có nốt nhạc.');
      cfg.melody = chords;
      cfg.melodyName = 'custom';
      cfg.noteMode = 'melody';
      panel.refresh();
      audio?.reset(cfg);
      save();
      toast(`Đã nạp "${file.name}": ${chords.length} nốt (${tracks.length} track)`);
    } catch (err) {
      toast('Không đọc được file MIDI: ' + (err instanceof Error ? err.message : String(err)));
    }
  },
});

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
    cfg = sanitizeConfig(JSON.parse(await f.text()));
    panel.setConfig(cfg);
    save();
    audio?.reset(cfg);
    await restart();
    toast(`Đã mở preset "${f.name}"`);
  } catch {
    toast('File preset không hợp lệ.');
  }
});

$('btn-reset').addEventListener('click', async () => {
  const mode = cfg.mode;
  cfg = cloneConfig(DEFAULT_CONFIG);
  cfg.mode = mode;
  Object.assign(cfg, MODE_DEFAULTS[mode]);
  panel.setConfig(cfg);
  save();
  audio?.reset(cfg);
  await restart();
});

// ---------------------------------------------------------------- export

let job: ExportJob | null = null;
let batchCancelled = false;

function updateInfo(): void {
  const { width, height } = parseResolution(cfg.resolution);
  $('export-info').textContent = `${width}×${height} · ${cfg.fps}fps · tối đa ${cfg.duration}s · ${cfg.bitrate} Mbps`;
}

async function runExport(seed: number, index: number, total: number): Promise<boolean> {
  const c = cloneConfig(cfg);
  c.seed = seed;
  const bar = $<HTMLProgressElement>('export-bar');
  const status = $('export-status');
  const prefix = total > 1 ? `[${index + 1}/${total}] ` : '';
  job = startExport(c, (p) => {
    bar.max = p.total;
    bar.value = p.frame;
    const pct = Math.round((p.frame / p.total) * 100);
    status.textContent = `${prefix}${p.status}${p.fps ? ` · ${pct}% · ${p.fps.toFixed(0)} khung/giây` : ''}`;
  });
  try {
    const r = await job.promise;
    const name = `ball-${c.mode}-seed${seed}.mp4`;
    download(r.blob, name);
    const speed = r.duration / r.seconds;
    status.textContent = `${prefix}Xong ${name}: ${r.duration.toFixed(1)}s video trong ${r.seconds.toFixed(1)}s (nhanh ×${speed.toFixed(1)}) · ${(r.blob.size / 1e6).toFixed(1)} MB · ${r.video}${r.audio ? ' + ' + r.audio : ''}`;
    return true;
  } catch (err) {
    status.textContent = `${prefix}Lỗi: ${err instanceof Error ? err.message : String(err)}`;
    return false;
  } finally {
    job = null;
  }
}

function setExporting(on: boolean): void {
  $<HTMLButtonElement>('btn-export').disabled = on;
  $<HTMLButtonElement>('btn-batch').disabled = on;
  $<HTMLButtonElement>('btn-cancel').hidden = !on;
}

$('btn-export').addEventListener('click', async () => {
  setExporting(true);
  await runExport(cfg.seed, 0, 1);
  setExporting(false);
});

$('btn-batch').addEventListener('click', async () => {
  const n = Math.max(1, Math.min(50, Number($<HTMLInputElement>('batch-count').value) || 1));
  batchCancelled = false;
  setExporting(true);
  for (let i = 0; i < n && !batchCancelled; i++) {
    const ok = await runExport(cfg.seed + i, i, n);
    if (!ok) break;
  }
  setExporting(false);
});

$('btn-cancel').addEventListener('click', () => {
  batchCancelled = true;
  job?.cancel();
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
  const v = await pickVideoCodec(width, height, cfg.fps, cfg.bitrate * 1e6);
  const a = await pickAudioCodec(48000);
  el.textContent = v ? `Video: ${v.label} · Âm thanh: ${a?.label ?? 'không hỗ trợ'}` : 'Trình duyệt này không xuất được video — hãy dùng Chrome/Edge bản mới';
  el.classList.toggle('bad', !v);
}

updateInfo();
void showCodecSupport();
void restart().then(() => requestAnimationFrame(frame));
