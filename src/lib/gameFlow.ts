import {
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  runTransaction,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { buildDeck, deal, shuffle, totalRoundsFor } from '../game/deck';
import { getLeadInfo, isLegalPlay } from '../game/legalMoves';
import { winningPlayIndex } from '../game/trickWinner';
import { calcRoundScore } from '../game/scoring';
import { violatesCanadianRule } from '../game/canadianRule';
import { isBot } from './rooms';
import { UNDO_VOTE_TTL_MS } from './types';
export { violatesCanadianRule };
import type {
  Card,
  HandDoc,
  LogEntry,
  PendingUndo,
  RoomDoc,
  Suit,
  UndoSnapshot,
} from './types';

/**
 * Broadcast a reaction to the room. Clients display it briefly based on
 * the timestamp (soft TTL). Overwrites any prior reaction.
 */
export async function postReaction(
  code: string,
  player: string,
  text: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await updateDoc(roomRef, {
    lastReaction: { player, text, ts: Date.now() },
  });
}

/*
 * Chat used to live here as an arrayUnion append to the room document.
 * It now has its own subcollection, see src/lib/chat.ts. The `chat: []`
 * wipes below stay so any message written by a client still running the
 * old build gets cleared at the same window boundaries as before.
 */

/**
 * Toggle the caller's vote that the next round should be the last. When the
 * tally reaches a majority of non-bot players, the room's totalRounds is
 * shrunk so scoreAndAdvance ends the game after the next round.
 */
export async function voteEndEarly(
  code: string,
  callerName: string,
  voteYes: boolean,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (room.status !== 'scoring') return;

    const current = new Set(room.endEarlyVotes ?? []);
    if (voteYes) current.add(callerName);
    else current.delete(callerName);

    // Threshold = majority of real (non-bot) players.
    const realPlayers = room.playerOrder.filter(
      (n) => !isBot(room, n),
    );
    const realVotes = [...current].filter(
      (n) => !isBot(room, n) && realPlayers.includes(n),
    );
    const threshold = Math.floor(realPlayers.length / 2) + 1;

    if (realVotes.length >= threshold) {
      // Shrink totalRounds so the next round is the last. Scoring of round
      // N+1 will then see currentRound >= totalRounds and finish the game.
      const newTotal = Math.max(room.currentRound + 1, room.currentRound);
      tx.update(roomRef, {
        totalRounds: newTotal,
        endEarlyVotes: [],
      });
    } else {
      tx.update(roomRef, { endEarlyVotes: [...current] });
    }
  });
}

/**
 * Toggle the caller's vote to advance to the next round (or finish the
 * game on the final round). Mid-game advance is UNANIMOUS so no one is
 * skipped past a round they cared about. The final-round "finish game"
 * vote is MAJORITY so a hold-out can't trap the rest of the table.
 */
export async function voteNextRound(
  code: string,
  callerName: string,
  voteYes: boolean,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  let advance = false;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (room.status !== 'scoring') return;

    const current = new Set(room.nextRoundVotes ?? []);
    if (voteYes) current.add(callerName);
    else current.delete(callerName);

    const realPlayers = room.playerOrder.filter(
      (n) => !isBot(room, n),
    );
    const realVotes = [...current].filter(
      (n) => !isBot(room, n) && realPlayers.includes(n),
    );

    const isFinalRound = room.currentRound >= room.totalRounds;
    const threshold = isFinalRound
      ? Math.floor(realPlayers.length / 2) + 1
      : realPlayers.length;

    if (realPlayers.length > 0 && realVotes.length >= threshold) {
      tx.update(roomRef, { nextRoundVotes: [] });
      advance = true;
    } else {
      tx.update(roomRef, { nextRoundVotes: [...current] });
    }
  });
  if (advance) await scoreAndAdvance(code);
}

/**
 * Toggle the caller's vote to end the game IMMEDIATELY with current
 * cumulative scores (majority of real players). When threshold is met,
 * the room flips to 'finished' — including this round's deltas if we
 * were in scoring.
 */
