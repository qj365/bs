import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import type { Config } from '../config';
import { createRenderer, type FrameRenderer } from '../render';
import { GpuRenderer } from '../render/renderer';
import { Simulation, counterValue, endMessage, type SimEvent } from '../sim';
import { pickAudioCodec, pickVideoCodec } from './codecs';
import type { WorkerIn, WorkerOut } from './protocol';

const SAMPLE_RATE = 48000;
interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent<WorkerIn>) => void) | null;
}
const ctx = self as unknown as WorkerScope;

function post(msg: WorkerOut, transfer: Transferable[] = []): void {
  ctx.postMessage(msg, transfer);
}

let audioResolve: ((m: WorkerIn) => void) | null = null;

ctx.onmessage = (ev: MessageEvent<WorkerIn>) => {
  const msg = ev.data;
  if (msg.type === 'start') {
    run(msg.cfg).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  } else if (audioResolve) {
    audioResolve(msg);
    audioResolve = null;
  }
};

async function run(cfg: Config): Promise<void> {
  const sim = await Simulation.create(cfg);
  const { width, height } = sim.layout;
  const fps = cfg.fps;
  const video = await pickVideoCodec(width, height, fps, Math.round(cfg.bitrate * 1_000_000), cfg.encoder);
  if (!video) {
    throw new Error(cfg.encoder === 'auto'
      ? 'Trình duyệt không có bộ mã hóa video phù hợp (cần Chrome/Edge bản mới).'
      : `Không có bộ mã hóa ${cfg.encoder.toUpperCase()} cho cấu hình này — thử chọn "Tự động".`);
  }
  const audio = cfg.sound ? await pickAudioCodec(SAMPLE_RATE) : null;
  const renderer = createRenderer(cfg.renderer, () => new OffscreenCanvas(width, height), sim.layout);
  post({ type: 'codecs', video: video.label, audio: audio?.label ?? 'không', renderer: renderer.kind });

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: video.mux, width, height, frameRate: fps },
    audio: audio ? { codec: audio.mux, numberOfChannels: 2, sampleRate: SAMPLE_RATE } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });

  let encodeError: unknown = null;
  const encoder = new VideoEncoder({
    output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
    error: (e) => (encodeError = e),
  });
  encoder.configure(video.config);


  captureMode = null;
  const events: SimEvent[] = [];
  const maxFrames = Math.max(1, Math.round(cfg.duration * fps));
  const frameUs = 1_000_000 / fps;
  const keyEvery = fps * 2;
  const t0 = performance.now();
  let frames = 0;

  for (let i = 0; i < maxFrames; i++) {
    if (encodeError) throw encodeError;
    const t = i / fps;
    sim.advanceTo(t);
    for (const e of sim.drainEvents()) events.push(e);
    const st = sim.stats();
    if (cfg.stopOnFinish && st.finished && t > st.finishTime + cfg.endHold) break;

    const data = sim.renderData(cfg.trailLength);
    renderer.render(cfg, data, {
      counter: counterValue(cfg, st), time: t, end: endMessage(cfg, st), powerups: data.powerups, powerupCount: data.powerupCount,
    });

    const frame = capture(renderer, Math.round(i * frameUs), Math.round(frameUs));
    encoder.encode(frame, { keyFrame: i % keyEvery === 0 });
    frame.close();
    frames = i + 1;

    // Back-pressure: never let the encoder queue grow unbounded (keeps memory flat).
    while (encoder.encodeQueueSize > 6) {
      await new Promise((r) => setTimeout(r, 1));
    }
    if (i % 15 === 0) {
      const elapsed = (performance.now() - t0) / 1000;
      post({ type: 'progress', frame: frames, total: maxFrames, fps: frames / Math.max(elapsed, 1e-3) });
    }
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  renderer.dispose();

  const duration = frames / fps;
  if (audio) {
    post({ type: 'need-audio', events, duration });
    const reply = await new Promise<WorkerIn>((r) => (audioResolve = r));
    if (reply.type === 'audio') {
      post({ type: 'status', text: 'Đang mã hóa âm thanh…' });
      await encodeAudio(audio.config, reply.left, reply.right, (chunk, meta) => muxer.addAudioChunk(chunk, meta));
    }
  }

  muxer.finalize();
  const buffer = target.buffer;
  const elapsed = (performance.now() - t0) / 1000;
  post({ type: 'done', buffer, frames, seconds: elapsed, duration, video: `${video.label} · vẽ ${renderer.kind.toUpperCase()}`, audio: audio?.label ?? '' }, [buffer]);
}

