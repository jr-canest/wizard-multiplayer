import { useState } from 'react';
import { requestUndo, voteUndo } from '../lib/gameFlow';
import { isBotName } from '../lib/rooms';
import { playerColor } from '../lib/playerColors';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function UndoBanner({ room, myName }: Props) {
  const pu = room.pendingUndo;
  const [busy, setBusy] = useState(false);

  if (!pu) return null;
  // Hide once the round is being scored — the round is essentially "settled"
  // and showing undo here would compete with the round scoreboard.
  if (room.status === 'scoring') return null;

  const isActor = pu.actor === myName;
  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const threshold = Math.floor(realPlayers.length / 2) + 1;
  const realVotes = pu.votes.filter((n) => realPlayers.includes(n));
  const myVote = realVotes.includes(myName);
  const actionWord = pu.kind === 'bid' ? 'bid' : 'play';
  const actorColor = playerColor(pu.actor, room.playerOrder);

  async function handleRequest() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  async function handleVote(yes: boolean) {
    if (busy) return;
    setBusy(true);
    try {
      await voteUndo(room.code, myName, yes);
    } finally {
      setBusy(false);
    }
  }

  // Actor, not yet requested → show small "Undo" affordance only to actor.
  if (isActor && !pu.requested) {
    return (
      <div className="card-gold-subtle px-3 py-1.5 flex items-center justify-between text-[12px]">
        <span className="text-navy-200">
          Made a mistake on your last {actionWord}?
        </span>
        <button
          type="button"
          onClick={handleRequest}
          disabled={busy}
          className="text-gold-200 underline underline-offset-2 active:text-gold-100"
        >
          Undo
        </button>
      </div>
    );
  }

  if (!pu.requested) return null;

  // Vote is open — show banner to everyone.
  return (
    <div className="card-gold-subtle px-3 py-2 space-y-1.5 border-2 border-rose-700/40">
      <div className="flex items-baseline justify-between gap-2 text-[12px]">
        <span className="text-navy-100">
          <span className={`${actorColor.text} font-bold`}>
            {isActor ? 'You' : pu.actor}
          </span>
          <span> want{isActor ? '' : 's'} to undo {isActor ? 'your' : 'their'} last {actionWord}.</span>
        </span>
        <span className="tabular-nums text-navy-200">
          {realVotes.length}/{threshold}
        </span>
      </div>

      {isActor ? (
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-navy-300">Waiting on others to approve.</span>
          <button
            type="button"
            onClick={handleRequest}
            disabled={busy}
            className="text-rose-300 underline underline-offset-2"
          >
            Cancel
          </button>
        </div>
      ) : (
        <div className="flex gap-1.5">
          <button
            type="button"
            onClick={() => handleVote(!myVote)}
            disabled={busy}
            className={`flex-1 rounded-md py-1.5 text-xs font-semibold border transition ${
              myVote
                ? 'bg-emerald-700/40 border-emerald-500/60 text-emerald-100'
                : 'bg-navy-800 border-gold-700/60 text-gold-200 active:scale-[0.98]'
            }`}
          >
            {myVote ? '✓ Approving' : 'Approve undo'}
          </button>
        </div>
      )}
    </div>
  );
}
