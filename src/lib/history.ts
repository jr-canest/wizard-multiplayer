import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  getDoc,
  increment,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  updateDoc,
  where,
  limit,
  getDocs,
} from 'firebase/firestore';
import { db, isProduction } from './firebase';
import { botDifficultyOf } from './rooms';
import type { BotDifficulty, LogEntry, RoomDoc, RoundArchive } from './types';

/**
 * Test/dev signals that should keep the game out of the shared history,
 * skip AI summary calls, etc:
 *   - any player named 'test' (the dev-mode trigger name)
 * Games with computer players ARE recorded (Jorge, 2026-09-09): the game
 * shows in Past Games with the computer seats flagged, but computers
 * never get a `players` doc, so All-time stats stay human-only.
 */
export function isTestGame(room: RoomDoc): boolean {
  return room.playerOrder.some((n) => n.trim().toLowerCase() === 'test');
}

/**
 * Rounds actually scored, from the log. NOT room.totalRounds: a game
 * ended early ("end game now", or a kick down to one player) has fewer,
 * and using the planned count made the AI recap open with "Fifteen
 * rounds" on a ten-round game and History file it as fifteen.
 */
export function roundsPlayed(room: RoomDoc): number {
  return room.log.filter((e) => e.t === 'roundScore').length;
}

/**
 * The complete game log: archived rounds (rooms/{code}/rounds) stitched
 * back together with whatever is still on the room doc. Rooms from before
 * the archives (or rounds played before that deploy) fall back to the doc
 * for those rounds, so a game that straddled the change still reads whole.
 */
export async function loadFullLog(code: string, room: RoomDoc): Promise<LogEntry[]> {
  const snap = await getDocs(collection(db, 'rooms', code, 'rounds'));
  if (snap.empty) return room.log;
  const archived = new Map<number, RoundArchive>();
  for (const d of snap.docs) {
    const a = d.data() as RoundArchive;
    if (typeof a.round === 'number' && Array.isArray(a.log)) archived.set(a.round, a);
  }
  const onDoc = (r: number) =>
    room.log.filter((e) => e.t !== 'gameOver' && e.round === r);
  const lastRound = Math.max(room.currentRound, ...archived.keys());
  const out: LogEntry[] = [];
  for (let r = 1; r <= lastRound; r++) {
    const a = archived.get(r);
    out.push(...(a ? a.log : onDoc(r)));
  }
  for (const e of room.log) if (e.t === 'gameOver') out.push(e);
  return out;
}

