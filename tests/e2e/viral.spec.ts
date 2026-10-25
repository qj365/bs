import { readFileSync } from 'node:fs';
import type { Page } from '@playwright/test';
import {
  canvasInkRatio, config, decodePng, expect, exportTest, mp4Boxes, mp4Tracks, openApp, openGroupOf, quickExportSettings, saveDownload,
  setCheckbox, setNumber, setSelect, simTime, test,
} from './helpers';

function clickTrackWav(bpm: number, seconds: number): Buffer {
  const rate = 22050;
  const n = Math.floor(seconds * rate);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  const period = Math.round((60 / bpm) * rate);
  for (let i = 0; i < n; i++) {
    const k = i % period;
    const v = k < 400 ? Math.sin(k * 0.8) * Math.exp(-k / 90) * 20000 : 0;
    buf.writeInt16LE(Math.round(v), 44 + i * 2);
  }
  return buf;
}

/** Collects every download started while `fn` runs, until `count` arrived. */
async function downloads(page: Page, dir: string, count: number, fn: () => Promise<void>): Promise<string[]> {
  const paths: Promise<string>[] = [];
  const handler = (d: import('@playwright/test').Download) => paths.push(saveDownload(d, dir));
  page.on('download', handler);
  const wait = exportTest();
  await fn();
  await expect.poll(() => paths.length, { timeout: wait }).toBe(count);
  page.off('download', handler);
  return Promise.all(paths);
}

test('describe a video in words', async ({ page }) => {
  await openApp(page);
  await page.fill('#prompt-text', 'bóng lớn dần có gai, màu neon, đàn piano, 15-40 giây');
  await page.click('#btn-prompt');
  await expect(page.locator('#random-status')).toContainText('✅', { timeout: 60_000 });
  await expect(page.locator('#prompt-tags')).toContainText('Lớn dần');
  const cfg = await config(page);
  expect(cfg).toMatchObject({ mode: 'grow', spikeArc: 90, spikeEffect: 'destroy', bgColor: '#0b0b12', instrument: 'piano' });
});

test('most dramatic seeds are ranked and applied', async ({ page }) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="escape"]');
  await page.click('.chip[data-variant="will-escape"]');
  await page.fill('#drama-min', '4');
  await page.fill('#drama-max', '60');
  await page.fill('#drama-count', '40');
  await page.click('#btn-drama');
  await expect(page.locator('#drama-status')).toContainText('Xong', { timeout: 60_000 });
  const first = page.locator('#drama-results button.result').first();
  await expect(first).toContainText('điểm');
  const seed = Number(await first.getAttribute('data-seed'));
  await first.click();
  expect((await config(page)).seed).toBe(seed);
});

test('seamless loop: found, previewed and exported', async ({ page }, info) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="grow"]');
  await setNumber(page, 'growAmount', 0);
  await setCheckbox(page, 'ringRainbow', false);
  await quickExportSettings(page, 20);
  await page.fill('#loop-min', '3');
  await page.fill('#loop-max', '8');
  await page.click('#btn-loop');
  await expect(page.locator('#loop-status')).toContainText('lệch', { timeout: 60_000 });
  await expect(page.locator('#btn-loop-export')).toBeEnabled();
  const [path] = await downloads(page, info.outputDir, 1, () => page.click('#btn-loop-export'));
  expect(path).toMatch(/-loop\.mp4$/);
  expect(mp4Boxes(path)).toContain('moov');
});

test('part 1 + part 2 export', async ({ page }, info) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="escape"]');
  await page.click('.chip[data-variant="will-escape"]');
  await setNumber(page, 'gapAngle', 60);
  await quickExportSettings(page, 30);
  const paths = await downloads(page, info.outputDir, 2, () => page.click('#btn-parts'));
  expect(paths.map((p) => p.split('/').pop())).toEqual(['ball-escape-seed1-part1.mp4', 'ball-escape-seed1-part2.mp4']);
  await expect(page.locator('#viral-status')).toContainText('Cắt ở');
});

test('A/B export with different hooks', async ({ page }, info) => {
  await openApp(page);
  await quickExportSettings(page, 1);
  await page.selectOption('#ab-kind', 'hook');
  await page.selectOption('#ab-count', '2');
  const paths = await downloads(page, info.outputDir, 2, () => page.click('#btn-ab'));
  expect(paths.map((p) => p.split('/').pop())).toEqual(['ball-escape-seed1-A.mp4', 'ball-escape-seed1-B.mp4']);
});

