// Chlorophonie — l'interface.
// Un cabinet de curiosités : barre d'outils en capsule, herbier à planches
// botaniques, infobulles de loupe, toasts de découverte. Tout est DOM (et non
// canvas) pour rester accessible au clavier et aux lecteurs d'écran.

import { speciesInfo } from './genome.js';
import { Plant } from './plant.js';
import { PHASE_LABELS, MODES } from './music.js';

const ICONS = {
  water:
    '<path d="M6 11h9v6.5a1.5 1.5 0 0 1-1.5 1.5h-6A1.5 1.5 0 0 1 6 17.5Z"/><path d="M15 13.5 20 9.5"/><path d="M8.5 11V9.5a3 3 0 0 1 4.6-2.54"/><path d="M19 13.5v.01M17.6 16v.01M20.2 16.4v.01"/>',
  cut: '<path d="M7 5c2.6 4 5.4 6.8 11 11"/><path d="M17 5c-2.6 4-5.4 6.8-11 11"/><circle cx="5.2" cy="17.6" r="1.7"/><circle cx="18.8" cy="17.6" r="1.7"/>',
  rain: '<path d="M7 14a4 4 0 1 1 .6-7.96A5 5 0 0 1 17.5 8.5 3.2 3.2 0 0 1 17 14Z"/><path d="M8.6 16.5l-1 2.4M12.6 16.5l-1 2.4M16.6 16.5l-1 2.4"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15.5H6.5A2.5 2.5 0 0 0 4 21Z"/><path d="M4 5.5V21"/><path d="M12.2 7.2c1.9-.1 3.3 1.2 3.3 3.4-2.1.3-3.7-.7-3.3-3.4Z"/><path d="M12.2 7.2c-.4 2.3.5 3.7 3.2 3.5"/>',
  share:
    '<path d="M12 14V4"/><path d="m8.5 7.5 3.5-3.5 3.5 3.5"/><path d="M6 11v7.5A1.5 1.5 0 0 0 7.5 20h9a1.5 1.5 0 0 0 1.5-1.5V11"/>',
  sound: '<path d="M9 17.5V6l9-2v11.5"/><circle cx="6.8" cy="17.5" r="2.2"/><circle cx="15.8" cy="15.5" r="2.2"/>',
  soundOff:
    '<path d="M9 17.5V6l9-2v11.5"/><circle cx="6.8" cy="17.5" r="2.2"/><circle cx="15.8" cy="15.5" r="2.2"/><path d="M4 3.5 20.5 21"/>',
  help: '<path d="M9.4 9a2.6 2.6 0 1 1 3.8 2.4c-.9.5-1.2 1-1.2 2v.3"/><path d="M12 17.2v.01"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;
}

function seedGlyph(hue, hybrid) {
  const h = Math.round(hue * 360);
  const fill = `hsl(${h},68%,${hybrid ? 70 : 60}%)`;
  return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 7.2C12 4.8 13.6 3.4 15.4 3" fill="none" stroke="hsl(${h},40%,72%)" stroke-width="1.4" stroke-linecap="round"/><ellipse cx="12" cy="14" rx="4.6" ry="6.4" fill="${fill}"/><ellipse cx="10.6" cy="12" rx="1.3" ry="2.4" fill="rgba(255,255,255,0.35)"/></svg>`;
}

export class UI {
  constructor(cb) {
    this.cb = cb; // { onSelectSlot, onEnter, onShare, onToggleMute, onReset }
    this.$ = (id) => document.getElementById(id);
    this.toolbar = this.$('toolbar');
    this.tooltip = this.$('tooltip');
    this.toasts = this.$('toasts');
    this.herbier = this.$('herbier');
    this.help = this.$('help');
    this.onboarding = this.$('onboarding');
    this.clock = this.$('clock');
    this.seenToasts = new Set();

    this.$('btn-herbier').addEventListener('click', () => this.toggleHerbier());
    this.$('btn-herbier-close').addEventListener('click', () => this.toggleHerbier(false));
    this.$('btn-share').addEventListener('click', () => cb.onShare());
    this.$('btn-sound').addEventListener('click', () => cb.onToggleMute());
    this.$('btn-help').addEventListener('click', () => this.toggleHelp());
    this.$('btn-help-close').addEventListener('click', () => this.toggleHelp(false));
    this.$('btn-enter').addEventListener('click', () => cb.onEnter());
    const resetBtn = this.$('btn-reset');
    resetBtn.addEventListener('click', () => {
      if (resetBtn.dataset.armed === '1') {
        cb.onReset();
      } else {
        resetBtn.dataset.armed = '1';
        resetBtn.textContent = 'Sûr·e ? Cliquer à nouveau pour tout effacer';
        setTimeout(() => {
          resetBtn.dataset.armed = '';
          resetBtn.textContent = 'Recommencer un jardin vierge';
        }, 4000);
      }
    });

    // Icônes des actions du haut.
    this.$('btn-herbier').innerHTML = icon('book') + '<span>Herbier</span>';
    this.$('btn-share').innerHTML = icon('share') + '<span>Partager</span>';
    this.$('btn-sound').innerHTML = icon('sound');
    this.$('btn-help').innerHTML = icon('help');
    this.$('btn-herbier-close').innerHTML = icon('close');
    this.$('btn-help-close').innerHTML = icon('close');
  }

