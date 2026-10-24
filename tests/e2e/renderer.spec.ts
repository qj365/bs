import { canvasInkRatio, expect, openApp, rendererKind, setSelect, simTime, test } from './helpers';

test('CPU renderer draws every feature', async ({ page }) => {
  await openApp(page);
  await setSelect(page, 'renderer', 'cpu');
  await expect(page.locator('#renderer-badge')).toHaveText('Vẽ: CPU');
  expect(await rendererKind(page)).toBe('cpu');
  for (const [mode, variant] of [['accumulation', ''], ['spiral', ''], ['escape', 'escape-strings'], ['trail', '']]) {
    await page.click(`.mode-card[data-mode="${mode}"]`);
    if (variant) await page.click(`.chip[data-variant="${variant}"]`);
    await expect.poll(() => simTime(page)).toBeGreaterThan(1);
    expect(await canvasInkRatio(page)).toBeGreaterThan(0.01);
  }
});

test('GPU and CPU renderers produce similar pictures', async ({ page }) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="destruction"]');
  await page.click('#btn-play');
  const gpu = await canvasInkRatio(page);
  await setSelect(page, 'renderer', 'cpu');
  await expect(page.locator('#renderer-badge')).toHaveText('Vẽ: CPU');
  await page.click('#btn-play');
  await page.waitForTimeout(300);
  await page.click('#btn-play');
  const cpu = await canvasInkRatio(page);
  expect(gpu).toBeGreaterThan(0.02);
  expect(cpu).toBeGreaterThan(0.02);
});
