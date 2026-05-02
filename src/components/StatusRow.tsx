import { useState } from 'react';
import { requestUndo, voteUndo } from '../lib/gameFlow';
import { isBotName } from '../lib/rooms';
import { colorForViewer } from '../lib/playerColors';
import { ReactionInline, useActiveReaction } from './Reactions';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * One fixed-height row above the trick area. Always rendered so its
 * presence/absence never shifts the layout below. Content priority:
 *
 *   1. Pending undo (request or vote)
 *   2. Last-round / next-is-last announcement
 *   3. Who's winning the in-progress trick
 *   4. (blank — still occupies space)
 */
export function StatusRow({ room, myName }: Props) {
  const [busy, setBusy] = useState(false);
  const pu = room.pendingUndo;
  const activeReaction = useActiveReaction(room);

  // Only enter the undo branch when it would actually render something
  // to THIS viewer — otherwise an empty undo placeholder would suppress
  // the rest of the priority chain (reactions, last-round, winning).
  const isUndoActor = pu?.actor === myName;
  const isUndoVoteOpen = !!pu?.requested;
  const undoVisibleToMe =
    !!pu &&
    (room.status === 'bidding' || room.status === 'playing') &&
    (isUndoVoteOpen || isUndoActor);
  const showUndo = undoVisibleToMe;

  // Last-round announcements only matter while the round is being played
  // — once it's being scored or the game is over, the RoundScoreboard /
  // FinalScoreboard already convey it and repeating here is redundant.
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

  // In-progress end-now vote (mid-round, threshold not yet met).
  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const endNowThreshold = Math.floor(realPlayers.length / 2) + 1;
  const endNowVotes = (room.endNowVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const endNowVoteInProgress =
    inActiveRound &&
    !isLastRound &&
    !nextIsLast &&
    endNowVotes.length > 0 &&
    endNowVotes.length < endNowThreshold;
  const myEndNowVote = endNowVotes.includes(myName);

  // (Winning-trick indicator now lives in LastEventPanel.)

  async function handleRequestUndo() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  async function handleVoteUndo(yes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await voteUndo(room.code, myName, yes);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-[36px] flex items-stretch">
      {showUndo && pu ? (
        <UndoContent
          room={room}
          myName={myName}
          busy={busy}
          onRequest={handleRequestUndo}
          onVote={handleVoteUndo}
        />
      ) : activeReaction ? (
        <ReactionInline room={room} />
      ) : isLastRound ? (
        <Banner
          tone="rose"
          text={`LAST ROUND${room.trumpCard ? '' : ' · no trump'}`}
        />
      ) : nextIsLast ? (
        <Banner tone="amber" text="Next round will be the last" />
      ) : endNowVoteInProgress ? (
        <Banner
          tone="amber"
          text={`Vote: end after next round ${endNowVotes.length}/${endNowThreshold}${myEndNowVote ? ' · ✓ you' : ''}`}
        />
      ) : (
        // Empty placeholder — matches LastEventPanel's empty state so the
        // two info panels look like a consistent pair.
        <div className="flex-1 rounded-md border border-gold-700/40 bg-navy-900/50 px-2 py-1 min-h-[40px] flex items-center justify-center">
          <span className="text-[10px] text-navy-400">—</span>
        </div>
      )}
    </div>
  );
}

function Banner({
  tone,
  text,
}: {
  tone: 'rose' | 'amber' | 'sky';
  text: string;
}) {
  const cls =
    tone === 'rose'
      ? 'bg-rose-900/30 border-rose-600/60 text-rose-100'
      : tone === 'amber'
        ? 'bg-amber-900/30 border-amber-600/60 text-amber-100'
        : 'bg-sky-900/30 border-sky-600/60 text-sky-100';
  return (
    <div
      className={`flex-1 rounded-md border ${cls} px-3 py-1 flex items-center justify-center`}
    >
      <span className="text-xs uppercase tracking-[0.18em] font-bold">
        {text}
      </span>
    </div>
  );
}

function UndoContent({
  room,
  myName,
  busy,
  onRequest,
  onVote,
}: {
  room: RoomSnapshot;
  myName: string;
  busy: boolean;
  onRequest: () => void;
  onVote: (yes: boolean) => void;
}) {
  const pu = room.pendingUndo!;
  const isActor = pu.actor === myName;
  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const threshold = Math.floor(realPlayers.length / 2) + 1;
  const realVotes = pu.votes.filter((n) => realPlayers.includes(n));
  const myVote = realVotes.includes(myName);
  const actionWord = pu.kind === 'bid' ? 'bid' : 'play';
  const actorColor = colorForViewer(pu.actor, myName, room.playerOrder);

  if (isActor && !pu.requested) {
    return (
      <div className="flex-1 card-gold-subtle rounded-md px-3 py-1 flex items-center justify-between text-[12px]">
        <span className="text-navy-200">
          Last {actionWord} a mistake?
        </span>
        <button
          type="button"
          onClick={onRequest}
          disabled={busy}
          className="text-gold-200 underline underline-offset-2 active:text-gold-100"
        >
          Undo
        </button>
      </div>
    );
  }

  if (!pu.requested) return <div className="flex-1" />;

  return (
    <div className="flex-1 rounded-md border-2 border-rose-700/40 bg-navy-900/40 px-3 py-1 flex items-center justify-between gap-2 text-[12px]">
      <span className="text-navy-100 truncate">
        <span className={`${actorColor.text} font-bold`}>
          {isActor ? 'You' : pu.actor}
        </span>
        <span> want{isActor ? '' : 's'} to undo {isActor ? 'your' : 'their'} {actionWord} </span>
        <span className="tabular-nums text-navy-300">
          {realVotes.length}/{threshold}
        </span>
      </span>
      {isActor ? (
        <button
          type="button"
          onClick={onRequest}
          disabled={busy}
          className="text-rose-300 underline underline-offset-2 shrink-0"
        >
          Cancel
        </button>
      ) : (
        <button
          type="button"
          onClick={() => onVote(!myVote)}
          disabled={busy}
          className={`shrink-0 rounded-md px-2 py-0.5 text-[11px] font-semibold border ${
            myVote
              ? 'bg-emerald-700/40 border-emerald-500/60 text-emerald-100'
              : 'bg-navy-800 border-gold-700/60 text-gold-200 active:scale-[0.98]'
          }`}
        >
          {myVote ? '✓ Approving' : 'Approve'}
        </button>
      )}
    </div>
  );
}
