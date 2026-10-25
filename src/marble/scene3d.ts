import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { drawTitle } from '../render/hud';
import { ballAt, cameraTarget, type Bar, type Course, type Vec3 } from './choreo';
import { strikerFor, type MarbleConfig, type StrikerKind } from './config';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;
type Canvas2D = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

const v3 = (p: Vec3) => new THREE.Vector3(p[0], p[1], p[2]);
const RING_TIME = 0.9;
const THICK = 0.07;
const SPARK_MAX = 600;
const SPARK_LIFE = 0.6;

/** Deterministic pseudo-random number in [0, 1). */
function hash(x: number): number {
  const s = Math.sin(x * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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
  private key = new THREE.DirectionalLight(0xffffff, 1.3);
  private wall: THREE.Mesh;
  private ball: THREE.Group;
  private course: Course | null = null;
  private dynamic = new THREE.Group();
  /** One instanced mesh per kind of struck object; `idx` maps instances to course bars. */
  private groups: { kind: StrikerKind; mesh: THREE.InstancedMesh; extra: THREE.InstancedMesh | null; idx: number[] }[] = [];
  private kinds: StrikerKind[] = [];
  private barList: Bar[] = [];
  private base: THREE.Matrix4[] = [];
  private active = new Set<number>();
  private cfg: MarbleConfig | null = null;
  private envTex: THREE.Texture;
  private woodTex: THREE.Texture;
  private dotsTex: THREE.Texture;
  private fresh: THREE.Color[] = [];
  private played: THREE.Color[] = [];
  private sparks: THREE.Points;
  private sparkPos = new Float32Array(SPARK_MAX * 3);
  private sparkCol = new Float32Array(SPARK_MAX * 3);

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
    this.woodTex = woodTexture(true);
    this.dotsTex = woodTexture(false);

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

    // Sparks that burst from a bar when it is hit (positions are a pure function of time).
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.sparkPos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(this.sparkCol, 3));
    this.sparks = new THREE.Points(g, new THREE.PointsMaterial({
      size: 0.035, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    }));
    this.sparks.frustumCulled = false;
    this.scene.add(this.sparks);
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
    this.groups = [];
    this.barList = course.bars;
    this.kinds = course.bars.map((b) => strikerFor(cfg, b.notes, b.inRow));
    this.base = course.bars.map((b, i) => objectMatrix(this.kinds[i], b, 0));

    for (const kind of ['bar', 'bell', 'drum', 'glass', 'tube', 'gong', 'pad'] as StrikerKind[]) {
      const idx = this.kinds.flatMap((k, i) => (k === kind ? [i] : []));
      if (idx.length === 0) continue;
      const mesh = new THREE.InstancedMesh(objectGeometry(kind), new THREE.MeshBasicMaterial(), idx.length);
      mesh.castShadow = mesh.receiveShadow = true;
      idx.forEach((i, j) => {
        mesh.setMatrixAt(j, this.base[i]);
        mesh.setColorAt(j, new THREE.Color(cfg.barColor));
      });
      // Drum skins and pad rims are separate, untinted parts that move with the object.
      let extra: THREE.InstancedMesh | null = null;
      if (kind === 'drum' || kind === 'pad') {
        const geo = kind === 'drum'
          ? new THREE.CircleGeometry(0.49, 28).rotateX(-Math.PI / 2).translate(0, 0.002, 0)
          : new THREE.TorusGeometry(0.5, 0.07, 8, 28).rotateX(Math.PI / 2).translate(0, -0.5, 0);
        const mat = kind === 'drum'
          ? new THREE.MeshStandardMaterial({ color: 0xf2ece0, roughness: 0.85 })
          : new THREE.MeshStandardMaterial({ color: cfg.holderColor, roughness: 0.5, metalness: 0.3 });
        extra = new THREE.InstancedMesh(geo, mat, idx.length);
        extra.castShadow = true;
        idx.forEach((i, j) => extra!.setMatrixAt(j, this.base[i]));
        this.dynamic.add(extra);
      }
      this.groups.push({ kind, mesh, extra, idx });
      this.dynamic.add(mesh);
    }

    // Holders: black ㄷ wire brackets behind free bars; hanging rods for bells and tubes;
    // a stand rod behind drums, gongs, pads and glasses.
    const wire = new THREE.MeshStandardMaterial({ color: cfg.holderColor, roughness: 0.45, metalness: 0.6, envMap: this.envTex });
    const rodsList: [THREE.Vector3, THREE.Vector3][] = [];
    const knobList: THREE.Vector3[] = [];
    course.bars.forEach((b, i) => {
      if (b.inRow) return;
      const n = v3(b.normal), a = v3(b.axis);
      const surf = v3(b.center).addScaledVector(n, THICK / 2);
      const { depth, half } = objectExtent(this.kinds[i], b);
      switch (this.kinds[i]) {
        case 'bar': {
          const back = surf.clone().addScaledVector(n, -THICK);
          const ends = [-1, 1].map((sg) => back.clone().addScaledVector(a, sg * b.length * 0.3));
          const far = ends.map((p) => p.clone().addScaledVector(n, -0.16));
          rodsList.push([ends[0], far[0]], [ends[1], far[1]], [far[0], far[1]]);
          knobList.push(far[0].y > far[1].y ? far[0] : far[1]);
          break;
        }
        case 'bell':
        case 'tube': {
          const top = surf.clone().addScaledVector(n, -depth / 2).addScaledVector(a, half);
          const hook = top.clone().addScaledVector(a, 0.16);
          rodsList.push([top, hook]);
          knobList.push(hook);
          break;
        }
        default: {
          const back = surf.clone().addScaledVector(n, -depth);
          const end = back.clone().addScaledVector(n, -0.17);
          rodsList.push([back, end]);
          knobList.push(end);
        }
      }
    });
    if (rodsList.length > 0) {
      const rods = new THREE.InstancedMesh(new THREE.CylinderGeometry(1, 1, 1, 6), wire, rodsList.length);
      const knobs = new THREE.InstancedMesh(new THREE.SphereGeometry(1, 8, 6), wire, knobList.length);
      rods.castShadow = knobs.castShadow = true;
      const m = new THREE.Matrix4();
      rodsList.forEach(([from, to], k) => rods.setMatrixAt(k, rodMatrix(from, to, 0.011, m)));
      knobList.forEach((p, k) => knobs.setMatrixAt(k, m.makeScale(0.025, 0.025, 0.025).setPosition(p)));
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
    this.wire = wire;
    this.applyLook(cfg);
  }

  private wire: THREE.MeshStandardMaterial | null = null;

  /** Bar materials for a style. Plate faces (±Y of the box) carry the grain and two pin holes. */
  private barMaterials(style: MarbleConfig['barStyle']): THREE.Material[] {
    let face: THREE.Material, edge: THREE.Material;
    switch (style) {
      case 'neon':
        // Unlit and not tone-mapped, so the colours stay fully saturated like neon tubes.
        face = new THREE.MeshBasicMaterial({ map: this.dotsTex, toneMapped: false });
        edge = new THREE.MeshBasicMaterial({ toneMapped: false });
        break;
      case 'glass':
        face = new THREE.MeshStandardMaterial({ map: this.dotsTex, roughness: 0.08, metalness: 0, transparent: true, opacity: 0.78, envMap: this.envTex, envMapIntensity: 0.8 });
        edge = new THREE.MeshStandardMaterial({ roughness: 0.08, transparent: true, opacity: 0.85, envMap: this.envTex, envMapIntensity: 0.8 });
        break;
      case 'metal':
        face = new THREE.MeshStandardMaterial({ map: this.dotsTex, roughness: 0.25, metalness: 1, envMap: this.envTex, envMapIntensity: 1.3 });
        edge = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 1, envMap: this.envTex, envMapIntensity: 1.3 });
        break;
      case 'plain':
        face = new THREE.MeshStandardMaterial({ map: this.dotsTex, roughness: 0.45, envMap: this.envTex, envMapIntensity: 0.4 });
        edge = new THREE.MeshStandardMaterial({ roughness: 0.5, envMap: this.envTex, envMapIntensity: 0.4 });
        break;
      default:
        face = new THREE.MeshStandardMaterial({ map: this.woodTex, roughness: 0.6, envMap: this.envTex, envMapIntensity: 0.35 });
        edge = new THREE.MeshStandardMaterial({ roughness: 0.7, envMap: this.envTex, envMapIntensity: 0.3 });
    }
    return [edge, edge, face, face, edge, edge];
  }

  /** Material for bells, drums, glasses, tubes, gongs and pads (tinted per instance). */
  private objectMaterial(kind: StrikerKind, cfg: MarbleConfig): THREE.Material {
    if (cfg.barStyle === 'neon') return new THREE.MeshBasicMaterial({ toneMapped: false, side: THREE.DoubleSide });
    const env = { envMap: this.envTex, side: THREE.DoubleSide };
    switch (kind) {
      case 'bell': return new THREE.MeshStandardMaterial({ ...env, metalness: 1, roughness: 0.25, envMapIntensity: 1.3 });
      case 'tube': return new THREE.MeshStandardMaterial({ ...env, metalness: 1, roughness: 0.18, envMapIntensity: 1.4 });
      case 'gong': return new THREE.MeshStandardMaterial({ ...env, metalness: 0.9, roughness: 0.35, envMapIntensity: 1.2 });
      case 'glass': return new THREE.MeshStandardMaterial({ ...env, metalness: 0, roughness: 0.03, transparent: true, opacity: 0.38, depthWrite: false, envMapIntensity: 1.8 });
      default: return new THREE.MeshStandardMaterial({ ...env, roughness: 0.55, envMapIntensity: 0.4 });
    }
  }

  /** Per-bar colours before and after the hit, by colour mode. */
  private barColors(cfg: MarbleConfig): void {
    this.fresh = [];
    this.played = [];
    const white = new THREE.Color(0xffffff);
    this.barList.forEach((b, i) => {
      let f: THREE.Color, p: THREE.Color;
      const natural = NATURAL[this.kinds[i]];
      if (cfg.colorMode === 'played' && natural) {
        // Bells, gongs, tubes and glasses keep their own material colour and just brighten when struck.
        f = new THREE.Color(natural);
        p = f.clone().lerp(white, 0.3);
      } else if (cfg.colorMode === 'played') {
        f = new THREE.Color(cfg.barColor);
        p = new THREE.Color(cfg.playedColor);
      } else {
        const hue = cfg.colorMode === 'pitch'
          ? (((Math.min(...b.notes) % 12) + 12) % 12) / 12
          : hash(i * 7.31 + cfg.seed * 0.137);
        f = new THREE.Color().setHSL(hue, cfg.barStyle === 'neon' ? 1 : 0.85, cfg.barStyle === 'neon' ? 0.55 : 0.55);
        p = f.clone().lerp(white, cfg.barStyle === 'neon' ? 0.35 : 0.65);
      }
      this.fresh.push(f);
      this.played.push(p);
    });
  }

  /** Colours, fog, lights and ball — no geometry rebuild needed. */
  applyLook(cfg: MarbleConfig): void {
    this.cfg = cfg;
    const bg = new THREE.Color(cfg.bgColor);
    this.scene.background = bg;
    (this.wall.material as THREE.MeshStandardMaterial).color.copy(bg);
    const near = cfg.cameraDistance + 0.5;
    this.scene.fog = new THREE.Fog(bg, near, near + 3 + (1 - cfg.fog) * 14);
    this.wall.visible = cfg.backdrop === 'wall';
    if (this.wire) this.wire.color.set(cfg.holderColor);
    for (const g of this.groups) {
      const old = g.mesh.material;
      for (const m of Array.isArray(old) ? old : [old]) m.dispose();
      g.mesh.material = g.kind === 'bar' ? this.barMaterials(cfg.barStyle) : this.objectMaterial(g.kind, cfg);
      g.mesh.castShadow = !(g.kind === 'bar' ? cfg.barStyle === 'glass' : g.kind === 'glass');
      if (g.kind === 'pad' && g.extra) (g.extra.material as THREE.MeshStandardMaterial).color.set(cfg.holderColor);
    }
    this.barColors(cfg);
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
    const mat = this.ballMaterial(cfg);
    const faceted = cfg.ballShape === 'gem' || cfg.ballShape === 'diamond' || cfg.ballShape === 'star';
    if (faceted && 'flatShading' in mat) (mat as THREE.MeshStandardMaterial).flatShading = true;
    const body = cfg.ballShape === 'dice'
      ? new THREE.Mesh(ballGeometry('dice', R), diceFaces(cfg, mat))
      : new THREE.Mesh(ballGeometry(cfg.ballShape, R), mat);
    this.ball.add(body);
    if (cfg.ballShape === 'sphere' || cfg.ballShape === 'egg') {
      const band = new THREE.Mesh(
        new THREE.TorusGeometry(R * 1.002, R * 0.1, 10, 48),
        new THREE.MeshStandardMaterial({ color: cfg.stripeColor, roughness: 0.4, metalness: 0.2, emissive: cfg.stripeColor, emissiveIntensity: 0.25 }),
      );
      this.ball.add(band);
    }
    this.active.clear();
  }

  private ballMaterial(cfg: MarbleConfig): THREE.Material {
    switch (cfg.ballStyle) {
      case 'gold':
        return new THREE.MeshStandardMaterial({ color: cfg.ballColor, metalness: 1, roughness: 0.2, envMap: this.envTex, envMapIntensity: 1.4 });
      case 'glass':
        return new THREE.MeshStandardMaterial({ color: cfg.ballColor, metalness: 0, roughness: 0.02, transparent: true, opacity: 0.45, envMap: this.envTex, envMapIntensity: 2 });
      case 'glow':
        return new THREE.MeshBasicMaterial({ color: cfg.ballColor, toneMapped: false });
      case 'plastic':
        return new THREE.MeshStandardMaterial({ color: cfg.ballColor, metalness: 0, roughness: 0.35, envMap: this.envTex, envMapIntensity: 0.6 });
      default:
        return new THREE.MeshStandardMaterial({ color: cfg.ballColor, metalness: 1, roughness: 0.32, envMap: this.envTex, envMapIntensity: 1 });
    }
  }

  /** Camera direction (unit vector from the ball towards the camera) and distance. */
  private view(cfg: MarbleConfig, t: number): { dir: THREE.Vector3; dist: number } {
    let az = cfg.cameraAngle, el = cfg.cameraElevation, dist = cfg.cameraDistance;
    if (cfg.cameraMode === 'top') el = Math.max(el, 62);
    else if (cfg.cameraMode === 'orbit') az += t * 14;
    else if (cfg.cameraMode === 'close') {
      dist *= 0.62;
      el = Math.min(el, 6);
    }
    az = (az * Math.PI) / 180;
    el = (el * Math.PI) / 180;
    return { dir: new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el)), dist };
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
    const { dir, dist } = this.view(cfg, t - course.start);
    this.camera.position.copy(target).addScaledVector(dir, dist);
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
    this.paintSparks(t, cfg);
    this.renderer.render(this.scene, this.camera);
  }

  /** Objects take their "played" colour once hit; a hit adds a short wobble (or squash) and a flash. */
  private paintBars(t: number, cfg: MarbleConfig): void {
    const flash = new THREE.Color(0xffffff);
    const tmp = new THREE.Color();
    const now = new Set<number>();
    const bars = this.barList;
    for (const { kind, mesh, extra, idx } of this.groups) {
      for (let j = 0; j < idx.length; j++) {
        const i = idx[j];
        const dt = t - bars[i].hitTime;
        if (dt < 0) {
          mesh.setColorAt(j, this.fresh[i]);
        } else if (dt < RING_TIME) {
          tmp.copy(this.fresh[i]).lerp(this.played[i], Math.min(1, dt / 0.12));
          if (cfg.flash) tmp.lerp(flash, 0.6 * Math.exp(-dt * 14));
          mesh.setColorAt(j, tmp);
        } else {
          mesh.setColorAt(j, this.played[i]);
        }
        let m: THREE.Matrix4 | null = null;
        if (dt >= 0 && dt < RING_TIME) {
          now.add(i);
          m = objectMatrix(kind, bars[i], 0.09 * Math.exp(-dt * 6) * Math.sin(dt * 55));
        } else if (this.active.has(i)) {
          m = this.base[i];
        }
        if (m) {
          mesh.setMatrixAt(j, m);
          extra?.setMatrixAt(j, m);
        }
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      if (extra) extra.instanceMatrix.needsUpdate = true;
    }
    this.active = now;
  }

  /** Up to 14 sparks per hit, flying out from the contact point for SPARK_LIFE seconds. */
  private paintSparks(t: number, cfg: MarbleConfig): void {
    let n = 0;
    const course = this.course!;
    if (cfg.sparks) {
      const bars = this.barList;
      // Bars are in hit order, so binary-search the first one hit in the last SPARK_LIFE seconds.
      let lo = 0, hi = bars.length;
      while (lo < hi) {
        const mid = (lo + hi) >> 1;
        if (bars[mid].hitTime < t - SPARK_LIFE) lo = mid + 1;
        else hi = mid;
      }
      for (let i = lo; i < bars.length && bars[i].hitTime <= t && n < SPARK_MAX; i++) {
        const dt = t - bars[i].hitTime;
        const p = ballAt(course, bars[i].hitTime);
        const nrm = bars[i].normal;
        const fade = 1 - dt / SPARK_LIFE;
        const c = this.fresh[i];
        for (let k = 0; k < 14 && n < SPARK_MAX; k++, n++) {
          const h1 = hash(i * 13.7 + k * 1.91), h2 = hash(i * 3.3 + k * 7.7), h3 = hash(i * 5.1 + k * 2.3);
          const sp = 0.8 + h3 * 1.6;
          const v = [nrm[0] * sp + (h1 - 0.5) * 1.8, nrm[1] * sp + (h2 - 0.5) * 1.8 + 0.6, nrm[2] * sp + (h3 - 0.5) * 1.8];
          this.sparkPos[n * 3] = p[0] + v[0] * dt;
          this.sparkPos[n * 3 + 1] = p[1] + v[1] * dt - 2.5 * dt * dt;
          this.sparkPos[n * 3 + 2] = p[2] + v[2] * dt;
          this.sparkCol[n * 3] = (0.5 + c.r * 0.5) * fade;
          this.sparkCol[n * 3 + 1] = (0.5 + c.g * 0.5) * fade;
          this.sparkCol[n * 3 + 2] = (0.5 + c.b * 0.5) * fade;
        }
      }
    }
    const g = this.sparks.geometry;
    g.setDrawRange(0, n);
    (g.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (g.attributes.color as THREE.BufferAttribute).needsUpdate = true;
  }

  dispose(): void {
    disposeDeep(this.scene);
    this.envTex.dispose();
    this.woodTex.dispose();
    this.dotsTex.dispose();
    this.renderer.dispose();
  }
}

/** Light wood grain (optional) with two dark pin holes; tinted per bar by the instance colour. */
function woodTexture(grain: boolean): THREE.Texture {
  const W = 192, H = 96;
  const c = new OffscreenCanvas(W, H);
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, W, H);
  // Soft mottling along the bar, like the grain in the original videos.
  let s = 12345;
  const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let i = 0; i < (grain ? 70 : 0); i++) {
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

/** Natural colours for objects that are not tinted like bars in "played" colour mode. */
const NATURAL: Partial<Record<StrikerKind, string>> = { bell: '#e2ad38', tube: '#c8ccd3', gong: '#c4892c', glass: '#d6ecff' };

/**
 * Unit geometry of each object in its local frame: the struck surface is at y = 0
 * facing +Y (the plate normal), the body extends to -Y, X is the upright long axis.
 */
function objectGeometry(kind: StrikerKind): THREE.BufferGeometry {
  switch (kind) {
    case 'bell': {
      const prof = [[0.001, 1], [0.12, 0.99], [0.2, 0.93], [0.24, 0.8], [0.26, 0.6], [0.3, 0.38], [0.38, 0.16], [0.44, 0.04], [0.45, 0]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      return new THREE.LatheGeometry(prof, 32).rotateZ(-Math.PI / 2).translate(-0.5, -0.45, 0);
    }
    case 'glass': {
      const prof = [[0.001, 0], [0.22, 0], [0.22, 0.02], [0.035, 0.05], [0.03, 0.42], [0.12, 0.47], [0.26, 0.6], [0.3, 0.78], [0.29, 0.95], [0.27, 1]]
        .map(([r, y]) => new THREE.Vector2(r, y));
      return new THREE.LatheGeometry(prof, 32).rotateZ(-Math.PI / 2).translate(-0.5, -0.3, 0);
    }
    case 'tube':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 18).rotateZ(-Math.PI / 2).translate(0, -0.5, 0);
    case 'drum':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 28).translate(0, -0.5, 0);
    case 'gong':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 36).translate(0, -0.5, 0);
    case 'pad':
      return new THREE.CylinderGeometry(0.47, 0.47, 1, 28).translate(0, -0.5, 0);
    default:
      return new THREE.BoxGeometry(1, 1, 1).translate(0, -0.5, 0);
  }
}

