import { canvasInkRatio, config, expect, openApp, rendererKind, simTime, test } from './helpers';

const MODES = ['escape', 'infinite', 'grow', 'destruction', 'accumulation', 'collision', 'spiral', 'trail', 'merge', 'koth', 'symmetric'];

test('loads with GPU rendering, encoder info and every mode card', async ({ page, errors }) => {
  await openApp(page);
  await expect(page.locator('.mode-card')).toHaveCount(MODES.length);
  await expect(page.locator('#codec-status')).toContainText('Video:');
  await expect(page.locator('#renderer-badge')).toHaveText('Vẽ: GPU');
  expect(await rendererKind(page)).toBe('gpu');
  // The preview plays on its own.
  await expect.poll(() => simTime(page)).toBeGreaterThan(0.5);
  expect(await canvasInkRatio(page)).toBeGreaterThan(0.01);
  expect(errors).toEqual([]);
});

for (const mode of MODES) {
  test(`mode ${mode} runs and draws`, async ({ page }) => {
    await openApp(page);
    await page.click(`.mode-card[data-mode="${mode}"]`);
    await expect(page.locator(`.mode-card[data-mode="${mode}"]`)).toHaveClass(/active/);
    expect((await config(page)).mode).toBe(mode);
    await expect.poll(() => simTime(page)).toBeGreaterThan(1);
    expect(await canvasInkRatio(page)).toBeGreaterThan(0.01);
    await expect(page.locator('#stats')).toContainText('bóng');
  });
}

test('variants apply their overrides', async ({ page }) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="escape"]');
  await page.click('.chip[data-variant="will-escape"]');
  let cfg = await config(page);
  expect(cfg.spawnOnEscape).toBe(0);
  expect(cfg.title).toBe('Quả bóng có thoát ra được không?');

  await page.click('.chip[data-variant="escape-glass"]');
  cfg = await config(page);
  expect(cfg.ringHp).toBe(40);
  expect(cfg.gapAngle).toBe(0);

  await page.click('.chip[data-variant="default"]');
  cfg = await config(page);
  expect(cfg.ringHp).toBe(0);
  expect(cfg.spawnOnEscape).toBe(2);
});

test('only settings relevant to the mode are shown', async ({ page }) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="spiral"]');
  await expect(page.locator('.row[data-key="spiralTurns"]')).not.toBeHidden();
  await expect(page.locator('.row[data-key="gapAngle"]')).toBeHidden();
  await page.click('.mode-card[data-mode="destruction"]');
  await expect(page.locator('.row[data-key="ringCount"]')).not.toBeHidden();
  await expect(page.locator('.row[data-key="spiralTurns"]')).toBeHidden();
});
