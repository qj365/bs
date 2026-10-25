import { cloneConfig, type Config } from '../config';
import { LiveAudio } from '../audio/synth';
import { Scene } from '../scene';
import type { Stats } from '../sim';
import { unwarpTime, warpTime, type Warp } from '../sync';

export interface PreviewTick {
  time: number;
  end: number;
  stats: Stats & { winner: number };
  fps: number;
  playing: boolean;
  renderer: 'gpu' | 'cpu';
}

const SEEK_STEP = 1 / 60;

/**
 * Owns the live preview: the scene (simulations + renderers), real-time audio,
 * background music, play/pause and seeking. Time on the timeline is *video* time;
 * the simulation runs at warp(videoTime) when the video is synced to music.
 */
export class Preview {
  private scene: Scene | null = null;
  private sceneKey = '';
  private videoTime = 0;
  private playing = true;
  private lastTs = 0;
  private token = 0;
  private audio: LiveAudio | null = null;
  private fpsFrames = 0;
  private fpsLast = 0;
  private fps = 0;
  private started = false;
  private warp: Warp | null = null;
  private maxTime = Infinity;
  private musicPlaying = false;

  constructor(
    private box: HTMLElement,
    private getCfg: () => Config,
    private onTick: (t: PreviewTick) => void,
    private onError: (msg: string) => void,
  ) {}

  get isPlaying(): boolean {
    return this.playing;
  }

  get time(): number {
    return this.videoTime;
  }

  get rendererKind(): 'gpu' | 'cpu' | null {
    return this.scene?.kind ?? null;
  }

  get currentScene(): Scene | null {
    return this.scene;
  }

  /** Beat-sync warp (video → sim time) and the music length that caps the video. */
  setTiming(warp: Warp | null, maxTime = Infinity): void {
    this.warp = warp && warp.length >= 4 ? warp : null;
    this.maxTime = maxTime;
  }

  /** When playback stops (video time): the duration cap, or shortly after the run finishes. */
  endTime(): number {
    const cfg = this.getCfg();
    const cap = Math.min(cfg.duration, this.maxTime);
    const st = this.scene?.stats();
    if (cfg.stopOnFinish && st?.finished) return Math.min(cap, unwarpTime(this.warp, st.finishTime) + cfg.endHold);
    return cap;
  }

  async restart(): Promise<void> {
    const token = ++this.token;
    const cfg = cloneConfig(this.getCfg());
    const key = `${cfg.previewScale}:${cfg.renderer}:${cfg.resolution}:${cfg.safeZone}:${cfg.battle}`;
    if (key !== this.sceneKey || !this.scene) {
      const make = (w: number, h: number, visible: boolean) => {
        if (!visible) return new OffscreenCanvas(w, h);
        const canvas = document.createElement('canvas');
        canvas.width = w;
        canvas.height = h;
        canvas.style.aspectRatio = `${w} / ${h}`;
        return canvas;
      };
      let scene: Scene;
      try {
        scene = await Scene.create(cfg, cfg.renderer, make, { scale: cfg.previewScale });
      } catch (err) {
        this.onError(`Không tạo được bộ vẽ ${cfg.renderer.toUpperCase()}: ${err instanceof Error ? err.message : err}. Chuyển sang CPU.`);
        scene = await Scene.create(cfg, 'cpu', make, { scale: cfg.previewScale });
      }
      if (token !== this.token) {
        scene.dispose();
        return;
      }
      // A fresh canvas per scene keeps GPU resources from leaking across contexts.
      this.scene?.dispose();
      this.box.querySelectorAll('canvas').forEach((c) => c.remove());
      this.box.prepend(scene.output as HTMLCanvasElement);
      this.scene = scene;
      this.sceneKey = key;
    } else {
      this.scene.reset(cfg);
    }
    this.videoTime = 0;
    await this.audio?.reset(cfg);
    if (this.playing) void this.syncMusic();
    if (!this.started) {
      this.started = true;
      requestAnimationFrame((ts) => this.frame(ts));
    }
  }

  async ensureAudio(): Promise<void> {
    if (!this.audio) {
      this.audio = new LiveAudio();
      await this.audio.reset(this.getCfg());
    }
    if (this.audio.ctx.state !== 'running') await this.audio.ctx.resume();
  }

  /** Rebuilds the audio chain after a sound setting changed. */
  async resetAudio(): Promise<void> {
    await this.audio?.reset(this.getCfg());
    void this.syncMusic();
  }

  private async syncMusic(): Promise<void> {
    if (!this.audio) return;
    if (this.playing) {
      this.musicPlaying = true;
      await this.audio.startMusic(this.videoTime, this.getCfg().musicVolume);
    } else if (this.musicPlaying) {
      this.musicPlaying = false;
      this.audio.stopMusic();
    }
  }

  setPlaying(p: boolean): void {
    this.playing = p;
    void this.syncMusic();
  }

  async togglePlay(): Promise<void> {
    await this.ensureAudio();
    if (!this.playing && this.videoTime >= this.endTime() - 1e-3) await this.restart();
    this.setPlaying(!this.playing);
  }

  /**
   * Jumps to video time v. Simulations only run forward, so going back replays from
   * zero — cheap, since physics runs ~100× faster than real time. Frames in between
   * still feed the paint layer and the melody so the result matches playback.
   */
  async seek(v: number): Promise<void> {
    const scene = this.scene;
    if (!scene) return;
    const cfg = this.getCfg();
    v = Math.max(0, Math.min(v, Math.min(cfg.duration, this.maxTime)));
    if (v < this.videoTime) {
      scene.reset(cloneConfig(cfg));
      this.videoTime = 0;
      await this.audio?.reset(cfg);
    }
    while (this.videoTime + SEEK_STEP <= v) {
      this.videoTime += SEEK_STEP;
      scene.advanceTo(warpTime(this.warp, this.videoTime));
      this.audio?.skip(scene.drainEvents());
      scene.paintOnly(cfg);
    }
    this.videoTime = v;
    scene.advanceTo(warpTime(this.warp, v));
    this.audio?.skip(scene.drainEvents());
    if (this.playing) void this.syncMusic();
  }

  private frame(ts: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const scene = this.scene;
    if (!scene) return;
    const cfg = this.getCfg();
    const dt = Math.min((ts - (this.lastTs || ts)) / 1000, 0.1);
    this.lastTs = ts;
    if (this.playing) {
      this.videoTime += dt;
      const end = this.endTime();
      if (this.videoTime >= end) {
        this.videoTime = end;
        this.setPlaying(false);
      }
    }
    scene.advanceTo(warpTime(this.warp, this.videoTime));
    const events = scene.drainEvents();
    if (this.playing) this.audio?.play(events, this.videoTime, (s) => unwarpTime(this.warp, s));
    else this.audio?.skip(events);
    scene.render(cfg, this.videoTime);

    this.fpsFrames++;
    if (ts - this.fpsLast > 500) {
      this.fps = (this.fpsFrames * 1000) / (ts - this.fpsLast);
      this.fpsFrames = 0;
      this.fpsLast = ts;
    }
    this.onTick({ time: this.videoTime, end: this.endTime(), stats: scene.stats(), fps: this.fps, playing: this.playing, renderer: scene.kind });
  }
}
