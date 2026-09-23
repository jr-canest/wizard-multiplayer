import { useState } from 'react';
import { requestUndo } from '../lib/gameFlow';
import { playerColor } from '../lib/playerColors';
import { useActiveReaction } from './Reactions';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * Transient banner overlaid over the table area. Reactions only — the undo
 * affordance lives in the action strip above the user's hand
 * (UndoStripBar) so it sits inside the player's natural focus zone.
 */
export function OverlayBanner({ room }: Props) {
  const reaction = useActiveReaction(room);

  if (!reaction) return null;

  const c = playerColor(reaction.player, room.playerOrder);

  return (
    <div
      key={`r-${reaction.player}-${reaction.ts}`}
      className="absolute top-1.5 left-1.5 right-1.5 z-[180] pointer-events-none animate-overlay-banner-inline flex"
      aria-live="polite"
    >
      {/* No pointer-events: this sits over the trick drop zone, and a
          reaction popping up mid-drag must not swallow the card drop. */}
      <div className="backdrop-blur rounded-md border border-gold-500/70 bg-navy-900/85 text-gold-100 px-2 py-1 shadow-lg text-[11px] leading-tight max-w-full">
        <span className="flex items-center gap-1.5">
          <span className={`${c.text} font-bold text-sm whitespace-nowrap`}>
            {reaction.player}
          </span>
          <span className="text-gold-100 text-sm">: {reaction.text}</span>
        </span>
      </div>
    </div>
  );
}

/**
 * The actor's own "was that a mistake?" prompt, shown in the action strip
 * above their hand. Tapping Undo opens the table-wide vote, which is a
 * center-screen modal (UndoVoteModal), not this strip: once a vote is
 * open the game is paused and every player needs to see it, so there is
 * nothing left for this bar to show.
 */
export function UndoStripBar({ room, myName }: Props) {
  const [busy, setBusy] = useState(false);
  const pu = room.pendingUndo;
  if (!pu) return null;
  if (room.status !== 'bidding' && room.status !== 'playing') return null;
  if (pu.actor !== myName || pu.requested) return null;

  const actionWord = pu.kind === 'bid' ? 'bid' : 'play';

  async function onRequest() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      key={`u-${pu.actor}-mine`}
      className="rounded-md border border-rose-600/70 bg-rose-900/35 text-rose-100 px-2 py-1 text-[11px] leading-tight animate-overlay-banner-inline"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onRequest}
        disabled={busy}
        title={`Undo your last ${actionWord}`}
        className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold text-gold-200 active:text-gold-100 disabled:opacity-60"
      >
        <span aria-hidden="true">↶</span>
        <span>Undo last move</span>
      </button>
    </div>
  );
}