export async function voteEndGame(
  code: string,
  callerName: string,
  voteYes: boolean,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  let trigger = false;
  let snapshotRoom: RoomDoc | null = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    // Only available on the round-end score page.
    if (room.status !== 'scoring') return;

    const current = new Set(room.endGameVotes ?? []);
    if (voteYes) current.add(callerName);
    else current.delete(callerName);

    const realPlayers = room.playerOrder.filter(
      (n) => !isBot(room, n),
    );
    const realVotes = [...current].filter(
      (n) => !isBot(room, n) && realPlayers.includes(n),
    );
    const threshold = Math.floor(realPlayers.length / 2) + 1;

    if (realVotes.length >= threshold) {
      tx.update(roomRef, { endGameVotes: [] });
      trigger = true;
      snapshotRoom = room;
    } else {
      tx.update(roomRef, { endGameVotes: [...current] });
    }
  });
  if (!trigger || !snapshotRoom) return;
  const room: RoomDoc = snapshotRoom;
  // Final = log-based cumulative + this just-finished round's deltas
  // (status was 'scoring', so the round was about to be applied).
  const baseFromLog = cumulativeScoresFromLog(room.playerOrder, room.log);
  const deltas = computeRoundDeltas(
    room.playerOrder,
    room.bids,
    room.tricksWon,
  );
  const final: Record<string, number> = { ...baseFromLog };
  for (const name of room.playerOrder) {
    final[name] = (final[name] ?? 0) + (deltas[name] ?? 0);
  }
  const gameOverLog: LogEntry = { t: 'gameOver', finalScores: final };
  await updateDoc(roomRef, {
    status: 'finished',
    cumulativeScores: final,
    log: [...room.log, gameOverLog],
    pendingUndo: null,
  });
}

// (voteEndNow / endNowVotes were the mid-game variant of "next round
// is last". Replaced by voteEndEarly during scoring, which is the only
// place voting can happen now.)

export class FlowError extends Error {
  code:
    | 'notHost'
    | 'notLobby'
    | 'notEnoughPlayers'
    | 'notDealer'
    | 'notAwaiting'
    | 'notBidding'
    | 'notYourTurn'
    | 'invalidBid'
    | 'canadianRuleViolation'
    | 'notPlaying'
    | 'invalidCard'
    | 'illegalPlay'
    | 'notScoring'
    | 'notFinished'
    // An undo vote is open, which pauses the table for everyone.
    | 'undoVoteOpen';
  constructor(code: FlowError['code']) {
    super(code);
    this.code = code;
  }
}

/**
 * Host-only setter (lobby only) for the chosen round cap. null = let the
 * game play to the maximum allowed by the deck for the seat count.
 */
export async function setChosenTotalRounds(
  code: string,
  callerName: string,
  rounds: number | null,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (room.hostPlayerName !== callerName) return;
    if (room.status !== 'lobby') return;
    tx.update(roomRef, { chosenTotalRounds: rounds });
  });
}

/**
 * Host kicks off round 1: shuffle, deal, flip trump, write hands + room.
 *
 * If trump is a wizard, status stays `dealing` with `awaitingTrumpChoice`
 * true until the dealer picks. Otherwise we drop straight into `bidding`.
 */
export async function startGame(code: string, callerName: string): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) throw new FlowError('notLobby');
  const room = snap.data() as RoomDoc;

  if (room.hostPlayerName !== callerName) throw new FlowError('notHost');
  if (room.status !== 'lobby') throw new FlowError('notLobby');
  if (room.playerOrder.length < 3) throw new FlowError('notEnoughPlayers');

  const maxRounds = totalRoundsFor(room.playerOrder.length);
  // Honor the host's chosen cap, clamped to [1, maxRounds].
  const chosen = room.chosenTotalRounds;
  const totalRounds =
    chosen && chosen > 0 ? Math.min(chosen, maxRounds) : maxRounds;
  await dealNextRound(code, {
    ...room,
    totalRounds,
    currentRound: 0, // bumped to 1 inside
    dealerIndex: 0,
  });
}

/**
 * Deal the next round: shuffle, deal cardsPerPlayer (= roundNumber), flip
 * trump. Writes hand docs and updates the room. Internal — the public
 * entrypoints are startGame() and advanceRound() (added in step 8).
 */
