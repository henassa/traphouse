import { bindChart, lineChart } from './chart.js';
import { mmColor, mmName, mmShort, premierColor, PREMIER_HEX, SOURCE_COLOR, SOURCE_LABEL } from './ranks.js';
import { addDays, avgRating, buildModel, currentStreak, favoriteMap, record } from './stats.js';
import { ago, avatar, delta, esc, faceitBadge, fmt, icon, leetifyRating, mmBadge, premierBadge, rankColor, signed, tag, when, wingmanBadge } from './ui.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const BASE = DEMO ? 'demo/' : 'data/';
const app = document.getElementById('app');

// Colonnes du classement : largeur fixe pour que rien ne bouge quand on trie.
const COLUMNS = {
  elo: { label: 'FACEIT', width: 96 },
  premier: { label: 'Premier', width: 92 },
  mm: { label: 'MM', width: 76 },
  wingman: { label: 'Wingman', width: 84 },
  leetify: { label: 'Leetify', width: 72 },
  aim: { label: 'Aim', width: 52 },
  kd: { label: 'K/D', width: 56 },
  kd7: { label: 'K/D 7 j', width: 66 },
  hltv: { label: 'HLTV', width: 58 },
  hltv7: { label: 'HLTV 7 j', width: 72 },
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  model: null,
  latest: null,
  now: new Date(),
  sort: store.get('sortKey', 'elo'),
  sortDir: store.get('sortDir', 'desc'),
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

const playerLink = (p) => `#/p/${encodeURIComponent(p.id)}`;
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
    return `<tr data-href="${playerLink(p)}">
      <td class="rank ${ranked && i < 3 ? 'accent font-bold' : 'muted'}">${ranked ? i + 1 : '–'}</td>
      <td class="who"><a href="${playerLink(p)}">${avatar(p, 32)}<span>${esc(p.name)}</span></a></td>
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
    <p class="mx-0 mb-0 mt-2 text-[12px] muted">Mis à jour ${ago(state.latest.generatedAt, state.now)}. Clique sur une colonne pour trier, une deuxième fois pour inverser. Évolution FACEIT et Premier depuis hier soir. MM = meilleur rang toutes cartes. K/D et HLTV 1.0 calculés sur les tableaux des scores Leetify : « total » depuis le début du suivi, « 7 j » sur la dernière semaine.</p>`,
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
  store.set('sortKey', state.sort);
  store.set('sortDir', state.sortDir);
  rerenderRows();
}

// On ne redessine que la liste : le champ de recherche garde le focus.
function rerenderRows() {
  const rows = document.getElementById('rows');
  if (rows) rows.innerHTML = rankingRows();
}

// Page joueur

