import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { parseResolution, type Config } from '../config';
import { Scene } from '../scene';
import type { SimEvent } from '../sim';
import { unwarpTime, warpTime } from '../sync';
import { pickAudioCodec, pickVideoCodec } from './codecs';
import type { ExportPlan, WorkerIn, WorkerOut } from './protocol';

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
    run(msg.cfg, msg.plan ?? {}).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
  } else if (audioResolve) {
    audioResolve(msg);
    audioResolve = null;
  }
};

async function run(cfg: Config, plan: ExportPlan): Promise<void> {
  const { width, height } = parseResolution(cfg.resolution);
  const fps = cfg.fps;
  const video = await pickVideoCodec(width, height, fps, Math.round(cfg.bitrate * 1_000_000), cfg.encoder);
  if (!video) {
    throw new Error(cfg.encoder === 'auto'
      ? 'Trình duyệt không có bộ mã hóa video phù hợp (cần Chrome/Edge bản mới).'
      : `Không có bộ mã hóa ${cfg.encoder.toUpperCase()} cho cấu hình này — thử chọn "Tự động".`);
  }
  const audio = cfg.sound || (plan.music && cfg.musicVolume > 0) ? await pickAudioCodec(SAMPLE_RATE) : null;
  const crossfade = Math.max(0, plan.crossfade ?? 0);
  const scene = await Scene.create(cfg, cfg.renderer, (w, h) => new OffscreenCanvas(w, h), { composite: crossfade > 0 });
  post({ type: 'codecs', video: video.label, audio: audio?.label ?? 'không', renderer: scene.kind });

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
  const warp = plan.warp && plan.warp.length >= 4 ? plan.warp : null;
  const start = Math.max(0, plan.start ?? 0);
  const videoEnd = plan.end ?? cfg.duration;
  const maxFrames = Math.max(1, Math.round((videoEnd - start) * fps));
  const outDuration = maxFrames / fps;

  // Fast-forward to the clip start, still feeding the paint layer frame by frame.
  for (let v = 1 / 60; v <= start + 1e-9; v += 1 / 60) {
    scene.advanceTo(warpTime(warp, v));
    scene.drainEvents();
    scene.paintOnly(cfg);
  }

  const events: SimEvent[] = [];
  const frameUs = 1_000_000 / fps;
  const keyEvery = fps * 2;
  const t0 = performance.now();
  let frames = 0;
  let first: ImageBitmap | null = null;
  let cover: ArrayBuffer | undefined;
  const coverFrame = plan.coverAt === undefined ? -1 : Math.max(0, Math.min(maxFrames - 1, Math.round(plan.coverAt * fps)));

  for (let i = 0; i < maxFrames; i++) {
    if (encodeError) throw encodeError;
    const outT = i / fps;
    const vt = start + outT;
    scene.advanceTo(warpTime(warp, vt));
    for (const e of scene.drainEvents()) {
      e.t = unwarpTime(warp, e.t) - start;
      events.push(e);
    }
    const st = scene.stats();
    if (plan.end === undefined && cfg.stopOnFinish && st.finished && vt > unwarpTime(warp, st.finishTime) + cfg.endHold) break;

    const showOverlay = plan.overlay && outT >= plan.overlay.from && (plan.overlay.to === undefined || outT < plan.overlay.to);
    const fadeStart = outDuration - crossfade;
    scene.render(cfg, vt, {
      overlay: showOverlay ? plan.overlay!.text : undefined,
      fade: first && crossfade > 0 && outT > fadeStart ? { image: first, alpha: (outT - fadeStart) / crossfade } : undefined,
    });

    const frame = capture(scene, Math.round(i * frameUs), Math.round(frameUs));
    if (i === 0 && crossfade > 0) first = await createImageBitmap(frame);
    if (i === coverFrame) cover = await toPng(frame);
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
  first?.close();
  const st = scene.stats();
  const finishTime = st.finished ? unwarpTime(warp, st.finishTime) : -1;
  scene.dispose();

  const duration = frames / fps;
  if (audio) {
    post({ type: 'need-audio', events, duration, musicOffset: start });
    const reply = await new Promise<WorkerIn>((r) => (audioResolve = r));
    if (reply.type === 'audio') {
      post({ type: 'status', text: 'Đang mã hóa âm thanh…' });
      await encodeAudio(audio.config, reply.left, reply.right, (chunk, meta) => muxer.addAudioChunk(chunk, meta));
    }
  }

  muxer.finalize();
  const buffer = target.buffer;
  const elapsed = (performance.now() - t0) / 1000;
  const transfer: Transferable[] = [buffer];
  if (cover) transfer.push(cover);
  post({
    type: 'done', buffer, frames, seconds: elapsed, duration, cover, finishTime,
    video: `${video.label} · vẽ ${scene.kind.toUpperCase()}`, audio: audio?.label ?? '',
  }, transfer);
}

async function toPng(frame: VideoFrame): Promise<ArrayBuffer> {
  const c = new OffscreenCanvas(frame.displayWidth, frame.displayHeight);
  c.getContext('2d')!.drawImage(frame, 0, 0);
  return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
}

type CaptureMode = 'canvas' | 'bitmap' | 'pixels';
let captureMode: CaptureMode | null = null;
let pixels: Uint8Array | null = null;

/**
 * Grabs the rendered frame. The zero-copy paths (canvas / ImageBitmap) are used
 * when the GPU driver allows it; readPixels is the slower universal fallback.
 * The first method that works is remembered for the rest of the export.
 */
function capture(scene: Scene, timestamp: number, duration: number): VideoFrame {
  const order: CaptureMode[] = captureMode ? [captureMode] : ['canvas', 'bitmap', 'pixels'];
  let lastErr: unknown = null;
  for (const mode of order) {
    try {
      const frame = captureWith(mode, scene, timestamp, duration);
      captureMode = mode;
      return frame;
    } catch (err) {
      lastErr = err;
    }
  }
  throw lastErr;
}

function captureWith(mode: CaptureMode, scene: Scene, timestamp: number, duration: number): VideoFrame {
  const canvas = scene.output as OffscreenCanvas;
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
  const gl = scene.outputGl;
  if (gl) {
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