export async function dealNextRound(code: string, prev: RoomDoc): Promise<void> {
  const playerOrder = prev.playerOrder;
  const playerCount = playerOrder.length;
  const nextRound = prev.currentRound + 1;
  const totalRounds = prev.totalRounds || totalRoundsFor(playerCount);
  const dealerIndex = nextRound === 1 ? prev.dealerIndex : (prev.dealerIndex + 1) % playerCount;
  const cardsPerPlayer = nextRound;

  const deck = shuffle(buildDeck());
  const { hands, trumpCard: dealtTrump } = deal(playerOrder, cardsPerPlayer, deck);

  // House rule: the declared final round always plays without trump,
  // regardless of how many cards remain in the deck.
  const isFinalRound = nextRound >= totalRounds;
  const trumpCard = isFinalRound ? null : dealtTrump;

  let trumpSuit: Suit | null = null;
  let awaitingTrumpChoice = false;
  if (trumpCard) {
    if (trumpCard.kind === 'standard') {
      trumpSuit = trumpCard.suit;
    } else if (trumpCard.kind === 'wizard') {
      awaitingTrumpChoice = true;
    }
    // Jester → trumpSuit stays null.
  }

  const tricksWon: Record<string, number> = {};
  for (const name of playerOrder) tricksWon[name] = 0;

  const dealLog: LogEntry = {
    t: 'deal',
    round: nextRound,
    dealer: playerOrder[dealerIndex],
  };
  const trumpLog: LogEntry = {
    t: 'trump',
    round: nextRound,
    card: trumpCard,
    chosenSuit: trumpSuit,
  };

  const batch = writeBatch(db);
  const roomRef = doc(db, 'rooms', code);
  batch.update(roomRef, {
    status: awaitingTrumpChoice ? 'dealing' : 'bidding',
    currentRound: nextRound,
    currentTrick: 0,
    totalRounds,
    dealerIndex,
    currentPlayerIndex: (dealerIndex + 1) % playerCount,
    trumpCard,
    trumpSuit,
    awaitingTrumpChoice,
    leadSuit: null,
    bids: {},
    tricksWon,
    trickInProgress: [],
    log: [...prev.log, dealLog, trumpLog],
    nextRoundVotes: [],
    endGameVotes: [],
    endEarlyVotes: [],
    pendingUndo: null,
    cumulativeScores: prev.cumulativeScores,
    // Legacy chat array, see src/lib/chat.ts. Wiped at the same window
    // boundaries as before so old-build messages do not linger.
    chat: [],
  });

  for (const [name, cards] of Object.entries(hands)) {
    const handDoc: HandDoc = { cards };
    batch.set(doc(db, 'rooms', code, 'hands', name), handDoc);
  }

  await batch.commit();
}

/** Dealer picks the trump suit after a Wizard trump flip. */
export async function chooseTrumpSuit(
  code: string,
  callerName: string,
  suit: Suit,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) throw new FlowError('notAwaiting');
  const room = snap.data() as RoomDoc;

  if (!room.awaitingTrumpChoice) throw new FlowError('notAwaiting');
  if (room.playerOrder[room.dealerIndex] !== callerName) {
    throw new FlowError('notDealer');
  }

  const lastLog = room.log[room.log.length - 1];
  const updatedLog =
    lastLog && lastLog.t === 'trump'
      ? [...room.log.slice(0, -1), { ...lastLog, chosenSuit: suit }]
      : room.log;

  await updateDoc(roomRef, {
    trumpSuit: suit,
    awaitingTrumpChoice: false,
    status: 'bidding',
    log: updatedLog,
  });
}

