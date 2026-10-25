/**
 * Marble music choreography: designs a falling-marble course *backwards from the
 * music*. Every note becomes a hit at exactly its time, so the video is always in
 * sync — no simulation, no seed hunting. Between hits the ball flies on an exact
 * parabola, so its position is a closed-form function of time (instant seeking).
 *
 * World: Y is up, the ball falls down a shaft; bars sit on both sides (±X).
 */
import { Rng } from '../rng';

export type Vec3 = [number, number, number];

export interface MarbleNote {
  t: number;
  midi: number[];
}

export interface CourseOptions {
  seed: number;
  gravity: number;
  /** Half width of the shaft: bars sit around x = ±width. */
  width: number;
  /** Average downward speed between hits (units/s). */
  descent: number;
  ballRadius: number;
  /** Notes closer than this become a row of bars the ball rolls over. */
  rollGap: number;
  /** Rests longer than this are bridged by a curved ramp. */
  restGap: number;
  /** Seconds of free fall before the first note and after the last. */
  lead: number;
  tail: number;
  /** Notes at or above this MIDI pitch use the second instrument. */
  splitPitch: number;
  /** How the bounce points are laid out. */
  layout: CourseLayout;
}

/**
 * zigzag: two columns, the ball bounces left/right · spiral: bars wind around the
 * shaft · scatter: bars float at random spots · stairs: every phrase is a rolling row.
 */
export type CourseLayout = 'zigzag' | 'spiral' | 'scatter' | 'stairs';

export const DEFAULT_COURSE: CourseOptions = {
  seed: 1,
  gravity: 6,
  width: 0.45,
  descent: 0.75,
  ballRadius: 0.11,
  rollGap: 0.14,
  restGap: 1.6,
  lead: 0.9,
  tail: 2.5,
  splitPitch: 72,
  layout: 'zigzag',
};

export type BarKind = 'wood' | 'white';

/** A struck bar: plate centre, orientation, size and when it is hit. */
export interface Bar {
  center: Vec3;
  /** Plate normal (the side the ball hits). */
  normal: Vec3;
  /** Long axis of the plate. */
  axis: Vec3;
  length: number;
  width: number;
  kind: BarKind;
  hitTime: number;
  notes: number[];
  /** Part of a rolling row (lies flat on a rail). */
  inRow: boolean;
}

export interface Rail {
  from: Vec3;
  to: Vec3;
}

export interface Ramp {
  center: Vec3;
  radius: number;
  /** Arc in the vertical X–Y plane from angle a0 to a1 (radians). */
  a0: number;
  a1: number;
  z: number;
}

export interface Hit {
  t: number;
  notes: number[];
  kind: BarKind;
  /** Horizontal position, -1 (left) … 1 (right), for stereo. */
  pan: number;
  /** Struck while rolling along a row. */
  row: boolean;
}

export type Segment =
  | { type: 'fly'; t0: number; t1: number; p0: Vec3; v0: Vec3 }
  | { type: 'line'; t0: number; t1: number; p0: Vec3; v: Vec3 }
  | { type: 'arc'; t0: number; t1: number; c: Vec3; r: number; a0: number; a1: number; z: number };

export interface Course {
  bars: Bar[];
  rails: Rail[];
  ramps: Ramp[];
  hits: Hit[];
  segments: Segment[];
  start: number;
  end: number;
  opts: CourseOptions;
}

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const norm = (a: Vec3): Vec3 => {
  const l = len(a);
  return l > 1e-9 ? mul(a, 1 / l) : [0, 1, 0];
};
const cross = (a: Vec3, b: Vec3): Vec3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

/** Position on a free-flight parabola. */
function flyAt(p0: Vec3, v0: Vec3, g: number, dt: number): Vec3 {
  return [p0[0] + v0[0] * dt, p0[1] + v0[1] * dt - 0.5 * g * dt * dt, p0[2] + v0[2] * dt];
}

/** Velocity that takes the ball from a to b in exactly dt under gravity. */
function launch(a: Vec3, b: Vec3, g: number, dt: number): Vec3 {
  return [(b[0] - a[0]) / dt, (b[1] - a[1] + 0.5 * g * dt * dt) / dt, (b[2] - a[2]) / dt];
}

