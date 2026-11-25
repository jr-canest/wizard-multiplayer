import { useCallback, useState } from 'react';
import { cancelShameVote, castShameVote } from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { colorForViewer, colorOrder } from '../lib/playerColors';
import { VoteModal } from './VoteModal';
import { SHAME_VOTE_TTL_MS } from '../lib/types';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = { room: RoomSnapshot; myName: string };

/**
 * "X wants to give Y a shame point": the same yes/no box as the other
 * table votes, in front of every real player except Y, who has no say.
 * The game is NOT paused (the server keeps dealing with plays behind it).
 * An open undo vote shows first; this one comes back once that is settled.
 */
export function ShameVoteModal({ room, myName }: Props) {
  const ps = room.pendingShame;
  if (!ps || room.pendingUndo?.requested) return null;
  if (ps.target === myName) return null;
  return <ShameVoteDialog room={room} myName={myName} />;
}

function ShameVoteDialog({ room, myName }: Props) {
  const ps = room.pendingShame!;
  const [busy, setBusy] = useState(false);
  const isOpener = ps.by === myName;
  const voters = room.playerOrder.filter((n) => !isBot(room, n) && n !== ps.target);
  const threshold = Math.floor(voters.length / 2) + 1;
  const yes = ps.yes.filter((n) => voters.includes(n));
  const no = ps.no.filter((n) => voters.includes(n));
  const myVote = yes.includes(myName) ? 'yes' : no.includes(myName) ? 'no' : null;
  const waitingOn = voters.filter((n) => !yes.includes(n) && !no.includes(n));
  const order = colorOrder(room);
  const openerColor = colorForViewer(ps.by, myName, order);
  const targetColor = colorForViewer(ps.target, myName, order);

  async function run(fn: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    try { await fn(); } catch { /* the next snapshot shows where it stands */ } finally { setBusy(false); }
  }
  const onExpire = useCallback(() => {}, []);

  return (
    <VoteModal
      eyebrow="Shame vote"
      title={
        <>
          <span className={openerColor.text}>{isOpener ? 'You' : ps.by}</span>{' '}
          {isOpener ? 'want' : 'wants'}
        </>
      }
      subtitle={
        <>
          to give <strong className={`font-display font-semibold text-[15px] ${targetColor.text}`}>{ps.target}</strong> a shame point
        </>
      }
      yesCount={yes.length}
      yesNeeded={threshold}
      noCount={no.length}
      noNeeded={voters.length - threshold + 1}
      waitingOn={waitingOn}
      myVote={myVote}
      isOpener={isOpener}
      cancelLabel="Never mind"
      yesLabel="Shame"
      noLabel="Spare"
      busy={busy}
      onVote={(v) => run(() => castShameVote(room.code, v))}
      onCancel={() => run(() => cancelShameVote(room.code))}
      openedAt={ps.at}
      ttlMs={SHAME_VOTE_TTL_MS}
      onExpire={onExpire}
    />
  );
}
