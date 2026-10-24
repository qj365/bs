//! Deterministic bouncing-ball simulation compiled to WebAssembly.
//!
//! The JS side writes parameters into a shared f64 buffer, calls `init`, then
//! repeatedly calls `advance_to(t)` + `build_render(..)` and reads the flat f32
//! render buffers straight out of linear memory (no copies, no glue code).
//! The simulation runs at a fixed 240 Hz so the same seed always produces the
//! same video, independent of preview frame rate or export fps.

use std::cell::RefCell;
use std::f64::consts::PI;

const HZ: f64 = 240.0;
const DT: f64 = 1.0 / HZ;
const TRAIL_EVERY: u64 = 4; // 60 trail samples per second
const MAX_TRAIL: usize = 64;
const MAX_LEVEL: u32 = 11;
const MAX_TEAMS: usize = 16;
const MIN_SOUND_SPEED: f64 = 60.0;

// Parameter slots shared with src/sim.ts (PARAM_* constants there must match).
const P_MODE: usize = 0;
const P_SEED: usize = 1;
const P_W: usize = 2;
const P_H: usize = 3;
const P_CX: usize = 4;
const P_CY: usize = 5;
const P_RING_RADIUS: usize = 6;
const P_RING_THICKNESS: usize = 7;
const P_RING_COUNT: usize = 8;
const P_RING_SPACING: usize = 9;
const P_GAP_ANGLE: usize = 10;
const P_ROTATION_SPEED: usize = 11;
const P_ALTERNATE: usize = 12;
const P_INITIAL_BALLS: usize = 13;
const P_BALL_RADIUS: usize = 14;
const P_MAX_BALLS: usize = 15;
const P_SPAWN_ON_ESCAPE: usize = 16;
const P_GROW: usize = 17;
const P_SPAWN_INTERVAL: usize = 18;
const P_DROP_SPREAD: usize = 19;
const P_GRAVITY: usize = 20;
const P_RESTITUTION: usize = 21;
const P_SPEED_BOOST: usize = 22;
const P_INITIAL_SPEED: usize = 23;
const P_MAX_SPEED: usize = 24;
const P_BALL_COLLISIONS: usize = 25;
const P_TEAM_COUNT: usize = 26;
const P_TEAM_HUES: usize = 27; // MAX_TEAMS slots
const PARAM_COUNT: usize = P_TEAM_HUES + MAX_TEAMS;

// Event kinds (mirrored in src/sim.ts).
const EV_BOUNCE: f32 = 0.0;
const EV_HIT: f32 = 1.0;
const EV_ESCAPE: f32 = 2.0;
const EV_BREAK: f32 = 3.0;
const EV_MERGE: f32 = 4.0;
const EV_FINISH: f32 = 5.0;

// Floats per record in the output buffers (mirrored in src/sim.ts).
const BALL_STRIDE: usize = 8; // x y r hue px py bounces team
const TRAIL_STRIDE: usize = 8; // x1 y1 x2 y2 radius hue alpha bounces
const RING_STRIDE: usize = 8; // cx cy r thickness rot gap hue flash
const PARTICLE_STRIDE: usize = 6; // x y size hue alpha 0
const EVENT_STRIDE: usize = 6; // t kind strength r level team

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Escape,
    Grow,
    Destruction,
    Trail,
    Merge,
    Koth,
    Symmetric,
}

impl Mode {
    fn from(v: f64) -> Mode {
        match v as i32 {
            1 => Mode::Grow,
            2 => Mode::Destruction,
            3 => Mode::Trail,
            4 => Mode::Merge,
            5 => Mode::Koth,
            6 => Mode::Symmetric,
            _ => Mode::Escape,
        }
    }
}

struct Rng(u32);

impl Rng {
    fn new(seed: f64) -> Rng {
        Rng((seed.floor() as i64 as u32) ^ 0x9e37_79b9)
    }
    fn next(&mut self) -> f64 {
        self.0 = self.0.wrapping_add(0x6d2b_79f5);
        let mut t = self.0;
        t = (t ^ (t >> 15)).wrapping_mul(t | 1);
        t ^= t.wrapping_add((t ^ (t >> 7)).wrapping_mul(t | 61));
        ((t ^ (t >> 14)) as f64) / 4_294_967_296.0
    }
    fn range(&mut self, a: f64, b: f64) -> f64 {
        a + (b - a) * self.next()
    }
}

