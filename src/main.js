// Chlorophonie — l'orchestration.
// Relie le monde, les plantes, le son et l'interface : boucle de rendu,
// entrées (semer, arroser, tailler, cueillir), découvertes d'espèces,
// sauvegarde locale et lien de partage.

import { mulberry32, clamp } from './prng.js';
import { FAMILIES, makeGenome, crossGenomes, speciesKey, speciesInfo } from './genome.js';
import { Plant } from './plant.js';
import { AudioEngine } from './audio.js';
import { World } from './world.js';
import { UI } from './ui.js';
import { saveLocal, loadLocal, clearLocal, encodeShare, decodeShare } from './state.js';

const canvas = document.getElementById('scene');
const sceneCtx = canvas.getContext('2d', { alpha: false });
canvas.style.touchAction = 'none';
const world = new World();
const audio = new AudioEngine();
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const probeMode = new URLSearchParams(location.search).has('probe');

let plants = [];
let hybridSeeds = [];
let discovered = new Map();
let selectedSlot = 'seed-0';
let started = false;
let muted = false;
let watering = false;
let userActed = false;
let importedFromLink = false;
let freshStart = false;
let hoverPlant = null;
let pointer = { x: -1, y: -1, overSoil: false };
let saveTimer = 0;
let clockTimer = 0;
let windTimer = 0;
let waterSoundTimer = 0;
let lastSoilToast = 0;
let w = innerWidth;
let h = innerHeight;
const rngGlobal = mulberry32((Date.now() ^ Math.floor(Math.random() * 0xffffffff)) >>> 0);

const bootErrors = [];
window.addEventListener('error', (e) => bootErrors.push(String(e.message)));
window.addEventListener('unhandledrejection', (e) => bootErrors.push(String(e.reason)));

// ---- Plantation et découvertes ----

function anchorPlant(p) {
  p.x = p.x01 * w;
  const gy = world.groundY(p.x);
  p.y = gy + p.depth01 * Math.max(10, h - gy - 8);
  p.scale = world.depthScale(p.y);
  p.pan = clamp(p.x01 * 2 - 1, -0.9, 0.9) * 0.8;
  p.buildStructure();
}

function addPlant(genome, x, y, growth = 0) {
  if (plants.length >= 60) return 'full';
  for (const q of plants) {
    if (q.dying === 0 && Math.abs(q.x - x) < 22 && Math.abs(q.y - y) < 15) return 'crowded';
  }
  const p = new Plant(genome, x, y, { growth });
  p.x01 = x / w;
  const gy = world.groundY(x);
  p.depth01 = clamp((y - gy) / Math.max(10, h - gy - 8), 0, 1);
  anchorPlant(p);
  plants.push(p);
  ensureDiscovered(genome, false);
  return p;
}

function restorePlant(pd) {
  const p = new Plant(pd.genome, 0, 0, { growth: pd.growth });
  p.x01 = pd.x01;
  p.depth01 = pd.depth01;
  anchorPlant(p);
  plants.push(p);
}

function ensureDiscovered(genome, silent) {
  const key = speciesKey(genome);
  if (discovered.has(key)) return;
  discovered.set(key, { key, genome: { ...genome }, day: world.day });
  if (!silent) ui.discovery(speciesInfo(genome));
  refreshHerbier();
}

function refreshHerbier() {
  const entries = [...discovered.values()].map((e) => ({
    info: speciesInfo(e.genome),
    genome: e.genome,
    day: e.day,
  }));
  ui.renderHerbier(entries, world.sprites);
}

// ---- Barre d'outils ----

function isSeedSlot(id) {
  return id.startsWith('seed-') || id.startsWith('hyb-');
}

