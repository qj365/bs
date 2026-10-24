import { readFileSync } from 'node:fs';
import {
  config, expect, isPlaying, openApp, openGroupOf, saveDownload, setCheckbox, setNumber, setSelect, simTime, test,
} from './helpers';

test('changing a physics setting restarts, a visual one does not', async ({ page }) => {
  await openApp(page);
  await expect.poll(() => simTime(page)).toBeGreaterThan(2);
  await page.locator('.row[data-key="bgColor"] input').evaluate((el: HTMLInputElement) => {
    el.value = '#203040';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  expect((await config(page)).bgColor).toBe('#203040');
  expect(await simTime(page)).toBeGreaterThan(1.5);

  await setNumber(page, 'ringRadius', 300);
  expect((await config(page)).ringRadius).toBe(300);
  await expect.poll(() => simTime(page)).toBeLessThan(1.5);
});

test('settings search filters the panel', async ({ page }) => {
  await openApp(page);
  await page.fill('#settings-filter', 'watermark');
  await expect(page.locator('.row[data-key="watermark"]')).toBeVisible();
  await expect(page.locator('.row[data-key="ringRadius"]')).toBeHidden();
  await expect(page.locator('details[data-group="physics"]')).toBeHidden();
  await page.fill('#settings-filter', '');
  await expect(page.locator('.row[data-key="ringRadius"]')).toBeVisible();
});

test('seed controls and keyboard shortcuts', async ({ page }) => {
  await openApp(page);
  await page.click('#seed-next');
  expect((await config(page)).seed).toBe(2);
  await page.click('#seed-prev');
  expect((await config(page)).seed).toBe(1);
  await page.fill('#seed-input', '77');
  await page.locator('#seed-input').dispatchEvent('change');
  expect((await config(page)).seed).toBe(77);

  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await page.keyboard.press('ArrowRight');
  expect((await config(page)).seed).toBe(78);
  await page.keyboard.press('n');
  expect((await config(page)).seed).not.toBe(78);

  await expect.poll(() => isPlaying(page)).toBe(true);
  await page.keyboard.press(' ');
  expect(await isPlaying(page)).toBe(false);
  await page.keyboard.press(' ');
  expect(await isPlaying(page)).toBe(true);
});

test('play / pause / restart buttons and timeline seeking', async ({ page }) => {
  await openApp(page);
  await page.click('#btn-play');
  expect(await isPlaying(page)).toBe(false);
  const t = await simTime(page);
  await page.waitForTimeout(500);
  expect(await simTime(page)).toBeCloseTo(t, 3);

  await page.locator('#scrub').evaluate((el: HTMLInputElement) => {
    el.value = '12';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => simTime(page)).toBeCloseTo(12, 1);
  // Seeking backwards replays from zero.
  await page.locator('#scrub').evaluate((el: HTMLInputElement) => {
    el.value = '3';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await expect.poll(() => simTime(page)).toBeCloseTo(3, 1);

  await page.click('#btn-restart');
  expect(await isPlaying(page)).toBe(true);
  expect(await simTime(page)).toBeLessThan(1);
});

test('undo and redo', async ({ page }) => {
  await openApp(page);
  await setNumber(page, 'ringRadius', 250);
  await expect(page.locator('#btn-undo')).toBeEnabled();
  await page.click('#btn-undo');
  expect((await config(page)).ringRadius).toBe(420);
  await page.click('#btn-redo');
  expect((await config(page)).ringRadius).toBe(250);
  await page.locator('body').click({ position: { x: 700, y: 5 } });
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await config(page)).ringRadius).toBe(420);
});

test('safe zone overlay and layout', async ({ page }) => {
  await openApp(page);
  await expect(page.locator('#safe-overlay')).toBeHidden();
  await setCheckbox(page, 'showSafeZone', true);
  await expect(page.locator('#safe-overlay')).toBeVisible();
  await setSelect(page, 'safeZone', 'shorts');
  expect((await config(page)).safeZone).toBe('shorts');
  const h = await page.locator('.sz-bottom').evaluate((el) => (el as HTMLElement).style.height);
  expect(parseFloat(h)).toBeCloseTo((480 / 1920) * 100, 1);
  await setCheckbox(page, 'showSafeZone', false);
  await expect(page.locator('#safe-overlay')).toBeHidden();
});

test('presets: save to JSON and open again, settings persist across reloads', async ({ page }, info) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="koth"]');
  await setNumber(page, 'ballRadius', 22);
  const dl = page.waitForEvent('download');
  await page.click('#btn-save');
  const path = await saveDownload(await dl, info.outputDir);
  const saved = JSON.parse(readFileSync(path, 'utf8'));
  expect(saved.mode).toBe('koth');
  expect(saved.ballRadius).toBe(22);

  await page.click('#btn-reset');
  expect((await config(page)).ballRadius).toBe(34);
  await page.setInputFiles('#file-preset', path);
  await expect.poll(async () => (await config(page)).ballRadius).toBe(22);

  // Autosave: a reload keeps the last settings.
  await page.waitForTimeout(500);
  await page.reload();
  await expect(page.locator('body')).toHaveAttribute('data-ready', 'true');
  expect((await config(page)).mode).toBe('koth');
  expect((await config(page)).ballRadius).toBe(22);
});

test('help dialog lists shortcuts', async ({ page }) => {
  await openApp(page);
  await page.click('#btn-help');
  await expect(page.locator('#help-dialog')).toBeVisible();
  await expect(page.locator('#help-dialog')).toContainText('Phím tắt');
  await page.locator('#help-dialog button').click();
  await expect(page.locator('#help-dialog')).toBeHidden();
  await openGroupOf(page, 'title');
});
