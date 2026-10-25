import { CHAOS_KINDS, type ChaosEvent, type ChaosKind, type Config } from '../config';
import { randomChaos } from '../random';

/** Small dialog for the timeline of twists ("at 10 s gravity flips…"). */
export class ChaosEditor {
  private dialog: HTMLDialogElement;
  private list: HTMLElement;
  private rows: ChaosEvent[] = [];
  private onSave: (events: ChaosEvent[]) => void = () => {};
  private cfg!: Config;

  constructor() {
    this.dialog = document.createElement('dialog');
    this.dialog.className = 'chaos-editor';
    this.dialog.innerHTML = `
      <h3>⚡ Biến cố theo thời gian</h3>
      <p class="hint">Những cú twist giữa video giữ người xem ở lại. Tối đa 8 biến cố.</p>
      <div class="ce-list"></div>
      <div class="me-tools">
        <button type="button" data-act="add">＋ Thêm biến cố</button>
        <button type="button" data-act="random">🎲 Gợi ý ngẫu nhiên</button>
        <button type="button" data-act="clear">🗑 Xóa hết</button>
      </div>
      <div class="me-foot">
        <button type="button" data-act="cancel">Hủy</button>
        <button type="button" class="primary" data-act="save">✓ Lưu</button>
      </div>`;
    document.body.append(this.dialog);
    this.list = this.dialog.querySelector('.ce-list')!;
    const on = (act: string, fn: () => void) => this.dialog.querySelector(`[data-act="${act}"]`)!.addEventListener('click', fn);
    on('add', () => {
      if (this.rows.length >= 8) return;
      const last = this.rows[this.rows.length - 1]?.t ?? 0;
      this.rows.push({ t: Math.round(last + 5), kind: 'gravityFlip', value: 0 });
      this.render();
    });
    on('random', () => {
      this.rows = randomChaos(Math.random, this.cfg.duration, this.cfg.mode);
      this.render();
    });
    on('clear', () => {
      this.rows = [];
      this.render();
    });
    on('cancel', () => this.dialog.close());
    on('save', () => {
      this.onSave(this.rows.slice().sort((a, b) => a.t - b.t));
      this.dialog.close();
    });
  }

  open(cfg: Config, onSave: (events: ChaosEvent[]) => void): void {
    this.cfg = cfg;
    this.onSave = onSave;
    this.rows = cfg.chaos.map((e) => ({ ...e }));
    this.render();
    this.dialog.showModal();
  }

  private render(): void {
    this.list.innerHTML = '';
    if (this.rows.length === 0) {
      this.list.innerHTML = '<p class="hint">Chưa có biến cố nào.</p>';
      return;
    }
    this.rows.forEach((ev, i) => {
      const row = document.createElement('div');
      row.className = 'ce-row';
      const t = document.createElement('input');
      t.type = 'number';
      t.min = '0';
      t.step = '0.5';
      t.value = String(ev.t);
      t.setAttribute('aria-label', 'Giây');
      t.addEventListener('change', () => (ev.t = Math.max(0, Number(t.value) || 0)));
      const kind = document.createElement('select');
      for (const [k, info] of Object.entries(CHAOS_KINDS)) {
        const o = document.createElement('option');
        o.value = k;
        o.textContent = info.label;
        kind.append(o);
      }
      kind.value = ev.kind;
      const value = document.createElement('input');
      value.type = 'number';
      value.step = 'any';
      value.value = String(ev.value);
      value.setAttribute('aria-label', 'Giá trị');
      const unit = document.createElement('span');
      unit.className = 'hint';
      const syncUnit = () => {
        const info = CHAOS_KINDS[ev.kind];
        unit.textContent = info.value;
        value.disabled = info.value === '—';
      };
      kind.addEventListener('change', () => {
        ev.kind = kind.value as ChaosKind;
        ev.value = CHAOS_KINDS[ev.kind].def;
        value.value = String(ev.value);
        syncUnit();
      });
      value.addEventListener('change', () => (ev.value = Number(value.value) || 0));
      const del = document.createElement('button');
      del.type = 'button';
      del.textContent = '✕';
      del.title = 'Xóa';
      del.addEventListener('click', () => {
        this.rows.splice(i, 1);
        this.render();
      });
      syncUnit();
      const label = document.createElement('span');
      label.textContent = 'giây';
      label.className = 'hint';
      row.append(t, label, kind, value, unit, del);
      this.list.append(row);
    });
  }
}