function refreshSlots() {
  const slots = [];
  FAMILIES.forEach((f, i) =>
    slots.push({
      id: `seed-${i}`,
      kind: 'seed',
      hue: f.hueBase,
      keyLabel: String(i + 1),
      title: `${f.label} — ${f.role}`,
      selected: selectedSlot === `seed-${i}`,
    })
  );
  hybridSeeds.forEach((g, i) =>
    slots.push({
      id: `hyb-${i}`,
      kind: 'hybrid',
      hue: g.hue,
      keyLabel: i < 4 ? String(6 + i) : '',
      title: `Graine hybride — ${speciesInfo(g).latin}`,
      selected: selectedSlot === `hyb-${i}`,
    })
  );
  slots.push({ id: 'tool-water', kind: 'tool', icon: 'water', keyLabel: 'A', title: 'Arrosoir — hâte la croissance (A)', selected: selectedSlot === 'tool-water' });
  slots.push({ id: 'tool-cut', kind: 'tool', icon: 'cut', keyLabel: 'T', title: 'Sécateur — taille une plante (T)', selected: selectedSlot === 'tool-cut' });
  slots.push({ id: 'tool-rain', kind: 'tool', icon: 'rain', keyLabel: 'P', title: 'Invoquer une averse (P)', selected: selectedSlot === 'tool-rain' });
  ui.setSlots(slots);
}

function selectSlot(id) {
  if (id.startsWith('hyb-') && !hybridSeeds[Number(id.slice(4))]) return;
  selectedSlot = id;
  refreshSlots();
}

// ---- Gestes du jardinier ----

function eventPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function sowAt(x, y) {
  if (!world.isSoil(x, y)) {
    const now = performance.now();
    if (now - lastSoilToast > 4000) {
      lastSoilToast = now;
      ui.toast('La graine veut la terre : semez sous la crête de la colline, au premier plan.');
    }
    return;
  }
  let genome;
  let hybIndex = -1;
  if (selectedSlot.startsWith('seed-')) {
    genome = makeGenome(Number(selectedSlot.slice(5)), rngGlobal);
  } else {
    hybIndex = Number(selectedSlot.slice(4));
    genome = hybridSeeds[hybIndex];
    if (!genome) return;
  }
  const res = addPlant(genome, x, y, 0);
  if (res === 'full') {
    ui.toast('La colline est comble — taillez une plante pour libérer la terre.', { once: 'full' });
    return;
  }
  if (res === 'crowded') {
    ui.toast('Trop serré : les racines ont besoin d’un peu d’espace.', { once: 'crowded' });
    return;
  }
  userActed = true;
  if (hybIndex >= 0) {
    hybridSeeds.splice(hybIndex, 1);
    selectedSlot = `seed-${genome.family}`;
    refreshSlots();
  }
  audio.plantSound(res.pan ?? 0);
  for (let i = 0; i < 4; i++) world.spawnSpore(x + (Math.random() - 0.5) * 10, y - 4, genome.hue);
}

function waterAt(x, y) {
  let touched = false;
  for (const p of plants) {
    if (p.dying === 0 && Math.abs(p.x - x) < 52 && Math.abs(p.y - y) < 70) {
      p.moisture = 8;
      touched = true;
    }
  }
  if (touched) {
    userActed = true;
    world.spawnSplash(x, Math.min(y, world.groundY(x) + 10));
    if (waterSoundTimer <= 0) {
      waterSoundTimer = 0.35;
      audio.waterSound(clamp((x / w) * 2 - 1, -0.9, 0.9));
    }
  }
}

function cutAt(x, y) {
  const sorted = plants.filter((p) => p.dying === 0).sort((a, b) => b.y - a.y);
  const target = sorted.find((p) => p.containsPoint(x, y));
  if (!target) return;
  userActed = true;
  target.dying = 0.001;
  audio.cutSound(target.pan ?? 0);
  const top = target.bounds;
  world.spawnBurst(target.x, (top.minY + target.y) / 2, target.genome.hue, 14);
  if (hoverPlant === target) {
    hoverPlant = null;
    ui.hideTooltip();
  }
}

function invokeRain() {
  if (world.raining) return;
  if (world.startRain()) {
    userActed = true;
    ui.toast('Le ciel s’assombrit — l’averse abreuve le jardin et sème des gouttes de musique.', {
      once: 'rain',
    });
  } else {
    ui.toast('Les nuages se reposent encore un moment.', { once: 'rain-cd' });
  }
}

