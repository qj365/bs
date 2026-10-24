import { describe, expect, it } from 'vitest';
import { cloneConfig, DEFAULT_CONFIG, MODE_INFO, sanitizeConfig, type Config, type Mode } from '../../src/config';
import { modeFinishes, PALETTES, randomConfig, type RandomLocks } from '../../src/random';
import { Rng } from '../../src/rng';
import { run } from './helpers';

const NO_LOCKS: RandomLocks = { mode: false, look: false, audio: false, text: false };
const OUTPUT_KEYS: (keyof Config)[] = ['resolution', 'fps', 'bitrate', 'renderer', 'encoder', 'safeZone', 'watermark', 'previewScale'];

function base(): Config {
  const c = cloneConfig(DEFAULT_CONFIG);
  c.resolution = '720x1280';
  c.fps = 30;
  c.bitrate = 7;
  c.renderer = 'cpu';
  c.encoder = 'gpu';
  c.safeZone = 'shorts';
  c.watermark = '@kenh';
  return c;
}

describe('randomConfig', () => {
  it('produces valid configs, reaches every mode and keeps output settings', () => {
    const rng = new Rng(1);
    const seen = new Set<Mode>();
    const palettes = new Set<string>();
    for (let i = 0; i < 400; i++) {
      const { cfg, summary } = randomConfig(base(), NO_LOCKS, 'vi', () => rng.next());
      expect(sanitizeConfig(JSON.parse(JSON.stringify(cfg)))).toEqual(cfg);
      expect(Object.keys(MODE_INFO)).toContain(cfg.mode);
      for (const k of OUTPUT_KEYS) expect(cfg[k], k).toEqual(base()[k]);
      expect(summary.length).toBeGreaterThan(5);
      expect(cfg.ringRadius).toBeLessThanOrEqual(480);
      expect(cfg.ballRadius).toBeGreaterThanOrEqual(4);
      seen.add(cfg.mode);
      palettes.add(cfg.bgColor);
    }
    expect(seen.size).toBe(Object.keys(MODE_INFO).length);
    expect(palettes.size).toBeGreaterThan(PALETTES.length / 2);
  });

  it('the summary matches what was applied (variant team count is kept)', () => {
    const rng = new Rng(21);
    for (let i = 0; i < 300; i++) {
      const { cfg, summary } = randomConfig(base(), NO_LOCKS, 'vi', () => rng.next());
      if (summary.includes('8 đội')) expect(cfg.initialBalls).toBe(8);
      if (summary.includes('Vòng kính')) expect(cfg.ringHp).toBeGreaterThan(0);
    }
  });

  it('is reproducible from the same random source', () => {
    const a = new Rng(5), b = new Rng(5);
    expect(randomConfig(base(), NO_LOCKS, 'en', () => a.next()).cfg).toEqual(randomConfig(base(), NO_LOCKS, 'en', () => b.next()).cfg);
  });

  it('respects every lock', () => {
    const start = base();
    start.mode = 'spiral';
    Object.assign(start, { ringRadius: 333, bgColor: '#123456', instrument: 'organ', melodyName: 'canon', title: 'Giữ nguyên' });
    const all = randomConfig(start, { mode: true, look: true, audio: true, text: true }, 'vi');
    expect({ ...all.cfg, seed: 0 }).toEqual({ ...start, seed: 0 });

    const rng = new Rng(3);
    for (let i = 0; i < 50; i++) {
      const r = () => rng.next();
      expect(randomConfig(start, { ...NO_LOCKS, mode: true }, 'vi', r).cfg).toMatchObject({ mode: 'spiral', ringRadius: 333 });
      expect(randomConfig(start, { ...NO_LOCKS, look: true }, 'vi', r).cfg).toMatchObject({ bgColor: '#123456', colorMode: start.colorMode, glow: start.glow });
      expect(randomConfig(start, { ...NO_LOCKS, audio: true }, 'vi', r).cfg).toMatchObject({ instrument: 'organ', melodyName: 'canon' });
      expect(randomConfig(start, { ...NO_LOCKS, text: true }, 'vi', r).cfg).toMatchObject({ title: 'Giữ nguyên', endText: start.endText, counterLabel: start.counterLabel });
    }
  });

  it('writes hooks in the chosen language', () => {
    const rng = new Rng(9);
    for (let i = 0; i < 60; i++) {
      const { cfg } = randomConfig(base(), NO_LOCKS, 'en', () => rng.next());
      expect(cfg.title).not.toMatch(/[ăâđêôơưạảấầẩẫậắằẳẵặẹẻẽếềểễệỉịọỏốồổỗộớờởỡợụủứừửữựỳỵỷỹ]/i);
      if (cfg.mode === 'koth') expect(cfg.endText).toContain('{winner}');
    }
  });

  it('every random config simulates cleanly', async () => {
    const rng = new Rng(11);
    for (let i = 0; i < 40; i++) {
      const { cfg } = randomConfig(base(), NO_LOCKS, 'vi', () => rng.next());
      const { stats } = await run(cfg, 8);
      expect(stats.time, `${cfg.mode} seed ${cfg.seed}`).toBeGreaterThan(7.9);
    }
  });

  it('knows which modes end on their own', () => {
    const c = base();
    for (const [mode, finishes] of [['escape', true], ['collision', true], ['symmetric', false], ['merge', false]] as const) {
      expect(modeFinishes({ ...c, mode })).toBe(finishes);
    }
    expect(modeFinishes({ ...c, mode: 'trail', growAmount: 0 })).toBe(false);
  });
});
