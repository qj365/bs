import type { Page } from '@playwright/test';
import { statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { expect, exportTest, mp4Boxes, mp4Tracks, saveDownload, setNumber, test } from './helpers';

// @tonejs/midi is CommonJS; load it the CommonJS way in the Node test runner.
const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

type Marble = {
  config(): Record<string, unknown>;
  time(): number;
  playing(): boolean;
  duration(): number;
  hits(): number;
  bars(): number;
};
const marble = <K extends keyof Marble>(page: Page, key: K) =>
  page.evaluate((k) => {
    const m = (window as unknown as { __marble: Record<string, () => unknown> }).__marble;
    return m[k]();
  }, key) as Promise<ReturnType<Marble[K]>>;

async function openMarble(page: Page, preset?: Record<string, unknown>): Promise<void> {
  await page.addInitScript((p) => {
    if (!sessionStorage.getItem('e2e-init')) {
      localStorage.clear();
      if (p) localStorage.setItem('marble-config', JSON.stringify(p));
      sessionStorage.setItem('e2e-init', '1');
    }
  }, preset ?? null);
  await page.goto('/marble.html');
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
}

/** How many distinct colours the 3D canvas shows (a blank frame has one). */
function canvasColours(page: Page): Promise<number> {
  return page.evaluate(() => {
    const src = document.getElementById('view') as HTMLCanvasElement;
    const c = document.createElement('canvas');
    c.width = 90;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(src, 0, 0, c.width, c.height);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const set = new Set<number>();
    for (let i = 0; i < d.length; i += 4) set.add((d[i] >> 4) * 256 + (d[i + 1] >> 4) * 16 + (d[i + 2] >> 4));
    return set.size;
  });
}

test('tabs switch between the 2D studio and the 3D marble page', async ({ page }) => {
  await page.goto('/');
  await page.click('#tab-marble');
  await expect(page).toHaveURL(/marble\.html/);
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  await expect(page.locator('.tab.active')).toContainText('3D');
  await page.click('#tab-2d');
  await expect(page.locator('.tab.active')).toContainText('2D');
});

test('renders the course, scrubs and plays', async ({ page, errors }) => {
  void errors;
  await openMarble(page);
  expect(await marble(page, 'hits')).toBeGreaterThan(10);
  expect(await marble(page, 'bars')).toBe(await marble(page, 'hits'));
  await expect(page.locator('#stats')).toContainText('nốt');
  await page.locator('#scrub').evaluate((el: HTMLInputElement) => {
    el.value = '4';
    el.dispatchEvent(new Event('input'));
  });
  await expect.poll(() => marble(page, 'time')).toBeCloseTo(4, 1);
  await expect.poll(() => canvasColours(page)).toBeGreaterThan(20);
  await page.click('#btn-play');
  await expect.poll(() => marble(page, 'time')).toBeGreaterThan(4.3);
  await page.keyboard.press('Space');
  expect(await marble(page, 'playing')).toBe(false);
});

test('song, tempo and seed rebuild the course', async ({ page }) => {
  await openMarble(page);
  const before = await marble(page, 'duration');
  await setNumber(page, 'bpm', 66);
  await expect.poll(() => marble(page, 'duration')).toBeGreaterThan(before * 1.5);
  const hits = await marble(page, 'hits');
  await page.locator('.row[data-key="repeats"] input.num').fill('2');
  await page.locator('.row[data-key="repeats"] input.num').dispatchEvent('change');
  await expect.poll(() => marble(page, 'hits')).toBe(hits * 2);
  await page.click('#seed-next');
  expect((await marble(page, 'config')).seed).toBe(8);
  expect(await marble(page, 'hits')).toBe(hits * 2);
  // Settings survive a reload.
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect((await marble(page, 'config')).bpm).toBe(66);
});

test('loads a MIDI file with its own timing', async ({ page }) => {
  await openMarble(page);
  const midi = new Midi();
  const track = midi.addTrack();
  // Slow notes, a fast run (rolls on a rail), a long rest (curved ramp), then a chord.
  let t = 0;
  for (let i = 0; i < 4; i++) track.addNote({ midi: 60 + i, time: (t += 0.5), duration: 0.2 });
  for (let i = 0; i < 6; i++) track.addNote({ midi: 74 + i, time: (t += i === 0 ? 0.4 : 0.1), duration: 0.1 });
  t += 3;
  for (const m of [60, 64, 67]) track.addNote({ midi: m, time: t, duration: 0.5 });
  await page.locator('#file-midi').setInputFiles({ name: 'song.mid', mimeType: 'audio/midi', buffer: Buffer.from(midi.toArray()) });
  await expect(page.locator('#toast')).toContainText('song.mid');
  expect((await marble(page, 'config')).song).toBe('midi');
  expect(await marble(page, 'hits')).toBe(11);
  await expect(page.locator('#stats')).toContainText('6 trên ray');
  await expect(page.locator('#stats')).toContainText('1 máng');
});

test('exports a 3D clip as MP4 with sound', async ({ page }, info) => {
  const wait = exportTest();
  await openMarble(page, { resolution: '720x1280', fps: 30, bitrate: 4 });
  await page.fill('#clip-from', '1');
  await page.fill('#clip-to', '2.5');
  const dl = page.waitForEvent('download', { timeout: wait });
  await page.click('#btn-export');
  const path = await saveDownload(await dl, info.outputDir);
  expect(path).toMatch(/marble-classic-zigzag-canon-7\.mp4$/);
  expect(statSync(path).size).toBeGreaterThan(10_000);
  expect(mp4Boxes(path)).toContain('moov');
  expect(mp4Tracks(path).sort()).toEqual(['soun', 'vide']);
  await expect(page.locator('#export-status')).toContainText('1.5 giây');
});

test('random 3D videos change theme, layout and song; locks keep parts', async ({ page, errors }) => {
  void errors;
  await openMarble(page);
  const seen = { theme: new Set<unknown>(), layout: new Set<unknown>(), song: new Set<unknown>() };
  for (let i = 0; i < 8; i++) {
    await page.click('#btn-random');
    const c = await marble(page, 'config');
    seen.theme.add(c.theme);
    seen.layout.add(c.layout);
    seen.song.add(c.song);
  }
  expect(seen.theme.size).toBeGreaterThan(2);
  expect(seen.layout.size).toBeGreaterThan(1);
  expect(seen.song.size).toBeGreaterThan(1);
  await expect(page.locator('#random-status')).toContainText('seed');
  await expect.poll(() => canvasColours(page)).toBeGreaterThan(10);

  const before = await marble(page, 'config');
  await page.check('#lock-music');
  await page.check('#lock-look');
  await page.keyboard.press('g');
  const after = await marble(page, 'config');
  expect(after.song).toBe(before.song);
  expect(after.bpm).toBe(before.bpm);
  expect(after.theme).toBe(before.theme);
});

test('theme and look options apply', async ({ page, errors }) => {
  void errors;
  await openMarble(page);
  await page.selectOption('.row[data-key="theme"] select', 'neon');
  let c = await marble(page, 'config');
  expect(c.barStyle).toBe('neon');
  expect(c.sparks).toBe(true);
  await expect(page.locator('.row[data-key="barStyle"] select')).toHaveValue('neon');
  for (const [key, value] of [['layout', 'spiral'], ['cameraMode', 'orbit'], ['ballStyle', 'glass'], ['backdrop', 'wall'], ['colorMode', 'random']]) {
    await page.selectOption(`.row[data-key="${key}"] select`, value);
  }
  c = await marble(page, 'config');
  expect([c.layout, c.cameraMode, c.ballStyle, c.colorMode]).toEqual(['spiral', 'orbit', 'glass', 'random']);
  await page.locator('#scrub').evaluate((el: HTMLInputElement) => {
    el.value = '5';
    el.dispatchEvent(new Event('input'));
  });
  await expect.poll(() => canvasColours(page)).toBeGreaterThan(20);
});
