import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MATCH_WINDOW_DAYS = 45;
export const SERIES_DAYS = 90;

export function dayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

export function addDays(key, n) {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function readJson(path, fallback = null) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch {
    return fallback;
  }
}

async function writeJson(path, data) {
  await writeFile(path, JSON.stringify(data, null, 1) + '\n');
}

// Les valeurs qui alimentent les évolutions et les graphiques.
export function snapshotOf(p) {
  return {
    elo: p.faceit?.elo ?? null,
    level: p.faceit?.level ?? null,
    premier: p.leetify?.premier ?? null,
    mm: p.leetify?.mmBest?.rank ?? null,
    mmMap: p.leetify?.mmBest?.map ?? null,
  };
}

export function mergeMatches(previous = [], fresh = [], now = new Date()) {
  const cutoff = now.getTime() - MATCH_WINDOW_DAYS * 864e5;
  const byId = new Map();
  for (const m of [...previous, ...fresh]) byId.set(m.id, { ...byId.get(m.id), ...m });
  return [...byId.values()]
    .filter((m) => new Date(m.at).getTime() >= cutoff)
    .sort((a, b) => b.at.localeCompare(a.at));
}

export async function writeAll(dir, latest, { now = new Date() } = {}) {
  const tz = latest.timezone;
  const today = dayKey(now, tz);
  await mkdir(join(dir, 'history'), { recursive: true });

  await writeJson(join(dir, 'latest.json'), latest);

  const snapshot = { date: today, updatedAt: latest.generatedAt, players: {} };
  for (const p of latest.players) snapshot.players[p.id] = snapshotOf(p);
  await writeJson(join(dir, 'history', `${today}.json`), snapshot);

  await writeJson(join(dir, 'series.json'), await buildSeries(dir, today));
}

// Compacte les N derniers snapshots en un seul fichier pour que le site ne fasse que deux requêtes.
export async function buildSeries(dir, today) {
  const files = new Set(await readdir(join(dir, 'history')).catch(() => []));
  const dates = [];
  for (let i = SERIES_DAYS - 1; i >= 0; i--) dates.push(addDays(today, -i));

  const players = {};
  const first = dates.findIndex((d) => files.has(`${d}.json`));
  const kept = first === -1 ? [] : dates.slice(first);

  for (const [i, date] of kept.entries()) {
    const snap = files.has(`${date}.json`) ? await readJson(join(dir, 'history', `${date}.json`)) : null;
    for (const [id, v] of Object.entries(snap?.players ?? {})) {
      players[id] ??= { elo: Array(kept.length).fill(null), premier: Array(kept.length).fill(null), mm: Array(kept.length).fill(null) };
      players[id].elo[i] = v.elo;
      players[id].premier[i] = v.premier;
      players[id].mm[i] = v.mm;
    }
  }
  return { dates: kept, players };
}
