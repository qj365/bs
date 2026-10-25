import { describe, expect, it } from 'vitest';
import { ballAt, buildCourse, cameraTarget, stepsToNotes, type MarbleNote, type Vec3 } from '../../src/marble/choreo';
import { DEFAULT_MARBLE, midiToNotes, songNotes, courseOptions, sanitizeMarble } from '../../src/marble/config';

const dist = (a: Vec3, b: Vec3) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function mixed(): MarbleNote[] {
  // Single bounces, a fast run, a long rest, then more bounces.
  const notes: MarbleNote[] = [];
  let t = 1;
  for (let i = 0; i < 6; i++) notes.push({ t: (t += 0.45), midi: [60 + i * 2] });
  for (let i = 0; i < 8; i++) notes.push({ t: (t += 0.1), midi: [72 + (i % 5)] });
  t += 2.5;
  for (let i = 0; i < 5; i++) notes.push({ t: (t += 0.5), midi: [55 + i] });
  return notes;
}

describe('marble course', () => {
  it('puts every note on its own bar, hit at exactly the note time', () => {
    const notes = mixed();
    const c = buildCourse(notes, { seed: 3 });
    expect(c.hits.length).toBe(notes.length);
    expect(c.bars.length).toBe(notes.length);
    c.hits.forEach((h, i) => expect(h.t).toBeCloseTo(notes[i].t, 9));
    expect(c.rails.length).toBe(1);
    expect(c.ramps.length).toBe(1);
  });

  it('ball touches each bar at its hit time', () => {
    const c = buildCourse(mixed(), { seed: 5 });
    for (const bar of c.bars) {
      const p = ballAt(c, bar.hitTime);
      // Distance from the ball centre to the plate's mid-plane ≈ radius + half thickness.
      const d = dist(p, bar.center);
      expect(d).toBeLessThan(c.opts.ballRadius + 0.06 + bar.length / 2);
      expect(Math.abs(dot([p[0] - bar.center[0], p[1] - bar.center[1], p[2] - bar.center[2]], bar.normal))).toBeLessThan(c.opts.ballRadius + 0.05);
    }
  });

  it('path is continuous and bounces reflect off the plate', () => {
    const c = buildCourse(mixed(), { seed: 9 });
    for (let t = c.start; t < c.end; t += 0.01) {
      expect(dist(ballAt(c, t), ballAt(c, t + 0.01))).toBeLessThan(0.3);
    }
    for (const bar of c.bars.filter((b) => !b.inRow)) {
      const before = ballAt(c, bar.hitTime - 0.03);
      const after = ballAt(c, bar.hitTime + 0.03);
      const p = ballAt(c, bar.hitTime);
      // Approaches from the normal side and leaves on the same side.
      const rel = (q: Vec3): Vec3 => [q[0] - p[0], q[1] - p[1], q[2] - p[2]];
      expect(dot(rel(before), bar.normal)).toBeGreaterThan(-1e-3);
      expect(dot(rel(after), bar.normal)).toBeGreaterThan(-1e-3);
    }
  });

  it('is deterministic and the ball goes down overall', () => {
    const a = buildCourse(mixed(), { seed: 4 });
    const b = buildCourse(mixed(), { seed: 4 });
    expect(a.bars.map((x) => x.center)).toEqual(b.bars.map((x) => x.center));
    expect(ballAt(a, a.end)[1]).toBeLessThan(ballAt(a, a.start)[1] - 5);
    expect(cameraTarget(a, 3).every(Number.isFinite)).toBe(true);
  });

  it('handles empty input and built-in songs', () => {
    expect(buildCourse([]).bars.length).toBe(0);
    const notes = songNotes({ ...DEFAULT_MARBLE, repeats: 2 }, null);
    const c = buildCourse(notes, courseOptions(DEFAULT_MARBLE));
    expect(c.hits.length).toBe(notes.length);
    expect(stepsToNotes([[60], [], [62]], 120)).toEqual([{ t: 0, midi: [60] }, { t: 1, midi: [62] }]);
  });

  it('groups MIDI chords and sanitizes config', () => {
    expect(midiToNotes([{ time: 0, midi: 60 }, { time: 0.01, midi: 64 }, { time: 1, midi: 62 }])).toEqual([
      { t: 0, midi: [60, 64] }, { t: 1, midi: [62] },
    ]);
    expect(sanitizeMarble({ bpm: 'x', seed: 3 }).bpm).toBe(DEFAULT_MARBLE.bpm);
    expect(sanitizeMarble({ seed: 3 }).seed).toBe(3);
  });
});
