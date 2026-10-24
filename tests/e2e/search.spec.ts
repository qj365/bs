import { config, expect, openApp, simTime, test } from './helpers';

test('seed search finds runs that end near the target and applies one', async ({ page }) => {
  await openApp(page);
  await page.click('.mode-card[data-mode="collision"]');
  await page.selectOption('#search-kind', 'duration');
  await page.fill('#search-value', '10');
  await page.fill('#search-count', '40');
  await page.click('#btn-search');
  await expect(page.locator('#search-status')).toContainText('Xong', { timeout: 60_000 });
  const results = page.locator('#search-results button.result');
  await expect(results.first()).toBeVisible();
  const seed = Number(await results.first().getAttribute('data-seed'));
  const text = await results.first().innerText();
  const finish = Number(/kết thúc ([\d.]+)s/.exec(text)![1]);
  expect(Math.abs(finish - 10)).toBeLessThan(5);

  await results.first().click();
  expect((await config(page)).seed).toBe(seed);
  // The preview reaches the predicted end (collision → "BÙM!").
  await expect(page.locator('#stats')).toContainText(`kết thúc ở ${finish.toFixed(1)}s`, { timeout: 40_000 });
  expect(await simTime(page)).toBeGreaterThan(finish - 0.1);
});

test('note-count target defaults to the melody length', async ({ page }) => {
  await openApp(page);
  await page.selectOption('#search-kind', 'notes');
  await expect(page.locator('#search-value')).toHaveValue('62');
});

test('seed search can be stopped', async ({ page }) => {
  await openApp(page);
  await page.fill('#search-count', '20000');
  await page.click('#btn-search');
  await expect(page.locator('#btn-search-stop')).toBeVisible();
  await page.click('#btn-search-stop');
  await expect(page.locator('#btn-search')).toBeEnabled({ timeout: 30_000 });
});
