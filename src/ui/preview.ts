import { cloneConfig, parseResolution, type Config } from '../config';
import { LiveAudio } from '../audio/synth';
import { createRenderer, type FrameRenderer } from '../render';
import { counterValue, endMessage, Simulation, type Stats } from '../sim';

export interface PreviewTick {
  time: number;
  end: number;
  stats: Stats;
  fps: number;
  playing: boolean;
  renderer: 'gpu' | 'cpu';
}

const SEEK_STEP = 1 / 60;

/** Owns the live preview: simulation, renderer, real-time audio, play/pause and seeking. */
export class Preview {
  private sim: Simulation | null = null;
  private renderer: FrameRenderer | null = null;
  private rendererKey = '';
  private simTime = 0;
  private playing = true;
  private lastTs = 0;
  private token = 0;
  private audio: LiveAudio | null = null;
  private fpsFrames = 0;
  private fpsLast = 0;
  private fps = 0;
  private started = false;

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
    return this.simTime;
  }

  get rendererKind(): 'gpu' | 'cpu' | null {
    return this.renderer?.kind ?? null;
  }

  /** When playback stops: the configured duration, or shortly after the run finishes. */
  endTime(): number {
    const cfg = this.getCfg();
    const st = this.sim?.stats();
    if (cfg.stopOnFinish && st?.finished) return Math.min(cfg.duration, st.finishTime + cfg.endHold);
    return cfg.duration;
  }

  async restart(): Promise<void> {
    const token = ++this.token;
    const cfg = cloneConfig(this.getCfg());
    if (this.sim) this.sim.reset(cfg);
    else this.sim = await Simulation.create(cfg);
    if (token !== this.token) return;

    const { width, height } = parseResolution(cfg.resolution);
    const pw = Math.max(2, Math.round((width * cfg.previewScale) / 2) * 2);
    const ph = Math.max(2, Math.round((height * cfg.previewScale) / 2) * 2);
    const key = `${pw}x${ph}:${cfg.renderer}:${cfg.resolution}:${cfg.safeZone}`;
    if (key !== this.rendererKey || !this.renderer) {
      // A fresh canvas per renderer keeps GPU resources from leaking across contexts,
      // and a canvas that refused WebGL can't be reused for 2D.
      this.renderer?.dispose();
      this.box.querySelectorAll('canvas').forEach((c) => c.remove());
      const make = () => {
        this.box.querySelectorAll('canvas').forEach((c) => c.remove());
        const canvas = document.createElement('canvas');
        canvas.width = pw;
        canvas.height = ph;
        canvas.style.aspectRatio = `${width} / ${height}`;
        this.box.prepend(canvas);
        return canvas;
      };
      try {
        this.renderer = createRenderer(cfg.renderer, make, this.sim.layout);
      } catch (err) {
        this.onError(`Không tạo được bộ vẽ ${cfg.renderer.toUpperCase()}: ${err instanceof Error ? err.message : err}. Chuyển sang CPU.`);
        this.renderer = createRenderer('cpu', make, this.sim.layout);
      }
      this.rendererKey = key;
    } else {
      this.renderer.resetPaint();
    }
    this.simTime = 0;
    await this.audio?.reset(cfg);
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
  }

  setPlaying(p: boolean): void {
    this.playing = p;
  }

  async togglePlay(): Promise<void> {
    await this.ensureAudio();
    if (!this.playing && this.simTime >= this.endTime() - 1e-3) await this.restart();
    this.playing = !this.playing;
  }

  /**
   * Jumps to time t. The simulation only runs forward, so going back replays from
   * zero — cheap, since physics runs ~100× faster than real time. Frames in between
   * still feed the paint layer and the melody so the result matches playback.
   */
  async seek(t: number): Promise<void> {
    if (!this.sim || !this.renderer) return;
    const cfg = this.getCfg();
    t = Math.max(0, Math.min(t, cfg.duration));
    if (t < this.simTime) {
      this.sim.reset(cloneConfig(cfg));
      this.renderer.resetPaint();
      this.simTime = 0;
      await this.audio?.reset(cfg);
    }
    while (this.simTime + SEEK_STEP <= t) {
      this.simTime += SEEK_STEP;
      this.sim.advanceTo(this.simTime);
      this.audio?.skip(this.sim.drainEvents());
      if (cfg.paintTrail) this.renderer.paintOnly(cfg, this.sim.renderData(0));
    }
    this.simTime = t;
    this.sim.advanceTo(t);
    this.audio?.skip(this.sim.drainEvents());
  }

  private frame(ts: number): void {
    requestAnimationFrame((t) => this.frame(t));
    const sim = this.sim;
    const renderer = this.renderer;
    if (!sim || !renderer) return;
    const cfg = this.getCfg();
    const dt = Math.min((ts - (this.lastTs || ts)) / 1000, 0.1);
    this.lastTs = ts;
    if (this.playing) {
      this.simTime += dt;
      const end = this.endTime();
      if (this.simTime >= end) {
        this.simTime = end;
        this.playing = false;
      }
    }
    sim.advanceTo(this.simTime);
    const events = sim.drainEvents();
    if (this.playing) this.audio?.play(events, this.simTime);
    else this.audio?.skip(events);
    const st = sim.stats();
    const data = sim.renderData(cfg.trailLength);
    renderer.render(cfg, data, {
      counter: counterValue(cfg, st),
      time: this.simTime,
      end: endMessage(cfg, st),
      powerups: data.powerups,
      powerupCount: data.powerupCount,
    });

    this.fpsFrames++;
    if (ts - this.fpsLast > 500) {
      this.fps = (this.fpsFrames * 1000) / (ts - this.fpsLast);
      this.fpsFrames = 0;
      this.fpsLast = ts;
    }
    this.onTick({ time: this.simTime, end: this.endTime(), stats: st, fps: this.fps, playing: this.playing, renderer: renderer.kind });
  }
}