export async function placeBid(
  code: string,
  callerName: string,
  bid: number,
  localRoom?: RoomDoc,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  // Fast path: trust the caller's live snapshot instead of re-reading the
  // room (one round trip instead of two). Bidding is strictly turn-ordered,
  // so the snapshot that says "your turn" already holds every earlier bid.
  // Falls back to a fresh read while an undo vote is open, the one case
  // where the room can change under a player mid-turn.
  let room: RoomDoc;
  if (localRoom && !localRoom.pendingUndo?.requested) {
    room = localRoom;
  } else {
    const snap = await getDoc(roomRef);
    if (!snap.exists()) throw new FlowError('notBidding');
    room = snap.data() as RoomDoc;
  }

  if (room.status !== 'bidding') throw new FlowError('notBidding');
  // The table is paused while an undo vote is open.
  if (room.pendingUndo?.requested) throw new FlowError('undoVoteOpen');

  const playerCount = room.playerOrder.length;
  const expectedName = room.playerOrder[room.currentPlayerIndex];
  if (expectedName !== callerName) throw new FlowError('notYourTurn');

  const cardsThisRound = room.currentRound;
  if (!Number.isInteger(bid) || bid < 0 || bid > cardsThisRound) {
    throw new FlowError('invalidBid');
  }

  const dealerName = room.playerOrder[room.dealerIndex];
  const otherBidsSum = Object.values(room.bids).reduce((a, b) => a + b, 0);

  if (
    violatesCanadianRule({
      isDealerBid: callerName === dealerName,
      canadianRule: room.canadianRule,
      currentRound: room.currentRound,
      cardsThisRound,
      otherBidsSum,
      bid,
    })
  ) {
    throw new FlowError('canadianRuleViolation');
  }

  const nextBids = { ...room.bids, [callerName]: bid };
  const allBidIn = Object.keys(nextBids).length === playerCount;

  const bidLog: LogEntry = {
    t: 'bid',
    round: room.currentRound,
    player: callerName,
    bid,
  };

  // Snapshot of state BEFORE this bid, used by the undo flow.
  const undoSnapshot: UndoSnapshot = {
    bids: room.bids,
    currentPlayerIndex: room.currentPlayerIndex,
    trickInProgress: room.trickInProgress,
    leadSuit: room.leadSuit,
    status: room.status,
    tricksWon: room.tricksWon,
    trickHistoryLen: room.trickHistory.length,
    currentTrick: room.currentTrick,
    logLen: room.log.length,
  };
  const pendingUndo: PendingUndo = {
    kind: 'bid',
    actor: callerName,
    requested: false,
    votes: [],
    // Carried so the vote modal can name what is being undone.
    bidValue: bid,
    snapshot: undoSnapshot,
  };

  if (allBidIn) {
    // Left of dealer leads the first trick.
    await updateDoc(roomRef, {
      bids: nextBids,
      status: 'playing',
      currentTrick: 1,
      currentPlayerIndex: (room.dealerIndex + 1) % playerCount,
      leadSuit: null,
      trickInProgress: [],
      log: arrayUnion(bidLog),
      pendingUndo,
    });
  } else {
    await updateDoc(roomRef, {
      bids: nextBids,
      currentPlayerIndex: (room.currentPlayerIndex + 1) % playerCount,
      log: arrayUnion(bidLog),
      pendingUndo,
    });
  }
}

/**
 * Play a card from the caller's hand. Resolves the trick when the last play
 * lands, and transitions to `scoring` when the round's last trick resolves.
 */
export type LocalPlayState = { room: RoomDoc; hand: Card[] };

