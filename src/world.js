// Chlorophonie — le monde.
// Ciel interpolé sur un cycle jour/nuit, collines de bruit fractal, étoiles,
// aurore qui dessine la forme d'onde réelle du jardin, météo, lucioles,
// pollinisateurs (ce sont eux qui croisent les génomes) et graines à cueillir.

import { makeNoise1D, mulberry32, clamp, lerp, smoothstep } from './prng.js';
import { phaseOfTime } from './music.js';

const DAY_LENGTH = 210; // secondes par journée de jardin

function hexRgb(hex) {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function mixRgb(a, b, t) {
  return [
    Math.round(lerp(a[0], b[0], t)),
    Math.round(lerp(a[1], b[1], t)),
    Math.round(lerp(a[2], b[2], t)),
  ];
}

function css(rgb, a = 1) {
  return a >= 1 ? `rgb(${rgb[0]},${rgb[1]},${rgb[2]})` : `rgba(${rgb[0]},${rgb[1]},${rgb[2]},${a})`;
}

// Étapes du ciel : heure -> couleurs (haut, milieu, horizon, 3 collines) + nuit.
const SKY_STOPS = [
  { t: 0.0, top: '#030510', mid: '#0A0F2B', hor: '#1A2150', h3: '#141B3E', h2: '#0C1229', h1: '#060917', night: 1 },
  { t: 0.045, top: '#0A0E28', mid: '#241D4E', hor: '#7A4A63', h3: '#241F4A', h2: '#151533', h1: '#0A0B1D', night: 0.75 },
  { t: 0.09, top: '#27356B', mid: '#7C5C86', hor: '#F2A97E', h3: '#55496E', h2: '#3A3556', h1: '#191830', night: 0.3 },
  { t: 0.16, top: '#4E7FB0', mid: '#93B8D4', hor: '#EAD9BE', h3: '#6E82A0', h2: '#55688A', h1: '#2C3550', night: 0.02 },
  { t: 0.3, top: '#5D93C4', mid: '#A9CBDD', hor: '#EFE3C8', h3: '#7C93AC', h2: '#5E7694', h1: '#33405C', night: 0 },
  { t: 0.42, top: '#3F6E9E', mid: '#C9A98E', hor: '#F2C185', h3: '#6E7590', h2: '#4E5876', h1: '#2A3050', night: 0.06 },
  { t: 0.5, top: '#2C2A55', mid: '#8A4E68', hor: '#F08C5F', h3: '#4A3A63', h2: '#33294E', h1: '#171632', night: 0.35 },
  { t: 0.56, top: '#171B3E', mid: '#3A2C5E', hor: '#A25577', h3: '#2C2450', h2: '#1D1A3C', h1: '#0D0E24', night: 0.68 },
  { t: 0.63, top: '#070A1E', mid: '#101736', hor: '#2A2E62', h3: '#191F44', h2: '#10142E', h1: '#080A1A', night: 0.96 },
  { t: 0.8, top: '#030510', mid: '#0A0F2B', hor: '#1A2150', h3: '#141B3E', h2: '#0C1229', h1: '#060917', night: 1 },
  { t: 1.0, top: '#030510', mid: '#0A0F2B', hor: '#1A2150', h3: '#141B3E', h2: '#0C1229', h1: '#060917', night: 1 },
];

const STOPS = SKY_STOPS.map((s) => ({
  t: s.t,
  night: s.night,
  top: hexRgb(s.top),
  mid: hexRgb(s.mid),
  hor: hexRgb(s.hor),
  h3: hexRgb(s.h3),
  h2: hexRgb(s.h2),
  h1: hexRgb(s.h1),
}));

// Sprites de halos : un dégradé radial par teinte, pré-rendu une fois.
export class GlowSprites {
  constructor() {
    this.cache = new Map();
  }

  get(hue) {
    const bucket = Math.round(((hue % 1) + 1) % 1 * 24) % 24;
    if (!this.cache.has(bucket)) {
      const size = 96;
      const c = document.createElement('canvas');
      c.width = size;
      c.height = size;
      const g = c.getContext('2d');
      const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
      const h = Math.round((bucket / 24) * 360);
      grad.addColorStop(0, `hsla(${h},95%,78%,0.9)`);
      grad.addColorStop(0.35, `hsla(${h},90%,64%,0.35)`);
      grad.addColorStop(1, `hsla(${h},90%,60%,0)`);
      g.fillStyle = grad;
      g.fillRect(0, 0, size, size);
      this.cache.set(bucket, c);
    }
    return this.cache.get(bucket);
  }

  glow(ctx, x, y, r, hue, alpha) {
    if (alpha <= 0.01 || r <= 0) return;
    const img = this.get(hue);
    const prevOp = ctx.globalCompositeOperation;
    const prevA = ctx.globalAlpha;
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.drawImage(img, x - r, y - r, r * 2, r * 2);
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevA;
  }
}

export class World {
  constructor() {
    this.time = 0.34; // fin d'après-midi doré : le crépuscule n'est pas loin
    this.day = 1;
    this.clock = 0;
    this.noise = makeNoise1D(4242);
    this.hillNoise = makeNoise1D(1337);
    this.sprites = new GlowSprites();
    this.stars = [];
    this.spores = [];
    this.rainDrops = [];
    this.fireflies = [];
    this.pollinators = [];
    this.floatingSeeds = [];
    this.shootingStars = [];
    this.rainT = 0;
    this.rainCooldown = 0;
    this.gust = 0;
    this.parallax = 0;
    this.reduced = false;
    this.onCross = null;
    this.onShootingStar = null;
    this.starTimer = 20;
    this.pollinatorTimer = 8;
    this.audioLevel = 0;
    this.wave = null;
  }

  resize(w, h) {
    this.w = w;
    this.h = h;
    const rng = mulberry32(99);
    this.stars = [];
    const nStars = Math.floor((w * h) / 9000);
    for (let i = 0; i < nStars; i++) {
      this.stars.push({
        x: rng() * w,
        y: rng() * h * 0.72,
        r: 0.5 + rng() * 1.1,
        tw: rng() * Math.PI * 2,
        speed: 0.5 + rng() * 1.5,
      });
    }
    // Crêtes des trois collines, échantillonnées puis mises en Path2D.
    this.ridges = [];
    const layers = [
      { base: 0.6, amp: 0.09, freq: 0.0016, seed: 10 },
      { base: 0.7, amp: 0.075, freq: 0.0022, seed: 20 },
      { base: 0.8, amp: 0.055, freq: 0.003, seed: 30 },
    ];
    layers.forEach((L, li) => {
      const pts = [];
      for (let x = -40; x <= w + 40; x += 8) {
        const y = h * L.base + this.hillNoise.fbm(x * L.freq + L.seed * 31.7, 3) * h * L.amp;
        pts.push({ x, y });
      }
      this.ridges.push(pts);
    });
    // Touffes d'herbe sur la crête avant.
    this.grass = [];
    const grng = mulberry32(555);
    for (let x = 0; x <= w; x += 9 + grng() * 6) {
      const gy = this.ridgeY(2, x);
      this.grass.push({
        x,
        y: gy + grng() * 4,
        h: 11 + grng() * 16,
        lean: (grng() - 0.5) * 0.7,
        phase: grng() * Math.PI * 2,
      });
    }
    this.makeSkySprites();
    const crng = mulberry32(7788);
    this.clouds = [];
    const nClouds = Math.max(3, Math.round(w / 420));
    for (let i = 0; i < nClouds; i++) {
      this.clouds.push({
        x: crng() * w,
        y: h * (0.06 + crng() * 0.26),
        v: 3 + crng() * 5,
        s: 0.7 + crng() * 0.9,
        variant: i % 3,
        a: 0.5 + crng() * 0.5,
      });
    }
  }

  ridgeY(layer, x) {
    const pts = this.ridges?.[layer];
    if (!pts) return this.h * 0.8;
    const i = clamp(Math.floor((x + 40) / 8), 0, pts.length - 2);
    const f = clamp((x + 40) / 8 - i, 0, 1);
    return lerp(pts[i].y, pts[i + 1].y, f);
  }

  makeSkySprites() {
    const mk = (draw, w2, h2) => {
      const c = document.createElement('canvas');
      c.width = w2;
      c.height = h2;
      draw(c.getContext('2d'));
      return c;
    };
    const rgba = (hex, a) => {
      const [r, g, b] = hexRgb(hex);
      return `rgba(${r},${g},${b},${a})`;
    };
    this.auroraSprites = ['#7fe8c8', '#96e89b', '#a49af0'].map((cHex) =>
      mk((g) => {
        const grad = g.createLinearGradient(0, 0, 0, 200);
        grad.addColorStop(0, rgba(cHex, 0));
        grad.addColorStop(0.22, rgba(cHex, 0.5));
        grad.addColorStop(0.55, rgba(cHex, 0.16));
        grad.addColorStop(1, rgba(cHex, 0));
        g.fillStyle = grad;
        g.fillRect(0, 0, 64, 200);
        // Fenêtre horizontale douce : les colonnes se fondent sans couture.
        const win = g.createLinearGradient(0, 0, 64, 0);
        win.addColorStop(0, 'rgba(0,0,0,0)');
        win.addColorStop(0.5, 'rgba(0,0,0,1)');
        win.addColorStop(1, 'rgba(0,0,0,0)');
        g.globalCompositeOperation = 'destination-in';
        g.fillStyle = win;
        g.fillRect(0, 0, 64, 200);
      }, 64, 200)
    );
    this.moonSprite = mk((g) => {
      g.fillStyle = '#e8edfa';
      g.beginPath();
      g.arc(48, 48, 26, 0, Math.PI * 2);
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.arc(37, 43, 24, 0, Math.PI * 2);
      g.fill();
    }, 96, 96);
    const puffRng = mulberry32(4471);
    this.cloudSprites = [0, 1, 2].map(() =>
      mk((g) => {
        for (let i = 0; i < 7; i++) {
          const px = 40 + puffRng() * 180;
          const py = 42 + puffRng() * 30;
          const pr = 22 + puffRng() * 30;
          const grad = g.createRadialGradient(px, py, 0, px, py, pr);
          grad.addColorStop(0, 'rgba(255,252,246,0.55)');
          grad.addColorStop(1, 'rgba(255,252,246,0)');
          g.fillStyle = grad;
          g.beginPath();
          g.arc(px, py, pr, 0, Math.PI * 2);
          g.fill();
        }
      }, 260, 110)
    );
  }

  groundY(x) {
    return this.ridgeY(2, x);
  }

  // Une position (x,y) est-elle de la terre à semer ?
  isSoil(x, y) {
    return y > this.groundY(x) - 4 && y < this.h - 6;
  }

  depthScale(y) {
    const gy = this.h * 0.8;
    return clamp(0.55 + ((y - gy) / (this.h - gy)) * 0.7, 0.5, 1.3);
  }

  windAt(x) {
    return (
      this.gust * 0.085 * this.noise.fbm(x * 0.0018 + this.clock * 0.22, 2) +
      0.014 * Math.sin(this.clock * 0.9 + x * 0.01)
    );
  }

  get nightness() {
    return this._night ?? 0;
  }

  get phase() {
    return phaseOfTime(this.time);
  }

  glowAlpha() {
    return clamp(this.nightness * 1.05 + (this.rainT > 0 ? 0.15 : 0), 0.1, 1);
  }

  palette() {
    const t = ((this.time % 1) + 1) % 1;
    let i = 0;
    while (i < STOPS.length - 2 && STOPS[i + 1].t < t) i++;
    const a = STOPS[i];
    const b = STOPS[i + 1];
    const f = smoothstep(0, 1, clamp((t - a.t) / (b.t - a.t || 1), 0, 1));
    return {
      top: mixRgb(a.top, b.top, f),
      mid: mixRgb(a.mid, b.mid, f),
      hor: mixRgb(a.hor, b.hor, f),
      h3: mixRgb(a.h3, b.h3, f),
      h2: mixRgb(a.h2, b.h2, f),
      h1: mixRgb(a.h1, b.h1, f),
      night: lerp(a.night, b.night, f),
    };
  }

  startRain() {
    if (this.rainCooldown > 0 || this.rainT > 0) return false;
    this.rainT = 22;
    this.rainCooldown = 50;
    return true;
  }

  get raining() {
    return this.rainT > 0;
  }

  // ---- Particules ----

  spawnSpore(x, y, hue) {
    if (this.spores.length > 110) return;
    this.spores.push({
      kind: 'spore',
      x,
      y,
      vx: (Math.random() - 0.5) * 6,
      vy: -12 - Math.random() * 14,
      hue,
      life: 1,
      decay: 0.14 + Math.random() * 0.1,
      size: 1.4 + Math.random() * 2,
    });
  }

  spawnBurst(x, y, hue, n = 14) {
    for (let i = 0; i < n; i++) {
      if (this.spores.length > 140) break;
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * 70;
      this.spores.push({
        kind: 'petal',
        x,
        y,
        vx: Math.cos(a) * v,
        vy: Math.sin(a) * v - 30,
        hue,
        life: 1,
        decay: 0.6 + Math.random() * 0.5,
        size: 2 + Math.random() * 2.5,
        spin: Math.random() * Math.PI * 2,
      });
    }
  }

  spawnSplash(x, y) {
    for (let i = 0; i < 6; i++) {
      if (this.spores.length > 140) break;
      this.spores.push({
        kind: 'droplet',
        x: x + (Math.random() - 0.5) * 10,
        y,
        vx: (Math.random() - 0.5) * 40,
        vy: -40 - Math.random() * 50,
        hue: 0.55,
        life: 1,
        decay: 1.6,
        size: 1.2 + Math.random(),
      });
    }
  }

  spawnSeed(x, y, genome) {
    if (this.floatingSeeds.length >= 4) this.floatingSeeds.shift();
    this.floatingSeeds.push({
      x,
      y,
      vy: 8,
      genome,
      hue: genome.hue,
      age: 0,
      landed: false,
      groundYTarget: this.groundY(x) + 6 + Math.random() * 20,
    });
  }

  pickSeedAt(px, py) {
    for (let i = this.floatingSeeds.length - 1; i >= 0; i--) {
      const s = this.floatingSeeds[i];
      const d = Math.hypot(s.x - px, s.y - py);
      if (d < 26) {
        this.floatingSeeds.splice(i, 1);
        return s;
      }
    }
    return null;
  }

  // ---- Mise à jour ----

  update(dt, plants, audioLevel, wave) {
    this.clock += dt;
    this.audioLevel = audioLevel;
    this.wave = wave;
    const prevTime = this.time;
    this.time = (this.time + dt / DAY_LENGTH) % 1;
    if (this.time < prevTime) this.day++;

    const pal = (this._pal = this.palette());
    this._night = pal.night;

    // Rafales de vent.
    this.gust = clamp(0.45 + this.noise.fbm(this.clock * 0.045, 2) * 0.8, 0.05, 1.2);

    // Nuages en dérive lente.
    if (this.clouds) {
      for (const c of this.clouds) {
        c.x += c.v * (0.4 + this.gust) * dt;
        if (c.x - 160 * c.s > this.w) c.x = -170 * c.s;
      }
    }

    // Pluie.
    if (this.rainT > 0) this.rainT -= dt;
    if (this.rainCooldown > 0) this.rainCooldown -= dt;
    this.updateRain(dt);
    this.updateSpores(dt);
    this.updateFireflies(dt, plants);
    this.updatePollinators(dt, plants);
    this.updateSeeds(dt);
    this.updateShootingStars(dt);
  }

  updateRain(dt) {
    const targetCount = this.rainT > 0 ? (this.reduced ? 50 : 130) : 0;
    while (this.rainDrops.length < targetCount) {
      this.rainDrops.push({
        x: Math.random() * (this.w + 100) - 50,
        y: -20 - Math.random() * this.h,
        v: 620 + Math.random() * 260,
      });
    }
    for (let i = this.rainDrops.length - 1; i >= 0; i--) {
      const d = this.rainDrops[i];
      d.y += d.v * dt;
      d.x += this.gust * 30 * dt;
      if (d.y > this.groundY(d.x) + 10) {
        if (this.rainT > 0 && Math.random() < 0.12) this.spawnSplash(d.x, this.groundY(d.x) + 8);
        if (this.rainT > 0) {
          d.y = -20;
          d.x = Math.random() * (this.w + 100) - 50;
        } else {
          this.rainDrops.splice(i, 1);
        }
      }
    }
  }

  updateSpores(dt) {
    for (let i = this.spores.length - 1; i >= 0; i--) {
      const s = this.spores[i];
      s.life -= s.decay * dt;
      if (s.life <= 0) {
        this.spores.splice(i, 1);
        continue;
      }
      if (s.kind === 'spore') {
        s.vx += this.windAt(s.x) * 90 * dt + (Math.random() - 0.5) * 8 * dt;
        s.vy -= 3 * dt;
      } else {
        s.vy += 130 * dt; // pétales et gouttes retombent
        if (s.spin != null) s.spin += dt * 4;
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
    }
  }

  updateFireflies(dt, plants) {
    const want = this.nightness > 0.55 && !this.reduced ? Math.min(6 + plants.length * 2, 26) : 0;
    while (this.fireflies.length < want) {
      this.fireflies.push({
        x: Math.random() * this.w,
        y: this.groundY(Math.random() * this.w) - 20 - Math.random() * 120,
        seed: Math.random() * 1000,
        blink: Math.random() * Math.PI * 2,
      });
    }
    if (want === 0 && this.fireflies.length > 0) {
      this.fireflies.splice(0, Math.max(1, Math.floor(this.fireflies.length * dt)));
    }
    for (const f of this.fireflies) {
      f.x += this.noise.fbm(f.seed + this.clock * 0.3, 2) * 34 * dt;
      f.y += this.noise.fbm(f.seed + 50 + this.clock * 0.35, 2) * 26 * dt;
      f.blink += dt * (1.2 + this.noise.at(f.seed) * 0.8);
      f.x = clamp(f.x, -10, this.w + 10);
      f.y = clamp(f.y, this.h * 0.35, this.h - 12);
    }
  }

  updatePollinators(dt, plants) {
    const mature = plants.filter((p) => p.isMature() && p.bloomPoints().length > 0);
    this.pollinatorTimer -= dt;
    const maxPol = Math.min(3, Math.floor(mature.length / 2));
    if (this.pollinatorTimer <= 0 && this.pollinators.length < maxPol && mature.length >= 2) {
      this.pollinatorTimer = 14 + Math.random() * 14;
      const fromLeft = Math.random() < 0.5;
      this.pollinators.push({
        x: fromLeft ? -20 : this.w + 20,
        y: this.h * (0.45 + Math.random() * 0.2),
        vx: 0,
        vy: 0,
        state: 'fly',
        target: null,
        visited: [],
        hover: 0,
        wing: Math.random() * Math.PI * 2,
        night: this.nightness > 0.5,
        hue: Math.random() < 0.5 ? 0.09 : 0.75,
        life: 60,
      });
    }

    for (let i = this.pollinators.length - 1; i >= 0; i--) {
      const b = this.pollinators[i];
      b.wing += dt * 21;
      b.life -= dt;
      if (b.state === 'fly') {
        if (!b.target || !b.target.plant.isMature() || b.target.plant.dying > 0) {
          const candidates = mature.filter((p) => !b.visited.includes(p.id));
          const pool = candidates.length ? candidates : mature;
          if (pool.length === 0 || b.life <= 0) {
            b.state = 'leave';
          } else {
            const plant = pool[Math.floor(Math.random() * pool.length)];
            const blooms = plant.bloomPoints();
            const bloom = blooms[Math.floor(Math.random() * blooms.length)];
            b.target = { plant, bloom };
          }
        }
        if (b.target) {
          const tx = b.target.bloom.x;
          const ty = b.target.bloom.y - 6;
          const dx = tx - b.x;
          const dy = ty - b.y;
          const dist = Math.hypot(dx, dy);
          const sp = 46 + 30 * Math.min(1, dist / 200);
          b.vx = lerp(b.vx, (dx / (dist + 1)) * sp, dt * 2.5);
          b.vy = lerp(b.vy, (dy / (dist + 1)) * sp + Math.sin(this.clock * 3 + b.wing) * 8, dt * 2.5);
          b.x += b.vx * dt;
          b.y += b.vy * dt;
          if (dist < 9) {
            b.state = 'hover';
            b.hover = 1.8 + Math.random();
          }
        }
      } else if (b.state === 'hover') {
        b.hover -= dt;
        b.x = b.target.bloom.x + Math.sin(this.clock * 5) * 3;
        b.y = b.target.bloom.y - 7 + Math.sin(this.clock * 8) * 2;
        if (b.hover <= 0) {
          const prev = b.visited[b.visited.length - 1];
          b.visited.push(b.target.plant.id);
          if (prev != null && prev !== b.target.plant.id && this.onCross) {
            const prevPlant = mature.find((p) => p.id === prev);
            if (prevPlant) this.onCross(prevPlant, b.target.plant, b.x, b.y);
          }
          b.target = null;
          b.state = b.visited.length >= 3 || b.life <= 0 ? 'leave' : 'fly';
        }
      } else {
        // leave
        const dir = b.x < this.w / 2 ? -1 : 1;
        b.vx = lerp(b.vx, dir * 70, dt);
        b.vy = lerp(b.vy, -26, dt);
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        if (b.x < -40 || b.x > this.w + 40 || b.y < -40) this.pollinators.splice(i, 1);
      }
    }
  }

  updateSeeds(dt) {
    for (const s of this.floatingSeeds) {
      s.age += dt;
      if (!s.landed) {
        s.y += s.vy * dt;
        s.x += this.windAt(s.x) * 40 * dt;
        s.vy = Math.min(26, s.vy + 8 * dt);
        if (s.y >= s.groundYTarget) {
          s.y = s.groundYTarget;
          s.landed = true;
        }
      }
    }
  }

  updateShootingStars(dt) {
    if (this.nightness > 0.85 && !this.reduced) {
      this.starTimer -= dt;
      if (this.starTimer <= 0) {
        this.starTimer = 26 + Math.random() * 36;
        const fromLeft = Math.random() < 0.5;
        this.shootingStars.push({
          x: fromLeft ? this.w * 0.1 + Math.random() * this.w * 0.3 : this.w * 0.6 + Math.random() * this.w * 0.3,
          y: this.h * (0.06 + Math.random() * 0.2),
          vx: (fromLeft ? 1 : -1) * (260 + Math.random() * 160),
          vy: 90 + Math.random() * 70,
          life: 1.6,
          trail: [],
        });
        if (this.onShootingStar) this.onShootingStar();
      }
    }
    for (let i = this.shootingStars.length - 1; i >= 0; i--) {
      const s = this.shootingStars[i];
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.trail.push({ x: s.x, y: s.y });
      if (s.trail.length > 24) s.trail.shift();
      if (s.life <= 0) this.shootingStars.splice(i, 1);
    }
  }

  // ---- Dessin ----

  drawBack(ctx) {
    const pal = this._pal || this.palette();
    const { w, h } = this;

    // Ciel.
    const grad = ctx.createLinearGradient(0, 0, 0, h * 0.85);
    grad.addColorStop(0, css(pal.top));
    grad.addColorStop(0.55, css(pal.mid));
    grad.addColorStop(1, css(pal.hor));
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    // Étoiles.
    const night = pal.night;
    if (night > 0.04) {
      ctx.save();
      for (const s of this.stars) {
        const tw = 0.55 + 0.45 * Math.sin(s.tw + this.clock * s.speed);
        ctx.globalAlpha = night * tw * 0.9;
        ctx.fillStyle = '#EAF0FF';
        ctx.fillRect(s.x, s.y, s.r, s.r);
      }
      ctx.restore();
    }

    // Aurore sonore : la forme d'onde du jardin ondule dans le ciel nocturne.
    if (night > 0.35 && this.wave) this.drawAurora(ctx, night);

    // Étoiles filantes.
    for (const s of this.shootingStars) {
      const a = clamp(s.life, 0, 1) * night;
      if (a <= 0.02 || s.trail.length < 2) continue;
      ctx.save();
      ctx.strokeStyle = `rgba(240,246,255,${a * 0.8})`;
      ctx.lineWidth = 1.6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(s.trail[0].x, s.trail[0].y);
      for (const p of s.trail) ctx.lineTo(p.x, p.y);
      ctx.stroke();
      this.sprites.glow(ctx, s.x, s.y, 22, 0.6, a * 0.8);
      ctx.restore();
    }

    // Soleil et lune.
    this.drawCelestials(ctx, pal);

    // Nuages.
    this.drawClouds(ctx, night);

    // Collines (parallaxe légère au pointeur).
    const px = this.parallax;
    const layerColors = [pal.h3, pal.h2, pal.h1];
    const layerShift = [px * 6, px * 14, px * 26];
    for (let li = 0; li < 3; li++) {
      const pts = this.ridges[li];
      ctx.fillStyle = css(layerColors[li]);
      ctx.beginPath();
      ctx.moveTo(pts[0].x + layerShift[li], pts[0].y);
      for (const p of pts) ctx.lineTo(p.x + layerShift[li], p.y);
      ctx.lineTo(w + 60, h + 10);
      ctx.lineTo(-60, h + 10);
      ctx.closePath();
      ctx.fill();
    }

    // Brume d'horizon entre les collines.
    const mist = ctx.createLinearGradient(0, h * 0.55, 0, h * 0.8);
    mist.addColorStop(0, css(pal.hor, 0));
    mist.addColorStop(0.7, css(pal.hor, 0.12));
    mist.addColorStop(1, css(pal.hor, 0));
    ctx.fillStyle = mist;
    ctx.fillRect(0, h * 0.5, w, h * 0.35);

    // Herbe sur la crête avant.
    ctx.strokeStyle = css(mixRgb(pal.h1, pal.hor, 0.22));
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    for (const g of this.grass) {
      const sway = this.windAt(g.x) * 26 + Math.sin(this.clock * 1.4 + g.phase) * 1.2;
      const tipX = g.x + g.lean * 4 + sway;
      const tipY = g.y - g.h;
      ctx.moveTo(g.x, g.y);
      ctx.quadraticCurveTo(g.x + g.lean * 2, g.y - g.h * 0.6, tipX, tipY);
    }
    ctx.stroke();
  }

  drawCelestials(ctx, pal) {
    const { w, h } = this;
    const t = this.time;
    // Soleil : visible d'environ 0.03 à 0.56.
    const su = (t - 0.03) / 0.53;
    if (su > 0 && su < 1) {
      const x = w * (0.12 + su * 0.76);
      const alt = Math.sin(su * Math.PI);
      const y = h * 0.62 - alt * h * 0.5;
      const r = 25;
      this.sprites.glow(ctx, x, y, r * (4 + (1 - alt) * 2.2), 0.09 + alt * 0.04, 0.5);
      const warm = mixRgb([255, 205, 145], [255, 243, 219], alt);
      ctx.fillStyle = css(warm, 0.96);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }
    // Lune : croissant pré-rendu, halo léger.
    const mu = (t - 0.57) / 0.46;
    if (mu > 0 && mu < 1 && this.moonSprite) {
      const x = w * (0.14 + mu * 0.72);
      const y = h * 0.58 - Math.sin(mu * Math.PI) * h * 0.44;
      this.sprites.glow(ctx, x + 7, y - 3, 70, 0.58, 0.28 * pal.night);
      ctx.drawImage(this.moonSprite, x - 48, y - 48);
    }
  }

  drawAurora(ctx, night) {
    const { w, h } = this;
    const wave = this.wave;
    const n = 96;
    const spacing = w / n;
    const baseY = h * 0.14;
    const amp = 26 + this.audioLevel * 520;
    const alpha = night * 0.36 * clamp(0.35 + this.audioLevel * 10, 0.35, 1);
    // La forme d'onde audio est lissée (3 passes) pour onduler sans zigzag.
    if (!this._auroraTops || this._auroraTops.length !== n + 1) {
      this._auroraTops = new Float32Array(n + 1);
    }
    const tops = this._auroraTops;
    for (let i = 0; i <= n; i++) {
      tops[i] = wave[Math.floor((i / n) * (wave.length - 1))];
    }
    for (let pass = 0; pass < 3; pass++) {
      let prev = tops[0];
      for (let i = 1; i < n; i++) {
        const cur = tops[i];
        tops[i] = (prev + cur * 2 + tops[i + 1]) / 4;
        prev = cur;
      }
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let band = 0; band < 2; band++) {
      const sprite = this.auroraSprites[band === 0 ? 0 : 2];
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const wob = this.noise.fbm(t * 1.7 + this.clock * 0.04 + band * 7.3, 2);
        const topY = baseY + band * 34 + wob * 40 + tops[i] * amp;
        const len = 140 + wob * 40 + this.audioLevel * 600;
        const wisp = Math.max(0, this.noise.fbm(t * 2.3 - this.clock * 0.025 + band * 3.1, 2) + 0.35);
        ctx.globalAlpha = Math.min(1, alpha * wisp);
        ctx.drawImage(sprite, i * spacing - spacing * 2.2, topY, spacing * 4.4, len);
      }
    }
    ctx.restore();
  }

  drawClouds(ctx, night) {
    if (!this.clouds) return;
    const day = 1 - night * 0.82;
    if (day <= 0.05) return;
    for (const c of this.clouds) {
      ctx.globalAlpha = 0.38 * day * c.a;
      const cw = 260 * c.s;
      const ch = 110 * c.s;
      ctx.drawImage(this.cloudSprites[c.variant], c.x - cw / 2 + this.parallax * 4, c.y - ch / 2, cw, ch);
    }
    ctx.globalAlpha = 1;
  }

  drawFront(ctx) {
    const pal = this._pal || this.palette();
    const night = pal.night;

    // Graines hybrides à cueillir.
    for (const s of this.floatingSeeds) {
      const bob = s.landed ? Math.sin(s.age * 2.2) * 2 : 0;
      const pulse = 0.55 + 0.45 * Math.sin(s.age * 3);
      this.sprites.glow(ctx, s.x, s.y + bob, 26 + pulse * 10, s.hue, 0.35 + pulse * 0.3);
      ctx.fillStyle = `hsl(${Math.round(s.hue * 360)},80%,75%)`;
      ctx.save();
      ctx.translate(s.x, s.y + bob);
      ctx.rotate(Math.sin(s.age * 1.3) * 0.3);
      ctx.beginPath();
      ctx.ellipse(0, 0, 3.2, 5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }

    // Spores, pétales, gouttes.
    for (const s of this.spores) {
      const a = clamp(s.life, 0, 1);
      if (s.kind === 'spore') {
        this.sprites.glow(ctx, s.x, s.y, s.size * 6, s.hue, a * 0.55);
        ctx.fillStyle = `hsla(${Math.round(s.hue * 360)},85%,80%,${a * 0.9})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size * 0.9, 0, Math.PI * 2);
        ctx.fill();
      } else if (s.kind === 'petal') {
        ctx.save();
        ctx.translate(s.x, s.y);
        ctx.rotate(s.spin ?? 0);
        ctx.fillStyle = `hsla(${Math.round(s.hue * 360)},70%,68%,${a * 0.85})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, s.size, s.size * 0.5, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      } else {
        ctx.fillStyle = `rgba(190,215,240,${a * 0.7})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, s.size, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    // Lucioles.
    for (const f of this.fireflies) {
      const blink = Math.max(0, Math.sin(f.blink)) ** 3;
      if (blink < 0.03) continue;
      this.sprites.glow(ctx, f.x, f.y, 9 + blink * 8, 0.16, blink * night * 0.7);
      ctx.fillStyle = `rgba(255,240,190,${blink * 0.9})`;
      ctx.beginPath();
      ctx.arc(f.x, f.y, 1.4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Pollinisateurs.
    for (const b of this.pollinators) {
      this.drawPollinator(ctx, b, night);
    }

    // Pluie.
    if (this.rainDrops.length > 0) {
      ctx.strokeStyle = `rgba(190,214,240,${this.rainT > 0 ? 0.34 : 0.2})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      for (const d of this.rainDrops) {
        ctx.moveTo(d.x, d.y);
        ctx.lineTo(d.x - this.gust * 3, d.y - 11);
      }
      ctx.stroke();
    }
  }

  drawPollinator(ctx, b, night) {
    const flap = Math.sin(b.wing);
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(clamp(b.vx * 0.004, -0.4, 0.4));
    const isNight = b.night;
    const bodyColor = isNight ? 'rgba(216,214,200,0.9)' : `hsla(${Math.round(b.hue * 360)},60%,60%,0.95)`;
    const wingColor = isNight ? 'rgba(228,226,206,0.75)' : `hsla(${Math.round(b.hue * 360)},70%,72%,0.8)`;
    if (isNight && night > 0.3) this.sprites.glow(ctx, 0, 0, 16, 0.14, 0.25);
    // Ailes.
    ctx.fillStyle = wingColor;
    const wy = flap * 4;
    ctx.beginPath();
    ctx.ellipse(-3.5, -1 + wy * 0.3, 4.6, 2.6 + Math.abs(flap) * 2.4, -0.6 - flap * 0.35, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(3.5, -1 + wy * 0.3, 4.6, 2.6 + Math.abs(flap) * 2.4, 0.6 + flap * 0.35, 0, Math.PI * 2);
    ctx.fill();
    // Corps.
    ctx.fillStyle = bodyColor;
    ctx.beginPath();
    ctx.ellipse(0, 0, 1.6, 4, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}