type CaptureMode = 'canvas' | 'bitmap' | 'pixels';
let captureMode: CaptureMode | null = null;
let pixels: Uint8Array | null = null;

/**
 * Grabs the rendered frame. The zero-copy paths (canvas / ImageBitmap) are used
 * when the GPU driver allows it; readPixels is the slower universal fallback.
 * The first method that works is remembered for the rest of the export.
 */
function capture(renderer: FrameRenderer, timestamp: number, duration: number): VideoFrame {
  const order: CaptureMode[] = captureMode ? [captureMode] : ['canvas', 'bitmap', 'pixels'];
  let lastErr: unknown = null;
  for (const mode of order) {
    try {
      const frame = captureWith(mode, renderer, timestamp, duration);
      captureMode = mode;
      return frame;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function captureWith(mode: CaptureMode, renderer: FrameRenderer, timestamp: number, duration: number): VideoFrame {
  const canvas = renderer.canvas as OffscreenCanvas;
  if (mode === 'canvas') return new VideoFrame(canvas, { timestamp, duration });
  if (mode === 'bitmap') {
    const bitmap = canvas.transferToImageBitmap();
    try {
      return new VideoFrame(bitmap, { timestamp, duration });
    } finally {
      bitmap.close();
    }
  }
  const { width, height } = canvas;
  if (renderer instanceof GpuRenderer) {
    const gl = renderer.gl;
    const rowBytes = width * 4;
    pixels ??= new Uint8Array(rowBytes * height);
    gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    // readPixels returns rows bottom-up; flip in place.
    const tmp = new Uint8Array(rowBytes);
    for (let top = 0, bottom = height - 1; top < bottom; top++, bottom--) {
      const a = top * rowBytes, b = bottom * rowBytes;
      tmp.set(pixels.subarray(a, a + rowBytes));
      pixels.copyWithin(a, b, b + rowBytes);
      pixels.set(tmp, b);
    }
    return new VideoFrame(pixels, { format: 'RGBX', codedWidth: width, codedHeight: height, timestamp, duration });
  }
  const img = (canvas.getContext('2d') as OffscreenCanvasRenderingContext2D).getImageData(0, 0, width, height);
  return new VideoFrame(img.data, { format: 'RGBX', codedWidth: width, codedHeight: height, timestamp, duration });
}

async function encodeAudio(
  config: AudioEncoderConfig,
  left: Float32Array,
  right: Float32Array,
  onChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void,
): Promise<void> {
  let error: unknown = null;
  const enc = new AudioEncoder({ output: onChunk, error: (e) => (error = e) });
  enc.configure(config);
  const block = 4800; // 100 ms per AudioData
  for (let off = 0; off < left.length; off += block) {
    const n = Math.min(block, left.length - off);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(off, off + n), 0);
    planar.set(right.subarray(off, off + n), n);
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate: SAMPLE_RATE,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((off / SAMPLE_RATE) * 1_000_000),
      data: planar,
    });
    enc.encode(data);
    data.close();
    while (enc.encodeQueueSize > 20) await new Promise((r) => setTimeout(r, 1));
    if (error) throw error;
  }
  await enc.flush();
  enc.close();
  if (error) throw error;
}