export async function playCard(
  code: string,
  callerName: string,
  cardIndex: number,
  local?: LocalPlayState,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const handRef = doc(db, 'rooms', code, 'hands', callerName);

  // Fast path (2026-09-09): one atomic batch write computed from the
  // caller's live snapshot — ~240 ms vs ~680 ms for the transaction, and
  // the SDK applies it locally at once. Safe because plays are strictly
  // turn-ordered: the snapshot that made it my turn already contains every
  // earlier play of this trick, and the growing arrays are appended with
  // arrayUnion rather than rewritten. The only writer that can legitimately
  // change trick state under me is an undo restore, which needs an open
  // request — so while one is open we take the transactional path.
  if (local && !local.room.pendingUndo?.requested) {
    await playCardFast(code, callerName, cardIndex, local.room, local.hand);
    return;
  }

  await runTransaction(db, async (tx) => {
    // Both reads in flight at once — each is a server round trip and the
    // sequential form cost ~130 ms extra per play (measured 2026-09-09).
    const [roomSnap, handSnap] = await Promise.all([
      tx.get(roomRef),
      tx.get(handRef),
    ]);
    if (!roomSnap.exists() || !handSnap.exists()) {
      throw new FlowError('notPlaying');
    }
    const room = roomSnap.data() as RoomDoc;
    const hand = (handSnap.data() as HandDoc).cards;

    if (room.status !== 'playing') throw new FlowError('notPlaying');
    // The table is paused while an undo vote is open.
    if (room.pendingUndo?.requested) throw new FlowError('undoVoteOpen');
    if (room.playerOrder[room.currentPlayerIndex] !== callerName) {
      throw new FlowError('notYourTurn');
    }
    if (cardIndex < 0 || cardIndex >= hand.length) {
      throw new FlowError('invalidCard');
    }

    const card = hand[cardIndex];
    if (!isLegalPlay(hand, card, room.trickInProgress)) {
      throw new FlowError('illegalPlay');
    }

    const newHand = hand.slice();
    newHand.splice(cardIndex, 1);

    const playOrder = room.trickInProgress.length;
    const newTrick = [
      ...room.trickInProgress,
      { playerName: callerName, card, playOrder },
    ];

    const playLog: LogEntry = {
      t: 'play',
      round: room.currentRound,
      trick: room.currentTrick,
      player: callerName,
      card,
    };

    // Snapshot state BEFORE this play, including the actor's hand so undo
    // can put the card back.
    const undoSnapshot: UndoSnapshot = {
      bids: room.bids,
      currentPlayerIndex: room.currentPlayerIndex,
      trickInProgress: room.trickInProgress,
      leadSuit: room.leadSuit,
      status: room.status,
      tricksWon: room.tricksWon,
      trickHistoryLen: room.trickHistory.length,
      currentTrick: room.currentTrick,
      logLen: room.log.length,
      handCards: hand,
    };
    const pendingUndo: PendingUndo = {
      kind: 'play',
      actor: callerName,
      requested: false,
      votes: [],
      card,
      snapshot: undoSnapshot,
    };

    tx.update(handRef, { cards: newHand });

    if (newTrick.length < room.playerOrder.length) {
      const { leadSuit } = getLeadInfo(newTrick);
      tx.update(roomRef, {
        trickInProgress: newTrick,
        leadSuit,
        currentPlayerIndex: (room.currentPlayerIndex + 1) % room.playerOrder.length,
        log: [...room.log, playLog],
        pendingUndo,
      });
      return;
    }

    // Trick complete — resolve.
    const winnerIdx = winningPlayIndex(newTrick, room.trumpSuit);
    const winnerName = newTrick[winnerIdx].playerName;
    const winnerOrderIdx = room.playerOrder.indexOf(winnerName);

    const newTricksWon = {
      ...room.tricksWon,
      [winnerName]: (room.tricksWon[winnerName] ?? 0) + 1,
    };

    const trickHistEntry = {
      round: room.currentRound,
      trickNum: room.currentTrick,
      plays: newTrick.map((p) => ({ playerName: p.playerName, card: p.card })),
      winner: winnerName,
    };

    const trickWinLog: LogEntry = {
      t: 'trickWin',
      round: room.currentRound,
      trick: room.currentTrick,
      winner: winnerName,
    };

    const roundComplete = room.currentTrick >= room.currentRound;

    tx.update(roomRef, {
      trickInProgress: [],
      leadSuit: null,
      trickHistory: [...room.trickHistory, trickHistEntry],
      tricksWon: newTricksWon,
      currentTrick: roundComplete ? room.currentTrick : room.currentTrick + 1,
      currentPlayerIndex: winnerOrderIdx,
      status: roundComplete ? 'scoring' : 'playing',
      log: [...room.log, playLog, trickWinLog],
      pendingUndo,
    });
  });
}

async function playCardFast(
  code: string,
  callerName: string,
  cardIndex: number,
  room: RoomDoc,
  hand: Card[],
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const handRef = doc(db, 'rooms', code, 'hands', callerName);
  const playerCount = room.playerOrder.length;

  if (room.status !== 'playing') throw new FlowError('notPlaying');
  // The table is paused while an undo vote is open. playCard already
  // routes these to the transactional path; this is the backstop.
  if (room.pendingUndo?.requested) throw new FlowError('undoVoteOpen');
  if (room.playerOrder[room.currentPlayerIndex] !== callerName) {
    throw new FlowError('notYourTurn');
  }
  if (cardIndex < 0 || cardIndex >= hand.length) {
    throw new FlowError('invalidCard');
  }
  const card = hand[cardIndex];
  if (!isLegalPlay(hand, card, room.trickInProgress)) {
    throw new FlowError('illegalPlay');
  }

  const newHand = hand.slice();
  newHand.splice(cardIndex, 1);
  const playOrder = room.trickInProgress.length;
  const newTrick = [
    ...room.trickInProgress,
    { playerName: callerName, card, playOrder },
  ];
  const playLog: LogEntry = {
    t: 'play',
    round: room.currentRound,
    trick: room.currentTrick,
    player: callerName,
    card,
  };
  const pendingUndo: PendingUndo = {
    kind: 'play',
    actor: callerName,
    requested: false,
    votes: [],
    card,
    snapshot: {
      bids: room.bids,
      currentPlayerIndex: room.currentPlayerIndex,
      trickInProgress: room.trickInProgress,
      leadSuit: room.leadSuit,
      status: room.status,
      tricksWon: room.tricksWon,
      trickHistoryLen: room.trickHistory.length,
      currentTrick: room.currentTrick,
      logLen: room.log.length,
      handCards: hand,
    },
  };

  const batch = writeBatch(db);
  batch.update(handRef, { cards: newHand });

  if (newTrick.length < playerCount) {
    const { leadSuit } = getLeadInfo(newTrick);
    batch.update(roomRef, {
      trickInProgress: newTrick,
      leadSuit,
      currentPlayerIndex: (room.currentPlayerIndex + 1) % playerCount,
      log: arrayUnion(playLog),
      pendingUndo,
    });
    await batch.commit();
    return;
  }

  // Trick complete — resolve.
  const winnerIdx = winningPlayIndex(newTrick, room.trumpSuit);
  const winnerName = newTrick[winnerIdx].playerName;
  const newTricksWon = {
    ...room.tricksWon,
    [winnerName]: (room.tricksWon[winnerName] ?? 0) + 1,
  };
  const trickHistEntry = {
    round: room.currentRound,
    trickNum: room.currentTrick,
    plays: newTrick.map((p) => ({ playerName: p.playerName, card: p.card })),
    winner: winnerName,
  };
  const trickWinLog: LogEntry = {
    t: 'trickWin',
    round: room.currentRound,
    trick: room.currentTrick,
    winner: winnerName,
  };
  const roundComplete = room.currentTrick >= room.currentRound;

  batch.update(roomRef, {
    trickInProgress: [],
    leadSuit: null,
    trickHistory: arrayUnion(trickHistEntry),
    tricksWon: newTricksWon,
    currentTrick: roundComplete ? room.currentTrick : room.currentTrick + 1,
    currentPlayerIndex: room.playerOrder.indexOf(winnerName),
    status: roundComplete ? 'scoring' : 'playing',
    log: arrayUnion(playLog, trickWinLog),
    pendingUndo,
  });
  await batch.commit();
}