#[derive(Clone)]
struct Ball {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    r: f64,
    hue: f64,
    px: f64,
    py: f64,
    alive: bool,
    escaped: bool,
    bounces: u32,
    level: u32,
    team: u32,
    ring_idx: usize,
    trail: [f32; MAX_TRAIL * 2],
    trail_head: usize,
    trail_count: usize,
}

#[derive(Clone, Copy)]
struct Ring {
    r: f64,
    thickness: f64,
    rot: f64,
    rot_speed: f64,
    gap: f64,
    hue: f64,
    flash: f64,
    alive: bool,
}

struct Particle {
    x: f64,
    y: f64,
    vx: f64,
    vy: f64,
    life: f64,
    max_life: f64,
    size: f64,
    hue: f64,
}

struct Params {
    mode: Mode,
    w: f64,
    h: f64,
    cx: f64,
    cy: f64,
    ring_radius: f64,
    ring_thickness: f64,
    ring_count: usize,
    ring_spacing: f64,
    gap: f64,
    rot_speed: f64,
    alternate: bool,
    initial_balls: usize,
    ball_radius: f64,
    max_balls: usize,
    spawn_on_escape: usize,
    grow: f64,
    spawn_interval: f64,
    drop_spread: f64,
    gravity: f64,
    restitution: f64,
    speed_boost: f64,
    initial_speed: f64,
    max_speed: f64,
    ball_collisions: bool,
    team_hues: Vec<f64>,
}

struct Sim {
    p: Params,
    rng: Rng,
    fx_rng: Rng,
    time: f64,
    step: u64,
    balls: Vec<Ball>,
    rings: Vec<Ring>,
    particles: Vec<Particle>,
    pending: Vec<Ball>,
    next_id: u32,
    counter: f64,
    rings_broken: u32,
    finished: bool,
    frozen: bool,
    finish_time: f64,
    winner_team: i32,
    spawn_timer: f64,
    // Uniform grid for ball-ball collisions (linked lists, no per-tick allocation).
    grid_heads: Vec<i32>,
    grid_next: Vec<i32>,
    // Output buffers read by JS.
    out_balls: Vec<f32>,
    out_trails: Vec<f32>,
    out_rings: Vec<f32>,
    out_particles: Vec<f32>,
    out_events: Vec<f32>,
}

fn ang_diff(a: f64, b: f64) -> f64 {
    let mut d = (a - b) % (2.0 * PI);
    if d > PI {
        d -= 2.0 * PI;
    } else if d < -PI {
        d += 2.0 * PI;
    }
    d
}

impl Sim {
    fn new(v: &[f64]) -> Sim {
        let team_count = (v[P_TEAM_COUNT] as usize).min(MAX_TEAMS);
        let p = Params {
            mode: Mode::from(v[P_MODE]),
            w: v[P_W],
            h: v[P_H],
            cx: v[P_CX],
            cy: v[P_CY],
            ring_radius: v[P_RING_RADIUS].max(20.0),
            ring_thickness: v[P_RING_THICKNESS].max(1.0),
            ring_count: (v[P_RING_COUNT] as usize).clamp(1, 200),
            ring_spacing: v[P_RING_SPACING].max(1.0),
            gap: v[P_GAP_ANGLE].clamp(0.0, 359.0).to_radians(),
            rot_speed: v[P_ROTATION_SPEED].to_radians(),
            alternate: v[P_ALTERNATE] != 0.0,
            initial_balls: (v[P_INITIAL_BALLS] as usize).min(20_000),
            ball_radius: v[P_BALL_RADIUS].max(0.5),
            max_balls: (v[P_MAX_BALLS] as usize).clamp(1, 50_000),
            spawn_on_escape: (v[P_SPAWN_ON_ESCAPE] as usize).min(20),
            grow: v[P_GROW].max(0.0),
            spawn_interval: v[P_SPAWN_INTERVAL].max(0.02),
            drop_spread: v[P_DROP_SPREAD],
            gravity: v[P_GRAVITY],
            restitution: v[P_RESTITUTION].clamp(0.0, 1.5),
            speed_boost: v[P_SPEED_BOOST].clamp(0.5, 2.0),
            initial_speed: v[P_INITIAL_SPEED].max(0.0),
            max_speed: v[P_MAX_SPEED].max(10.0),
            ball_collisions: v[P_BALL_COLLISIONS] != 0.0,
            team_hues: v[P_TEAM_HUES..P_TEAM_HUES + team_count].to_vec(),
        };
        let seed = v[P_SEED];
        let mut sim = Sim {
            p,
            rng: Rng::new(seed),
            fx_rng: Rng::new(seed + 7919.0),
            time: 0.0,
            step: 0,
            balls: Vec::new(),
            rings: Vec::new(),
            particles: Vec::new(),
            pending: Vec::new(),
            next_id: 0,
            counter: 0.0,
            rings_broken: 0,
            finished: false,
            frozen: false,
            finish_time: -1.0,
            winner_team: -1,
            spawn_timer: 0.0,
            grid_heads: Vec::new(),
            grid_next: Vec::new(),
            out_balls: Vec::new(),
            out_trails: Vec::new(),
            out_rings: Vec::new(),
            out_particles: Vec::new(),
            out_events: Vec::new(),
        };
        sim.setup();
        sim
    }