test('export brings a caption file and a cover image', async ({ page }, info) => {
  await openApp(page);
  await quickExportSettings(page, 1, true);
  const paths = await downloads(page, info.outputDir, 3, () => page.click('#btn-export'));
  const txt = paths.find((p) => p.endsWith('.txt'))!;
  const png = paths.find((p) => p.endsWith('.png'))!;
  expect(readFileSync(txt, 'utf8')).toContain('#satisfying');
  const img = decodePng(readFileSync(png));
  expect([img.width, img.height]).toEqual([720, 1280]);
});

test('copy caption and download a full-size cover of the current frame', async ({ page, context }, info) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await openApp(page);
  await page.click('#btn-caption');
  const text = await page.evaluate(() => navigator.clipboard.readText());
  expect(text).toContain('#bouncingball');
  const [png] = await downloads(page, info.outputDir, 1, () => page.click('#btn-cover'));
  const img = decodePng(readFileSync(png));
  expect([img.width, img.height]).toEqual([1080, 1920]);
});

test('timeline events editor', async ({ page }) => {
  await openApp(page);
  await openGroupOf(page, 'portals');
  await page.click('button[data-action="chaos"]');
  const dlg = page.locator('dialog.chaos-editor');
  await dlg.locator('[data-act="add"]').click();
  await dlg.locator('[data-act="add"]').click();
  await dlg.locator('.ce-row select').nth(1).selectOption('blackHole');
  await dlg.locator('[data-act="save"]').click();
  const cfg = await config(page);
  expect((cfg.chaos as { kind: string }[]).map((e) => e.kind)).toEqual(['gravityFlip', 'blackHole']);
  await expect(page.locator('.row[data-key="action:chaos"] .hint')).toContainText('2 biến cố');
  // The variant with twists plays without errors past its first event.
  await page.click('.chip[data-variant="escape-chaos"]');
  await expect.poll(() => simTime(page), { timeout: 30_000 }).toBeGreaterThan(11);
});

test('split-screen battle previews and exports', async ({ page }, info) => {
  await openApp(page);
  await setSelect(page, 'battle', '2');
  await expect.poll(() => simTime(page)).toBeGreaterThan(1);
  expect(await canvasInkRatio(page)).toBeGreaterThan(0.01);
  await quickExportSettings(page, 1);
  const [path] = await downloads(page, info.outputDir, 1, () => page.click('#btn-export'));
  expect(mp4Tracks(path)).toContain('vide');
});

test('background music: beats detected and bounces synced', async ({ page }, info) => {
  await openApp(page);
  await openGroupOf(page, 'musicVolume');
  const chooser = page.waitForEvent('filechooser');
  await page.click('button[data-action="music"]');
  await (await chooser).setFiles({ name: 'beat.wav', mimeType: 'audio/wav', buffer: clickTrackWav(120, 10) });
  const info$ = page.locator('.row[data-key="action:music"] .hint');
  await expect(info$).toContainText('BPM', { timeout: 30_000 });
  const bpm = Number(/(\d+) BPM/.exec(await info$.innerText())![1]);
  expect(Math.abs(bpm - 120)).toBeLessThan(4);
  await expect(info$).toContainText('khớp');
  // Video length is capped by the song.
  await quickExportSettings(page, 30);
  await setCheckbox(page, 'sound', false);
  const [path] = await downloads(page, info.outputDir, 1, () => page.click('#btn-export'));
  expect(mp4Tracks(path).sort()).toEqual(['soun', 'vide']);
  await expect(page.locator('#export-status')).toContainText(/✅ .*: (9|10)\.\ds video/);
});

test('controls stay put while the preview canvas is swapped', async ({ page }) => {
  await openApp(page);
  const y0 = (await page.locator('#btn-export').boundingBox())!.y;
  await setSelect(page, 'renderer', 'cpu');
  const ys: number[] = [];
  for (let i = 0; i < 20; i++) {
    ys.push((await page.locator('#btn-export').boundingBox())!.y);
    await page.waitForTimeout(25);
  }
  for (const y of ys) expect(Math.abs(y - y0)).toBeLessThan(1);
});

test('portals, magnet and wind settings run', async ({ page }) => {
  await openApp(page);
  await setCheckbox(page, 'portals', true);
  await setNumber(page, 'magnet', 600);
  await setNumber(page, 'wind', -400);
  await setCheckbox(page, 'stereo', false);
  const cfg = await config(page);
  expect(cfg).toMatchObject({ portals: true, magnet: 600, wind: -400, stereo: false });
  await expect.poll(() => simTime(page)).toBeGreaterThan(2);
});
