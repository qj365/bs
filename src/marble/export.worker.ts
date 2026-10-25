import { ArrayBufferTarget, Muxer } from 'mp4-muxer';
import { parseResolution } from '../config';
import { encodeAudio } from '../export/audio-encode';
import { pickAudioCodec, pickVideoCodec } from '../export/codecs';
import { buildCourse, type MarbleNote } from './choreo';
import { courseOptions, type MarbleConfig } from './config';
import { drawMarbleText, MarbleScene } from './scene3d';

export type MarbleWorkerIn = {
  type: 'start';
  cfg: MarbleConfig;
  notes: MarbleNote[];
  /** Clip range in video seconds (video 0 = course start). */
  start: number;
  end: number;
  audio: { left: Float32Array; right: Float32Array; sampleRate: number } | null;
};

export type MarbleWorkerOut =
  | { type: 'codecs'; video: string; audio: string }
  | { type: 'progress'; frame: number; total: number; fps: number }
  | { type: 'done'; buffer: ArrayBuffer; frames: number; seconds: number; duration: number; video: string; audio: string }
  | { type: 'error'; message: string };

interface WorkerScope {
  postMessage(msg: unknown, transfer: Transferable[]): void;
  onmessage: ((ev: MessageEvent<MarbleWorkerIn>) => void) | null;
}
const scope = self as unknown as WorkerScope;
const post = (msg: MarbleWorkerOut, transfer: Transferable[] = []) => scope.postMessage(msg, transfer);

scope.onmessage = (ev) => {
  run(ev.data).catch((err) => post({ type: 'error', message: err instanceof Error ? err.message : String(err) }));
};

async function run(msg: MarbleWorkerIn): Promise<void> {
  const { cfg } = msg;
  const { width, height } = parseResolution(cfg.resolution);
  const fps = cfg.fps;
  const video = await pickVideoCodec(width, height, fps, Math.round(cfg.bitrate * 1_000_000), cfg.encoder);
  if (!video) throw new Error('Trình duyệt không có bộ mã hóa video phù hợp (cần Chrome/Edge bản mới).');
  const audio = msg.audio ? await pickAudioCodec(msg.audio.sampleRate) : null;
  post({ type: 'codecs', video: video.label, audio: audio?.label ?? 'không' });

  const course = buildCourse(msg.notes, courseOptions(cfg));
  const gl = new OffscreenCanvas(width, height);
  const scene = new MarbleScene(gl, width, height);
  scene.setCourse(course, cfg);
  const out = new OffscreenCanvas(width, height);
  const ctx = out.getContext('2d')!;

  const target = new ArrayBufferTarget();
  const muxer = new Muxer({
    target,
    video: { codec: video.mux, width, height, frameRate: fps },
    audio: audio && msg.audio ? { codec: audio.mux, numberOfChannels: 2, sampleRate: msg.audio.sampleRate } : undefined,
    fastStart: 'in-memory',
    firstTimestampBehavior: 'offset',
  });
  let encodeError: unknown = null;
  const encoder = new VideoEncoder({ output: (c, m) => muxer.addVideoChunk(c, m), error: (e) => (encodeError = e) });
  encoder.configure(video.config);

  const total = Math.max(1, Math.round((msg.end - msg.start) * fps));
  const frameUs = 1_000_000 / fps;
  const t0 = performance.now();
  let useImageData = false;
  for (let i = 0; i < total; i++) {
    if (encodeError) throw encodeError;
    scene.render(course.start + msg.start + i / fps);
    ctx.drawImage(gl, 0, 0);
    drawMarbleText(ctx, cfg, width, height);
    const timestamp = Math.round(i * frameUs);
    let frame: VideoFrame;
    if (!useImageData) {
      try {
        frame = new VideoFrame(out, { timestamp, duration: Math.round(frameUs) });
      } catch {
        useImageData = true;
      }
    }
    if (useImageData) {
      const img = ctx.getImageData(0, 0, width, height);
      frame = new VideoFrame(img.data, { format: 'RGBX', codedWidth: width, codedHeight: height, timestamp, duration: Math.round(frameUs) });
    }
    encoder.encode(frame!, { keyFrame: i % (fps * 2) === 0 });
    frame!.close();
    while (encoder.encodeQueueSize > 6) await new Promise((r) => setTimeout(r, 1));
    if (i % 15 === 0) post({ type: 'progress', frame: i + 1, total, fps: (i + 1) / Math.max(1e-3, (performance.now() - t0) / 1000) });
  }
  await encoder.flush();
  encoder.close();
  if (encodeError) throw encodeError;
  scene.dispose();

  if (audio && msg.audio) {
    await encodeAudio(audio.config, msg.audio.sampleRate, msg.audio.left, msg.audio.right, (c, m) => muxer.addAudioChunk(c, m));
  }
  muxer.finalize();
  const buffer = target.buffer;
  post({
    type: 'done', buffer, frames: total, seconds: (performance.now() - t0) / 1000, duration: total / fps,
    video: video.label, audio: audio?.label ?? '',
  }, [buffer]);
}