    fn setup(&mut self) {
        let count = if self.p.mode == Mode::Destruction { self.p.ring_count } else { 1 };
        let min_r = self.p.ball_radius * 2.5 + self.p.ring_thickness;
        for i in 0..count {
            let r = (self.p.ring_radius - (count - 1 - i) as f64 * self.p.ring_spacing).max(min_r);
            let dir = if self.p.alternate && i % 2 == 1 { -1.0 } else { 1.0 };
            self.rings.push(Ring {
                r,
                thickness: self.p.ring_thickness,
                rot: -PI / 2.0 + i as f64 * 0.45,
                rot_speed: self.p.rot_speed * dir,
                gap: self.p.gap,
                hue: (i as f64 * 360.0 / count as f64) % 360.0,
                flash: 0.0,
                alive: true,
            });
        }

        let rin = self.inner_radius(0);
        let (cx, cy) = (self.p.cx, self.p.cy);
        let n = self.p.initial_balls;
        match self.p.mode {
            Mode::Symmetric => {
                for k in 0..n {
                    let x = cx + (k as f64 - (n as f64 - 1.0) / 2.0) * self.p.drop_spread;
                    let hue = k as f64 * 360.0 / n.max(1) as f64;
                    self.add_ball(x, cy - rin * 0.55, 0.0, self.p.initial_speed, self.p.ball_radius, hue, 0, k as u32);
                }
            }
            Mode::Koth => {
                for k in 0..n {
                    let a = k as f64 * 2.0 * PI / n.max(1) as f64 - PI / 2.0;
                    let dist = if n > 1 { rin * 0.45 } else { 0.0 };
                    let dir = self.rng.range(0.0, 2.0 * PI);
                    let hue = self.team_hue(k);
                    let (vx, vy) = (dir.cos() * self.p.initial_speed, dir.sin() * self.p.initial_speed);
                    self.add_ball(cx + a.cos() * dist, cy + a.sin() * dist, vx, vy, self.p.ball_radius, hue, 0, k as u32);
                }
            }
            Mode::Merge => {
                for _ in 0..n {
                    self.spawn_merge_ball();
                }
            }
            _ => {
                for k in 0..n {
                    let spread = if n > 1 { rin * 0.3 } else { 0.0 };
                    let x = cx + self.rng.range(-spread, spread);
                    let y = cy + self.rng.range(-spread, spread);
                    self.spawn_random_ball(x, y, k as u32);
                }
            }
        }
        self.flush_pending();
    }

    fn team_hue(&self, k: usize) -> f64 {
        if k < self.p.team_hues.len() {
            self.p.team_hues[k]
        } else {
            (k as f64 * 360.0 / self.p.initial_balls.max(1) as f64) % 360.0
        }
    }

    fn inner_radius(&self, ri: usize) -> f64 {
        let r = &self.rings[ri];
        r.r - r.thickness * 0.5
    }

    fn rainbow_hue(&self) -> f64 {
        (self.next_id as f64 * 47.0) % 360.0
    }

    #[allow(clippy::too_many_arguments)]
    fn add_ball(&mut self, x: f64, y: f64, vx: f64, vy: f64, r: f64, hue: f64, level: u32, team: u32) {
        let dx = x - self.p.cx;
        let dy = y - self.p.cy;
        let d = (dx * dx + dy * dy).sqrt();
        // Start inside the innermost ring that actually contains the spawn point.
        let ring_idx = self.rings.iter().position(|rg| rg.alive && d < rg.r).unwrap_or(self.rings.len());
        self.next_id += 1;
        self.pending.push(Ball {
            x,
            y,
            vx,
            vy,
            r,
            hue,
            px: x,
            py: y,
            alive: true,
            escaped: false,
            bounces: 0,
            level,
            team,
            ring_idx,
            trail: [0.0; MAX_TRAIL * 2],
            trail_head: 0,
            trail_count: 0,
        });
    }

