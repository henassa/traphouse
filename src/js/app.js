import { bindChart, lineChart } from './chart.js';
import { mmColor, mmName, mmShort, premierColor, PREMIER_HEX, SOURCE_COLOR, SOURCE_LABEL } from './ranks.js';
import { addDays, avgRating, buildModel, currentStreak, favoriteMap, record } from './stats.js';
import { ago, avatar, countUp, delta, esc, faceitBadge, fillMeters, fmt, icon, leetifyRating, loadRankImages, mmBadge, premierBadge, rankColor, reducedMotion, signed, tag, when } from './ui.js';

const DEMO = new URLSearchParams(location.search).has('demo');
const BASE = DEMO ? 'demo/' : 'data/';
const app = document.getElementById('app');

const TABS = {
  elo: { label: 'FACEIT', source: 'faceit' },
  premier: { label: 'Premier', source: 'premier' },
  mm: { label: 'Matchmaking', source: 'mm' },
};

const store = {
  get(k, d) { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};

const state = {
  model: null,
  latest: null,
  now: new Date(),
  tab: store.get('tab', 'elo'),
  period: store.get('period', 1),
  query: '',
  funOpen: store.get('funOpen', true),
  homeScroll: 0,
  playerMetric: null,
  cameFromHome: false,
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

function summary() {
  const { latest, model } = state;
  const { players, today } = model;
  const avg = (key) => {
    const v = players.map((p) => p.cur[key]).filter((x) => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  };
  const todayMatches = new Set(players.flatMap((p) => p.matches.filter((m) => m.day === today).map((m) => m.id))).size;
  const cell = (label, value, tab) => `
    <${tab ? `a href="#ranking" data-goto-tab="${tab}"` : 'div'} class="sunken block px-2.5 py-2 !no-underline">
      <span class="caps block !text-[10px] muted">${label}</span>
      <span class="accent block text-[22px] font-bold leading-7 tabular-nums" ${value != null ? `data-count="${Math.round(value)}"` : ''}>${fmt(value)}</span>
    </${tab ? 'a' : 'div'}>`;
  return win(latest.group ?? 'Traphouse', `
    <p class="m-0 text-[13px] muted">Mis à jour ${ago(latest.generatedAt, state.now)} · ${players.length} joueurs suivis</p>
    <div class="mt-2.5 flex items-center gap-3">
      <input id="search" class="search" type="search" placeholder="Rechercher un joueur…" autocomplete="off" value="${esc(state.query)}">
      <label class="check text-[13px]"><input type="checkbox" data-toggle="period" ${state.period === 7 ? 'checked' : ''}>Sur 7 jours</label>
    </div>
    ${staleBanner()}
    <div id="summary-cells" class="mt-2.5 grid grid-cols-2 gap-2 sm:grid-cols-4 ${state.query ? 'hidden' : ''}">
      ${cell('Joueurs', players.length)}
      ${cell('Matchs du jour', todayMatches)}
      ${cell('ELO moyen', avg('elo'), 'elo')}
      ${cell('Premier moyen', avg('premier'), 'premier')}
    </div>`, 'pop no-resize');
}

const AWARD_ICON = { day: 'crown', week: 'star', month: 'trophy' };

function awards() {
  const rows = state.model.awards.map(({ key, title, winner }) => {
    if (!winner) {
      return `<div class="lv-row"><span class="accent">${icon(AWARD_ICON[key], 'size-5')}</span>
        <div class="flex-1"><p class="caps m-0 !text-[10px] muted">${title}</p><p class="m-0 muted italic">Personne n’a joué</p></div></div>`;
    }
    const { player: p, score, elo, premier, w, l } = winner;
    const parts = [`${w} V · ${l} D`];
    if (elo) parts.push(`${signed(elo)} ELO`);
    if (premier) parts.push(`${signed(premier)} Premier`);
    return `<a class="lv-row" href="${playerLink(p)}">
      <span class="accent">${icon(AWARD_ICON[key], 'size-5')}</span>
      ${avatar(p, 36)}
      <div class="min-w-0 flex-1">
        <p class="caps m-0 !text-[10px] muted">${title}</p>
        <p class="pop m-0 truncate text-[16px] font-bold">${esc(p.name)}</p>
        <p class="m-0 truncate text-[12px] muted">${parts.join(' · ')}</p>
      </div>
      <div class="text-right">
        <p class="m-0 text-[18px] font-bold tabular-nums ${score >= 0 ? 'up' : 'down'}" data-count="${score}" data-signed="1">${signed(score)}</p>
        <p class="m-0 text-[11px] muted">pts</p>
      </div>
    </a>`;
  }).join('');
  return win('Distinctions', `
    <div class="sunken">${rows}</div>
    <p class="mx-0 mb-0 mt-2 text-[12px] muted">Score = ELO gagné + gain Premier ÷ 10 + 15 par victoire − 10 par défaite sur la période, au moins un match joué.</p>`,
  'no-resize', 'awards');
}

function rankingRows() {
  const { tab, period, query } = state;
  const { today } = state.model;
  const t = TABS[tab];
  const q = query.trim().toLowerCase();
  const all = state.model.players;
  const ranked = all.filter((p) => p.cur[tab] != null)
    .sort((a, b) => b.cur[tab] - a.cur[tab] || (b.cur.premier ?? 0) - (a.cur.premier ?? 0));
  const missing = all.filter((p) => p.cur[tab] == null);
  const shown = ranked.map((p, i) => ({ p, i }))
    .filter(({ p }) => !q || `${p.name} ${p.faceit?.nickname ?? ''} ${p.steamName ?? ''}`.toLowerCase().includes(q));

  const rows = shown.map(({ p, i }) => {
    const games = p.matches.filter((m) => m.source === t.source && m.day > addDays(today, -7)).length;
    let value, sub, unit = '';
    if (tab === 'elo') {
      value = `${faceitBadge(p.faceit.level, 26)}<span class="w-12 text-right text-[15px] font-bold tabular-nums" data-count="${p.cur.elo}">${fmt(p.cur.elo)}</span>`;
      sub = `Niveau ${p.faceit.level ?? '—'}`;
    } else if (tab === 'premier') {
      value = premierBadge(p.cur.premier, premierColor(p.cur.premier), 'min-w-[60px] text-right');
      sub = 'Rating Premier';
    } else {
      value = mmBadge(p.cur.mm, mmShort(p.cur.mm), mmName(p.cur.mm), mmColor(p.cur.mm), 'min-w-[46px] text-center', 24);
      sub = esc(p.leetify.mmBest.map);
      unit = Math.abs(p.delta[period].mm ?? 0) > 1 ? 'rangs' : 'rang';
    }
    const subGames = games ? ` · ${games} match${games > 1 ? 's' : ''}` : '';
    return `<a class="lv-row fade-in" href="${playerLink(p)}">
      <span class="w-5 shrink-0 text-center text-[13px] tabular-nums ${i < 3 ? 'accent font-bold' : 'muted'}">${i + 1}</span>
      ${avatar(p, 32)}
      <div class="min-w-0 flex-1">
        <p class="m-0 truncate text-[15px]">${esc(p.name)}</p>
        <p class="m-0 truncate text-[12px] muted">${sub}${subGames}</p>
      </div>
      <div class="flex flex-col items-end gap-0.5">
        <div class="flex items-center gap-1.5">${value}</div>
        <span class="text-[12px]">${delta(p.delta[period][tab], tab === 'mm' ? unit : '')}</span>
      </div>
    </a>`;
  }).join('');

  const empty = !shown.length ? `<div class="lv-row muted italic">${q ? 'Aucun joueur trouvé' : 'Aucune donnée pour ce classement'}</div>` : '';
  const missingNote = missing.length && !q
    ? `<p class="mx-0 mb-0 mt-2 text-[12px] muted">Sans ${tab === 'elo' ? 'compte FACEIT' : tab === 'premier' ? 'rating Premier' : 'rang compétitif'} : ${missing.map((p) => esc(p.name)).join(', ')}.</p>`
    : '';
  return `<div class="sunken">
      <div class="lv-head caps !text-[10px] muted"><span class="w-5 text-center">#</span><span class="flex-1">Joueur</span><span>${tab === 'elo' ? 'Niv. · ELO' : tab === 'premier' ? 'Rating' : 'Rang'}</span></div>
      ${rows}${empty}
    </div>${missingNote}`;
}

function ranking() {
  const { tab, period } = state;
  const notes = [period === 7 ? 'Évolution sur 7 jours' : 'Évolution depuis hier soir', 'matchs joués sur 7 jours'];
  if (tab === 'mm') notes.push('meilleur rang toutes cartes');
  return win(`Classement ${TABS[tab].label}`, `
    <p class="mx-0 mb-2 mt-0 text-[12px] muted">${notes.join(' · ')}.</p>
    <div id="rows">${rankingRows()}</div>`, '', 'ranking');
}

function funStats() {
  const f = state.model.fun;
  const cell = (label, name, value, p = null, wide = false) => `
    <${p ? `a href="${playerLink(p)}"` : 'div'} class="lv-row sunken !border-b-0 ${wide ? 'col-span-2' : ''}">
      <div class="min-w-0">
        <p class="caps m-0 !text-[10px] muted">${label}</p>
        <p class="m-0 truncate text-[15px] font-bold ${p ? 'accent' : ''}">${name}</p>
        <p class="m-0 truncate text-[12px] muted tabular-nums">${value}</p>
      </div>
    </${p ? 'a' : 'div'}>`;
  const none = (label) => cell(label, '—', 'Pas assez de matchs');
  const items = [
    f.streak ? cell('Meilleure série', esc(f.streak.player.name), `${f.streak.streak} victoires d’affilée`, f.streak.player) : none('Meilleure série'),
    f.tryhard ? cell('Plus gros tryhard', esc(f.tryhard.player.name), `${f.tryhard.games} matchs sur 7 j`, f.tryhard.player) : none('Plus gros tryhard'),
    f.drop ? cell('Pire chute', esc(f.drop.player.name), `${signed(f.drop.drop)} ELO sur 7 j`, f.drop.player) : cell('Pire chute', 'Personne', 'Aucune perte d’ELO'),
    f.rating ? cell('Meilleur rating', esc(f.rating.player.name), `${leetifyRating(f.rating.rating)} de moyenne`, f.rating.player) : none('Meilleur rating'),
    f.map ? cell('Map préférée du groupe', esc(f.map.map), `${f.map.n} matchs sur 30 j · ${Math.round((f.map.w / f.map.n) * 100)} % de victoires`, null, true) : '',
  ];
  return win('En bref', `
    <div class="flex items-center justify-between">
      <span class="text-[12px] muted">Sur les 7 et 30 derniers jours</span>
      <button class="small" data-fold="fun" aria-expanded="${state.funOpen}">${state.funOpen ? 'Masquer' : 'Afficher'}</button>
    </div>
    <div class="fold ${state.funOpen ? 'open' : ''}" id="fold-fun">
      <div><div class="grid grid-cols-2 gap-2 pt-2.5">${items.join('')}</div></div>
    </div>`);
}

function footer() {
  const { latest } = state;
  const at = new Intl.DateTimeFormat('fr-FR', { dateStyle: 'medium', timeStyle: 'short', timeZone: latest.timezone }).format(new Date(latest.generatedAt));
  return `<p class="mx-0 mt-4 text-center text-[12px] muted">Données FACEIT et Leetify, mises à jour toutes les heures.<br>Dernière mise à jour : ${at}${DEMO ? ' · données de démonstration' : ''}</p>`;
}

function homeContent() {
  if (state.query.trim()) return `<section class="window headless no-resize">${rankingRows()}</section>`;
  return awards() + ranking() + funStats() + footer();
}

function tabsNav() {
  return `<nav class="tabs" role="tablist">
    ${Object.entries(TABS).map(([k, v]) => `<li role="tab" aria-selected="${k === state.tab}"><a href="#ranking" data-tab="${k}">${v.label}</a></li>`).join('')}
  </nav>`;
}

function renderHome() {
  document.title = state.latest.group ?? 'Traphouse';
  app.innerHTML = `<div class="app">${tabsNav()}${summary()}<div id="content">${homeContent()}</div></div>`;

  const input = document.getElementById('search');
  input.addEventListener('input', () => {
    state.query = input.value;
    document.getElementById('summary-cells').classList.toggle('hidden', !!input.value.trim());
    document.getElementById('content').innerHTML = homeContent();
  });
  countUp(app);
}

function selectTab(tab) {
  state.tab = tab;
  store.set('tab', tab);
  document.querySelectorAll('nav.tabs li').forEach((li) => li.setAttribute('aria-selected', li.querySelector('a').dataset.tab === tab));
  if (state.query.trim()) document.getElementById('content').innerHTML = homeContent();
  else rerenderRanking();
}

function rerenderRanking() {
  const section = document.getElementById('ranking');
  if (!section) { document.getElementById('content').innerHTML = homeContent(); return; }
  const holder = document.createElement('div');
  holder.innerHTML = ranking();
  const fresh = holder.firstElementChild;
  section.replaceWith(fresh);
  countUp(fresh);
}

function scrollToId(id) {
  const el = document.getElementById(id);
  if (!el) return;
  scrollTo({ top: el.getBoundingClientRect().top + scrollY - 48, behavior: reducedMotion() ? 'auto' : 'smooth' });
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

  const cell = (label, value, sub) => `
    <div class="sunken min-w-0 px-2.5 py-2">
      <span class="caps block !text-[10px] muted">${label}</span>
      <div class="flex items-center gap-1.5 text-[20px] font-bold leading-7 tabular-nums">${value}</div>
      <span class="block truncate text-[12px] muted">${sub}</span>
    </div>`;
  const cells = [
    p.faceit
      ? cell('FACEIT', `${faceitBadge(p.faceit.level, 28)}<span class="accent" data-count="${p.faceit.elo}">${fmt(p.faceit.elo)}</span>`, `${delta(p.delta[7].elo)} sur 7 j`)
      : cell('FACEIT', '<span class="muted">—</span>', 'Pas de compte'),
    p.cur.premier != null
      ? cell('Premier', premierBadge(p.cur.premier, premierColor(p.cur.premier), '!text-[18px] !leading-[24px]'), `${delta(p.delta[7].premier)} sur 7 j`)
      : cell('Premier', '<span class="muted">—</span>', p.leetify ? 'Pas encore classé' : 'Pas de Leetify'),
    p.cur.mm != null
      ? cell('Meilleur rang', mmBadge(p.cur.mm, mmShort(p.cur.mm), mmName(p.cur.mm), mmColor(p.cur.mm), '!text-[18px] !leading-[24px]', 28), `${mmName(p.cur.mm)} · ${esc(p.leetify.mmBest.map)}`)
      : cell('Meilleur rang', '<span class="muted">—</span>', 'Aucun rang compétitif'),
    rec.n
      ? cell('Victoires 30 j', `<span class="accent">${Math.round((rec.w / Math.max(1, rec.w + rec.l)) * 100)} %</span>`, `${rec.w} V · ${rec.l} D`)
      : cell('Victoires 30 j', '<span class="muted">—</span>', 'Aucun match récent'),
  ].join('');

  const links = [
    p.faceit?.url && ['FACEIT', p.faceit.url],
    ['Leetify', p.leetify?.url ?? `https://leetify.com/app/profile/${p.steam64}`],
    ['Steam', `https://steamcommunity.com/profiles/${p.steam64}`],
  ].filter(Boolean);

  const header = win(p.name, `
    <div class="flex items-center gap-3">
      <span class="pop">${avatar(p, 64)}</span>
      <div class="min-w-0">
        <h1 class="m-0 truncate text-[22px]">${esc(p.name)}</h1>
        <p class="m-0 truncate text-[13px] muted">${[p.faceit?.nickname, p.steamName].filter(Boolean).map(esc).join(' · ') || 'Steam ' + esc(p.steam64)}</p>
        ${DEMO ? '' : `<p class="m-0 mt-1 flex gap-3 text-[13px]">${links.map(([l, u]) => `<a href="${esc(u)}" target="_blank" rel="noopener">${l}</a>`).join('')}</p>`}
      </div>
    </div>
    <div class="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">${cells}</div>`, 'no-resize');

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
        <progress class="meter" max="100" value="0" data-to="${Math.max(0, Math.min(100, Math.round(v)))}"></progress>
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
        ${comp.map((c) => `<div class="lv-row"><span class="flex-1">${esc(c.map)}</span><span class="text-[12px] muted">${mmName(c.rank)}</span>${mmBadge(c.rank, mmShort(c.rank), mmName(c.rank), mmColor(c.rank), 'min-w-[46px] text-center', 24)}</div>`).join('')}
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
    return m.url ? `<a class="lv-row" href="${esc(m.url)}" target="_blank" rel="noopener">${row}</a>` : `<div class="lv-row">${row}</div>`;
  }).join('');

  const notes = [];
  if (p.leetify?.privacy === 'private') notes.push('Profil Leetify privé : les matchs Premier et compétitifs ne sont pas visibles.');
  if (!p.leetify) notes.push('Pas de profil Leetify trouvé pour ce Steam ID.');
  if (p.errors?.length) notes.push(`Dernière mise à jour incomplète : ${p.errors.map(esc).join(' ; ')}.`);

  return `<div class="app fade-in">
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
      ${recent ? '<p class="mx-0 mb-0 mt-2 text-[12px] muted">Score de l’équipe du joueur en premier, rating Leetify en dessous.</p>' : ''}`, '', 'matches')}
    ${notes.length ? `<div class="sunken flex items-start gap-2 px-2.5 py-2 text-[13px]"><span class="accent">${icon('warning')}</span><span>${notes.join('<br>')}</span></div>` : ''}
  </div>`;
}

function renderPlayer(id) {
  const p = state.model.players.find((x) => x.id === id);
  if (!p) { location.hash = '#/'; return; }
  document.title = `${p.name} · ${state.latest.group ?? 'Traphouse'}`;
  app.innerHTML = playerPage(p);
  scrollTo(0, 0);
  bindChart(app, fmt);
  countUp(app);
  fillMeters(app);
}

// Navigation et événements

let current = null;

function route() {
  const m = location.hash.match(/^#\/p\/(.+)$/);
  if (current === 'home' && m) state.homeScroll = scrollY;
  if (!state.model) return renderEmpty();
  if (m) {
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
    <p class="m-0 text-[13px]">Récupération des classements<span class="blink">_</span></p>
    <progress class="meter" max="100" value="0" data-to="100"></progress>`, 'no-resize')}</div>`;
  fillMeters(app);
}

app.addEventListener('click', (e) => {
  const tab = e.target.closest('[data-tab]');
  if (tab) {
    e.preventDefault();
    selectTab(tab.dataset.tab);
    return;
  }

  const goto = e.target.closest('[data-goto-tab]');
  if (goto) {
    e.preventDefault();
    selectTab(goto.dataset.gotoTab);
    scrollToId('ranking');
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
    if (state.cameFromHome) history.back();
    else location.hash = '#/';
  }
});

app.addEventListener('change', (e) => {
  if (e.target.matches('[data-toggle="period"]')) {
    state.period = e.target.checked ? 7 : 1;
    store.set('period', state.period);
    if (state.query.trim()) document.getElementById('content').innerHTML = homeContent();
    else rerenderRanking();
  }
});

addEventListener('hashchange', () => {
  state.cameFromHome = current === 'home';
  route();
});

renderLoading();
await Promise.all([load(), loadRankImages()]);
route();