function playerPage(p) {
  const { tz, dates, today } = state.model;
  const m30 = p.matches.filter((m) => m.day > addDays(today, -30));
  const rec = record(m30);
  const streak = currentStreak(p.matches);
  const fav = favoriteMap(m30);
  const rating = avgRating(m30);
  const metric = state.playerMetric ?? (p.series?.elo?.some((v) => v != null) ? 'elo' : 'premier');

  const cell = (label, value, sub, wide = false) => `
    <div class="sunken min-w-0 px-2.5 py-2 ${wide ? 'col-span-2 sm:col-span-1' : ''}">
      <span class="caps block !text-[10px] muted">${label}</span>
      <div class="flex items-center gap-1.5 text-[20px] font-bold leading-7 tabular-nums">${value}</div>
      <span class="block truncate text-[12px] muted">${sub}</span>
    </div>`;
  const cells = [
    p.faceit
      ? cell('FACEIT', `${faceitBadge(p.faceit.level, 28)}<span class="accent" data-count="${p.faceit.elo}">${fmt(p.faceit.elo)}</span>`, `${delta(p.delta[7].elo)} sur 7 j`)
      : cell('FACEIT', '<span class="muted">—</span>', 'Pas de compte'),
    p.cur.premier != null
      ? cell('Premier', premierBadge(p.cur.premier, premierColor(p.cur.premier), 'big'), `${delta(p.delta[7].premier)} sur 7 j`)
      : cell('Premier', '<span class="muted">—</span>', p.leetify ? 'Pas encore classé' : 'Pas de Leetify'),
    p.cur.mm != null
      ? cell('Meilleur rang MM', mmBadge(p.cur.mm, mmName(p.cur.mm), 30), `${mmName(p.cur.mm)} · ${esc(p.leetify.mmBest.map)}`)
      : cell('Meilleur rang MM', '<span class="muted">—</span>', 'Aucun rang compétitif'),
    p.leetify?.wingman
      ? cell('Wingman', wingmanBadge(p.leetify.wingman, mmName(p.leetify.wingman), 30), mmName(p.leetify.wingman))
      : cell('Wingman', '<span class="muted">—</span>', 'Pas de rang Wingman'),
    rec.n
      ? cell('Victoires 30 j', `<span class="accent">${Math.round((rec.w / Math.max(1, rec.w + rec.l)) * 100)} %</span>`, `${rec.w} V · ${rec.l} D`, true)
      : cell('Victoires 30 j', '<span class="muted">—</span>', 'Aucun match récent', true),
  ].join('');

  const links = [
    p.faceit?.url && ['FACEIT', p.faceit.url],
    ['Leetify', p.leetify?.url ?? `https://leetify.com/app/profile/${p.steam64}`],
    ['Steam', `https://steamcommunity.com/profiles/${p.steam64}`],
  ].filter(Boolean);

  const header = win(p.name, `
    <div class="flex items-center gap-3">
      ${avatar(p, 64)}
      <div class="min-w-0">
        <h1 class="m-0 truncate text-[22px]">${esc(p.name)}</h1>
        <p class="m-0 truncate text-[13px] muted">${[p.faceit?.nickname, p.steamName].filter(Boolean).map(esc).join(' · ') || 'Steam ' + esc(p.steam64)}</p>
        ${DEMO ? '' : `<p class="m-0 mt-1 flex gap-3 text-[13px]">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}</p>`}
      </div>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-5">${cells}</div>`, 'no-resize');

  const chartMetrics = [['elo', 'ELO FACEIT'], ['premier', 'Premier']].filter(([k]) => p.series?.[k]?.some((v) => v != null));
  const chart = chartMetrics.length
    ? win('Évolution', `
      ${chartMetrics.length > 1 ? `<div class="mb-2 flex gap-1.5" data-seg="metric">${chartMetrics.map(([k, l]) => `<button class="small" data-value="${k}" aria-pressed="${k === metric}">${l}</button>`).join('')}</div>` : ''}
      <div class="sunken px-2 pb-1 pt-3" id="chart">${lineChart(dates, p.series[metric] ?? [])}</div>`, 'no-resize')
    : '';

  const formRows = [
    ['Série en cours', streak ? `${streak.n} ${streak.kind === 'W' ? 'victoire' : streak.kind === 'L' ? 'défaite' : 'nul'}${streak.n > 1 ? 's' : ''}` : '—', streak?.kind === 'W' ? 'up' : streak?.kind === 'L' ? 'down' : 'muted'],
    ['Map préférée', fav ? `${esc(fav.map)} · ${fav.n} matchs` : '—', 'accent'],
    // ranks.leetify est déjà à l'échelle affichée par Leetify (ex. 2,12 dans la doc).
    ['Rating Leetify', typeof p.leetify?.leetify === 'number' ? (p.leetify.leetify > 0 ? '+' : '') + p.leetify.leetify.toFixed(2).replace('.', ',') : '—', 'accent'],
    ['Rating moyen sur 30 j', rating != null ? leetifyRating(rating) : '—', 'accent'],
    ['Matchs sur 30 jours', String(rec.n), 'accent'],
  ].map(([k, v, c]) => `<div class="lv-row"><span class="flex-1">${k}</span><span class="tabular-nums font-bold ${c}">${v}</span></div>`).join('');

  const r = p.leetify?.rating;
  const meters = r
    ? [['Aim', r.aim], ['Positionnement', r.positioning], ['Utilitaires', r.utility]].filter(([, v]) => typeof v === 'number').map(([k, v]) => `
      <div class="py-1">
        <div class="flex justify-between text-[13px]"><span>${k}</span><span class="muted tabular-nums">${Math.round(v)} / 100</span></div>
        <progress class="meter" max="100" value="${Math.max(0, Math.min(100, Math.round(v)))}"></progress>
      </div>`).join('')
    : '';

  const comp = p.leetify?.competitive ?? [];
  const compWin = comp.length
    ? win('Rangs par carte', `
      <div class="flex items-center justify-between">
        <span class="text-[12px] muted">${comp.length} cartes classées</span>
        <button class="small" data-fold="maps" aria-expanded="false">Afficher</button>
      </div>
      <div class="fold" id="fold-maps"><div><div class="sunken mt-2.5">
        ${comp.map((c) => `<div class="lv-row"><span class="flex-1">${esc(c.map)}</span><span class="text-[12px] muted">${mmName(c.rank)}</span>${mmBadge(c.rank, mmName(c.rank), 24)}</div>`).join('')}
      </div></div></div>`, 'no-resize')
    : '';

  const recent = p.matches.slice(0, 15).map((m) => {
    const res = m.result === 'W' ? ['V', 'up'] : m.result === 'L' ? ['D', 'down'] : m.result === 'T' ? ['N', 'muted'] : ['?', 'muted'];
    const src = SOURCE_COLOR[m.source] ?? 'gray';
    const row = `
      <span class="tag w-7 text-center ${res[1]}">${res[0]}</span>
      <div class="min-w-0 flex-1">
        <p class="m-0 flex items-center gap-2"><span class="truncate text-[15px]">${esc(m.map ?? 'Carte inconnue')}</span><span class="caps !text-[9px]" style="color:${rankColor(src)}">${SOURCE_LABEL[m.source] ?? esc(m.source)}</span></p>
        <p class="m-0 text-[12px] muted">${when(m.at, tz, state.now)}</p>
      </div>
      <div class="text-right tabular-nums">
        <p class="m-0 text-[15px] font-bold">${m.score ? `${m.score[0]} – ${m.score[1]}` : ''}</p>
        <p class="m-0 text-[12px] muted">${typeof m.rating === 'number' ? leetifyRating(m.rating) : ''}</p>
      </div>`;
    if (m.details) return `<a class="lv-row" href="#/m/${encodeURIComponent(m.leetifyId)}/${encodeURIComponent(p.id)}">${row}<span class="muted text-[12px]">›</span></a>`;
    return m.url ? `<a class="lv-row" href="${esc(m.url)}" target="_blank" rel="noopener">${row}</a>` : `<div class="lv-row">${row}</div>`;
  }).join('');

  const notes = [];
  if (p.leetify?.privacy === 'private') notes.push('Profil Leetify privé : les matchs Premier et compétitifs ne sont pas visibles.');
  if (!p.leetify) notes.push('Pas de profil Leetify trouvé pour ce Steam ID.');
  if (p.errors?.length) notes.push(`Dernière mise à jour incomplète : ${p.errors.map(esc).join(' ; ')}.`);

  return `<div class="app">
    <nav class="tabs" style="grid-template-columns:auto 1fr">
      <li><a href="#/" data-back>‹ Classement</a></li>
      <li class="min-w-0"><span class="block truncate px-3 py-2 leading-[21px] font-bold">${esc(p.name)}</span></li>
    </nav>
    ${header}
    ${chart}
    ${win('Forme', `<div class="sunken">${formRows}</div>`, 'no-resize')}
    ${meters ? win('Profil Leetify', meters, 'no-resize') : ''}
    ${compWin}
    ${win('Derniers matchs', `
      <div class="sunken">${recent || '<div class="lv-row muted italic">Aucun match récent</div>'}</div>
      ${recent ? '<p class="mx-0 mb-0 mt-2 text-[12px] muted">Score de l’équipe du joueur en premier, rating Leetify en dessous. Touche un match marqué › pour voir le tableau des scores.</p>' : ''}`, '', 'matches')}
    ${notes.length ? `<div class="sunken flex items-start gap-2 px-2.5 py-2 text-[13px]"><span class="accent">${icon('warning')}</span><span>${notes.join('<br>')}</span></div>` : ''}
  </div>`;
}

