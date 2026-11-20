// Classement Valorant via HenrikDev (API non officielle) : rang, RR et pic de rang (MMR v3),
// K/D, % de headshots et ACS sur les matchs compétitifs enregistrés, carte de joueur comme photo.
const BASE = 'https://api.henrikdev.xyz/valorant';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function parseRiotId(entry, defaultRegion) {
  const e = typeof entry === 'string' ? { riot: entry } : entry;
  const [name, tag] = String(e.riot ?? '').split('#');
  if (!name || !tag) return null;
  return { name: name.trim(), tag: tag.trim(), region: e.region ?? defaultRegion ?? 'eu', label: e.name ?? null, id: `${name.trim()}#${tag.trim()}`.toLowerCase() };
}

// La clé "Basic" autorise 30 requêtes par minute : on en fait une toutes les 2,2 s.
let last = 0;
async function henrik(path, key) {
  const wait = last + 2200 - Date.now();
  if (wait > 0) await sleep(wait);
  last = Date.now();
  const res = await fetch(`${BASE}${path}`, { headers: { Authorization: key, Accept: 'application/json' }, signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (!res.ok) {
    const err = new Error(`HTTP ${res.status} sur ${path.split('?')[0]}`);
    err.status = res.status;
    throw err;
  }
  return (await res.json())?.data ?? null;
}

const enc = encodeURIComponent;

async function fetchCard(p, key) {
  const a = await henrik(`/v1/account/${enc(p.name)}/${enc(p.tag)}`, key);
  const card = a?.card;
  const url = typeof card === 'string'
    ? `https://media.valorant-api.com/playercards/${card}/smallart.png`
    : card?.small ?? (card?.id ? `https://media.valorant-api.com/playercards/${card.id}/smallart.png` : null);
  return { card: url, puuid: a?.puuid ?? null, level: a?.account_level ?? null };
}

async function fetchMmr(p, key) {
  const d = await henrik(`/v3/mmr/${p.region}/pc/${enc(p.name)}/${enc(p.tag)}`, key);
  if (!d) return null;
  return {
    tier: d.current?.tier?.id ?? null,
    tierName: d.current?.tier?.name ?? null,
    rr: d.current?.rr ?? null,
    elo: d.current?.elo ?? null,
    lastChange: d.current?.last_change ?? null,
    peakTier: d.peak?.tier?.id ?? null,
    peakName: d.peak?.tier?.name ?? null,
    peakSeason: d.peak?.season?.short ?? null,
  };
}

// Matchs déjà enregistrés chez HenrikDev : ça ne coûte presque rien en limite de requêtes.
async function fetchStats(p, key) {
  const list = await henrik(`/v1/stored-matches/${p.region}/${enc(p.name)}/${enc(p.tag)}?mode=competitive&size=20`, key);
  let k = 0, d = 0, head = 0, shots = 0, score = 0, rounds = 0, n = 0, wins = 0;
  for (const m of list ?? []) {
    const s = m.stats ?? {};
    if (typeof s.kills !== 'number') continue;
    n++;
    k += s.kills;
    d += s.deaths ?? 0;
    head += s.shots?.head ?? 0;
    shots += (s.shots?.head ?? 0) + (s.shots?.body ?? 0) + (s.shots?.leg ?? 0);
    const red = m.teams?.red ?? 0, blue = m.teams?.blue ?? 0;
    const r = typeof red === 'number' && typeof blue === 'number' ? red + blue : 0;
    if (r) { score += s.score ?? 0; rounds += r; }
    const team = String(s.team ?? '').toLowerCase();
    if (team && typeof m.teams?.[team] === 'number' && m.teams[team] > m.teams[team === 'red' ? 'blue' : 'red']) wins++;
  }
  if (!n) return null;
  return {
    matches: n,
    kd: Math.round((d ? k / d : k) * 100) / 100,
    hs: shots ? Math.round((head / shots) * 1000) / 10 : null,
    acs: rounds ? Math.round(score / rounds) : null,
    winrate: Math.round((wins / n) * 100),
  };
}

// Emblèmes de rang : liste officielle (catalogue public de Riot via valorant-api.com), téléchargés à chaque
// passage dans data/valorant-tiers/ pour être publiés avec le site plutôt que chargés depuis un autre domaine.
export async function downloadTiers(dir) {
  const { mkdir, writeFile } = await import('node:fs/promises');
  const res = await fetch('https://valorant-api.com/v1/competitivetiers', { signal: AbortSignal.timeout(20000) });
  if (!res.ok) throw new Error(`liste des rangs : HTTP ${res.status}`);
  const sets = (await res.json())?.data ?? [];
  const latest = sets.at(-1);
  await mkdir(dir, { recursive: true });
  let saved = 0;
  for (const t of latest?.tiers ?? []) {
    if (!t.largeIcon || t.tier < 3) continue;
    const img = await fetch(t.largeIcon, { signal: AbortSignal.timeout(15000) }).catch(() => null);
    if (!img?.ok) continue;
    await writeFile(`${dir}/${t.tier}.png`, Buffer.from(await img.arrayBuffer()));
    saved++;
  }
  return saved;
}

export async function fetchValorant(config, previous, key, now) {
  const entries = (config.valorant ?? []).map((e) => parseRiotId(e, config.valorantRegion)).filter(Boolean);
  const prevById = new Map((previous?.players ?? []).map((p) => [p.id, p]));
  const sources = { ok: 0, failed: 0, error: null };
  const players = [];
  let down = false;

  for (const p of entries) {
    const prev = prevById.get(p.id) ?? {};
    const out = { ...prev, id: p.id, riotId: `${p.name}#${p.tag}`, name: p.label || p.name, region: p.region, errors: [] };
    if (!down) {
      try {
        // La carte (photo) une fois par jour, le rang et les stats à chaque passage.
        if (!prev.card || !prev.cardAt || now - new Date(prev.cardAt) > 864e5) {
          Object.assign(out, await fetchCard(p, key).catch(() => ({})), { cardAt: now.toISOString() });
        }
        const mmr = await fetchMmr(p, key);
        if (mmr) out.mmr = mmr;
        const stats = await fetchStats(p, key).catch((e) => { out.errors.push(`stats : ${e.message}`); return null; });
        if (stats) out.stats = stats;
        out.updatedAt = now.toISOString();
        sources.ok++;
      } catch (e) {
        sources.failed++;
        out.errors.push(e.message);
        if (e.status === 429) { down = true; sources.error = 'Limite HenrikDev atteinte (429)'; }
        if (e.status === 401 || e.status === 403) { down = true; sources.error = 'Clé HenrikDev refusée'; }
      }
    }
    const status = out.errors.length ? out.errors.join(' | ') : out.mmr?.tierName ? `${out.mmr.tierName} ${out.mmr.rr ?? ''} RR` : 'pas de rang';
    console.log(`[Valo] ${out.riotId.padEnd(22)} ${status}`);
    players.push(out);
  }
  return { generatedAt: now.toISOString(), sources, players };
}
