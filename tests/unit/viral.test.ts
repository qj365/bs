import { describe, expect, it } from 'vitest';
import { detectBeats } from '../../src/audio/beats';
import { buildBeatWarp, unwarpTime, warpTime } from '../../src/sync';
import { dramaScore } from '../../src/viral/drama';
import { findLoop, sampleRun } from '../../src/viral/loop';
import { normalize, parsePrompt } from '../../src/viral/prompt';
import { makeCaption } from '../../src/viral/caption';
import { abVariants, coverTime, partPlans, probeFinish } from '../../src/viral/plans';
import { randomChaos } from '../../src/random';
import { Rng } from '../../src/rng';
import type { SimEvent } from '../../src/sim';
import { modeConfig, run, variantConfig, wasm } from './helpers';

function clickTrack(bpm: number, seconds: number, rate = 44100, offset = 0.1): Float32Array {
  const out = new Float32Array(Math.floor(seconds * rate));
  const period = 60 / bpm;
  for (let t = offset; t < seconds; t += period) {
    const i0 = Math.floor(t * rate);
    for (let k = 0; k < 600 && i0 + k < out.length; k++) out[i0 + k] += Math.sin(k * 0.9) * Math.exp(-k / 120);
  }
  return out;
}

describe('beat detection', () => {
  for (const bpm of [90, 120, 140]) {
    it(`finds ${bpm} BPM in a click track`, () => {
      const info = detectBeats([clickTrack(bpm, 12)], 44100);
      expect(Math.abs(info.bpm - bpm)).toBeLessThan(3);
      const period = 60 / bpm;
      // Beats line up with the clicks (offset 0.1 s) within 30 ms.
      const errs = info.beats.slice(2, -2).map((b) => {
        const phase = ((b - 0.1) % period + period) % period;
        return Math.min(phase, period - phase);
      });
      expect(Math.max(...errs)).toBeLessThan(0.03);
    });
  }
});

describe('time warp', () => {
  it('warp and unwarp are inverse and monotonic', () => {
    const w = [0, 0, 1, 1.5, 2, 2.2, 3, 4];
    for (let v = 0; v < 6; v += 0.13) {
      expect(unwarpTime(w, warpTime(w, v))).toBeCloseTo(v, 6);
      expect(warpTime(w, v + 0.01)).toBeGreaterThan(warpTime(w, v));
    }
    expect(warpTime(null, 3)).toBe(3);
  });

  it('puts bounces exactly on beats with limited speed changes', () => {
    const rng = new Rng(3);
    const bounces: number[] = [];
    for (let t = 0.3; t < 60; t += 0.25 + rng.next() * 0.6) bounces.push(t);
    const beats = Array.from({ length: 60 }, (_, k) => 0.5 + k * 0.5);
    const bw = buildBeatWarp(bounces, beats, 0, 30);
    expect(bw.matched / bw.considered).toBeGreaterThan(0.7);
    // Every anchor maps a beat to a bounce.
    for (let i = 2; i < bw.warp.length; i += 2) {
      expect(beats).toContain(bw.warp[i]);
      expect(bounces).toContain(bw.warp[i + 1]);
      const speed = (bw.warp[i + 1] - bw.warp[i - 1]) / (bw.warp[i] - bw.warp[i - 2]);
      expect(speed).toBeGreaterThan(0.5);
      expect(speed).toBeLessThan(1.9);
    }
  });
});

describe('drama score', () => {
  const ev = (t: number, kind: SimEvent['kind']): SimEvent => ({ t, kind, strength: 500, r: 10, level: 0, team: 0, x: 0 });

  it('rewards late near misses and last-second escapes', () => {
    const cfg = modeConfig('escape', { spawnOnEscape: 0 });
    const calm = dramaScore(cfg, [ev(5, 'bounce'), ev(10, 'bounce'), ev(20, 'bounce')], 20, 20);
    const tense = dramaScore(cfg, [ev(5, 'bounce'), ev(15, 'nearmiss'), ev(17, 'nearmiss'), ev(19.2, 'nearmiss')], 20, 20);
    expect(tense.score).toBeGreaterThan(calm.score + 5);
    expect(tense.why.join(' ')).toMatch(/suýt/);
  });

  it('drama search ranks real runs', async () => {
    const cfg = modeConfig('escape', { spawnOnEscape: 0, gapAngle: 14 });
    const scores: number[] = [];
    for (let seed = 1; seed <= 8; seed++) {
      const { events, stats } = await run({ ...cfg, seed }, 40, { stopOnFinish: true });
      scores.push(dramaScore(cfg, events, stats.finished ? stats.finishTime : -1, 25).score);
    }
    expect(new Set(scores).size).toBeGreaterThan(3);
  });
});

