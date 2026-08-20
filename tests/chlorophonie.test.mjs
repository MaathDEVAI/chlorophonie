// Chlorophonie — tests de la logique pure (node --test tests/).
import test from 'node:test';
import assert from 'node:assert/strict';

import { mulberry32, hash32, makeNoise1D, clamp } from '../src/prng.js';
import {
  MODES,
  ROOT_MIDI,
  midiToFreq,
  scaleMidi,
  chordScaleIndices,
  quantizeToScale,
  phaseOfTime,
  euclidPattern,
} from '../src/music.js';
import {
  FAMILIES,
  makeGenome,
  crossGenomes,
  speciesKey,
  speciesInfo,
  genomeToArray,
  genomeFromArray,
  hueBucket,
} from '../src/genome.js';
import { packState, unpackState, encodeShare, decodeShare } from '../src/state.js';

test('mulberry32 est déterministe et borné', () => {
  const a = mulberry32(1234);
  const b = mulberry32(1234);
  for (let i = 0; i < 1000; i++) {
    const va = a();
    assert.equal(va, b());
    assert.ok(va >= 0 && va < 1);
  }
});

test('hash32 est stable', () => {
  assert.equal(hash32('chlorophonie'), hash32('chlorophonie'));
  assert.notEqual(hash32('campanule'), hash32('roseau'));
});

test('le bruit 1D est continu et borné', () => {
  const n = makeNoise1D(7);
  for (let x = 0; x < 50; x += 0.13) {
    const v = n.fbm(x, 3);
    assert.ok(v >= -1.01 && v <= 1.01, `fbm(${x}) = ${v}`);
  }
  assert.ok(Math.abs(n.fbm(3.0, 2) - n.fbm(3.001, 2)) < 0.05, 'continuité');
});

test('scaleMidi gère les octaves et indices négatifs', () => {
  const mode = MODES.day;
  assert.equal(scaleMidi(mode, 60, 0), 60);
  assert.equal(scaleMidi(mode, 60, 7), 72);
  assert.equal(scaleMidi(mode, 60, -7), 48);
  assert.equal(scaleMidi(mode, 60, 1), 62);
});

test('quantizeToScale renvoie une note de la gamme', () => {
  const mode = MODES.night;
  for (let midi = 40; midi < 90; midi++) {
    const q = quantizeToScale(mode, ROOT_MIDI, midi);
    const rel = (((q - ROOT_MIDI) % 12) + 12) % 12;
    assert.ok(mode.steps.includes(rel), `${midi} -> ${q} (rel ${rel})`);
    assert.ok(Math.abs(q - midi) <= 2);
  }
});

test('midiToFreq : le la 440', () => {
  assert.ok(Math.abs(midiToFreq(69) - 440) < 1e-9);
});

test('les accords de 7e ont 4 notes de gamme', () => {
  assert.deepEqual(chordScaleIndices(2), [2, 4, 6, 8]);
});

test('euclidPattern répartit k impulsions sur n pas', () => {
  for (const [k, n] of [[1, 8], [3, 8], [5, 8], [8, 8], [0, 8]]) {
    const p = euclidPattern(k, n);
    assert.equal(p.length, n);
    assert.equal(p.filter(Boolean).length, k);
  }
});

test('phaseOfTime couvre la journée', () => {
  assert.equal(phaseOfTime(0.02), 'dawn');
  assert.equal(phaseOfTime(0.2), 'day');
  assert.equal(phaseOfTime(0.5), 'dusk');
  assert.equal(phaseOfTime(0.8), 'night');
  assert.equal(phaseOfTime(1.2), 'day');
});

test('makeGenome produit des traits bornés pour chaque famille', () => {
  const rng = mulberry32(42);
  for (let f = 0; f < FAMILIES.length; f++) {
    for (let i = 0; i < 40; i++) {
      const g = makeGenome(f, rng);
      assert.equal(g.family, f);
      for (const t of ['hue', 'height', 'spread', 'petals', 'rhythm', 'register', 'brightness']) {
        assert.ok(g[t] >= 0 && g[t] <= 1, `${t} = ${g[t]}`);
      }
      assert.ok(g.phase >= 0 && g.phase <= 7);
      assert.equal(g.gen, 0);
    }
  }
});

