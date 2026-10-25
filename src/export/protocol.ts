import type { Config } from '../config';
import type { SimEvent } from '../sim';

/** What part of the run to export and with which extras. Times are in seconds. */
export interface ExportPlan {
  /** Video time where the clip starts (Part 2, loops). */
  start?: number;
  /** Video time where the clip ends; overrides duration and stop-on-finish. */
  end?: number;
  /** Beat-sync warp, video → sim time anchors. */
  warp?: number[];
  /** Caption shown from `from` (to `to`) seconds of the output clip. */
  overlay?: { text: string; from: number; to?: number };
  /** Seconds at the end that fade into the first frame, for seamless loops. */
  crossfade?: number;
  /** Output time of the PNG cover image; omit for none. */
  coverAt?: number;
  /** Background music is loaded (decides whether a sound-less video gets an audio track). */
  music?: boolean;
}

export type WorkerIn =
  | { type: 'start'; cfg: Config; plan: ExportPlan }
  | { type: 'audio'; left: Float32Array; right: Float32Array }
  | { type: 'no-audio' };

export type WorkerOut =
  | { type: 'codecs'; video: string; audio: string; renderer: 'gpu' | 'cpu' }
  | { type: 'progress'; frame: number; total: number; fps: number }
  | { type: 'status'; text: string }
  | { type: 'need-audio'; events: SimEvent[]; duration: number; musicOffset: number }
  | {
    type: 'done'; buffer: ArrayBuffer; frames: number; seconds: number; duration: number; video: string; audio: string;
    cover?: ArrayBuffer; finishTime: number;
  }
  | { type: 'error'; message: string };
