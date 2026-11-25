// Classement League of Legends via l'API officielle de Riot (clé personnelle) :
// Riot ID → PUUID (account-v1), icône et niveau (summoner-v4), rangs Solo/Duo et Flex (league-v4).
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Région saisie dans players.json → serveur de jeu (plateforme) et routage régional.
const ROUTES = {
  euw: ['euw1', 'europe'], eune: ['eun1', 'europe'], tr: ['tr1', 'europe'], ru: ['ru', 'europe'],
  na: ['na1', 'americas'], br: ['br1', 'americas'], lan: ['la1', 'americas'], las: ['la2', 'americas'],
  kr: ['kr', 'asia'], jp: ['jp1', 'asia'], oce: ['oc1', 'sea'],
};

export function parseLolId(entry, defaultRegion) {
  const e = typeof entry === 'string' ? { riot: entry } : entry;
  const [name, tag] = String(e.riot ?? '').split('#');
  if (!name || !tag) return null;
  const region = String(e.region ?? defaultRegion ?? 'euw').toLowerCase();
  return { name: name.trim(), tag: tag.trim(), region, route: ROUTES[region] ?? ROUTES.euw, label: e.name ?? null, id: `${name.trim()}#${tag.trim()}`.toLowerCase() };
}

// Clé personnelle : 100 requêtes toutes les 2 minutes, donc une toutes les 1,3 s.
let last = 0;
async function riot(url, key) {
  const wait = last + 1300 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(url, { headers: { 'X-Riot-Token': key }, signal: AbortSignal.timeout(15000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} sur ${new URL(url).pathname.split('/').slice(0, 5).join('/')}`);
    err.status = res.status;
    throw err;
  }
  return res.json();
}

const enc = encodeURIComponent;

function queue(entries, type) {
  const q = entries?.find((e) => e.queueType === type);
  if (!q) return null;
  return { tier: q.tier, division: q.rank ?? null, lp: q.leaguePoints ?? 0, wins: q.wins ?? 0, losses: q.losses ?? 0 };
}

async function ddragonVersion() {
  const res = await fetch('https://ddragon.leagueoflegends.com/api/versions.json', { signal: AbortSignal.timeout(15000) }).catch(() => null);
  return res?.ok ? (await res.json())[0] : null;
}

export async function fetchLol(config, previous, key, now) {
  const entries = (config.lol ?? []).map((e) => parseLolId(e, config.lolRegion)).filter(Boolean);
  const prevById = new Map((previous?.players ?? []).map((p) => [p.id, p]));
  const version = await ddragonVersion();
  const sources = { ok: 0, failed: 0, error: null };
  const players = [];
  let down = false;

  for (const p of entries) {
    const prev = prevById.get(p.id) ?? {};
    const [platform, regional] = p.route;
    const { seen, ...keep } = prev;
    const out = { ...keep, id: p.id, riotId: `${p.name}#${p.tag}`, name: p.label || p.name, region: p.region, errors: [] };
    if (!down) {
      try {
        // Le PUUID ne change jamais : une seule recherche par joueur.
        if (!out.puuid) {
          const acc = await riot(`https://${regional}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${enc(p.name)}/${enc(p.tag)}`, key);
          if (!acc) throw new Error('Riot ID introuvable');
          out.puuid = acc.puuid;
        }
        // Icône et niveau une fois par jour, rangs à chaque passage.
        if (!prev.iconAt || now - new Date(prev.iconAt) > 864e5) {
          const s = await riot(`https://${platform}.api.riotgames.com/lol/summoner/v4/summoners/by-puuid/${out.puuid}`, key);
          if (s) {
            out.level = s.summonerLevel ?? null;
            out.avatar = version && s.profileIconId != null ? `https://ddragon.leagueoflegends.com/cdn/${version}/img/profileicon/${s.profileIconId}.png` : prev.avatar ?? null;
            out.iconAt = now.toISOString();
          }
        }
        const leagues = await riot(`https://${platform}.api.riotgames.com/lol/league/v4/entries/by-puuid/${out.puuid}`, key);
        out.solo = queue(leagues, 'RANKED_SOLO_5x5');
        out.flex = queue(leagues, 'RANKED_FLEX_SR');
        out.updatedAt = now.toISOString();
        sources.ok++;
      } catch (e) {
        sources.failed++;
        out.errors.push(e.message);
        if (e.status === 429) { down = true; sources.error = 'Limite Riot atteinte (429)'; }
        if (e.status === 401 || e.status === 403) { down = true; sources.error = 'Clé Riot refusée ou expirée'; }
      }
    }
    const rank = (q) => (q ? `${q.tier} ${q.division ?? ''} ${q.lp} LP`.replace(/\s+/g, ' ') : 'non classé');
    console.log(`[LoL] ${out.riotId.padEnd(22)} ${out.errors.length ? out.errors.join(' | ') : `solo ${rank(out.solo)} · flex ${rank(out.flex)}`}`);
    players.push(out);
  }
  return { generatedAt: now.toISOString(), sources, players };
}
