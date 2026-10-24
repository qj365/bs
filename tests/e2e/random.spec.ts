import { config, expect, openApp, quickExportSettings, saveDownload, test } from './helpers';

async function setRange(page: import('@playwright/test').Page, min: number, max: number): Promise<void> {
  await page.fill('#rand-min', String(min));
  await page.fill('#rand-max', String(max));
}

test('random video: new settings that end inside the chosen length', async ({ page }) => {
  await openApp(page);
  const before = await config(page);
  await setRange(page, 6, 20);
  await page.click('#btn-random');
  await expect(page.locator('#random-status')).toContainText('✅', { timeout: 60_000 });
  const after = await config(page);
  expect(after.seed).not.toBe(before.seed);
  // Either a finishing run trimmed just past its end, or a free-running one inside the range.
  expect(after.duration as number).toBeGreaterThanOrEqual(6);
  expect(after.duration as number).toBeLessThanOrEqual(20 + (after.endHold as number) + 1);
  const status = await page.locator('#random-status').innerText();
  const m = /kết thúc ([\d.]+)s/.exec(status);
  if (m) {
    const end = Number(m[1]);
    expect(end).toBeGreaterThanOrEqual(6);
    expect(end).toBeLessThanOrEqual(20);
    await expect(page.locator('#stats')).toContainText(`kết thúc ở ${end.toFixed(1)}s`, { timeout: 40_000 });
  }
  // Undo goes back to the previous video.
  await page.waitForTimeout(500);
  await page.click('#btn-undo');
  await expect.poll(async () => (await config(page)).seed).toBe(before.seed);
});

test('locks keep their group unchanged', async ({ page }) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="koth"]');
  await page.check('#lock-mode');
  await page.check('#lock-look');
  const before = await config(page);
  for (let i = 0; i < 3; i++) {
    await page.click('#btn-random');
    await expect(page.locator('#random-status')).toContainText('✅', { timeout: 60_000 });
    const after = await config(page);
    expect(after.mode).toBe('koth');
    expect(after.ringRadius).toBe(before.ringRadius);
    expect(after.bgColor).toBe(before.bgColor);
  }
  // Lock choices are remembered.
  await page.reload();
  await expect(page.locator('#lock-mode')).toBeChecked();
  await expect(page.locator('#lock-audio')).not.toBeChecked();
});

test('English hooks and the G shortcut', async ({ page }) => {
  await openApp(page);
  await page.selectOption('#rand-lang', 'en');
  await page.check('#lock-mode');
  await page.click('.mode-card[data-mode="collision"]');
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await page.keyboard.press('g');
  await expect(page.locator('#random-status')).toContainText('✅', { timeout: 60_000 });
  const cfg = await config(page);
  expect(cfg.mode).toBe('collision');
  expect(['When the two balls collide…', 'Wait for the collision', "Don't miss the ending!"]).toContain(cfg.title);
  expect(cfg.endText).toBe('BOOM!');
});

test('make & export random videos in a batch', async ({ page }, info) => {
  await openApp(page);
  await quickExportSettings(page, 3);
  await setRange(page, 3, 5);
  await page.fill('#random-count', '2');
  const names: string[] = [];
  const saved: Promise<string>[] = [];
  page.on('download', (d) => {
    names.push(d.suggestedFilename());
    saved.push(saveDownload(d, info.outputDir));
  });
  await page.click('#btn-random-batch');
  await expect.poll(() => names.length, { timeout: 115_000 }).toBe(2);
  expect(names[0]).toMatch(/-random1\.mp4$/);
  expect(names[1]).toMatch(/-random2\.mp4$/);
  await Promise.all(saved);
  await expect(page.locator('#btn-random-batch')).toBeEnabled();
});
