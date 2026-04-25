import { useEffect, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { isBotName } from '../lib/rooms';
import {
  chooseTrumpSuit,
  placeBid,
  playCard,
  violatesCanadianRule,
} from '../lib/gameFlow';
import { legalIndices } from '../game/legalMoves';
import type { Card, HandDoc, Suit } from '../lib/types';
import type { RoomSnapshot } from './useRoom';

const BOT_ACTION_DELAY_MS = 600;
/** Longer pause before a bot leads a new trick so the human sees the prior winner banner. */
const BOT_NEW_TRICK_DELAY_MS = 2100;
const SUITS: Suit[] = ['H', 'D', 'C', 'S'];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

async function readHand(code: string, name: string): Promise<Card[] | null> {
  const snap = await getDoc(doc(db, 'rooms', code, 'hands', name));
  if (!snap.exists()) return null;
  return (snap.data() as HandDoc).cards;
}

/**
 * Host-side driver that performs trump picks, bids, and card plays for any
 * bot players seeded into the room. Dev-only: bots are only ever added when
 * the host opts in on the create panel (which is itself gated by import.meta.env.DEV).
 */
export function useBotDriver(room: RoomSnapshot | null, myName: string | null) {
  const lastIntentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room || !myName) return;
    if (room.hostPlayerName !== myName) return;
    if (!room.playerOrder.some(isBotName)) return;

    const dealerName = room.playerOrder[room.dealerIndex];
    const currentName = room.playerOrder[room.currentPlayerIndex];

    let intent: string | null = null;
    let action: (() => Promise<void>) | null = null;

    if (room.awaitingTrumpChoice && isBotName(dealerName)) {
      intent = `trump:${room.currentRound}:${dealerName}`;
      action = async () => {
        await chooseTrumpSuit(room.code, dealerName, pickRandom(SUITS));
      };
    } else if (room.status === 'bidding' && isBotName(currentName)) {
      intent = `bid:${room.currentRound}:${currentName}:${
        Object.keys(room.bids).length
      }`;
      action = async () => {
        const cardsThisRound = room.currentRound;
        const isDealerBid = currentName === dealerName;
        const otherBidsSum = Object.values(room.bids).reduce((a, b) => a + b, 0);
        const candidates: number[] = [];
        for (let i = 0; i <= cardsThisRound; i++) {
          if (
            !violatesCanadianRule({
              isDealerBid,
              canadianRule: room.canadianRule,
              currentRound: room.currentRound,
              cardsThisRound,
              otherBidsSum,
              bid: i,
            })
          ) {
            candidates.push(i);
          }
        }
        await placeBid(room.code, currentName, pickRandom(candidates));
      };
    } else if (room.status === 'playing' && isBotName(currentName)) {
      intent = `play:${room.currentRound}:${room.currentTrick}:${currentName}:${room.trickInProgress.length}`;
      action = async () => {
        const hand = await readHand(room.code, currentName);
        if (!hand || hand.length === 0) return;
        const legalIdx: number[] = [];
        legalIndices(hand, room.trickInProgress).forEach((ok, i) => {
          if (ok) legalIdx.push(i);
        });
        if (legalIdx.length === 0) return;
        await playCard(room.code, currentName, pickRandom(legalIdx));
      };
    }

    if (!intent || !action) return;
    if (lastIntentRef.current === intent) return;
    lastIntentRef.current = intent;

    const isLeadingNewTrick =
      room.status === 'playing' &&
      room.trickInProgress.length === 0 &&
      room.currentTrick > 1;
    const delay = isLeadingNewTrick
      ? BOT_NEW_TRICK_DELAY_MS
      : BOT_ACTION_DELAY_MS;

    const fn = action;
    const timer = setTimeout(() => {
      fn().catch((err) => {
        // eslint-disable-next-line no-console
        console.warn('[bot driver] action failed', err);
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [room, myName]);
}