type RankedResult = {
  playerId: string;
  name: string;
  score: number;
  rank: number;
  shamePoints: number;
  // Set on computer seats (difficulty). Both History screens render a
  // chip for it and skip these rows in every player-stat computation.
  bot?: BotDifficulty;
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
    // Belt-and-braces: never write test games into the shared history,
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

  // Resolve firebase IDs for the humans (parallel). Computer seats are
  // never looked up — a human who happens to share a wizard name must
  // not be credited with the computer's result.
  const idEntries = await Promise.all(
    ranked.map(async (r) => {
      if (botDifficultyOf(room, r.name)) return [r.name, null] as const;
      return [r.name, await lookupPlayerId(r.name)] as const;
    }),
  );
  const idsByName = new Map(idEntries);

  const results: RankedResult[] = ranked.map((r) => {
    const bot = botDifficultyOf(room, r.name);
    return {
      playerId: idsByName.get(r.name) ?? '',
      name: r.name,
      score: r.score,
      rank: r.rank,
      shamePoints: 0,
      ...(bot ? { bot } : {}),
    };
  });

  const winnerScore = ranked[0]?.score ?? 0;
  const winners = ranked.filter((r) => r.score === winnerScore);

  const gameDoc = {
    date: serverTimestamp(),
    roundCount: roundsPlayed(room),
    playerCount: room.playerOrder.length,
    results,
    source: 'multiplayer' as const,
    canadianRule: room.canadianRule,
    // History keeps the WHOLE log (player stats mine the plays), so pull
    // the archived rounds back in.
    log: await loadFullLog(code, room),
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

type SavedRound = {
  round: number;
  cardsDealt?: number;
  bids?: Record<string, number>;
  tricks?: Record<string, number>;
  scores?: Record<string, number>;
};

type GameDocLike = {
  log?: LogEntry[];
  rounds?: SavedRound[];
};

/**
 * Unified per-round breakdown that handles both shapes the game doc
 * may carry: `log` (multiplayer-sourced) or `rounds` (scorekeeper-
 * sourced, name-keyed). Returns [] for old games that have neither.
 */
export function roundBreakdownFromGame(game: GameDocLike): GameRoundBreakdown[] {
  if (Array.isArray(game.log) && game.log.length > 0) {
    return roundBreakdownFromLog(game.log);
  }
  if (Array.isArray(game.rounds) && game.rounds.length > 0) {
    return game.rounds
      .slice()
      .sort((a, b) => (a.round ?? 0) - (b.round ?? 0))
      .map((r) => ({
        round: r.round,
        bids: r.bids ?? {},
        tricks: r.tricks ?? {},
        deltas: r.scores ?? {},
      }));
  }
  return [];
}

/**
 * Reduce a finished game's log into per-round per-player bid/won/Δ
 * data, sorted by round number. Multiplayer-sourced games only —
 * prefer `roundBreakdownFromGame` at the call site so scorekeeper-
 * sourced games are handled too.
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

type StoredGameResult = {
  playerId?: string;
  name: string;
  bot?: string;
  score: number;
  rank: number;
};

type StoredGameDoc = {
  results?: StoredGameResult[];
};

/**
 * Walk every stored game (capped at the most recent 500) and return
 * the max + min score recorded for any of the supplied names. Used
 * after deleting a game to recompute a player's bestScore / worstScore
 * when the deleted game's score sat at one of those boundaries.
 *
 * Names list includes the canonical name + every alias, so a merged
 * player's full history is considered even though past `games` docs
 * store the original (possibly aliased) name.
 */
async function findBestWorstForNames(
  names: string[],
): Promise<{ best: number | null; worst: number | null }> {
  if (names.length === 0) return { best: null, worst: null };
  const nameSet = new Set(names);
  const snap = await getDocs(
    query(collection(db, 'games'), orderBy('date', 'desc'), limit(500)),
  );
  let best: number | null = null;
  let worst: number | null = null;
  for (const d of snap.docs) {
    const data = d.data() as StoredGameDoc;
    for (const r of data.results ?? []) {
      if (r.bot || !nameSet.has(r.name)) continue;
      if (best === null || r.score > best) best = r.score;
      if (worst === null || r.score < worst) worst = r.score;
    }
  }
  return { best, worst };
}

/**
 * Delete a finished game and roll back the aggregate stats it
 * contributed: gamesPlayed, wins (if winner), totalScore, plus
 * bestScore / worstScore IF the deleted game's score happened to be
 * that player's current best or worst (in which case those fields are
 * recomputed by scanning all remaining games for the player's name +
 * aliases). If the deleted game wasn't at either boundary, best/worst
 * are left alone — no scan needed.
 *
 * Player stat updates follow `mergedInto` so deleting a game played by
 * an aliased name correctly adjusts the canonical doc.
 */
export async function deleteHistoryGame(gameId: string): Promise<void> {
  const gameRef = doc(db, 'games', gameId);
  const gameSnap = await getDoc(gameRef);
  if (!gameSnap.exists()) return;
  const data = gameSnap.data() as StoredGameDoc;
  const results = data.results ?? [];
  const winnerScore =
    results.length > 0
      ? Math.max(...results.map((r) => r.score))
      : -Infinity;

  // Pre-resolve each result to its canonical player doc + capture
  // current best/worst BEFORE we touch anything, so we know whether
  // the deleted game's score sat at a boundary.
  type Resolved = {
    result: StoredGameResult;
    canonicalId: string;
    namesForRecompute: string[];
    currentBest: number | null | undefined;
    currentWorst: number | null | undefined;
  };
  const resolved: Array<Resolved | null> = await Promise.all(
    results.map(async (r): Promise<Resolved | null> => {
      if (r.bot || !r.playerId) return null;
      const canonicalId = await resolveCanonicalPlayerId(r.playerId);
      const pSnap = await getDoc(doc(db, 'players', canonicalId));
      if (!pSnap.exists()) return null;
      const pdata = pSnap.data() as {
        name?: string;
        aliases?: string[];
        bestScore?: number | null;
        worstScore?: number | null;
      };
      const namesForRecompute = [pdata.name ?? '', ...(pdata.aliases ?? [])]
        .filter((n) => n.length > 0);
      return {
        result: r,
        canonicalId,
        namesForRecompute,
        currentBest: pdata.bestScore,
        currentWorst: pdata.worstScore,
      };
    }),
  );

  // Delete the game first so the recompute scan naturally excludes it.
  await deleteDoc(gameRef);

  await Promise.all(
    resolved.map(async (r) => {
      if (!r) return;
      const updates: Record<string, unknown> = {
        gamesPlayed: increment(-1),
        totalScore: increment(-r.result.score),
      };
      if (r.result.score === winnerScore) {
        updates.wins = increment(-1);
      }

      const wasBest =
        r.currentBest !== null &&
        r.currentBest !== undefined &&
        r.result.score === r.currentBest;
      const wasWorst =
        r.currentWorst !== null &&
        r.currentWorst !== undefined &&
        r.result.score === r.currentWorst;
      if (wasBest || wasWorst) {
        const { best, worst } = await findBestWorstForNames(
          r.namesForRecompute,
        );
        if (wasBest) updates.bestScore = best;
        if (wasWorst) updates.worstScore = worst;
      }

      await updateDoc(doc(db, 'players', r.canonicalId), updates);
    }),
  );
}
