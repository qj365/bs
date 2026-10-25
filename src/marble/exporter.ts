import { buildCourse, type MarbleNote } from './choreo';
import { courseOptions, type MarbleConfig } from './config';
import { renderMarbleAudio } from './audio';
import type { MarbleWorkerIn, MarbleWorkerOut } from './export.worker';

export interface MarbleExportResult {
  blob: Blob;
  frames: number;
  seconds: number;
  duration: number;
  video: string;
  audio: string;
}

export interface MarbleExportJob {
  promise: Promise<MarbleExportResult>;
  cancel(): void;
}

/** Full video length: from the course start to the end of the tail. */
export function marbleDuration(cfg: MarbleConfig, notes: MarbleNote[]): number {
  const c = buildCourse(notes, courseOptions(cfg));
  return Math.max(0, c.end - c.start);
}

/**
 * Exports the marble video. The soundtrack is rendered here (OfflineAudioContext
 * only exists on the main thread); the worker draws with Three.js on an
 * OffscreenCanvas and encodes with WebCodecs.
 */
export function startMarbleExport(
  cfg: MarbleConfig, notes: MarbleNote[], range: { start: number; end: number },
  onProgress: (frame: number, total: number, fps: number, status: string) => void,
): MarbleExportJob {
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  let rejectFn: (e: Error) => void = () => {};
  const promise = new Promise<MarbleExportResult>((resolve, reject) => {
    rejectFn = reject;
    let codecs = '';
    worker.onmessage = (ev: MessageEvent<MarbleWorkerOut>) => {
      const m = ev.data;
      if (m.type === 'codecs') {
        codecs = `${m.video} + ${m.audio}`;
        onProgress(0, 1, 0, `Bộ mã hóa: ${codecs}`);
      } else if (m.type === 'progress') {
        onProgress(m.frame, m.total, m.fps, `Đang render 3D · ${codecs}`);
      } else if (m.type === 'done') {
        worker.terminate();
        resolve({ blob: new Blob([m.buffer], { type: 'video/mp4' }), frames: m.frames, seconds: m.seconds, duration: m.duration, video: m.video, audio: m.audio });
      } else {
        worker.terminate();
        reject(new Error(m.message));
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker lỗi'));
    };
    (async () => {
      let audio: MarbleWorkerIn['audio'] = null;
      if (cfg.sound) {
        onProgress(0, 1, 0, 'Đang dựng âm thanh…');
        try {
          const course = buildCourse(notes, courseOptions(cfg));
          const buf = await renderMarbleAudio(cfg, course, range.start, range.end - range.start);
          audio = { left: buf.getChannelData(0).slice(), right: buf.getChannelData(1).slice(), sampleRate: buf.sampleRate };
        } catch (err) {
          console.error(err);
        }
      }
      const msg: MarbleWorkerIn = { type: 'start', cfg, notes, start: range.start, end: range.end, audio };
      worker.postMessage(msg, audio ? [audio.left.buffer, audio.right.buffer] : []);
    })().catch(reject);
  });
  return {
    promise,
    cancel() {
      worker.terminate();
      rejectFn(new Error('Đã hủy'));
    },
  };
}
