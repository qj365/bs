import type { Config, Mode } from '../config';
import { GROUPS, type Field } from './schema';

export interface PanelHandlers {
  onChange(key: keyof Config, live: boolean): void;
  onAction(name: string): void;
  /** Extra text shown next to an action button (e.g. the loaded file name). */
  actionInfo(name: string): string;
}

interface Row {
  field: Field;
  row: HTMLElement;
  group: HTMLDetailsElement;
  sync: () => void;
}

/** Builds the settings panel from the schema and keeps inputs in sync with the config object. */
export class Panel {
  private rows: Row[] = [];
  private groups: HTMLDetailsElement[] = [];
  private filter = '';

  constructor(root: HTMLElement, private cfg: Config, private h: PanelHandlers) {
    for (const group of GROUPS) {
      const details = document.createElement('details');
      details.className = 'group';
      details.dataset.group = group.id;
      details.open = !!group.open;
      const summary = document.createElement('summary');
      summary.textContent = group.title;
      details.append(summary);
      for (const field of group.fields) details.append(this.buildRow(field, details));
      root.append(details);
      this.groups.push(details);
    }
    this.refresh();
  }

  setConfig(cfg: Config): void {
    this.cfg = cfg;
    this.refresh();
  }

  /** Filters rows by label text; matching groups open automatically. */
  setFilter(text: string): void {
    this.filter = text.trim().toLowerCase();
    this.refresh();
  }

  /** Updates only the info text next to action buttons (loaded files, counts…). */
  refreshInfo(): void {
    for (const r of this.rows) if (r.field.type === 'action') r.sync();
  }

  /** Re-reads every value from the config and shows only the fields relevant to the current mode. */
  refresh(): void {
    for (const r of this.rows) {
      // Never overwrite what the user is typing right now.
      if (!r.row.contains(document.activeElement) || r.field.type === 'action') r.sync();
      const forMode = !r.field.modes || r.field.modes.includes(this.cfg.mode as Mode);
      const matches = !this.filter || r.field.label.toLowerCase().includes(this.filter);
      r.row.hidden = !forMode || !matches;
    }
    for (const g of this.groups) {
      const visible = this.rows.some((r) => r.group === g && !r.row.hidden);
      g.hidden = !visible;
      if (this.filter && visible) g.open = true;
    }
  }

  private buildRow(field: Field, group: HTMLDetailsElement): HTMLElement {
    const row = document.createElement('label');
    row.className = `row row-${field.type}`;
    row.dataset.key = field.key;
    const title = document.createElement('span');
    title.className = 'label';
    title.textContent = field.label;
    if (field.hint) {
      title.title = field.hint;
      title.classList.add('has-hint');
    }
    const cfg = () => this.cfg as unknown as Record<string, unknown>;
    const key = field.key as keyof Config;
    const commit = (value: unknown) => {
      cfg()[key] = value;
      this.h.onChange(key, !!field.live);
    };
    let sync: () => void = () => {};

    switch (field.type) {
      case 'range': {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = String(field.min);
        input.max = String(field.max);
        input.step = String(field.step ?? 1);
        input.setAttribute('aria-label', field.label);
        const num = document.createElement('input');
        num.type = 'number';
        num.className = 'num';
        num.step = String(field.step ?? 1);
        num.setAttribute('aria-label', field.label);
        input.addEventListener('input', () => {
          num.value = input.value;
          commit(Number(input.value));
        });
        num.addEventListener('change', () => {
          const v = Number(num.value);
          if (!isFinite(v)) return;
          input.value = String(v);
          commit(v);
        });
        sync = () => {
          input.value = String(cfg()[key]);
          num.value = String(cfg()[key]);
        };
        const wrap = document.createElement('div');
        wrap.className = 'range-wrap';
        wrap.append(input, num);
        row.append(title, wrap);
        break;
      }
      case 'number': {
        const input = document.createElement('input');
        input.type = 'number';
        if (field.min !== undefined) input.min = String(field.min);
        if (field.max !== undefined) input.max = String(field.max);
        input.step = String(field.step ?? 1);
        input.addEventListener('change', () => {
          const v = Number(input.value);
          if (isFinite(v)) commit(v);
        });
        sync = () => (input.value = String(cfg()[key]));
        row.append(title, input);
        break;
      }
      case 'select': {
        const sel = document.createElement('select');
        for (const [value, text] of field.options ?? []) {
          const o = document.createElement('option');
          o.value = value;
          o.textContent = text;
          sel.append(o);
        }
        sel.addEventListener('change', () => commit(field.numeric ? Number(sel.value) : sel.value));
        sync = () => (sel.value = String(cfg()[key]));
        row.append(title, sel);
        break;
      }
      case 'checkbox': {
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.addEventListener('change', () => commit(input.checked));
        sync = () => (input.checked = !!cfg()[key]);
        row.append(input, title);
        break;
      }
      case 'color': {
        const input = document.createElement('input');
        input.type = 'color';
        input.addEventListener('input', () => commit(input.value));
        sync = () => (input.value = String(cfg()[key]));
        row.append(title, input);
        break;
      }
      case 'text':
      case 'textarea': {
        const input = document.createElement(field.type === 'text' ? 'input' : 'textarea');
        if (input instanceof HTMLTextAreaElement) input.rows = 2;
        input.addEventListener(field.live ? 'input' : 'change', () => commit(input.value));
        sync = () => (input.value = String(cfg()[key]));
        row.append(title, input);
        break;
      }
      case 'action': {
        const name = field.key.slice('action:'.length);
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = field.label;
        btn.dataset.action = name;
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          this.h.onAction(name);
        });
        const info = document.createElement('span');
        info.className = 'hint';
        sync = () => (info.textContent = this.h.actionInfo(name));
        row.append(btn, info);
        break;
      }
    }
    this.rows.push({ field, row, group, sync });
    return row;
  }
}
