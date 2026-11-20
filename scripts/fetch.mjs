// Appelé par le workflow : lit players.json, interroge FACEIT / Leetify / Steam et écrit data/.
// Une source qui échoue ne casse rien : on garde les dernières valeurs connues du joueur.
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { addDays, dayKey, mergeMatches, perfOf, readJson, snapshotOf } from './lib/store.mjs';
import { downloadTiers, fetchValorant } from './valorant.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'data');

const FACEIT_KEY = process.env.FACEIT_API_KEY;
// Copier-coller depuis le site ajoute parfois des espaces, des guillemets ou un "Bearer " en trop.
const LEETIFY_KEY = (process.env.LEETIFY_API_KEY ?? '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '') || null;
// La doc accepte la clé dans "Authorization: Bearer <clé>" ou dans "_leetify_key: <clé>" : on garde celui qui marche.
let leetifyHeaderMode = 'bearer';
const leetifyHeaders = (key) => (!key ? {} : leetifyHeaderMode === 'raw' ? { _leetify_key: key } : { Authorization: `Bearer ${key}` });
const STEAM_KEY = process.env.STEAM_API_KEY;
const HENRIK_KEY = (process.env.HENRIK_API_KEY ?? '').trim() || null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class HttpError extends Error {
  constructor(status, url) {
    super(`HTTP ${status} sur ${new URL(url).pathname}`);
    this.status = status;
  }
}

// Requêtes espacées par hôte + retries sur 429/5xx avec back-off.
const lastCall = new Map();
async function getJson(url, { headers = {}, gap = 500, tries = 3 } = {}) {
  const host = new URL(url).host;
  for (let attempt = 1; ; attempt++) {
    const wait = (lastCall.get(host) ?? 0) + gap - Date.now();
    if (wait > 0) await sleep(wait);
    lastCall.set(host, Date.now());

    const res = await fetch(url, { headers: { Accept: 'application/json', ...headers }, signal: AbortSignal.timeout(15000) });
    if (res.ok) return res.json();
    if (res.status === 404) return null;

    const retryable = res.status === 429 || res.status >= 500;
    if (!retryable || attempt >= tries) throw new HttpError(res.status, url);
    const retryAfter = Number(res.headers.get('retry-after')) * 1000;
    await sleep(retryAfter || 5000 * 3 ** (attempt - 1));
  }
}

const mapLabel = (name = '') =>
  name.replace(/^(de|cs|ar)_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

// FACEIT

async function fetchFaceit(player) {
  const auth = { Authorization: `Bearer ${FACEIT_KEY}` };
  const base = 'https://open.faceit.com/data/v4';
  const query = player.faceit
    ? `nickname=${encodeURIComponent(player.faceit)}`
    : `game=cs2&game_player_id=${player.steam64}`;

  const profile = await getJson(`${base}/players?${query}`, { headers: auth, gap: 250 });
  const cs2 = profile?.games?.cs2;
  // CS2 ajouté sur FACEIT mais jamais joué en classé : pas de niveau, ELO par défaut (0 ou 1000). On l'ignore.
  if (!cs2 || !cs2.skill_level || !cs2.faceit_elo) return { profile: null, matches: [] };

  const from = Math.floor(Date.now() / 1000) - 35 * 86400;
  const history = await getJson(
    `${base}/players/${profile.player_id}/history?game=cs2&from=${from}&limit=50`,
    { headers: auth, gap: 250 },
  );

  const matches = (history?.items ?? [])
    .filter((m) => m.status === 'finished' || m.finished_at)
    .map((m) => {
      const faction = Object.entries(m.teams ?? {}).find(([, t]) =>
        t.players?.some((p) => p.player_id === profile.player_id),
      )?.[0];
      return {
        id: `faceit:${m.match_id}`,
        source: 'faceit',
        at: new Date(m.finished_at * 1000).toISOString(),
        result: !m.results?.winner || !faction ? null : m.results.winner === faction ? 'W' : 'L',
        url: m.faceit_url?.replace('{lang}', 'fr') ?? null,
      };
    });

  return {
    profile: {
      playerId: profile.player_id,
      nickname: profile.nickname,
      avatar: profile.avatar || null,
      elo: cs2.faceit_elo ?? null,
      level: cs2.skill_level ?? null,
      url: `https://www.faceit.com/fr/players/${profile.nickname}`,
    },
    matches,
  };
}

// Leetify

// La doc donne data_source = "matchmaking", "faceit", "renown", "CS_API"… et rank_type = "premier",
// "matchmaking", "wingman" ou null. Le rang tranche : Premier se compte en milliers, le compétitif va de 1 à 18.
function leetifySource(m) {
  const src = String(m.data_source ?? '').toLowerCase();
  const type = String(m.rank_type ?? '').toLowerCase();
  if (src.includes('faceit')) return 'faceit';
  if (src.includes('renown')) return 'renown';
  if (type.includes('wingman') || src.includes('wingman')) return 'wingman';
  if (type.includes('premier') || m.rank > 18) return 'premier';
  if (type.includes('matchmaking') || type.includes('competitive') || src.includes('competitive') || (m.rank >= 1 && m.rank <= 18)) return 'mm';
  if (src === 'matchmaking') return 'premier';
  return 'other';
}

async function fetchLeetify(player, key) {
  const headers = leetifyHeaders(key);
  const p = await getJson(
    `https://api-public.cs-prod.leetify.com/v3/profile?steam64_id=${player.steam64}`,
    { headers, gap: 1200 },
  );
  if (!p) return { profile: null, matches: [] };

  const competitive = (p.ranks?.competitive ?? [])
    .filter((c) => c.rank > 0)
    .map((c) => ({ map: mapLabel(c.map_name), rank: c.rank }))
    .sort((a, b) => b.rank - a.rank);

  const matches = (p.recent_matches ?? []).map((m) => ({
    id: `leetify:${m.id}`,
    leetifyId: m.id,
    source: leetifySource(m),
    at: new Date(m.finished_at).toISOString(),
    map: mapLabel(m.map_name),
    result: { win: 'W', loss: 'L', tie: 'T' }[m.outcome] ?? null,
    score: Array.isArray(m.score) ? m.score : null,
    rating: m.leetify_rating ?? null,
    rank: m.rank || null,
  }));

  return {
    profile: {
      name: p.name,
      privacy: p.privacy_mode,
      premier: p.ranks?.premier ?? null,
      wingman: p.ranks?.wingman ?? null,
      leetify: p.ranks?.leetify ?? null,
      // Rating moyen sur les derniers matchs, tel que Leetify le donne match par match.
      avgRating: (() => {
        const r = (p.recent_matches ?? []).map((m) => m.leetify_rating).filter((x) => typeof x === 'number');
        return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
      })(),
      avgRatingMatches: (p.recent_matches ?? []).filter((m) => typeof m.leetify_rating === 'number').length,
      competitive,
      mmBest: competitive[0] ?? null,
      rating: p.rating ?? null,
      winrate: p.winrate ?? null,
      totalMatches: p.total_matches ?? null,
      url: `https://leetify.com/app/profile/${player.steam64}`,
    },
    matches,
  };
}

// Leetify suit aussi les matchs FACEIT : on récupère la carte, le score et le rating
// en rapprochant les deux par l'heure de fin.
function combineMatches(faceitMatches, leetifyMatches) {
  const leetifyFaceit = leetifyMatches.filter((m) => m.source === 'faceit');
  const used = new Set();
  const enriched = faceitMatches.map((fm) => {
    const t = new Date(fm.at).getTime();
    const twin = leetifyFaceit.find((lm) => !used.has(lm.id) && Math.abs(new Date(lm.at).getTime() - t) < 15 * 60e3);
    if (!twin) return fm;
    used.add(twin.id);
    return { ...fm, leetifyId: twin.leetifyId, map: twin.map, score: twin.score, rating: twin.rating, result: fm.result ?? twin.result };
  });
  const others = leetifyMatches.filter((m) => m.source !== 'faceit' || (!faceitMatches.length && !used.has(m.id)));
  return [...enriched, ...others];
}

// Photo de profil Steam sans clé : le profil public existe aussi en XML.
async function fetchSteamAvatar(steam64) {
  const url = `https://steamcommunity.com/profiles/${steam64}/?xml=1`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0 (traphouse dashboard)' },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new HttpError(res.status, url);
  const xml = await res.text();
  const pick = (tag) => xml.match(new RegExp(`<${tag}><!\\[CDATA\\[([^\\]]*)\\]\\]></${tag}>`))?.[1] ?? null;
  const avatar = pick('avatarFull');
  if (!avatar) throw new Error('profil sans photo ou réponse inattendue');
  return { avatar, name: pick('steamID') };
}

// Steam (optionnel) : avatar et pseudo Steam, une seule requête pour 100 joueurs.

async function fetchSteam(ids) {
  const out = new Map();
  for (let i = 0; i < ids.length; i += 100) {
    const batch = ids.slice(i, i + 100).join(',');
    const res = await getJson(
      `https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/?key=${STEAM_KEY}&steamids=${batch}`,
    );
    for (const s of res?.response?.players ?? []) out.set(s.steamid, { avatar: s.avatarfull, name: s.personaname });
  }
  return out;
}

// Détails des matchs (tableau des scores complet) : récupérés une seule fois par match, dans data/matches/.
const MAX_DETAILS = 40;
const DETAIL_DAYS = 45;
const SERIES_DAYS = 90;

function trimDetails(d) {
  return {
    id: d.id,
    finishedAt: d.finished_at,
    dataSource: d.data_source,
    map: mapLabel(d.map_name),
    bannedPlayer: !!d.has_banned_player,
    teams: (d.team_scores ?? []).map((t) => ({ team: t.team_number, score: t.score })),
    players: (d.stats ?? []).map((p) => ({
      steam64: p.steam64_id,
      name: p.name,
      team: p.initial_team_number,
      k: p.total_kills,
      d: p.total_deaths,
      a: p.total_assists,
      adr: p.dpr,
      hs: p.accuracy_head,
      hsKills: p.total_hs_kills,
      rating: p.leetify_rating,
      mvps: p.mvps,
      k1: p.multi1k,
      k2: p.multi2k,
      k3: p.multi3k,
      k4: p.multi4k,
      k5: p.multi5k,
      acc: p.accuracy_enemy_spotted,
      preaim: p.preaim,
      reaction: p.reaction_time,
      flashed: p.flashbang_hit_foe,
      flashKills: p.flashbang_leading_to_kill,
      he: p.he_foes_damage_avg,
      trades: p.trade_kills_succeed,
      rounds: p.rounds_count,
    })),
  };
}

// Les données ne sont pas gardées dans le dépôt : on relit celles du site publié, on les met à jour, on republie.
// Si le site ne répond pas (autre chose qu'un 404 du tout premier passage), on s'arrête :
// mieux vaut sauter une mise à jour que republier un site sans son historique.
async function loadPublished(file, fallback) {
  const base = process.env.PAGES_URL;
  if (!base) return fallback;
  const url = new URL(`data/${file}`, base.endsWith('/') ? base : base + '/');
  const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return fallback;
  if (!res.ok) throw new Error(`Site publié illisible (${res.status} sur ${url.pathname}), mise à jour annulée`);
  return res.json();
}

// Tableaux des scores : un seul fichier, limité aux 45 derniers jours.
async function fetchDetails(players, bundle, key, leetifyDown) {
  const cutoff = Date.now() - DETAIL_DAYS * 864e5;
  for (const [id, d] of Object.entries(bundle)) if (new Date(d.finishedAt).getTime() < cutoff) delete bundle[id];

  const headers = leetifyHeaders(key);
  const todo = players.flatMap((p) => p.matches)
    .filter((m) => m.leetifyId && !bundle[m.leetifyId] && new Date(m.at).getTime() >= cutoff)
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((m) => m.leetifyId)
    .filter((id, i, all) => all.indexOf(id) === i);

  let fetched = 0;
  for (const id of leetifyDown ? [] : todo.slice(0, MAX_DETAILS)) {
    try {
      const d = await getJson(`https://api-public.cs-prod.leetify.com/v2/matches/${id}`, { headers, gap: 1200 });
      if (!d) continue;
      bundle[id] = trimDetails(d);
      fetched++;
    } catch (e) {
      console.log(`Détails ${id} : ${e.message}`);
      if (e.status === 429) break;
    }
  }
  for (const p of players) for (const m of p.matches) m.details = !!(m.leetifyId && bundle[m.leetifyId]);
  console.log(`Détails de matchs : ${fetched} nouveaux, ${Object.keys(bundle).length} sur 45 jours`);
}

// K/D et HLTV « total » : des compteurs cumulés, pour ne pas avoir à garder les vieux matchs.
function updateTotals(p, prevTotals, bundle) {
  const t = prevTotals ? { ...prevTotals, ids: [...(prevTotals.ids ?? [])] } : { k: 0, d: 0, r: 0, mk: 0, n: 0, ids: [] };
  for (const [id, m] of Object.entries(bundle)) {
    if (t.ids.includes(id)) continue;
    const row = m.players?.find((x) => x.steam64 === p.steam64);
    if (!row?.rounds || row.k1 == null) continue;
    t.k += row.k ?? 0;
    t.d += row.d ?? 0;
    t.r += row.rounds;
    t.mk += (row.k1 ?? 0) + 4 * (row.k2 ?? 0) + 9 * (row.k3 ?? 0) + 16 * (row.k4 ?? 0) + 25 * (row.k5 ?? 0);
    t.n++;
    t.ids.push(id);
  }
  // Un match sorti de la fenêtre de 45 jours ne peut plus revenir : inutile de garder son identifiant.
  t.ids = t.ids.filter((id) => bundle[id]);
  return t;
}

function perfFromTotals(t) {
  if (!t?.n || !t.r) return null;
  const kd = t.d ? t.k / t.d : t.k;
  const hltv = (t.k / t.r / 0.679 + (0.7 * (t.r - t.d)) / t.r / 0.317 + t.mk / t.r / 1.277) / 2.7;
  return { kd: Math.round(kd * 100) / 100, hltv: Math.round(hltv * 100) / 100, matches: t.n };
}

// Un point par jour et par joueur, sur 90 jours, pour les évolutions et les graphiques.
function updateSeries(series, today, players) {
  const s = series?.dates ? series : { dates: [], players: {} };
  if (s.dates.at(-1) !== today) {
    s.dates.push(today);
    for (const v of Object.values(s.players)) for (const k of ['elo', 'premier', 'mm']) v[k].push(null);
  }
  const i = s.dates.length - 1;
  for (const p of players) {
    s.players[p.id] ??= { elo: Array(s.dates.length).fill(null), premier: Array(s.dates.length).fill(null), mm: Array(s.dates.length).fill(null) };
    const snap = snapshotOf(p);
    for (const k of ['elo', 'premier', 'mm']) s.players[p.id][k][i] = snap[k];
  }
  const first = s.dates.findIndex((d) => d > addDays(today, -SERIES_DAYS));
  if (first > 0) {
    s.dates = s.dates.slice(first);
    for (const v of Object.values(s.players)) for (const k of ['elo', 'premier', 'mm']) v[k] = v[k].slice(first);
  }
  const ids = new Set(players.map((p) => p.id));
  for (const id of Object.keys(s.players)) if (!ids.has(id)) delete s.players[id];
  return s;
}

async function main() {
  const config = await readJson(join(ROOT, 'players.json'));
  if (!config?.players?.length) throw new Error('players.json est vide ou illisible');

  const previous = await loadPublished('latest.json', { players: [] });
  const prevSeries = await loadPublished('series.json', null);
  const bundle = await loadPublished('matches.json', {});
  console.log(`Données publiées relues : ${previous.players.length} joueurs, ${Object.keys(bundle).length} matchs détaillés`);
  const prevById = new Map(previous.players.map((p) => [p.id, p]));
  const now = new Date();
  const sources = {
    faceit: { ok: 0, failed: 0, skipped: !FACEIT_KEY },
    leetify: { ok: 0, failed: 0, skipped: false },
    steam: { ok: 0, failed: 0, skipped: !STEAM_KEY },
  };
  let leetifyDown = false;
  const avatarStats = { ok: 0, failed: 0, last: null };
  let leetifyKey = LEETIFY_KEY;

  // Vérification documentée par Leetify (/api-key/validate) : on essaie les deux en-têtes acceptés.
  if (leetifyKey) {
    const check = async (headers) => {
      const res = await fetch('https://api-public.cs-prod.leetify.com/api-key/validate', { headers, signal: AbortSignal.timeout(15000) }).catch(() => null);
      return res?.status ?? 'réseau';
    };
    const bearer = await check({ Authorization: `Bearer ${leetifyKey}` });
    let raw = null;
    if (bearer !== 200) {
      raw = await check({ _leetify_key: leetifyKey });
      if (raw === 200) leetifyHeaderMode = 'raw';
    }
    console.log(`Clé Leetify (${leetifyKey.length} caractères) : Bearer → ${bearer}${raw != null ? `, _leetify_key → ${raw}` : ''}`);
    if (bearer === 401 && raw === 401) {
      console.warn('Clé Leetify refusée par les deux en-têtes : on continue sans clé (limites plus basses).');
      sources.leetify.error = 'Clé refusée, collecte sans clé';
      leetifyKey = null;
    }
  }

  let steam = new Map();
  if (STEAM_KEY) {
    try {
      steam = await fetchSteam(config.players.map((p) => p.steam64));
      sources.steam.ok = steam.size;
    } catch (e) {
      sources.steam.failed = 1;
      sources.steam.error = e.message;
    }
  }

  const players = [];
  // Une entrée peut être juste un Steam ID ("7656…") ou un objet { steam64, name?, faceit? }.
  const entries = config.players.map((e) => (typeof e === 'string' || typeof e === 'number' ? { steam64: String(e) } : e));

  for (const cfg of entries) {
    const id = String(cfg.steam64);
    const prev = prevById.get(id) ?? {};
    const errors = [];
    let faceit = prev.faceit ?? null;
    let leetify = prev.leetify ?? null;
    let faceitMatches = null;
    let leetifyMatches = null;

    // "faceit": false dans players.json pour un joueur qui n'a pas de compte.
    if (FACEIT_KEY && cfg.faceit !== false) {
      try {
        const r = await fetchFaceit({ ...cfg, steam64: id });
        faceit = r.profile && { ...r.profile, updatedAt: now.toISOString() };
        faceitMatches = r.matches;
        sources.faceit.ok++;
      } catch (e) {
        sources.faceit.failed++;
        errors.push(`FACEIT : ${e.message}`);
      }
    }

    if (!leetifyDown) {
      try {
        const r = await fetchLeetify({ steam64: id }, leetifyKey);
        leetify = r.profile && { ...r.profile, updatedAt: now.toISOString() };
        leetifyMatches = r.matches;
        sources.leetify.ok++;
      } catch (e) {
        sources.leetify.failed++;
        errors.push(`Leetify : ${e.message}`);
        // Si Leetify nous limite, inutile d'insister pour les joueurs suivants.
        if (e.status === 429) leetifyDown = true;
      }
    } else {
      errors.push('Leetify : ignoré après un 429');
    }

    const prevMatches = prev.matches ?? [];
    const fresh = combineMatches(
      faceitMatches ?? prevMatches.filter((m) => m.source === 'faceit'),
      leetifyMatches ?? [],
    );
    let s = steam.get(id);
    let steamCheckedAt = prev.steamCheckedAt ?? null;
    // Sans clé Steam : photo lue sur le profil public, une fois par jour. Un échec sera retenté au passage suivant.
    if (!s && (!prev.steamAvatar || !steamCheckedAt || now - new Date(steamCheckedAt) > 864e5)) {
      try {
        s = await fetchSteamAvatar(id);
        steamCheckedAt = now.toISOString();
        avatarStats.ok++;
      } catch (e) {
        avatarStats.failed++;
        avatarStats.last = e.message;
      }
      await sleep(400);
    }

    players.push({
      id,
      // Sans nom dans players.json : pseudo FACEIT, puis nom Leetify, puis pseudo Steam.
      name: cfg.name || faceit?.nickname || leetify?.name || s?.name || prev.name || id,
      steam64: id,
      // La photo Steam d'abord, celle de FACEIT si Steam n'en donne pas.
      avatar: s?.avatar || prev.steamAvatar || faceit?.avatar || prev.avatar || null,
      steamAvatar: s?.avatar || prev.steamAvatar || null,
      steamCheckedAt,
      steamName: s?.name || prev.steamName || null,
      faceit,
      leetify,
      matches: mergeMatches(prevMatches, fresh, now),
      errors,
    });
    const found = [faceit && `FACEIT ${faceit.elo}`, leetify && (leetify.premier ? `Premier ${leetify.premier}` : 'Leetify')].filter(Boolean);
    const status = errors.length ? errors.join(' | ') : found.length ? found.join(', ') : 'introuvable sur FACEIT et Leetify (Steam ID correct ?)';
    console.log(`${(cfg.name || id).padEnd(18)} ${status}`);
  }

  if (leetifyDown) sources.leetify.error = 'Limite de requêtes atteinte (429)';

  console.log(`Photos Steam : ${avatarStats.ok} récupérées, ${avatarStats.failed} échecs${avatarStats.last ? ` (dernier : ${avatarStats.last})` : ''}${STEAM_KEY ? ', clé Steam utilisée' : ''}`);
  await fetchDetails(players, bundle, leetifyKey, leetifyDown);
  const weekAgo = Date.now() - 7 * 864e5;
  const week = Object.values(bundle).filter((d) => new Date(d.finishedAt).getTime() >= weekAgo);
  for (const p of players) {
    p.totals = updateTotals(p, prevById.get(p.id)?.totals, bundle);
    p.perf = { all: perfFromTotals(p.totals), week: perfOf(week, p.steam64) };
  }

  const timezone = config.timezone ?? 'Europe/Zurich';
  // Valorant : seulement si une clé HenrikDev est fournie et des Riot ID sont listés.
  let valorant = previous.valorant ?? null;
  if (HENRIK_KEY && config.valorant?.length) {
    valorant = await fetchValorant(config, previous.valorant, HENRIK_KEY, now);
    try {
      console.log(`[Valo] emblèmes de rang : ${await downloadTiers(join(DATA, 'valorant-tiers'))} téléchargés`);
    } catch (e) {
      console.log(`[Valo] emblèmes de rang non téléchargés (${e.message}), le site essaiera valorant-api.com`);
    }
  } else if (config.valorant?.length) {
    console.log('[Valo] pas de secret HENRIK_API_KEY : tableau Valorant non mis à jour');
  }

  const latest = { generatedAt: now.toISOString(), timezone, group: config.group ?? 'Traphouse', sources, players, valorant };
  const series = updateSeries(prevSeries, dayKey(now, timezone), players);

  // Écrit dans data/, qui n'est pas suivi par git : le workflow publie ces fichiers avec le site.
  await mkdir(DATA, { recursive: true });
  await writeFile(join(DATA, 'latest.json'), JSON.stringify(latest));
  await writeFile(join(DATA, 'series.json'), JSON.stringify(series));
  await writeFile(join(DATA, 'matches.json'), JSON.stringify(bundle));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
