// ─── All-time leaderboard rating ─────────────────────────
// TS port of the scorekeeper's src/utils/ratings.js — keep the two in
// lockstep so the shared leaderboard ranks identically in both apps.
//
// Raw win% makes a player who won their single game rank above a
// regular who podiums every week. The Rating fixes that two ways:
//
//   1. Podium points per game, not just wins:
//        1st = 3 · 2nd = 2 · 3rd = 1 … but LAST place never scores
//        (so the loser of a 2-player game doesn't bank "2nd place"
//        points, and 3rd of 3 gets nothing).
//   2. A reliability damper: points are divided by (gamesPlayed + K)
//      instead of gamesPlayed. One lucky night gives 3/(1+3) = 0.75;
//      a regular who averages a podium a game climbs past that fast,
//      and the damper fades into noise as games pile up.
//
//   rating = podiumPoints / (gamesPlayed + RATING_DAMPER_GAMES)

export const RATING_DAMPER_GAMES = 3;

type RatablePlayer = {
  id: string;
  name: string;
  nameLower?: string;
  aliases?: string[];
  mergedInto?: string;
  gamesPlayed?: number;
};

type RatableGame = {
  playerCount?: number;
  results?: Array<{ playerId?: string; name: string; rank: number; bot?: string }>;
};

export type PodiumStats = Record<
  string,
  { firsts: number; seconds: number; thirds: number; points: number; games: number }
>;

function pointsForRank(rank: number, playerCount: number): number {
  if (rank >= playerCount) return 0; // last place never scores
  if (rank === 1) return 3;
  if (rank === 2) return 2;
  if (rank === 3) return 1;
  return 0;
}

/**
 * Chase `mergedInto` chains inside the already-fetched players array
 * so podium finishes recorded under a pre-merge doc id land on the
 * canonical player. Also builds a name → canonical-id map as a
 * fallback for old game docs that predate playerId stamping.
 */
function buildCanonicalMaps(players: RatablePlayer[]) {
  const byId = new Map(players.map((p) => [p.id, p]));
  const idToCanonical = new Map<string, string>();
  for (const p of players) {
    let current: RatablePlayer | undefined = p;
    for (let hop = 0; hop < 5 && current?.mergedInto; hop++) {
      const next = byId.get(current.mergedInto);
      if (!next || next.id === current.id) break;
      current = next;
    }
    idToCanonical.set(p.id, (current ?? p).id);
  }
  const nameToCanonical = new Map<string, string>();
  for (const p of players) {
    const canonicalId = idToCanonical.get(p.id);
    if (!canonicalId) continue;
    const names = [p.name, p.nameLower, ...(p.aliases ?? [])];
    for (const n of names) {
      if (typeof n === 'string' && n.length > 0) {
        nameToCanonical.set(n.toLowerCase(), canonicalId);
      }
    }
  }
  return { idToCanonical, nameToCanonical };
}

/**
 * Aggregate podium finishes + points per canonical player id from the
 * fetched game docs.
 */
export function computePodiumStats(
  players: RatablePlayer[],
  games: RatableGame[],
): PodiumStats {
  const { idToCanonical, nameToCanonical } = buildCanonicalMaps(players);
  const stats: PodiumStats = {};
  const ensure = (id: string) => {
    if (!stats[id]) {
      stats[id] = { firsts: 0, seconds: 0, thirds: 0, points: 0, games: 0 };
    }
    return stats[id];
  };

  for (const game of games ?? []) {
    const results = Array.isArray(game?.results) ? game.results : [];
    const playerCount = game.playerCount || results.length;
    for (const r of results) {
      if (r.bot) continue; // computer seat — no player doc, no rating
      const canonicalId =
        (r.playerId && idToCanonical.get(r.playerId)) ||
        (typeof r.name === 'string'
          ? nameToCanonical.get(r.name.toLowerCase())
          : null);
      if (!canonicalId) continue;
      const s = ensure(canonicalId);
      s.games += 1;
      const pts = pointsForRank(r.rank, playerCount);
      s.points += pts;
      if (pts === 3) s.firsts += 1;
      else if (pts === 2) s.seconds += 1;
      else if (pts === 1) s.thirds += 1;
    }
  }
  return stats;
}

/** Damped podium-points-per-game. See header comment. */
export function ratingForPlayer(
  player: RatablePlayer,
  podiumStats: PodiumStats | null | undefined,
): number {
  const s = podiumStats?.[player.id];
  const gp = player.gamesPlayed ?? 0;
  if (!s || gp === 0) return 0;
  return s.points / (gp + RATING_DAMPER_GAMES);
}
