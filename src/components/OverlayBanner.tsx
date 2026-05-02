import { useState } from 'react';
import { createPortal } from 'react-dom';
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
 * Transient banner overlaid over the table area (top of viewport so it
 * never covers the user's hand). Shows, in priority order:
 *   1. Pending undo (with vote buttons)
 *   2. Active reaction
 *   3. End-now vote in progress
 *   4. LAST ROUND / next-is-last announcements
 * One banner at a time. When nothing's active, nothing renders.
 */
export function OverlayBanner({ room, myName }: Props) {
  const [busy, setBusy] = useState(false);
  const reaction = useActiveReaction(room);

  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const threshold = Math.floor(realPlayers.length / 2) + 1;

  const pu = room.pendingUndo;
  const isUndoActor = pu?.actor === myName;
  const isUndoOpen = !!pu?.requested;
  const undoVisible =
    !!pu &&
    (room.status === 'bidding' || room.status === 'playing') &&
    (isUndoOpen || isUndoActor);

  const inActiveRound =
    room.status === 'bidding' ||
    room.status === 'playing' ||
    room.status === 'dealing';
  const isLastRound =
    inActiveRound &&
    room.currentRound > 0 &&
    room.currentRound >= room.totalRounds;
  const nextIsLast =
    inActiveRound &&
    !isLastRound &&
    room.currentRound + 1 === room.totalRounds;

  const endNowVotes = (room.endNowVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const endNowVoteInProgress =
    inActiveRound &&
    !isLastRound &&
    !nextIsLast &&
    endNowVotes.length > 0 &&
    endNowVotes.length < threshold;
  const myEndNowVote = endNowVotes.includes(myName);

  // Build the active banner content (or null when nothing's active).
  let content: React.ReactNode = null;
  let tone: 'gold' | 'rose' | 'amber' = 'gold';

  if (undoVisible && pu) {
    tone = 'rose';
    content = (
      <UndoContent
        room={room}
        myName={myName}
        busy={busy}
        setBusy={setBusy}
      />
    );
  } else if (reaction) {
    const c = playerColor(reaction.player, room.playerOrder);
    content = (
      <span className="flex items-center gap-1.5 whitespace-nowrap">
        <span className={`${c.text} font-bold text-sm`}>
          {reaction.player}
        </span>
        <span className="text-gold-100 text-sm">: {reaction.text}</span>
      </span>
    );
  } else if (isLastRound) {
    tone = 'rose';
    content = (
      <span className="text-xs uppercase tracking-[0.18em] font-bold">
        LAST ROUND{room.trumpCard ? '' : ' · no trump'}
      </span>
    );
  } else if (nextIsLast) {
    tone = 'amber';
    content = (
      <span className="text-xs uppercase tracking-[0.18em] font-bold">
        Next round will be the last
      </span>
    );
  } else if (endNowVoteInProgress) {
    tone = 'amber';
    content = (
      <span className="text-xs uppercase tracking-[0.18em] font-bold">
        Vote: end after next round {endNowVotes.length}/{threshold}
        {myEndNowVote ? ' · ✓ you' : ''}
      </span>
    );
  }

  if (!content) return null;

  const toneCls =
    tone === 'rose'
      ? 'border-rose-600/70 bg-rose-900/35 text-rose-100'
      : tone === 'amber'
        ? 'border-amber-500/70 bg-amber-900/35 text-amber-100'
        : 'border-gold-500/70 bg-navy-900/85 text-gold-100';

  return createPortal(
    <div
      key={
        // Re-mount when the headline changes so the slide-in fires each time.
        reaction
          ? `r-${reaction.player}-${reaction.ts}`
          : pu?.requested
            ? `u-${pu.actor}`
            : isLastRound
              ? 'last'
              : nextIsLast
                ? 'next-last'
                : endNowVoteInProgress
                  ? 'end-now'
                  : 'idle'
      }
      className="fixed left-1/2 top-[10vh] z-[180] -translate-x-1/2 pointer-events-none animate-overlay-banner"
      aria-live="polite"
    >
      <div
        className={`backdrop-blur rounded-lg border ${toneCls} px-3 py-1.5 shadow-2xl pointer-events-auto`}
      >
        {content}
      </div>
    </div>,
    document.body,
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
      <span className="flex items-center gap-2 text-[12px]">
        <span className="text-rose-100/90">Last {actionWord} a mistake?</span>
        <button
          type="button"
          onClick={onRequest}
          disabled={busy}
          className="text-gold-200 underline underline-offset-2 active:text-gold-100"
        >
          Undo
        </button>
      </span>
    );
  }

  if (!pu.requested) return null;

  return (
    <span className="flex items-center gap-2 text-[12px]">
      <span>
        <span className={`${actorColor.text} font-bold`}>
          {isActor ? 'You' : pu.actor}
        </span>{' '}
        want{isActor ? '' : 's'} to undo {isActor ? 'your' : 'their'}{' '}
        {actionWord}
      </span>
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
          className={`rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
            myVote
              ? 'bg-emerald-700/40 border-emerald-500/60 text-emerald-100'
              : 'bg-navy-800 border-gold-700/60 text-gold-200 active:scale-[0.98]'
          }`}
        >
          {myVote ? '✓ Approving' : 'Approve'}
        </button>
      )}
    </span>
  );
}
