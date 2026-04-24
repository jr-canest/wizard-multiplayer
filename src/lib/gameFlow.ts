import {
  doc,
  getDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore';
import { db } from './firebase';
import { buildDeck, deal, shuffle, totalRoundsFor } from '../game/deck';
import type { HandDoc, LogEntry, RoomDoc, Suit } from './types';

export class FlowError extends Error {
  code: 'notHost' | 'notLobby' | 'notEnoughPlayers' | 'notDealer' | 'notAwaiting';
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
