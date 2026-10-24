import { createRequire } from 'node:module';
import { config, expect, openApp, openGroupOf, setSelect, test } from './helpers';

// @tonejs/midi is CommonJS; load it the CommonJS way in the Node test runner.
const { Midi } = createRequire(import.meta.url)('@tonejs/midi') as typeof import('@tonejs/midi');

function makeMidi(): Buffer {
  const midi = new Midi();
  const track = midi.addTrack();
  [60, 62, 64, 65, 67].forEach((n, i) => track.addNote({ midi: n, time: i * 0.25, duration: 0.2 }));
  track.addNote({ midi: 72, time: 1.25, duration: 0.2 });
  track.addNote({ midi: 76, time: 1.25, duration: 0.2 }); // chord with the previous note
  return Buffer.from(midi.toArray());
}

function makeWav(seconds = 0.3, freq = 440): Buffer {
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
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * freq * i) / rate) * 12000 * (1 - i / n)), 44 + i * 2);
  return buf;
}

test('melody editor: draw notes and use them', async ({ page }) => {
  await openApp(page);
  await openGroupOf(page, 'instrument');
  await page.click('button[data-action="editor"]');
  const dialog = page.locator('dialog.midi-editor');
  await expect(dialog).toBeVisible();
  await dialog.locator('[data-act="clear"]').click();
  await expect(dialog.locator('.me-info')).toContainText('0 có nốt');
  const canvas = dialog.locator('canvas');
  const box = (await canvas.boundingBox())!;
  // Two clicks in different columns (keys column is 44px, cells 24×18).
  await page.mouse.click(box.x + 44 + 24 * 0 + 12, box.y + 18 * 10 + 9);
  await page.mouse.click(box.x + 44 + 24 * 1 + 12, box.y + 18 * 12 + 9);
  await expect(dialog.locator('.me-info')).toContainText('2 có nốt');
  await dialog.locator('[data-act="play"]').click();
  await dialog.locator('[data-act="stop"]').click();
  await dialog.locator('[data-act="save"]').click();
  await expect(dialog).toBeHidden();
  const cfg = await config(page);
  expect(cfg.melodyName).toBe('custom');
  expect(cfg.melody).toEqual([[84 - 10], [84 - 12]]);
});

test('melody editor: import a MIDI file with chords', async ({ page }) => {
  await openApp(page);
  await openGroupOf(page, 'instrument');
  await page.click('button[data-action="editor"]');
  const dialog = page.locator('dialog.midi-editor');
  await dialog.locator('input[data-act="midi"]').setInputFiles({ name: 'song.mid', mimeType: 'audio/midi', buffer: makeMidi() });
  await expect(dialog.locator('.me-info')).toContainText('6 có nốt');
  await dialog.locator('[data-act="save"]').click();
  const cfg = await config(page);
  expect(cfg.melody).toEqual([[60], [62], [64], [65], [67], [72, 76]]);
});

test('built-in melody can be loaded into the editor', async ({ page }) => {
  await openApp(page);
  await openGroupOf(page, 'instrument');
  await page.click('button[data-action="editor"]');
  const dialog = page.locator('dialog.midi-editor');
  await dialog.locator('select[data-act="load"]').selectOption('twinkle');
  await expect(dialog.locator('.me-info')).toContainText('42 bước');
  await dialog.locator('[data-act="cancel"]').click();
  expect((await config(page)).melodyName).toBe('ode');
});

test('a user sound file becomes the instrument', async ({ page }) => {
  await openApp(page);
  await openGroupOf(page, 'instrument');
  const chooser = page.waitForEvent('filechooser');
  await page.click('button[data-action="sample"]');
  await (await chooser).setFiles({ name: 'ding.wav', mimeType: 'audio/wav', buffer: makeWav() });
  await expect.poll(async () => (await config(page)).instrument).toBe('sample');
  await expect(page.locator('.row[data-key="action:sample"] .hint')).toContainText('ding.wav');
  // Every built-in instrument can be selected.
  for (const inst of ['piano', 'bell', 'musicbox', 'harp', 'guitar', 'pluck', 'organ', 'synth', 'pop', 'chip', 'marimba']) {
    await setSelect(page, 'instrument', inst);
  }
  await page.click('#btn-restart');
});
