import type { Config } from '../config';
import { BALL_STRIDE, PARTICLE_STRIDE, RING_STRIDE, TRAIL_STRIDE, type Layout, type RenderData } from '../sim';
import { Hud, type HudState } from './hud';
import {
  CIRCLE_FS, CIRCLE_VS, QUAD_FS, QUAD_VS, RING_FS, RING_VS, SEGMENT_FS, SEGMENT_VS,
} from './shaders';

type AnyCanvas = HTMLCanvasElement | OffscreenCanvas;

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

function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const n = m ? parseInt(m[1], 16) : 0xffffff;
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const COLOR_MODES = { rainbow: 0, solid: 1, cycle: 2 } as const;

/**
 * WebGL2 renderer. Every kind of object is drawn with a single instanced draw
 * call that reads the simulation's output buffers directly (they are views into
 * WASM memory), so the per-frame cost barely grows with the number of balls.
 */
export class Renderer {
  readonly gl: WebGL2RenderingContext;
  private circle: Program;
  private segment: Program;
  private ring: Program;
  private quad: Program;
  private quadVbo: WebGLBuffer;
  private vaoCircle: WebGLVertexArrayObject;
  private vaoParticle: WebGLVertexArrayObject;
  private vaoSegment: WebGLVertexArrayObject;
  private vaoPaint: WebGLVertexArrayObject;
  private vaoRing: WebGLVertexArrayObject;
  private vaoQuad: WebGLVertexArrayObject;
  private ballBuf: InstanceBuffer;
  private particleBuf: InstanceBuffer;
  private trailBuf: InstanceBuffer;
  private paintBuf: InstanceBuffer;
  private ringBuf: InstanceBuffer;
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

    this.ballBuf = new InstanceBuffer(gl);
    this.particleBuf = new InstanceBuffer(gl);
    this.trailBuf = new InstanceBuffer(gl);
    this.paintBuf = new InstanceBuffer(gl);
    this.ringBuf = new InstanceBuffer(gl);

    this.vaoCircle = this.instancedVao(this.ballBuf, BALL_STRIDE, 4, 4);
    this.vaoParticle = this.instancedVao(this.particleBuf, PARTICLE_STRIDE, 4, 2);
    this.vaoSegment = this.instancedVao(this.trailBuf, TRAIL_STRIDE, 4, 4);
    this.vaoPaint = this.instancedVao(this.paintBuf, TRAIL_STRIDE, 4, 4);
    this.vaoRing = this.instancedVao(this.ringBuf, RING_STRIDE, 4, 4);
    this.vaoQuad = gl.createVertexArray()!;
    gl.bindVertexArray(this.vaoQuad);
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

  /** VAO with the unit quad at location 0 and two per-instance vec4-ish attributes at 1 and 2. */
  private instancedVao(buf: InstanceBuffer, stride: number, sizeA: number, sizeB: number): WebGLVertexArrayObject {
    const gl = this.gl;
    const vao = gl.createVertexArray()!;
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadVbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, buf.buf);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, sizeA, gl.FLOAT, false, stride * 4, 0);
    gl.vertexAttribDivisor(1, 1);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, sizeB, gl.FLOAT, false, stride * 4, sizeA * 4);
    gl.vertexAttribDivisor(2, 1);
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

  /** Clears the persistent paint layer (call when the simulation restarts). */
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

  render(cfg: Config, data: RenderData, hud: HudState): void {
    const gl = this.gl;
    const { width, height } = this.canvas;

    // 1. Persistent paint: stroke each ball from where it was last frame to where it is now.
    if (cfg.paintTrail && data.ballCount > 0) {
      const n = data.ballCount;
      if (this.paintScratch.length < n * TRAIL_STRIDE) this.paintScratch = new Float32Array(n * TRAIL_STRIDE * 2);
      const src = data.balls;
      const dst = this.paintScratch;
      for (let i = 0; i < n; i++) {
        const s = i * BALL_STRIDE, d = i * TRAIL_STRIDE;
        dst[d] = src[s + 4]; dst[d + 1] = src[s + 5]; // previous position
        dst[d + 2] = src[s]; dst[d + 3] = src[s + 1]; // current position
        dst[d + 4] = src[s + 2]; dst[d + 5] = src[s + 3]; // radius, hue
        dst[d + 6] = 1; dst[d + 7] = src[s + 6]; // alpha, bounces
      }
      this.paintBuf.upload(dst.subarray(0, n * TRAIL_STRIDE));
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.paintFbo);
      gl.viewport(0, 0, width, height);
      this.setCommon(this.segment, cfg);
      gl.bindVertexArray(this.vaoPaint);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, n);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    gl.viewport(0, 0, width, height);
    const [br, bg, bb] = hexToRgb(cfg.bgColor);
    gl.clearColor(br, bg, bb, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    // The paint texture was rendered with clip-space y up, so it samples without flipping.
    if (cfg.paintTrail) this.drawTexture(this.paintTex, false);

    // 2. Motion trails. On dark backgrounds MAX blending stops overlapping segments
    //    from stacking up into visible beads; on light ones it would hide them.
    if (data.trailCount > 0) {
      this.trailBuf.upload(data.trails);
      this.setCommon(this.segment, cfg);
      const dark = 0.2126 * br + 0.7152 * bg + 0.0722 * bb < 0.5;
      if (dark) gl.blendEquation(gl.MAX);
      gl.bindVertexArray(this.vaoSegment);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.trailCount);
      gl.blendEquation(gl.FUNC_ADD);
    }

    // 3. Rings.
    if (data.ringCount > 0) {
      this.ringBuf.upload(data.rings);
      const p = this.ring;
      this.setCommon(p, cfg);
      gl.uniform1f(p.u.uGlow, cfg.glow ? 1 : 0);
      gl.uniform1f(p.u.uTime, hud.time);
      gl.uniform1i(p.u.uRainbow, cfg.ringRainbow ? 1 : 0);
      gl.uniform3f(p.u.uRingColor, ...hexToRgb(cfg.ringColor));
      gl.bindVertexArray(this.vaoRing);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.ringCount);
    }

    // 4. Particles.
    if (cfg.particles && data.particleCount > 0) {
      this.particleBuf.upload(data.particles);
      const p = this.circle;
      this.setCommon(p, cfg);
      gl.uniform1i(p.u.uKind, 1);
      gl.uniform1f(p.u.uExtent, 1.2);
      gl.uniform1f(p.u.uGlow, 0);
      gl.uniform1f(p.u.uOutline, 0);
      gl.bindVertexArray(this.vaoParticle);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.particleCount);
    }

    // 5. Balls.
    if (data.ballCount > 0) {
      this.ballBuf.upload(data.balls);
      const p = this.circle;
      this.setCommon(p, cfg);
      gl.uniform1i(p.u.uKind, 0);
      gl.uniform1f(p.u.uExtent, cfg.glow ? 2.2 : 1.1);
      gl.uniform1f(p.u.uGlow, cfg.glow ? 1 : 0);
      gl.uniform1f(p.u.uOutline, cfg.ballOutline ? 1 : 0);
      gl.bindVertexArray(this.vaoCircle);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, data.ballCount);
    }

    // 6. Text overlay — re-uploaded only when its content changed.
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
    gl.bindVertexArray(this.vaoQuad);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  dispose(): void {
    this.gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}
