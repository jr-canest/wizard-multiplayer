import {
  Timestamp,
  collection,
  deleteDoc,
  doc,
  getDocs,
  runTransaction,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { isBotName } from './rooms';
import type { PlayerSnapshot } from '../hooks/useRoom';
import type { RoomDoc } from './types';

export const HEARTBEAT_INTERVAL_MS = 10_000;
export const STALE_AFTER_MS = 30_000;
export const KICK_GRACE_MS = 60_000;

function lastSeenMs(p: PlayerSnapshot): number {
  if (isBotName(p.name)) return Date.now();
  const ts = p.lastHeartbeatAt;
  if (ts instanceof Timestamp) return ts.toMillis();
  return 0;
}

export function isConnected(p: PlayerSnapshot, now = Date.now()): boolean {
  return now - lastSeenMs(p) < STALE_AFTER_MS;
}

/**
 * How long until vote-kick becomes available, in ms. Negative once available.
 * Approximation: grace starts the moment the player goes stale, regardless
 * of whether their turn has actually begun. Trades a bit of fidelity for not
 * needing a server-side `turnStartedAt` field.
 */
export function graceRemainingMs(
  p: PlayerSnapshot,
  now = Date.now(),
): number {
  const since = now - lastSeenMs(p);
  if (since < STALE_AFTER_MS) return KICK_GRACE_MS;
  return KICK_GRACE_MS - (since - STALE_AFTER_MS);
}

export async function setVoteKick(
  code: string,
  voterName: string,
  target: string | null,
): Promise<void> {
  const ref = doc(db, 'rooms', code, 'players', voterName);
  await updateDoc(ref, { voteKickAgainst: target });
}

export type VoteTally = {
  votes: number;
  needed: number;
  voters: string[];
};

/**
 * Tally voteKickAgainst for `target`. Eligible voters = connected players
 * other than the target itself. Majority threshold = floor(eligible/2)+1.
 */
export function tallyVotes(
  players: PlayerSnapshot[],
  target: string,
  now = Date.now(),
): VoteTally {
  const eligible = players.filter(
    (p) => p.name !== target && isConnected(p, now),
  );
  const voters = eligible
    .filter((p) => p.voteKickAgainst === target)
    .map((p) => p.name);
  const needed = Math.floor(eligible.length / 2) + 1;
  return { votes: voters.length, needed, voters };
}

/**
 * Idempotent kick. Removes target from playerOrder, fixes indices, resets
 * any in-flight trick (drops all plays so the round restarts cleanly with
 * the new player count), then deletes the target's player + hand docs and
 * clears every remaining player's voteKickAgainst.
 *
 * Safe to call from multiple clients — first one wins, others see the
 * target already gone and bail.
 */
export async function executeKick(
  code: string,
  target: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (!room.playerOrder.includes(target)) return; // already kicked

    const oldOrder = room.playerOrder;
    const newOrder = oldOrder.filter((n) => n !== target);

    // If a kick would drop us below 2 players the game can't continue;
    // bail straight to 'finished' and let the final scoreboard show.
    if (newOrder.length < 2) {
      tx.update(roomRef, {
        status: 'finished',
        playerOrder: newOrder,
      });
      return;
    }

    const oldDealer = oldOrder[room.dealerIndex];
    const oldCurrent = oldOrder[room.currentPlayerIndex];

    let newDealerIndex = newOrder.indexOf(oldDealer);
    if (newDealerIndex === -1) {
      // Dealer was kicked — slot the next player in the old order into the
      // dealer position so rotation continues forward.
      newDealerIndex = room.dealerIndex % newOrder.length;
    }

    let newCurrentPlayerIndex = newOrder.indexOf(oldCurrent);
    if (newCurrentPlayerIndex === -1) {
      newCurrentPlayerIndex = (newDealerIndex + 1) % newOrder.length;
    }

    const newBids = { ...room.bids };
    delete newBids[target];
    const newTricksWon = { ...room.tricksWon };
    delete newTricksWon[target];
    const newCumulative = { ...room.cumulativeScores };
    delete newCumulative[target];

    const updates: Partial<RoomDoc> = {
      playerOrder: newOrder,
      dealerIndex: newDealerIndex,
      currentPlayerIndex: newCurrentPlayerIndex,
      bids: newBids,
      tricksWon: newTricksWon,
      cumulativeScores: newCumulative,
    };

    // Mid-trick: scrap the partial trick. Easier and safer than trying to
    // splice the kicked player's play out and recompute lead suit. The
    // round picks back up with the new player count from the leader.
    if (room.status === 'playing' && room.trickInProgress.length > 0) {
      updates.trickInProgress = [];
      updates.leadSuit = null;
      // Trick leader was first to play this trick; if they're still here
      // they lead again, otherwise dealer's-left takes over.
      const oldLeader = room.trickInProgress[0]?.playerName;
      const leaderIdx = oldLeader ? newOrder.indexOf(oldLeader) : -1;
      updates.currentPlayerIndex =
        leaderIdx >= 0 ? leaderIdx : (newDealerIndex + 1) % newOrder.length;
    }

    // During bidding, skip past anyone who has already bid so we don't
    // strand the round on a player who can't act. If everyone left has
    // bid, jump to the playing phase mirroring placeBid's tail logic.
    if (room.status === 'bidding') {
      const allBidIn = newOrder.every((n) => newBids[n] !== undefined);
      if (allBidIn) {
        updates.status = 'playing';
        updates.currentTrick = 1;
        updates.currentPlayerIndex = (newDealerIndex + 1) % newOrder.length;
        updates.leadSuit = null;
        updates.trickInProgress = [];
      } else {
        let idx = newCurrentPlayerIndex;
        for (let i = 0; i < newOrder.length; i++) {
          if (newBids[newOrder[idx]] === undefined) break;
          idx = (idx + 1) % newOrder.length;
        }
        updates.currentPlayerIndex = idx;
      }
    }

    tx.update(roomRef, updates);
  });

  // Sub-doc cleanup outside the transaction.
  await Promise.all([
    deleteDoc(doc(db, 'rooms', code, 'players', target)).catch(() => {}),
    deleteDoc(doc(db, 'rooms', code, 'hands', target)).catch(() => {}),
  ]);

  // Reset everyone's vote so a stale "kick X" vote doesn't fire later.
  const playersSnap = await getDocs(collection(db, 'rooms', code, 'players'));
  await Promise.all(
    playersSnap.docs.map((d) =>
      updateDoc(d.ref, { voteKickAgainst: null }).catch(() => {}),
    ),
  );
}