    fn spawn_random_ball(&mut self, x: f64, y: f64, team: u32) {
        let dir = self.rng.range(0.0, 2.0 * PI);
        let s = self.p.initial_speed;
        let hue = self.rainbow_hue();
        self.add_ball(x, y, dir.cos() * s, dir.sin() * s, self.p.ball_radius, hue, 0, team);
    }

    fn level_radius(&self, level: u32) -> f64 {
        self.p.ball_radius * 1.28f64.powi(level as i32)
    }

    fn level_hue(level: u32) -> f64 {
        (level as f64 * 33.0 + 350.0) % 360.0
    }

    fn spawn_merge_ball(&mut self) {
        let rin = self.inner_radius(0);
        let roll = self.rng.next();
        let level = if roll < 0.5 { 0 } else if roll < 0.82 { 1 } else { 2 };
        let r = self.level_radius(level);
        let x = self.p.cx + self.rng.range(-0.35, 0.35) * rin;
        let y = self.p.cy - rin * 0.55;
        let vx = self.rng.range(-60.0, 60.0);
        self.add_ball(x, y, vx, 0.0, r, Self::level_hue(level), level, 0);
    }

    fn flush_pending(&mut self) {
        if !self.pending.is_empty() {
            self.balls.append(&mut self.pending);
        }
    }

    fn inside_count(&self) -> usize {
        self.balls.iter().filter(|b| b.alive && !b.escaped).count() + self.pending.len()
    }

    fn emit(&mut self, kind: f32, strength: f64, r: f64, level: f64, team: f64) {
        self.out_events.extend_from_slice(&[self.time as f32, kind, strength as f32, r as f32, level as f32, team as f32]);
    }

    fn finish(&mut self, freeze: bool) {
        if self.finished {
            return;
        }
        self.finished = true;
        self.frozen = freeze;
        self.finish_time = self.time;
        self.emit(EV_FINISH, 0.0, 0.0, 0.0, self.winner_team.max(0) as f64);
    }

    fn burst(&mut self, x: f64, y: f64, hue: f64, count: usize, speed: f64, size: f64) {
        for _ in 0..count {
            let a = self.fx_rng.range(0.0, 2.0 * PI);
            let s = self.fx_rng.range(0.2, 1.0) * speed;
            let life = self.fx_rng.range(0.6, 1.4);
            self.particles.push(Particle {
                x,
                y,
                vx: a.cos() * s,
                vy: a.sin() * s,
                life,
                max_life: life,
                size: self.fx_rng.range(0.5, 1.0) * size,
                hue,
            });
        }
    }

    fn advance_to(&mut self, t: f64) {
        // Hard cap on work per call so a huge jump never locks the page.
        let mut budget = (HZ * 30.0) as u32;
        while self.time + DT <= t + 1e-9 && budget > 0 {
            self.tick();
            budget -= 1;
        }
    }

    fn tick(&mut self) {
        if !self.frozen {
            self.physics();
        }
        self.update_particles();
        if self.step % TRAIL_EVERY == 0 {
            for b in self.balls.iter_mut().filter(|b| b.alive) {
                let h = b.trail_head;
                b.trail[h * 2] = b.x as f32;
                b.trail[h * 2 + 1] = b.y as f32;
                b.trail_head = (h + 1) % MAX_TRAIL;
                b.trail_count = (b.trail_count + 1).min(MAX_TRAIL);
            }
        }
        self.time += DT;
        self.step += 1;
    }

