import { PREMIER_HEX } from './ranks.js';

export const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const nf = new Intl.NumberFormat('fr-FR');
export const fmt = (n) => (n == null ? '—' : nf.format(Math.round(n)));
export const signed = (n) => (n > 0 ? '+' : n < 0 ? '−' : '±') + nf.format(Math.abs(Math.round(n)));

// Le rating d'un match arrive en fraction (0,0312) et Leetify l'affiche ×100 (+3,12).
// L'exemple de la doc montre aussi 85 : au-delà de 1, on considère la valeur déjà à l'échelle.
export function leetifyRating(x) {
  if (typeof x !== 'number') return '—';
  const v = Math.abs(x) <= 1 ? x * 100 : x;
  return (v > 0 ? '+' : v < 0 ? '−' : '') + Math.abs(v).toFixed(2).replace('.', ',');
}

export const rankColor = (name) => `var(--rank-${name})`;

const P = {
  search: '<circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5L20 20" stroke="currentColor" stroke-width="2.2"/>',
  crown: '<path d="M3 8l4.5 3.5L12 5l4.5 6.5L21 8l-2 10H5z" fill="currentColor"/>',
  star: '<path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.3L12 17.1l-5.7 3.1 1.2-6.3-4.7-4.4 6.4-.8z" fill="currentColor"/>',
  trophy: '<path d="M7 3h10v2h3.5v2.5c0 2.6-1.9 4.5-4.3 4.9A5 5 0 0 1 13 15.8V18h3.5v3h-9v-3H11v-2.2a5 5 0 0 1-3.2-3.4C5.4 12 3.5 10.1 3.5 7.5V5H7zm0 4H5.5v.5c0 1.3.7 2.3 1.6 2.7A6 6 0 0 1 7 9zm10 0v2c0 .4 0 .8-.1 1.2.9-.4 1.6-1.4 1.6-2.7V7z" fill="currentColor"/>',
  warning: '<path d="M12 3.5L2.5 20h19z" fill="currentColor"/><path d="M12 9.5v5" stroke="#000" stroke-width="2"/><rect x="11" y="16.3" width="2" height="2" fill="#000"/>',
};
export const icon = (name, cls = 'size-4') => `<svg viewBox="0 0 24 24" class="${cls} shrink-0" aria-hidden="true">${P[name]}</svg>`;

export function avatar(p, size = 32) {
  const style = `width:${size}px;height:${size}px`;
  if (p.avatar) return `<img src="${esc(p.avatar)}" alt="" loading="lazy" class="avatar" style="${style}">`;
  const initials = p.name.split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
  return `<span class="avatar" style="${style};font-size:${Math.round(size * 0.4)}px">${esc(initials)}</span>`;
}

export function delta(n, unit = '') {
  if (n == null) return '<span class="muted">—</span>';
  if (n === 0) return '<span class="muted">=</span>';
  return `<span class="${n > 0 ? 'up' : 'down'} whitespace-nowrap tabular-nums">${n > 0 ? '▲' : '▼'} ${signed(n)}${unit ? ' ' + unit : ''}</span>`;
}

// Petite case enfoncée, texte coloré : niveaux FACEIT, rangs, rating Premier.
export const tag = (text, c, extra = '') => `<span class="tag ${extra}" style="color:${rankColor(c)}">${text}</span>`;

const rtf = new Intl.RelativeTimeFormat('fr', { numeric: 'auto' });
export function ago(iso, now = Date.now()) {
  const s = (new Date(iso).getTime() - now) / 1000;
  if (Math.abs(s) < 60) return 'à l’instant';
  if (Math.abs(s) < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (Math.abs(s) < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export function when(iso, tz, now = new Date()) {
  const key = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(d);
  const d = new Date(iso);
  const time = new Intl.DateTimeFormat('fr-FR', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(d);
  if (key(d) === key(now)) return `Aujourd’hui ${time}`;
  if (key(d) === key(new Date(now.getTime() - 864e5))) return `Hier ${time}`;
  return new Intl.DateTimeFormat('fr-FR', { timeZone: tz, weekday: 'short', day: 'numeric', month: 'short' }).format(d) + ` ${time}`;
}

// Les chiffres défilent jusqu'à leur valeur (data-count="1234").
export function countUp(root) {
  if (reducedMotion()) return;
  const items = [...root.querySelectorAll('[data-count]')].map((el) => ({ el, to: Number(el.dataset.count), text: el.textContent }));
  if (!items.length) return;
  const start = performance.now();
  const tick = (t) => {
    const k = Math.min(1, (t - start) / 700);
    const e = 1 - Math.pow(1 - k, 3);
    for (const { el, to, text } of items) {
      el.textContent = k === 1 ? text : el.dataset.signed ? signed(to * e) : fmt(to * e);
    }
    if (k < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

// Les barres segmentées se remplissent comme l'écran de chargement de Steam.
export function fillMeters(root) {
  for (const el of root.querySelectorAll('progress[data-to]')) {
    const to = Number(el.dataset.to);
    if (reducedMotion()) { el.value = to; continue; }
    const start = performance.now();
    const step = (t) => {
      const k = Math.min(1, (t - start) / 800);
      el.value = Math.round(to * k / 4) * 4;
      if (k < 1) requestAnimationFrame(step);
      else el.value = to;
    };
    requestAnimationFrame(step);
  }
}

// Emblèmes : niveaux FACEIT fournis dans img/faceit, Premier / MM seulement s'ils ont été déposés
// dans src/img/ranks (sinon on garde la petite case colorée).
const rankFiles = new Map();
export async function loadRankImages() {
  try {
    const res = await fetch('img/ranks/index.json', { cache: 'no-cache' });
    for (const f of await res.json()) rankFiles.set(f.replace(/\.\w+$/, ''), f);
  } catch {}
}

export function faceitBadge(level, size = 24) {
  if (!level) return tag('–', 'gray');
  return `<img class="rank-img" src="img/faceit/${level}.png" width="${size}" height="${size}" alt="Niveau ${level}" title="Niveau FACEIT ${level}">`;
}

const PREMIER_TIER = { gray: 1, teal: 2, blue: 3, indigo: 4, pink: 5, red: 6, yellow: 7 };
export function premierBadge(rating, c, extra = '') {
  const file = rankFiles.get(`premier-${PREMIER_TIER[c]}`);
  const text = `<span data-count="${rating}">${fmt(rating)}</span>`;
  const hex = PREMIER_HEX[c];
  if (!file) return `<span class="tag ${extra}" style="color:${hex}">${text}</span>`;
  return `<span class="premier-badge" style="background-image:url('img/ranks/${file}');color:${hex}">${text}</span>`;
}

export function mmBadge(rank, short, name, c, extra = '', height = 22) {
  const file = rankFiles.get(`mm-${rank}`);
  if (!file) return tag(short, c, extra);
  return `<img class="rank-img" src="img/ranks/${file}" height="${height}" style="width:auto" alt="${esc(name)}" title="${esc(name)}">`;
}
