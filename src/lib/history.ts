import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db, isProduction } from './firebase';
import { isBotName } from './rooms';
import type { LogEntry, RoomDoc } from './types';

/**
 * Test/dev signals that should keep the game out of the shared history,
 * skip AI summary calls, etc:
 *   - any bot in playerOrder (only added via the dev-mode toggle)
 *   - any player named 'test' (the dev-mode trigger name)
 */
export function isTestGame(room: RoomDoc): boolean {
  return room.playerOrder.some(
    (n) => isBotName(n) || n.trim().toLowerCase() === 'test',
  );
}

type RankedResult = {
  playerId: string;
  name: string;
  score: number;
  rank: number;
  shamePoints: number;
};

/**
 * Competition ranking: ties share the lower rank, next non-tie skips
 * (1, 2, 2, 4 …). Matches what the scorekeeper history view expects.
 */
function computeRanks(
  entries: Array<{ name: string; score: number }>,
): Array<{ name: string; score: number; rank: number }> {
  const sorted = entries.slice().sort((a, b) => b.score - a.score);
  let lastScore = Number.POSITIVE_INFINITY;
  let lastRank = 0;
  return sorted.map((entry, i) => {
    if (entry.score !== lastScore) {
      lastRank = i + 1;
      lastScore = entry.score;
    }
    return { ...entry, rank: lastRank };
  });
}

async function lookupPlayerId(name: string): Promise<string | null> {
  const nameLower = name.trim().toLowerCase();
  const q = query(
    collection(db, 'players'),
    where('nameLower', '==', nameLower),
    limit(1),
  );
  const snap = await getDocs(q);
  return snap.empty ? null : snap.docs[0].id;
}

/**
 * Persist a finished game to the shared `games` collection and update
 * each player's aggregate stats.
 *
 * Idempotent: a Firestore transaction flips `historyWritten` on the room
 * to claim the write — concurrent callers either claim or read the
 * existing gameId.
 *
 * Skipped on localhost (matches the scorekeeper's isProduction guard).
 */
export async function saveMultiplayerGame(
  code: string,
): Promise<string | null> {
  if (!isProduction()) return null;

  const roomRef = doc(db, 'rooms', code);

  const claim = await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return { go: false as const };
    const room = snap.data() as RoomDoc;
    if (room.status !== 'finished') return { go: false as const };
    if (room.historyWritten) {
      return { go: false as const, existingId: room.historyGameId };
    }
    // Belt-and-braces: never write test/bot games into the shared history,
    // even when running on the production URL.
    if (isTestGame(room)) {
      tx.update(roomRef, { historyWritten: true });
      return { go: false as const };
    }
    tx.update(roomRef, { historyWritten: true });
    return { go: true as const, room };
  });

  if (!claim.go) return claim.existingId ?? null;
  const room = claim.room;

  const playerScores = room.playerOrder.map((name) => ({
    name,
    score: room.cumulativeScores[name] ?? 0,
  }));
  const ranked = computeRanks(playerScores);

  // Resolve firebase IDs for all players (parallel).
  const idEntries = await Promise.all(
    ranked.map(async (r) => [r.name, await lookupPlayerId(r.name)] as const),
  );
  const idsByName = new Map(idEntries);

  const results: RankedResult[] = ranked.map((r) => ({
    playerId: idsByName.get(r.name) ?? '',
    name: r.name,
    score: r.score,
    rank: r.rank,
    shamePoints: 0,
  }));

  const winnerScore = ranked[0]?.score ?? 0;
  const winners = ranked.filter((r) => r.score === winnerScore);

  const gameDoc = {
    date: serverTimestamp(),
    roundCount: room.totalRounds,
    playerCount: room.playerOrder.length,
    results,
    source: 'multiplayer' as const,
    canadianRule: room.canadianRule,
    log: room.log,
  };

  const gameRef = await addDoc(collection(db, 'games'), gameDoc);

  // Update player aggregates (mirrors scorekeeper.saveGameResult).
  await Promise.all(
    results.map(async (r) => {
      if (!r.playerId) return;
      const playerRef = doc(db, 'players', r.playerId);
      const playerSnap = await getDoc(playerRef);
      const data = playerSnap.data() ?? {};

      const updates: Record<string, unknown> = {
        gamesPlayed: increment(1),
        totalScore: increment(r.score),
      };
      if (winners.some((w) => w.name === r.name)) {
        updates.wins = increment(1);
      }
      if (
        data.bestScore === null ||
        data.bestScore === undefined ||
        r.score > (data.bestScore as number)
      ) {
        updates.bestScore = r.score;
      }
      if (
        data.worstScore === null ||
        data.worstScore === undefined ||
        r.score < (data.worstScore as number)
      ) {
        updates.worstScore = r.score;
      }
      await updateDoc(playerRef, updates);
    }),
  );

  await updateDoc(roomRef, { historyGameId: gameRef.id });
  return gameRef.id;
}