  // ---- Barre d'outils ----

  setSlots(slots) {
    this.toolbar.innerHTML = '';
    let lastKind = null;
    for (const slot of slots) {
      if (lastKind && lastKind !== 'tool' && slot.kind === 'tool') {
        const sep = document.createElement('span');
        sep.className = 'sep';
        sep.setAttribute('aria-hidden', 'true');
        this.toolbar.appendChild(sep);
      }
      lastKind = slot.kind;
      const btn = document.createElement('button');
      btn.className = `slot ${slot.kind}${slot.selected ? ' selected' : ''}`;
      btn.dataset.id = slot.id;
      btn.type = 'button';
      btn.title = slot.title;
      btn.setAttribute('aria-label', slot.title);
      btn.setAttribute('aria-pressed', slot.selected ? 'true' : 'false');
      if (slot.disabled) btn.setAttribute('aria-disabled', 'true');
      btn.innerHTML =
        (slot.kind === 'tool' ? icon(slot.icon) : seedGlyph(slot.hue, slot.kind === 'hybrid')) +
        (slot.keyLabel ? `<kbd>${slot.keyLabel}</kbd>` : '');
      if (slot.id === 'tool-rain') this.rainBtn = btn;
      btn.addEventListener('click', () => this.cb.onSelectSlot(slot.id));
      this.toolbar.appendChild(btn);
    }
  }

  setRainCooldown(frac) {
    if (this.rainBtn) {
      this.rainBtn.style.setProperty('--cd', String(frac));
      this.rainBtn.classList.toggle('cooling', frac > 0.001);
    }
  }

  // ---- Horloge ----

  updateClock({ day, phase }) {
    const mode = MODES[phase];
    this.clock.textContent = `Jour ${day} — ${PHASE_LABELS[phase]} · mode ${mode.label.toLowerCase()}`;
  }

  setMuted(muted) {
    this.$('btn-sound').innerHTML = icon(muted ? 'soundOff' : 'sound');
    this.$('btn-sound').setAttribute('aria-label', muted ? 'Réactiver le son' : 'Couper le son');
    this.$('btn-sound').classList.toggle('off', muted);
  }

  // ---- Toasts ----

