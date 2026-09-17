import { useEffect, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { botDifficultyOf, isBot } from '../lib/rooms';
import {
  chooseTrumpSuit,
  placeBid,
  playCard,
  violatesCanadianRule,
} from '../lib/gameFlow';
import { chooseBotBid, chooseBotCard, chooseBotTrump, inferVoids } from '../game/botAI';
import type { Card, HandDoc } from '../lib/types';
import type { RoomSnapshot } from './useRoom';

// Short "think" so a computer's card doesn't land the same instant the
// previous one does, but no longer — every extra 100 ms here is felt by
// the human waiting for their turn.
const BOT_ACTION_DELAY_MS = 250;
/** Pause before a bot leads a new trick so the humans see the winner banner. */
const BOT_NEW_TRICK_DELAY_MS = 1400;

/**
 * Live hands of every computer seat, kept in sync by snapshot listeners
 * so a bot move never pays a separate server read first.
 */
function useBotHands(room: RoomSnapshot | null, active: boolean): Record<string, Card[]> {
  const [hands, setHands] = useState<Record<string, Card[]>>({});
  const code = room?.code ?? null;
  const botNames = room && active ? room.playerOrder.filter((n) => isBot(room, n)) : [];
  const key = botNames.join('|');

  useEffect(() => {
    if (!code || botNames.length === 0) return;
    const unsubs = botNames.map((name) =>
      onSnapshot(doc(db, 'rooms', code, 'hands', name), (snap) => {
        const cards = snap.exists() ? (snap.data() as HandDoc).cards : [];
        setHands((h) => ({ ...h, [name]: cards }));
      }),
    );
    return () => unsubs.forEach((u) => u());
    // botNames is derived from `key`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, key]);

  return hands;
}

/**
 * Host-side driver that performs trump picks, bids, and card plays for the
 * computer players seated in the room (room.bots), at each seat's
 * difficulty. Only the host's device runs this so a move happens once.
 */
export function useBotDriver(room: RoomSnapshot | null, myName: string | null) {
  const lastIntentRef = useRef<string | null>(null);
  const isHost = !!room && !!myName && room.hostPlayerName === myName;
  const hands = useBotHands(room, isHost);

  useEffect(() => {
    if (!room || !myName) return;
    if (room.hostPlayerName !== myName) return;
    if (!room.playerOrder.some((n) => isBot(room, n))) return;
    // The table is paused while an undo vote is open. The computers wait
    // it out with everyone else, otherwise they would play straight
    // through the vote and blow away the snapshot being voted on.
    if (room.pendingUndo?.requested) return;

    const dealerName = room.playerOrder[room.dealerIndex];
    const currentName = room.playerOrder[room.currentPlayerIndex];
    const playerCount = room.playerOrder.length;

    let intent: string | null = null;
    let action: (() => Promise<void>) | null = null;

    if (room.awaitingTrumpChoice && isBot(room, dealerName)) {
      const difficulty = botDifficultyOf(room, dealerName) ?? 'medium';
      intent = `trump:${room.currentRound}:${dealerName}`;
      action = async () => {
        const hand = hands[dealerName] ?? [];
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
        const hand = hands[currentName] ?? [];
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
            trumpCard: room.trumpCard,
            table: {
              playerOrder: room.playerOrder,
              me: currentName,
              bids: room.bids,
              tricksWon: {},
              voids: {},
              dealerIndex: room.dealerIndex,
            },
          },
          difficulty,
        );
        await placeBid(room.code, currentName, bid, room);
      };
    } else if (room.status === 'playing' && isBot(room, currentName)) {
      const difficulty = botDifficultyOf(room, currentName) ?? 'medium';
      intent = `play:${room.currentRound}:${room.currentTrick}:${currentName}:${room.trickInProgress.length}`;
      action = async () => {
        const hand = hands[currentName];
        if (!hand || hand.length === 0) return;
        const playedThisRound: Card[] = [];
        const roundTricks = room.trickHistory.filter((t) => t.round === room.currentRound);
        for (const t of roundTricks) {
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
            table: {
              playerOrder: room.playerOrder,
              me: currentName,
              bids: room.bids,
              tricksWon: room.tricksWon,
              voids: inferVoids([...roundTricks, { plays: room.trickInProgress }]),
              dealerIndex: room.dealerIndex,
            },
          },
          difficulty,
        );
        await playCard(room.code, currentName, idx, { room, hand });
      };
    }

    if (!intent || !action) return;
    // Wait for the seat's hand snapshot (bidding/playing only) so the
    // intent isn't consumed before the cards are known.
    if (!room.awaitingTrumpChoice && !hands[currentName]) return;
    if (lastIntentRef.current === intent) return;

    const isLeadingNewTrick =
      room.status === 'playing' &&
      room.trickInProgress.length === 0 &&
      room.currentTrick > 1;
    const delay = isLeadingNewTrick
      ? BOT_NEW_TRICK_DELAY_MS
      : BOT_ACTION_DELAY_MS;

    const fn = action;
    const thisIntent = intent;
    const timer = setTimeout(() => {
      // Claim the intent as the action fires, not when it is scheduled.
      // Any room change re-runs this effect and the cleanup below kills
      // the pending timer, so claiming it up front meant a seat could be
      // skipped for good: the re-run saw its own intent already consumed
      // and scheduled nothing. Pausing for an undo vote made that a
      // reliable stall, since the vote itself is a room change.
      lastIntentRef.current = thisIntent;
      fn().catch((err) => {
        // Let the seat try again on the next snapshot rather than sitting
        // out the rest of the game.
        lastIntentRef.current = null;
        console.warn('[bot driver] action failed', err);
      });
    }, delay);

    return () => clearTimeout(timer);
  }, [room, myName, hands]);
}
