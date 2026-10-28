import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useChat } from './useChat';
import type { RoomSnapshot } from './useRoom';
import {
  playBidMadeSound,
  playBidSound,
  playBidsInSound,
  playCardSound,
  playChatSound,
  playStartRoundSound,
  playTrickWonSound,
  playYourTurnSound,
  soundEnabled,
  subscribeSound,
  unlockAudioOnGesture,
} from '../lib/sounds';
import { LAST_TRICK_HOLD_MS } from '../lib/trickTiming';

// The turn bell is for someone who seems to be looking away: the turn sits
// this long with no tap on the phone. Bidding gets longer, since reading a
// new hand is hands-off (Jorge, 2026-10-27: at 5 s the bell rang while he
// was still deciding his bid and read as a stray ping).
const TURN_IDLE_BID_MS = 15000;
const TURN_IDLE_PLAY_MS = 10000;

/** The sound on/off setting, live. */
export function useSoundEnabled(): boolean {
  return useSyncExternalStore(subscribeSound, soundEnabled);
}

type Seen = {
  round: number;
  status: string;
  bids: Set<string>;
  tipLen: number;
  histLen: number;
};

/**
 * Table sounds driven by the room snapshots: other players' bids and
 * cards, the new deal, the last bid in, and a trick you took. Your own
 * bid and card play their sound on the tap itself (BidButtonsBar,
 * GameView's play handler), so they are skipped here. The first snapshot
 * (and an undo shrinking anything) only syncs, never replays.
 */
export function useGameSounds(room: RoomSnapshot, myName: string): void {
  const seenRef = useRef<Seen | null>(null);

  useEffect(() => unlockAudioOnGesture(), []);

  // Chat: a bloop for each new line from someone else. Lines that were
  // already there when this mounted (or came in a reconnect's catch-up
  // burst older than 15 s, loose for phone clock skew) stay quiet.
  const chat = useChat(room.code);
  const chatSeenRef = useRef<number | null>(null);
  const newestTs = chat.length ? chat[chat.length - 1].ts : 0;
  useEffect(() => {
    const prev = chatSeenRef.current;
    chatSeenRef.current = Math.max(prev ?? 0, newestTs);
    if (prev === null) return;
    const fresh = chat.some(
      (m) => m.ts > prev && m.player !== myName && Date.now() - m.ts < 15000,
    );
    if (fresh) playChatSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [newestTs, myName]);

  // ---- Your turn bell ------------------------------------------------
  const lastTouchRef = useRef(0);
  useEffect(() => {
    const touch = () => {
      lastTouchRef.current = Date.now();
    };
    touch(); // Opening the table counts as looking at it.
    window.addEventListener('pointerdown', touch, true);
    return () => window.removeEventListener('pointerdown', touch, true);
  }, []);
  const turnName = room.playerOrder[room.currentPlayerIndex];
  const myTurn =
    turnName === myName &&
    !room.awaitingTrumpChoice &&
    (room.status === 'playing' || (room.status === 'bidding' && room.bids[myName] === undefined));
  const bidding = room.status === 'bidding';
  useEffect(() => {
    if (!myTurn) return;
    // Off screen: nobody is looking, ring now. On screen it never rings the
    // moment the turn lands (sitting on the round-end screen while the
    // others tick "Next round" is not looking away).
    if (document.visibilityState === 'hidden') {
      playYourTurnSound();
      return;
    }
    const start = Date.now();
    const id = window.setTimeout(() => {
      if (lastTouchRef.current < start) playYourTurnSound();
    }, bidding ? TURN_IDLE_BID_MS : TURN_IDLE_PLAY_MS);
    return () => window.clearTimeout(id);
  }, [myTurn, bidding, room.currentRound, room.trickHistory.length]);

  // ---- Round result: made your bid --------------------------------------
  // Lands as the round scoreboard comes up (after the last trick's hold).
  // A miss stays silent (Jorge: the boo is for booing, not for a miss). The
  // final round goes straight to the game-over sparkle instead.
  const prevStatusRef = useRef(room.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = room.status;
    if (prev !== 'playing' || room.status !== 'scoring') return;
    const bid = room.bids[myName];
    if (bid === undefined) return;
    if ((room.tricksWon[myName] ?? 0) !== bid) return;
    const id = window.setTimeout(playBidMadeSound, LAST_TRICK_HOLD_MS + 150);
    return () => window.clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.status, myName]);

  const bidKeys = Object.keys(room.bids).sort().join('|');
  useEffect(() => {
    const prev = seenRef.current;
    const cur: Seen = {
      round: room.currentRound,
      status: room.status,
      bids: new Set(Object.keys(room.bids)),
      tipLen: room.trickInProgress.length,
      histLen: room.trickHistory.length,
    };
    seenRef.current = cur;
    if (!prev) return;

    const sameRound = prev.round === cur.round;
    if (!sameRound && cur.status === 'bidding') {
      playStartRoundSound();
      return;
    }
    if (!sameRound) return;

    for (const name of cur.bids) {
      if (!prev.bids.has(name) && name !== myName) playBidSound(room.bids[name]);
    }
    if (prev.status === 'bidding' && cur.status === 'playing') {
      // Let the last bid's pluck ring before the chord.
      window.setTimeout(playBidsInSound, 180);
    }

    if (cur.status !== 'playing' && cur.status !== 'scoring') return;
    if (cur.histLen > prev.histLen) {
      // The trick closed: the closing card is in the history entry, and
      // the cards played since the last snapshot came before it.
      const last = room.trickHistory[room.trickHistory.length - 1];
      const newPlays = last.plays.slice(prev.tipLen);
      if (newPlays.some((p) => p.playerName !== myName)) playCardSound(false);
      if (last.winner === myName) {
        const won = room.tricksWon[myName] ?? 0;
        window.setTimeout(() => playTrickWonSound(won), 220);
      }
    } else if (cur.tipLen > prev.tipLen) {
      const newPlays = room.trickInProgress.slice(prev.tipLen);
      if (newPlays.some((p) => p.playerName !== myName)) playCardSound(false);
    }
    // Keyed on the counts that change; the room object itself is fresh
    // on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.currentRound, room.status, bidKeys, room.trickInProgress.length, room.trickHistory.length, myName]);
}