    fn physics(&mut self) {
        if self.p.mode == Mode::Merge {
            self.spawn_timer -= DT;
            if self.spawn_timer <= 0.0 {
                if self.inside_count() < self.p.max_balls {
                    self.spawn_merge_ball();
                }
                self.spawn_timer += self.p.spawn_interval;
            }
        }

        for ring in self.rings.iter_mut() {
            ring.rot += ring.rot_speed * DT;
            ring.flash = (ring.flash - DT * 4.0).max(0.0);
        }

        let g = self.p.gravity;
        for b in self.balls.iter_mut().filter(|b| b.alive) {
            b.vy += g * DT;
            b.x += b.vx * DT;
            b.y += b.vy * DT;
        }

        for i in 0..self.balls.len() {
            if self.balls[i].alive && !self.balls[i].escaped {
                self.collide_rings(i);
            }
        }

        if self.p.ball_collisions || self.p.mode == Mode::Merge {
            self.collide_balls();
        }

        let (w, h) = (self.p.w, self.p.h);
        for b in self.balls.iter_mut() {
            if b.escaped && b.alive && (b.y - b.r > h + 50.0 || b.x + b.r < -50.0 || b.x - b.r > w + 50.0 || b.y < -h) {
                b.alive = false;
            }
        }
        self.flush_pending();
        if self.step % 240 == 0 {
            self.balls.retain(|b| b.alive);
        }
    }

    fn update_particles(&mut self) {
        let g = self.p.gravity * 0.5;
        let mut i = 0;
        while i < self.particles.len() {
            let p = &mut self.particles[i];
            p.life -= DT;
            if p.life <= 0.0 {
                self.particles.swap_remove(i);
                continue;
            }
            p.vy += g * DT;
            p.vx *= 0.995;
            p.vy *= 0.995;
            p.x += p.vx * DT;
            p.y += p.vy * DT;
            i += 1;
        }
    }

    fn collide_rings(&mut self, i: usize) {
        let mut ri = self.balls[i].ring_idx;
        while ri < self.rings.len() && !self.rings[ri].alive {
            ri += 1;
        }
        self.balls[i].ring_idx = ri;
        if ri >= self.rings.len() {
            self.balls[i].escaped = true;
            return;
        }
        let ring = self.rings[ri];
        let (cx, cy) = (self.p.cx, self.p.cy);
        let e = self.p.restitution;
        let rin = ring.r - ring.thickness * 0.5;
        let mut bounced: Option<f64> = None;
        let mut exited = false;
        {
            let b = &mut self.balls[i];
            let dx = b.x - cx;
            let dy = b.y - cy;
            let d = (dx * dx + dy * dy).sqrt().max(1e-9);
            let in_gap = ring.gap > 0.0 && ang_diff(dy.atan2(dx), ring.rot).abs() < ring.gap * 0.5;
            if !in_gap {
                if d + b.r > rin {
                    let (nx, ny) = (dx / d, dy / d);
                    let target = (rin - b.r).max(0.0);
                    b.x = cx + nx * target;
                    b.y = cy + ny * target;
                    let vn = b.vx * nx + b.vy * ny;
                    if vn > 0.0 {
                        b.vx -= (1.0 + e) * vn * nx;
                        b.vy -= (1.0 + e) * vn * ny;
                        bounced = Some(vn);
                    }
                }
            } else {
                // Round end caps of the gap behave like small static circles.
                let cap_r = ring.thickness * 0.5;
                for s in [-1.0, 1.0] {
                    let a = ring.rot + s * ring.gap * 0.5;
                    let ex = cx + a.cos() * ring.r;
                    let ey = cy + a.sin() * ring.r;
                    let ddx = b.x - ex;
                    let ddy = b.y - ey;
                    let dist = (ddx * ddx + ddy * ddy).sqrt();
                    let min = b.r + cap_r;
                    if dist < min && dist > 1e-9 {
                        let (nx, ny) = (ddx / dist, ddy / dist);
                        b.x = ex + nx * min;
                        b.y = ey + ny * min;
                        let vn = b.vx * nx + b.vy * ny;
                        if vn < 0.0 {
                            b.vx -= (1.0 + e) * vn * nx;
                            b.vy -= (1.0 + e) * vn * ny;
                            bounced = Some(-vn);
                        }
                    }
                }
                if d > ring.r + ring.thickness * 0.5 {
                    exited = true;
                }
            }
        }
        if let Some(vn) = bounced {
            self.on_bounce(i, ri, vn);
        }
        if exited {
            self.on_exit(i, ri);
        }
    }

    fn clamp_speed(&self, b: &mut Ball) {
        let s = (b.vx * b.vx + b.vy * b.vy).sqrt();
        if s > self.p.max_speed {
            let k = self.p.max_speed / s;
            b.vx *= k;
            b.vy *= k;
        }
    }

