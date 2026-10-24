import { describe, expect, it } from 'vitest';
import { MODE_DEFAULTS, VARIANTS, type Mode } from '../../src/config';
import { Simulation, counterValue, endMessage } from '../../src/sim';
import { modeConfig, run, variantConfig, wasm } from './helpers';

const ALL_MODES = Object.keys(MODE_DEFAULTS) as Mode[];

describe('every mode', () => {
  for (const mode of ALL_MODES) {
    it(`${mode}: runs 40s with finite state and renders`, async () => {
      const cfg = modeConfig(mode);
      const { sim, stats } = await run(cfg, 40);
      expect(stats.time).toBeGreaterThan(39.9);
      const data = sim.renderData(cfg.trailLength);
      expect(data.ballCount + data.particleCount).toBeGreaterThanOrEqual(0);
      if (mode === 'spiral') expect(data.wallCount).toBeGreaterThan(100);
      else expect(data.ringCount + Number(stats.finished)).toBeGreaterThan(0);
      expect(typeof counterValue(cfg, stats)).toBe('string');
    });
  }

  for (const v of VARIANTS) {
    it(`variant ${v.id} runs`, async () => {
      const { stats } = await run(variantConfig(v.id), 15);
      expect(stats.time).toBeGreaterThan(14.9);
    });
  }
});

describe('end conditions', () => {
  it('classic "will it escape" finishes when the ball escapes', async () => {
    const { stats, events } = await run(variantConfig('will-escape', { gapAngle: 40 }), 120, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(events.some((e) => e.kind === 'escape')).toBe(true);
  });

  it('infinite loop finishes at the ball cap and never loses balls', async () => {
    const { stats } = await run(modeConfig('infinite', { maxBalls: 60 }), 120, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(stats.inside).toBeGreaterThanOrEqual(60);
  });

  it('grow finishes when the ball fills the ring', async () => {
    const { stats } = await run(modeConfig('grow', { growAmount: 10 }), 120, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(stats.fillPercent).toBeGreaterThanOrEqual(99);
  });

  it('grow + spikes ends when the ball touches the spikes', async () => {
    const { stats, events } = await run(variantConfig('grow-spikes', { spikeArc: 120 }), 120, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(events.some((e) => e.kind === 'spike')).toBe(true);
  });

  it('spikes on a closed ring start at the top, so the first fall is safe', async () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { stats } = await run(variantConfig('grow-spikes', { seed }), 4, { stopOnFinish: true });
      expect(stats.finished, `seed ${seed}`).toBe(false);
    }
  });

  it('destruction breaks every ring', async () => {
    const { stats } = await run(modeConfig('destruction', { ringCount: 6 }), 120, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(stats.ringsBroken).toBe(6);
  });

  it('accumulation freezes balls on spikes, then the glass shatters', async () => {
    const { stats, events } = await run(modeConfig('accumulation', { ringHp: 25 }), 120, { stopOnFinish: true });
    expect(events.some((e) => e.kind === 'spike')).toBe(true);
    expect(events.some((e) => e.kind === 'break')).toBe(true);
    expect(stats.finished).toBe(true);
  });

  it('collision explodes into many balls', async () => {
    const cfg = modeConfig('collision', { explodeCount: 120 });
    const { stats, events } = await run(cfg, 60, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(events.some((e) => e.kind === 'explode')).toBe(true);
    expect(stats.alive).toBe(120);
    expect(endMessage(cfg, stats)).toBe('BÙM!');
  });

  it('spiral carries the ball out and breaks gems', async () => {
    const { stats, events } = await run(modeConfig('spiral'), 180, { stopOnFinish: true });
    expect(events.some((e) => e.kind === 'gem')).toBe(true);
    expect(stats.finished).toBe(true);
  });

  it('king of the hill names a winner', async () => {
    const cfg = modeConfig('koth');
    const { stats } = await run(cfg, 180, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
    expect(stats.winnerTeam).toBeGreaterThanOrEqual(0);
    expect(stats.winnerTeam).toBeLessThan(4);
    expect(endMessage(cfg, stats)).toMatch(/THẮNG/);
  });

  it('merge scores points', async () => {
    const { stats, events } = await run(modeConfig('merge'), 30);
    expect(events.some((e) => e.kind === 'merge')).toBe(true);
    expect(stats.counter).toBeGreaterThan(0);
  });
});

describe('extras', () => {
  it('power-ups get picked up', async () => {
    const { events } = await run(variantConfig('escape-powerups', { powerupInterval: 0.5 }), 40);
    expect(events.some((e) => e.kind === 'powerup')).toBe(true);
  });

  it('impact lines are produced', async () => {
    const cfg = variantConfig('escape-strings');
    const { sim } = await run(cfg, 10);
    expect(sim.renderData(0).lineCount).toBeGreaterThan(0);
  });

  it('glass ring breaks after its hit points', async () => {
    const { events } = await run(variantConfig('escape-glass', { ringHp: 10 }), 60, { stopOnFinish: true });
    expect(events.filter((e) => e.kind === 'break')).toHaveLength(1);
  });
});

describe('determinism', () => {
  const signature = (events: { t: number; kind: string; strength: number }[]) =>
    events.map((e) => `${e.t.toFixed(5)}:${e.kind}:${e.strength.toFixed(3)}`).join('|');

  for (const mode of ALL_MODES) {
    it(`${mode}: same seed → identical events`, async () => {
      const a = await run(modeConfig(mode, { seed: 42 }), 15);
      const b = await run(modeConfig(mode, { seed: 42 }), 15);
      expect(signature(b.events)).toBe(signature(a.events));
    });
  }

  it('different seeds diverge', async () => {
    const a = await run(modeConfig('escape', { seed: 1 }), 15);
    const b = await run(modeConfig('escape', { seed: 2 }), 15);
    expect(signature(b.events)).not.toBe(signature(a.events));
  });

  it('reset() on a reused instance equals a fresh instance', async () => {
    const cfg = modeConfig('destruction', { seed: 9 });
    const fresh = await run(cfg, 10);
    const reused = await Simulation.fromModule(await wasm(), modeConfig('merge'));
    await run(modeConfig('merge'), 3, { sim: reused });
    const again = await run(cfg, 10, { sim: reused });
    expect(signature(again.events)).toBe(signature(fresh.events));
  });
});

describe('performance', () => {
  it('simulates 2000 balls for 30s quickly', async () => {
    const cfg = modeConfig('escape', { maxBalls: 2000, spawnOnEscape: 3, ballRadius: 6, trailLength: 0 });
    const t0 = performance.now();
    const { stats } = await run(cfg, 30);
    const ms = performance.now() - t0;
    expect(stats.alive).toBeGreaterThan(500);
    expect(ms).toBeLessThan(5000);
  });
});
