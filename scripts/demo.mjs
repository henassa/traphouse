// Génère demo/ avec 25 joueurs fictifs et 45 jours d'historique, au même format que fetch.mjs.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { addDays, dayKey, mergeMatches, perfOf, snapshotOf, writeAll } from './lib/store.mjs';

const OUT = new URL('../demo', import.meta.url).pathname;
const TZ = 'Europe/Zurich';
const DAYS = 45;
const now = new Date();

let seed = 42;
const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
const pick = (a) => a[Math.floor(rand() * a.length)];
const between = (a, b) => a + rand() * (b - a);

const MAPS = ['Mirage', 'Inferno', 'Dust2', 'Nuke', 'Ancient', 'Anubis', 'Train', 'Overpass'];
const NAMES = ['Max', 'Léa', 'Tom', 'Nico', 'Hugo', 'Inès', 'Sami', 'Jules', 'Yanis', 'Chloé', 'Bastien', 'Enzo',
  'Lucas', 'Malik', 'Théo', 'Romain', 'Sarah', 'Kevin', 'Axel', 'Noah', 'Mathis', 'Camille', 'Alex', 'Rayan', 'Lina'];

const levelOf = (elo) => [500, 750, 900, 1050, 1200, 1350, 1530, 1750, 2000].findIndex((t) => elo <= t) + 1 || 10;

// Quelques histoires pour que la démo ait du relief : Max grimpe, Hugo chute, Jules joue tout le temps.
const STORY = { 0: 0.85, 4: -0.75 };

const players = NAMES.map((name, i) => {
  const skill = STORY[i] ?? between(-1, 1);
  return {
    name,
    steam64: String(76561198000000000n + BigInt(1000 + i * 37)),
    skill,
    activity: i === 7 ? 0.98 : between(0.25, 0.85),
    hasFaceit: ![3, 11, 19].includes(i),
    hasLeetify: i !== 22,
    privateLeetify: i === 15,
    elo: Math.round(1250 + skill * 650 + between(-120, 120)),
    premier: Math.round(13500 + skill * 7500 + between(-1500, 1500)),
    mmMaps: Object.fromEntries(MAPS.slice(0, 3 + Math.floor(rand() * 5)).map((m) => [m, Math.max(1, Math.min(18, Math.round(10 + skill * 7 + between(-2, 2))))])),
    favMap: pick(MAPS),
    matches: [],
  };
});

await rm(OUT, { recursive: true, force: true });
await mkdir(`${OUT}/history`, { recursive: true });

const today = dayKey(now, TZ);
for (let d = DAYS - 1; d >= 0; d--) {
  const date = addDays(today, -d);
  for (const p of players) {
    if (rand() > p.activity) continue;
    const n = 1 + Math.floor(rand() * (p.activity > 0.9 ? 6 : 4));
    for (let k = 0; k < n; k++) {
      const at = new Date(`${date}T${String(16 + Math.floor(rand() * 6)).padStart(2, '0')}:${String(Math.floor(rand() * 60)).padStart(2, '0')}:00Z`);
      if (at > now) continue;
      const win = rand() < 0.5 + p.skill * 0.12;
      const loserRounds = Math.floor(between(3, 12));
      const map = rand() < 0.35 ? p.favMap : pick(MAPS);
      const rating = (win ? 0.03 : -0.03) + p.skill * 0.015 + between(-0.025, 0.025);
      const roll = rand();
      const source = !p.hasFaceit ? (roll < 0.7 ? 'premier' : 'mm') : roll < 0.5 ? 'faceit' : roll < 0.85 ? 'premier' : 'mm';

      const match = {
        id: `demo:${p.steam64}:${at.getTime()}:${k}`,
        source,
        at: at.toISOString(),
        map,
        result: win ? 'W' : 'L',
        score: win ? [13, loserRounds] : [loserRounds, 13],
        rating: Math.round(rating * 1e4) / 1e4,
      };
      if (source === 'faceit') {
        p.elo = Math.max(100, p.elo + (win ? 1 : -1) * Math.round(between(19, 31)));
      } else if (source === 'premier') {
        p.premier = Math.max(1000, p.premier + (win ? 1 : -1) * Math.round(between(120, 380)));
        match.rank = p.premier;
      } else {
        const r = p.mmMaps[map] ?? 9;
        if (rand() < 0.18) p.mmMaps[map] = Math.max(1, Math.min(18, r + (win ? 1 : -1)));
        match.rank = p.mmMaps[map] ?? null;
      }
      if (!p.privateLeetify || source === 'faceit') p.matches.push(match);
    }
  }

  if (d > 0) {
    const snap = { date, updatedAt: `${date}T22:17:00.000Z`, players: {} };
    for (const p of players) snap.players[p.steam64] = snapshotOf(toLatest(p));
    await writeFile(`${OUT}/history/${date}.json`, JSON.stringify(snap) + '\n');
  }
}

