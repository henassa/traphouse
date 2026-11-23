// Annonce sur Discord les joueurs qui gagnent des places dans un classement.
// On compare le classement publié au passage précédent avec le nouveau : seul celui qui a
// lui-même progressé (ELO, rang, LP) et doublé quelqu'un est annoncé, pour éviter le bruit
// quand un autre joueur perd des points ou n'a pas pu être relu.

const LOL_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_DIVS = { IV: 0, III: 1, II: 2, I: 3 };
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const num = (n) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');

const GAMES = [
  {
    key: 'cs',
    title: 'CS2',
    color: 0xc4b550,
    players: (latest) => latest?.players ?? [],
    score: (p) => (p.faceit?.level && p.faceit?.elo ? p.faceit.elo : null),
    label: (p) => `FACEIT ${num(p.faceit.elo)}`,
  },
  {
    key: 'valorant',
    title: 'Valorant',
    color: 0xff4655,
    players: (latest) => latest?.valorant?.players ?? [],
    score: (p) => (p.mmr?.tier ? p.mmr.elo ?? p.mmr.tier * 100 + (p.mmr.rr ?? 0) : null),
    label: (p) => `${p.mmr.tierName ?? 'Rang ' + p.mmr.tier} · ${p.mmr.rr ?? 0} RR`,
  },
  {
    key: 'lol',
    title: 'League of Legends',
    color: 0xc89b3c,
    players: (latest) => latest?.lol?.players ?? [],
    score: (p) => (p.solo ? LOL_TIERS.indexOf(p.solo.tier) * 400 + (LOL_DIVS[p.solo.division] ?? 0) * 100 + (p.solo.lp ?? 0) : null),
    label: (p) => {
      const t = cap(p.solo.tier);
      return `${LOL_TIERS.indexOf(p.solo.tier) >= 7 ? t : `${t} ${p.solo.division ?? ''}`.trim()} · ${p.solo.lp} LP`;
    },
  },
];

function ladder(game, latest) {
  return game.players(latest)
    .map((p) => ({ p, score: game.score(p) }))
    .filter((x) => x.score != null)
    .sort((a, b) => b.score - a.score)
    .map((x, i) => ({ ...x, pos: i + 1 }));
}

export function climbs(previous, latest) {
  const out = [];
  for (const game of GAMES) {
    const before = ladder(game, previous);
    // Pas d'annonce au premier passage d'un jeu : tout le monde « monterait ».
    if (!before.length) continue;
    const prevById = new Map(before.map((x) => [x.p.id, x]));
    const after = ladder(game, latest);
    const lines = [];
    for (const x of after) {
      const old = prevById.get(x.p.id);
      if (!old || x.pos >= old.pos || x.score <= old.score) continue;
      const passed = after
        .filter((y) => y.pos > x.pos && prevById.get(y.p.id)?.pos < old.pos)
        .map((y) => y.p.name);
      if (!passed.length) continue;
      lines.push({ name: x.p.name, from: old.pos, to: x.pos, label: game.label(x.p), passed });
    }
    if (lines.length) out.push({ game, lines: lines.sort((a, b) => a.to - b.to) });
  }
  return out;
}

const ord = (n) => (n === 1 ? '1er' : `${n}e`);
const list = (names) => (names.length <= 3 ? names.join(', ').replace(/, ([^,]*)$/, ' et $1') : `${names.slice(0, 2).join(', ')} et ${names.length - 2} autres`);

export async function notifyDiscord(url, previous, latest, siteUrl) {
  if (!url) return;
  const changes = climbs(previous, latest);
  if (!changes.length) {
    console.log('[Discord] aucune montée au classement');
    return;
  }
  const embeds = changes.map(({ game, lines }) => ({
    title: `Classement ${game.title}`,
    url: siteUrl ? `${siteUrl}${game.key === 'cs' ? '' : `#${game.key}`}` : undefined,
    color: game.color,
    description: lines
      .slice(0, 15)
      .map((l) => `**${l.name}** passe ${ord(l.to)} (${ord(l.from)} avant) — ${l.label}\n↳ double ${list(l.passed)}`)
      .join('\n\n')
      .slice(0, 4000),
  }));
  const body = {
    username: 'TRAPHOUSE',
    avatar_url: siteUrl ? `${siteUrl}icon-180.png` : undefined,
    embeds: embeds.slice(0, 10),
    allowed_mentions: { parse: [] },
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    console.log(`[Discord] ${changes.reduce((n, c) => n + c.lines.length, 0)} montée(s) annoncée(s) → HTTP ${res.status}`);
  } catch (e) {
    // Un webhook en panne ne doit jamais empêcher la mise à jour du site.
    console.log(`[Discord] envoi impossible : ${e.message}`);
  }
}