/** World size of an object along its local axes (x: upright, y: depth behind the struck face, z). */
function objectScale(kind: StrikerKind, b: Bar): THREE.Vector3 {
  const L = b.length;
  switch (kind) {
    case 'bell': return new THREE.Vector3(L * 0.95, L * 0.95, L * 0.95);
    case 'glass': return new THREE.Vector3(L * 1.05, L * 1.05, L * 1.05);
    case 'tube': return new THREE.Vector3(L * 1.6, 0.1, 0.1);
    case 'drum': return new THREE.Vector3(L * 0.85, L * 0.38, L * 0.85);
    case 'gong': return new THREE.Vector3(L * 1.2, 0.035, L * 1.2);
    case 'pad': return new THREE.Vector3(L * 0.85, 0.07, L * 0.85);
    default: return new THREE.Vector3(L, THICK, b.width);
  }
}

/** How far the object reaches behind its face, and half its upright size (for holders). */
function objectExtent(kind: StrikerKind, b: Bar): { depth: number; half: number } {
  const s = objectScale(kind, b);
  const depth = kind === 'bell' ? s.y * 0.9 : kind === 'glass' ? s.y * 0.6 : s.y;
  return { depth, half: s.x / 2 };
}

/**
 * Placement of an object. `wobble` (radians) twists bars and gongs, swings bells,
 * tubes and glasses, and squashes drums and pads.
 */