function renderPlayer(id) {
  const p = state.model.players.find((x) => x.id === id);
  if (!p) { location.hash = '#/'; return; }
  document.title = 'TRAPHOUSE';
  app.innerHTML = playerPage(p);
  scrollTo(0, 0);
  bindChart(app, fmt);
}

// Détails d'un match : le tableau des scores complet récupéré chez Leetify.

let demoMatches = null;
async function loadMatch(id) {
  if (DEMO) {
    demoMatches ??= await fetch('demo/matches.json').then((r) => r.json()).catch(() => ({}));
    return demoMatches[id] ?? null;
  }
  const res = await fetch(`data/matches/${encodeURIComponent(id)}.json`, { cache: 'no-cache' }).catch(() => null);
  return res?.ok ? res.json() : null;
}

const pct = (x) => (typeof x === 'number' ? `${Math.round(x <= 1 ? x * 100 : x)} %` : '—');
const num = (x, digits = 0) => (typeof x === 'number' ? x.toFixed(digits).replace('.', ',') : '—');

function scoreboard(rows, title, score, won, tracked, focusId) {
  const lines = rows.sort((a, b) => (b.rating ?? -9) - (a.rating ?? -9)).map((r) => {
    const me = r.steam64 === focusId;
    const ours = tracked.get(r.steam64);
    const name = ours ? `<a href="#/p/${encodeURIComponent(r.steam64)}" class="${me ? 'accent font-bold' : 'accent'}">${esc(ours.name)}</a>` : `<span>${esc(r.name)}</span>`;
    return `<div class="lv-row mt-grid ${me ? 'bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]' : ''}">
      <span class="min-w-0 truncate">${name}</span>
      <span class="tabular-nums text-right">${r.k ?? '—'}</span>
      <span class="tabular-nums text-right">${r.d ?? '—'}</span>
      <span class="tabular-nums text-right">${r.a ?? '—'}</span>
      <span class="tabular-nums text-right">${num(r.adr)}</span>
      <span class="tabular-nums text-right">${pct(r.hs)}</span>
      <span class="tabular-nums text-right ${typeof r.rating === 'number' ? (r.rating >= 0 ? 'up' : 'down') : 'muted'}">${leetifyRating(r.rating)}</span>
    </div>`;
  }).join('');
  return win(title, `
    <div class="sunken">
      <div class="lv-head mt-grid caps !text-[10px] muted"><span>Joueur</span><span class="text-right">K</span><span class="text-right">D</span><span class="text-right">A</span><span class="text-right">ADR</span><span class="text-right">HS</span><span class="text-right">Rating</span></div>
      ${lines}
    </div>
    <p class="mx-0 mb-0 mt-2 text-[12px] ${won ? 'up' : 'down'}">${score} rounds · ${won ? 'Victoire' : 'Défaite'}</p>`, 'no-resize');
}