/**
 * Who actually gets a say: real (non-bot) seats. Bots never vote, and a
 * table of one human plus computers needs the undo to just happen.
 */
function undoElectorate(room: RoomDoc): {
  voters: string[];
  threshold: number;
} {
  const voters = room.playerOrder.filter((n) => !isBot(room, n));
  return { voters, threshold: Math.floor(voters.length / 2) + 1 };
}

/**
 * The room patch that puts the table back the way it was. Shared by every
 * path that can approve an undo, so "apply" means exactly one thing.
 */
function undoRestorePatch(room: RoomDoc, pu: PendingUndo): Partial<RoomDoc> {
  const s = pu.snapshot;
  return {
    bids: s.bids,
    currentPlayerIndex: s.currentPlayerIndex,
    trickInProgress: s.trickInProgress,
    leadSuit: s.leadSuit,
    status: s.status,
    tricksWon: s.tricksWon,
    // New snapshots truncate; legacy snapshots carry full copies.
    trickHistory:
      s.trickHistory ??
      room.trickHistory.slice(0, s.trickHistoryLen ?? room.trickHistory.length),
    currentTrick: s.currentTrick,
    log: s.log ?? room.log.slice(0, s.logLen ?? room.log.length),
    pendingUndo: null,
  };
}

/**
 * The actor toggles their request to undo their last bid/play. Until they
 * tap it only they see the prompt; once requested, the table is PAUSED
 * (placeBid/playCard refuse, the bot driver holds) and everyone gets the
 * center-screen vote. Toggling again cancels and resumes play.
 *
 * When the actor is the only real player (solo against computers) their
 * own approval already carries the vote, so the undo applies on the spot
 * rather than opening a vote nobody can answer, which would otherwise
 * pause the game forever.
 */
export async function requestUndo(
  code: string,
  callerName: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const handRefFor = (name: string) => doc(db, 'rooms', code, 'hands', name);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    const pu = room.pendingUndo;
    if (!pu) return;
    if (pu.actor !== callerName) return;

    if (pu.requested) {
      // Cancel: drop the request, clear votes, play resumes.
      tx.update(roomRef, {
        pendingUndo: { ...pu, requested: false, votes: [], noVotes: [] },
      });
      return;
    }

    const { threshold } = undoElectorate(room);
    if (threshold <= 1) {
      if (pu.kind === 'play' && pu.snapshot.handCards) {
        tx.set(handRefFor(pu.actor), { cards: pu.snapshot.handCards });
      }
      tx.update(
        roomRef,
        undoRestorePatch(room, pu) as Record<string, unknown>,
      );
      return;
    }

    tx.update(roomRef, {
      pendingUndo: {
        ...pu,
        requested: true,
        votes: [callerName],
        noVotes: [],
        requestedAt: Date.now(),
      },
    });
  });
}

