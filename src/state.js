// Chlorophonie — mémoire du jardin.
// Sauvegarde locale (localStorage) et lien de partage : l'état complet est
// compacté en entiers puis encodé en base64url dans l'URL. Aucun serveur.

import { genomeToArray, genomeFromArray } from './genome.js';

const STORE_KEY = 'chlorophonie.v1';

export function packState(data) {
  return {
    v: 1,
    d: data.day,
    t: Math.round(data.time * 1000),
    p: data.plants.map((p) => [
      Math.round(p.x01 * 1000),
      Math.round(p.depth01 * 1000),
      Math.round(p.growth * 100),
      ...genomeToArray(p.genome),
    ]),
    s: data.seeds.map((g) => genomeToArray(g)),
    h: data.discovered.map((e) => ({ k: e.key, g: genomeToArray(e.genome), d: e.day })),
  };
}

export function unpackState(raw) {
  if (!raw || raw.v !== 1) return null;
  return {
    day: Math.max(1, raw.d ?? 1),
    time: ((raw.t ?? 340) / 1000) % 1,
    plants: (raw.p ?? []).slice(0, 80).map((row) => ({
      x01: row[0] / 1000,
      depth01: row[1] / 1000,
      growth: Math.min(1, row[2] / 100),
      genome: genomeFromArray(row.slice(3)),
    })),
    seeds: (raw.s ?? []).slice(0, 8).map(genomeFromArray),
    discovered: (raw.h ?? []).slice(0, 220).map((e) => ({
      key: e.k,
      genome: genomeFromArray(e.g),
      day: e.d ?? 1,
    })),
  };
}

export function saveLocal(data) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(packState(data)));
  } catch {
    /* stockage indisponible : le jardin vit sa journée sans mémoire */
  }
}

export function loadLocal() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? unpackState(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

export function clearLocal() {
  try {
    localStorage.removeItem(STORE_KEY);
  } catch {
    /* rien à effacer */
  }
}

export function encodeShare(data) {
  const json = JSON.stringify(packState(data));
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

export function decodeShare(str) {
  try {
    const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
    const pad = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    const bin = atob(pad);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return unpackState(JSON.parse(new TextDecoder().decode(bytes)));
  } catch {
    return null;
  }
}
