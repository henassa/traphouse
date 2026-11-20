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
  kd: { label: 'K/D', width: 64 },
  avg: { label: 'Rating', width: 80 },
};

const VAL_COLUMNS = {
  elo: { label: 'Rang', width: 170 },
  rr: { label: 'RR', width: 56 },
  peak: { label: 'Pic', width: 150 },
  kd: { label: 'K/D', width: 60 },
  winrate: { label: 'Victoires', width: 84 },
};

const LOL_COLUMNS = {
  solo: { label: 'Solo/Duo', width: 170 },
  lp: { label: 'LP', width: 60 },
  flex: { label: 'Flex', width: 190 },
  winrate: { label: 'Victoires', width: 84 },
  games: { label: 'Parties', width: 70 },
};

// Paliers LoL, du plus bas au plus haut, avec une couleur par palier.
const LOL_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_COLORS = { IRON: '#8a8a8a', BRONZE: '#b0764b', SILVER: '#aab4c0', GOLD: '#e5b84c', PLATINUM: '#4fb8a8', EMERALD: '#3fc36b', DIAMOND: '#6f8cff', MASTER: '#c45cff', GRANDMASTER: '#ff5555', CHALLENGER: '#f4d27a' };
const LOL_DIVS = { IV: 0, III: 1, II: 2, I: 3 };
const lolScore = (q) => (q ? LOL_TIERS.indexOf(q.tier) * 400 + (LOL_DIVS[q.division] ?? 0) * 100 + (q.lp ?? 0) : null);
const lolTierName = (q) => {
  const t = q.tier.charAt(0) + q.tier.slice(1).toLowerCase();
  return LOL_TIERS.indexOf(q.tier) >= 7 ? t : `${t} ${q.division ?? ''}`.trim();
};

// Emblèmes de rang du catalogue public de Riot (servis par valorant-api.com).
// Emblème publié avec le site par le workflow ; à défaut, la même image chez valorant-api.com.
const valTierIcon = (tier) => `${BASE}valorant-tiers/${tier}.png`;
const valTierRemote = (tier) => `https://media.valorant-api.com/competitivetiers/03621f52-342b-cf4e-4f86-9350a49c6d04/${tier}/largeicon.png`;

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
  game: location.hash === '#valorant' ? 'val' : location.hash === '#lol' ? 'lol' : 'cs',
  lolSort: 'solo',
  lolSortDir: 'desc',
  valSort: 'elo',
  valSortDir: 'desc',
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

function valPlayers() {
  return (state.latest.valorant?.players ?? []).map((p) => ({
    ...p,
    avatar: p.card ?? null,
    cur: {
      elo: p.mmr?.elo ?? (p.mmr?.tier ? p.mmr.tier * 100 + (p.mmr.rr ?? 0) : null),
      rr: p.mmr?.tier ? p.mmr.rr ?? null : null,
      peak: p.mmr?.peakTier || null,
      kd: p.stats?.kd ?? null,
      hs: p.stats?.hs ?? null,
      acs: p.stats?.acs ?? null,
      winrate: p.stats?.winrate ?? null,
    },
  }));
}

function valRows() {
  const { valSort: sort, valSortDir: sortDir, query } = state;
  const q = query.trim().toLowerCase();
  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = valPlayers().sort((a, b) => {
    const va = a.cur[sort], vb = b.cur[sort];
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || (b.cur.elo ?? 0) - (a.cur.elo ?? 0);
  });
  const shown = sorted.map((p, i) => ({ p, i })).filter(({ p }) => !q || `${p.name} ${p.riotId}`.toLowerCase().includes(q));
  const dash = '<span class="muted">—</span>';
  const tier = (id, name) => `<span class="inline-flex items-center gap-1.5"><img class="rank-img" src="${valTierIcon(id)}" alt="" width="26" height="26" style="width:26px;height:26px" data-remote="${valTierRemote(id)}" onerror="if(this.dataset.remote){this.src=this.dataset.remote;this.dataset.remote=''}else{this.remove()}"><b class="truncate">${esc(name ?? '')}</b></span>`;
  const cell = (p, key) => {
    const v = p.cur[key];
    if (v == null) return dash;
    switch (key) {
      case 'elo': return p.mmr?.tier ? tier(p.mmr.tier, p.mmr.tierName) : dash;
      case 'rr': return `<b>${v}</b>${p.mmr?.lastChange ? `<br><span class="text-[11px]">${delta(p.mmr.lastChange)}</span>` : ''}`;
      case 'peak': return tier(v, p.mmr.peakName);
      case 'kd': return `<b class="${v >= 1 ? 'up' : 'down'}">${v.toFixed(2).replace('.', ',')}</b>`;
      case 'hs': return `<b>${String(v).replace('.', ',')} %</b>`;
      case 'acs': return `<b>${v}</b>`;
      default: return `<b>${v} %</b>`;
    }
  };
  return tableHtml(VAL_COLUMNS, sort, sortDir, shown, cell, q);
}

