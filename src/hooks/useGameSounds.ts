import { useEffect, useRef, useSyncExternalStore } from 'react';
import { useChat } from './useChat';
import type { RoomSnapshot } from './useRoom';
import {
  playBidMadeSound,
  playBidMissedSound,
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

// The turn bell only rings for someone who seems to be looking away: no
// tap on this phone for this long when the turn arrives, or none since.
const TURN_IDLE_MS = 5000;

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
  useEffect(() => {
    if (!myTurn) return;
    const start = Date.now();
    if (start - lastTouchRef.current >= TURN_IDLE_MS) {
      playYourTurnSound();
      return;
    }
    // Active a moment ago: ring only if the turn then sits untouched.
    const id = window.setTimeout(() => {
      if (lastTouchRef.current < start) playYourTurnSound();
    }, TURN_IDLE_MS);
    return () => window.clearTimeout(id);
  }, [myTurn, room.currentRound, room.trickHistory.length]);

  // ---- Round result: made or missed your bid ---------------------------
  // Lands as the round scoreboard comes up (after the last trick's hold).
  // The final round goes straight to the game-over sparkle instead.
  const prevStatusRef = useRef(room.status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = room.status;
    if (prev !== 'playing' || room.status !== 'scoring') return;
    const bid = room.bids[myName];
    if (bid === undefined) return;
    const made = (room.tricksWon[myName] ?? 0) === bid;
    const id = window.setTimeout(made ? playBidMadeSound : playBidMissedSound, LAST_TRICK_HOLD_MS + 150);
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
