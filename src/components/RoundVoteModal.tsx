import { useCallback, useState } from 'react';
import {
  cancelRoundVote,
  castRoundVote,
  resolveExpiredRoundVote,
} from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { colorForViewer } from '../lib/playerColors';
import { VoteModal } from './VoteModal';
import { ROUND_VOTE_TTL_MS, type RoundVoteKind } from '../lib/types';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * The two round-end decisions that change the game (make the next round
 * the last, end the game now) as a center-screen yes/no in front of
 * every real player, instead of the old quiet tally buttons that people
 * missed. Majority carries it; enough no votes to put a majority out of
 * reach dismiss it. Plain "next round" is not one of these on purpose:
 * that stays a quiet ready-tally on the score page.
 */
export function RoundVoteModal({ room, myName }: Props) {
  if (!room.pendingVote || room.status !== 'scoring') return null;
  return <RoundVoteDialog room={room} myName={myName} />;
}

function wording(
  kind: RoundVoteKind,
  room: RoomSnapshot,
): { subtitle: string; cancel: string } {
  if (kind === 'lastRound') {
    return {
      subtitle: `to make round ${room.currentRound + 1} the last one`,
      cancel: 'Never mind',
    };
  }
  return {
    subtitle: 'to end the game right now, with these scores',
    cancel: 'Never mind',
  };
}

function RoundVoteDialog({ room, myName }: Props) {
  const pv = room.pendingVote!;
  const [busy, setBusy] = useState(false);

  const isOpener = pv.by === myName;
  const voters = room.playerOrder.filter((n) => !isBot(room, n));
  const threshold = Math.floor(voters.length / 2) + 1;
  const yes = pv.yes.filter((n) => voters.includes(n));
  const no = pv.no.filter((n) => voters.includes(n));
  const myVote = yes.includes(myName)
    ? 'yes'
    : no.includes(myName)
      ? 'no'
      : null;
  const waitingOn = voters.filter(
    (n) => !yes.includes(n) && !no.includes(n),
  );
  const openerColor = colorForViewer(pv.by, myName, room.playerOrder);
  const { subtitle, cancel } = wording(pv.kind, room);

  async function onVote(voteYes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await castRoundVote(room.code, myName, voteYes);
    } finally {
      setBusy(false);
    }
  }

  async function onCancel() {
    if (busy) return;
    setBusy(true);
    try {
      await cancelRoundVote(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  const onExpire = useCallback(
    () => resolveExpiredRoundVote(room.code),
    [room.code],
  );

  return (
    <VoteModal
      eyebrow={pv.kind === 'endGame' ? 'End the game?' : 'Vote'}
      title={
        <>
          <span className={openerColor.text}>{isOpener ? 'You' : pv.by}</span>{' '}
          {isOpener ? 'want' : 'wants'}
        </>
      }
      subtitle={subtitle}
      yesCount={yes.length}
      yesNeeded={threshold}
      noCount={no.length}
      noNeeded={voters.length - threshold + 1}
      waitingOn={waitingOn}
      myVote={myVote}
      isOpener={isOpener}
      cancelLabel={cancel}
      yesLabel="Yes"
      noLabel="No"
      busy={busy}
      onVote={onVote}
      onCancel={onCancel}
      openedAt={pv.at}
      ttlMs={ROUND_VOTE_TTL_MS}
      onExpire={onExpire}
    />
  );
}
