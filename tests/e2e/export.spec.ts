import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import {
  config, expect, mp4Boxes, mp4Tracks, openApp, quickExportSettings, saveDownload, setCheckbox, setSelect, test,
} from './helpers';

function ffprobe(path: string): string | null {
  try {
    return execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height', '-of', 'csv=p=0', path]).toString();
  } catch {
    return null; // ffprobe not installed — the container checks below still apply.
  }
}

test('exports a valid MP4 with video and audio', async ({ page }, info) => {
  await openApp(page);
  await quickExportSettings(page, 2);
  const dl = page.waitForEvent('download', { timeout: 110_000 });
  await page.click('#btn-export');
  const path = await saveDownload(await dl, info.outputDir);
  expect(path).toMatch(/ball-escape-seed1\.mp4$/);
  expect(statSync(path).size).toBeGreaterThan(10_000);
  const boxes = mp4Boxes(path);
  expect(boxes[0]).toBe('ftyp');
  expect(boxes).toContain('moov');
  expect(boxes).toContain('mdat');
  expect(mp4Tracks(path).sort()).toEqual(['soun', 'vide']);
  await expect(page.locator('#export-status')).toContainText('✅');
  const probe = ffprobe(path);
  if (probe) {
    expect(probe).toContain('video,720,1280');
    expect(probe).toContain('audio');
  }
});

test('exports with the CPU renderer and CPU encoder, without sound', async ({ page }, info) => {
  await openApp(page);
  await quickExportSettings(page, 1);
  await setSelect(page, 'renderer', 'cpu');
  await setSelect(page, 'encoder', 'cpu');
  await setCheckbox(page, 'sound', false);
  const dl = page.waitForEvent('download', { timeout: 110_000 });
  await page.click('#btn-export');
  const path = await saveDownload(await dl, info.outputDir);
  expect(mp4Tracks(path)).toEqual(['vide']);
  await expect(page.locator('#export-status')).toContainText('vẽ CPU');
  await expect(page.locator('#export-status')).toContainText('(CPU)');
});

test('dual export produces a TikTok and a Shorts file', async ({ page }, info) => {
  await openApp(page);
  await quickExportSettings(page, 1);
  const names: string[] = [];
  page.on('download', (d) => names.push(d.suggestedFilename()));
  await page.click('#btn-dual');
  await expect.poll(() => names.length, { timeout: 110_000 }).toBe(2);
  expect(names).toEqual(['ball-escape-seed1-tiktok.mp4', 'ball-escape-seed1-shorts.mp4']);
  void info;
});

test('a running export can be cancelled', async ({ page }) => {
  await openApp(page);
  await quickExportSettings(page, 60);
  await page.click('#btn-export');
  await expect(page.locator('#btn-cancel')).toBeVisible();
  await expect(page.locator('#export-status')).toContainText('Đang render', { timeout: 30_000 });
  await page.click('#btn-cancel');
  await expect(page.locator('#export-status')).toContainText('Đã hủy');
  await expect(page.locator('#btn-export')).toBeEnabled();
  expect((await config(page)).duration).toBe(60);
});
