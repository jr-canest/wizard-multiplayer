import { useCallback, useState } from 'react';
import { requestUndo, resolveExpiredUndo, voteUndo } from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { colorForViewer } from '../lib/playerColors';
import { CardImage } from './CardImage';
import { VoteModal } from './VoteModal';
import { UNDO_VOTE_TTL_MS } from '../lib/types';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * Table-wide vote on an undo request, on the shared VoteModal.
 *
 * While this is up the game is PAUSED: gameFlow refuses bids and plays,
 * and the bot driver holds off, so nobody can act their way past a vote
 * (which previously overwrote the pending snapshot and silently killed
 * it). A majority approves; enough rejections to put that majority out
 * of reach denies it on the spot; a vote nobody answers expires.
 */
export function UndoVoteModal({ room, myName }: Props) {
  const pu = room.pendingUndo;
  const open =
    !!pu?.requested &&
    (room.status === 'bidding' || room.status === 'playing');

  if (!open) return null;
  return <UndoVoteDialog room={room} myName={myName} />;
}

function UndoVoteDialog({ room, myName }: Props) {
  const pu = room.pendingUndo!;
  const [busy, setBusy] = useState(false);

  const isActor = pu.actor === myName;
  const voters = room.playerOrder.filter((n) => !isBot(room, n));
  const threshold = Math.floor(voters.length / 2) + 1;
  const yes = pu.votes.filter((n) => voters.includes(n));
  const no = (pu.noVotes ?? []).filter((n) => voters.includes(n));
  const myVote = yes.includes(myName)
    ? 'yes'
    : no.includes(myName)
      ? 'no'
      : null;
  const waitingOn = voters.filter(
    (n) => !yes.includes(n) && !no.includes(n),
  );
  const actionWord = pu.kind === 'bid' ? 'bid' : 'card';
  const actorColor = colorForViewer(pu.actor, myName, room.playerOrder);

  async function onVote(voteYes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await voteUndo(room.code, myName, voteYes);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  const onExpire = useCallback(
    () => resolveExpiredUndo(room.code),
    [room.code],
  );
  // A request written by an older build has no requestedAt. Treat it as
  // opened when this dialog first mounted so it still counts down.
  const [mountedAt] = useState(() => Date.now());
  const openedAt = pu.requestedAt ?? mountedAt;

  const detail =
    pu.kind === 'play' && pu.card ? (
      <CardImage card={pu.card} size="sm" />
    ) : pu.kind === 'bid' && pu.bidValue !== undefined ? (
      <div className="flex items-center gap-2">
        <span className="text-[11px] uppercase tracking-[0.18em] text-navy-200">
          Bid
        </span>
        <span className="chip px-3 py-1 text-[20px]">{pu.bidValue}</span>
      </div>
    ) : null;

  return (
    <VoteModal
      eyebrow="Game paused"
      title={
        <>
          <span className={actorColor.text}>{isActor ? 'You' : pu.actor}</span>{' '}
          want{isActor ? '' : 's'} to undo
        </>
      }
      subtitle={`${isActor ? 'your' : 'their'} last ${actionWord}`}
      detail={detail}
      yesCount={yes.length}
      yesNeeded={threshold}
      noCount={no.length}
      noNeeded={voters.length - threshold + 1}
      waitingOn={waitingOn}
      myVote={myVote}
      isOpener={isActor}
      cancelLabel="Never mind, keep playing"
      yesLabel="Approve"
      noLabel="Reject"
      busy={busy}
      onVote={onVote}
      onCancel={onCancel}
      openedAt={openedAt}
      ttlMs={UNDO_VOTE_TTL_MS}
      onExpire={onExpire}
    />
  );
}
