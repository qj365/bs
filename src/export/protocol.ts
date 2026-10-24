import type { Config } from '../config';
import type { SimEvent } from '../sim';

export type WorkerIn =
  | { type: 'start'; cfg: Config }
  | { type: 'audio'; left: Float32Array; right: Float32Array }
  | { type: 'no-audio' };

export type WorkerOut =
  | { type: 'codecs'; video: string; audio: string }
  | { type: 'progress'; frame: number; total: number; fps: number }
  | { type: 'status'; text: string }
  | { type: 'need-audio'; events: SimEvent[]; duration: number }
  | { type: 'done'; buffer: ArrayBuffer; frames: number; seconds: number; duration: number; video: string; audio: string }
  | { type: 'error'; message: string };
