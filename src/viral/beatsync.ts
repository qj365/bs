import { cloneConfig, type Config } from '../config';
import { detectBeats } from '../audio/beats';
import { battleCells } from '../scene';
import { Simulation } from '../sim';
import { buildBeatWarp, type BeatWarp } from '../sync';

export interface MusicAnalysis {
  duration: number;
  beats: number[];
  bpm: number;
}

/** Decodes a song and finds its beats. */
export async function analyzeMusic(data: ArrayBuffer): Promise<MusicAnalysis> {
  const ctx = new OfflineAudioContext(1, 1, 44100);
  const buffer = await ctx.decodeAudioData(data.slice(0));
  const channels = Array.from({ length: buffer.numberOfChannels }, (_, i) => buffer.getChannelData(i));
  const info = detectBeats(channels, buffer.sampleRate);
  return { duration: buffer.duration, beats: info.beats, bpm: info.bpm };
}

/**
 * Runs the (first arena's) simulation ahead of time, collects the moments that make
 * a sound, and builds a warp that moves them onto the song's beats.
 */
export async function computeBeatWarp(cfg: Config, music: MusicAnalysis, module?: WebAssembly.Module): Promise<BeatWarp | null> {
  if (music.beats.length < 4) return null;
  const c = cloneConfig(battleCells(cfg).cells[0].cfg);
  const sim = module ? await Simulation.fromModule(module, c) : await Simulation.create(c);
  const until = Math.min(cfg.duration, music.duration);
  // Times of the events that actually produce a note (same rule as SoundPlayer).
  const bounces: number[] = [];
  let last = -Infinity;
  for (let t = 0.25; t <= until * 2; t += 0.25) {
    sim.advanceTo(t);
    for (const e of sim.drainEvents()) {
      const musical = e.kind === 'bounce' || e.kind === 'merge' || e.kind === 'break' || e.kind === 'gem' || (e.kind === 'hit' && c.ballHitSound);
      if (musical && e.t - last >= c.minNoteGap) {
        bounces.push(e.t);
        last = e.t;
      }
    }
    if (sim.stats().finished && t > until) break;
  }
  return buildBeatWarp(bounces, music.beats, cfg.beatStride, until);
}
