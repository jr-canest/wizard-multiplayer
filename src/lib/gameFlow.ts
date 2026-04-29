import {
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
import type { HandDoc, LogEntry, RoomDoc, Suit } from './types';

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
      (n) => !n.startsWith('Bot-'),
    );
    const realVotes = [...current].filter(
      (n) => !n.startsWith('Bot-') && realPlayers.includes(n),
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
    | 'notFinished';
  constructor(code: FlowError['code']) {
    super(code);
    this.code = code;
  }
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

  const totalRounds = totalRoundsFor(room.playerOrder.length);
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
  const { hands, trumpCard } = deal(playerOrder, cardsPerPlayer, deck);

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

/**
 * Whether placing `bid` would violate the Canadian rule for the dealer.
 * Returns false on round 1 (single-card round is exempt) and for non-dealers.
 */
export function violatesCanadianRule(args: {
  isDealerBid: boolean;
  canadianRule: boolean;
  currentRound: number;
  cardsThisRound: number;
  otherBidsSum: number;
  bid: number;
}): boolean {
  if (!args.canadianRule) return false;
  if (!args.isDealerBid) return false;
  if (args.currentRound === 1) return false;
  return args.otherBidsSum + args.bid === args.cardsThisRound;
}

export async function placeBid(
  code: string,
  callerName: string,
  bid: number,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const snap = await getDoc(roomRef);
  if (!snap.exists()) throw new FlowError('notBidding');
  const room = snap.data() as RoomDoc;

  if (room.status !== 'bidding') throw new FlowError('notBidding');

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

  if (allBidIn) {
    // Left of dealer leads the first trick.
    await updateDoc(roomRef, {
      bids: nextBids,
      status: 'playing',
      currentTrick: 1,
      currentPlayerIndex: (room.dealerIndex + 1) % playerCount,
      leadSuit: null,
      trickInProgress: [],
      log: [...room.log, bidLog],
    });
  } else {
    await updateDoc(roomRef, {
      bids: nextBids,
      currentPlayerIndex: (room.currentPlayerIndex + 1) % playerCount,
      log: [...room.log, bidLog],
    });
  }
}

/**
 * Play a card from the caller's hand. Resolves the trick when the last play
 * lands, and transitions to `scoring` when the round's last trick resolves.
 */
export async function playCard(
  code: string,
  callerName: string,
  cardIndex: number,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const handRef = doc(db, 'rooms', code, 'hands', callerName);

  await runTransaction(db, async (tx) => {
    const roomSnap = await tx.get(roomRef);
    const handSnap = await tx.get(handRef);
    if (!roomSnap.exists() || !handSnap.exists()) {
      throw new FlowError('notPlaying');
    }
    const room = roomSnap.data() as RoomDoc;
    const hand = (handSnap.data() as HandDoc).cards;

    if (room.status !== 'playing') throw new FlowError('notPlaying');
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

    tx.update(handRef, { cards: newHand });

    if (newTrick.length < room.playerOrder.length) {
      const { leadSuit } = getLeadInfo(newTrick);
      tx.update(roomRef, {
        trickInProgress: newTrick,
        leadSuit,
        currentPlayerIndex: (room.currentPlayerIndex + 1) % room.playerOrder.length,
        log: [...room.log, playLog],
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
    });
  });
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
  const newCumulative = { ...room.cumulativeScores };
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
  });
}