async function renderMatch(id, focusId) {
  const p = state.model.players.find((x) => x.id === focusId);
  const summary = p?.matches.find((m) => m.leetifyId === id);
  const back = `<nav class="tabs" style="grid-template-columns:auto 1fr">
      <li><a href="#/p/${encodeURIComponent(focusId)}" data-back>‹ ${esc(p?.name ?? 'Retour')}</a></li>
      <li class="min-w-0"><span class="block truncate px-3 py-2 leading-[21px] font-bold">${esc(summary?.map ?? 'Match')}</span></li>
    </nav>`;
  app.innerHTML = `<div class="app">${back}${win('Chargement…', '<p class="m-0 text-[13px]">Récupération du tableau des scores…</p>', 'no-resize')}</div>`;
  scrollTo(0, 0);

  const d = await loadMatch(id);
  if (current !== 'match') return;
  if (!d) {
    app.innerHTML = `<div class="app">${back}${win('Match', '<p class="m-0">Les détails de ce match ne sont pas encore disponibles. Ils arrivent au prochain passage du workflow.</p>', 'no-resize')}</div>`;
    return;
  }

  const tracked = new Map(state.model.players.map((x) => [x.id, x]));
  const me = d.players.find((r) => r.steam64 === focusId);
  const myTeam = me?.team ?? d.teams[0]?.team;
  const ours = d.teams.find((t) => t.team === myTeam) ?? d.teams[0];
  const theirs = d.teams.find((t) => t !== ours) ?? d.teams[1];
  const won = (ours?.score ?? 0) > (theirs?.score ?? 0);
  const src = summary?.source ?? 'other';
  const friends = d.players.filter((r) => r.steam64 !== focusId && tracked.has(r.steam64)).map((r) => tracked.get(r.steam64).name);

  const header = win(`${d.map} · ${SOURCE_LABEL[src] ?? 'Match'}`, `
    <div class="flex items-center justify-between gap-3">
      <div class="min-w-0">
        <h1 class="m-0 text-[22px]">${esc(d.map)}</h1>
        <p class="m-0 text-[13px] muted">${when(d.finishedAt, state.model.tz, state.now)}${friends.length ? ` · avec ${friends.map(esc).join(', ')}` : ''}</p>
      </div>
      <div class="sunken px-3 py-1 text-center">
        <span class="block text-[24px] font-bold tabular-nums ${won ? 'up' : 'down'}">${ours?.score ?? '–'} – ${theirs?.score ?? '–'}</span>
        <span class="caps block !text-[9px] muted">${won ? 'Victoire' : 'Défaite'}</span>
      </div>
    </div>
    ${d.bannedPlayer ? '<p class="mx-0 mb-0 mt-2 text-[12px] down">Un joueur de ce match a été banni depuis.</p>' : ''}`, 'no-resize');

  const mine = me ? win(`Le match de ${p?.name ?? me.name}`, `<div class="sunken">${[
    ['Kills / morts', `${me.k} / ${me.d} (${num(me.d ? me.k / me.d : me.k, 2)})`],
    ['Headshots', `${me.hsKills ?? '—'} kills · ${pct(me.hs)} des tirs`],
    ['Multi-kills', `${me.k3 ?? 0} × 3K · ${me.k4 ?? 0} × 4K · ${me.k5 ?? 0} × ace`],
    ['MVP', me.mvps ?? '—'],
    ['Précision (ennemi visible)', pct(me.acc)],
    ['Preaim', typeof me.preaim === 'number' ? `${num(me.preaim, 1)}°` : '—'],
    ['Temps de réaction', typeof me.reaction === 'number' ? `${Math.round(me.reaction < 10 ? me.reaction * 1000 : me.reaction)} ms` : '—'],
    ['Ennemis flashés', `${me.flashed ?? '—'}${me.flashKills ? ` · ${me.flashKills} kills derrière` : ''}`],
    ['Dégâts HE par grenade', num(me.he, 1)],
    ['Trades réussis', me.trades ?? '—'],
  ].map(([k, v]) => `<div class="lv-row"><span class="flex-1">${k}</span><span class="font-bold accent tabular-nums text-right">${v}</span></div>`).join('')}</div>`, 'no-resize') : '';

  const teamOf = (t) => d.players.filter((r) => r.team === t?.team);
  app.innerHTML = `<div class="app">${back}${header}
    ${scoreboard(teamOf(ours), me ? `Équipe de ${p?.name ?? me.name}` : 'Équipe 1', `${ours?.score ?? '–'}`, won, tracked, focusId)}
    ${scoreboard(teamOf(theirs), 'Adversaires', `${theirs?.score ?? '–'}`, !won, tracked, focusId)}
    ${mine}
    <p class="mx-0 mt-2 text-center text-[12px] muted">Tableau des scores fourni par Leetify. Rating Leetify ×100, ADR = dégâts moyens par round.</p>
  </div>`;
}

