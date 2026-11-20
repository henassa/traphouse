export const METRICS = ['elo', 'premier', 'mm'];

export const PERIODS = {
  day: { days: 1, title: 'Joueur du jour' },
  week: { days: 7, title: 'Joueur de la semaine' },
  month: { days: 30, title: 'Joueur du mois' },
};

export function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// Dernière valeur connue à la fin du jour `date` (ou avant). Si le joueur a été
// ajouté après, on prend sa première valeur pour ne pas perdre toute la période.
function valueAt(dates, values, date, today) {
  if (!values) return null;
  let found = null;
  for (let i = 0; i < dates.length && dates[i] <= date; i++) if (values[i] != null) found = values[i];
  if (found != null) return found;
  const first = values.findIndex((v, i) => v != null && dates[i] < today);
  return first === -1 ? null : values[first];
}

export function buildModel(latest, series, now = new Date()) {
  const tz = latest.timezone ?? 'Europe/Zurich';
  const today = dayKey(now, tz);
  const dates = series?.dates ?? [];

  const players = latest.players.map((p) => {
    const s = series?.players?.[p.id];
    const cur = {
      elo: p.faceit?.elo ?? null,
      premier: p.leetify?.premier ?? null,
      mm: p.leetify?.mmBest?.rank ?? null,
      wingman: p.leetify?.wingman || null,
      leetify: typeof p.leetify?.leetify === 'number' ? p.leetify.leetify : null,
      aim: typeof p.leetify?.rating?.aim === 'number' ? p.leetify.rating.aim : null,
      kd: p.perf?.all?.kd ?? null,
      kd7: p.perf?.week?.kd ?? null,
      hltv: p.perf?.all?.hltv ?? null,
      hltv7: p.perf?.week?.hltv ?? null,
    };
    const base = (days) =>
      Object.fromEntries(METRICS.map((m) => [m, valueAt(dates, s?.[m], addDays(today, -days), today)]));
    const delta = (days) => {
      const b = base(days);
      return Object.fromEntries(METRICS.map((m) => [m, cur[m] != null && b[m] != null ? cur[m] - b[m] : null]));
    };
    const matches = (p.matches ?? []).map((m) => ({ ...m, day: dayKey(new Date(m.at), tz) }));
    return { ...p, cur, delta: { 1: delta(1), 7: delta(7), 30: delta(30) }, matches, series: s ?? null };
  });

  return { tz, today, dates, players, awards: awards(players, today), fun: fun(players, today) };
}

const inLast = (m, today, days) => m.day > addDays(today, -days);

export function record(matches) {
  let w = 0, l = 0;
  for (const m of matches) {
    if (m.result === 'W') w++;
    else if (m.result === 'L') l++;
  }
  return { w, l, n: matches.length };
}

// Score de distinction : ELO gagné + gain Premier / 10 + 15 par victoire − 10 par défaite.
export function periodScore(p, today, days) {
  const ms = p.matches.filter((m) => inLast(m, today, days));
  const { w, l, n } = record(ms);
  const elo = p.delta[days].elo ?? 0;
  const premier = p.delta[days].premier ?? 0;
  return { score: Math.round(elo + premier / 10 + 15 * w - 10 * l), elo, premier, w, l, n };
}

function awards(players, today) {
  return Object.entries(PERIODS).map(([key, { days, title }]) => {
    const ranked = players
      .map((p) => ({ player: p, ...periodScore(p, today, days) }))
      .filter((r) => r.n > 0)
      .sort((a, b) => b.score - a.score || b.w - a.w);
    return { key, title, days, winner: ranked[0] ?? null, runnerUp: ranked[1] ?? null };
  });
}

export function longestStreak(matches) {
  let best = 0, run = 0;
  for (const m of [...matches].sort((a, b) => a.at.localeCompare(b.at))) {
    run = m.result === 'W' ? run + 1 : 0;
    best = Math.max(best, run);
  }
  return best;
}

export function currentStreak(matches) {
  const sorted = [...matches].filter((m) => m.result).sort((a, b) => b.at.localeCompare(a.at));
  if (!sorted.length) return null;
  const kind = sorted[0].result;
  let n = 0;
  while (n < sorted.length && sorted[n].result === kind) n++;
  return { kind, n };
}

export function favoriteMap(matches) {
  const maps = new Map();
  for (const m of matches) {
    if (!m.map) continue;
    const e = maps.get(m.map) ?? { map: m.map, n: 0, w: 0 };
    e.n++;
    if (m.result === 'W') e.w++;
    maps.set(m.map, e);
  }
  return [...maps.values()].sort((a, b) => b.n - a.n)[0] ?? null;
}

export function avgRating(matches) {
  const r = matches.map((m) => m.rating).filter((x) => typeof x === 'number');
  return r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
}

function top(list, key, dir = -1) {
  const valid = list.filter((x) => x[key] != null);
  valid.sort((a, b) => (dir < 0 ? b[key] - a[key] : a[key] - b[key]));
  return valid[0] ?? null;
}

function fun(players, today) {
  const rows = players.map((p) => {
    const last7 = p.matches.filter((m) => inLast(m, today, 7));
    const last30 = p.matches.filter((m) => inLast(m, today, 30));
    const rated = last7.filter((m) => typeof m.rating === 'number');
    return {
      player: p,
      streak: longestStreak(last30) || null,
      games: last7.length || null,
      drop: p.delta[7].elo != null && p.delta[7].elo < 0 ? p.delta[7].elo : null,
      rating: rated.length >= 5 ? avgRating(rated) : null,
    };
  });

  const all30 = players.flatMap((p) => p.matches.filter((m) => inLast(m, today, 30)));
  return {
    streak: top(rows, 'streak'),
    tryhard: top(rows, 'games'),
    drop: top(rows, 'drop', 1),
    rating: top(rows, 'rating'),
    map: favoriteMap(all30),
  };
}
