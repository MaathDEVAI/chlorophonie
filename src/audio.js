// Chlorophonie — le moteur sonore.
// Un ordonnanceur à anticipation (lookahead) fait battre le jardin à 68 bpm.
// Chaque plante mûre est une voix ; toutes partagent le mode de l'heure et
// une progression d'accords lente. Les événements programmés sont poussés
// dans une file visuelle pour que les fleurs s'illuminent pile sur leur note.

import {
  MODES,
  PROGRESSIONS,
  ROOT_MIDI,
  midiToFreq,
  scaleMidi,
  chordScaleIndices,
  phaseOfTime,
  euclidPattern,
} from './music.js';
import { mulberry32, clamp } from './prng.js';

const BPM = 68;
const STEP = 60 / BPM / 2; // croche
const STEPS_PER_BAR = 8;
const STEPS_PER_CHORD = 16; // deux mesures par accord

export class AudioEngine {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.visualQueue = [];
    this.plantsProvider = () => [];
    this.timeProvider = () => 0.2;
    this.step = 0;
    this.nextStepTime = 0;
    this.phase = 'day';
    this.chordDegree = 0;
    this.chordCount = 0;
    this.raining = false;
    this.windLevel = 0;
    this.arpBusy = new Map(); // plantId -> step de fin de course
    this.padState = new Map(); // plantId -> {gain, oscs, filter}
    this._level = 0;
  }

  get currentMode() {
    return MODES[this.phase] || MODES.day;
  }

  async init() {
    if (this.ready) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    if (ctx.state === 'suspended') await ctx.resume();

    // ---- Bus maître ----
    this.master = ctx.createGain();
    this.master.gain.value = 0.9;
    this.comp = ctx.createDynamicsCompressor();
    this.comp.threshold.value = -20;
    this.comp.knee.value = 18;
    this.comp.ratio.value = 4;
    this.comp.attack.value = 0.008;
    this.comp.release.value = 0.4;
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.85;
    this.waveArray = new Float32Array(this.analyser.fftSize);

    this.comp.connect(this.master);
    this.master.connect(this.analyser);
    this.analyser.connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.comp);

    // Réverbération : réponse impulsionnelle générée (nef végétale, 3,8 s).
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this.makeImpulse(3.8, 2.6);
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 1;
    this.reverbSend.connect(this.reverb);
    const revOut = ctx.createGain();
    revOut.gain.value = 0.55;
    this.reverb.connect(revOut);
    revOut.connect(this.comp);

    // Délai stéréo croisé, filtré.
    this.delaySend = ctx.createGain();
    const dl = ctx.createDelay(3);
    const dr = ctx.createDelay(3);
    dl.delayTime.value = STEP * 3;
    dr.delayTime.value = STEP * 5;
    const fb = ctx.createGain();
    fb.gain.value = 0.32;
    const dFilter = ctx.createBiquadFilter();
    dFilter.type = 'lowpass';
    dFilter.frequency.value = 2400;
    const merger = ctx.createChannelMerger(2);
    this.delaySend.connect(dl);
    dl.connect(merger, 0, 0);
    dl.connect(dr);
    dr.connect(merger, 0, 1);
    dr.connect(fb);
    fb.connect(dFilter);
    dFilter.connect(dl);
    const delOut = ctx.createGain();
    delOut.gain.value = 0.4;
    merger.connect(delOut);
    delOut.connect(this.comp);

    // ---- Couches ambiantes ----
    this.noiseBuffer = this.makeNoiseBuffer(2);

    // Bourdon de la terre : fondamentale + quinte, très bas.
    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = 0;
    const droneFilter = ctx.createBiquadFilter();
    droneFilter.type = 'lowpass';
    droneFilter.frequency.value = 240;
    this.droneOsc1 = ctx.createOscillator();
    this.droneOsc1.type = 'sine';
    this.droneOsc2 = ctx.createOscillator();
    this.droneOsc2.type = 'triangle';
    const drone2Gain = ctx.createGain();
    drone2Gain.gain.value = 0.35;
    this.droneOsc1.frequency.value = midiToFreq(ROOT_MIDI - 12);
    this.droneOsc2.frequency.value = midiToFreq(ROOT_MIDI - 5);
    this.droneOsc1.connect(this.droneGain);
    this.droneOsc2.connect(drone2Gain);
    drone2Gain.connect(this.droneGain);
    this.droneGain.connect(droneFilter);
    droneFilter.connect(this.dry);
    this.droneOsc1.start();
    this.droneOsc2.start();

    // Vent : souffle filtré dont le gain suit les rafales.
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    const windSrc = ctx.createBufferSource();
    windSrc.buffer = this.noiseBuffer;
    windSrc.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 480;
    this.windFilter.Q.value = 0.6;
    windSrc.connect(this.windFilter);
    this.windFilter.connect(this.windGain);
    this.windGain.connect(this.dry);
    windSrc.start();

    // Pluie : nappe de bruit aigu, ouverte pendant les averses.
    this.rainGain = ctx.createGain();
    this.rainGain.gain.value = 0;
    const rainSrc = ctx.createBufferSource();
    rainSrc.buffer = this.noiseBuffer;
    rainSrc.loop = true;
    rainSrc.playbackRate.value = 1.7;
    const rainFilter = ctx.createBiquadFilter();
    rainFilter.type = 'highpass';
    rainFilter.frequency.value = 3200;
    rainSrc.connect(rainFilter);
    rainFilter.connect(this.rainGain);
    this.rainGain.connect(this.dry);
    rainSrc.start();

    // ---- Ordonnanceur ----
    this.nextStepTime = ctx.currentTime + 0.1;
    this.phase = phaseOfTime(this.timeProvider());
    this.timer = setInterval(() => this.schedule(), 30);
    document.addEventListener('visibilitychange', () => {
      if (!this.ctx) return;
      const t = this.ctx.currentTime;
      const target = document.hidden || this.muted ? 0.0001 : 0.9;
      this.master.gain.cancelScheduledValues(t);
      this.master.gain.setTargetAtTime(target, t, 0.3);
    });

    this.ready = true;
  }

  makeImpulse(seconds, decay) {
    const ctx = this.ctx;
    const rate = ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      const rng = mulberry32(1234 + ch * 999);
      let last = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // bruit adouci (moyenne glissante grossière) + décroissance exponentielle
        const white = rng() * 2 - 1;
        last = last * 0.6 + white * 0.4;
        data[i] = last * Math.pow(1 - t, decay) * (1 - Math.exp(-i / 400));
      }
    }
    return buf;
  }

  makeNoiseBuffer(seconds) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(seconds * rate);
    const buf = this.ctx.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    const rng = mulberry32(777);
    for (let i = 0; i < len; i++) data[i] = rng() * 2 - 1;
    return buf;
  }

  // Route une source vers les bus avec panoramique et niveaux d'envoi.
  route(node, pan, dry = 1, rev = 0.3, del = 0) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    node.connect(p);
    if (dry > 0) {
      const g = this.ctx.createGain();
      g.gain.value = dry;
      p.connect(g);
      g.connect(this.dry);
    }
    if (rev > 0) {
      const g = this.ctx.createGain();
      g.gain.value = rev;
      p.connect(g);
      g.connect(this.reverbSend);
    }
    if (del > 0) {
      const g = this.ctx.createGain();
      g.gain.value = del;
      p.connect(g);
      g.connect(this.delaySend);
    }
    return p;
  }

  // ---- Ordonnancement ----

  schedule() {
    if (!this.ctx) return;
    const ahead = document.hidden ? 1.4 : 0.18;
    while (this.nextStepTime < this.ctx.currentTime + ahead) {
      this.scheduleStep(this.step, this.nextStepTime);
      this.nextStepTime += STEP;
      this.step++;
    }
  }

  scheduleStep(step, t) {
    const stepInChord = step % STEPS_PER_CHORD;
    if (stepInChord === 0) {
      // Le mode ne change qu'aux frontières d'accord : pas de frottements.
      this.phase = phaseOfTime(this.timeProvider());
      const prog = PROGRESSIONS[this.phase] || PROGRESSIONS.day;
      this.chordDegree = prog[this.chordCount % prog.length];
      this.chordCount++;
      this.scheduleChordChange(t);
    }

    const plants = (this.plantsProvider() || []).filter(
      (p) => p.growth > 0.55 && p.dying === 0
    );
    if (plants.length === 0) {
      this.droneTo(0, t);
      return;
    }
    this.droneTo(0.05, t);

    const rng = mulberry32((step * 2654435761) >>> 0);
    const mode = this.currentMode;
    const melodicCap = Math.min(4, 2 + Math.floor(plants.length / 8));
    let melodic = 0;
    let percussive = 0;

    // Ordre stable mais tournant pour que chacun ait sa chance.
    const order = plants.slice().sort((a, b) => ((a.id + step) % 7) - ((b.id + step) % 7));

    for (const plant of order) {
      const g = plant.genome;
      const vol = smooth(plant.growth);
      const pan = plant.pan ?? 0;
      switch (plant.familyKey) {
        case 'campanule': {
          if (melodic >= melodicCap) break;
          const k = 1 + Math.round(g.rhythm * 2);
          const pat = euclidPattern(k, STEPS_PER_BAR);
          if (pat[(step + g.phase) % STEPS_PER_BAR] && rng() < 0.5 + g.rhythm * 0.3) {
            const tones = chordScaleIndices(this.chordDegree);
            const idx = tones[Math.floor(rng() * tones.length)] + (rng() < 0.22 ? 1 : 0);
            const oct = 2 + Math.round(g.register * 1.5);
            const midi = scaleMidi(mode, ROOT_MIDI, idx + oct * 7);
            this.bell(t, midiToFreq(midi), 0.14 * vol, pan, g.brightness);
            this.emitVisual(t, plant.id, 'note', { index: step % 8 });
            melodic++;
          }
          break;
        }
        case 'lampyre': {
          const busyUntil = this.arpBusy.get(plant.id) ?? -1;
          if (step <= busyUntil) break;
          if (stepInChord % STEPS_PER_BAR === (g.phase % 4) * 2 && rng() < 0.24 + g.rhythm * 0.25) {
            const n = 4 + Math.round(g.petals * 3);
            this.arpBusy.set(plant.id, step + Math.ceil(n / 2) + 2);
            const octBase = (1 + Math.round(g.register)) * 7;
            const ladder = [0, 2, 4, 6, 7, 9, 11, 13];
            for (let i = 0; i < n; i++) {
              const nt = t + i * (STEP / 2);
              const midi = scaleMidi(mode, ROOT_MIDI, this.chordDegree + ladder[i % ladder.length] + octBase + Math.floor(i / ladder.length) * 7);
              this.pluck(nt, midiToFreq(midi), 0.075 * vol, pan, g.brightness);
              this.emitVisual(nt, plant.id, 'arpstep', { index: i });
            }
          }
          break;
        }
        case 'tympan': {
          if (percussive >= 2) break;
          const k = 1 + Math.round(g.rhythm * 2);
          const pat = euclidPattern(k, STEPS_PER_BAR);
          if (pat[(step + g.phase) % STEPS_PER_BAR]) {
            const isThump = (step + g.phase) % STEPS_PER_BAR === 0 || rng() < 0.25;
            if (isThump) {
              this.thump(t, 0.17 * vol, pan);
              this.emitVisual(t, plant.id, 'thump', { index: Math.floor(step / 8) });
            } else {
              this.tick(t, 0.06 * vol, pan, g.brightness);
              this.emitVisual(t, plant.id, 'tick', { index: step });
            }
            percussive++;
          }
          break;
        }
        case 'ombelle': {
          if (melodic >= melodicCap) break;
          const nightBoost = this.phase === 'night' ? 1.6 : 1;
          if (rng() < (0.012 + g.rhythm * 0.03) * nightBoost) {
            const cluster = 1 + Math.floor(rng() * 2);
            for (let i = 0; i < cluster; i++) {
              const nt = t + i * STEP * 0.5;
              const idx = this.chordDegree + [0, 4, 2, 6][Math.floor(rng() * 4)] + 28 + Math.round(g.register * 7);
              const midi = scaleMidi(mode, ROOT_MIDI, idx);
              this.chime(nt, midiToFreq(midi), 0.05 * vol, pan);
              this.emitVisual(nt, plant.id, 'chime', { index: (step + i) % 9 });
            }
            melodic++;
          }
          break;
        }
        // Les roseaux (nappes) se déclenchent aux changements d'accord.
      }
    }

    // Gouttes mélodiques pendant la pluie.
    if (this.raining && rng() < 0.6) {
      const idx = Math.floor(rng() * 5) * 2 + 21;
      const midi = scaleMidi(mode, ROOT_MIDI, idx);
      this.drop(t + rng() * STEP, midiToFreq(midi), 0.045, rng() * 2 - 1);
    }
  }

  scheduleChordChange(t) {
    const plants = (this.plantsProvider() || []).filter(
      (p) => p.familyKey === 'roseau' && p.growth > 0.75 && p.dying === 0
    );
    const mode = this.currentMode;
    const tones = chordScaleIndices(this.chordDegree);
    const dur = STEPS_PER_CHORD * STEP;

    // Bourdon : glisse vers la fondamentale de l'accord.
    if (this.droneOsc1) {
      const rootMidi = scaleMidi(mode, ROOT_MIDI - 12, this.chordDegree);
      this.droneOsc1.frequency.setTargetAtTime(midiToFreq(rootMidi), t, 1.2);
      this.droneOsc2.frequency.setTargetAtTime(midiToFreq(rootMidi + 7), t, 1.5);
    }

    plants.slice(0, 6).forEach((plant, i) => {
      const g = plant.genome;
      const tone = tones[(plant.id + i) % tones.length];
      const oct = 1 + Math.round(g.register * 1.2);
      const midi = scaleMidi(mode, ROOT_MIDI, tone + oct * 7);
      this.pad(t, midiToFreq(midi), 0.05 * smooth(plant.growth), plant.pan ?? 0, dur, g.brightness);
      this.emitVisual(t + 0.3, plant.id, 'chord', {});
    });
  }

  droneTo(v, t) {
    this.droneGain.gain.setTargetAtTime(v, t, 2.5);
  }

  emitVisual(t, plantId, kind, data) {
    this.visualQueue.push({ t, plantId, kind, data });
    if (this.visualQueue.length > 400) this.visualQueue.splice(0, 100);
  }

  // Consomme les événements visuels arrivés à échéance.
  drainVisuals(fn) {
    if (!this.ctx) return;
    const now = this.ctx.currentTime + 0.02;
    // La file est presque triée : on balaie tout, coût négligeable.
    for (let i = this.visualQueue.length - 1; i >= 0; i--) {
      if (this.visualQueue[i].t <= now) {
        fn(this.visualQueue[i]);
        this.visualQueue.splice(i, 1);
      }
    }
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.waveArray);
    let sum = 0;
    for (let i = 0; i < this.waveArray.length; i += 4) {
      sum += this.waveArray[i] * this.waveArray[i];
    }
    const rms = Math.sqrt(sum / (this.waveArray.length / 4));
    this._level = this._level * 0.9 + rms * 0.1;
    return this._level;
  }

  waveform() {
    return this.waveArray;
  }

  // ---- Voix ----

  bell(t, freq, vel, pan, brightness) {
    const ctx = this.ctx;
    const carrier = ctx.createOscillator();
    carrier.type = 'sine';
    carrier.frequency.value = freq;
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * (2.4 + brightness * 1.4) + 1.3;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * (1 + brightness * 2.2), t);
    modGain.gain.exponentialRampToValueAtTime(0.5, t + 1.1);
    mod.connect(modGain);
    modGain.connect(carrier.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    carrier.connect(env);
    const out = this.route(env, pan, 1, 0.5, 0.3);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + 2.6);
    mod.stop(t + 2.6);
    carrier.onended = () => out.disconnect();
  }

  pad(t, freq, vel, pan, dur, brightness) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator();
    o1.type = 'sawtooth';
    o1.frequency.value = freq;
    o1.detune.value = -7;
    const o2 = ctx.createOscillator();
    o2.type = 'sawtooth';
    o2.frequency.value = freq;
    o2.detune.value = 7;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(300 + brightness * 300, t);
    filter.frequency.linearRampToValueAtTime(700 + brightness * 700, t + dur * 0.5);
    filter.frequency.linearRampToValueAtTime(320, t + dur + 2);
    filter.Q.value = 0.7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 2.4);
    env.gain.setValueAtTime(vel, t + Math.max(2.5, dur - 2.5));
    env.gain.linearRampToValueAtTime(0, t + dur + 3.2);
    o1.connect(filter);
    o2.connect(filter);
    filter.connect(env);
    const out = this.route(env, pan * 0.6, 0.8, 0.8, 0);
    o1.start(t);
    o2.start(t);
    o1.stop(t + dur + 3.4);
    o2.stop(t + dur + 3.4);
    o1.onended = () => out.disconnect();
  }

  pluck(t, freq, vel, pan, brightness) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = freq;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(1800 + brightness * 2600, t);
    filter.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.65);
    osc.connect(filter);
    filter.connect(env);
    const out = this.route(env, pan, 1, 0.35, 0.45);
    osc.start(t);
    osc.stop(t + 0.8);
    osc.onended = () => out.disconnect();
  }

  tick(t, vel, pan, brightness) {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.playbackRate.value = 1 + Math.random() * 0.2;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.value = 2800 + brightness * 2200;
    filter.Q.value = 7;
    const env = ctx.createGain();
    env.gain.setValueAtTime(vel, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
    src.connect(filter);
    filter.connect(env);
    const out = this.route(env, pan, 1, 0.15, 0.1);
    src.start(t, Math.random() * 1.5, 0.12);
    src.onended = () => out.disconnect();
  }

  thump(t, vel, pan) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(88, t);
    osc.frequency.exponentialRampToValueAtTime(45, t + 0.14);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(env);
    const out = this.route(env, pan * 0.4, 1, 0.12, 0);
    osc.start(t);
    osc.stop(t + 0.35);
    osc.onended = () => out.disconnect();
  }

  chime(t, freq, vel, pan) {
    const ctx = this.ctx;
    const o1 = ctx.createOscillator();
    o1.type = 'sine';
    o1.frequency.value = freq;
    const o2 = ctx.createOscillator();
    o2.type = 'sine';
    o2.frequency.value = freq * 2.01;
    const g2 = ctx.createGain();
    g2.gain.value = 0.3;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 3);
    o1.connect(env);
    o2.connect(g2);
    g2.connect(env);
    const out = this.route(env, pan, 0.8, 0.85, 0.5);
    o1.start(t);
    o2.start(t);
    o1.stop(t + 3.2);
    o2.stop(t + 3.2);
    o1.onended = () => out.disconnect();
  }

  drop(t, freq, vel, pan) {
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.4, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + 0.05);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(vel, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    osc.connect(env);
    const out = this.route(env, pan, 0.9, 0.5, 0.2);
    osc.start(t);
    osc.stop(t + 0.5);
    osc.onended = () => out.disconnect();
  }

  // ---- Sons ponctuels d'interaction ----

  cutSound(pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const mode = this.currentMode;
    // petit glissando descendant : la voix s'éteint
    [14, 11, 7].forEach((idx, i) => {
      const midi = scaleMidi(mode, ROOT_MIDI, this.chordDegree + idx);
      this.pluck(t + i * 0.09, midiToFreq(midi), 0.07, pan, 0.4);
    });
  }

  waterSound(pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) {
      const midi = scaleMidi(this.currentMode, ROOT_MIDI, 21 + i * 2 + Math.floor(Math.random() * 3));
      this.drop(t + i * 0.07 + Math.random() * 0.04, midiToFreq(midi), 0.05, pan);
    }
  }

  plantSound(pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const midi = scaleMidi(this.currentMode, ROOT_MIDI, this.chordDegree + 14);
    this.thump(t, 0.08, pan);
    this.bell(t + 0.05, midiToFreq(midi), 0.06, pan, 0.3);
  }

  collectSound(pan) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [0, 4, 7].forEach((idx, i) => {
      const midi = scaleMidi(this.currentMode, ROOT_MIDI, this.chordDegree + idx + 21);
      this.chime(t + i * 0.06, midiToFreq(midi), 0.04, pan);
    });
  }

  starSound() {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuffer;
    src.loop = true;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 3;
    filter.frequency.setValueAtTime(500, t);
    filter.frequency.exponentialRampToValueAtTime(5200, t + 1.8);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.035, t + 0.9);
    env.gain.linearRampToValueAtTime(0, t + 2.2);
    src.connect(filter);
    filter.connect(env);
    const out = this.route(env, (Math.random() - 0.5) * 1.4, 0.6, 0.9, 0.3);
    src.start(t);
    src.stop(t + 2.4);
    src.onended = () => out.disconnect();
  }

  // ---- Contrôles ----

  setRain(on) {
    this.raining = on;
    if (!this.ctx) return;
    this.rainGain.gain.setTargetAtTime(on ? 0.028 : 0, this.ctx.currentTime, on ? 1.5 : 2.5);
  }

  setWind(level) {
    this.windLevel = level;
    if (!this.ctx) return;
    this.windGain.gain.setTargetAtTime(0.004 + level * 0.03, this.ctx.currentTime, 0.6);
    this.windFilter.frequency.setTargetAtTime(360 + level * 500, this.ctx.currentTime, 0.5);
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setTargetAtTime(muted ? 0.0001 : 0.9, t, 0.2);
  }
}

function smooth(g) {
  const t = clamp((g - 0.5) / 0.45, 0, 1);
  return t * t * (3 - 2 * t);
}
