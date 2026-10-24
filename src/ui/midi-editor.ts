import type { Config } from '../config';
import { MELODIES } from '../audio/melodies';
import { parseMidi, toChords } from '../audio/midi';
import { buildMaster, playNote } from '../audio/synth';

const LOW = 48; // C3
const HIGH = 84; // C6
const CELL_W = 24;
const CELL_H = 18;
const KEYS_W = 44;
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const isBlack = (m: number) => [1, 3, 6, 8, 10].includes(m % 12);

/**
 * Piano-roll melody editor. Each column is one bounce; a column may hold a chord.
 * Clicking toggles a note, dragging paints or erases.
 */
export class MidiEditor {
  private dialog: HTMLDialogElement;
  private canvas: HTMLCanvasElement;
  private steps: number[][] = [];
  private playing: { ctx: AudioContext; timer: number; col: number } | null = null;
  private onSave: (melody: number[][]) => void = () => {};
  private cfg!: Config;
  private info: HTMLElement;

  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'midi-editor';
    this.dialog.innerHTML = `
      <div class="me-head">
        <strong>🎹 Soạn giai điệu</strong>
        <span class="hint">Mỗi cột = 1 lần nảy. Bấm/kéo để đặt nốt, bấm lại để xóa. Nhiều nốt cùng cột = hợp âm.</span>
      </div>
      <div class="me-tools">
        <button type="button" data-act="play">▶ Nghe thử</button>
        <button type="button" data-act="stop">⏹ Dừng</button>
        <button type="button" data-act="add">＋8 bước</button>
        <button type="button" data-act="remove">－8 bước</button>
        <button type="button" data-act="clear">🗑 Xóa hết</button>
        <select data-act="load"><option value="">Lấy từ bài có sẵn…</option>${Object.entries(MELODIES)
          .map(([k, v]) => `<option value="${k}">${v.label}</option>`).join('')}</select>
        <label class="file-btn">📂 Nạp MIDI<input type="file" accept=".mid,.midi,audio/midi" hidden data-act="midi" /></label>
        <span class="me-info"></span>
      </div>
      <div class="me-scroll"><canvas></canvas></div>
      <div class="me-foot">
        <button type="button" data-act="cancel">Hủy</button>
        <button type="button" class="primary" data-act="save">✓ Dùng giai điệu này</button>
      </div>`;
    document.body.append(this.dialog);
    this.canvas = this.dialog.querySelector('canvas')!;
    this.info = this.dialog.querySelector('.me-info')!;

    const on = (act: string, ev: string, fn: (e: Event) => void) =>
      this.dialog.querySelector(`[data-act="${act}"]`)!.addEventListener(ev, fn);
    on('play', 'click', () => this.play());
    on('stop', 'click', () => this.stop());
    on('add', 'click', () => this.resize(this.steps.length + 8));
    on('remove', 'click', () => this.resize(Math.max(1, this.steps.length - 8)));
    on('clear', 'click', () => {
      this.steps = this.steps.map(() => []);
      this.draw();
    });
    on('load', 'change', (e) => {
      const sel = e.target as HTMLSelectElement;
      const m = MELODIES[sel.value];
      if (m) this.setSteps(m.notes);
      sel.value = '';
    });
    on('midi', 'change', async (e) => {
      const input = e.target as HTMLInputElement;
      const f = input.files?.[0];
      input.value = '';
      if (!f) return;
      try {
        this.setSteps(toChords(parseMidi(await f.arrayBuffer())));
      } catch {
        this.info.textContent = 'Không đọc được file MIDI';
      }
    });
    on('cancel', 'click', () => this.close());
    on('save', 'click', () => {
      this.onSave(this.steps.filter((s) => s.length > 0).map((s) => s.slice().sort((a, b) => a - b)));
      this.close();
    });
    this.dialog.addEventListener('close', () => this.stop());