// Tableau commun aux deux jeux : largeurs fixes, # et joueur collés à gauche.
function tableHtml(columns, sort, sortDir, shown, cell, q) {
  const arrow = (k) => `<span class="arrow">${k === sort ? (sortDir === 'asc' ? '▲' : '▼') : ''}</span>`;
  const head = Object.entries(columns).map(([k, c]) =>
    `<th><a href="#" data-sort="${k}" class="${k === sort ? 'accent' : ''}">${c.label}${arrow(k)}</a></th>`).join('');
  const cols = `<col style="width:30px"><col style="width:150px">${Object.values(columns).map((c) => `<col style="width:${c.width}px">`).join('')}`;
  const total = 180 + Object.values(columns).reduce((n, c) => n + c.width, 0);
  const rows = shown.map(({ p, i }) => {
    const ranked = p.cur[sort] != null;
    return `<tr>
      <td class="rank ${ranked && i < 3 ? 'accent font-bold' : 'muted'}">${ranked ? i + 1 : '–'}</td>
      <td class="who"><span class="who-in">${avatar(p, 32)}<span>${esc(p.name)}</span></span></td>
      ${Object.keys(columns).map((k) => `<td>${cell(p, k)}</td>`).join('')}
    </tr>`;
  }).join('');
  return `<div class="sunken ranking-scroll">
      <table class="ranking" style="width:${total}px">
        <colgroup>${cols}</colgroup>
        <thead><tr><th class="rank">#</th><th class="who">Joueur</th>${head}</tr></thead>
        <tbody>${rows || `<tr><td colspan="${2 + Object.keys(columns).length}" class="muted italic">${q ? 'Aucun joueur trouvé' : 'Aucun joueur'}</td></tr>`}</tbody>
      </table>
    </div>`;
}

function lolPlayers() {
  return (state.latest.lol?.players ?? []).map((p) => {
    const g = p.solo ? p.solo.wins + p.solo.losses : null;
    return {
      ...p,
      cur: {
        solo: lolScore(p.solo),
        lp: p.solo ? p.solo.lp : null,
        flex: lolScore(p.flex),
        winrate: g ? Math.round((p.solo.wins / g) * 100) : null,
        games: g || null,
      },
    };
  });
}

function lolRows() {
  const { lolSort: sort, lolSortDir: sortDir, query } = state;
  const q = query.trim().toLowerCase();
  const dir = sortDir === 'asc' ? 1 : -1;
  const sorted = lolPlayers().sort((a, b) => {
    const va = a.cur[sort], vb = b.cur[sort];
    if (va == null && vb == null) return a.name.localeCompare(b.name);
    if (va == null) return 1;
    if (vb == null) return -1;
    return (va - vb) * dir || (b.cur.solo ?? 0) - (a.cur.solo ?? 0);
  });
  const shown = sorted.map((p, i) => ({ p, i })).filter(({ p }) => !q || `${p.name} ${p.riotId}`.toLowerCase().includes(q));
  const dash = '<span class="muted">—</span>';
  // Emblèmes officiels Riot (ranked-emblems-latest), réduits dans src/img/lol.
  const rank = (r) => `<span class="inline-flex items-center gap-1.5"><img class="rank-img" src="img/lol/${r.tier}.png" alt="" style="height:26px;width:auto" onerror="this.remove()"><b style="color:${LOL_COLORS[r.tier] ?? 'inherit'}">${esc(lolTierName(r))}</b></span>`;
  const cell = (p, key) => {
    const v = p.cur[key];
    if (v == null) return dash;
    switch (key) {
      case 'solo': return rank(p.solo);
      case 'flex': return `${rank(p.flex)} <span class="text-[11px] muted">${p.flex.lp} LP</span>`;
      case 'lp': return `<b>${v}</b>`;
      case 'winrate': return `<b class="${v >= 50 ? 'up' : 'down'}">${v} %</b><br><span class="text-[11px] muted">${p.solo.wins} V · ${p.solo.losses} D</span>`;
      default: return `<b>${v}</b>`;
    }
  };
  return tableHtml(LOL_COLUMNS, sort, sortDir, shown, cell, q);
}

const LOL_NOTE = 'Rangs Solo/Duo et Flex via l’API officielle de Riot. LP, victoires et parties en Solo/Duo sur la saison en cours.';