    fn on_bounce(&mut self, i: usize, ri: usize, vn: f64) {
        let boost = self.p.speed_boost;
        let mut b = self.balls[i].clone();
        b.vx *= boost;
        b.vy *= boost;
        self.clamp_speed(&mut b);
        b.bounces += 1;
        self.rings[ri].flash = 1.0;

        let mut fill_done = false;
        if matches!(self.p.mode, Mode::Grow | Mode::Trail) && self.p.grow > 0.0 {
            let rin = self.inner_radius(ri);
            b.r = (b.r + self.p.grow).min(rin - 0.5);
            if b.r >= rin * 0.985 {
                fill_done = true;
            }
        }
        let (r, level, team) = (b.r, b.level, b.team);
        self.balls[i] = b;
        if vn > MIN_SOUND_SPEED {
            self.emit(EV_BOUNCE, vn, r, level as f64, team as f64);
        }
        if fill_done {
            self.finish(true);
        }
    }

    fn on_exit(&mut self, i: usize, ri: usize) {
        let (bx, by, bhue, br, team) = {
            let b = &self.balls[i];
            (b.x, b.y, b.hue, b.r, b.team)
        };
        match self.p.mode {
            Mode::Destruction => {
                let ring = self.rings[ri];
                self.rings[ri].alive = false;
                self.rings_broken += 1;
                self.counter = self.rings_broken as f64;
                self.emit(EV_BREAK, 1.0, ring.r, ri as f64, team as f64);
                let pieces = (ring.r / 6.0).clamp(24.0, 140.0) as usize;
                for k in 0..pieces {
                    let a = k as f64 / pieces as f64 * 2.0 * PI;
                    if ring.gap > 0.0 && ang_diff(a, ring.rot).abs() < ring.gap * 0.5 {
                        continue;
                    }
                    let px = self.p.cx + a.cos() * ring.r;
                    let py = self.p.cy + a.sin() * ring.r;
                    let s = self.fx_rng.range(80.0, 420.0);
                    let life = self.fx_rng.range(0.7, 1.5);
                    self.particles.push(Particle {
                        x: px,
                        y: py,
                        vx: a.cos() * s,
                        vy: a.sin() * s,
                        life,
                        max_life: life,
                        size: ring.thickness * self.fx_rng.range(0.4, 0.9),
                        hue: ring.hue,
                    });
                }
                self.balls[i].ring_idx = ri + 1;
                if self.rings.iter().all(|r| !r.alive) {
                    self.finish(false);
                }
            }
            Mode::Escape => {
                self.balls[i].escaped = true;
                self.counter += 1.0;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64);
                self.burst(bx, by, bhue, 10, 260.0, br * 0.35);
                for _ in 0..self.p.spawn_on_escape {
                    if self.inside_count() >= self.p.max_balls {
                        break;
                    }
                    let (cx, cy) = (self.p.cx, self.p.cy);
                    let jx = self.rng.range(-2.0, 2.0);
                    let jy = self.rng.range(-2.0, 2.0);
                    self.spawn_random_ball(cx + jx, cy + jy, 0);
                }
            }
            Mode::Koth => {
                self.balls[i].escaped = true;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64);
                self.burst(bx, by, bhue, 40, 500.0, br * 0.3);
                let inside: Vec<u32> = self.balls.iter().filter(|b| b.alive && !b.escaped).map(|b| b.team).collect();
                if inside.len() <= 1 {
                    self.winner_team = inside.first().map(|t| *t as i32).unwrap_or(team as i32);
                    self.finish(false);
                }
            }
            _ => {
                self.balls[i].escaped = true;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64);
            }
        }
    }

    fn collide_balls(&mut self) {
        let n = self.balls.len();
        if n < 2 {
            return;
        }
        let max_r = self.balls.iter().filter(|b| b.alive).fold(1.0f64, |m, b| m.max(b.r));
        let cell = (max_r * 2.0).max(4.0);
        let gw = (self.p.w / cell).ceil() as i32 + 1;
        let gh = (self.p.h / cell).ceil() as i32 + 1;
        let cells = (gw * gh) as usize;
        self.grid_heads.clear();
        self.grid_heads.resize(cells, -1);
        self.grid_next.clear();
        self.grid_next.resize(n, -1);
        let cell_of = |x: f64, y: f64| -> (i32, i32) {
            (((x / cell) as i32).clamp(0, gw - 1), ((y / cell) as i32).clamp(0, gh - 1))
        };
        for i in 0..n {
            let b = &self.balls[i];
            if !b.alive || b.escaped {
                continue;
            }
            let (gx, gy) = cell_of(b.x, b.y);
            let c = (gy * gw + gx) as usize;
            self.grid_next[i] = self.grid_heads[c];
            self.grid_heads[c] = i as i32;
        }
        for i in 0..n {
            if !self.balls[i].alive || self.balls[i].escaped {
                continue;
            }
            let (gx, gy) = cell_of(self.balls[i].x, self.balls[i].y);
            for oy in -1..=1 {
                let yy = gy + oy;
                if yy < 0 || yy >= gh {
                    continue;
                }
                for ox in -1..=1 {
                    let xx = gx + ox;
                    if xx < 0 || xx >= gw {
                        continue;
                    }
                    let mut j = self.grid_heads[(yy * gw + xx) as usize];
                    while j >= 0 {
                        let ju = j as usize;
                        if ju > i {
                            self.resolve_pair(i, ju);
                            if !self.balls[i].alive {
                                break;
                            }
                        }
                        j = self.grid_next[ju];
                    }
                    if !self.balls[i].alive {
                        break;
                    }
                }
                if !self.balls[i].alive {
                    break;
                }
            }
        }
    }

    fn resolve_pair(&mut self, i: usize, j: usize) {
        let (a, b) = {
            let (lo, hi) = self.balls.split_at_mut(j);
            (&mut lo[i], &mut hi[0])
        };
        if !a.alive || !b.alive || a.escaped || b.escaped {
            return;
        }
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let rs = a.r + b.r;
        let d2 = dx * dx + dy * dy;
        if d2 >= rs * rs || d2 < 1e-12 {
            return;
        }
        if self.p.mode == Mode::Merge && a.level == b.level && a.level < MAX_LEVEL {
            let level = a.level + 1;
            let (ma, mb) = (a.r * a.r, b.r * b.r);
            let m = ma + mb;
            let x = (a.x * ma + b.x * mb) / m;
            let y = (a.y * ma + b.y * mb) / m;
            let vx = (a.vx * ma + b.vx * mb) / m;
            let vy = (a.vy * ma + b.vy * mb) / m;
            a.alive = false;
            b.alive = false;
            let r = self.level_radius(level);
            self.counter += f64::from(1u32 << level.min(20));
            self.add_ball(x, y, vx, vy, r, Self::level_hue(level), level, 0);
            self.emit(EV_MERGE, 1.0, r, level as f64, 0.0);
            self.burst(x, y, Self::level_hue(level), 14, 260.0, r * 0.25);
            return;
        }
        let d = d2.sqrt();
        let (nx, ny) = (dx / d, dy / d);
        let overlap = rs - d;
        let (ma, mb) = (a.r * a.r, b.r * b.r);
        let total = ma + mb;
        a.x -= nx * overlap * mb / total;
        a.y -= ny * overlap * mb / total;
        b.x += nx * overlap * ma / total;
        b.y += ny * overlap * ma / total;
        let rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if rv < 0.0 {
            let e = self.p.restitution.min(1.0);
            let jimp = -(1.0 + e) * rv / (1.0 / ma + 1.0 / mb);
            a.vx -= jimp / ma * nx;
            a.vy -= jimp / ma * ny;
            b.vx += jimp / mb * nx;
            b.vy += jimp / mb * ny;
            if -rv > 150.0 {
                let (r, level, team) = (a.r.min(b.r), a.level, a.team);
                self.emit(EV_HIT, -rv, r, level as f64, team as f64);
            }
        }
    }

    fn build_render(&mut self, trail_len: usize) {
        self.out_balls.clear();
        self.out_trails.clear();
        self.out_rings.clear();
        self.out_particles.clear();
        let trail_len = trail_len.min(MAX_TRAIL);
        for b in self.balls.iter_mut().filter(|b| b.alive) {
            self.out_balls.extend_from_slice(&[
                b.x as f32,
                b.y as f32,
                b.r as f32,
                b.hue as f32,
                b.px as f32,
                b.py as f32,
                b.bounces as f32,
                b.team as f32,
            ]);
            b.px = b.x;
            b.py = b.y;
            let count = b.trail_count.min(trail_len);
            if count == 0 {
                continue;
            }
            let (mut lx, mut ly) = (b.x as f32, b.y as f32);
            for k in 0..count {
                let idx = (b.trail_head + MAX_TRAIL - 1 - k) % MAX_TRAIL;
                let (tx, ty) = (b.trail[idx * 2], b.trail[idx * 2 + 1]);
                let f = 1.0 - (k as f32 + 1.0) / (count as f32 + 1.0);
                self.out_trails.extend_from_slice(&[
                    lx,
                    ly,
                    tx,
                    ty,
                    b.r as f32 * (0.35 + 0.6 * f),
                    b.hue as f32,
                    f * 0.6,
                    b.bounces as f32,
                ]);
                lx = tx;
                ly = ty;
            }
        }
        for r in self.rings.iter().filter(|r| r.alive) {
            self.out_rings.extend_from_slice(&[
                self.p.cx as f32,
                self.p.cy as f32,
                r.r as f32,
                r.thickness as f32,
                r.rot as f32,
                r.gap as f32,
                r.hue as f32,
                r.flash as f32,
            ]);
        }
        for p in &self.particles {
            self.out_particles.extend_from_slice(&[
                p.x as f32,
                p.y as f32,
                p.size as f32,
                p.hue as f32,
                (p.life / p.max_life) as f32,
                0.0,
            ]);
        }
    }

    fn stat(&self, i: u32) -> f64 {
        match i {
            0 => self.counter,
            1 => self.finished as u32 as f64,
            2 => self.finish_time,
            3 => self.winner_team as f64,
            4 => self.time,
            5 => self.balls.iter().filter(|b| b.alive && !b.escaped).count() as f64,
            6 => self.rings.len() as f64,
            7 => self.rings_broken as f64,
            8 => {
                // Fill ratio of the biggest ball vs. the arena, in percent.
                if self.rings.is_empty() {
                    return 0.0;
                }
                let rin = self.inner_radius(0);
                let max_r = self.balls.iter().filter(|b| b.alive).fold(0.0f64, |m, b| m.max(b.r));
                (max_r / (rin * 0.985) * 100.0).min(100.0)
            }
            9 => self.balls.iter().filter(|b| b.alive).count() as f64,
            _ => 0.0,
        }
    }
}