// Navigation et événements

let current = null;

function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  const mt = location.hash.match(/^#\/m\/([^/]+)\/(.+)$/);
  if (current === 'home' && (m || mt)) state.homeScroll = scrollY;
  if (!state.model) return renderEmpty();
  if (mt) {
    current = 'match';
    renderMatch(decodeURIComponent(mt[1]), decodeURIComponent(mt[2]));
  } else if (m) {
    current = 'player';
    state.playerMetric = null;
    renderPlayer(decodeURIComponent(m[1]));
  } else if (current !== 'home') {
    const fromPlayer = current === 'player';
    current = 'home';
    renderHome();
    if (fromPlayer) requestAnimationFrame(() => scrollTo(0, state.homeScroll));
  }
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
  const tr = e.target.closest('tr[data-href]');
  if (tr && !e.target.closest('a')) {
    location.hash = tr.dataset.href;
    return;
  }

  const sortLink = e.target.closest('[data-sort]');
  if (sortLink) {
    e.preventDefault();
    sortBy(sortLink.dataset.sort);
    if (!sortLink.closest('#ranking')) document.getElementById('ranking')?.scrollIntoView();
    return;
  }

  const seg = e.target.closest('[data-seg] button');
  if (seg) {
    seg.parentElement.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', b === seg));
    state.playerMetric = seg.dataset.value;
    const p = state.model.players.find((x) => location.hash.endsWith(encodeURIComponent(x.id)));
    document.getElementById('chart').innerHTML = lineChart(state.model.dates, p.series[seg.dataset.value] ?? []);
    bindChart(app, fmt);
    return;
  }

  const fold = e.target.closest('[data-fold]');
  if (fold) {
    const open = fold.getAttribute('aria-expanded') !== 'true';
    fold.setAttribute('aria-expanded', open);
    fold.textContent = open ? 'Masquer' : 'Afficher';
    document.getElementById(`fold-${fold.dataset.fold}`).classList.toggle('open', open);
    if (fold.dataset.fold === 'fun') { state.funOpen = open; store.set('funOpen', open); }
    return;
  }

  const back = e.target.closest('[data-back]');
  if (back) {
    e.preventDefault();
    // Retour comme dans un navigateur si on vient d'une autre page du site, sinon vers le lien prévu.
    if (state.navigated) history.back();
    else location.hash = back.getAttribute('href');
  }
});

app.addEventListener('input', (e) => {
  if (e.target.id === 'search') {
    state.query = e.target.value;
    rerenderRows();
  }
});

addEventListener('hashchange', () => {
  state.navigated = true;
  route();
});

renderLoading();
await load();
route();