/** Bar size by pitch, like a real xylophone: lower notes get longer bars. */
function barLength(midi: number): number {
  return Math.max(0.3, Math.min(0.52, 0.52 - (midi - 48) * 0.006));
}

/** Plate long axis: as upright as the plate allows, so bars stand like the keys in the videos. */
function plateAxis(n: Vec3): Vec3 {
  const up: Vec3 = [0, 1, 0];
  const a = sub(up, mul(n, dot(n, up)));
  return len(a) > 0.2 ? norm(a) : norm(cross(n, [1, 0, 0]));
}

/** Groups notes into single hits and rolling runs. */
function plan(notes: MarbleNote[], rollGap: number): { first: number; last: number }[] {
  const groups: { first: number; last: number }[] = [];
  let i = 0;
  while (i < notes.length) {
    let j = i;
    // Long runs are split into rows of at most ~1 s so the ball doesn't roll off-screen.
    while (j + 1 < notes.length && notes[j + 1].t - notes[j].t < rollGap && notes[j + 1].t - notes[i].t < 1) j++;
    // A run needs at least three quick notes; two are still separate bounces.
    if (j - i >= 2) {
      groups.push({ first: i, last: j });
      i = j + 1;
    } else {
      groups.push({ first: i, last: i });
      i++;
    }
  }
  return groups;
}

