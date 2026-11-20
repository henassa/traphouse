// Appelé par le workflow : lit players.json, interroge FACEIT / Leetify / Steam et écrit data/.
// Une source qui échoue ne casse rien : on garde les dernières valeurs connues du joueur.
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { mergeMatches, readJson, writeAll } from './lib/store.mjs';

const ROOT = new URL('..', import.meta.url).pathname;
const DATA = join(ROOT, 'data');

const FACEIT_KEY = process.env.FACEIT_API_KEY;
// Copier-coller depuis le site ajoute parfois des espaces, des guillemets ou un "Bearer " en trop.
const LEETIFY_KEY = (process.env.LEETIFY_API_KEY ?? '').trim().replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '') || null;
// La doc accepte la clé dans "Authorization: Bearer <clé>" ou dans "_leetify_key: <clé>" : on garde celui qui marche.
let leetifyHeaderMode = 'bearer';
const leetifyHeaders = (key) => (!key ? {} : leetifyHeaderMode === 'raw' ? { _leetify_key: key } : { Authorization: `Bearer ${key}` });
const STEAM_KEY = process.env.STEAM_API_KEY;

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
  if (!cs2) return { profile: null, matches: [] };

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
const MATCHES = join(DATA, 'matches');
const MAX_DETAILS = 40;

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

async function fetchDetails(players, key, leetifyDown) {
  await mkdir(MATCHES, { recursive: true });
  const have = new Set((await readdir(MATCHES)).map((f) => f.replace(/\.json$/, '')));
  const wanted = new Set(players.flatMap((p) => p.matches.map((m) => m.leetifyId).filter(Boolean)));
  const headers = leetifyHeaders(key);

  let fetched = 0;
  // Les plus récents d'abord, pour que les derniers matchs soient cliquables rapidement.
  const todo = players.flatMap((p) => p.matches).filter((m) => m.leetifyId && !have.has(m.leetifyId))
    .sort((a, b) => b.at.localeCompare(a.at))
    .map((m) => m.leetifyId)
    .filter((id, i, all) => all.indexOf(id) === i);

  for (const id of leetifyDown ? [] : todo.slice(0, MAX_DETAILS)) {
    try {
      const d = await getJson(`https://api-public.cs-prod.leetify.com/v2/matches/${id}`, { headers, gap: 1200 });
      if (!d) continue;
      await writeFile(join(MATCHES, `${id}.json`), JSON.stringify(trimDetails(d)) + '\n');
      have.add(id);
      fetched++;
    } catch (e) {
      console.log(`Détails ${id} : ${e.message}`);
      if (e.status === 429) break;
    }
  }

  // Nettoyage : on ne garde que les matchs encore affichés (fenêtre de 45 jours).
  for (const id of have) {
    if (!wanted.has(id)) {
      await rm(join(MATCHES, `${id}.json`), { force: true });
      have.delete(id);
    }
  }
  for (const p of players) for (const m of p.matches) m.details = !!(m.leetifyId && have.has(m.leetifyId));
  console.log(`Détails de matchs : ${fetched} nouveaux, ${have.size} en tout`);
}

async function main() {
  const config = await readJson(join(ROOT, 'players.json'));
  if (!config?.players?.length) throw new Error('players.json est vide ou illisible');

  const previous = await readJson(join(DATA, 'latest.json'), { players: [] });
  const prevById = new Map(previous.players.map((p) => [p.id, p]));
  const now = new Date();
  const sources = {
    faceit: { ok: 0, failed: 0, skipped: !FACEIT_KEY },
    leetify: { ok: 0, failed: 0, skipped: false },
    steam: { ok: 0, failed: 0, skipped: !STEAM_KEY },
  };
  let leetifyDown = false;
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
    const s = steam.get(id);

    players.push({
      id,
      // Sans nom dans players.json : pseudo FACEIT, puis nom Leetify, puis pseudo Steam.
      name: cfg.name || faceit?.nickname || leetify?.name || s?.name || prev.name || id,
      steam64: id,
      avatar: faceit?.avatar || s?.avatar || prev.avatar || null,
      steamName: s?.name ?? prev.steamName ?? null,
      faceit,
      leetify,
      matches: mergeMatches(prevMatches, fresh, now),
      errors,
    });
    console.log(`${(cfg.name || id).padEnd(18)} ${errors.length ? errors.join(' | ') : 'ok'}`);
  }

  if (leetifyDown) sources.leetify.error = 'Limite de requêtes atteinte (429)';

  await fetchDetails(players, leetifyKey, leetifyDown);

  await writeAll(DATA, {
    generatedAt: now.toISOString(),
    timezone: config.timezone ?? 'Europe/Zurich',
    group: config.group ?? 'Traphouse',
    sources,
    players,
  }, { now });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