function collectSeed(seed) {
  if (hybridSeeds.length >= 4) {
    world.floatingSeeds.push(seed);
    ui.toast('Votre bourse est pleine : semez vos hybrides avant d’en cueillir d’autres.', {
      once: 'pouch-full',
    });
    return;
  }
  userActed = true;
  hybridSeeds.push(seed.genome);
  refreshSlots();
  audio.collectSound(clamp((seed.x / w) * 2 - 1, -0.9, 0.9));
  world.spawnBurst(seed.x, seed.y, seed.genome.hue, 6);
  ui.toast('Graine hybride recueillie — elle attend dans la bourse (touches 6 à 9).', {
    once: 'collect',
  });
}

function onPointerDown(e) {
  if (!started || e.button === 2) return;
  const { x, y } = eventPos(e);
  const picked = world.pickSeedAt(x, y);
  if (picked) {
    collectSeed(picked);
    return;
  }
  if (selectedSlot === 'tool-water') {
    watering = true;
    waterAt(x, y);
  } else if (selectedSlot === 'tool-cut') {
    cutAt(x, y);
  } else if (selectedSlot === 'tool-rain') {
    invokeRain();
  } else {
    sowAt(x, y);
  }
}

function onPointerMove(e) {
  const { x, y } = eventPos(e);
  pointer.x = x;
  pointer.y = y;
  pointer.overSoil = world.isSoil(x, y);
  if (!reduceMotion) world.parallax = (x / w - 0.5) * 2;
  if (watering) waterAt(x, y);
  const sorted = plants.filter((p) => p.dying === 0 && p.growth > 0.12).sort((a, b) => b.y - a.y);
  const found = sorted.find((p) => p.containsPoint(x, y));
  if (found) {
    hoverPlant = found;
    ui.showTooltip(ui.tooltipHtml(found, Math.round(found.growth * 100)), x, y);
  } else if (hoverPlant) {
    hoverPlant = null;
    ui.hideTooltip();
  }
}

function onPointerUp() {
  watering = false;
}

function onKeyDown(e) {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  const k = e.key.toLowerCase();
  if (k === 'escape') {
    ui.toggleHerbier(false);
    ui.toggleHelp(false);
    return;
  }
  if (!started) return;
  if (k >= '1' && k <= '5') selectSlot(`seed-${Number(k) - 1}`);
  else if (k >= '6' && k <= '9') selectSlot(`hyb-${Number(k) - 6}`);
  else if (k === 'a') selectSlot('tool-water');
  else if (k === 't') selectSlot('tool-cut');
  else if (k === 'p') selectSlot('tool-rain');
  else if (k === 'h') ui.toggleHerbier();
  else if (k === 'm') toggleMute();
  else if (k === '?') ui.toggleHelp();
}

// ---- Partage et sauvegarde ----

function currentData() {
  return {
    day: world.day,
    time: world.time,
    plants: plants
      .filter((p) => p.dying === 0)
      .map((p) => ({ x01: p.x01, depth01: p.depth01, growth: p.growth, genome: p.genome })),
    seeds: hybridSeeds,
    discovered: [...discovered.values()],
  };
}

function maybeSave() {
  if (!started) return;
  if (importedFromLink && !userActed) return; // ne pas écraser un jardin local avec un lien visité
  saveLocal(currentData());
}

function share() {
  const code = encodeShare(currentData());
  const base = location.href.split('#')[0];
  const url = `${base}#g=${code}`;
  const done = () =>
    ui.toast('Il contient toute votre partition : quiconque l’ouvre entendra ce jardin.', {
      title: 'Lien du jardin copié',
    });
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(url).then(done, () => fallbackCopy(url, done));
  } else {
    fallbackCopy(url, done);
  }
}

function fallbackCopy(text, done) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    done();
  } catch {
    ui.toast('Impossible de copier automatiquement — le lien est dans la barre d’adresse.', {});
    location.hash = `g=${encodeShare(currentData())}`;
  }
  ta.remove();
}

function toggleMute() {
  muted = !muted;
  audio.setMuted(muted);
  ui.setMuted(muted);
}

function resetGarden() {
  clearLocal();
  history.replaceState(null, '', location.pathname + location.search);
  location.reload();
}

// ---- États initiaux ----