function objectMatrix(kind: StrikerKind, b: Bar, wobble: number): THREE.Matrix4 {
  const a = v3(b.axis), n = v3(b.normal);
  const surf = v3(b.center).addScaledVector(n, THICK / 2);
  const scale = objectScale(kind, b);
  if (wobble) {
    if (kind === 'bell' || kind === 'tube' || kind === 'glass') {
      const w = new THREE.Vector3().crossVectors(a, n).normalize();
      a.applyAxisAngle(w, wobble * 1.6);
      n.applyAxisAngle(w, wobble * 1.6);
    } else if (kind === 'drum' || kind === 'pad') {
      scale.y *= 1 - Math.abs(wobble) * (kind === 'pad' ? 5 : 2);
    } else {
      n.applyAxisAngle(a, wobble);
    }
  }
  const w = new THREE.Vector3().crossVectors(a, n);
  return new THREE.Matrix4().makeBasis(a, n, w).scale(scale).setPosition(surf);
}

/** Ball geometry of radius about R for each shape. */
function ballGeometry(shape: MarbleConfig['ballShape'], R: number): THREE.BufferGeometry {
  switch (shape) {
    case 'cube':
    case 'dice':
      return new THREE.BoxGeometry(R * 1.55, R * 1.55, R * 1.55);
    case 'gem':
      return new THREE.IcosahedronGeometry(R * 1.1, 0);
    case 'diamond':
      return new THREE.OctahedronGeometry(R * 1.25, 0);
    case 'capsule':
      return new THREE.CapsuleGeometry(R * 0.62, R * 0.9, 8, 24);
    case 'egg':
      return new THREE.SphereGeometry(R, 40, 28).scale(0.9, 1.22, 0.9);
    case 'star': {
      const sh = new THREE.Shape();
      for (let k = 0; k <= 10; k++) {
        const r = k % 2 === 0 ? R * 1.35 : R * 0.6;
        const ang = (k / 10) * Math.PI * 2 + Math.PI / 2;
        if (k === 0) sh.moveTo(Math.cos(ang) * r, Math.sin(ang) * r);
        else sh.lineTo(Math.cos(ang) * r, Math.sin(ang) * r);
      }
      return new THREE.ExtrudeGeometry(sh, { depth: R * 0.7, bevelEnabled: true, bevelSize: R * 0.12, bevelThickness: R * 0.12, bevelSegments: 2 })
        .translate(0, 0, -R * 0.35);
    }
    default:
      return new THREE.SphereGeometry(R, 48, 32);
  }
}

