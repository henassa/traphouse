import { mmName, premierColor } from './ranks.js';
import { buildModel } from './stats.js';
import { ago, avatar, delta, esc, faceitBadge, fmt, icon, mmBadge, premierBadge, wingmanBadge } from './ui.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const BASE = DEMO ? 'demo/' : 'data/';
const app = document.getElementById('app');

// Colonnes du classement : largeur fixe pour que rien ne bouge quand on trie.
const COLUMNS = {
  elo: { label: 'FACEIT', width: 100 },
  premier: { label: 'Premier', width: 96 },
  mm: { label: 'MM', width: 80 },
  wingman: { label: 'Wingman', width: 84 },
  leetify: { label: 'Leetify', width: 76 },
  aim: { label: 'Aim', width: 60 },
  kd: { label: 'K/D', width: 64 },
  avg: { label: 'Rating', width: 80 },
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  model: null,
  latest: null,
  now: new Date(),
  // Toujours par ELO FACEIT à l'ouverture, du plus haut au plus bas.
  sort: 'elo',
  sortDir: 'desc',
  period: 1,
  query: '',
  funOpen: store.get('funOpen', true),
  homeScroll: 0,
  playerMetric: null,
  navigated: false,
};

async function load() {
  const get = async (file) => {
    const res = await fetch(BASE + file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(res.status);
    return res.json();
  };
  try {
    const [latest, series] = await Promise.all([get('latest.json'), get('series.json').catch(() => null)]);
    state.latest = latest;
    // La démo est figée : on la calcule à la date où elle a été générée.
    state.now = DEMO ? new Date(new Date(latest.generatedAt).getTime() + 14 * 60e3) : new Date();
    state.model = buildModel(latest, series, state.now);
  } catch {
    state.model = null;
  }
}

const win = (name, body, cls = '', id = '') =>
  `<section class="window ${cls}" name="${esc(name)}"${id ? ` id="${id}"` : ''}>${body}</section>`;

// Accueil

function staleBanner() {
  const { latest } = state;
  const failed = Object.entries(latest.sources ?? {}).filter(([, s]) => s.failed || s.error).map(([k]) => k);
  const age = Date.now() - new Date(latest.generatedAt).getTime();
  if (DEMO || (!failed.length && age < 3 * 3600e3)) return '';
  const names = { faceit: 'FACEIT', leetify: 'Leetify', steam: 'Steam' };
  const keyRefused = latest.sources?.leetify?.error?.startsWith('Clé refusée');
  const msg = keyRefused
    ? 'La clé Leetify a été refusée : collecte sans clé, avec des limites plus basses. Vérifie le secret LEETIFY_API_KEY.'
    : failed.length
    ? `${failed.map((f) => names[f]).join(' et ')} n’a pas répondu pour certains joueurs. Dernières données connues affichées.`
    : `Pas de mise à jour depuis ${ago(latest.generatedAt).replace('il y a ', '')}. Dernières données connues affichées.`;
  return `<div class="sunken mt-2.5 flex items-start gap-2 px-2.5 py-2 text-[13px]"><span class="accent">${icon('warning')}</span><span>${msg}</span></div>`;
}

function rankingRows() {
  const { sort, sortDir, query } = state;
  const q = query.trim().toLowerCase();
  const dir = sortDir === 'asc' ? 1 : -1;
  // Les joueurs sans valeur restent en bas, quel que soit le sens du tri.
  const sorted = [...state.model.players].sort((a, b) => {
    const va = a.cur[sort], vb = b.cur[sort];
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || (b.cur.elo ?? 0) - (a.cur.elo ?? 0);
  });
  const shown = sorted.map((p, i) => ({ p, i }))
    .filter(({ p }) => !q || `${p.name} ${p.faceit?.nickname ?? ''} ${p.steamName ?? ''}`.toLowerCase().includes(q));

  const dash = '<span class="muted">—</span>';
  const two = (v) => v.toFixed(2).replace('.', ',');
  const small = (d, unit = '') => (d ? `<br><span class="text-[11px]">${delta(d, unit)}</span>` : '');
  const cell = (p, key) => {
    const v = p.cur[key];
    if (v == null) return dash;
    switch (key) {
      case 'elo': return `<span class="inline-flex items-center gap-1">${faceitBadge(p.faceit.level, 20)}<b>${fmt(v)}</b></span>${small(p.delta[1].elo)}`;
      case 'premier': return `${premierBadge(v, premierColor(v))}${small(p.delta[1].premier)}`;
      case 'mm': return mmBadge(v, `${mmName(v)} · ${p.leetify.mmBest.map}`, 24);
      case 'wingman': return wingmanBadge(v, mmName(v), 24);
      case 'leetify': return `<b class="${v >= 0 ? 'up' : 'down'}">${v > 0 ? '+' : ''}${two(v)}</b>`;
      case 'aim': return `<b>${Math.round(v)}</b>`;
      case 'avg': { const x = Math.abs(v) <= 1 ? v * 100 : v; return `<b class="${x >= 0 ? 'up' : 'down'}">${x > 0 ? '+' : ''}${two(x)}</b>`; }
      default: return `<b class="${v >= 1 ? 'up' : 'down'}">${two(v)}</b>`;
    }
  };

  const arrow = (k) => `<span class="arrow">${k === sort ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>`;
  const head = Object.entries(COLUMNS).map(([k, c]) =>
    `<th><a href="#" data-sort="${k}" class="${k === sort ? 'accent' : ''}">${c.label}${arrow(k)}</a></th>`).join('');
  const cols = `<col style="width:30px"><col style="width:150px">${Object.values(COLUMNS).map((c) => `<col style="width:${c.width}px">`).join('')}`;
  const total = 180 + Object.values(COLUMNS).reduce((n, c) => n + c.width, 0);

  const rows = shown.map(({ p, i }) => {
    const ranked = p.cur[sort] != null;
    return `<tr>
      <td class="rank ${ranked && i < 3 ? 'accent font-bold' : 'muted'}">${ranked ? i + 1 : '–'}</td>
      <td class="who"><span class="who-in">${avatar(p, 32)}<span>${esc(p.name)}</span></span></td>
      ${Object.keys(COLUMNS).map((k) => `<td>${cell(p, k)}</td>`).join('')}
    </tr>`;
  }).join('');

  return `<div class="sunken ranking-scroll">
      <table class="ranking" style="width:${total}px">
        <colgroup>${cols}</colgroup>
        <thead><tr><th class="rank">#</th><th class="who">Joueur</th>${head}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${2 + Object.keys(COLUMNS).length}" class="muted italic">${q ? 'Aucun joueur trouvé' : 'Aucun joueur'}</td></tr>`}</tbody>
      </table>
    </div>`;
}

function ranking() {
  return win('Traphouse', `
    <input id="search" class="search mb-2" type="search" placeholder="Rechercher un joueur…" autocomplete="off" value="${esc(state.query)}">
    ${staleBanner() ? `<div class="mb-2">${staleBanner()}</div>` : ''}
    <div id="rows">${rankingRows()}</div>
    <p class="mx-0 mb-0 mt-2 text-[12px] muted">Mis à jour ${ago(state.latest.generatedAt, state.now)}. Clique sur une colonne pour trier, une deuxième fois pour inverser. Évolution FACEIT et Premier depuis hier soir. MM = meilleur rang toutes cartes. Leetify = rating global Leetify, Rating = moyenne des ratings Leetify sur ses derniers matchs, Aim = note de visée Leetify. K/D calculé sur les tableaux des scores Leetify depuis le début du suivi.</p>`,
  'no-resize', 'ranking');
}

function footer() {
  const { latest } = state;
  const at = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: latest.timezone }).format(new Date(latest.generatedAt));
  return `<p class="mx-0 mt-4 text-center text-[12px] muted">Données FACEIT et Leetify, mises à jour toutes les heures.<br>Dernière mise à jour : ${at}${DEMO ? ' · données de démonstration' : ''}</p>`;
}

function homeContent() {
  return ranking() + footer();
}

function renderHome() {
  document.title = 'TRAPHOUSE';
  app.innerHTML = `<div class="app"><div id="content">${homeContent()}</div></div>`;
}

function sortBy(key) {
  // Deuxième clic sur la même colonne : on inverse le sens.
  state.sortDir = state.sort === key && state.sortDir === 'desc' ? 'asc' : 'desc';
  state.sort = key;
  rerenderRows();
}

// On ne redessine que la liste : le champ de recherche garde le focus.
function rerenderRows() {
  const rows = document.getElementById('rows');
  if (rows) rows.innerHTML = rankingRows();
}

function render() {
  if (!state.model) return renderEmpty();
  renderHome();
}

function renderEmpty() {
  app.innerHTML = `<div class="app">${win('Traphouse', `
    <h1 class="m-0">Pas encore de données</h1>
    <p class="mx-0">Lance le workflow « Mise à jour » depuis l’onglet Actions du dépôt, puis recharge la page dans quelques minutes.</p>
    <p class="m-0"><a href="?demo">Voir avec des données de démonstration</a></p>`, 'no-resize')}</div>`;
}

function renderLoading() {
  app.innerHTML = `<div class="app">${win('Connexion…', `
    <p class="m-0 text-[13px]">Récupération des classements…</p>
    <progress class="meter" max="100"></progress>`, 'no-resize')}</div>`;
}

app.addEventListener('click', (e) => {
  const sortLink = e.target.closest('[data-sort]');
  if (sortLink) {
    e.preventDefault();
    sortBy(sortLink.dataset.sort);
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    state.query = e.target.value;
    rerenderRows();
  }
});

renderLoading();
await load();
render();