const CS_NOTE = 'Évolution FACEIT et Premier depuis hier soir. MM = meilleur rang toutes cartes. Leetify = rating global Leetify, Rating = moyenne des ratings Leetify sur ses derniers matchs. K/D calculé sur les tableaux des scores Leetify depuis le début du suivi.';
const VAL_NOTE = 'Rang, RR (avec la variation du dernier match) et pic de rang via HenrikDev. K/D et victoires sur les 20 derniers matchs compétitifs.';

function gameTabs() {
  return `<nav class="tabs" style="grid-template-columns:repeat(3,1fr)">
    <li aria-selected="${state.game === 'cs'}"><a href="#" data-game="cs">CS2</a></li>
    <li aria-selected="${state.game === 'val'}"><a href="#valorant" data-game="val">Valorant</a></li>
    <li aria-selected="${state.game === 'lol'}"><a href="#lol" data-game="lol">LoL</a></li>
  </nav>`;
}

function currentRows() {
  return state.game === 'val' ? valRows() : state.game === 'lol' ? lolRows() : rankingRows();
}

// Données absentes pour un jeu : on explique quoi configurer.
function missingFor(game) {
  if (game === 'val' && !state.latest.valorant) return 'Pas encore de données Valorant : ajoute le secret <code>HENRIK_API_KEY</code> et des Riot ID dans la liste <code>valorant</code> de <code>players.json</code>.';
  if (game === 'lol' && !state.latest.lol) return 'Pas encore de données League of Legends : ajoute le secret <code>RIOT_API_KEY</code> (clé personnelle Riot) et des Riot ID dans la liste <code>lol</code> de <code>players.json</code>.';
  return null;
}

function ranking() {
  const g = state.game;
  const data = g === 'val' ? state.latest.valorant : g === 'lol' ? state.latest.lol : state.latest;
  const missing = missingFor(g);
  const note = g === 'val' ? VAL_NOTE : g === 'lol' ? LOL_NOTE : CS_NOTE;
  return win('Traphouse', `
    <input id="search" class="search mb-2" type="search" placeholder="Rechercher un joueur…" autocomplete="off" value="${esc(state.query)}">
    ${g === 'cs' && staleBanner() ? `<div class="mb-2">${staleBanner()}</div>` : ''}
    <div id="rows">${missing ? `<div class="sunken px-2.5 py-2 text-[13px]">${missing}</div>` : currentRows()}</div>
    <p class="mx-0 mb-0 mt-2 text-[12px] muted">${data?.generatedAt ? `Mis à jour ${ago(data.generatedAt, state.now)}. ` : ''}Clique sur une colonne pour trier, une deuxième fois pour inverser. ${note}</p>`,
  'no-resize', 'ranking');
}

function footer() {
  const { latest } = state;
  const at = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: latest.timezone }).format(new Date(latest.generatedAt));
  // Mention exigée par la politique développeur de Riot (Valorant et League of Legends).
  return `<p class="mx-0 mt-4 text-center text-[12px] muted">Données FACEIT, Leetify, HenrikDev et Riot, mises à jour toutes les heures.<br>Dernière mise à jour : ${at}${DEMO ? ' · données de démonstration' : ''}</p>
    <p class="mx-auto mt-2 max-w-[640px] text-center text-[11px] muted">TRAPHOUSE is not endorsed by Riot Games and does not reflect the views or opinions of Riot Games or anyone officially involved in producing or managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc.</p>`;
}

function homeContent() {
  return gameTabs() + ranking() + footer();
}

function renderHome() {
  document.title = 'TRAPHOUSE';
  app.innerHTML = `<div class="app"><div id="content">${homeContent()}</div></div>`;
}

function sortBy(key) {
  // Deuxième clic sur la même colonne : on inverse le sens.
  const [k, d] = state.game === 'val' ? ['valSort', 'valSortDir'] : state.game === 'lol' ? ['lolSort', 'lolSortDir'] : ['sort', 'sortDir'];
  state[d] = state[k] === key && state[d] === 'desc' ? 'asc' : 'desc';
  state[k] = key;
  rerenderRows();
}

// On ne redessine que la liste : le champ de recherche garde le focus.
function rerenderRows() {
  const rows = document.getElementById('rows');
  if (rows && !missingFor(state.game)) rows.innerHTML = currentRows();
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
  const game = e.target.closest('[data-game]');
  if (game) {
    e.preventDefault();
    state.game = game.dataset.game;
    history.replaceState(null, '', state.game === 'val' ? '#valorant' : state.game === 'lol' ? '#lol' : location.pathname + location.search);
    renderHome();
    return;
  }
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
