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
const MAX_CONTACTS: usize = 64;
const MAX_TEAMS: usize = 16;
const MERGE_GOAL: u32 = 10;
const MIN_SOUND_SPEED: f64 = 60.0;
const MAX_POWERUPS: usize = 3;
const POWERUP_LIFE: f64 = 8.0;

// Parameter slots shared with src/sim.ts (the `P` table there must match).
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
const P_SPIKE_ARC: usize = 26;
const P_SPIKE_EFFECT: usize = 27;
const P_SPIKE_SIZE: usize = 28;
const P_RING_HP: usize = 29;
const P_POWERUPS: usize = 30;
const P_POWERUP_INTERVAL: usize = 31;
const P_IMPACT_LINES: usize = 32;
const P_EXPLODE_COUNT: usize = 33;
const P_SPIRAL_TURNS: usize = 34;
const P_SPIRAL_SPEED: usize = 35;
const P_GEM_COUNT: usize = 36;
const P_IMPACT_MODE: usize = 37;
const P_PORTALS: usize = 38;
const P_PORTAL_SIZE: usize = 39;
const P_MAGNET: usize = 40;
const P_WIND: usize = 41;
const P_CHAOS_COUNT: usize = 42;
const P_CHAOS: usize = 43; // MAX_CHAOS × (time, kind, value)
const MAX_CHAOS: usize = 8;
const P_TEAM_COUNT: usize = P_CHAOS + MAX_CHAOS * 3;
const P_TEAM_HUES: usize = P_TEAM_COUNT + 1; // MAX_TEAMS slots
const PARAM_COUNT: usize = P_TEAM_HUES + MAX_TEAMS;

// Event kinds (mirrored in src/sim.ts).
const EV_BOUNCE: f32 = 0.0;
const EV_HIT: f32 = 1.0;
const EV_ESCAPE: f32 = 2.0;
const EV_BREAK: f32 = 3.0;
const EV_MERGE: f32 = 4.0;
const EV_FINISH: f32 = 5.0;
const EV_POWERUP: f32 = 6.0;
const EV_SPIKE: f32 = 7.0;
const EV_EXPLODE: f32 = 8.0;
const EV_GEM: f32 = 9.0;
const EV_NEAR_MISS: f32 = 10.0;
const EV_CHAOS: f32 = 11.0;
const EV_PORTAL: f32 = 12.0;

// Timeline ("chaos") event kinds.
const CH_GRAVITY_FLIP: u32 = 0;
const CH_GRAVITY_SCALE: u32 = 1;
const CH_BLACK_HOLE: u32 = 2;
const CH_WIND: u32 = 3;
const CH_SPEED_BURST: u32 = 4;
const CH_SPAWN: u32 = 5;
const CH_REVERSE: u32 = 6;
const CH_WIDEN_GAP: u32 = 7;
const WIND_SECONDS: f64 = 3.0;
const PORTAL_COOLDOWN: f64 = 0.35;

// Floats per record in the output buffers (mirrored in src/sim.ts).
const BALL_STRIDE: usize = 8; // x y r hue px py bounces frozen
const SEG_STRIDE: usize = 8; // x1 y1 x2 y2 radius hue alpha bounces (trails, walls, impact lines)
const RING_STRIDE: usize = 12; // cx cy r thickness rot gap hue flash spikeCenter spikeArc glassFrac spikeSize
const PARTICLE_STRIDE: usize = 6; // x y size hue alpha 0
const GEM_STRIDE: usize = 6; // x y size hue alpha mult
const POWERUP_STRIDE: usize = 6; // x y r kind lifeFrac pulse
const EVENT_STRIDE: usize = 7; // t kind strength r level team x

#[derive(Clone, Copy, PartialEq)]
enum Mode {
    Escape,
    Grow,
    Destruction,
    Trail,
    Merge,
    Koth,
    Symmetric,
    Infinite,
    Accumulation,
    Collision,
    Spiral,
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
            7 => Mode::Infinite,
            8 => Mode::Accumulation,
            9 => Mode::Collision,
            10 => Mode::Spiral,
            _ => Mode::Escape,
        }
    }
}

#[derive(Clone, Copy, PartialEq)]
enum SpikeEffect {
    Bounce,
    Destroy,
    Freeze,
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
    frozen: bool,
    /// Frozen balls ride along with their ring: angle relative to ring rotation, and distance.
    frozen_ring: usize,
    frozen_angle: f64,
    frozen_dist: f64,
    bounces: u32,
    level: u32,
    team: u32,
    ring_idx: usize,
    trail: [f32; MAX_TRAIL * 2],
    trail_head: usize,
    trail_count: usize,
    contacts: [f32; MAX_CONTACTS * 2],
    contact_head: usize,
    contact_count: usize,
    portal_cd: f64,
}

#[derive(Clone, Copy)]
struct ChaosEvent {
    t: f64,
    kind: u32,
    value: f64,
    fired: bool,
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
    hp: u32,
    hits: u32,
}

/// A thick line segment in the spiral's local (unrotated) frame.
struct Wall {
    ax: f64,
    ay: f64,
    bx: f64,
    by: f64,
    r_min: f64,
    r_max: f64,
}

struct Gem {
    lx: f64,
    ly: f64,
    r: f64,
    mult: u32,
    alive: bool,
}

