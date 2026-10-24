import { Midi } from '@tonejs/midi';

export interface MidiTrackInfo {
  name: string;
  notes: { time: number; midi: number }[];
}

export function parseMidi(data: ArrayBuffer): MidiTrackInfo[] {
  const midi = new Midi(data);
  return midi.tracks
    .filter((t) => t.notes.length > 0 && t.channel !== 9) // channel 10 is drums
    .map((t, i) => ({
      name: t.name || t.instrument.name || `Track ${i + 1}`,
      notes: t.notes.map((n) => ({ time: n.time, midi: n.midi })),
    }));
}

/** Groups notes that start together into chords (max 4 notes); each bounce plays one chord. */
export function toChords(tracks: MidiTrackInfo[]): number[][] {
  const notes = tracks.flatMap((t) => t.notes).sort((a, b) => a.time - b.time || b.midi - a.midi);
  const chords: number[][] = [];
  let lastTime = -1;
  for (const n of notes) {
    if (chords.length > 0 && n.time - lastTime < 0.03) {
      const ch = chords[chords.length - 1];
      if (ch.length < 4 && !ch.includes(n.midi)) ch.push(n.midi);
    } else {
      chords.push([n.midi]);
      lastTime = n.time;
    }
  }
  return chords;
}