// ——— Annonces match par match, façon bot Leetify ———

const GREEN = 0x5ba32b, RED = 0xc23b22, GREY = 0x7a7a7a;
const colorOf = (r) => (r === 'W' ? GREEN : r === 'L' ? RED : GREY);
const RESULT = { W: 'Victoire', L: 'Défaite', T: 'Égalité' };
const MODE = { faceit: 'FACEIT', premier: 'Premier', mm: 'Compétitif', wingman: 'Wingman', renown: 'Renown', other: 'Match' };
const dec = (x, n = 2) => x.toFixed(n).replace('.', ',');
const sign = (x) => (x > 0 ? `+${num(x)}` : x < 0 ? `−${num(-x)}` : '±0');
const csRating = (x) => { const v = Math.abs(x) <= 1 ? x * 100 : x; return `${v > 0 ? '+' : ''}${dec(v)}`; };

// Les beaux moments de la partie, mis en avant à côté des stats.
function csHighlights(row) {
  const out = [];
  if (row?.k5) out.push(row.k5 > 1 ? `${row.k5} ACES` : 'ACE');
  else if (row?.k4) out.push(row.k4 > 1 ? `${row.k4}× 4K` : '4K');
  if (row?.k >= 30) out.push(`${row.k} kills`);
  return out.length ? ` · **${out.join(' · ')}**` : '';
}

function csEmbed(group) {
  const first = group[0];
  const m = first.match;
  const d = first.detail;
  const score = m.score ?? (d?.teams?.length === 2 ? d.teams.map((t) => t.score) : null);
  const lines = group.map((g) => {
    const r = g.row;
    const stats = r
      ? [`${r.k}/${r.d}/${r.a}`, r.adr != null && `ADR ${Math.round(r.adr)}`, r.rating != null && `Rating ${csRating(r.rating)}`].filter(Boolean).join(' · ')
      : g.match.rating != null ? `Rating ${csRating(g.match.rating)}` : 'pas de stats Leetify pour ce match';
    const rank = g.eloDelta != null ? `\nFACEIT ${num(g.player.faceit.elo)} (${sign(g.eloDelta)})`
      : g.match.source === 'premier' && g.match.rank ? `\nPremier ${num(g.match.rank)}${g.premierDelta != null ? ` (${sign(g.premierDelta)})` : ''}`
      : '';
    return `**${g.player.name}** — ${stats}${csHighlights(r)}${rank}`;
  });
  return {
    author: { name: `CS2 · ${MODE[m.source] ?? 'Match'}${m.map ? ` · ${m.map}` : ''}` },
    title: `${RESULT[m.result] ?? 'Match terminé'}${score ? ` ${score[0]}–${score[1]}` : ''}`,
    url: m.leetifyId ? `https://leetify.com/app/match-details/${m.leetifyId}` : m.url ?? undefined,
    color: colorOf(m.result),
    description: lines.join('\n\n'),
    thumbnail: group.length === 1 && first.player.avatar ? { url: first.player.avatar } : undefined,
    timestamp: m.at,
  };
}

function valEmbed(group) {
  const m = group[0];
  const lines = group.map((g) => {
    const stats = [`${g.k}/${g.d}/${g.a}`, g.acs != null && `ACS ${g.acs}`, g.hs != null && `HS ${g.hs} %`].filter(Boolean).join(' · ');
    const rr = g.rrChange != null ? `\n${g.tierName ?? 'RR'} (${sign(g.rrChange)} RR)` : '';
    return `**${g.player.name}**${g.agent ? ` (${g.agent})` : ''} — ${stats}${rr}`;
  });
  return {
    author: { name: `Valorant · Compétitif${m.map ? ` · ${m.map}` : ''}` },
    title: `${RESULT[m.result] ?? 'Match terminé'}${m.score ? ` ${m.score[0]}–${m.score[1]}` : ''}`,
    color: colorOf(m.result),
    description: lines.join('\n\n'),
    thumbnail: group.length === 1 && m.player.card ? { url: m.player.card } : undefined,
    timestamp: m.at ?? undefined,
  };
}