  toast(text, { title, ms = 5200, kind = '', once = '' } = {}) {
    if (once) {
      if (this.seenToasts.has(once)) return;
      this.seenToasts.add(once);
    }
    const el = document.createElement('div');
    el.className = `toast ${kind}`;
    el.innerHTML = (title ? `<strong>${title}</strong>` : '') + `<span>${text}</span>`;
    this.toasts.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      setTimeout(() => el.remove(), 600);
    }, ms);
    const maxToasts = innerWidth < 720 ? 2 : 3;
    while (this.toasts.children.length > maxToasts) this.toasts.firstChild.remove();
  }

  discovery(info) {
    this.toast(`<em>${info.latin}</em> — ${info.common}`, {
      title: 'Nouvelle planche à l’herbier',
      kind: 'discovery',
      ms: 7000,
    });
  }

  // ---- Herbier ----

  toggleHerbier(force) {
    const open = force ?? this.herbier.hasAttribute('hidden');
    if (open) {
      this.herbier.removeAttribute('hidden');
      requestAnimationFrame(() => this.herbier.classList.add('open'));
      this.toggleHelp(false);
    } else {
      this.herbier.classList.remove('open');
      setTimeout(() => this.herbier.setAttribute('hidden', ''), 350);
    }
  }

  isHerbierOpen() {
    return !this.herbier.hasAttribute('hidden');
  }

  renderHerbier(entries, sprites) {
    const list = this.$('herbier-list');
    const empty = this.$('herbier-empty');
    this.$('herbier-count').textContent =
      entries.length === 0
        ? ''
        : `${entries.length} espèce${entries.length > 1 ? 's' : ''} décrite${entries.length > 1 ? 's' : ''}`;
    empty.hidden = entries.length > 0;
    list.innerHTML = '';
    const sorted = entries.slice().sort((a, b) => a.day - b.day || a.info.latin.localeCompare(b.info.latin));
    for (const entry of sorted) {
      const li = document.createElement('li');
      li.className = 'plate';
      const thumb = document.createElement('canvas');
      thumb.width = 96;
      thumb.height = 124;
      thumb.className = 'thumb';
      this.drawThumb(thumb, entry.genome, sprites);
      const body = document.createElement('div');
      body.className = 'plate-body';
      body.innerHTML =
        `<h3>${entry.info.common}</h3>` +
        `<p class="latin">${entry.info.latin}</p>` +
        `<p class="role">${entry.info.role}</p>` +
        `<p class="desc">${entry.info.description}</p>` +
        `<p class="meta">Décrite le jour ${entry.day}${entry.genome.gen > 0 ? ` · ${entry.genome.gen}ᵉ génération` : ''}</p>`;
      li.appendChild(thumb);
      li.appendChild(body);
      list.appendChild(li);
    }
  }

  drawThumb(canvasEl, genome, sprites) {
    const g = canvasEl.getContext('2d');
    const w = canvasEl.width;
    const h = canvasEl.height;
    const grad = g.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#0d1024');
    grad.addColorStop(1, '#141830');
    g.fillStyle = grad;
    g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(201,169,106,0.35)';
    g.lineWidth = 1;
    g.strokeRect(3.5, 3.5, w - 7, h - 7);
    const plant = new Plant(genome, w / 2, h - 8, { scale: 0.44, growth: 1 });
    plant.update(0, { windAt: () => 0, growthScale: 0 });
    plant.draw(g, { glowAlpha: 0.65, sprites });
  }

  // ---- Aide ----

  toggleHelp(force) {
    const open = force ?? this.help.hasAttribute('hidden');
    if (open) {
      this.help.removeAttribute('hidden');
      this.toggleHerbier(false);
    } else {
      this.help.setAttribute('hidden', '');
    }
  }

  isHelpOpen() {
    return !this.help.hasAttribute('hidden');
  }

  // ---- Infobulle ----

  showTooltip(html, x, y) {
    this.tooltip.innerHTML = html;
    this.tooltip.removeAttribute('hidden');
    const pad = 14;
    const rect = this.tooltip.getBoundingClientRect();
    let tx = x + 18;
    let ty = y - rect.height - 12;
    if (tx + rect.width + pad > innerWidth) tx = x - rect.width - 18;
    if (ty < pad) ty = y + 22;
    this.tooltip.style.transform = `translate(${Math.round(tx)}px, ${Math.round(ty)}px)`;
  }

  hideTooltip() {
    this.tooltip.setAttribute('hidden', '');
  }

  tooltipHtml(plant, growthPct) {
    const info = speciesInfo(plant.genome);
    return (
      `<h3>${info.common}</h3>` +
      `<p class="latin">${info.latin}</p>` +
      `<p class="line">${info.role}</p>` +
      `<p class="line dim">${plant.genome.gen > 0 ? `${plant.genome.gen}ᵉ génération hybride` : 'lignée sauvage'} · ` +
      (growthPct >= 100 ? 'en fleur' : `croissance ${growthPct} %`) +
      '</p>'
    );
  }

  // ---- Seuil d'entrée ----

  showOnboarding({ returning, day }) {
    this.onboarding.classList.remove('gone');
    this.$('ob-title').textContent = 'Chlorophonie';
    if (returning) {
      this.$('ob-tagline').textContent = `Votre jardin vous attend — jour ${day}.`;
      this.$('ob-steps').setAttribute('hidden', '');
      this.$('btn-enter').textContent = 'Revenir au jardin';
    }
  }

  hideOnboarding() {
    this.onboarding.classList.add('gone');
    setTimeout(() => this.onboarding.remove(), 1400);
  }
}