/** Six dice faces (1–6 pips) on the ball material's colour. */
function diceFaces(cfg: MarbleConfig, base: THREE.Material): THREE.Material[] {
  const pips: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]], 2: [[0.28, 0.28], [0.72, 0.72]], 3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.28, 0.28], [0.72, 0.28], [0.28, 0.72], [0.72, 0.72]],
    5: [[0.28, 0.28], [0.72, 0.28], [0.5, 0.5], [0.28, 0.72], [0.72, 0.72]],
    6: [[0.28, 0.25], [0.72, 0.25], [0.28, 0.5], [0.72, 0.5], [0.28, 0.75], [0.72, 0.75]],
  };
  base.dispose();
  return [1, 6, 2, 5, 3, 4].map((n) => {
    const c = new OffscreenCanvas(128, 128);
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = cfg.ballColor;
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = cfg.stripeColor;
    for (const [x, y] of pips[n]) {
      ctx.beginPath();
      ctx.arc(x * 128, y * 128, 12, 0, Math.PI * 2);
      ctx.fill();
    }
    const tex = new THREE.CanvasTexture(c as unknown as HTMLCanvasElement);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.userData.owned = true;
    return new THREE.MeshStandardMaterial({ map: tex, roughness: 0.35, metalness: 0.05 });
  });
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
    for (const x of Array.isArray(mat) ? mat : mat ? [mat] : []) {
      // Shared textures (wood grain, pin holes) stay; per-object ones (dice faces) go.
      const map = (x as THREE.MeshStandardMaterial).map;
      if (map?.userData.owned) map.dispose();
      x.dispose();
    }
  });
}

/** Title at the top and subtitle at the bottom, drawn over the 3D frame. */
export function drawMarbleText(ctx: Canvas2D, cfg: MarbleConfig, width: number, height: number): void {
  const k = width / 720;
  if (cfg.title.trim()) drawTitle(ctx, cfg.title.trim(), width / 2, height * 0.12, cfg.titleSize * k, cfg.textColor, width * 0.86);
  if (cfg.subtitle.trim()) drawTitle(ctx, cfg.subtitle.trim(), width / 2, height * 0.86, cfg.subtitleSize * k, cfg.textColor, width * 0.86);
}
