import { useEffect, useRef } from 'react';
import type { RoomSnapshot } from './useRoom';
import {
  playBidSound,
  playBidsInSound,
  playCardSound,
  playStartRoundSound,
  playTrickWonSound,
  unlockAudioOnGesture,
} from '../lib/sounds';

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
