// Chlorophonie — les plantes.
// Une plante est un squelette procédural (tiges segmentées, feuilles, organes
// musicaux) entièrement déterminé par son génome. Elle pousse, ondule au vent,
// et s'illumine quand sa voix joue.

import { mulberry32, rand, rint, clamp, lerp, smoothstep } from './prng.js';
import { FAMILIES } from './genome.js';

let NEXT_ID = 1;

export function resetPlantIds(next = 1) {
  NEXT_ID = next;
}

export function peekNextPlantId() {
  return NEXT_ID;
}

function hsl(h, s, l, a = 1) {
  return `hsla(${Math.round(h * 360)},${Math.round(s * 100)}%,${Math.round(l * 100)}%,${a})`;
}

export class Plant {
  constructor(genome, x, y, opts = {}) {
    this.id = opts.id ?? NEXT_ID++;
    if (opts.id != null) NEXT_ID = Math.max(NEXT_ID, opts.id + 1);
    this.genome = genome;
    this.x = x;
    this.y = y;
    this.scale = opts.scale ?? 1;
    this.growth = opts.growth ?? 0;
    this.moisture = 0; // arrosage : accélère la pousse
    this.age = 0;
    this.flash = 0; // éclat global quand la voix joue
    this.padGlow = 0; // halo lent des nappes
    this.swayPhase = Math.random() * Math.PI * 2;
    this.dying = 0; // > 0 : animation de coupe en cours
    this.buildStructure();
    this.update(0, { windAt: () => 0, growthScale: 1 });
  }

  get heightPx() {
    return (68 + this.genome.height * 150) * this.scale;
  }

  get familyKey() {
    return FAMILIES[this.genome.family].key;
  }

  // ---- Construction du squelette (déterministe via genome.seed) ----

  buildStructure() {
    const g = this.genome;
    const rng = mulberry32(g.seed);
    this.stems = [];
    this.blooms = []; // organes lumineux : cloches, plumets, perles, gousses, étoiles
    this.leaves = [];

    const build = {
      campanule: () => this.buildCampanule(rng),
      roseau: () => this.buildRoseau(rng),
      lampyre: () => this.buildLampyre(rng),
      tympan: () => this.buildTympan(rng),
      ombelle: () => this.buildOmbelle(rng),
    };
    build[this.familyKey]();

    // Couleurs dérivées du génome.
    const h = g.hue;
    this.bloomColor = hsl(h, 0.75, 0.62);
    this.bloomBright = hsl(h, 0.9, 0.8);
    this.glowHue = h;
    const sh = lerp(0.3, h, 0.25); // tiges : vert tirant vers la teinte
    const stemL = this.familyKey === 'lampyre' ? 0.34 : 0.27;
    this.stemColor = hsl(0.32 + (h - 0.5) * 0.1, 0.32, stemL);
    this.stemDark = hsl(0.32 + (h - 0.5) * 0.1, 0.35, 0.18);
    this.leafColor = hsl(0.34 + (sh - 0.34) * 0.4, 0.38, 0.33);
    this.plumeColor = hsl(h, 0.42, 0.72);
  }

  addStem(rng, { angle, len, segs, curve, width, growSpan }) {
    const stem = {
      baseAngle: angle,
      width,
      growSpan, // [début, fin] de croissance dans growth 0..1
      segs: [],
      nodes: [], // rempli par update()
    };
    for (let i = 0; i < segs; i++) {
      stem.segs.push({
        len: (len / segs) * rand(rng, 0.85, 1.15),
        dAng: curve * rand(rng, 0.6, 1.4) + rand(rng, -0.05, 0.05),
      });
    }
    this.stems.push(stem);
    return stem;
  }

  addBloom(stem, segT, kind, rng, extra = {}) {
    const bloom = {
      stem,
      segT, // position le long de la tige (0..1)
      kind,
      size: rand(rng, 0.8, 1.2),
      flash: 0,
      angle: rand(rng, -0.5, 0.5),
      x: 0,
      y: 0,
      ...extra,
    };
    this.blooms.push(bloom);
    return bloom;
  }