thread_local! {
    static PARAMS: RefCell<Vec<f64>> = RefCell::new(vec![0.0; PARAM_COUNT]);
    static SIM: RefCell<Option<Sim>> = const { RefCell::new(None) };
}

fn with_sim<R>(default: R, f: impl FnOnce(&mut Sim) -> R) -> R {
    SIM.with(|s| match s.borrow_mut().as_mut() {
        Some(sim) => f(sim),
        None => default,
    })
}

#[no_mangle]
pub extern "C" fn param_count() -> u32 {
    PARAM_COUNT as u32
}

#[no_mangle]
pub extern "C" fn params_ptr() -> *mut f64 {
    PARAMS.with(|p| p.borrow_mut().as_mut_ptr())
}

#[no_mangle]
pub extern "C" fn init() {
    let sim = PARAMS.with(|p| Sim::new(&p.borrow()));
    SIM.with(|s| *s.borrow_mut() = Some(sim));
}

#[no_mangle]
pub extern "C" fn advance_to(t: f64) {
    with_sim((), |s| s.advance_to(t));
}

#[no_mangle]
pub extern "C" fn build_render(trail_len: u32) {
    with_sim((), |s| s.build_render(trail_len as usize));
}

#[no_mangle]
pub extern "C" fn stat(i: u32) -> f64 {
    with_sim(0.0, |s| s.stat(i))
}

#[no_mangle]
pub extern "C" fn clear_events() {
    with_sim((), |s| s.out_events.clear());
}

macro_rules! buffer_exports {
    ($ptr:ident, $len:ident, $field:ident, $stride:expr) => {
        #[no_mangle]
        pub extern "C" fn $ptr() -> *const f32 {
            with_sim(std::ptr::null(), |s| s.$field.as_ptr())
        }
        /// Number of records (not floats).
        #[no_mangle]
        pub extern "C" fn $len() -> u32 {
            with_sim(0, |s| (s.$field.len() / $stride) as u32)
        }
    };
}

buffer_exports!(balls_ptr, balls_len, out_balls, BALL_STRIDE);
buffer_exports!(trails_ptr, trails_len, out_trails, TRAIL_STRIDE);
buffer_exports!(rings_ptr, rings_len, out_rings, RING_STRIDE);
buffer_exports!(particles_ptr, particles_len, out_particles, PARTICLE_STRIDE);
buffer_exports!(events_ptr, events_len, out_events, EVENT_STRIDE);