function applyState(st) {
  world.day = st.day;
  world.time = st.time;
  hybridSeeds = st.seeds.slice(0, 4);
  discovered = new Map(st.discovered.map((e) => [e.key, e]));
  plants = [];
  for (const pd of st.plants) restorePlant(pd);
  for (const p of plants) ensureDiscovered(p.genome, true);
}

function freshGarden() {
  freshStart = true;
  const r = mulberry32(20260820);
  const starters = [
    [0, 0.3, 0.4, 0.85],
    [1, 0.52, 0.55, 0.55],
    [3, 0.68, 0.3, 0.32],
  ];
  for (const [fam, x01, depth01, growth] of starters) {
    restorePlant({ genome: makeGenome(fam, r), x01, depth01, growth });
  }
  for (const p of plants) ensureDiscovered(p.genome, true);
}

async function enterGarden() {
  try {
    await audio.init();
  } catch (err) {
    bootErrors.push(String(err));
    ui.toast('Le son n’a pas pu démarrer — le jardin restera silencieux ici.', {});
  }
  started = true;
  ui.hideOnboarding();
  if (importedFromLink) {
    ui.toast('Ses plantes, son heure et son herbier ont voyagé dans le lien.', {
      title: 'Jardin importé',
    });
  } else if (freshStart) {
    setTimeout(() => {
      ui.toast('Choisissez une semence (1 à 5), puis cliquez la terre au premier plan.', {
        once: 'hint-sow',
        ms: 7000,
      });
    }, 1800);
    setTimeout(() => {
      ui.toast('Les jeunes pousses chantent quand elles fleurissent — l’arrosoir (A) les hâte.', {
        once: 'hint-water',
        ms: 7000,
      });
    }, 26000);
  }
}

// ---- Boucle ----

function resize() {
  w = innerWidth;
  h = innerHeight;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  sceneCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
  world.resize(w, h);
  for (const p of plants) anchorPlant(p);
}

function handleVisual(ev) {
  const p = plants.find((pl) => pl.id === ev.plantId);
  if (!p) return;
  const bloom = p.pulse(ev.kind, ev.data);
  if (bloom && !reduceMotion && Math.random() < 0.55) {
    world.spawnSpore(bloom.x, bloom.y, p.glowHue);
  }
}

function drawReticle() {
  if (!started || !isSeedSlot(selectedSlot) || !pointer.overSoil || hoverPlant || watering) return;
  sceneCtx.save();
  sceneCtx.strokeStyle = 'rgba(201,169,106,0.55)';
  sceneCtx.lineWidth = 1;
  sceneCtx.setLineDash([4, 5]);
  sceneCtx.beginPath();
  sceneCtx.arc(pointer.x, pointer.y, 13, 0, Math.PI * 2);
  sceneCtx.stroke();
  sceneCtx.setLineDash([]);
  sceneCtx.beginPath();
  sceneCtx.moveTo(pointer.x, pointer.y - 19);
  sceneCtx.lineTo(pointer.x, pointer.y - 26);
  sceneCtx.stroke();
  sceneCtx.restore();
}

function draw() {
  world.drawBack(sceneCtx);
  const env = { glowAlpha: world.glowAlpha(), sprites: world.sprites };
  const sorted = plants.slice().sort((a, b) => a.y - b.y);
  for (const p of sorted) p.draw(sceneCtx, env);
  world.drawFront(sceneCtx);
  drawReticle();
}

let last = performance.now();
let frames = 0;
let fpsClock = 0;
let fps = 0;

