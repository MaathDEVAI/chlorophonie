// Chlorophonie — génétique botanique.
// Chaque graine porte un génome : silhouette, teinte, tempérament rythmique.
// Les pollinisateurs croisent les génomes ; l'herbier classe les espèces.

import { mulberry32, rand, rint, pick, clamp } from './prng.js';

export const FAMILIES = [
  {
    key: 'campanule',
    label: 'Campanule',
    genus: 'Campanula',
    role: 'Cloches — porte la mélodie',
    organ: 'clochettes pendantes',
    hueBase: 0.55, // bleu-cyan par défaut
  },
  {
    key: 'roseau',
    label: 'Roseau',
    genus: 'Arundo',
    role: 'Nappes — tient l’accord',
    organ: 'plumets soyeux',
    hueBase: 0.38,
  },
  {
    key: 'lampyre',
    label: 'Lampyre',
    genus: 'Lucerna',
    role: 'Arpèges — grimpe la gamme',
    organ: 'perles lumineuses en spirale',
    hueBase: 0.78,
  },
  {
    key: 'tympan',
    label: 'Tympan',
    genus: 'Tympanea',
    role: 'Pouls — bat la mesure',
    organ: 'gousses rondes et creuses',
    hueBase: 0.07,
  },
  {
    key: 'ombelle',
    label: 'Ombelle',
    genus: 'Stellaria',
    role: 'Carillons — sème des étincelles',
    organ: 'ombelles étoilées',
    hueBase: 0.13,
  },
];

// Un génome : famille + traits continus [0,1] + graine de structure.
export function makeGenome(familyIndex, rng) {
  const fam = FAMILIES[familyIndex];
  const hue = clamp(fam.hueBase + rand(rng, -0.07, 0.07), 0, 1);
  return {
    family: familyIndex,
    hue,
    height: rand(rng, 0.3, 0.75),
    spread: rand(rng, 0.25, 0.75),
    petals: rand(rng, 0.3, 0.8),
    rhythm: rand(rng, 0.3, 0.7),
    phase: rint(rng, 0, 7),
    register: rand(rng, 0.25, 0.75),
    brightness: rand(rng, 0.3, 0.7),
    seed: Math.floor(rng() * 4294967296) >>> 0,
    gen: 0,
  };
}

function mixTrait(rng, a, b, mutation) {
  let v = rng() < 0.5 ? a : b;
  if (rng() < 0.65) v = (a + b) / 2 + rand(rng, -0.5, 0.5) * Math.abs(a - b);
  if (rng() < mutation) v += rand(rng, -0.18, 0.18);
  return clamp(v, 0, 1);
}

export function crossGenomes(a, b, rng) {
  const MUT = 0.22;
  let family = rng() < 0.5 ? a.family : b.family;
  if (rng() < 0.1) family = rint(rng, 0, FAMILIES.length - 1); // sport botanique
  return {
    family,
    hue: mixTrait(rng, a.hue, b.hue, MUT),
    height: mixTrait(rng, a.height, b.height, MUT),
    spread: mixTrait(rng, a.spread, b.spread, MUT),
    petals: mixTrait(rng, a.petals, b.petals, MUT),
    rhythm: mixTrait(rng, a.rhythm, b.rhythm, MUT),
    phase: rng() < 0.5 ? a.phase : b.phase,
    register: mixTrait(rng, a.register, b.register, MUT),
    brightness: mixTrait(rng, a.brightness, b.brightness, MUT),
    seed: Math.floor(rng() * 4294967296) >>> 0,
    gen: Math.max(a.gen, b.gen) + 1,
  };
}

// ---- Classification en espèces (clé -> planche d'herbier) ----

const HUE_WORDS = [
  { latin: 'ignea', fr: 'de braise' }, // rouges-orangés
  { latin: 'aurea', fr: 'dorée' }, // ors
  { latin: 'viridis', fr: 'de mousse' }, // verts
  { latin: 'cyanea', fr: 'd’opale' }, // cyans
  { latin: 'azurea', fr: 'd’azur' }, // bleus
  { latin: 'violacea', fr: 'de mauve' }, // violets
  { latin: 'rosea', fr: 'de rose' }, // magentas
];

const FORM_WORDS = [
  { latin: 'humilis', fr: 'naine' },
  { latin: 'erecta', fr: 'élancée' },
  { latin: 'ramosa', fr: 'foisonnante' },
];

const TEMPO_WORDS = [
  { latin: 'lenta', fr: 'au chant rare' },
  { latin: 'vivax', fr: 'au chant vif' },
];

export function hueBucket(hue) {
  return Math.min(6, Math.floor(((hue % 1) + 1) % 1 * 7));
}

export function formBucket(g) {
  const f = g.height * 0.6 + g.spread * 0.4;
  if (f < 0.42) return 0;
  if (f < 0.62) return 1;
  return 2;
}

export function tempoBucket(g) {
  return g.rhythm < 0.55 ? 0 : 1;
}

export function speciesKey(g) {
  return `${g.family}-${hueBucket(g.hue)}-${formBucket(g)}-${tempoBucket(g)}`;
}

const DESCRIPTION_HABITS = [
  'On la rencontre aux lisières du jardin, là où la terre garde la rosée.',
  'Elle aime les pentes douces et la compagnie des autres voix.',
  'Rare aux heures chaudes, elle se révèle quand la lumière tombe.',
  'Sa souche est têtue : une fois semée, elle tient sa place dans le chœur.',
  'Les pollinisateurs la visitent volontiers ; ses hybrides sont recherchés.',
  'Les vieux herbiers la disaient muette. Ils ne l’avaient pas écoutée la nuit.',
];

export function speciesInfo(g) {
  const fam = FAMILIES[g.family];
  const hb = hueBucket(g.hue);
  const fb = formBucket(g);
  const tb = tempoBucket(g);
  const latin = `${fam.genus} ${HUE_WORDS[hb].latin} ${FORM_WORDS[fb].latin} var. ${TEMPO_WORDS[tb].latin}`;
  const common = `${fam.label} ${HUE_WORDS[hb].fr}`;
  const descRng = mulberry32(hashForKey(speciesKey(g)));
  const description =
    `${capitalize(FORM_WORDS[fb].fr)} et ${TEMPO_WORDS[tb].fr}, ` +
    `elle porte des ${fam.organ}. ${pick(descRng, DESCRIPTION_HABITS)}`;
  return {
    key: speciesKey(g),
    latin,
    common,
    familyLabel: fam.label,
    role: fam.role,
    description,
  };
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hashForKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
  return h;
}

// ---- Sérialisation compacte (sauvegarde locale + lien de partage) ----

const TRAITS = ['hue', 'height', 'spread', 'petals', 'rhythm', 'register', 'brightness'];

export function genomeToArray(g) {
  const arr = [g.family, g.phase, g.gen];
  for (const t of TRAITS) arr.push(Math.round(clamp(g[t], 0, 1) * 255));
  arr.push(g.seed);
  return arr;
}

export function genomeFromArray(arr) {
  const g = {
    family: clamp(Math.round(arr[0]), 0, FAMILIES.length - 1),
    phase: clamp(Math.round(arr[1]), 0, 7),
    gen: Math.max(0, Math.round(arr[2])),
  };
  TRAITS.forEach((t, i) => {
    g[t] = clamp(arr[3 + i] / 255, 0, 1);
  });
  g.seed = arr[3 + TRAITS.length] >>> 0;
  return g;
}
