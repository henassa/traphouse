// Classement sur Discord : chaque nuit à minuit (premier passage de la journée), un message avec le top 10
// de chaque jeu. Les flèches montrent qui a bougé depuis le message de la veille.

const LOL_TIERS = ['IRON', 'BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'EMERALD', 'DIAMOND', 'MASTER', 'GRANDMASTER', 'CHALLENGER'];
const LOL_DIVS = { IV: 0, III: 1, II: 2, I: 3 };
const TOP = 10;
const cap = (s) => s.charAt(0) + s.slice(1).toLowerCase();
const num = (n) => n.toLocaleString('fr-FR').replace(/ | /g, ' ');
const clean = (s) => String(s).replace(/([*_`~|\\>])/g, '\\$1');

const GAMES = [
  {
    key: 'cs',
    title: 'CS2',
    color: 0xc4b550,
    players: (latest) => latest?.players ?? [],
    score: (p) => (p.faceit?.level && p.faceit?.elo ? p.faceit.elo : null),
    label: (p) => `FACEIT ${num(p.faceit.elo)}${p.leetify?.premier ? ` · Premier ${num(p.leetify.premier)}` : ''}`,
  },
  {
    key: 'valorant',
    title: 'Valorant',
    color: 0xff4655,
    players: (latest) => latest?.valorant?.players ?? [],
    score: (p) => (p.mmr?.tier ? p.mmr.elo ?? p.mmr.tier * 100 + (p.mmr.rr ?? 0) : null),
    label: (p) => `${p.mmr.tierName ?? `Rang ${p.mmr.tier}`} · ${p.mmr.rr ?? 0} RR`,
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

const MEDALS = ['🥇', '🥈', '🥉'];

// Places de chacun, gardées avec le site pour calculer les flèches le lendemain.
function positions(latest) {
  return Object.fromEntries(GAMES.map((g) => [g.key, Object.fromEntries(ladder(g, latest).map((x) => [x.p.id, x.pos]))]));
}

const dayOf = (date, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);

export function ladderEmbeds(before, latest, siteUrl, label) {
  const embeds = [];
  for (const game of GAMES) {
    const rows = ladder(game, latest);
    if (!rows.length) continue;
    const old = before?.[game.key] ?? null;
    const lines = rows.slice(0, TOP).map((x) => {
      const was = old?.[x.p.id];
      const move = !old || !Object.keys(old).length ? '' : was == null ? ' 🆕' : was > x.pos ? ` ▲${was - x.pos}` : was < x.pos ? ` ▼${x.pos - was}` : '';
      return `${MEDALS[x.pos - 1] ?? `\`${String(x.pos).padStart(2)}.\``} **${clean(x.p.name)}** — ${game.label(x.p)}${move}`;
    });
    embeds.push({
      title: `Top ${Math.min(TOP, rows.length)} ${game.title}`,
      url: siteUrl ? `${siteUrl}${game.key === 'cs' ? '' : `#${game.key}`}` : undefined,
      color: game.color,
      description: lines.join('\n'),
      footer: rows.length > TOP ? { text: `${rows.length} joueurs classés · classement complet sur le site` } : undefined,
    });
  }
  return embeds;
}

// Poste le classement au premier passage d'une nouvelle journée (heure de Zurich par défaut).
// Renvoie l'état à publier avec le site : jour du dernier message et places de chacun.
export async function postLadder(url, state, latest, siteUrl, timezone = 'Europe/Zurich', now = new Date()) {
  const today = dayOf(now, timezone);
  if (!url) return state ?? null;
  // Tout premier passage : on note la journée sans poster, le premier message part à minuit.
  if (!state?.day) {
    console.log('[Discord] premier passage : classement mémorisé, premier message à minuit');
    return { day: today, positions: positions(latest) };
  }
  if (state.day === today) return state;

  const yesterday = new Date(now.getTime() - 864e5);
  const label = new Intl.DateTimeFormat('fr-FR', { timeZone: timezone, weekday: 'long', day: 'numeric', month: 'long' }).format(yesterday);
  const embeds = ladderEmbeds(state.positions, latest, siteUrl);
  if (!embeds.length) return { ...state, day: today };
  const body = {
    username: 'TRAPHOUSE',
    avatar_url: siteUrl ? `${siteUrl}icon-180.png` : undefined,
    content: `**Classement TRAPHOUSE — fin de journée du ${label}**`,
    embeds,
    allowed_mentions: { parse: [] },
  };
  try {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!res.ok) {
      // On réessaiera au passage suivant.
      console.log(`[Discord] envoi refusé : HTTP ${res.status}`);
      return state;
    }
    console.log('[Discord] classement du jour posté');
    return { day: today, positions: positions(latest) };
  } catch (e) {
    // Un webhook en panne ne doit jamais empêcher la mise à jour du site.
    console.log(`[Discord] envoi impossible : ${e.message}`);
    return state;
  }
}