function toLatest(p) {
  const competitive = Object.entries(p.mmMaps).map(([map, rank]) => ({ map, rank })).sort((a, b) => b.rank - a.rank);
  return {
    id: p.steam64,
    name: p.name,
    steam64: p.steam64,
    avatar: null,
    steamName: null,
    faceit: p.hasFaceit
      ? { playerId: `demo-${p.steam64}`, nickname: p.name.normalize('NFD').replace(/\W/g, '') + 'CS', avatar: null, elo: p.elo, level: levelOf(p.elo), url: null, updatedAt: now.toISOString() }
      : null,
    leetify: p.hasLeetify
      ? {
          name: p.name,
          privacy: p.privateLeetify ? 'private' : 'public',
          premier: p.premier,
          wingman: Math.max(1, Math.min(18, Math.round(10 + p.skill * 7 + between(-3, 3)))),
          leetify: Math.round((p.skill * 3 + 0.2) * 100) / 100,
          competitive,
          mmBest: competitive[0] ?? null,
          rating: {
            aim: Math.round(50 + p.skill * 30 + between(-5, 5)),
            positioning: Math.round(50 + p.skill * 20 + between(-10, 10)),
            utility: Math.round(50 + between(-25, 25)),
            clutch: Math.round((0.1 + p.skill * 0.05) * 1000) / 1000,
            opening: Math.round(p.skill * 0.04 * 1000) / 1000,
            ct_leetify: Math.round(p.skill * 0.03 * 1e4) / 1e4,
            t_leetify: Math.round(p.skill * 0.025 * 1e4) / 1e4,
          },
          winrate: 0.5 + p.skill * 0.08,
          totalMatches: 300 + Math.floor(rand() * 900),
          url: null,
          updatedAt: now.toISOString(),
        }
      : null,
    // Sans Leetify, FACEIT ne donne que la date et le résultat.
    matches: mergeMatches([], p.hasLeetify ? p.matches : p.matches.filter((m) => m.source === 'faceit').map(({ id, source, at, result }) => ({ id, source, at, result })), now),
    perf: p.perf ?? null,
    errors: [],
  };
}

// Tableaux des scores fictifs pour les 4 derniers matchs de chaque joueur (un seul fichier pour la démo).
const OTHERS = ['zoro', 'kebabmaster', 'Nyx', 'pipou', 'xX_Sn1p3r_Xx', 'tartiflette', 'Raven', 'b0ss', 'mumu', 'Kaze', 'flicky', 'lemon', 'Vortex', 'gégé', 'Ozzy'];
const details = {};
for (const p of players) {
  if (!p.hasLeetify) continue;
  for (const m of [...p.matches].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 4)) {
    m.leetifyId = `demo-${p.steam64.slice(-4)}-${new Date(m.at).getTime()}`;
    m.details = true;
    const [mine, theirs] = m.score;
    const rounds = mine + theirs;
    const mates = players.filter((o) => o !== p && o.hasLeetify && rand() < 0.08).slice(0, 2);
    const row = (steam64, name, team, skill) => {
      const k = Math.max(2, Math.round(rounds * (0.55 + skill * 0.25 + between(-0.25, 0.3))));
      const dd = Math.max(3, Math.round(rounds * (0.7 - skill * 0.15 + between(-0.2, 0.2))));
      return {
        steam64, name, team, k, d: dd, a: Math.round(between(1, 8)),
        adr: Math.round((k / rounds) * 105 + between(-12, 12)), hs: between(0.12, 0.32), hsKills: Math.round(k * between(0.3, 0.6)),
        rating: Math.round(((k - dd) / rounds * 0.12 + between(-0.02, 0.02)) * 1e4) / 1e4, mvps: Math.round(between(0, 5)),
        k1: Math.round(k * 0.45), k2: Math.round(k * 0.12), k3: Math.round(between(0, 2)), k4: rand() < 0.2 ? 1 : 0, k5: rand() < 0.04 ? 1 : 0,
        acc: between(0.25, 0.5), preaim: between(7, 15), reaction: between(0.45, 0.75), flashed: Math.round(between(2, 12)),
        flashKills: Math.round(between(0, 3)), he: between(2, 12), trades: Math.round(between(0, 4)), rounds,
      };
    };
    const team = [row(p.steam64, p.name, 3, p.skill), ...mates.map((o) => row(o.steam64, o.name, 3, o.skill))];
    while (team.length < 5) team.push(row(`7656119${Math.floor(rand() * 1e10)}`, pick(OTHERS), 3, between(-0.5, 0.5)));
    const enemies = Array.from({ length: 5 }, () => row(`7656119${Math.floor(rand() * 1e10)}`, pick(OTHERS), 2, between(-0.4, 0.6)));
    details[m.leetifyId] = {
      id: m.leetifyId, finishedAt: m.at, dataSource: m.source, map: m.map, bannedPlayer: false,
      teams: [{ team: 3, score: mine }, { team: 2, score: theirs }], players: [...team, ...enemies],
    };
  }
}

const allDetails = Object.values(details);
const weekDetails = allDetails.filter((x) => now - new Date(x.finishedAt) < 7 * 864e5);
for (const p of players) p.perf = { all: perfOf(allDetails, p.steam64), week: perfOf(weekDetails, p.steam64) };

await writeAll(OUT, {
  generatedAt: new Date(now.getTime() - 14 * 60e3).toISOString(),
  timezone: TZ,
  group: 'Traphouse',
  sources: { faceit: { ok: 22, failed: 0 }, leetify: { ok: 24, failed: 0 }, steam: { ok: 0, failed: 0, skipped: true } },
  players: players.map(toLatest),
}, { now });

await writeFile(`${OUT}/matches.json`, JSON.stringify(details) + '\n');
console.log(`demo/ : ${players.length} joueurs, ${DAYS} jours, ${Object.keys(details).length} matchs détaillés`);
