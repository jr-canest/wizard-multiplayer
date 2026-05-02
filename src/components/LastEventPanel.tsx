import { useEffect, useState } from 'react';
import { winningPlayIndex } from '../game/trickWinner';
import { colorForViewer } from '../lib/playerColors';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

type Event =
  | { kind: 'winning'; player: string }
  | { kind: 'lastTrick'; player: string; round: number; trick: number }
  | { kind: 'lastRound'; topPlayer: string; round: number; delta: number }
  | null;

/**
 * Sticky panel showing the most recent significant game event. Updates
 * live as the game progresses and stays visible until something new
 * supersedes it.
 *
 * Priority (descending):
 *   1. Live: who's currently winning the in-progress trick
 *   2. Sticky: who won the last completed trick (until the next play happens)
 *   3. Sticky: round result (until the next round's first play)
 */
export function LastEventPanel({ room, myName }: Props) {
  // Track the most recent "sticky" event from log so it persists across
  // renders even when the moment-derived state shifts.
  const [sticky, setSticky] = useState<Event>(null);

  useEffect(() => {
    const log = room.log;
    // Walk backwards to find the latest interesting event.
    for (let i = log.length - 1; i >= 0; i--) {
      const e = log[i];
      if (e.t === 'trickWin') {
        setSticky({
          kind: 'lastTrick',
          player: e.winner,
          round: e.round,
          trick: e.trick,
        });
        return;
      }
      if (e.t === 'roundScore') {
        // Find the top scorer for the round.
        let topPlayer = '';
        let topDelta = -Infinity;
        for (const [name, d] of Object.entries(e.scores)) {
          if (d > topDelta) {
            topDelta = d;
            topPlayer = name;
          }
        }
        if (topPlayer) {
          setSticky({
            kind: 'lastRound',
            topPlayer,
            round: e.round,
            delta: topDelta,
          });
        }
        return;
      }
    }
    setSticky(null);
  }, [room.log]);

  let event: Event = null;
  if (
    room.status === 'playing' &&
    room.trickInProgress.length > 0
  ) {
    const idx = winningPlayIndex(room.trickInProgress, room.trumpSuit);
    const p = room.trickInProgress[idx];
    if (p) event = { kind: 'winning', player: p.playerName };
  } else {
    event = sticky;
  }

  if (!event) {
    return (
      <div className="flex-1 rounded-md border border-gold-700/40 bg-navy-900/50 px-2 py-1 min-h-[40px] flex items-center justify-center">
        <span className="text-[10px] text-navy-400">—</span>
      </div>
    );
  }

  const boxCls =
    'flex-1 rounded-md border border-gold-700/40 bg-navy-900/50 px-2 py-1 min-h-[40px] flex items-center justify-center text-[11px] leading-tight text-center';

  if (event.kind === 'winning') {
    const c = colorForViewer(event.player, myName, room.playerOrder);
    const isMe = event.player === myName;
    return (
      <div className={boxCls}>
        <span className="text-gold-300 mr-1">♛</span>
        <span className="text-navy-300">winning: </span>
        <span className={`${c.text} font-bold ml-1`}>
          {isMe ? 'you' : event.player}
        </span>
      </div>
    );
  }

  if (event.kind === 'lastTrick') {
    const c = colorForViewer(event.player, myName, room.playerOrder);
    const isMe = event.player === myName;
    return (
      <div className={boxCls}>
        <span className="text-navy-300">trick won by </span>
        <span className={`${c.text} font-bold ml-1`}>
          {isMe ? 'you' : event.player}
        </span>
      </div>
    );
  }

  // lastRound — best round score (positive = won, negative = least loss)
  const c = colorForViewer(event.topPlayer, myName, room.playerOrder);
  const isMe = event.topPlayer === myName;
  const sign = event.delta > 0 ? '+' : '';
  return (
    <div className={boxCls}>
      <span className="text-navy-300">R{event.round} best: </span>
      <span className={`${c.text} font-bold ml-1`}>
        {isMe ? 'you' : event.topPlayer}
      </span>
      <span className="text-gold-200 tabular-nums ml-1">
        {sign}
        {event.delta}
      </span>
    </div>
  );
}