export function buildCourse(input: MarbleNote[], options: Partial<CourseOptions> = {}): Course {
  const o: CourseOptions = { ...DEFAULT_COURSE, ...options };
  const g = o.gravity;
  const rng = new Rng(o.seed);
  const notes = input.filter((n) => n.midi.length > 0 && Number.isFinite(n.t)).sort((a, b) => a.t - b.t);
  const course: Course = { bars: [], rails: [], ramps: [], hits: [], segments: [], start: 0, end: 0, opts: o };
  if (notes.length === 0) return course;

  const start = notes[0].t - o.lead;
  course.start = start;
  const kindOf = (midis: number[]): BarKind => (Math.max(...midis) >= o.splitPitch ? 'white' : 'wood');
  const panOf = (x: number) => Math.max(-1, Math.min(1, x / (o.width * 1.5)));

  // State of the ball after the last contact.
  let side = rng.next() < 0.5 ? -1 : 1;
  // Dropped from rest above the first bar, which sits on the side the first bounce picks.
  let pos: Vec3 = [-side * o.width * 0.85, 0, 0];
  let time = start;
  let vel: Vec3 | null = [0, 0, 0]; // fixed outgoing velocity (start, rail or ramp exits), else designed
  let pendingBar: { bar: Bar; vIn: Vec3 } | null = null;

  /** Where the next bounce on alternating sides should be. */
  let angle = rng.next() * Math.PI * 2;
  const spin = (rng.next() < 0.5 ? -1 : 1) * (0.9 + rng.next() * 0.5);
  const nextBouncePoint = (dt: number): Vec3 => {
    side = -side;
    const y = pos[1] - Math.max(0.18, o.descent * dt * (0.85 + 0.3 * rng.next()));
    if (o.layout === 'spiral') {
      angle += spin;
      const r = o.width * 1.15;
      return [Math.cos(angle) * r, y, Math.sin(angle) * r];
    }
    if (o.layout === 'scatter') {
      // Random spot in a disc, but always a clear jump away from the last bar.
      for (let k = 0; k < 12; k++) {
        const a = rng.next() * Math.PI * 2;
        const r = o.width * (0.4 + rng.next() * 1.1);
        const p: Vec3 = [Math.cos(a) * r, y, Math.sin(a) * r * 0.8];
        if (Math.hypot(p[0] - pos[0], p[2] - pos[2]) > o.width * 0.8 || k === 11) return p;
      }
    }
    const x = side * o.width * (0.78 + 0.22 * rng.next());
    const z = (rng.next() - 0.5) * 0.5;
    return [x, y, z];
  };

  /** Finishes the previous bar: its outgoing velocity is now known, so tilt it accordingly. */
  const settle = (vOut: Vec3) => {
    if (!pendingBar) return;
    const { bar, vIn } = pendingBar;
    let n = norm(sub(vOut, vIn));
    if (len(sub(vOut, vIn)) < 1e-6) n = [-Math.sign(bar.center[0]) || 1, 0, 0];
    bar.normal = n;
    bar.axis = plateAxis(n);
    // The plate surface sits one ball radius behind the contact point.
    bar.center = sub(bar.center, mul(n, o.ballRadius + 0.025));
    pendingBar = null;
  };

  /** Flies from the current state to point `to`, arriving at time `t`. */
  const flyTo = (to: Vec3, t: number): Vec3 => {
    const dt = Math.max(1e-3, t - time);
    let v0: Vec3;
    if (vel) {
      // Fixed launch: the destination follows from physics instead.
      v0 = vel;
      to = flyAt(pos, v0, g, dt);
    } else {
      v0 = launch(pos, to, g, dt);
    }
    settle(v0);
    course.segments.push({ type: 'fly', t0: time, t1: t, p0: pos, v0 });
    const vIn: Vec3 = [v0[0], v0[1] - g * dt, v0[2]];
    pos = to;
    time = t;
    vel = null;
    return vIn;
  };

  let heading: number | null = null;
  const turn = rng.next() < 0.5 ? -1 : 1;
  // Stairs: phrases (notes up to 0.8 s apart) all become rolling rows.
  const groups = plan(notes, o.layout === 'stairs' ? Math.max(o.rollGap, 0.8) : o.rollGap);
  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const first = notes[grp.first];
    const dt = first.t - time;

    // Long rest: roll through a curved ramp first, so the ball doesn't plummet for seconds.
    if (dt > o.restGap && gi > 0) {
      const enter = 0.3;
      const exit = 0.3;
      const dur = dt - enter - exit;
      const r = Math.min(1.1, 0.35 + dur * 0.25);
      const dir = pos[0] > 0 ? -1 : 1; // sweep across the shaft
      const span = Math.PI * 0.85;
      const a0 = dir > 0 ? Math.PI * 1.1 : -Math.PI * 0.1;
      const a1 = a0 + dir * span;
      // Pick the centre so the ball, flying `enter` seconds, lands on the arc's start.
      const fall = pos[1] - Math.max(0.6, o.descent * enter * 1.5);
      // After a rail or another ramp the launch is fixed, so the landing point follows from it.
      const startPt: Vec3 = vel ? flyAt(pos, vel, g, enter) : [pos[0] + dir * 0.25, fall, pos[2]];
      const z = startPt[2];
      const c: Vec3 = [startPt[0] - Math.cos(a0) * r, startPt[1] - Math.sin(a0) * r, z];
      flyTo(startPt, time + enter);
      settle([0, 0, 0]);
      course.ramps.push({ center: c, radius: r, a0, a1, z });
      course.segments.push({ type: 'arc', t0: time, t1: time + dur, c, r, a0, a1, z });
      const w = (a1 - a0) / dur;
      pos = [c[0] + Math.cos(a1) * r, c[1] + Math.sin(a1) * r, z];
      vel = [-Math.sin(a1) * r * w, Math.cos(a1) * r * w, 0];
      time += dur;
    }

    if (grp.last === grp.first) {
      // A single bounce off one bar.
      const target = nextBouncePoint(first.t - time);
      const vIn = flyTo(target, first.t);
      const bar: Bar = {
        center: pos, normal: [0, 1, 0], axis: [0, 0, 1], length: barLength(Math.min(...first.midi)), width: 0.22,
        kind: kindOf(first.midi), hitTime: first.t, notes: first.midi, inRow: false,
      };
      course.bars.push(bar);
      course.hits.push({ t: first.t, notes: first.midi, kind: bar.kind, pan: panOf(pos[0]), row: false });
      pendingBar = { bar, vIn };
      continue;
    }

    // A rolling row: land on a rail and roll across bars spaced by the note timing.
    const last = notes[grp.last];
    const runTime = last.t - first.t;
    flyTo(nextBouncePoint(first.t - time), first.t);
    // After a fixed launch (start, rail, ramp) the ball lands where physics puts it.
    const landing = pos;
    settle([0, 0, 0]);
    // Rows wind around the shaft like a square spiral staircase, so seen from above
    // consecutive rows sit side by side instead of piling on top of each other.
    if (heading === null) heading = landing[0] > 0 ? Math.PI : 0;
    else heading += turn * Math.PI / 2;
    const speed = Math.max(1.2, Math.min(9, (o.width * 1.5) / Math.max(runTime, 0.05)));
    const d = norm([Math.cos(heading), -0.32, Math.sin(heading)]);
    const v = mul(d, speed);
    course.segments.push({ type: 'line', t0: first.t, t1: last.t, p0: landing, v });
    for (let k = grp.first; k <= grp.last; k++) {
      const n = notes[k];
      const p = add(landing, mul(v, n.t - first.t));
      const bar: Bar = {
        center: sub(p, [0, o.ballRadius + 0.03, 0]),
        normal: norm(cross(cross(d, [0, 1, 0]), d)),
        axis: norm(cross([0, 1, 0], d)),
        length: barLength(Math.min(...n.midi)) * 0.8,
        width: Math.min(0.24, Math.max(0.1, speed * (n.t - notes[Math.max(grp.first, k - 1)].t) * 0.8 || 0.2)),
        kind: kindOf(n.midi),
        hitTime: n.t,
        notes: n.midi,
        inRow: true,
      };
      if (bar.normal[1] < 0) bar.normal = mul(bar.normal, -1);
      course.bars.push(bar);
      course.hits.push({ t: n.t, notes: n.midi, kind: bar.kind, pan: panOf(p[0]), row: true });
    }
    const end = add(landing, mul(v, runTime));
    const below: Vec3 = [0, -(o.ballRadius + 0.06), 0];
    course.rails.push({ from: add(landing, below), to: add(end, below) });
    pos = end;
    time = last.t;
    vel = v;
  }

  // After the last note the ball drops away into the dark.
  const tailTarget: Vec3 = [pos[0] * 0.2, pos[1] - o.descent * o.tail * 1.6, pos[2]];
  flyTo(tailTarget, time + o.tail);
  settle([0, -1, 0]);
  course.end = time;
  return course;
}

