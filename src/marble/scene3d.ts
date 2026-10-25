import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { drawTitle } from '../render/hud';
import { ballAt, cameraTarget, type Bar, type Course, type Vec3 } from './choreo';
import type { MarbleConfig } from './config';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const RING_TIME = 0.9;

/**
 * The 3D marble machine: wooden / white bars on black holders, rails, curved ramps
 * and a steel ball, rendered with Three.js. Everything is a pure function of time,
 * so preview scrubbing and export frames match exactly. Works on a regular canvas
 * and on an OffscreenCanvas inside a worker.
 */
export class MarbleScene {
  readonly renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private spot: THREE.SpotLight;
  private hemi: THREE.HemisphereLight;
  private ball: THREE.Group;
  private course: Course | null = null;
  private dynamic = new THREE.Group();
  private meshes: { kind: Bar['kind']; mesh: THREE.InstancedMesh; bars: Bar[]; base: THREE.Matrix4[]; color: THREE.Color[] }[] = [];
  private active = new Set<string>();
  private cfg: MarbleConfig | null = null;
  private envTex: THREE.Texture;

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

    this.camera = new THREE.PerspectiveCamera(42, width / height, 0.6, 80);
    this.hemi = new THREE.HemisphereLight(0xc8d4ff, 0x20242e, 0.5);
    this.spot = new THREE.SpotLight(0xfff3e0, 80, 16, 0.8, 0.55, 1.4);
    this.spot.shadow.mapSize.set(1024, 1024);
    this.spot.shadow.bias = -0.0005;
    this.spot.shadow.camera.near = 0.3;
    this.scene.add(this.hemi, this.spot, this.spot.target, this.dynamic);

    // Steel ball with a red band, so its spin is visible.
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
    this.applyLook(cfg);
    for (const obj of [...this.dynamic.children]) {
      this.dynamic.remove(obj);
      disposeDeep(obj);
    }
    this.meshes = [];
    this.active.clear();

