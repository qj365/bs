import { expect, test as base, type Download, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { inflateSync } from 'node:zlib';

type Studio = {
  config(): Record<string, unknown>;
  time(): number;
  renderer(): 'gpu' | 'cpu' | null;
  playing(): boolean;
};

/** Fails the test on any console error or uncaught exception from the page or its workers. */
export const test = base.extend<{ errors: string[] }>({
  errors: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push('console: ' + m.text());
    });
    page.on('worker', (w) => w.on('console', (m) => m.type() === 'error' && errors.push('worker: ' + m.text())));
    await use(errors);
    expect(errors, 'no errors in the page').toEqual([]);
  },
});
export { expect };

export async function openApp(page: Page, opts: { fresh?: boolean } = { fresh: true }): Promise<void> {
  if (opts.fresh !== false) {
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('e2e-init')) {
        localStorage.clear();
        sessionStorage.setItem('e2e-init', '1');
      }
    });
  }
  await page.goto('/');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

export function config(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate(() => (window as unknown as { __studio: Studio }).__studio.config());
}

export function simTime(page: Page): Promise<number> {
  return page.evaluate(() => (window as unknown as { __studio: Studio }).__studio.time());
}

export function rendererKind(page: Page): Promise<string | null> {
  return page.evaluate(() => (window as unknown as { __studio: Studio }).__studio.renderer());
}

export function isPlaying(page: Page): Promise<boolean> {
  return page.evaluate(() => (window as unknown as { __studio: Studio }).__studio.playing());
}

/** Sets a numeric setting through its number box (like a user typing a value). */
export async function setNumber(page: Page, key: string, value: number): Promise<void> {
  const row = page.locator(`.row[data-key="${key}"]`);
  await row.locator('input.num, input[type=number]').first().fill(String(value));
  await row.locator('input.num, input[type=number]').first().dispatchEvent('change');
}

export async function setSelect(page: Page, key: string, value: string): Promise<void> {
  await openGroupOf(page, key);
  await page.locator(`.row[data-key="${key}"] select`).selectOption(value);
}

export async function setCheckbox(page: Page, key: string, on: boolean): Promise<void> {
  await openGroupOf(page, key);
  await page.locator(`.row[data-key="${key}"] input[type=checkbox]`).setChecked(on);
}

export async function openGroupOf(page: Page, key: string): Promise<void> {
  await page.evaluate((k) => {
    const row = document.querySelector(`.row[data-key="${k}"]`);
    const details = row?.closest('details');
    if (details) details.open = true;
  }, key);
}

/** Small settings make exports quick in a GPU-less CI browser. */
export async function quickExportSettings(page: Page, seconds = 2): Promise<void> {
  await setSelect(page, 'resolution', '720x1280');
  await setSelect(page, 'fps', '30');
  await setNumber(page, 'duration', seconds);
}

// ---------------------------------------------------------------- image checks

/** Minimal PNG decoder (8-bit RGB/RGBA, non-interlaced — what Playwright produces). */
export function decodePng(buf: Buffer): { width: number; height: number; channels: number; data: Uint8Array } {
  let pos = 8;
  let width = 0, height = 0, channels = 4;
  const idat: Buffer[] = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      channels = body[9] === 6 ? 4 : 3;
    } else if (type === 'IDAT') idat.push(body);
    pos += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8Array(stride * height);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? out[y * stride + x - channels] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= channels && y > 0 ? out[(y - 1) * stride + x - channels] : 0;
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 255;
    }
  }
  return { width, height, channels, data: out };
}

/** Fraction of pixels that differ clearly from the top-left (background) colour. */
export async function canvasInkRatio(page: Page): Promise<number> {
  const canvas = page.locator('#canvas-box canvas');
  const box = await canvas.boundingBox();
  if (!box) return 0;
  const png = decodePng(await page.screenshot({ clip: box }));
  const { data, channels } = png;
  const [r0, g0, b0] = [data[0], data[1], data[2]];
  let ink = 0;
  const n = png.width * png.height;
  for (let i = 0; i < n; i++) {
    const o = i * channels;
    if (Math.abs(data[o] - r0) + Math.abs(data[o + 1] - g0) + Math.abs(data[o + 2] - b0) > 60) ink++;
  }
  return ink / n;
}

/** Checks the MP4 container structure and returns the top-level box types. */
export function mp4Boxes(path: string): string[] {
  const buf = readFileSync(path);
  const boxes: string[] = [];
  let pos = 0;
  while (pos + 8 <= buf.length) {
    let size = buf.readUInt32BE(pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    if (size === 1) size = Number(buf.readBigUInt64BE(pos + 8));
    if (size < 8) break;
    boxes.push(type);
    pos += size;
  }
  return boxes;
}

/** Lists the track handler types (vide/soun) declared inside the moov box. */
export function mp4Tracks(path: string): string[] {
  const buf = readFileSync(path);
  let pos = 0;
  let moov: Buffer | null = null;
  while (pos + 8 <= buf.length) {
    const size = buf.readUInt32BE(pos);
    if (buf.toString('ascii', pos + 4, pos + 8) === 'moov') moov = buf.subarray(pos, pos + size);
    if (size < 8) break;
    pos += size;
  }
  if (!moov) return [];
  const tracks: string[] = [];
  let idx = moov.indexOf('hdlr');
  while (idx >= 0) {
    // hdlr: size(4) 'hdlr'(4) version/flags(4) pre_defined(4) handler_type(4)
    const type = moov.toString('ascii', idx + 12, idx + 16);
    if (type === 'vide' || type === 'soun') tracks.push(type);
    idx = moov.indexOf('hdlr', idx + 4);
  }
  return tracks;
}

export async function saveDownload(dl: Download, dir: string): Promise<string> {
  const path = `${dir}/${dl.suggestedFilename()}`;
  await dl.saveAs(path);
  return path;
}