function lolEmbed(group) {
  const m = group[0];
  const lines = group.map((g) => {
    const kda = g.d ? dec((g.k + g.a) / g.d) : 'parfait';
    const rank = g.rank ? `\n${cap(g.rank.tier)}${LOL_TIERS.indexOf(g.rank.tier) < 7 ? ` ${g.rank.division}` : ''} · ${g.rank.lp} LP${g.lp != null ? ` (${sign(g.lp)})` : ''}` : '';
    return `**${g.player.name}** (${g.champion}) — ${g.k}/${g.d}/${g.a} · KDA ${kda} · ${g.cs} CS${rank}`;
  });
  return {
    author: { name: `League of Legends · ${m.queue === 'flex' ? 'Flex' : 'Solo/Duo'} · ${m.minutes} min` },
    title: m.result ? RESULT[m.result] : 'Remake',
    color: colorOf(m.result),
    description: lines.join('\n\n'),
    thumbnail: m.version && m.champion ? { url: `https://ddragon.leagueoflegends.com/cdn/${m.version}/img/champion/${m.champion}.png` } : undefined,
    timestamp: m.at,
  };
}

// Regroupe les joueurs du même match dans une seule carte.
function groupBy(list, key) {
  const map = new Map();
  for (const x of list) map.set(key(x), [...(map.get(key(x)) ?? []), x]);
  return [...map.values()];
}

export async function notifyGames(url, { cs = [], valorant = [], lol = [] }, siteUrl) {
  if (!url) return;
  const embeds = [
    ...groupBy(cs, (g) => g.key).map((g) => [g[0].match.at, csEmbed(g)]),
    ...groupBy(valorant, (g) => g.id).map((g) => [g[0].at ?? '', valEmbed(g)]),
    ...groupBy(lol, (g) => g.id).map((g) => [g[0].at, lolEmbed(g)]),
  ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))).map(([, e]) => e);
  if (!embeds.length) {
    console.log('[Discord] aucune nouvelle partie');
    return;
  }
  // 25 cartes au plus par passage, 10 par message (limite de Discord).
  const list = embeds.slice(-25);
  for (let i = 0; i < list.length; i += 10) {
    const body = { username: 'TRAPHOUSE', avatar_url: siteUrl ? `${siteUrl}icon-180.png` : undefined, embeds: list.slice(i, i + 10), allowed_mentions: { parse: [] } };
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      console.log(`[Discord] ${body.embeds.length} partie(s) annoncée(s) → HTTP ${res.status}`);
      if (res.status === 429) await new Promise((r) => setTimeout(r, 3000));
    } catch (e) {
      console.log(`[Discord] envoi impossible : ${e.message}`);
    }
  }
}

// Matchs CS à annoncer sur Discord. On attend que Leetify ait le tableau des scores (jusqu'à 3 h)
// pour poster les stats ; au tout premier passage, on mémorise les matchs existants sans rien poster.
const CS_WAIT = 3 * 3600e3;
const CS_MAX_AGE = 24 * 3600e3;
export function newCsGames(players, prevById, bundle, now) {
  const games = [];
  for (const p of players) {
    const prev = prevById.get(p.id);
    const ids = new Set(p.matches.map((m) => m.id));
    if (!Array.isArray(prev?.notified)) {
      p.notified = [...ids];
      continue;
    }
    const done = new Set(prev.notified);
    const fresh = p.matches.filter((m) => !done.has(m.id) && now - new Date(m.at) < CS_MAX_AGE);
    const freshFaceit = fresh.filter((m) => m.source === 'faceit').length;
    for (const m of fresh) {
      const detail = m.leetifyId ? bundle[m.leetifyId] : null;
      const row = detail?.players?.find((x) => x.steam64 === p.steam64) ?? null;
      if (!row && now - new Date(m.at) < CS_WAIT) continue;
      done.add(m.id);
      // Écart de Premier : rang après ce match comparé au match Premier précédent du joueur.
      let premierDelta = null;
      if (m.source === 'premier' && m.rank) {
        const before = p.matches.find((x) => x.source === 'premier' && x.rank && x.at < m.at);
        if (before) premierDelta = m.rank - before.rank;
      }
      games.push({
        key: m.leetifyId ?? m.id,
        match: m,
        detail,
        row,
        player: p,
        eloDelta: m.source === 'faceit' && freshFaceit === 1 && prev.faceit?.elo && p.faceit?.elo ? p.faceit.elo - prev.faceit.elo : null,
        premierDelta,
      });
    }
    p.notified = [...done].filter((id) => ids.has(id));
  }
  return games;
}

