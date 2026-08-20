// Chlorophonie — aléatoire déterministe.
// Tout le vivant du jardin (silhouettes, rythmes, noms) découle de graines
// numériques reproductibles : un même génome redonne toujours la même plante.

export function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return h >>> 0;
}

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rand(rng, a, b) {
  return a + rng() * (b - a);
}

export function rint(rng, a, b) {
  return a + Math.floor(rng() * (b - a + 1));
}

export function pick(rng, arr) {
  return arr[Math.floor(rng() * arr.length)];
}

// Bruit de valeur 1D lissé (interpolation cubique) + fbm — vent, collines.
export function makeNoise1D(seed) {
  const base = mulberry32(seed >>> 0);
  const table = new Float32Array(1024);
  for (let i = 0; i < 1024; i++) table[i] = base() * 2 - 1;

  function at(x) {
    const xi = Math.floor(x);
    const xf = x - xi;
    const a = table[((xi % 1024) + 1024) % 1024];
    const b = table[(((xi + 1) % 1024) + 1024) % 1024];
    const u = xf * xf * (3 - 2 * xf);
    return a + (b - a) * u;
  }

  function fbm(x, octaves = 3) {
    let sum = 0;
    let amp = 0.5;
    let freq = 1;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += at(x * freq + o * 137.31) * amp;
      norm += amp;
      amp *= 0.5;
      freq *= 2.07;
    }
    return sum / norm;
  }

  return { at, fbm };
}

export function clamp(v, a, b) {
  return v < a ? a : v > b ? b : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

export function smoothstep(e0, e1, x) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}