    let painting: boolean | null = null;
    const cellAt = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const col = Math.floor((ev.clientX - r.left - KEYS_W) / CELL_W);
      const row = Math.floor((ev.clientY - r.top) / CELL_H);
      const note = HIGH - row;
      return col >= 0 && col < this.steps.length && note >= LOW && note <= HIGH ? { col, note } : null;
    };
    const apply = (ev: PointerEvent) => {
      const c = cellAt(ev);
      if (!c || painting === null) return;
      const step = this.steps[c.col];
      const has = step.includes(c.note);
      if (painting && !has) {
        step.push(c.note);
        this.preview(c.note);
      } else if (!painting && has) {
        step.splice(step.indexOf(c.note), 1);
      }
      this.draw();
    };
    this.canvas.addEventListener('pointerdown', (ev) => {
      const c = cellAt(ev);
      if (!c) return;
      painting = !this.steps[c.col].includes(c.note);
      this.canvas.setPointerCapture(ev.pointerId);
      apply(ev);
    });
    this.canvas.addEventListener('pointermove', apply);
    this.canvas.addEventListener('pointerup', () => (painting = null));
  }

  open(cfg: Config, initial: number[][], onSave: (melody: number[][]) => void): void {
    this.cfg = cfg;
    this.onSave = onSave;
    this.setSteps(initial.length > 0 ? initial : MELODIES.ode.notes);
    this.dialog.showModal();
  }

  private close(): void {
    this.stop();
    this.dialog.close();
  }

  private setSteps(steps: number[][]): void {
    this.steps = steps.map((s) => s.filter((n) => n >= LOW - 24 && n <= HIGH + 24));
    if (this.steps.length === 0) this.steps = Array.from({ length: 16 }, () => []);
    this.draw();
  }

  private resize(n: number): void {
    while (this.steps.length < n) this.steps.push([]);
    this.steps.length = n;
    this.draw();
  }

  private draw(highlight = -1): void {
    const rows = HIGH - LOW + 1;
    const w = KEYS_W + this.steps.length * CELL_W;
    const h = rows * CELL_H;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (this.canvas.width !== w * dpr || this.canvas.height !== h * dpr) {
      this.canvas.width = w * dpr;
      this.canvas.height = h * dpr;
      this.canvas.style.width = `${w}px`;
      this.canvas.style.height = `${h}px`;
    }
    const c = this.canvas.getContext('2d')!;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = '#12131a';
    c.fillRect(0, 0, w, h);
    for (let i = 0; i < rows; i++) {
      const note = HIGH - i;
      const y = i * CELL_H;
      c.fillStyle = isBlack(note) ? '#171923' : '#1d2030';
      c.fillRect(KEYS_W, y, w - KEYS_W, CELL_H);
      c.fillStyle = isBlack(note) ? '#2a2d3a' : '#d9dbe4';
      c.fillRect(0, y, KEYS_W - 2, CELL_H - 1);
      if (note % 12 === 0) {
        c.fillStyle = '#1d2030';
        c.font = '10px system-ui';
        c.fillText(`${NAMES[0]}${Math.floor(note / 12) - 1}`, 4, y + 13);
      }
    }
    c.strokeStyle = '#2c3042';
    c.lineWidth = 1;
    for (let col = 0; col <= this.steps.length; col++) {
      const x = KEYS_W + col * CELL_W + 0.5;
      c.globalAlpha = col % 4 === 0 ? 1 : 0.4;
      c.beginPath();
      c.moveTo(x, 0);
      c.lineTo(x, h);
      c.stroke();
    }
    c.globalAlpha = 1;
    if (highlight >= 0) {
      c.fillStyle = 'rgba(255,59,107,0.18)';
      c.fillRect(KEYS_W + highlight * CELL_W, 0, CELL_W, h);
    }
    this.steps.forEach((step, col) => {
      for (const note of step) {
        if (note < LOW || note > HIGH) continue;
        const y = (HIGH - note) * CELL_H;
        c.fillStyle = `hsl(${(note * 29) % 360} 85% 60%)`;
        c.beginPath();
        c.roundRect(KEYS_W + col * CELL_W + 2, y + 2, CELL_W - 4, CELL_H - 4, 4);
        c.fill();
      }
    });
    const notes = this.steps.filter((s) => s.length > 0).length;
    this.info.textContent = `${this.steps.length} bước · ${notes} có nốt`;
  }

  private preview(note: number): void {
    const ctx = this.playing?.ctx ?? new AudioContext();
    playNote(ctx, buildMaster(ctx, this.cfg), this.cfg.instrument === 'sample' ? 'marimba' : this.cfg.instrument, note, ctx.currentTime, 0.8);
    if (!this.playing) setTimeout(() => void ctx.close(), 1500);
  }

  private play(): void {
    this.stop();
    const ctx = new AudioContext();
    const out = buildMaster(ctx, this.cfg);
    const inst = this.cfg.instrument === 'sample' ? 'marimba' : this.cfg.instrument;
    const state = { ctx, timer: 0, col: 0 };
    this.playing = state;
    const tick = () => {
      if (state.col >= this.steps.length) {
        this.stop();
        return;
      }
      for (const n of this.steps[state.col]) playNote(ctx, out, inst, n, ctx.currentTime + 0.02, 0.8);
      this.draw(state.col);
      state.col++;
      state.timer = window.setTimeout(tick, 220);
    };
    tick();
  }

  private stop(): void {
    if (!this.playing) return;
    clearTimeout(this.playing.timer);
    void this.playing.ctx.close();
    this.playing = null;
    this.draw();
  }
}
