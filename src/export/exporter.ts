import type { Config } from '../config';
import { renderSoundtrack } from '../audio/synth';
import type { WorkerIn, WorkerOut } from './protocol';

export interface ExportProgress {
  frame: number;
  total: number;
  fps: number;
  status: string;
}

export interface ExportResult {
  blob: Blob;
  frames: number;
  seconds: number;
  duration: number;
  video: string;
  audio: string;
}

export interface ExportJob {
  promise: Promise<ExportResult>;
  cancel(): void;
}

/**
 * Renders and encodes a video in a dedicated worker so the page stays responsive.
 * The soundtrack is rendered here (OfflineAudioContext is not available in workers)
 * and handed back to the worker for encoding.
 */
export function startExport(cfg: Config, onProgress: (p: ExportProgress) => void): ExportJob {
  const worker = new Worker(new URL('./export.worker.ts', import.meta.url), { type: 'module' });
  let rejectFn: (e: Error) => void = () => {};
  const promise = new Promise<ExportResult>((resolve, reject) => {
    rejectFn = reject;
    let codecs = '';
    const send = (msg: WorkerIn, transfer: Transferable[] = []) => worker.postMessage(msg, transfer);
    worker.onmessage = async (ev: MessageEvent<WorkerOut>) => {
      const m = ev.data;
      switch (m.type) {
        case 'codecs':
          codecs = `vẽ ${m.renderer.toUpperCase()} · ${m.video} + ${m.audio}`;
          onProgress({ frame: 0, total: 1, fps: 0, status: `Bộ mã hóa: ${codecs}` });
          break;
        case 'progress':
          onProgress({ frame: m.frame, total: m.total, fps: m.fps, status: `Đang render · ${codecs}` });
          break;
        case 'status':
          onProgress({ frame: 1, total: 1, fps: 0, status: m.text });
          break;
        case 'need-audio':
          try {
            onProgress({ frame: 1, total: 1, fps: 0, status: 'Đang dựng âm thanh…' });
            const buf = await renderSoundtrack(cfg, m.events, m.duration);
            const left = buf.getChannelData(0).slice();
            const right = buf.getChannelData(1).slice();
            send({ type: 'audio', left, right }, [left.buffer, right.buffer]);
          } catch (err) {
            console.error(err);
            send({ type: 'no-audio' });
          }
          break;
        case 'done':
          worker.terminate();
          resolve({
            blob: new Blob([m.buffer], { type: 'video/mp4' }),
            frames: m.frames,
            seconds: m.seconds,
            duration: m.duration,
            video: m.video,
            audio: m.audio,
          });
          break;
        case 'error':
          worker.terminate();
          reject(new Error(m.message));
          break;
      }
    };
    worker.onerror = (e) => {
      worker.terminate();
      reject(new Error(e.message || 'Worker lỗi'));
    };
    send({ type: 'start', cfg });
  });
  return {
    promise,
    cancel() {
      worker.terminate();
      rejectFn(new Error('Đã hủy'));
    },
  };
}