export type Standing = {
  name: string;
  score: number;
  rank: number;
};

export function computeStandings(room: RoomDoc): Standing[] {
  return computeRanks(
    room.playerOrder.map((name) => ({
      name,
      score: room.cumulativeScores[name] ?? 0,
    })),
  );
}

export type GameRoundBreakdown = {
  round: number;
  bids: Record<string, number>;
  tricks: Record<string, number>;
  deltas: Record<string, number>;
};

/**
 * Reduce a finished game's log into per-round per-player bid/won/Δ
 * data, sorted by round number. Used by the History → game detail
 * modal to render the round-by-round table.
 */
export function roundBreakdownFromLog(log: LogEntry[]): GameRoundBreakdown[] {
  const byRound = new Map<number, GameRoundBreakdown>();
  function ensure(round: number): GameRoundBreakdown {
    let r = byRound.get(round);
    if (!r) {
      r = { round, bids: {}, tricks: {}, deltas: {} };
      byRound.set(round, r);
    }
    return r;
  }
  for (const entry of log) {
    if (entry.t === 'bid') {
      ensure(entry.round).bids[entry.player] = entry.bid;
    } else if (entry.t === 'trickWin') {
      const r = ensure(entry.round);
      r.tricks[entry.winner] = (r.tricks[entry.winner] ?? 0) + 1;
    } else if (entry.t === 'roundScore') {
      ensure(entry.round).deltas = entry.scores;
    }
  }
  return Array.from(byRound.values()).sort((a, b) => a.round - b.round);
}

/**
 * Resolve a player's canonical doc id by following `mergedInto`. The
 * merge chain is shallow in practice (1 hop), but this guards against
 * accidental multi-hops if someone re-merges. Returns the id passed in
 * if the player doc isn't found or isn't merged.
 */
async function resolveCanonicalPlayerId(playerId: string): Promise<string> {
  let currentId = playerId;
  for (let hop = 0; hop < 5; hop++) {
    const snap = await getDoc(doc(db, 'players', currentId));
    if (!snap.exists()) return currentId;
    const data = snap.data() as { mergedInto?: string };
    if (!data.mergedInto || data.mergedInto === currentId) return currentId;
    currentId = data.mergedInto;
  }
  return currentId;
}

/**
 * Delete a finished game and roll back the simple aggregate stats it
 * contributed: gamesPlayed, wins (if winner), totalScore. Best/worst
 * scores are NOT recomputed — they may show a slightly stale value
 * until the affected player finishes another game. The caller is
 * expected to confirm before invoking; this function performs the
 * write unconditionally.
 *
 * Player stat decrements follow `mergedInto` so deleting a game that
 * was played by an aliased name correctly removes the contribution
 * from the canonical doc.
 */
export async function deleteHistoryGame(gameId: string): Promise<void> {
  const gameRef = doc(db, 'games', gameId);
  const snap = await getDoc(gameRef);
  if (!snap.exists()) return;
  const data = snap.data() as {
    results?: Array<{ playerId?: string; name: string; score: number; rank: number }>;
  };
  const results = data.results ?? [];
  const winnerScore =
    results.length > 0
      ? Math.max(...results.map((r) => r.score))
      : -Infinity;

  // Run decrements in parallel — each is its own player doc.
  await Promise.all(
    results.map(async (r) => {
      if (!r.playerId) return;
      const targetId = await resolveCanonicalPlayerId(r.playerId);
      const playerRef = doc(db, 'players', targetId);
      const updates: Record<string, unknown> = {
        gamesPlayed: increment(-1),
        totalScore: increment(-r.score),
      };
      if (r.score === winnerScore) {
        updates.wins = increment(-1);
      }
      await updateDoc(playerRef, updates);
    }),
  );

  await deleteDoc(gameRef);
}