describe('seamless loops', () => {
  it('finds a near-identical start and end frame for a single bouncing ball', async () => {
    const cfg = modeConfig('grow', { growAmount: 0, ringRainbow: false, trailLength: 0 });
    const { samples, sim } = await sampleRun(cfg, 60, await wasm());
    const loop = findLoop(cfg, samples, 4, 15, sim.layout.W);
    expect(loop).not.toBeNull();
    expect(loop!.end - loop!.start).toBeGreaterThanOrEqual(4);
    expect(loop!.error).toBeLessThan(40);
  });
});

describe('prompt parser', () => {
  it('reads a Vietnamese description', () => {
    const p = parsePrompt('Bóng lớn dần có gai, màu neon, đàn piano, khoảng 30 giây');
    expect(p.mode).toBe('grow');
    expect(p.palette?.name).toBe('Neon đêm');
    expect(p.instrument).toBe('piano');
    expect(p.overrides.spikeArc).toBe(90);
    expect(p.minSeconds).toBeLessThan(30);
    expect(p.maxSeconds).toBeGreaterThan(30);
  });

  it('reads an English description with teams, range, twists and a quoted title', () => {
    const p = parsePrompt('4 teams battle, sunset colors, black hole and gravity flip, english, 20-40s, "Which colour wins?"');
    expect(p.mode).toBe('koth');
    expect(p.overrides.initialBalls).toBe(4);
    expect(p.palette?.name).toBe('Hoàng hôn');
    expect(p.lang).toBe('en');
    expect([p.minSeconds, p.maxSeconds]).toEqual([20, 40]);
    expect(p.title).toBe('Which colour wins?');
    expect(p.overrides.chaos?.map((c) => c.kind)).toEqual(['gravityFlip', 'blackHole']);
  });

  it('handles portals, split screen, glass and explosions', () => {
    expect(parsePrompt('2 quả bóng va chạm nổ 500 bóng').overrides.explodeCount).toBe(500);
    expect(parsePrompt('chia màn hình đấu đôi').overrides.battle).toBe(2);
    expect(parsePrompt('cổng dịch chuyển, vòng kính').overrides).toMatchObject({ portals: true, ringHp: 50 });
    expect(normalize('Đổi Dấu Tiếng Việt')).toBe('doi dau tieng viet');
  });
});

describe('captions, parts, A/B', () => {
  it('captions include hook, call to action and hashtags', () => {
    const c = makeCaption(modeConfig('koth', { title: 'Màu nào thắng?' }), 'vi');
    expect(c).toContain('Màu nào thắng?');
    expect(c).toContain('#kingofthehill');
    expect(c).toContain('#xuhuong');
    expect(makeCaption(modeConfig('escape'), 'en')).not.toContain('#xuhuong');
  });

  it('part plans cut right before the ending and overlap with a recap', () => {
    const p = partPlans(20, 30, 2, 'vi', null);
    expect(p.part1.end).toBeCloseTo(18.8, 5);
    expect(p.part1.overlay?.text).toContain('phần 2');
    expect(p.part2.start).toBeCloseTo(16.8, 5);
    expect(p.part2.end).toBe(22);
    expect(partPlans(-1, 30, 2, 'en', null).part1.end).toBeCloseTo(18, 5);
    expect(coverTime(20, 30)).toBeCloseTo(19.7, 5);
  });

  it('A/B variants keep physics and change only hook or colours', () => {
    const cfg = modeConfig('escape', { seed: 7 });
    const v = abVariants(cfg, 'both', 3, 'vi');
    expect(v.map((x) => x.label)).toEqual(['A', 'B', 'C']);
    expect(new Set(v.map((x) => x.cfg.title)).size).toBe(3);
    expect(new Set(v.map((x) => x.cfg.bgColor)).size).toBe(3);
    for (const x of v) expect({ seed: x.cfg.seed, g: x.cfg.gravity }).toEqual({ seed: 7, g: cfg.gravity });
  });

  it('probeFinish matches a full run, also for battles', async () => {
    const cfg = variantConfig('will-escape', { gapAngle: 40 });
    const { stats } = await run(cfg, 60, { stopOnFinish: true });
    const t = await probeFinish({ ...cfg, duration: 60 }, null, await wasm());
    expect(Math.abs(t - stats.finishTime)).toBeLessThan(0.3);
    const battle = await probeFinish({ ...cfg, battle: 2, duration: 60 }, null, await wasm());
    expect(battle).toBeGreaterThan(0);
  });

  it('random timelines are sorted-ish and within the video', () => {
    const rng = new Rng(2);
    for (let i = 0; i < 20; i++) {
      const c = randomChaos(() => rng.next(), 30, 'escape');
      expect(c.length).toBeGreaterThanOrEqual(2);
      for (const e of c) expect(e.t).toBeLessThan(40);
    }
  });
});