/** Ball position at time t (closed form, so any t can be evaluated instantly). */
export function ballAt(course: Course, t: number): Vec3 {
  const s = course.segments;
  if (s.length === 0) return [0, 0, 0];
  if (t <= s[0].t0) return segmentAt(s[0], s[0].t0, course.opts.gravity);
  let lo = 0, hi = s.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (s[mid].t0 <= t) lo = mid;
    else hi = mid - 1;
  }
  return segmentAt(s[lo], Math.min(t, s[lo].t1 + (lo === s.length - 1 ? 10 : 0)), course.opts.gravity);
}

function segmentAt(seg: Segment, t: number, g: number): Vec3 {
  const dt = t - seg.t0;
  switch (seg.type) {
    case 'fly':
      return flyAt(seg.p0, seg.v0, g, dt);
    case 'line':
      return add(seg.p0, mul(seg.v, Math.min(dt, seg.t1 - seg.t0)));
    case 'arc': {
      const f = Math.max(0, Math.min(1, dt / (seg.t1 - seg.t0)));
      const a = seg.a0 + (seg.a1 - seg.a0) * f;
      return [seg.c[0] + Math.cos(a) * seg.r, seg.c[1] + Math.sin(a) * seg.r, seg.z];
    }
  }
}

/** Smoothed point the camera follows: a short weighted average of the ball's path. */
export function cameraTarget(course: Course, t: number): Vec3 {
  let acc: Vec3 = [0, 0, 0];
  let wsum = 0;
  for (let k = -5; k <= 5; k++) {
    const w = 1 - Math.abs(k) / 6;
    acc = add(acc, mul(ballAt(course, t + k * 0.035), w));
    wsum += w;
  }
  return mul(acc, 1 / wsum);
}

/** Notes with times from a step melody (one step per beat at `bpm`). */
export function stepsToNotes(steps: number[][], bpm: number, offset = 0): MarbleNote[] {
  const beat = 60 / Math.max(20, bpm);
  // Empty steps are rests: they keep their beat but produce no hit.
  return steps.map((midi, i) => ({ t: offset + i * beat, midi })).filter((n) => n.midi.length > 0);
}
