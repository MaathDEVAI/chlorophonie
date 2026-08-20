// Chlorophonie — théorie musicale du jardin.
// Le mode change avec l'heure : le jour est lumineux, la nuit se voile.
// Toutes les voix des plantes puisent dans la même gamme et la même
// progression d'accords, c'est ce qui fait chanter le jardin plutôt
// que tinter des notes au hasard.

export const ROOT_MIDI = 45; // La2 — la terre du jardin est accordée en la.

export const MODES = {
  dawn: { label: 'Lydien', steps: [0, 2, 4, 6, 7, 9, 11] },
  day: { label: 'Ionien', steps: [0, 2, 4, 5, 7, 9, 11] },
  dusk: { label: 'Dorien', steps: [0, 2, 3, 5, 7, 9, 10] },
  night: { label: 'Éolien', steps: [0, 2, 3, 5, 7, 8, 10] },
};

// Degrés (0..6) des accords, joués en boucle — deux mesures par accord.
export const PROGRESSIONS = {
  dawn: [0, 4, 5, 3],
  day: [0, 5, 3, 4],
  dusk: [0, 3, 6, 4],
  night: [0, 5, 2, 6],
};

export function midiToFreq(m) {
  return 440 * Math.pow(2, (m - 69) / 12);
}

// Index de gamme entier (négatif ou grand) -> note MIDI.
export function scaleMidi(mode, rootMidi, index) {
  const n = mode.steps.length;
  const oct = Math.floor(index / n);
  const step = ((index % n) + n) % n;
  return rootMidi + oct * 12 + mode.steps[step];
}

// Notes d'un accord de 7e sur un degré de la gamme (indices de gamme).
export function chordScaleIndices(degree) {
  return [degree, degree + 2, degree + 4, degree + 6];
}

// Ramène une note MIDI quelconque sur la note de gamme la plus proche.
export function quantizeToScale(mode, rootMidi, midi) {
  let best = midi;
  let bestDist = Infinity;
  const rel = midi - rootMidi;
  const baseOct = Math.floor(rel / 12);
  for (let oct = baseOct - 1; oct <= baseOct + 1; oct++) {
    for (const s of mode.steps) {
      const cand = rootMidi + oct * 12 + s;
      const d = Math.abs(cand - midi);
      if (d < bestDist) {
        bestDist = d;
        best = cand;
      }
    }
  }
  return best;
}

// Phase de la journée pour un temps [0,1).
export function phaseOfTime(t) {
  const x = ((t % 1) + 1) % 1;
  if (x < 0.08) return 'dawn';
  if (x < 0.44) return 'day';
  if (x < 0.58) return 'dusk';
  return 'night';
}

export const PHASE_LABELS = {
  dawn: 'aube',
  day: 'plein jour',
  dusk: 'crépuscule',
  night: 'nuit',
};

// Motif rythmique euclidien : k impulsions réparties sur n pas.
export function euclidPattern(k, n) {
  const pattern = new Array(n).fill(false);
  if (k <= 0) return pattern;
  if (k >= n) return pattern.fill(true);
  let bucket = 0;
  for (let i = 0; i < n; i++) {
    bucket += k;
    if (bucket >= n) {
      bucket -= n;
      pattern[i] = true;
    }
  }
  return pattern;
}
