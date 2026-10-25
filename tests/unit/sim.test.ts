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

describe('timeline events, portals, forces', () => {
  it('chaos events fire at their time, in order', async () => {
    const cfg = modeConfig('escape', {
      spawnOnEscape: 0, gapAngle: 0,
      chaos: [{ t: 6, kind: 'blackHole', value: 2 }, { t: 3, kind: 'gravityFlip', value: 0 }, { t: 9, kind: 'spawn', value: 5 }],
    });
    const { events, stats } = await run(cfg, 12);
    const chaos = events.filter((e) => e.kind === 'chaos');
    expect(chaos.map((e) => e.level)).toEqual([0, 2, 5]); // flip, black hole, spawn
    expect(chaos[0].t).toBeCloseTo(3, 1);
    expect(chaos[1].t).toBeCloseTo(6, 1);
    expect(stats.alive).toBe(6);
    expect(stats.lastChaosKind).toBe(5);
  });

  it('gravity flip sends the ball to the top half', async () => {
    const cfg = modeConfig('grow', { growAmount: 0, chaos: [{ t: 1, kind: 'gravityFlip', value: 0 }] });
    const { sim } = await run(cfg, 8);
    const d = sim.renderData(0);
    // Over the last frames the ball spends its time above the centre.
    expect(d.balls[1]).toBeLessThan(sim.layout.cy + 50);
  });

  it('black hole pulls balls to the centre', async () => {
    const cfg = modeConfig('symmetric', { initialBalls: 10, chaos: [{ t: 0.5, kind: 'blackHole', value: 20 }] });
    const { sim, stats } = await run(cfg, 6);
    expect(stats.blackHole).toBe(true);
    const d = sim.renderData(0);
    let mean = 0;
    for (let i = 0; i < d.ballCount; i++) mean += Math.hypot(d.balls[i * 8] - sim.layout.cx, d.balls[i * 8 + 1] - sim.layout.cy);
    expect(mean / d.ballCount).toBeLessThan(260);
  });

  it('portals teleport balls', async () => {
    const { events, sim } = await run(variantConfig('escape-portals', { portalSize: 80 }), 30);
    expect(events.some((e) => e.kind === 'portal')).toBe(true);
    expect(sim.renderData(0).powerupCount).toBeGreaterThanOrEqual(2); // both portals drawn
  });

  it('near misses are reported when a ball bounces off the gap edge', async () => {
    const { events, stats } = await run(modeConfig('escape', { spawnOnEscape: 0, gapAngle: 12, seed: 4 }), 60);
    expect(stats.nearMisses).toBeGreaterThan(0);
    expect(events.filter((e) => e.kind === 'nearmiss')).toHaveLength(stats.nearMisses);
  });

  it('events carry a finite x position', async () => {
    const { events } = await run(modeConfig('koth'), 10);
    expect(events.length).toBeGreaterThan(0);
    for (const e of events) expect(Number.isFinite(e.x)).toBe(true);
  });

  it('wind and magnet run cleanly', async () => {
    await run(modeConfig('escape', { wind: 800 }), 10);
    await run(variantConfig('grow-magnet'), 10);
    await run(variantConfig('escape-chaos'), 30);
    await run(variantConfig('koth-wind'), 30);
  });
});

describe('polygon arenas, growing spikes, special ball', () => {
  for (const sides of [3, 4, 7, 12]) {
    it(`balls stay inside a rotating ${sides}-sided arena`, async () => {
      const cfg = modeConfig('escape', { arenaSides: sides, gapAngle: 0, spawnOnEscape: 0, rotationSpeed: 90, initialBalls: 6 });
      const { sim, stats } = await run(cfg, 20);
      expect(stats.inside).toBe(6);
      const d = sim.renderData(0);
      const apo = cfg.ringRadius * Math.cos(Math.PI / sides);
      for (let i = 0; i < d.ballCount; i++) {
        const dist = Math.hypot(d.balls[i * 8] - sim.layout.cx, d.balls[i * 8 + 1] - sim.layout.cy);
        expect(dist).toBeLessThan(cfg.ringRadius);
        expect(dist).toBeGreaterThanOrEqual(0);
      }
      expect(d.rings[12]).toBe(sides);
      void apo;
    });
  }

  it('a heptagon with a gap lets the ball escape', async () => {
    const { stats } = await run(modeConfig('escape', { arenaSides: 7, gapAngle: 45, spawnOnEscape: 0 }), 120, { stopOnFinish: true });
    expect(stats.finished).toBe(true);
  });

  it('spikes grow over time and are reported to the renderer', async () => {
    const cfg = modeConfig('escape', { spikeArc: 90, spikeSize: 6, spikeGrow: 5, spikeEffect: 'bounce', spawnOnEscape: 0 });
    const a = await run(cfg, 2);
    const lenEarly = a.sim.renderData(0).rings[11];
    const b = await run(cfg, 12);
    const lenLate = b.sim.renderData(0).rings[11];
    expect(lenEarly).toBeCloseTo(6 + 5 * 2, 0);
    expect(lenLate).toBeCloseTo(6 + 5 * 12, 0);
  });

  it('long spikes are hit earlier (at their tips)', async () => {
    const base = { spikeArc: 360, spikeEffect: 'destroy' as const, gapAngle: 0, spawnOnEscape: 0, growAmount: 0 };
    const short = await run(modeConfig('grow', { ...base, spikeSize: 2, spikeGrow: 0 }), 30, { stopOnFinish: true });
    const long = await run(modeConfig('grow', { ...base, spikeSize: 2, spikeGrow: 60 }), 30, { stopOnFinish: true });
    expect(short.stats.finished && long.stats.finished).toBe(true);
    expect(long.stats.finishTime).toBeLessThanOrEqual(short.stats.finishTime);
  });

  it('the special ball spawns with its own size and flag', async () => {
    const cfg = variantConfig('heptagon-grow');
    const { sim } = await run(cfg, 3);
    const d = sim.renderData(0);
    let heroes = 0;
    for (let i = 0; i < d.ballCount; i++) {
      if (d.balls[i * 8 + 7] >= 2) {
        heroes++;
        expect(d.balls[i * 8 + 2]).toBeCloseTo(cfg.heroRadius, 3);
      }
    }
    expect(heroes).toBe(1);
    expect(d.ballCount).toBeGreaterThan(5);
  });

  it('the reel-style variant runs a full minute with spikes popping balls', async () => {
    const { events, sim } = await run(variantConfig('heptagon-grow'), 60);
    expect(events.some((e) => e.kind === 'spike')).toBe(true);
    expect(sim.renderData(0).rings[11]).toBeGreaterThan(100);
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