struct PowerUp {
    x: f64,
    y: f64,
    r: f64,
    kind: u32,
    life: f64,
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
    spike_arc: f64,
    spike_effect: SpikeEffect,
    spike_size: f64,
    ring_hp: u32,
    /// Impacts slower than this make no sound (stacked balls jitter constantly in Merge).
    min_sound_speed: f64,
    powerups: bool,
    powerup_interval: f64,
    impact_lines: usize,
    impact_mode: u32,
    explode_count: usize,
    spiral_turns: f64,
    spiral_speed: f64,
    gem_count: usize,
    portals: bool,
    portal_size: f64,
    magnet: f64,
    wind: f64,
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
    walls: Vec<Wall>,
    gems: Vec<Gem>,
    powerups: Vec<PowerUp>,
    particles: Vec<Particle>,
    pending: Vec<Ball>,
    next_id: u32,
    counter: f64,
    multiplier: f64,
    total_bounces: u32,
    rings_broken: u32,
    finished: bool,
    frozen: bool,
    finish_time: f64,
    winner_team: i32,
    spawn_timer: f64,
    powerup_timer: f64,
    exploded: bool,
    spiral_rot: f64,
    spiral_end: f64,
    spiral_gap: f64,
    chaos: Vec<ChaosEvent>,
    gravity_scale: f64,
    black_hole_until: f64,
    wind_until: f64,
    wind_chaos: f64,
    near_misses: u32,
    last_near_miss: f64,
    last_chaos_kind: i32,
    last_chaos_time: f64,
    portal_pos: [(f64, f64); 2],
    // Uniform grid for ball-ball collisions (linked lists, no per-tick allocation).
    grid_heads: Vec<i32>,
    grid_next: Vec<i32>,
    // Output buffers read by JS.
    out_balls: Vec<f32>,
    out_trails: Vec<f32>,
    out_rings: Vec<f32>,
    out_particles: Vec<f32>,
    out_walls: Vec<f32>,
    out_gems: Vec<f32>,
    out_powerups: Vec<f32>,
    out_lines: Vec<f32>,
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

fn rotate(x: f64, y: f64, a: f64) -> (f64, f64) {
    let (s, c) = a.sin_cos();
    (x * c - y * s, x * s + y * c)
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
            spike_arc: v[P_SPIKE_ARC].clamp(0.0, 360.0).to_radians(),
            spike_effect: match v[P_SPIKE_EFFECT] as i32 {
                1 => SpikeEffect::Destroy,
                2 => SpikeEffect::Freeze,
                _ => SpikeEffect::Bounce,
            },
            spike_size: v[P_SPIKE_SIZE].max(2.0),
            ring_hp: v[P_RING_HP].max(0.0) as u32,
            min_sound_speed: if Mode::from(v[P_MODE]) == Mode::Merge { 220.0 } else { MIN_SOUND_SPEED },
            powerups: v[P_POWERUPS] != 0.0,
            powerup_interval: v[P_POWERUP_INTERVAL].max(0.2),
            impact_lines: (v[P_IMPACT_LINES] as usize).min(MAX_CONTACTS),
            impact_mode: v[P_IMPACT_MODE] as u32,
            explode_count: (v[P_EXPLODE_COUNT] as usize).min(5_000),
            spiral_turns: v[P_SPIRAL_TURNS].clamp(1.0, 20.0),
            spiral_speed: v[P_SPIRAL_SPEED].to_radians(),
            gem_count: (v[P_GEM_COUNT] as usize).min(200),
            portals: v[P_PORTALS] != 0.0,
            portal_size: v[P_PORTAL_SIZE].clamp(8.0, 200.0),
            magnet: v[P_MAGNET],
            wind: v[P_WIND],
            team_hues: v[P_TEAM_HUES..P_TEAM_HUES + team_count].to_vec(),
        };
        let seed = v[P_SEED];
        let chaos_count = (v[P_CHAOS_COUNT] as usize).min(MAX_CHAOS);
        let mut chaos: Vec<ChaosEvent> = (0..chaos_count)
            .map(|k| ChaosEvent {
                t: v[P_CHAOS + k * 3].max(0.0),
                kind: v[P_CHAOS + k * 3 + 1] as u32,
                value: v[P_CHAOS + k * 3 + 2],
                fired: false,
            })
            .collect();
        chaos.sort_by(|a, b| a.t.partial_cmp(&b.t).unwrap_or(std::cmp::Ordering::Equal));
        let mut sim = Sim {
            p,
            rng: Rng::new(seed),
            fx_rng: Rng::new(seed + 7919.0),
            time: 0.0,
            step: 0,
            balls: Vec::new(),
            rings: Vec::new(),
            walls: Vec::new(),
            gems: Vec::new(),
            powerups: Vec::new(),
            particles: Vec::new(),
            pending: Vec::new(),
            next_id: 0,
            counter: 0.0,
            multiplier: 1.0,
            total_bounces: 0,
            rings_broken: 0,
            finished: false,
            frozen: false,
            finish_time: -1.0,
            winner_team: -1,
            spawn_timer: 0.0,
            powerup_timer: 1.0,
            exploded: false,
            spiral_rot: 0.0,
            spiral_end: 0.0,
            spiral_gap: 0.0,
            chaos,
            gravity_scale: 1.0,
            black_hole_until: -1.0,
            wind_until: -1.0,
            wind_chaos: 0.0,
            near_misses: 0,
            last_near_miss: -1.0,
            last_chaos_kind: -1,
            last_chaos_time: -1.0,
            portal_pos: [(0.0, 0.0); 2],
            grid_heads: Vec::new(),
            grid_next: Vec::new(),
            out_balls: Vec::new(),
            out_trails: Vec::new(),
            out_rings: Vec::new(),
            out_particles: Vec::new(),
            out_walls: Vec::new(),
            out_gems: Vec::new(),
            out_powerups: Vec::new(),
            out_lines: Vec::new(),
            out_events: Vec::new(),
        };
        sim.setup();
        sim
    }

    fn setup(&mut self) {
        if self.p.mode == Mode::Spiral {
            self.setup_spiral();
        } else {
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
                    hp: self.p.ring_hp,
                    hits: 0,
                });
            }
        }

        let rin = self.arena_radius();
        let (cx, cy) = (self.p.cx, self.p.cy);
        self.portal_pos = [(cx - rin * 0.55, cy + rin * 0.15), (cx + rin * 0.55, cy - rin * 0.15)];
        let n = self.p.initial_balls;
        match self.p.mode {
            Mode::Symmetric => {
                for k in 0..n {
                    let x = cx + (k as f64 - (n as f64 - 1.0) / 2.0) * self.p.drop_spread;
                    let hue = k as f64 * 360.0 / n.max(1) as f64;
                    self.add_ball(x, cy - rin * 0.55, 0.0, self.p.initial_speed, self.p.ball_radius, hue, 0, k as u32);
                }
            }
            Mode::Koth | Mode::Collision => {
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
            Mode::Spiral => {
                for k in 0..n {
                    let x = cx + self.rng.range(-2.0, 2.0);
                    self.spawn_random_ball(x, cy, k as u32);
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

    /// Archimedean spiral wall from near the centre out to `ring_radius`, with glass gems along the corridor.
    fn setup_spiral(&mut self) {
        let turns = self.p.spiral_turns;
        let r0 = (self.p.ball_radius * 3.0 + self.p.ring_thickness).max(self.p.ring_radius * 0.1);
        let gap = (self.p.ring_radius - r0) / turns;
        self.spiral_gap = gap;
        self.spiral_end = r0 + gap * turns;
        let b = gap / (2.0 * PI);
        let segs = (turns * 72.0) as usize;
        let total = turns * 2.0 * PI;
        let point = |t: f64| -> (f64, f64) {
            let r = r0 + b * t;
            (r * t.cos(), r * t.sin())
        };
        let half = self.p.ring_thickness * 0.5;
        for i in 0..segs {
            let t0 = total * i as f64 / segs as f64;
            let t1 = total * (i + 1) as f64 / segs as f64;
            let (ax, ay) = point(t0);
            let (bx, by) = point(t1);
            let ra = (ax * ax + ay * ay).sqrt();
            let rb = (bx * bx + by * by).sqrt();
            self.walls.push(Wall { ax, ay, bx, by, r_min: ra.min(rb) - half, r_max: ra.max(rb) + half });
        }
        // Gems sit in the middle of the corridor (between turn k and k+1), spaced along the path.
        let gem_r = (gap * 0.18).clamp(6.0, 22.0);
        let n = self.p.gem_count;
        for k in 0..n {
            let t = 2.0 * PI * 0.6 + (total - 2.0 * PI * 1.2) * (k as f64 + 0.5) / n.max(1) as f64;
            let r = r0 + b * t + gap * 0.5;
            if r + gem_r > self.spiral_end {
                continue;
            }
            let mult = [2u32, 2, 3, 2, 5][k % 5];
            self.gems.push(Gem { lx: r * t.cos(), ly: r * t.sin(), r: gem_r, mult, alive: true });
        }
    }

    /// Radius of free space where balls start (inner surface of the innermost ring).
    fn arena_radius(&self) -> f64 {
        if let Some(r) = self.rings.first() {
            r.r - r.thickness * 0.5
        } else if self.p.mode == Mode::Spiral {
            self.p.ring_radius
        } else {
            self.p.ring_radius
        }
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
            frozen: false,
            frozen_ring: 0,
            frozen_angle: 0.0,
            frozen_dist: 0.0,
            bounces: 0,
            level,
            team,
            ring_idx,
            trail: [0.0; MAX_TRAIL * 2],
            trail_head: 0,
            trail_count: 0,
            contacts: [0.0; MAX_CONTACTS * 2],
            contact_head: 0,
            contact_count: 0,
            portal_cd: 0.0,
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
        let rin = self.arena_radius();
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

    fn emit(&mut self, kind: f32, strength: f64, r: f64, level: f64, team: f64, x: f64) {
        self.out_events.extend_from_slice(&[self.time as f32, kind, strength as f32, r as f32, level as f32, team as f32, x as f32]);
    }

    fn finish(&mut self, freeze: bool) {
        if self.finished {
            return;
        }
        self.finished = true;
        self.frozen = freeze;
        self.finish_time = self.time;
        let cx = self.p.cx;
        self.emit(EV_FINISH, 0.0, 0.0, 0.0, self.winner_team.max(0) as f64, cx);
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

    fn shatter_ring(&mut self, ri: usize) {
        let ring = self.rings[ri];
        let pieces = (ring.r / 6.0).clamp(24.0, 140.0) as usize;
        for k in 0..pieces {
            let a = k as f64 / pieces as f64 * 2.0 * PI;
            if ring.gap > 0.0 && ang_diff(a, ring.rot).abs() < ring.gap * 0.5 {
                continue;
            }
            let s = self.fx_rng.range(80.0, 420.0);
            let life = self.fx_rng.range(0.7, 1.5);
            self.particles.push(Particle {
                x: self.p.cx + a.cos() * ring.r,
                y: self.p.cy + a.sin() * ring.r,
                vx: a.cos() * s,
                vy: a.sin() * s,
                life,
                max_life: life,
                size: ring.thickness * self.fx_rng.range(0.4, 0.9),
                hue: ring.hue,
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
        self.spawn_timers();
        self.run_chaos();

        for ring in self.rings.iter_mut() {
            ring.rot += ring.rot_speed * DT;
            ring.flash = (ring.flash - DT * 4.0).max(0.0);
        }
        self.spiral_rot -= self.p.spiral_speed * DT;

        let g = self.p.gravity * self.gravity_scale;
        let (cx, cy) = (self.p.cx, self.p.cy);
        let wind = self.p.wind + if self.time < self.wind_until { self.wind_chaos } else { 0.0 };
        let hole = if self.time < self.black_hole_until { 2.5 * self.p.gravity.abs() + 1500.0 } else { 0.0 };
        let magnet = self.p.magnet;
        for b in self.balls.iter_mut().filter(|b| b.alive) {
            if b.frozen {
                // Stuck on a spike: ride along with the ring.
                if let Some(ring) = self.rings.get(b.frozen_ring) {
                    let a = ring.rot + b.frozen_angle;
                    b.x = cx + a.cos() * b.frozen_dist;
                    b.y = cy + a.sin() * b.frozen_dist;
                }
                continue;
            }
            b.vy += g * DT;
            b.vx += wind * DT;
            if hole != 0.0 || magnet != 0.0 {
                let (dx, dy) = (cx - b.x, cy - b.y);
                let d = (dx * dx + dy * dy).sqrt().max(1.0);
                // Magnet: strength at 200 px, growing closer in (softened near the centre).
                let a = hole + magnet * (200.0 / d.max(50.0));
                b.vx += dx / d * a * DT;
                b.vy += dy / d * a * DT;
            }
            b.x += b.vx * DT;
            b.y += b.vy * DT;
            if b.portal_cd > 0.0 {
                b.portal_cd -= DT;
            }
        }
        if self.p.portals && !self.rings.is_empty() {
            self.portal_teleports();
        }
        if hole != 0.0 && self.step % 2 == 0 {
            // Swirl of particles spiralling into the black hole.
            let a = self.fx_rng.range(0.0, 2.0 * PI);
            let d = self.fx_rng.range(60.0, 140.0);
            self.particles.push(Particle {
                x: cx + a.cos() * d,
                y: cy + a.sin() * d,
                vx: -a.sin() * 260.0 - a.cos() * 120.0,
                vy: a.cos() * 260.0 - a.sin() * 120.0,
                life: 0.6,
                max_life: 0.6,
                size: 3.0,
                hue: 270.0,
            });
        }

        for i in 0..self.balls.len() {
            if self.balls[i].alive && !self.balls[i].escaped && !self.balls[i].frozen {
                if self.p.mode == Mode::Spiral {
                    self.collide_spiral(i);
                } else {
                    self.collide_rings(i);
                }
            }
        }

        if self.p.ball_collisions || self.p.mode == Mode::Merge {
            self.collide_balls();
        }
        if !self.powerups.is_empty() {
            self.collide_powerups();
        }

        let (w, h) = (self.p.w, self.p.h);
        for b in self.balls.iter_mut() {
            if b.escaped && b.alive && (b.y - b.r > h + 50.0 || b.x + b.r < -50.0 || b.x - b.r > w + 50.0 || b.y < -h) {
                b.alive = false;
            }
        }
        self.flush_pending();
        self.check_counts();
        if self.step % 240 == 0 {
            self.balls.retain(|b| b.alive);
        }
    }

    /// Fires timeline events whose time has come.
    fn run_chaos(&mut self) {
        let mut k = 0;
        while k < self.chaos.len() {
            let ev = self.chaos[k];
            k += 1;
            if ev.fired || ev.t > self.time {
                continue;
            }
            self.chaos[k - 1].fired = true;
            match ev.kind {
                CH_GRAVITY_FLIP => self.gravity_scale = -self.gravity_scale,
                CH_GRAVITY_SCALE => self.gravity_scale *= ev.value,
                CH_BLACK_HOLE => self.black_hole_until = self.time + ev.value.clamp(0.5, 30.0),
                CH_WIND => {
                    self.wind_chaos = ev.value;
                    self.wind_until = self.time + WIND_SECONDS;
                }
                CH_SPEED_BURST => {
                    let k2 = ev.value.clamp(0.2, 5.0);
                    for b in self.balls.iter_mut().filter(|b| b.alive && !b.frozen) {
                        b.vx *= k2;
                        b.vy *= k2;
                    }
                }
                CH_SPAWN => {
                    let n = (ev.value.max(0.0) as usize).min(500);
                    let (cx, cy) = (self.p.cx, self.p.cy);
                    for _ in 0..n {
                        if self.inside_count() >= self.p.max_balls.max(n) {
                            break;
                        }
                        self.spawn_random_ball(cx, cy, 0);
                    }
                    self.flush_pending();
                }
                CH_REVERSE => {
                    for r in self.rings.iter_mut() {
                        r.rot_speed = -r.rot_speed;
                    }
                    self.p.spiral_speed = -self.p.spiral_speed;
                }
                CH_WIDEN_GAP => {
                    let add = ev.value.to_radians();
                    for r in self.rings.iter_mut() {
                        r.gap = (r.gap + add).clamp(0.0, PI * 1.9);
                    }
                }
                _ => continue,
            }
            self.last_chaos_kind = ev.kind as i32;
            self.last_chaos_time = self.time;
            let cx = self.p.cx;
            self.emit(EV_CHAOS, ev.value, 0.0, ev.kind as f64, 0.0, cx);
        }
    }

    fn portal_teleports(&mut self) {
        let pr = self.p.portal_size;
        let pos = self.portal_pos;
        let mut fired: Vec<(f64, f64)> = Vec::new();
        for b in self.balls.iter_mut().filter(|b| b.alive && !b.escaped && !b.frozen && b.portal_cd <= 0.0) {
            for k in 0..2 {
                let (px, py) = pos[k];
                let (dx, dy) = (b.x - px, b.y - py);
                if dx * dx + dy * dy < pr * pr {
                    let (ox, oy) = pos[1 - k];
                    // Come out of the other portal, keeping speed and direction.
                    let s = (b.vx * b.vx + b.vy * b.vy).sqrt().max(1e-6);
                    b.x = ox + b.vx / s * (pr * 0.2);
                    b.y = oy + b.vy / s * (pr * 0.2);
                    b.portal_cd = PORTAL_COOLDOWN;
                    b.trail_count = 0;
                    b.px = b.x;
                    b.py = b.y;
                    fired.push((ox, b.r));
                    break;
                }
            }
        }
        for (x, r) in fired {
            self.emit(EV_PORTAL, 1.0, r, 0.0, 0.0, x);
        }
    }

    fn spawn_timers(&mut self) {
        let spawns = matches!(self.p.mode, Mode::Merge | Mode::Accumulation)
            && !(self.p.mode == Mode::Accumulation && self.rings.iter().all(|r| !r.alive));
        if spawns {
            self.spawn_timer -= DT;
            if self.spawn_timer <= 0.0 {
                if self.inside_count() < self.p.max_balls {
                    if self.p.mode == Mode::Merge {
                        self.spawn_merge_ball();
                    } else {
                        let (cx, cy) = (self.p.cx, self.p.cy);
                        self.spawn_random_ball(cx, cy, 0);
                    }
                }
                self.spawn_timer += self.p.spawn_interval;
            }
        }
        if self.p.powerups && self.p.mode != Mode::Spiral {
            for p in self.powerups.iter_mut() {
                p.life -= DT;
            }
            self.powerups.retain(|p| p.life > 0.0);
            self.powerup_timer -= DT;
            if self.powerup_timer <= 0.0 {
                self.powerup_timer += self.p.powerup_interval;
                if self.powerups.len() < MAX_POWERUPS && !self.rings.is_empty() {
                    let rin = self.inner_radius(0);
                    let a = self.rng.range(0.0, 2.0 * PI);
                    let d = self.rng.range(0.15, 0.7) * rin;
                    let kind = (self.rng.next() * 4.0) as u32;
                    self.powerups.push(PowerUp {
                        x: self.p.cx + a.cos() * d,
                        y: self.p.cy + a.sin() * d,
                        r: (self.p.ball_radius * 1.4).max(18.0),
                        kind: kind.min(3),
                        life: POWERUP_LIFE,
                    });
                }
            }
        }
    }

    /// Mode end conditions that depend on how many balls exist.
    fn check_counts(&mut self) {
        if self.finished {
            return;
        }
        match self.p.mode {
            Mode::Escape | Mode::Infinite if self.p.spawn_on_escape > 0 => {
                if self.inside_count() >= self.p.max_balls {
                    self.finish(false);
                }
            }
            Mode::Escape | Mode::Grow | Mode::Trail | Mode::Collision if self.exploded || self.p.mode != Mode::Collision => {
                // Everyone gone (spikes / escaped) and nothing left to bounce.
                if self.balls.iter().all(|b| !b.alive || b.escaped) && self.step > 2 {
                    self.finish(false);
                }
            }
            _ => {}
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

    fn record_contact(b: &mut Ball, x: f64, y: f64) {
        let h = b.contact_head;
        b.contacts[h * 2] = x as f32;
        b.contacts[h * 2 + 1] = y as f32;
        b.contact_head = (h + 1) % MAX_CONTACTS;
        b.contact_count = (b.contact_count + 1).min(MAX_CONTACTS);
    }

    fn collide_rings(&mut self, i: usize) {
        if self.rings.is_empty() {
            return;
        }
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
        let mut bounced: Option<(f64, f64, f64)> = None; // (speed, contact x, contact y)
        let mut exited = false;
        let mut near_miss = false;
        let mut contact_angle = 0.0;
        {
            let b = &mut self.balls[i];
            let dx = b.x - cx;
            let dy = b.y - cy;
            let d = (dx * dx + dy * dy).sqrt().max(1e-9);
            let ang = dy.atan2(dx);
            let in_gap = ring.gap > 0.0 && ang_diff(ang, ring.rot).abs() < ring.gap * 0.5;
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
                        bounced = Some((vn, cx + nx * rin, cy + ny * rin));
                        contact_angle = ang;
                        // Hitting the wall right beside the gap reads as "so close!".
                        let margin = (2.0 * b.r / ring.r).max(0.1);
                        near_miss = ring.gap > 0.0 && ang_diff(ang, ring.rot).abs() < ring.gap * 0.5 + margin;
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
                            bounced = Some((-vn, ex, ey));
                            contact_angle = a;
                            near_miss = true;
                        }
                    }
                }
                if d > ring.r + ring.thickness * 0.5 {
                    exited = true;
                }
            }
        }
        if near_miss && self.time - self.last_near_miss > 0.3 {
            // Bounced off the edge of the gap: the ball *almost* got out.
            self.near_misses += 1;
            self.last_near_miss = self.time;
            let (r, x) = (self.balls[i].r, self.balls[i].x);
            self.emit(EV_NEAR_MISS, 1.0, r, 0.0, 0.0, x);
        }
        if let Some((vn, px, py)) = bounced {
            let on_spike = self.p.spike_arc > 0.0
                && ang_diff(contact_angle, Self::spike_center(&ring)).abs() < self.p.spike_arc * 0.5;
            if on_spike && self.p.spike_effect != SpikeEffect::Bounce {
                self.on_spike(i, ri);
                return;
            }
            self.on_bounce(i, ri, vn, px, py);
        }
        if exited {
            self.on_exit(i, ri);
        }
    }

    /// Spikes sit opposite the gap; on a closed ring they start at the top so the ball
    /// doesn't land on them on its very first fall.
    fn spike_center(ring: &Ring) -> f64 {
        if ring.gap > 0.0 { ring.rot + PI } else { ring.rot }
    }

    fn on_spike(&mut self, i: usize, ri: usize) {
        let (x, y, r, hue, team) = {
            let b = &self.balls[i];
            (b.x, b.y, b.r, b.hue, b.team)
        };
        self.rings[ri].flash = 1.0;
        self.emit(EV_SPIKE, 1.0, r, 0.0, team as f64, x);
        match self.p.spike_effect {
            SpikeEffect::Destroy => {
                self.balls[i].alive = false;
                self.burst(x, y, hue, (r * 1.5).clamp(12.0, 80.0) as usize, 520.0, r * 0.35);
                if self.p.mode == Mode::Grow || self.p.mode == Mode::Trail {
                    self.finish(false);
                }
            }
            SpikeEffect::Freeze => {
                let ring = self.rings[ri];
                let b = &mut self.balls[i];
                let (dx, dy) = (b.x - self.p.cx, b.y - self.p.cy);
                b.frozen = true;
                b.vx = 0.0;
                b.vy = 0.0;
                b.frozen_ring = ri;
                b.frozen_angle = dy.atan2(dx) - ring.rot;
                b.frozen_dist = (dx * dx + dy * dy).sqrt();
                self.counter += 1.0;
            }
            SpikeEffect::Bounce => {}
        }
    }

    fn collide_spiral(&mut self, i: usize) {
        let (cx, cy) = (self.p.cx, self.p.cy);
        let e = self.p.restitution;
        let half = self.p.ring_thickness * 0.5;
        let rot = self.spiral_rot;
        let omega = -self.p.spiral_speed;
        let mut bounce: Option<(f64, f64, f64)> = None;
        let mut hit_gem: Option<usize> = None;
        {
            let b = &mut self.balls[i];
            let dx = b.x - cx;
            let dy = b.y - cy;
            let d = (dx * dx + dy * dy).sqrt();
            for wall in self.walls.iter() {
                if d + b.r < wall.r_min || d - b.r > wall.r_max {
                    continue;
                }
                let (ax, ay) = rotate(wall.ax, wall.ay, rot);
                let (bx, by) = rotate(wall.bx, wall.by, rot);
                let (ax, ay, bx, by) = (ax + cx, ay + cy, bx + cx, by + cy);
                let (abx, aby) = (bx - ax, by - ay);
                let len2 = abx * abx + aby * aby;
                let t = if len2 > 1e-9 { (((b.x - ax) * abx + (b.y - ay) * aby) / len2).clamp(0.0, 1.0) } else { 0.0 };
                let (qx, qy) = (ax + abx * t, ay + aby * t);
                let (ddx, ddy) = (b.x - qx, b.y - qy);
                let dist = (ddx * ddx + ddy * ddy).sqrt();
                let min = b.r + half;
                if dist < min && dist > 1e-9 {
                    let (nx, ny) = (ddx / dist, ddy / dist);
                    b.x = qx + nx * min;
                    b.y = qy + ny * min;
                    // The wall moves with the spiral's rotation; bounce relative to it.
                    let (wvx, wvy) = (-omega * (qy - cy), omega * (qx - cx));
                    let vn = (b.vx - wvx) * nx + (b.vy - wvy) * ny;
                    if vn < 0.0 {
                        b.vx -= (1.0 + e) * vn * nx;
                        b.vy -= (1.0 + e) * vn * ny;
                        bounce = Some((-vn, qx, qy));
                    }
                }
            }
            for (gi, g) in self.gems.iter().enumerate() {
                if !g.alive {
                    continue;
                }
                let (gx, gy) = rotate(g.lx, g.ly, rot);
                let (ddx, ddy) = (b.x - gx - cx, b.y - gy - cy);
                let dist = (ddx * ddx + ddy * ddy).sqrt();
                let min = b.r + g.r;
                if dist < min && dist > 1e-9 {
                    let (nx, ny) = (ddx / dist, ddy / dist);
                    let vn = b.vx * nx + b.vy * ny;
                    if vn < 0.0 {
                        b.vx -= (1.0 + e) * vn * nx;
                        b.vy -= (1.0 + e) * vn * ny;
                    }
                    hit_gem = Some(gi);
                    break;
                }
            }
            if d - b.r > self.spiral_end + self.spiral_gap * 0.5 {
                b.escaped = true;
            }
        }
        if let Some((vn, px, py)) = bounce {
            self.on_wall_bounce(i, vn, px, py);
        }
        if let Some(gi) = hit_gem {
            let g = &mut self.gems[gi];
            g.alive = false;
            let (gx, gy) = rotate(g.lx, g.ly, rot);
            let (mult, gr) = (g.mult, g.r);
            self.multiplier = (self.multiplier * mult as f64).min(1e9);
            self.emit(EV_GEM, 1.0, gr, mult as f64, 0.0, gx + cx);
            self.burst(gx + cx, gy + cy, 190.0, 24, 380.0, gr * 0.4);
        }
        if self.balls[i].escaped {
            let (r, x) = (self.balls[i].r, self.balls[i].x);
            self.emit(EV_ESCAPE, 1.0, r, 0.0, 0.0, x);
            self.finish(false);
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

    fn on_wall_bounce(&mut self, i: usize, vn: f64, px: f64, py: f64) {
        let impact = self.p.impact_lines > 0;
        let mut b = self.balls[i].clone();
        b.vx *= self.p.speed_boost;
        b.vy *= self.p.speed_boost;
        self.clamp_speed(&mut b);
        b.bounces += 1;
        if impact {
            Self::record_contact(&mut b, px, py);
        }
        let (r, level, team) = (b.r, b.level, b.team);
        self.balls[i] = b;
        if vn > self.p.min_sound_speed {
            self.total_bounces += 1;
            self.counter += self.multiplier;
            self.emit(EV_BOUNCE, vn, r, level as f64, team as f64, px);
        }
    }

    fn on_bounce(&mut self, i: usize, ri: usize, vn: f64, px: f64, py: f64) {
        let boost = self.p.speed_boost;
        let mut b = self.balls[i].clone();
        b.vx *= boost;
        b.vy *= boost;
        self.clamp_speed(&mut b);
        b.bounces += 1;
        if self.p.impact_lines > 0 {
            Self::record_contact(&mut b, px, py);
        }
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
        if vn > self.p.min_sound_speed {
            self.total_bounces += 1;
            self.emit(EV_BOUNCE, vn, r, level as f64, team as f64, px);
        }
        if fill_done {
            self.finish(true);
        }

        // Glass rings crack a little on every hit and shatter when out of hit points.
        let ring = &mut self.rings[ri];
        if ring.hp > 0 && vn > self.p.min_sound_speed {
            ring.hits += 1;
            if ring.hits >= ring.hp {
                self.break_glass(ri);
            }
        }
    }

    fn break_glass(&mut self, ri: usize) {
        self.rings[ri].alive = false;
        self.rings_broken += 1;
        let r = self.rings[ri].r;
        let cx = self.p.cx;
        self.emit(EV_BREAK, 1.0, r, ri as f64, 0.0, cx);
        self.shatter_ring(ri);
        // Release everything stuck to this ring.
        let (cx, cy) = (self.p.cx, self.p.cy);
        for b in self.balls.iter_mut().filter(|b| b.frozen && b.frozen_ring == ri) {
            b.frozen = false;
            let (dx, dy) = (b.x - cx, b.y - cy);
            let d = (dx * dx + dy * dy).sqrt().max(1e-6);
            let s = self.fx_rng.range(200.0, 600.0);
            b.vx = dx / d * s;
            b.vy = dy / d * s;
        }
        if self.p.mode == Mode::Destruction {
            self.counter = self.rings_broken as f64;
        }
        if self.rings.iter().all(|r| !r.alive) {
            self.finish(false);
        }
    }

    fn on_exit(&mut self, i: usize, ri: usize) {
        let (bx, by, bhue, br, team) = {
            let b = &self.balls[i];
            (b.x, b.y, b.hue, b.r, b.team)
        };
        match self.p.mode {
            Mode::Destruction => {
                self.rings[ri].alive = false;
                self.rings_broken += 1;
                self.counter = self.rings_broken as f64;
                let r = self.rings[ri].r;
                self.emit(EV_BREAK, 1.0, r, ri as f64, team as f64, bx);
                self.shatter_ring(ri);
                self.balls[i].ring_idx = ri + 1;
                if self.rings.iter().all(|r| !r.alive) {
                    self.finish(false);
                }
            }
            Mode::Escape => {
                self.balls[i].escaped = true;
                self.counter += 1.0;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64, bx);
                self.burst(bx, by, bhue, 10, 260.0, br * 0.35);
                if self.p.spawn_on_escape == 0 {
                    self.finish(false);
                    return;
                }
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
            Mode::Infinite => {
                // The ball loops back to the centre and leaves clones behind.
                self.counter += 1.0;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64, bx);
                self.burst(bx, by, bhue, 8, 220.0, br * 0.35);
                let (cx, cy) = (self.p.cx, self.p.cy);
                let dir = self.rng.range(0.0, 2.0 * PI);
                let s = self.p.initial_speed;
                {
                    let b = &mut self.balls[i];
                    b.x = cx;
                    b.y = cy;
                    b.vx = dir.cos() * s;
                    b.vy = dir.sin() * s;
                    b.trail_count = 0;
                    b.px = cx;
                    b.py = cy;
                }
                for _ in 0..self.p.spawn_on_escape {
                    if self.inside_count() >= self.p.max_balls {
                        break;
                    }
                    let jx = self.rng.range(-2.0, 2.0);
                    self.spawn_random_ball(cx + jx, cy, 0);
                }
            }
            Mode::Koth => {
                self.balls[i].escaped = true;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64, bx);
                self.burst(bx, by, bhue, 40, 500.0, br * 0.3);
                let inside: Vec<u32> = self.balls.iter().filter(|b| b.alive && !b.escaped).map(|b| b.team).collect();
                if inside.len() <= 1 {
                    self.winner_team = inside.first().map(|t| *t as i32).unwrap_or(team as i32);
                    self.finish(false);
                }
            }
            _ => {
                self.balls[i].escaped = true;
                self.emit(EV_ESCAPE, 1.0, br, 0.0, team as f64, bx);
            }
        }
    }

    fn collide_powerups(&mut self) {
        let mut k = 0;
        while k < self.powerups.len() {
            let (px, py, pr, kind) = {
                let p = &self.powerups[k];
                (p.x, p.y, p.r, p.kind)
            };
            let hit = self.balls.iter().position(|b| {
                b.alive && !b.escaped && !b.frozen && {
                    let (dx, dy) = (b.x - px, b.y - py);
                    dx * dx + dy * dy < (b.r + pr) * (b.r + pr)
                }
            });
            if let Some(i) = hit {
                self.powerups.swap_remove(k);
                self.apply_powerup(i, kind);
                continue;
            }
            k += 1;
        }
    }

    fn apply_powerup(&mut self, i: usize, kind: u32) {
        let rin = if self.rings.is_empty() { self.p.ring_radius } else { self.inner_radius(0) };
        let (x, y, r, hue) = {
            let b = &self.balls[i];
            (b.x, b.y, b.r, b.hue)
        };
        match kind {
            0 => {
                // Split: a mirrored twin.
                if self.inside_count() < self.p.max_balls {
                    let b = self.balls[i].clone();
                    self.add_ball(b.x, b.y, -b.vx, b.vy, b.r, (b.hue + 60.0) % 360.0, b.level, b.team);
                }
            }
            1 => {
                let mut b = self.balls[i].clone();
                b.vx *= 1.35;
                b.vy *= 1.35;
                self.clamp_speed(&mut b);
                self.balls[i] = b;
            }
            2 => self.balls[i].r = (r * 1.3).min(rin * 0.5),
            _ => self.balls[i].r = (r * 0.75).max(3.0),
        }
        self.emit(EV_POWERUP, 1.0, r, kind as f64, 0.0, x);
        self.burst(x, y, hue, 16, 300.0, r * 0.3);
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
            'cells: for oy in -1..=1 {
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
                                break 'cells;
                            }
                        }
                        j = self.grid_next[ju];
                    }
                }
            }
        }
    }

    fn resolve_pair(&mut self, i: usize, j: usize) {
        let mode = self.p.mode;
        let (a, b) = {
            let (lo, hi) = self.balls.split_at_mut(j);
            (&mut lo[i], &mut hi[0])
        };
        if !a.alive || !b.alive || a.escaped || b.escaped || (a.frozen && b.frozen) {
            return;
        }
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        let rs = a.r + b.r;
        let d2 = dx * dx + dy * dy;
        if d2 >= rs * rs || d2 < 1e-12 {
            return;
        }
        if mode == Mode::Merge && a.level == b.level && a.level < MERGE_GOAL {
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
            self.emit(EV_MERGE, 1.0, r, level as f64, 0.0, x);
            self.burst(x, y, Self::level_hue(level), 14, 260.0, r * 0.25);
            if level >= MERGE_GOAL {
                self.finish(false);
            }
            return;
        }
        if mode == Mode::Collision && !self.exploded && !a.frozen && !b.frozen {
            let x = (a.x + b.x) * 0.5;
            let y = (a.y + b.y) * 0.5;
            let (ha, hb) = (a.hue, b.hue);
            a.alive = false;
            b.alive = false;
            self.exploded = true;
            self.counter = self.p.explode_count as f64;
            let s = self.p.initial_speed.max(300.0) * 1.2;
            for k in 0..self.p.explode_count {
                let ang = self.rng.range(0.0, 2.0 * PI);
                let sp = self.rng.range(0.3, 1.0) * s;
                let hue = if k % 2 == 0 { ha } else { hb };
                let r = self.p.ball_radius * 0.45;
                self.add_ball(x, y, ang.cos() * sp, ang.sin() * sp, r.max(2.0), (hue + k as f64 * 3.0) % 360.0, 0, 0);
            }
            self.emit(EV_EXPLODE, 1.0, rs, 0.0, 0.0, x);
            self.burst(x, y, ha, 60, 700.0, self.p.ball_radius * 0.4);
            self.finish(false);
            return;
        }
        let d = d2.sqrt();
        let (nx, ny) = (dx / d, dy / d);
        let overlap = rs - d;
        // Frozen balls are immovable (infinite mass).
        let ma = if a.frozen { 0.0 } else { 1.0 / (a.r * a.r) };
        let mb = if b.frozen { 0.0 } else { 1.0 / (b.r * b.r) };
        let inv = ma + mb;
        a.x -= nx * overlap * ma / inv;
        a.y -= ny * overlap * ma / inv;
        b.x += nx * overlap * mb / inv;
        b.y += ny * overlap * mb / inv;
        let rv = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny;
        if rv < 0.0 {
            let e = self.p.restitution.min(1.0);
            let jimp = -(1.0 + e) * rv / inv;
            a.vx -= jimp * ma * nx;
            a.vy -= jimp * ma * ny;
            b.vx += jimp * mb * nx;
            b.vy += jimp * mb * ny;
            if -rv > self.p.min_sound_speed.max(150.0) {
                let (r, level, team, x) = (a.r.min(b.r), a.level, a.team, a.x);
                self.emit(EV_HIT, -rv, r, level as f64, team as f64, x);
            }
        }
    }

    fn build_render(&mut self, trail_len: usize) {
        self.out_balls.clear();
        self.out_trails.clear();
        self.out_rings.clear();
        self.out_particles.clear();
        self.out_walls.clear();
        self.out_gems.clear();
        self.out_powerups.clear();
        self.out_lines.clear();
        let trail_len = trail_len.min(MAX_TRAIL);
        let lines = self.p.impact_lines;
        let impact_mode = self.p.impact_mode;
        for b in self.balls.iter_mut().filter(|b| b.alive) {
            self.out_balls.extend_from_slice(&[
                b.x as f32,
                b.y as f32,
                b.r as f32,
                b.hue as f32,
                b.px as f32,
                b.py as f32,
                b.bounces as f32,
                b.frozen as u32 as f32,
            ]);
            b.px = b.x;
            b.py = b.y;
            let count = b.trail_count.min(trail_len);
            let (mut lx, mut ly) = (b.x as f32, b.y as f32);
            for k in 0..count {
                let idx = (b.trail_head + MAX_TRAIL - 1 - k) % MAX_TRAIL;
                let (tx, ty) = (b.trail[idx * 2], b.trail[idx * 2 + 1]);
                let f = 1.0 - (k as f32 + 1.0) / (count as f32 + 1.0);
                self.out_trails.extend_from_slice(&[lx, ly, tx, ty, b.r as f32 * (0.35 + 0.6 * f), b.hue as f32, f * 0.6, b.bounces as f32]);
                lx = tx;
                ly = ty;
            }
            // Impact lines: strings from the ball to its last contacts, or a polyline through them.
            let n = b.contact_count.min(lines);
            let (mut px, mut py) = (b.x as f32, b.y as f32);
            for k in 0..n {
                let idx = (b.contact_head + MAX_CONTACTS - 1 - k) % MAX_CONTACTS;
                let (cx, cy) = (b.contacts[idx * 2], b.contacts[idx * 2 + 1]);
                let alpha = 0.85 * (1.0 - k as f32 / (n as f32 + 1.0));
                let (sx, sy) = if impact_mode == 2 { (px, py) } else { (b.x as f32, b.y as f32) };
                self.out_lines.extend_from_slice(&[sx, sy, cx, cy, 1.6, b.hue as f32, alpha, b.bounces as f32]);
                px = cx;
                py = cy;
            }
        }
        let (cx, cy) = (self.p.cx as f32, self.p.cy as f32);
        for r in self.rings.iter().filter(|r| r.alive) {
            let glass = if r.hp > 0 { 1.0 - r.hits as f32 / r.hp as f32 } else { -1.0 };
            self.out_rings.extend_from_slice(&[
                cx,
                cy,
                r.r as f32,
                r.thickness as f32,
                r.rot as f32,
                r.gap as f32,
                r.hue as f32,
                r.flash as f32,
                Self::spike_center(r) as f32,
                self.p.spike_arc as f32,
                glass,
                self.p.spike_size as f32,
            ]);
        }
        let rot = self.spiral_rot;
        let half = self.p.ring_thickness as f32 * 0.5;
        for w in &self.walls {
            let (ax, ay) = rotate(w.ax, w.ay, rot);
            let (bx, by) = rotate(w.bx, w.by, rot);
            self.out_walls.extend_from_slice(&[ax as f32 + cx, ay as f32 + cy, bx as f32 + cx, by as f32 + cy, half, 0.0, 1.0, 0.0]);
        }
        for g in self.gems.iter().filter(|g| g.alive) {
            let (gx, gy) = rotate(g.lx, g.ly, rot);
            self.out_gems.extend_from_slice(&[gx as f32 + cx, gy as f32 + cy, g.r as f32, 190.0, 1.0, g.mult as f32]);
        }
        for p in &self.powerups {
            self.out_powerups.extend_from_slice(&[
                p.x as f32,
                p.y as f32,
                p.r as f32,
                p.kind as f32,
                (p.life / POWERUP_LIFE) as f32,
                (self.time * 6.0).sin() as f32,
            ]);
        }
        if self.p.portals && !self.rings.is_empty() {
            let pulse = (self.time * 4.0).sin() as f32;
            for (k, (px, py)) in self.portal_pos.iter().enumerate() {
                self.out_powerups.extend_from_slice(&[*px as f32, *py as f32, self.p.portal_size as f32, 4.0 + k as f32, 1.0, pulse]);
            }
        }
        if self.p.magnet != 0.0 || self.time < self.black_hole_until {
            let pulse = (self.time * 8.0).sin() as f32;
            let r = if self.time < self.black_hole_until { 46.0 } else { 22.0 };
            self.out_powerups.extend_from_slice(&[cx, cy, r, 6.0, 1.0, pulse]);
        }
        for p in &self.particles {
            self.out_particles.extend_from_slice(&[p.x as f32, p.y as f32, p.size as f32, p.hue as f32, (p.life / p.max_life) as f32, 0.0]);
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
            10 => self.total_bounces as f64,
            11 => self.balls.iter().filter(|b| b.alive && b.frozen).count() as f64,
            12 => self.multiplier,
            14 => self.near_misses as f64,
            15 => self.last_near_miss,
            16 => self.last_chaos_kind as f64,
            17 => self.last_chaos_time,
            18 => (self.time < self.black_hole_until) as u32 as f64,
            13 => self
                .rings
                .iter()
                .find(|r| r.alive && r.hp > 0)
                .map(|r| 1.0 - r.hits as f64 / r.hp as f64)
                .unwrap_or(-1.0),
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

/// (Re)builds the simulation from the parameter buffer. Safe to call repeatedly.
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
buffer_exports!(trails_ptr, trails_len, out_trails, SEG_STRIDE);
buffer_exports!(rings_ptr, rings_len, out_rings, RING_STRIDE);
buffer_exports!(particles_ptr, particles_len, out_particles, PARTICLE_STRIDE);
buffer_exports!(walls_ptr, walls_len, out_walls, SEG_STRIDE);
buffer_exports!(gems_ptr, gems_len, out_gems, GEM_STRIDE);
buffer_exports!(powerups_ptr, powerups_len, out_powerups, POWERUP_STRIDE);
buffer_exports!(lines_ptr, lines_len, out_lines, SEG_STRIDE);
buffer_exports!(events_ptr, events_len, out_events, EVENT_STRIDE);
