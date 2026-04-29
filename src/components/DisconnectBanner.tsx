import { useEffect, useState } from 'react';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';
import {
  executeKick,
  graceRemainingMs,
  isConnected,
  setVoteKick,
  tallyVotes,
} from '../lib/presence';
import { playerColor } from '../lib/playerColors';

type Props = {
  room: RoomSnapshot;
  players: PlayerSnapshot[];
  myName: string;
};

function useTick(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), intervalMs);
    return () => window.clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function DisconnectBanner({ room, players, myName }: Props) {
  const now = useTick(1000);
  const [acting, setActing] = useState(false);

  const currentName = room.playerOrder[room.currentPlayerIndex];
  const target = players.find((p) => p.name === currentName);
  const turnPhase = room.status === 'bidding' || room.status === 'playing';
  const showBanner =
    turnPhase &&
    !!currentName &&
    currentName !== myName &&
    !!target &&
    !isConnected(target, now);

  const remaining = target ? graceRemainingMs(target, now) : 0;
  const inGrace = remaining > 0;
  const tally = currentName
    ? tallyVotes(players, currentName, now)
    : { votes: 0, needed: 0, voters: [] };

  const me = players.find((p) => p.name === myName);
  const myVote = me?.voteKickAgainst ?? null;

  // Clear my stale vote once the target either reconnects or is gone.
  useEffect(() => {
    if (!myVote) return;
    const stillTargeted = players.find((p) => p.name === myVote);
    const targetGone = !stillTargeted;
    const targetBack = stillTargeted && isConnected(stillTargeted, now);
    if (targetGone || targetBack) {
      setVoteKick(room.code, myName, null).catch(() => {});
    }
  }, [myVote, players, now, room.code, myName]);

  // Auto-fire kick when threshold reached. First client wins the
  // transaction; the rest no-op against the already-shrunk playerOrder.
  useEffect(() => {
    if (!showBanner || inGrace) return;
    if (acting) return;
    if (tally.needed <= 0 || tally.votes < tally.needed) return;
    let cancelled = false;
    setActing(true);
    executeKick(room.code, currentName).finally(() => {
      if (!cancelled) setActing(false);
    });
    return () => {
      cancelled = true;
    };
  }, [
    showBanner,
    inGrace,
    tally.votes,
    tally.needed,
    acting,
    room.code,
    currentName,
  ]);

  if (!showBanner || !currentName) return null;

  const targetColor = playerColor(currentName, room.playerOrder);
  const myVoteIsForTarget = myVote === currentName;

  async function toggleVote() {
    if (acting) return;
    setActing(true);
    try {
      await setVoteKick(
        room.code,
        myName,
        myVoteIsForTarget ? null : currentName,
      );
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="card-gold-subtle border-2 border-amber-600/60 bg-amber-950/30 px-3 py-2 text-xs space-y-1">
      <div className="flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full bg-amber-400 animate-pulse" />
        <span className="text-amber-100">
          Waiting for{' '}
          <strong className={targetColor.text}>{currentName}</strong>
          {inGrace && (
            <>
              {' '}…{' '}
              <span className="tabular-nums">
                {Math.ceil(remaining / 1000)}s
              </span>
            </>
          )}
        </span>
      </div>
      {!inGrace && (
        <div className="flex items-center justify-between gap-2">
          <span className="text-amber-200 tabular-nums">
            Vote to kick · {tally.votes}/{tally.needed}
          </span>
          <button
            type="button"
            onClick={toggleVote}
            disabled={acting}
            className={`px-2.5 py-1 rounded-md text-[11px] font-bold border transition ${
              myVoteIsForTarget
                ? 'bg-rose-700/40 border-rose-500 text-rose-100'
                : 'bg-amber-700/40 border-amber-500 text-amber-100 active:scale-95'
            }`}
          >
            {myVoteIsForTarget ? 'Cancel vote' : 'Vote to kick'}
          </button>
        </div>
      )}
    </div>
  );
}