/**
 * Cast or change a vote on an open undo. Approvals that reach a majority
 * of real players restore the snapshot; enough rejections to put that
 * majority out of reach deny the request outright, so a table never sits
 * paused waiting on a vote that can no longer pass.
 */
export async function voteUndo(
  code: string,
  callerName: string,
  voteYes: boolean,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const handRefFor = (name: string) => doc(db, 'rooms', code, 'hands', name);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    const pu = room.pendingUndo;
    if (!pu || !pu.requested) return;

    // The actor's approval is immutable: asking for the undo is the vote.
    if (callerName === pu.actor) return;

    const { voters, threshold } = undoElectorate(room);
    if (!voters.includes(callerName)) return;

    const yes = new Set(pu.votes.filter((n) => voters.includes(n)));
    const no = new Set((pu.noVotes ?? []).filter((n) => voters.includes(n)));
    // A vote is one or the other, never both.
    if (voteYes) {
      yes.add(callerName);
      no.delete(callerName);
    } else {
      no.add(callerName);
      yes.delete(callerName);
    }

    if (yes.size >= threshold) {
      if (pu.kind === 'play' && pu.snapshot.handCards) {
        tx.set(handRefFor(pu.actor), { cards: pu.snapshot.handCards });
      }
      tx.update(
        roomRef,
        undoRestorePatch(room, pu) as Record<string, unknown>,
      );
      return;
    }

    // Denied: even if every remaining voter said yes it could not pass.
    if (voters.length - no.size < threshold) {
      tx.update(roomRef, { pendingUndo: null });
      return;
    }

    tx.update(roomRef, {
      pendingUndo: { ...pu, votes: [...yes], noVotes: [...no] },
    });
  });
}

/**
 * Clear an undo vote that has been open past {@link UNDO_VOTE_TTL_MS}.
 * Any client may call it, and the guard inside makes a race harmless:
 * whoever lands first clears it, the rest no-op. This is what keeps one
 * backgrounded phone from pausing the table indefinitely.
 */
export async function resolveExpiredUndo(code: string): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    const pu = room.pendingUndo;
    if (!pu?.requested) return;
    const openedAt = pu.requestedAt ?? 0;
    if (Date.now() - openedAt < UNDO_VOTE_TTL_MS) return;
    tx.update(roomRef, { pendingUndo: null });
  });
}

/**
 * Reconstruct cumulative scores from the game log's `roundScore` entries.
 * Authoritative source of truth — used to self-heal rooms whose
 * cumulativeScores doc field drifted (older bug: dealNextRound didn't
 * persist it between rounds).
 */
export function cumulativeScoresFromLog(
  playerOrder: string[],
  log: LogEntry[],
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of playerOrder) out[name] = 0;
  for (const entry of log) {
    if (entry.t === 'roundScore') {
      for (const name of playerOrder) {
        out[name] = (out[name] ?? 0) + (entry.scores[name] ?? 0);
      }
    }
  }
  return out;
}

/**
 * Compute per-player round deltas from bids vs. tricks won.
 */
export function computeRoundDeltas(
  playerOrder: string[],
  bids: Record<string, number>,
  tricksWon: Record<string, number>,
): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of playerOrder) {
    const bid = bids[name] ?? 0;
    const won = tricksWon[name] ?? 0;
    out[name] = calcRoundScore(bid, won);
  }
  return out;
}

/**
 * Apply round deltas to cumulativeScores and either deal the next round or
 * transition to `finished`. Idempotent — no-ops if status isn't `scoring`,
 * so any client can call it without coordination.
 */
export async function scoreAndAdvance(code: string): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) throw new FlowError('notScoring');
  const room = snap.data() as RoomDoc;

  if (room.status !== 'scoring') return; // someone else already advanced

  const deltas = computeRoundDeltas(room.playerOrder, room.bids, room.tricksWon);
  // Recompute the running total from the log so we self-heal if the doc's
  // cumulativeScores drifted (older bug). The log's roundScore entries are
  // the authoritative ledger.
  const newCumulative = cumulativeScoresFromLog(room.playerOrder, room.log);
  for (const name of room.playerOrder) {
    newCumulative[name] = (newCumulative[name] ?? 0) + (deltas[name] ?? 0);
  }

  const scoreLog: LogEntry = {
    t: 'roundScore',
    round: room.currentRound,
    scores: deltas,
  };

  const isFinalRound = room.currentRound >= room.totalRounds;

  if (isFinalRound) {
    const gameOverLog: LogEntry = {
      t: 'gameOver',
      finalScores: newCumulative,
    };
    await updateDoc(roomRef, {
      cumulativeScores: newCumulative,
      status: 'finished',
      log: [...room.log, scoreLog, gameOverLog],
      pendingUndo: null,
      // Final scoreboard is its own chat window — wipe what was said in
      // the last round-end so it opens fresh.
      chat: [],
    });
    return;
  }

  await dealNextRound(code, {
    ...room,
    cumulativeScores: newCumulative,
    log: [...room.log, scoreLog],
  });
}

