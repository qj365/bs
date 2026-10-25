import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { drawTitle } from '../render/hud';
import { ballAt, cameraTarget, type Bar, type Course, type Vec3 } from './choreo';
import type { MarbleConfig } from './config';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const RING_TIME = 0.9;
const THICK = 0.07;

/**
 * The 3D marble machine in the look of the classic "marble music" videos: orange
 * wooden bars that turn white once played, black wire brackets, rails and curved
 * ramps, a dark steel ball carrying a light that throws the bars' shadows onto
 * the wall behind. Everything is a pure function of time, so preview scrubbing
 * and export frames match exactly. Works on a canvas and on an OffscreenCanvas
 * inside a worker.
 */
export class MarbleScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private lamp: THREE.SpotLight;
  private hemi: THREE.HemisphereLight;
  private key = new THREE.DirectionalLight(0xfff4e6, 1.3);
  private wall: THREE.Mesh;
  private ball: THREE.Group;
  private course: Course | null = null;
  private dynamic = new THREE.Group();
  private bars: THREE.InstancedMesh | null = null;
  private barList: Bar[] = [];
  private base: THREE.Matrix4[] = [];
  private active = new Set<number>();
  private cfg: MarbleConfig | null = null;
  private envTex: THREE.Texture;
  private woodTex: THREE.Texture;

  constructor(readonly canvas: AnyCanvas, width: number, height: number) {
    this.renderer = new THREE.WebGLRenderer({ canvas: canvas as HTMLCanvasElement, antialias: true, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(width, height, false);
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    pmrem.dispose();
    this.woodTex = woodTexture();

    this.camera = new THREE.PerspectiveCamera(68, width / height, 0.1, 60);
    this.hemi = new THREE.HemisphereLight(0xc8d4ff, 0x1a1e28, 0.35);
    // The lamp rides with the ball and shines away from the camera, so every bar
    // near the ball casts a long shadow streak on the wall.
    this.lamp = new THREE.SpotLight(0xe8f0ff, 40, 0, 1.35, 1, 1.6);
    this.lamp.shadow.mapSize.set(1024, 1024);
    this.lamp.shadow.bias = -0.0008;
    this.lamp.shadow.intensity = 0.7;
    this.lamp.shadow.camera.near = 0.05;
    this.lamp.shadow.camera.far = 20;
    this.wall = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.MeshStandardMaterial({ color: 0x3a4458, roughness: 1 }));
    this.wall.receiveShadow = true;
    this.scene.add(this.hemi, this.key, this.key.target, this.lamp, this.lamp.target, this.wall, this.dynamic);
    this.ball = new THREE.Group();
    this.scene.add(this.ball);
  }

  resize(width: number, height: number): void {
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  /** Rebuilds all geometry for a new course / look. */
  setCourse(course: Course, cfg: MarbleConfig): void {
    this.course = course;
    for (const obj of [...this.dynamic.children]) {
      this.dynamic.remove(obj);
      disposeDeep(obj);
    }
    this.active.clear();
    this.bars = null;
    this.barList = course.bars;
    this.base = [];

    const box = new THREE.BoxGeometry(1, 1, 1);
    if (course.bars.length > 0) {
      // Plate faces (±Y of the box) show the wood grain and the two pin holes.
      const face = new THREE.MeshStandardMaterial({ map: this.woodTex, roughness: 0.6, envMap: this.envTex, envMapIntensity: 0.35 });
      const edge = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7, envMap: this.envTex, envMapIntensity: 0.3 });
      const mesh = new THREE.InstancedMesh(box, [edge, edge, face, face, edge, edge], course.bars.length);
      mesh.castShadow = mesh.receiveShadow = true;
      course.bars.forEach((b, i) => {
        const m = barMatrix(b, 0);
        this.base.push(m);
        mesh.setMatrixAt(i, m);
        mesh.setColorAt(i, new THREE.Color(cfg.barColor));
      });
      this.bars = mesh;
      this.dynamic.add(mesh);
    }

    // Black wire brackets (a ㄷ shape behind each free bar, with a knob on top).
    const free = course.bars.filter((b) => !b.inRow);
    const wire = new THREE.MeshStandardMaterial({ color: cfg.holderColor, roughness: 0.45, metalness: 0.6, envMap: this.envTex });
    if (free.length > 0) {
      const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), wire, free.length * 3);
      const knobs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), wire, free.length);
      rods.castShadow = knobs.castShadow = true;
      const m = new THREE.Matrix4();
      free.forEach((b, i) => {
        const n = v3(b.normal), a = v3(b.axis), c = v3(b.center);
        const back = c.clone().addScaledVector(n, -THICK / 2);
        const depth = 0.16;
        const ends = [-1, 1].map((s) => back.clone().addScaledVector(a, s * b.length * 0.3));
        const far = ends.map((p) => p.clone().addScaledVector(n, -depth));
        rods.setMatrixAt(i * 3, rodMatrix(ends[0], far[0], 0.011, m).clone());
        rods.setMatrixAt(i * 3 + 1, rodMatrix(ends[1], far[1], 0.011, m).clone());
        rods.setMatrixAt(i * 3 + 2, rodMatrix(far[0], far[1], 0.011, m).clone());
        const top = far[0].y > far[1].y ? far[0] : far[1];
        knobs.setMatrixAt(i, m.makeScale(0.025, 0.025, 0.025).setPosition(top));
      });
      this.dynamic.add(rods, knobs);
    }

    // Rails under rolling rows, with little posts.
    for (const r of course.rails) {
      const from = v3(r.from), to = v3(r.to);
      const dir = to.clone().sub(from);
      const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize().multiplyScalar(0.17);
      for (const s of [-1, 1]) {
        this.dynamic.add(rod(from.clone().addScaledVector(side, s), to.clone().addScaledVector(side, s), 0.016, wire));
      }
    }

    // Curved ramps: two rails just outside the ball's path.
    const R = course.opts.ballRadius;
    for (const ramp of course.ramps) {
      for (const s of [-1, 1]) {
        const pts: THREE.Vector3[] = [];
        for (let i = 0; i <= 48; i++) {
          const a = ramp.a0 + ((ramp.a1 - ramp.a0) * i) / 48;
          const rr = ramp.radius + R * 0.75;
          pts.push(new THREE.Vector3(ramp.center[0] + Math.cos(a) * rr, ramp.center[1] + Math.sin(a) * rr, ramp.z + s * R * 0.75));
        }
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.018, 6), wire);
        tube.castShadow = true;
        this.dynamic.add(tube);
      }
    }
    this.applyLook(cfg);
  }

  /** Colours, fog, lights and ball — no geometry rebuild needed. */
  applyLook(cfg: MarbleConfig): void {
    this.cfg = cfg;
    const bg = new THREE.Color(cfg.bgColor);
    this.scene.background = bg;
    (this.wall.material as THREE.MeshStandardMaterial).color.copy(bg);
    const near = cfg.cameraDistance + 0.5;
    this.scene.fog = new THREE.Fog(bg, near, near + 3 + (1 - cfg.fog) * 14);
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.lamp.castShadow = cfg.shadows;
    this.lamp.intensity = 40 * cfg.light;
    this.hemi.intensity = 0.35 * cfg.light;
    this.key.intensity = 1.3 * cfg.light;
    // Materials must recompile when shadows are toggled.
    this.scene.traverse((o) => {
      const mat = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
      for (const m of Array.isArray(mat) ? mat : mat ? [mat] : []) m.needsUpdate = true;
    });

    for (const obj of [...this.ball.children]) {
      this.ball.remove(obj);
      disposeDeep(obj);
    }
    const R = this.course?.opts.ballRadius ?? 0.11;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 32),
      new THREE.MeshStandardMaterial({ color: cfg.ballColor, metalness: 1, roughness: 0.32, envMap: this.envTex, envMapIntensity: 1 }),
    );
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.002, R * 0.1, 10, 48),
      new THREE.MeshStandardMaterial({ color: cfg.stripeColor, roughness: 0.4, metalness: 0.2, emissive: cfg.stripeColor, emissiveIntensity: 0.25 }),
    );
    this.ball.add(sphere, band);
    this.active.clear();
  }

  /** Renders the frame at course time `t`. */
  render(t: number): void {
    const course = this.course;
    const cfg = this.cfg;
    if (!course || !cfg) {
      this.renderer.render(this.scene, this.camera);
      return;
    }
    const p = v3(ballAt(course, t));
    this.ball.position.copy(p);
    const q = v3(ballAt(course, t + 0.02)).sub(p);
    const axis = new THREE.Vector3(0, 1, 0).cross(q);
    if (axis.lengthSq() > 1e-10) this.ball.quaternion.setFromAxisAngle(axis.normalize(), (t - course.start) * 9);

    // Camera: a little above and to the side, always looking at the ball.
    const target = v3(cameraTarget(course, t));
    const az = (cfg.cameraAngle * Math.PI) / 180;
    const el = (cfg.cameraElevation * Math.PI) / 180;
    const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el));
    this.camera.position.copy(target).addScaledVector(dir, cfg.cameraDistance);
    this.camera.lookAt(target);

    // Lamp just in front of the ball, shining at the wall: nearby bars throw long shadow streaks.
    this.lamp.position.copy(p).addScaledVector(dir, 0.45).add(new THREE.Vector3(0, 0.35, 0));
    this.lamp.target.position.copy(p).addScaledVector(dir, -5);
    this.wall.position.copy(target).addScaledVector(dir, -2);
    // Soft key light from over the camera's shoulder so the bars read clearly.
    this.key.position.copy(target).addScaledVector(dir, 4).add(new THREE.Vector3(0, 3, 0));
    this.key.target.position.copy(target);
    this.wall.lookAt(this.camera.position);

    this.paintBars(t, cfg);
    this.renderer.render(this.scene, this.camera);
  }

  /** Bars are orange until hit, then white; a hit adds a short wobble and flash. */
  private paintBars(t: number, cfg: MarbleConfig): void {
    const mesh = this.bars;
    if (!mesh) return;
    const fresh = new THREE.Color(cfg.barColor);
    const played = new THREE.Color(cfg.playedColor);
    const flash = new THREE.Color(0xffffff);
    const tmp = new THREE.Color();
    const now = new Set<number>();
    const bars = this.barList;
    for (let i = 0; i < bars.length; i++) {
      const dt = t - bars[i].hitTime;
      if (dt < 0) {
        mesh.setColorAt(i, fresh);
      } else if (dt < RING_TIME) {
        tmp.copy(fresh).lerp(played, Math.min(1, dt / 0.12));
        if (cfg.flash) tmp.lerp(flash, 0.6 * Math.exp(-dt * 14));
        mesh.setColorAt(i, tmp);
      } else {
        mesh.setColorAt(i, played);
      }
      if (dt >= 0 && dt < RING_TIME) {
        now.add(i);
        mesh.setMatrixAt(i, barMatrix(bars[i], 0.09 * Math.exp(-dt * 6) * Math.sin(dt * 55)));
      } else if (this.active.has(i)) {
        mesh.setMatrixAt(i, this.base[i]);
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.active = now;
  }

  dispose(): void {
    disposeDeep(this.scene);
    this.envTex.dispose();
    this.woodTex.dispose();
    this.renderer.dispose();
  }
}

/** Light wood grain with two dark pin holes; tinted per bar by the instance colour. */
function woodTexture(): THREE.Texture {
  const W = 192, H = 96;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // Soft mottling along the bar, like the grain in the original videos.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < 70; i++) {
    const g = 205 + Math.floor(rnd() * 45);
    ctx.fillStyle = `rgba(${g},${g},${g},0.55)`;
    ctx.beginPath();
    ctx.ellipse(rnd() * W, rnd() * H, 10 + rnd() * 40, 3 + rnd() * 10, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#141414';
  for (const u of [0.33, 0.67]) {
    ctx.beginPath();
    ctx.arc(u * W, H / 2, 8, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c as unknown as HTMLCanvasElement);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

/** Placement of a bar, optionally twisted around its long axis by `wobble` radians. */
function barMatrix(b: Bar, wobble: number): THREE.Matrix4 {
  const a = v3(b.axis), n = v3(b.normal);
  if (wobble) n.applyAxisAngle(a, wobble);
  const w = new THREE.Vector3().crossVectors(a, n);
  return new THREE.Matrix4().makeBasis(a, n, w).scale(new THREE.Vector3(b.length, THICK, b.width)).setPosition(v3(b.center));
}

/** Matrix that turns a unit cylinder (height 1 along Y) into a rod from a to b. */
function rodMatrix(a: THREE.Vector3, b: THREE.Vector3, r: number, out: THREE.Matrix4): THREE.Matrix4 {
  const d = b.clone().sub(a);
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.clone().normalize());
  return out.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(r, d.length(), r));
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 1, 8), mat);
  mesh.applyMatrix4(rodMatrix(a, b, 1, new THREE.Matrix4()));
  mesh.castShadow = true;
  return mesh;
}

function disposeDeep(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((x) => x.dispose());
    else mat?.dispose();
  });
}

/** Title at the top and subtitle at the bottom, drawn over the 3D frame. */
export function drawMarbleText(ctx: Canvas2D, cfg: MarbleConfig, width: number, height: number): void {
  const k = width / 720;
  if (cfg.title.trim()) drawTitle(ctx, cfg.title.trim(), width / 2, height * 0.12, cfg.titleSize * k, cfg.textColor, width * 0.86);
  if (cfg.subtitle.trim()) drawTitle(ctx, cfg.subtitle.trim(), width / 2, height * 0.86, cfg.subtitleSize * k, cfg.textColor, width * 0.86);
}