test('crossGenomes reste borné et incrémente la génération', () => {
  const rng = mulberry32(99);
  const a = makeGenome(0, rng);
  const b = makeGenome(2, rng);
  for (let i = 0; i < 200; i++) {
    const c = crossGenomes(a, b, rng);
    for (const t of ['hue', 'height', 'spread', 'petals', 'rhythm', 'register', 'brightness']) {
      assert.ok(c[t] >= 0 && c[t] <= 1, `${t} = ${c[t]}`);
    }
    assert.ok(c.family >= 0 && c.family < FAMILIES.length);
    assert.equal(c.gen, 1);
  }
});

test('speciesKey est stable et speciesInfo est complet', () => {
  const rng = mulberry32(7);
  const g = makeGenome(1, rng);
  assert.equal(speciesKey(g), speciesKey({ ...g }));
  const info = speciesInfo(g);
  assert.ok(info.latin.startsWith(FAMILIES[1].genus));
  assert.ok(info.common.length > 3);
  assert.ok(info.description.length > 20);
  assert.equal(info.key, speciesKey(g));
});

test('hueBucket découpe la roue en 7 sans déborder', () => {
  for (let h = 0; h <= 1.0001; h += 0.01) {
    const b = hueBucket(clamp(h, 0, 1));
    assert.ok(b >= 0 && b <= 6);
  }
});

test('genomeToArray/genomeFromArray : aller-retour à 1/255 près', () => {
  const rng = mulberry32(2024);
  for (let i = 0; i < 100; i++) {
    const g = crossGenomes(makeGenome(i % 5, rng), makeGenome((i + 2) % 5, rng), rng);
    const back = genomeFromArray(genomeToArray(g));
    assert.equal(back.family, g.family);
    assert.equal(back.phase, g.phase);
    assert.equal(back.gen, g.gen);
    assert.equal(back.seed, g.seed);
    for (const t of ['hue', 'height', 'spread', 'petals', 'rhythm', 'register', 'brightness']) {
      assert.ok(Math.abs(back[t] - g[t]) <= 1 / 255 + 1e-9, `${t}: ${back[t]} vs ${g[t]}`);
    }
  }
});

function sampleData() {
  const rng = mulberry32(1);
  const g1 = makeGenome(0, rng);
  const g2 = makeGenome(4, rng);
  return {
    day: 3,
    time: 0.42,
    plants: [
      { x01: 0.25, depth01: 0.4, growth: 1, genome: g1 },
      { x01: 0.8, depth01: 0.1, growth: 0.37, genome: g2 },
    ],
    seeds: [crossGenomes(g1, g2, rng)],
    discovered: [
      { key: speciesKey(g1), genome: g1, day: 1 },
      { key: speciesKey(g2), genome: g2, day: 2 },
    ],
  };
}

test('packState/unpackState : aller-retour', () => {
  const data = sampleData();
  const back = unpackState(packState(data));
  assert.equal(back.day, 3);
  assert.ok(Math.abs(back.time - 0.42) < 0.001);
  assert.equal(back.plants.length, 2);
  assert.ok(Math.abs(back.plants[0].x01 - 0.25) < 0.002);
  assert.ok(Math.abs(back.plants[1].growth - 0.37) < 0.011);
  assert.equal(back.seeds.length, 1);
  assert.equal(back.discovered.length, 2);
  assert.equal(back.discovered[0].key, data.discovered[0].key);
});

test('encodeShare/decodeShare : URL-sûr et réversible', () => {
  const data = sampleData();
  const code = encodeShare(data);
  assert.match(code, /^[A-Za-z0-9_-]+$/);
  const back = decodeShare(code);
  assert.ok(back);
  assert.equal(back.plants.length, 2);
  assert.equal(back.discovered.length, 2);
  assert.equal(decodeShare('%%%invalide%%%'), null);
});

test('unpackState rejette les données étrangères', () => {
  assert.equal(unpackState(null), null);
  assert.equal(unpackState({ v: 99 }), null);
});
