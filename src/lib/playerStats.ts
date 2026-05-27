import type { Card, LogEntry, Suit, Rank } from './types';
import { roundBreakdownFromLog } from './history';

export type CardCount = {
  // Stable key: 'W' / 'J' / `${rank}${suit}` (e.g. '14H').
  key: string;
  card: Card;
  count: number;
};

export type BidStats = {
  rounds: number;
  exact: number;
  over: number;
  under: number;
  zeroBidsAttempted: number;
  zeroBidsHit: number;
  byHandSize: Array<{
    bucket: string;
    rounds: number;
    exact: number;
  }>;
};

export type TrickStats = {
  asLead: { tricks: number; won: number };
  asFollow: { tricks: number; won: number };
  // Suit counts only for standard-card wins. Wizard/Jester wins tracked
  // separately so the suit breakdown stays meaningful.
  winsBySuit: Record<Suit, number>;
  wizardWins: number;
  jesterWins: number;
  totalTricksPlayed: number;
  totalTricksWon: number;
};

export type PlayerStats = {
  gamesWithLog: number;
  topWinningCards: CardCount[];
  bidStats: BidStats;
  trickStats: TrickStats;
};

type GameLike = {
  log?: LogEntry[];
};

function cardKey(card: Card): string {
  if (card.kind === 'wizard') return 'W';
  if (card.kind === 'jester') return 'J';
  return `${card.rank}${card.suit}`;
}

// Build a fresh Card sample for display from a key. We don't preserve
// `id` for wizards/jesters since the image and label are identical
// across the four copies of each.
function cardFromKey(key: string): Card {
  if (key === 'W') return { kind: 'wizard', id: 1 };
  if (key === 'J') return { kind: 'jester', id: 1 };
  const suit = key.slice(-1) as Suit;
  const rank = Number(key.slice(0, -1)) as Rank;
  return { kind: 'standard', suit, rank };
}

type TrickGroup = {
  round: number;
  trick: number;
  plays: Array<{ player: string; card: Card }>;
  winner: string | null;
};

/**
 * Group a game log's `play` and `trickWin` entries by (round, trick).
 * Play order within a trick is preserved by the log's append order —
 * the first play in `plays` is the lead.
 */
function tricksFromLog(log: LogEntry[]): TrickGroup[] {
  const map = new Map<string, TrickGroup>();
  for (const e of log) {
    if (e.t === 'play') {
      const key = `${e.round}:${e.trick}`;
      let group = map.get(key);
      if (!group) {
        group = { round: e.round, trick: e.trick, plays: [], winner: null };
        map.set(key, group);
      }
      group.plays.push({ player: e.player, card: e.card });
    } else if (e.t === 'trickWin') {
      const key = `${e.round}:${e.trick}`;
      const group = map.get(key);
      if (group) group.winner = e.winner;
    }
  }
  return Array.from(map.values()).sort((a, b) =>
    a.round !== b.round ? a.round - b.round : a.trick - b.trick,
  );
}

function handSizeBucket(round: number): string {
  if (round === 1) return '1';
  if (round <= 5) return '2–5';
  if (round <= 10) return '6–10';
  return '11+';
}

const BUCKET_ORDER = ['1', '2–5', '6–10', '11+'];

/**
 * Walk every game's log + per-round breakdown, accumulating stats for
 * any trick / round where the actor matches any of the supplied names
 * (used so a merged player's aliases all roll up into one profile).
 */
export function computePlayerStats(
  games: GameLike[],
  names: string[],
): PlayerStats {
  const nameSet = new Set(names.map((n) => n.toLowerCase()));
  const matchesPlayer = (n: string) => nameSet.has(n.toLowerCase());

  const winningCardCounts = new Map<string, number>();
  const trickStats: TrickStats = {
    asLead: { tricks: 0, won: 0 },
    asFollow: { tricks: 0, won: 0 },
    winsBySuit: { H: 0, D: 0, C: 0, S: 0 },
    wizardWins: 0,
    jesterWins: 0,
    totalTricksPlayed: 0,
    totalTricksWon: 0,
  };
  const bidStats: BidStats = {
    rounds: 0,
    exact: 0,
    over: 0,
    under: 0,
    zeroBidsAttempted: 0,
    zeroBidsHit: 0,
    byHandSize: [],
  };
  const bucketAccum = new Map<string, { rounds: number; exact: number }>();
  let gamesWithLog = 0;

  for (const game of games) {
    if (!Array.isArray(game.log) || game.log.length === 0) continue;
    gamesWithLog++;

    // Trick-level walk.
    const tricks = tricksFromLog(game.log);
    for (const t of tricks) {
      const myPlayIdx = t.plays.findIndex((p) => matchesPlayer(p.player));
      if (myPlayIdx === -1) continue;
      const myPlay = t.plays[myPlayIdx];
      const isLead = myPlayIdx === 0;
      trickStats.totalTricksPlayed++;
      if (isLead) trickStats.asLead.tricks++;
      else trickStats.asFollow.tricks++;

      if (t.winner && matchesPlayer(t.winner)) {
        trickStats.totalTricksWon++;
        if (isLead) trickStats.asLead.won++;
        else trickStats.asFollow.won++;

        const card = myPlay.card;
        const key = cardKey(card);
        winningCardCounts.set(key, (winningCardCounts.get(key) ?? 0) + 1);
        if (card.kind === 'wizard') trickStats.wizardWins++;
        else if (card.kind === 'jester') trickStats.jesterWins++;
        else trickStats.winsBySuit[card.suit]++;
      }
    }

    // Bid accuracy walk (round-level).
    const breakdown = roundBreakdownFromLog(game.log);
    for (const r of breakdown) {
      // Pick the bid/tricks under whichever of our names appears.
      let bid: number | undefined;
      let tricks = 0;
      for (const [name, b] of Object.entries(r.bids)) {
        if (matchesPlayer(name)) {
          bid = b;
          break;
        }
      }
      if (bid === undefined) continue;
      for (const [name, t] of Object.entries(r.tricks)) {
        if (matchesPlayer(name)) {
          tricks = t;
          break;
        }
      }
      bidStats.rounds++;
      if (bid === tricks) bidStats.exact++;
      else if (bid > tricks) bidStats.over++;
      else bidStats.under++;
      if (bid === 0) {
        bidStats.zeroBidsAttempted++;
        if (tricks === 0) bidStats.zeroBidsHit++;
      }

      const bucket = handSizeBucket(r.round);
      const cur = bucketAccum.get(bucket) ?? { rounds: 0, exact: 0 };
      cur.rounds++;
      if (bid === tricks) cur.exact++;
      bucketAccum.set(bucket, cur);
    }
  }

  bidStats.byHandSize = BUCKET_ORDER.filter((b) => bucketAccum.has(b)).map(
    (b) => ({
      bucket: b,
      rounds: bucketAccum.get(b)!.rounds,
      exact: bucketAccum.get(b)!.exact,
    }),
  );

  const topWinningCards: CardCount[] = Array.from(winningCardCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, count]) => ({ key, card: cardFromKey(key), count }));

  return {
    gamesWithLog,
    topWinningCards,
    bidStats,
    trickStats,
  };
}
