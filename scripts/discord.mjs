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
