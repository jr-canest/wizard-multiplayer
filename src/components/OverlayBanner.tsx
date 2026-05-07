import { useState } from 'react';
import { requestUndo, voteUndo } from '../lib/gameFlow';
import { isBotName } from '../lib/rooms';
import { colorForViewer, playerColor } from '../lib/playerColors';
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
      <div className="backdrop-blur rounded-md border border-gold-500/70 bg-navy-900/85 text-gold-100 px-2 py-1 shadow-lg pointer-events-auto text-[11px] leading-tight max-w-full">
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
 * Compact undo controls for the action strip above the user's hand. Returns
 * null when there's nothing to show.
 */
export function UndoStripBar({ room, myName }: Props) {
  const [busy, setBusy] = useState(false);
  const pu = room.pendingUndo;
  if (!pu) return null;
  if (room.status !== 'bidding' && room.status !== 'playing') return null;
  const isActor = pu.actor === myName;
  const isOpen = !!pu.requested;
  if (!isOpen && !isActor) return null;

  return (
    <div
      key={pu.requested ? `u-${pu.actor}-open` : `u-${pu.actor}-mine`}
      className="rounded-md border border-rose-600/70 bg-rose-900/35 text-rose-100 px-2 py-1 text-[11px] leading-tight animate-overlay-banner-inline"
      aria-live="polite"
    >
      <UndoContent room={room} myName={myName} busy={busy} setBusy={setBusy} />
    </div>
  );
}

function UndoContent({
  room,
  myName,
  busy,
  setBusy,
}: {
  room: RoomSnapshot;
  myName: string;
  busy: boolean;
  setBusy: (b: boolean) => void;
}) {
  const pu = room.pendingUndo!;
  const isActor = pu.actor === myName;
  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const threshold = Math.floor(realPlayers.length / 2) + 1;
  const realVotes = pu.votes.filter((n) => realPlayers.includes(n));
  const myVote = realVotes.includes(myName);
  const actionWord = pu.kind === 'bid' ? 'bid' : 'play';
  const actorColor = colorForViewer(pu.actor, myName, room.playerOrder);

  async function onRequest() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  async function onVote(yes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await voteUndo(room.code, myName, yes);
    } finally {
      setBusy(false);
    }
  }

  if (isActor && !pu.requested) {
    return (
      <span className="flex items-center justify-between gap-2 text-[11px]">
        <span className="text-rose-100/90 truncate">
          Last {actionWord} a mistake?
        </span>
        <button
          type="button"
          onClick={onRequest}
          disabled={busy}
          className="shrink-0 text-gold-200 underline underline-offset-2 active:text-gold-100"
        >
          Undo
        </button>
      </span>
    );
  }

  if (!pu.requested) return null;

  return (
    <span className="flex items-center justify-between gap-2 text-[11px]">
      <span className="truncate">
        <span className={`${actorColor.text} font-bold`}>
          {isActor ? 'You' : pu.actor}
        </span>{' '}
        want{isActor ? '' : 's'} to undo {isActor ? 'your' : 'their'}{' '}
        {actionWord}
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <span className="tabular-nums">
          {realVotes.length}/{threshold}
        </span>
        {isActor ? (
          <button
            type="button"
            onClick={onRequest}
            disabled={busy}
            className="text-rose-300 underline underline-offset-2"
          >
            Cancel
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onVote(!myVote)}
            disabled={busy}
            className={`rounded-md px-2 py-0.5 text-[10px] font-semibold border ${
              myVote
                ? 'bg-emerald-700/40 border-emerald-500/60 text-emerald-100'
                : 'bg-navy-800 border-gold-700/60 text-gold-200 active:scale-[0.98]'
            }`}
          >
            {myVote ? '✓ Approving' : 'Approve'}
          </button>
        )}
      </span>
    </span>
  );
}