    const box = new THREE.BoxGeometry(1, 1, 1);
    const holderMat = new THREE.MeshStandardMaterial({ color: cfg.holderColor, roughness: 0.6, metalness: 0.2 });
    for (const kind of ['wood', 'white'] as const) {
      const bars = course.bars.filter((b) => b.kind === kind);
      if (bars.length === 0) continue;
      const mat = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: kind === 'wood' ? 0.55 : 0.3,
        metalness: kind === 'wood' ? 0 : 0.15,
        envMap: this.envTex,
        envMapIntensity: 0.6,
      });
      const mesh = new THREE.InstancedMesh(box, mat, bars.length);
      mesh.castShadow = mesh.receiveShadow = true;
      const baseColor = new THREE.Color(kind === 'wood' ? cfg.woodColor : cfg.whiteColor);
      const base: THREE.Matrix4[] = [];
      const colors: THREE.Color[] = [];
      bars.forEach((b, i) => {
        const m = barMatrix(b, 0);
        base.push(m);
        mesh.setMatrixAt(i, m);
        const c = vary(baseColor.clone(), i);
        colors.push(c);
        mesh.setColorAt(i, c);
      });
      this.dynamic.add(mesh);
      this.meshes.push({ kind, mesh, bars, base, color: colors });
    }

    // Black holders: two blocks behind the ends of each free bar.
    const free = course.bars.filter((b) => !b.inRow);
    if (free.length > 0) {
      const holders = new THREE.InstancedMesh(box, holderMat, free.length * 2);
      holders.castShadow = holders.receiveShadow = true;
      const m = new THREE.Matrix4();
      free.forEach((b, i) => {
        for (const s of [-1, 1]) {
          const n = v3(b.normal), a = v3(b.axis);
          const w = new THREE.Vector3().crossVectors(a, n);
          const p = v3(b.center).addScaledVector(a, s * b.length * 0.36).addScaledVector(n, -0.05);
          m.makeBasis(a, n, w).scale(new THREE.Vector3(0.07, 0.1, b.width * 1.15)).setPosition(p);
          holders.setMatrixAt(i * 2 + (s > 0 ? 1 : 0), m);
        }
      });
      this.dynamic.add(holders);
    }

    // Rails under rolling rows.
    const railMat = new THREE.MeshStandardMaterial({ color: 0x2a2d34, roughness: 0.35, metalness: 0.8, envMap: this.envTex });
    for (const r of course.rails) {
      const from = v3(r.from), to = v3(r.to);
      const dir = to.clone().sub(from);
      const side = new THREE.Vector3(0, 1, 0).cross(dir).normalize().multiplyScalar(0.16);
      for (const s of [-1, 1]) {
        const a = from.clone().addScaledVector(side, s), b = to.clone().addScaledVector(side, s);
        this.dynamic.add(rod(a, b, 0.022, railMat));
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
        const tube = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 64, 0.025, 8), railMat);
        tube.castShadow = tube.receiveShadow = true;
        this.dynamic.add(tube);
      }
    }
  }

  /** Colours, fog, lights and ball — no geometry rebuild needed. */
  applyLook(cfg: MarbleConfig): void {
    this.cfg = cfg;
    const bg = new THREE.Color(cfg.bgColor);
    this.scene.background = bg;
    const near = 4 + (1 - cfg.fog) * 6;
    this.scene.fog = new THREE.Fog(bg, near, near + 4 + (1 - cfg.fog) * 18);
    this.renderer.shadowMap.enabled = cfg.shadows;
    this.spot.castShadow = cfg.shadows;
    this.spot.intensity = 80 * cfg.light;
    this.hemi.intensity = 0.5 * cfg.light;

    for (const obj of [...this.ball.children]) {
      this.ball.remove(obj);
      disposeDeep(obj);
    }
    const R = this.course?.opts.ballRadius ?? 0.16;
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(R, 48, 32),
      new THREE.MeshStandardMaterial({ color: cfg.ballColor, metalness: 1, roughness: 0.3, envMap: this.envTex, envMapIntensity: 1.2 }),
    );
    sphere.castShadow = true;
    const band = new THREE.Mesh(
      new THREE.TorusGeometry(R * 1.002, R * 0.09, 10, 48),
      new THREE.MeshStandardMaterial({ color: cfg.stripeColor, roughness: 0.4, metalness: 0.2 }),
    );
    this.ball.add(sphere, band);
    for (const { kind, mesh, color } of this.meshes) {
      const base = new THREE.Color(kind === 'wood' ? cfg.woodColor : cfg.whiteColor);
      color.forEach((c, i) => {
        vary(c.copy(base), i);
        mesh.setColorAt(i, c);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
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

    const target = v3(cameraTarget(course, t));
    const h = cfg.cameraHeight;
    this.camera.position.set(target.x, target.y + h, target.z + h * cfg.cameraTilt);
    this.camera.lookAt(target.x, target.y - 0.6, target.z);
    this.spot.position.set(p.x * 0.5 + 0.8, p.y + 3.2, p.z + 1.4);
    this.spot.target.position.copy(p).add(new THREE.Vector3(0, -0.8, 0));

    this.animateBars(t, cfg);
    this.renderer.render(this.scene, this.camera);
  }

  /** Bars ring after a hit: a tiny decaying wobble plus a short flash. */
  private animateBars(t: number, cfg: MarbleConfig): void {
    const now = new Set<string>();
    const flash = new THREE.Color(0xffffff);
    const tmp = new THREE.Color();
    for (let mi = 0; mi < this.meshes.length; mi++) {
      const { mesh, bars, base, color } = this.meshes[mi];
      let touched = false;
      for (let i = 0; i < bars.length; i++) {
        const dt = t - bars[i].hitTime;
        const key = mi + ':' + i;
        if (dt >= 0 && dt < RING_TIME) {
          now.add(key);
          mesh.setMatrixAt(i, barMatrix(bars[i], 0.09 * Math.exp(-dt * 6) * Math.sin(dt * 55)));
          if (cfg.flash) mesh.setColorAt(i, tmp.copy(color[i]).lerp(flash, 0.55 * Math.exp(-dt * 14)));
          touched = true;
        } else if (this.active.has(key)) {
          mesh.setMatrixAt(i, base[i]);
          mesh.setColorAt(i, color[i]);
          touched = true;
        }
      }
      if (touched) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
    this.active = now;
  }

  dispose(): void {
    disposeDeep(this.scene);
    this.envTex.dispose();
    this.renderer.dispose();
  }
}

/** Small deterministic per-bar colour variation, like real wood grain. */
function vary(c: THREE.Color, i: number): THREE.Color {
  return c.offsetHSL(((i * 0.6180339) % 1 - 0.5) * 0.02, 0, ((i * 0.381966) % 1 - 0.5) * 0.06);
}

/** Placement of a bar, optionally twisted around its long axis by `wobble` radians. */
function barMatrix(b: Bar, wobble: number): THREE.Matrix4 {
  const a = v3(b.axis), n = v3(b.normal);
  if (wobble) n.applyAxisAngle(a, wobble);
  const w = new THREE.Vector3().crossVectors(a, n);
  return new THREE.Matrix4().makeBasis(a, n, w).scale(new THREE.Vector3(b.length, 0.05, b.width)).setPosition(v3(b.center));
}

function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material): THREE.Mesh {
  const len = a.distanceTo(b);
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 10), mat);
  mesh.position.copy(a).add(b).multiplyScalar(0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), b.clone().sub(a).normalize());
  mesh.castShadow = mesh.receiveShadow = true;
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
