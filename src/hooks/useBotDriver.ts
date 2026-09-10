import { useEffect, useRef } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { botDifficultyOf, isBot } from '../lib/rooms';
import {
  chooseTrumpSuit,
  placeBid,
  playCard,
  violatesCanadianRule,
} from '../lib/gameFlow';
import { chooseBotBid, chooseBotCard, chooseBotTrump } from '../game/botAI';
import type { Card, HandDoc } from '../lib/types';
import type { RoomSnapshot } from './useRoom';

const BOT_ACTION_DELAY_MS = 600;
/** Longer pause before a bot leads a new trick so the human sees the prior winner banner. */
const BOT_NEW_TRICK_DELAY_MS = 2100;

async function readHand(code: string, name: string): Promise<Card[] | null> {
  const snap = await getDoc(doc(db, 'rooms', code, 'hands', name));
  if (!snap.exists()) return null;
  return (snap.data() as HandDoc).cards;
}

/**
 * Host-side driver that performs trump picks, bids, and card plays for the
 * computer players seated in the room (room.bots), at each seat's
 * difficulty. Only the host's device runs this so a move happens once.
 */
export function useBotDriver(room: RoomSnapshot | null, myName: string | null) {
  const lastIntentRef = useRef<string | null>(null);

  useEffect(() => {
    if (!room || !myName) return;
    if (room.hostPlayerName !== myName) return;
    if (!room.playerOrder.some((n) => isBot(room, n))) return;

    const dealerName = room.playerOrder[room.dealerIndex];
    const currentName = room.playerOrder[room.currentPlayerIndex];
    const playerCount = room.playerOrder.length;

    let intent: string | null = null;
    let action: (() => Promise<void>) | null = null;

    if (room.awaitingTrumpChoice && isBot(room, dealerName)) {
      const difficulty = botDifficultyOf(room, dealerName) ?? 'medium';
      intent = `trump:${room.currentRound}:${dealerName}`;
      action = async () => {
        const hand = (await readHand(room.code, dealerName)) ?? [];
        await chooseTrumpSuit(room.code, dealerName, chooseBotTrump(hand, difficulty));
      };
    } else if (room.status === 'bidding' && isBot(room, currentName)) {
      const difficulty = botDifficultyOf(room, currentName) ?? 'medium';
      intent = `bid:${room.currentRound}:${currentName}:${
        Object.keys(room.bids).length
      }`;
      action = async () => {
        const cardsThisRound = room.currentRound;
        const isDealerBid = currentName === dealerName;
        const otherBidsSum = Object.values(room.bids).reduce((a, b) => a + b, 0);
        const legalBids: number[] = [];
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
            legalBids.push(i);
          }
        }
        const hand = (await readHand(room.code, currentName)) ?? [];
        // Bids so far in bidding order (dealer + 1 first).
        const bidsSoFar: number[] = [];
        for (let k = 1; k <= playerCount; k++) {
          const name = room.playerOrder[(room.dealerIndex + k) % playerCount];
          if (name === currentName) break;
          if (room.bids[name] !== undefined) bidsSoFar.push(room.bids[name]);
        }
        const bid = chooseBotBid(
          {
            hand,
            cardsThisRound,
            trumpSuit: room.trumpSuit,
            playerCount,
            bidsSoFar,
            isDealer: isDealerBid,
            legalBids,
          },
          difficulty,
        );
        await placeBid(room.code, currentName, bid);
      };
    } else if (room.status === 'playing' && isBot(room, currentName)) {
      const difficulty = botDifficultyOf(room, currentName) ?? 'medium';
      intent = `play:${room.currentRound}:${room.currentTrick}:${currentName}:${room.trickInProgress.length}`;
      action = async () => {
        const hand = await readHand(room.code, currentName);
        if (!hand || hand.length === 0) return;
        const playedThisRound: Card[] = [];
        for (const t of room.trickHistory) {
          if (t.round !== room.currentRound) continue;
          for (const p of t.plays) playedThisRound.push(p.card);
        }
        const idx = chooseBotCard(
          {
            hand,
            trickInProgress: room.trickInProgress,
            trumpSuit: room.trumpSuit,
            trumpCard: room.trumpCard,
            playedThisRound,
            myBid: room.bids[currentName] ?? 0,
            myTricksWon: room.tricksWon[currentName] ?? 0,
            playersAfterMe: playerCount - room.trickInProgress.length - 1,
          },
          difficulty,
        );
        await playCard(room.code, currentName, idx);
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
        console.warn('[bot driver] action failed', err);
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [room, myName]);
}