/**
 * Reset a finished room back to lobby state for the same group ("Play again").
 * Host-only. Clears hand docs and game state, keeps players + canadianRule.
 */
export async function resetForNewGame(
  code: string,
  callerName: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) throw new FlowError('notFinished');
  const room = snap.data() as RoomDoc;

  if (room.status !== 'finished') throw new FlowError('notFinished');
  if (room.hostPlayerName !== callerName) throw new FlowError('notHost');

  await resetGameStateInternal(code, room);
}

/**
 * The actual room-state reset used by both the host's manual button
 * and the unanimous play-again vote. Skips the host check.
 */
async function resetGameStateInternal(
  code: string,
  room: RoomDoc,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const handsSnap = await getDocs(collection(db, 'rooms', code, 'hands'));
  await Promise.all(handsSnap.docs.map((d) => deleteDoc(d.ref)));

  const cumulativeScores: Record<string, number> = {};
  for (const name of room.playerOrder) cumulativeScores[name] = 0;

  await updateDoc(roomRef, {
    status: 'lobby',
    currentRound: 0,
    currentTrick: 0,
    totalRounds: 0,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    trumpCard: null,
    trumpSuit: null,
    awaitingTrumpChoice: false,
    leadSuit: null,
    bids: {},
    tricksWon: {},
    cumulativeScores,
    trickInProgress: [],
    trickHistory: [],
    log: [],
    historyWritten: false,
    historyGameId: null,
    aiSummary: null,
    aiSummaryRequested: false,
    playAgainVotes: [],
    nextRoundVotes: [],
    endEarlyVotes: [],
    endGameVotes: [],
    chat: [],
    // New game, new chat window: bumping the generation means the fresh
    // lobby does not reopen the previous game's lobby conversation.
    chatGen: (room.chatGen ?? 0) + 1,
  });
}

/**
 * Toggle the caller's vote to start a new game from the FinalScoreboard.
 * UNANIMOUS — every real player must opt in. The caller who tips the
 * count drives the actual reset.
 */
export async function votePlayAgain(
  code: string,
  callerName: string,
  voteYes: boolean,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  let trigger = false;
  let snapshotRoom: RoomDoc | null = null;
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;
    if (room.status !== 'finished') return;

    const current = new Set(room.playAgainVotes ?? []);
    if (voteYes) current.add(callerName);
    else current.delete(callerName);

    const realPlayers = room.playerOrder.filter(
      (n) => !isBot(room, n),
    );
    const realVotes = [...current].filter(
      (n) => !isBot(room, n) && realPlayers.includes(n),
    );

    if (realPlayers.length > 0 && realVotes.length >= realPlayers.length) {
      tx.update(roomRef, { playAgainVotes: [] });
      trigger = true;
      snapshotRoom = room;
    } else {
      tx.update(roomRef, { playAgainVotes: [...current] });
    }
  });
  if (trigger && snapshotRoom) {
    await resetGameStateInternal(code, snapshotRoom);
  }
}

/**
 * Atomically claim the right to fetch the AI summary for this room.
 * Returns true if the caller won the claim and should fetch + write the
 * result via setSharedAiSummary. Returns false if someone already
 * claimed (or if the summary is already populated, or the room isn't
 * finished yet).
 */
export async function claimAiSummary(code: string): Promise<boolean> {
  const roomRef = doc(db, 'rooms', code);
  return runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return false;
    const room = snap.data() as RoomDoc;
    if (room.status !== 'finished') return false;
    if (room.aiSummary) return false;
    if (room.aiSummaryRequested) return false;
    tx.update(roomRef, { aiSummaryRequested: true });
    return true;
  });
}

/** Write the shared AI summary onto the room (visible to all clients). */
export async function setSharedAiSummary(
  code: string,
  summary: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await updateDoc(roomRef, { aiSummary: summary });
}