function frame(now) {
  const dt = clamp((now - last) / 1000, 0, 0.06);
  last = now;
  frames++;
  fpsClock += dt;
  if (fpsClock >= 1) {
    fps = frames;
    frames = 0;
    fpsClock = 0;
  }
  if (started) {
    world.reduced = reduceMotion;
    const level = audio.ready ? audio.level() : 0;
    const wave = audio.ready ? audio.waveform() : null;
    world.update(dt, plants, level, wave);
    if (audio.ready && audio.raining !== world.raining) audio.setRain(world.raining);
    windTimer -= dt;
    waterSoundTimer -= dt;
    if (windTimer <= 0 && audio.ready) {
      windTimer = 0.7;
      audio.setWind(clamp(world.gust, 0, 1));
    }
    const env = { windAt: (x) => world.windAt(x), raining: world.raining, growthScale: 1 };
    for (let i = plants.length - 1; i >= 0; i--) {
      const p = plants[i];
      p.update(dt, env);
      if (p.dying >= 1) plants.splice(i, 1);
    }
    audio.drainVisuals(handleVisual);
    clockTimer -= dt;
    if (clockTimer <= 0) {
      clockTimer = 0.5;
      ui.updateClock({ day: world.day, phase: world.phase });
      ui.setRainCooldown(world.rainT > 0 ? 0 : clamp(world.rainCooldown / 50, 0, 1));
    }
    saveTimer += dt;
    if (saveTimer > 8) {
      saveTimer = 0;
      maybeSave();
    }
  }
  draw();
  requestAnimationFrame(frame);
}

// ---- Sonde de diagnostic (mode ?probe pour la validation sans interaction) ----

function startProbe() {
  const el = document.createElement('div');
  el.id = 'probe';
  el.style.display = 'none';
  document.body.appendChild(el);
  ui.hideOnboarding();
  started = true;
  audio.init().catch((err) => bootErrors.push(String(err)));
  setTimeout(() => {
    for (let i = 0; i < 5; i++) {
      const x = w * (0.15 + i * 0.16);
      const y = world.groundY(x) + 24 + (i % 3) * 22;
      addPlant(makeGenome(i, rngGlobal), x, y, 0.96);
    }
  }, 400);
  setInterval(() => {
    el.textContent = JSON.stringify({
      errors: bootErrors,
      plants: plants.length,
      fps,
      day: world.day,
      time: Number(world.time.toFixed(3)),
      phase: world.phase,
      audioState: audio.ctx ? audio.ctx.state : 'none',
      discovered: discovered.size,
      seeds: hybridSeeds.length,
    });
  }, 500);
}

// ---- Démarrage ----

const ui = new UI({
  onSelectSlot: selectSlot,
  onEnter: enterGarden,
  onShare: share,
  onToggleMute: toggleMute,
  onReset: resetGarden,
});

resize();
window.addEventListener('resize', resize);
canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
window.addEventListener('pointerup', onPointerUp);
canvas.addEventListener('pointerleave', () => {
  hoverPlant = null;
  ui.hideTooltip();
  pointer.overSoil = false;
});
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
window.addEventListener('keydown', onKeyDown);
window.addEventListener('pagehide', maybeSave);

audio.plantsProvider = () => plants;
audio.timeProvider = () => world.time;

world.onCross = (pa, pb, x, y) => {
  if (world.floatingSeeds.length >= 4) return;
  if (rngGlobal() < 0.55) {
    const child = crossGenomes(pa.genome, pb.genome, rngGlobal);
    world.spawnSeed(x, y, child);
    world.spawnBurst(x, y, child.hue, 8);
    ui.toast('Un pollinisateur vient de nouer une graine hybride — cueillez-la où elle brille.', {
      once: 'hybrid-hint',
      title: 'Pollinisation croisée',
      ms: 8000,
    });
  }
};

world.onShootingStar = () => {
  if (audio.ready && !muted && !document.hidden) audio.starSound();
};

const hashState = location.hash.startsWith('#g=') ? decodeShare(location.hash.slice(3)) : null;
const localState = hashState ? null : loadLocal();
importedFromLink = !!hashState;
const st = hashState || localState;
if (st && st.plants) applyState(st);
else freshGarden();

refreshSlots();
refreshHerbier();
ui.updateClock({ day: world.day, phase: world.phase });
ui.setMuted(false);
ui.showOnboarding({ returning: !!localState, day: world.day });
if (probeMode) startProbe();
requestAnimationFrame(frame);

// Poignée de diagnostic (utilisée par les captures headless et la console).
window.__chloro = {
  world,
  audio,
  plants: () => plants,
  state: () => ({ started, selectedSlot, hybridSeeds: hybridSeeds.length }),
  shareUrl: () => `${location.href.split('#')[0]}#g=${encodeShare(currentData())}`,
};