  addLeaves(stem, rng, count, sizeMul = 1) {
    for (let i = 0; i < count; i++) {
      this.leaves.push({
        stem,
        segT: rand(rng, 0.12, 0.7),
        side: rng() < 0.5 ? -1 : 1,
        size: rand(rng, 0.5, 1) * sizeMul,
        angle: rand(rng, 0.5, 1.1),
        x: 0,
        y: 0,
        dirX: 0,
        dirY: -1,
      });
    }
  }

  buildCampanule(rng) {
    const g = this.genome;
    const n = 1 + Math.round(g.spread * 2);
    for (let i = 0; i < n; i++) {
      const spreadA = (i - (n - 1) / 2) * rand(rng, 0.18, 0.3);
      const stem = this.addStem(rng, {
        angle: -Math.PI / 2 + spreadA,
        len: this.heightPx * rand(rng, 0.75, 1),
        segs: 7,
        curve: -spreadA * 0.12 + rand(rng, -0.03, 0.03),
        width: 2.6 * this.scale,
        growSpan: [0.05 + i * 0.08, 0.62 + i * 0.06],
      });
      // Crosse terminale : les dernières sections se recourbent.
      stem.segs[5].dAng += 0.5 * (spreadA >= 0 ? 1 : -1);
      stem.segs[6].dAng += 0.7 * (spreadA >= 0 ? 1 : -1);
      const bells = 1 + Math.round(g.petals * 2);
      for (let b = 0; b < bells; b++) {
        this.addBloom(stem, 0.76 + b * (0.22 / bells), 'bell', rng, {
          size: rand(rng, 0.85, 1.25) * (0.8 + g.petals * 0.5),
        });
      }
      this.addLeaves(stem, rng, 2, 0.9);
    }
  }

