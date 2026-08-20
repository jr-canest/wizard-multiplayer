// ─── History cache (stale-while-revalidate) ────────────
// Mirror of the scorekeeper's history cache: the /history route paints
// instantly from the last successful fetch while a fresh one runs in
// the background. Separate origin from the scorekeeper, so the shared
// key name never clashes.

import type { PodiumStats } from './ratings';

const HISTORY_CACHE_KEY = 'wizard-history-cache-v1';

// Firestore Timestamps don't survive JSON.stringify as usable objects,
// so collapse them to a plain { seconds } shape — the History route's
// date formatters understand both.
function normalizeTimestamp(ts: unknown): { seconds: number } | null {
  if (!ts) return null;
  const t = ts as { toDate?: () => Date; seconds?: number };
  if (typeof t.toDate === 'function') {
    return { seconds: Math.floor(t.toDate().getTime() / 1000) };
  }
  if (typeof t.seconds === 'number') return { seconds: t.seconds };
  return null;
}

export type HistoryCache<P, G> = {
  players: P[];
  games: G[];
  podium: PodiumStats;
  cachedAt: number;
};

/** Read the cached { players, games, podium, cachedAt } or null. */
export function readHistoryCache<P, G>(): HistoryCache<P, G> | null {
  try {
    const raw = localStorage.getItem(HISTORY_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.players) || !Array.isArray(parsed.games)) {
      return null;
    }
    return parsed as HistoryCache<P, G>;
  } catch {
    return null;
  }
}

/** Persist the latest players + games + podium stats for instant re-opens. */
export function writeHistoryCache<P, G extends { date?: unknown }>(
  players: P[],
  games: G[],
  podium: PodiumStats = {},
): void {
  try {
    const safeGames = games.map((g) => ({
      ...g,
      date: normalizeTimestamp(g.date),
    }));
    localStorage.setItem(
      HISTORY_CACHE_KEY,
      JSON.stringify({ players, games: safeGames, podium, cachedAt: Date.now() }),
    );
  } catch {
    // storage full or unavailable — cache is best-effort
  }
}
