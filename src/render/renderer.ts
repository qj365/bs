import type { Config } from '../config';
import {
  BALL_STRIDE, GEM_STRIDE, PARTICLE_STRIDE, POWERUP_STRIDE, RING_STRIDE, SEG_STRIDE, type Layout, type RenderData,
} from '../sim';
import { Hud, type HudState } from './hud';
import {
  CIRCLE_FS, CIRCLE_VS, QUAD_FS, QUAD_VS, RING_FS, RING_VS, SEGMENT_FS, SEGMENT_VS,
} from './shaders';
import { hexToRgb, isDark, wallColor, type AnyCanvas, type FrameRenderer } from './types';

interface Program {
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
}

/** A growable GPU buffer of per-instance data, re-filled every frame with bufferSubData. */
class InstanceBuffer {
  readonly buf: WebGLBuffer;
  private capacity = 0;

  constructor(private gl: WebGL2RenderingContext) {
    this.buf = gl.createBuffer()!;
  }

  upload(data: Float32Array): void {
    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    if (data.byteLength > this.capacity) {
      this.capacity = Math.max(data.byteLength, Math.ceil(this.capacity * 1.5), 4096);
      gl.bufferData(gl.ARRAY_BUFFER, this.capacity, gl.DYNAMIC_DRAW);
    }
    if (data.byteLength > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, data);
  }
}

const COLOR_MODES = { rainbow: 0, solid: 1, cycle: 2 } as const;
const KIND = { ball: 0, particle: 1, gem: 2, powerup: 3 } as const;

/**
 * WebGL2 renderer. Every kind of object is drawn with a single instanced draw
 * call that reads the simulation's output buffers directly (they are views into
 * WASM memory), so the per-frame cost barely grows with the number of balls.
 */
export class GpuRenderer implements FrameRenderer {
  readonly kind = 'gpu' as const;
  readonly gl: WebGL2RenderingContext;
  private circle: Program;
  private segment: Program;
  private ring: Program;
  private quad: Program;
  private quadVbo: WebGLBuffer;
  private vao: Record<'ball' | 'particle' | 'gem' | 'powerup' | 'trail' | 'paint' | 'wall' | 'line' | 'ring' | 'quad', WebGLVertexArrayObject>;
  private bufs: Record<'ball' | 'particle' | 'gem' | 'powerup' | 'trail' | 'paint' | 'wall' | 'line' | 'ring', InstanceBuffer>;
  private paintTex: WebGLTexture;
  private paintFbo: WebGLFramebuffer;
  private paintScratch = new Float32Array(0);
  private hud: Hud;
  private hudTex: WebGLTexture;
  private hudVersion = -1;

