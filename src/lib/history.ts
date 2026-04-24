import {
  addDoc,
  collection,
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
import type { RoomDoc } from './types';

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