  buildRoseau(rng) {
    const g = this.genome;
    const n = 4 + Math.round(g.spread * 4);
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0 : i / (n - 1);
      const spreadA = (t - 0.5) * (0.5 + g.spread * 0.5);
      const isPlume = i % 2 === 0;
      const stem = this.addStem(rng, {
        angle: -Math.PI / 2 + spreadA * 0.7,
        len: this.heightPx * rand(rng, isPlume ? 0.85 : 0.55, isPlume ? 1.05 : 0.8),
        segs: 5,
        curve: spreadA * 0.09,
        width: 1.6 * this.scale,
        growSpan: [0.04 + t * 0.15, 0.6 + t * 0.15],
      });
      if (isPlume) {
        this.addBloom(stem, 1, 'plume', rng, {
          size: (0.9 + g.petals * 0.7) * rand(rng, 0.85, 1.15),
        });
      }
    }
  }

  buildLampyre(rng) {
    const g = this.genome;
    const stem = this.addStem(rng, {
      angle: -Math.PI / 2,
      len: this.heightPx,
      segs: 10,
      curve: 0,
      width: 2.3 * this.scale,
      growSpan: [0.05, 0.7],
    });
    // Hélice : la tige serpente.
    const amp = 0.35 + g.spread * 0.45;
    stem.segs.forEach((s, i) => {
      s.dAng = Math.sin(i * 1.25 + rand(rng, -0.2, 0.2)) * amp * 0.55;
    });
    const beads = 5 + Math.round(g.petals * 4);
    for (let b = 0; b < beads; b++) {
      this.addBloom(stem, 0.25 + (b / (beads - 1)) * 0.73, 'bead', rng, {
        order: b,
        size: rand(rng, 0.8, 1.15),
      });
    }
    this.addLeaves(stem, rng, 2, 0.7);
  }

  buildTympan(rng) {
    const g = this.genome;
    // Rosette de feuilles larges.
    const rosette = this.addStem(rng, {
      angle: -Math.PI / 2,
      len: this.heightPx * 0.22,
      segs: 2,
      curve: 0,
      width: 2.8 * this.scale,
      growSpan: [0.05, 0.3],
    });
    this.addLeaves(rosette, rng, 4, 1.6);
    const pods = 2 + Math.round(g.petals * 2);
    for (let i = 0; i < pods; i++) {
      const spreadA = (i - (pods - 1) / 2) * 0.42;
      const stem = this.addStem(rng, {
        angle: -Math.PI / 2 + spreadA,
        len: this.heightPx * rand(rng, 0.4, 0.62),
        segs: 4,
        curve: spreadA * 0.12,
        width: 2.2 * this.scale,
        growSpan: [0.2 + i * 0.1, 0.65 + i * 0.08],
      });
      this.addBloom(stem, 1, 'pod', rng, {
        podIndex: i,
        big: i === Math.floor(pods / 2),
        size: rand(rng, 0.85, 1.2),
      });
    }
  }

  buildOmbelle(rng) {
    const g = this.genome;
    const stem = this.addStem(rng, {
      angle: -Math.PI / 2,
      len: this.heightPx * 0.92,
      segs: 6,
      curve: rand(rng, -0.02, 0.02),
      width: 2.6 * this.scale,
      growSpan: [0.05, 0.55],
    });
    const rays = 4 + Math.round(g.petals * 4);
    for (let r = 0; r < rays; r++) {
      const a = -Math.PI / 2 + (r - (rays - 1) / 2) * (1.75 / rays) * (1 + g.spread);
      const ray = this.addStem(rng, {
        angle: a,
        len: this.heightPx * (0.2 + g.spread * 0.16) * rand(rng, 0.85, 1.15),
        segs: 3,
        curve: 0,
        width: 1.4 * this.scale,
        growSpan: [0.6, 0.85],
        });
      ray.parent = stem; // les rayons partent du sommet de la tige
      this.addBloom(ray, 1, 'star', rng, { rayIndex: r, size: rand(rng, 0.8, 1.2) });
    }
    this.addLeaves(stem, rng, 2, 1.1);
  }

  // ---- Mise à jour : positions mondiales, croissance, éclats ----

  update(dt, env) {
    const g = this.genome;
    this.age += dt;

    if (this.dying > 0) {
      this.dying = Math.min(1, this.dying + dt * 2.2);
    } else if (this.growth < 1) {
      const mBoost = this.moisture > 0 ? 3 : 1;
      const rainBoost = env.raining ? 2.2 : 1;
      this.growth = Math.min(1, this.growth + (dt / 78) * mBoost * rainBoost * (env.growthScale ?? 1));
    }
    this.moisture = Math.max(0, this.moisture - dt);
    this.flash = Math.max(0, this.flash - dt * 2.4);
    this.padGlow = Math.max(0, this.padGlow - dt * 0.35);

    const wind = env.windAt(this.x) + Math.sin(this.age * 1.7 + this.swayPhase) * 0.012;
    const shrink = this.dying > 0 ? 1 - smoothstep(0, 1, this.dying) : 1;

    let minX = this.x, maxX = this.x, minY = this.y, maxY = this.y;

    for (const stem of this.stems) {
      const [g0, g1] = stem.growSpan;
      stem.growT = smoothstep(g0, g1, this.growth) * shrink;
      let px = this.x;
      let py = this.y;
      let ang = stem.baseAngle;
      if (stem.parent) {
        const pn = stem.parent.nodes;
        const tip = pn[pn.length - 1];
        px = tip.x;
        py = tip.y;
      }
      stem.nodes.length = 0;
      stem.nodes.push({ x: px, y: py, ang });
      const nSegs = stem.segs.length;
      const visible = stem.growT * nSegs;
      for (let i = 0; i < nSegs; i++) {
        const s = stem.segs[i];
        const bendFactor = Math.pow((i + 1) / nSegs, 1.4);
        ang += s.dAng + wind * bendFactor * (stem.parent ? 0.4 : 1);
        const segGrow = clamp(visible - i, 0, 1);
        const L = s.len * segGrow;
        px += Math.cos(ang) * L;
        py += Math.sin(ang) * L;
        stem.nodes.push({ x: px, y: py, ang });
        if (segGrow <= 0) break;
      }
      if (px < minX) minX = px;
      if (px > maxX) maxX = px;
      if (py < minY) minY = py;
    }

    // Positions des organes et feuilles le long des tiges.
    for (const bloom of this.blooms) {
      const nodes = bloom.stem.nodes;
      const pos = this.pointAlong(nodes, bloom.segT, bloom.stem.segs.length);
      bloom.x = pos.x;
      bloom.y = pos.y;
      bloom.ang = pos.ang;
      bloom.visible = bloom.stem.growT > bloom.segT * 0.92;
      bloom.open = smoothstep(0.72, 0.95, this.growth) * shrink;
      bloom.flash = Math.max(0, bloom.flash - dt * (bloom.kind === 'plume' ? 0.5 : 2.8));
      const r = bloom.size * 9 * this.scale;
      if (bloom.x - r < minX) minX = bloom.x - r;
      if (bloom.x + r > maxX) maxX = bloom.x + r;
      if (bloom.y - r < minY) minY = bloom.y - r;
    }
    for (const leaf of this.leaves) {
      const nodes = leaf.stem.nodes;
      const pos = this.pointAlong(nodes, leaf.segT, leaf.stem.segs.length);
      leaf.x = pos.x;
      leaf.y = pos.y;
      leaf.baseAng = pos.ang + leaf.side * leaf.angle;
      leaf.grow = smoothstep(leaf.segT, leaf.segT + 0.25, this.growth) * shrink;
    }

    const pad = 14 * this.scale;
    this.bounds = { minX: minX - pad, maxX: maxX + pad, minY: minY - pad, maxY: this.y + 6 };
  }

  pointAlong(nodes, t, nSegs) {
    if (nodes.length < 2) return { x: this.x, y: this.y, ang: -Math.PI / 2 };
    const ft = t * nSegs;
    const i = Math.min(nodes.length - 2, Math.floor(ft));
    const f = clamp(ft - i, 0, 1);
    const a = nodes[i];
    const b = nodes[i + 1];
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), ang: b.ang };
  }

  containsPoint(px, py) {
    const b = this.bounds;
    return px >= b.minX && px <= b.maxX && py >= b.minY && py <= b.maxY;
  }

  // Points butinables pour les pollinisateurs.
  bloomPoints() {
    return this.blooms.filter((b) => b.visible && b.open > 0.6);
  }

  isMature() {
    return this.growth >= 0.9 && this.dying === 0;
  }

  // ---- Impulsions visuelles quand la voix joue ----

  pulse(kind, data = {}) {
    this.flash = Math.min(1, this.flash + 0.7);
    if (kind === 'chord') {
      this.padGlow = 1;
      let firstPlume = null;
      for (const b of this.blooms) {
        if (b.kind === 'plume') {
          b.flash = 1;
          if (!firstPlume) firstPlume = b;
        }
      }
      return firstPlume;
    } else if (kind === 'arpstep') {
      const beads = this.blooms.filter((b) => b.kind === 'bead');
      const bead = beads[data.index % Math.max(1, beads.length)];
      if (bead) { bead.flash = 1; return bead; }
    } else if (kind === 'tick' || kind === 'thump') {
      const pods = this.blooms.filter((b) => b.kind === 'pod');
      const match = pods.filter((p) => (kind === 'thump') === !!p.big);
      const pod = match[data.index % Math.max(1, match.length)] || pods[0];
      if (pod) { pod.flash = 1; return pod; }
    } else if (kind === 'chime') {
      const stars = this.blooms.filter((b) => b.kind === 'star');
      const star = stars[data.index % Math.max(1, stars.length)];
      if (star) { star.flash = 1; return star; }
    } else {
      // note (cloche) : la cloche suivante sonne
      const bells = this.blooms.filter((b) => b.kind === 'bell');
      const bell = bells[data.index % Math.max(1, bells.length)];
      if (bell) { bell.flash = 1; return bell; }
    }
    return null;
  }

  // ---- Dessin ----

  draw(ctx, env) {
    if (this.growth <= 0.001 && this.dying === 0) return;
    const glowA = env.glowAlpha; // 0 le jour, 1 la nuit
    const fadeOut = this.dying > 0 ? 1 - this.dying : 1;
    ctx.globalAlpha = fadeOut;

    // Ombre d'assise au pied de la plante.
    ctx.fillStyle = 'rgba(4,6,14,0.26)';
    ctx.beginPath();
    ctx.ellipse(this.x, this.y + 2, this.heightPx * 0.16, 3.2 * this.scale, 0, 0, Math.PI * 2);
    ctx.fill();

    // Tiges
    ctx.lineCap = 'round';
    for (const stem of this.stems) {
      if (stem.nodes.length < 2 || stem.growT <= 0.01) continue;
      ctx.strokeStyle = this.stemColor;
      ctx.lineWidth = Math.max(0.75, stem.width * (0.6 + 0.4 * stem.growT));
      ctx.beginPath();
      ctx.moveTo(stem.nodes[0].x, stem.nodes[0].y);
      for (let i = 1; i < stem.nodes.length; i++) {
        const prev = stem.nodes[i - 1];
        const n = stem.nodes[i];
        ctx.quadraticCurveTo(prev.x, prev.y, (prev.x + n.x) / 2, (prev.y + n.y) / 2);
      }
      const last = stem.nodes[stem.nodes.length - 1];
      ctx.lineTo(last.x, last.y);
      ctx.stroke();
    }

    // Feuilles
    for (const leaf of this.leaves) {
      if (leaf.grow <= 0.02) continue;
      const L = leaf.size * 15 * this.scale * leaf.grow;
      const a = leaf.baseAng;
      ctx.fillStyle = this.leafColor;
      ctx.beginPath();
      const tipX = leaf.x + Math.cos(a) * L;
      const tipY = leaf.y + Math.sin(a) * L;
      const nx = Math.cos(a + Math.PI / 2) * L * 0.3;
      const ny = Math.sin(a + Math.PI / 2) * L * 0.3;
      ctx.moveTo(leaf.x, leaf.y);
      ctx.quadraticCurveTo(leaf.x + nx + (tipX - leaf.x) * 0.4, leaf.y + ny + (tipY - leaf.y) * 0.4, tipX, tipY);
      ctx.quadraticCurveTo(leaf.x - nx + (tipX - leaf.x) * 0.4, leaf.y - ny + (tipY - leaf.y) * 0.4, leaf.x, leaf.y);
      ctx.fill();
    }

    // Organes lumineux
    for (const bloom of this.blooms) {
      if (!bloom.visible || bloom.open <= 0.02) continue;
      this.drawBloom(ctx, bloom, env);
    }

    // Halo global quand la plante joue (surtout la nuit)
    const halo = Math.max(this.flash * 0.5, this.padGlow * 0.6);
    if (halo > 0.02 && glowA > 0.05 && env.sprites) {
      const top = this.stems[0]?.nodes[this.stems[0].nodes.length - 1];
      if (top) {
        env.sprites.glow(ctx, top.x, top.y - 6 * this.scale, this.heightPx * 0.85, this.glowHue, halo * glowA * 0.5);
      }
    }
    ctx.globalAlpha = 1;
  }

  drawBloom(ctx, bloom, env) {
    const s = this.scale * bloom.open;
    const glowA = env.glowAlpha;
    const fl = bloom.flash;
    const baseGlow = 0.16 + this.padGlow * 0.3;
    const color = fl > 0.25 ? this.bloomBright : this.bloomColor;

    switch (bloom.kind) {
      case 'bell': {
        const r = (6.5 + bloom.size * 5.5) * s * (1 + fl * 0.18);
        const bx = bloom.x;
        const by = bloom.y + r * 0.95;
        if (env.sprites && glowA > 0.03) {
          env.sprites.glow(ctx, bx, by, r * (3.6 + fl * 4.5), this.glowHue, (baseGlow + fl * 0.85) * glowA);
        }
        // Pédicelle.
        ctx.strokeStyle = this.stemColor;
        ctx.lineWidth = 1.1 * this.scale;
        ctx.beginPath();
        ctx.moveTo(bloom.x, bloom.y - 1);
        ctx.quadraticCurveTo(bx, by - r * 1.7, bx, by - r * 1.05);
        ctx.stroke();
        // Corolle en cloche, lèvre évasée.
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(bx, by - r * 1.15);
        ctx.bezierCurveTo(bx + r * 0.78, by - r * 0.95, bx + r * 0.82, by + r * 0.15, bx + r * 0.55, by + r * 0.62);
        ctx.quadraticCurveTo(bx, by + r * 0.3, bx - r * 0.55, by + r * 0.62);
        ctx.bezierCurveTo(bx - r * 0.82, by + r * 0.15, bx - r * 0.78, by - r * 0.95, bx, by - r * 1.15);
        ctx.fill();
        // Battant, visible la nuit et quand la cloche sonne.
        const clap = Math.max(fl, glowA * 0.3);
        if (clap > 0.05) {
          ctx.fillStyle = `rgba(255,251,232,${clap * 0.85})`;
          ctx.beginPath();
          ctx.arc(bx, by + r * 0.6, r * 0.2 * (1 + fl * 0.8), 0, Math.PI * 2);
          ctx.fill();
        }
        break;
      }
      case 'plume': {
        const r = (11 + bloom.size * 9) * s;
        const glow = baseGlow + bloom.flash * 0.5;
        if (env.sprites && glowA > 0.03) {
          env.sprites.glow(ctx, bloom.x, bloom.y - r * 0.5, r * 3.2, this.glowHue, glow * glowA * 0.85);
        }
        ctx.fillStyle = fl > 0.3 ? this.bloomBright : this.plumeColor;
        const prevA = ctx.globalAlpha;
        for (let i = 0; i < 4; i++) {
          const py = bloom.y - i * r * 0.34;
          const rx = r * 0.3 * (1 - i * 0.16);
          const ry = r * 0.42;
          ctx.globalAlpha = prevA * (0.32 + 0.11 * i);
          ctx.beginPath();
          ctx.ellipse(bloom.x, py, rx, ry, 0, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalAlpha = prevA;
        break;
      }
      case 'bead': {
        const r = (3 + bloom.size * 2.9) * s * (1 + fl * 0.9);
        if (env.sprites && (glowA > 0.03 || fl > 0.2)) {
          env.sprites.glow(ctx, bloom.x, bloom.y, r * (5 + fl * 5), this.glowHue, (0.1 + fl * 0.8) * Math.max(glowA, fl * 0.55));
        }
        ctx.fillStyle = fl > 0.15 ? '#fffbe8' : color;
        ctx.beginPath();
        ctx.arc(bloom.x, bloom.y, r, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
      case 'pod': {
        const base = bloom.big ? 10 : 6.5;
        const squash = 1 + fl * 0.45;
        const rx = base * bloom.size * s * squash;
        const ry = base * bloom.size * s * (2 - squash);
        if (env.sprites && glowA > 0.03) {
          env.sprites.glow(ctx, bloom.x, bloom.y, rx * 3, this.glowHue, (0.1 + fl * 0.7) * glowA);
        }
        ctx.fillStyle = fl > 0.2 ? this.bloomBright : color;
        ctx.beginPath();
        ctx.ellipse(bloom.x, bloom.y, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = this.stemDark;
        ctx.lineWidth = 1 * this.scale;
        ctx.beginPath();
        ctx.moveTo(bloom.x, bloom.y - ry * 0.85);
        ctx.lineTo(bloom.x, bloom.y + ry * 0.85);
        ctx.stroke();
        break;
      }
      case 'star': {
        const r = (3.8 + bloom.size * 3.4) * s * (1 + fl * 0.8);
        if (env.sprites && (glowA > 0.03 || fl > 0.2)) {
          env.sprites.glow(ctx, bloom.x, bloom.y, r * (4.5 + fl * 6), this.glowHue, (0.14 + fl * 0.9) * Math.max(glowA, fl * 0.6));
        }
        ctx.strokeStyle = fl > 0.15 ? '#fffbe8' : color;
        ctx.lineWidth = 1.1 * this.scale;
        ctx.beginPath();
        for (let i = 0; i < 5; i++) {
          const a = bloom.angle + (i / 5) * Math.PI * 2;
          ctx.moveTo(bloom.x, bloom.y);
          ctx.lineTo(bloom.x + Math.cos(a) * r, bloom.y + Math.sin(a) * r);
        }
        ctx.stroke();
        ctx.fillStyle = fl > 0.15 ? '#fffbe8' : color;
        ctx.beginPath();
        ctx.arc(bloom.x, bloom.y, r * 0.3, 0, Math.PI * 2);
        ctx.fill();
        break;
      }
    }
  }
}
