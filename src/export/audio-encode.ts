/** Encodes stereo PCM into AudioEncoder chunks (100 ms per AudioData, with back-pressure). */
export async function encodeAudio(
  config: AudioEncoderConfig,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  onChunk: (c: EncodedAudioChunk, m?: EncodedAudioChunkMetadata) => void,
): Promise<void> {
  let error: unknown = null;
  const enc = new AudioEncoder({ output: onChunk, error: (e) => (error = e) });
  enc.configure(config);
  const block = Math.round(sampleRate / 10);
  for (let off = 0; off < left.length; off += block) {
    const n = Math.min(block, left.length - off);
    const planar = new Float32Array(n * 2);
    planar.set(left.subarray(off, off + n), 0);
    planar.set(right.subarray(off, off + n), n);
    const data = new AudioData({
      format: 'f32-planar',
      sampleRate,
      numberOfFrames: n,
      numberOfChannels: 2,
      timestamp: Math.round((off / sampleRate) * 1_000_000),
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
