/** Built-in public-domain melodies as MIDI note numbers; each bounce plays the next step. */
const ode = [64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 64, 62, 62,
  64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60,
  62, 62, 64, 60, 62, 64, 65, 64, 60, 62, 64, 65, 64, 62, 60, 62, 55,
  64, 64, 65, 67, 67, 65, 64, 62, 60, 60, 62, 64, 62, 60, 60];

const twinkle = [60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60,
  67, 67, 65, 65, 64, 64, 62, 67, 67, 65, 65, 64, 64, 62,
  60, 60, 67, 67, 69, 69, 67, 65, 65, 64, 64, 62, 62, 60];

const furElise = [76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 68, 71, 72,
  64, 76, 75, 76, 75, 76, 71, 74, 72, 69, 60, 64, 69, 71, 64, 72, 71, 69];

const canon = [78, 76, 74, 73, 71, 69, 71, 73, 74, 73, 71, 69, 67, 66, 67, 64,
  62, 66, 69, 67, 66, 62, 66, 64, 62, 59, 62, 69, 67, 71, 69, 67];

const jingle = [64, 64, 64, 64, 64, 64, 64, 67, 60, 62, 64,
  65, 65, 65, 65, 65, 64, 64, 64, 64, 62, 62, 64, 62, 67];

const greensleeves = [57, 60, 62, 64, 65, 64, 62, 59, 55, 57, 59, 60, 57, 57, 56, 57, 59, 56, 52,
  57, 60, 62, 64, 65, 64, 62, 59, 55, 57, 59, 60, 59, 57, 56, 54, 56, 57];

export const MELODIES: Record<string, { label: string; notes: number[][] }> = {
  ode: { label: 'Ode to Joy (Beethoven)', notes: ode.map((n) => [n]) },
  twinkle: { label: 'Twinkle Twinkle Little Star', notes: twinkle.map((n) => [n]) },
  furelise: { label: 'Für Elise (Beethoven)', notes: furElise.map((n) => [n]) },
  canon: { label: 'Canon in D (Pachelbel)', notes: canon.map((n) => [n]) },
  jingle: { label: 'Jingle Bells', notes: jingle.map((n) => [n]) },
  greensleeves: { label: 'Greensleeves', notes: greensleeves.map((n) => [n]) },
};

export const SCALES: Record<string, number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
  pentatonic: [0, 2, 4, 7, 9],
  blues: [0, 3, 5, 6, 7, 10],
  japanese: [0, 1, 5, 7, 8],
  chromatic: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
};
