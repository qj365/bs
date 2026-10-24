import type { Backend } from '../config';

export type MuxVideoCodec = 'avc' | 'hevc' | 'vp9' | 'av1';
export type MuxAudioCodec = 'aac' | 'opus';

const VIDEO_CANDIDATES: { mux: MuxVideoCodec; codec: string; label: string }[] = [
  { mux: 'avc', codec: 'avc1.640034', label: 'H.264 High' },
  { mux: 'avc', codec: 'avc1.4d0034', label: 'H.264 Main' },
  { mux: 'avc', codec: 'avc1.42003e', label: 'H.264 Baseline' },
  { mux: 'vp9', codec: 'vp09.00.51.08', label: 'VP9' },
  { mux: 'av1', codec: 'av01.0.12M.08', label: 'AV1' },
];

const AUDIO_CANDIDATES: { mux: MuxAudioCodec; codec: string; label: string }[] = [
  { mux: 'aac', codec: 'mp4a.40.2', label: 'AAC' },
  { mux: 'opus', codec: 'opus', label: 'Opus' },
];

export interface VideoChoice {
  mux: MuxVideoCodec;
  label: string;
  config: VideoEncoderConfig;
}

export interface AudioChoice {
  mux: MuxAudioCodec;
  label: string;
  config: AudioEncoderConfig;
}

const ACCEL: Record<Backend, HardwareAcceleration[]> = {
  auto: ['prefer-hardware', 'no-preference'],
  gpu: ['prefer-hardware'],
  cpu: ['prefer-software'],
};

const ACCEL_LABEL: Record<HardwareAcceleration, string> = {
  'prefer-hardware': ' (GPU)',
  'prefer-software': ' (CPU)',
  'no-preference': '',
};

/**
 * Picks the best supported video encoder. "auto" prefers hardware encoders
 * (NVENC / QuickSync / AMF) and falls back to whatever the browser has;
 * "cpu" forces the software encoder (slower, often better quality per bitrate).
 */
export async function pickVideoCodec(width: number, height: number, fps: number, bitrate: number, backend: Backend = 'auto'): Promise<VideoChoice | null> {
  if (typeof VideoEncoder === 'undefined') return null;
  for (const accel of ACCEL[backend] ?? ACCEL.auto) {
    for (const c of VIDEO_CANDIDATES) {
      const config: VideoEncoderConfig = {
        codec: c.codec,
        width,
        height,
        bitrate,
        framerate: fps,
        hardwareAcceleration: accel,
        latencyMode: 'quality',
        ...(c.mux === 'avc' ? { avc: { format: 'avc' } } : {}),
      };
      try {
        const res = await VideoEncoder.isConfigSupported(config);
        if (res.supported) {
          return { mux: c.mux, label: c.label + ACCEL_LABEL[accel], config };
        }
      } catch {
        // Unknown codec string in this browser — try the next one.
      }
    }
  }
  return null;
}

export async function pickAudioCodec(sampleRate: number): Promise<AudioChoice | null> {
  if (typeof AudioEncoder === 'undefined') return null;
  for (const c of AUDIO_CANDIDATES) {
    const config: AudioEncoderConfig = { codec: c.codec, sampleRate, numberOfChannels: 2, bitrate: 192_000 };
    try {
      const res = await AudioEncoder.isConfigSupported(config);
      if (res.supported) return { mux: c.mux, label: c.label, config };
    } catch {
      // Try the next codec.
    }
  }
  return null;
}