  constructor(readonly canvas: AnyCanvas, private layout: Layout) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
      powerPreference: 'high-performance',
      failIfMajorPerformanceCaveat: false,
    }) as WebGL2RenderingContext | null;
    if (!gl) throw new Error('Trình duyệt không hỗ trợ WebGL2.');
    this.gl = gl;

    this.circle = this.program(CIRCLE_VS, CIRCLE_FS, ['uWorld', 'uPx', 'uColorMode', 'uSolid', 'uKind', 'uExtent', 'uGlow', 'uOutline']);
    this.segment = this.program(SEGMENT_VS, SEGMENT_FS, ['uWorld', 'uPx', 'uColorMode', 'uSolid']);
    this.ring = this.program(RING_VS, RING_FS, ['uWorld', 'uPx', 'uGlow', 'uTime', 'uRainbow', 'uRingColor']);
    this.quad = this.program(QUAD_VS, QUAD_FS, ['uTex', 'uFlipY']);

    this.quadVbo = gl.createBuffer()!;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    const buf = () => new InstanceBuffer(gl);
    this.bufs = {
      ball: buf(), particle: buf(), gem: buf(), powerup: buf(), trail: buf(), paint: buf(), wall: buf(), line: buf(), ring: buf(),
    };
    const b = this.bufs;
    this.vao = {
      ball: this.instancedVao(b.ball, BALL_STRIDE, [4, 4]),
      particle: this.instancedVao(b.particle, PARTICLE_STRIDE, [4, 2]),
      gem: this.instancedVao(b.gem, GEM_STRIDE, [4, 2]),
      powerup: this.instancedVao(b.powerup, POWERUP_STRIDE, [4, 2]),
      trail: this.instancedVao(b.trail, SEG_STRIDE, [4, 4]),
      paint: this.instancedVao(b.paint, SEG_STRIDE, [4, 4]),
      wall: this.instancedVao(b.wall, SEG_STRIDE, [4, 4]),
      line: this.instancedVao(b.line, SEG_STRIDE, [4, 4]),
      ring: this.instancedVao(b.ring, RING_STRIDE, [4, 4, 4]),
      quad: gl.createVertexArray()!,
    };
    gl.bindVertexArray(this.vao.quad);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);

    this.paintTex = this.texture(canvas.width, canvas.height);
    this.paintFbo = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.paintTex, 0);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    this.hud = new Hud(canvas.width, canvas.height);
    this.hudTex = this.texture(canvas.width, canvas.height);

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private program(vs: string, fs: string, uniforms: string[]): Program {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('Shader: ' + gl.getShaderInfoLog(s));
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('Program: ' + gl.getProgramInfoLog(prog));
    const u: Program['u'] = {};
    for (const name of uniforms) u[name] = gl.getUniformLocation(prog, name);
    return { prog, u };
  }

  /** VAO with the unit quad at location 0 and per-instance attributes of the given sizes at 1, 2, … */
  private instancedVao(buf: InstanceBuffer, stride: number, sizes: number[]): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.buf);
    let offset = 0;
    sizes.forEach((size, i) => {
      gl.enableVertexAttribArray(i + 1);
      gl.vertexAttribPointer(i + 1, size, gl.FLOAT, false, stride * 4, offset * 4);
      gl.vertexAttribDivisor(i + 1, 1);
      offset += size;
    });
    gl.bindVertexArray(null);
    return vao;
  }

  private texture(w: number, h: number): WebGLTexture {
    const gl = this.gl;
    const tex = gl.createTexture()!;
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return tex;
  }

  resetPaint(): void {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintFbo);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  private setCommon(p: Program, cfg: Config): void {
    const gl = this.gl;
    const px = this.canvas.width / this.layout.W;
    gl.useProgram(p.prog);
    if (p.u.uWorld) gl.uniform2f(p.u.uWorld, this.layout.W, this.layout.H);
    if (p.u.uPx) gl.uniform1f(p.u.uPx, px);
    if (p.u.uColorMode) gl.uniform1i(p.u.uColorMode, COLOR_MODES[cfg.colorMode] ?? 0);
    if (p.u.uSolid) gl.uniform3f(p.u.uSolid, ...hexToRgb(cfg.ballColor));
  }

  private drawSegments(cfg: Config, vao: WebGLVertexArrayObject, buf: InstanceBuffer, data: Float32Array, count: number, solid?: [number, number, number]): void {
    if (count === 0) return;
    const gl = this.gl;
    buf.upload(data);
    this.setCommon(this.segment, cfg);
    if (solid) {
      gl.uniform1i(this.segment.u.uColorMode, 1);
      gl.uniform3f(this.segment.u.uSolid, ...solid);
    }
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  private drawCircles(cfg: Config, kind: number, vao: WebGLVertexArrayObject, buf: InstanceBuffer, data: Float32Array, count: number, extent: number, glow: boolean, outline: boolean): void {
    if (count === 0) return;
    const gl = this.gl;
    buf.upload(data);
    const p = this.circle;
    this.setCommon(p, cfg);
    gl.uniform1i(p.u.uKind, kind);
    gl.uniform1f(p.u.uExtent, extent);
    gl.uniform1f(p.u.uGlow, glow ? 1 : 0);
    gl.uniform1f(p.u.uOutline, outline ? 1 : 0);
    gl.bindVertexArray(vao);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, count);
  }

  paintOnly(cfg: Config, data: RenderData): void {
    if (!cfg.paintTrail || data.ballCount === 0) return;
    const gl = this.gl;
    const n = data.ballCount;
    if (this.paintScratch.length < n * SEG_STRIDE) this.paintScratch = new Float32Array(n * SEG_STRIDE * 2);
    const src = data.balls;
    const dst = this.paintScratch;
    for (let i = 0; i < n; i++) {
      const s = i * BALL_STRIDE, d = i * SEG_STRIDE;
      dst[d] = src[s + 4]; dst[d + 1] = src[s + 5]; // previous position
      dst[d + 2] = src[s]; dst[d + 3] = src[s + 1]; // current position
      dst[d + 4] = src[s + 2]; dst[d + 5] = src[s + 3]; // radius, hue
      dst[d + 6] = 1; dst[d + 7] = src[s + 6]; // alpha, bounces
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintFbo);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    this.drawSegments(cfg, this.vao.paint, this.bufs.paint, dst.subarray(0, n * SEG_STRIDE), n);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }

  render(cfg: Config, data: RenderData, hud: HudState): void {
    const gl = this.gl;
    const { width, height } = this.canvas;

    // 1. Persistent paint: stroke each ball from where it was last frame to where it is now.
    this.paintOnly(cfg, data);

    gl.viewport(0, 0, width, height);
    const [br, bg, bb] = hexToRgb(cfg.bgColor);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // The paint texture was rendered with clip-space y up, so it samples without flipping.
    if (cfg.paintTrail) this.drawTexture(this.paintTex, false);

    // 2. Impact lines, then motion trails. On dark backgrounds MAX blending stops
    //    overlapping trail segments from stacking up into visible beads.
    this.drawSegments(cfg, this.vao.line, this.bufs.line, data.lines, data.lineCount);
    if (data.trailCount > 0) {
      if (isDark(cfg.bgColor)) gl.blendEquation(gl.MAX);
      this.drawSegments(cfg, this.vao.trail, this.bufs.trail, data.trails, data.trailCount);
      gl.blendEquation(gl.FUNC_ADD);
    }

    // 3. Arena: spiral walls and rings.
    this.drawSegments(cfg, this.vao.wall, this.bufs.wall, data.walls, data.wallCount, wallColor(cfg, hud.time));
    if (data.ringCount > 0) {
      this.bufs.ring.upload(data.rings);
      const p = this.ring;
      this.setCommon(p, cfg);
      gl.uniform1f(p.u.uGlow, cfg.glow ? 1 : 0);
      gl.uniform1f(p.u.uTime, hud.time);
      gl.uniform1i(p.u.uRainbow, cfg.ringRainbow ? 1 : 0);
      gl.uniform3f(p.u.uRingColor, ...hexToRgb(cfg.ringColor));
      gl.bindVertexArray(this.vao.ring);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.ringCount);
    }

    // 4. Gems, power-ups, particles, balls.
    this.drawCircles(cfg, KIND.gem, this.vao.gem, this.bufs.gem, data.gems, data.gemCount, 1.25, cfg.glow, false);
    this.drawCircles(cfg, KIND.powerup, this.vao.powerup, this.bufs.powerup, data.powerups, data.powerupCount, 1.3, false, false);
    if (cfg.particles) {
      this.drawCircles(cfg, KIND.particle, this.vao.particle, this.bufs.particle, data.particles, data.particleCount, 1.2, false, false);
    }
    this.drawCircles(cfg, KIND.ball, this.vao.ball, this.bufs.ball, data.balls, data.ballCount, cfg.glow ? 2.2 : 1.1, cfg.glow, cfg.ballOutline);

    // 5. Text overlay — re-uploaded only when its content changed.
    this.hud.update(cfg, this.layout, hud);
    if (!this.hud.empty) {
      if (this.hud.version !== this.hudVersion) {
        this.hudVersion = this.hud.version;
        gl.bindTexture(gl.TEXTURE_2D, this.hudTex);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, this.hud.canvas);
        gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      }
      this.drawTexture(this.hudTex, true);
    }
    gl.bindVertexArray(null);
  }

  private drawTexture(tex: WebGLTexture, flipY: boolean): void {
    const gl = this.gl;
    gl.useProgram(this.quad.prog);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(this.quad.u.uTex, 0);
    gl.uniform1i(this.quad.u.uFlipY, flipY ? 1 : 0);
    gl.bindVertexArray(this.vao.quad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
