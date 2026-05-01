import { useEffect, useRef, useState } from 'react';
import { voteEndNow } from '../lib/gameFlow';
import { isBotName } from '../lib/rooms';
import { playerColor } from '../lib/playerColors';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function GameMenu({ room, myName }: Props) {
  const [open, setOpen] = useState(false);
  const [voting, setVoting] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (sheetRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', handleDown);
    return () => document.removeEventListener('pointerdown', handleDown);
  }, [open]);

  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const canVoteEndNow =
    room.status === 'bidding' || room.status === 'playing';
  const onFinalRound = room.currentRound >= room.totalRounds;
  const showEndNow = canVoteEndNow && !onFinalRound;
  const endNowVotes = (room.endNowVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const endNowThreshold = Math.floor(realPlayers.length / 2) + 1;
  const myEndNowVote = endNowVotes.includes(myName);

  async function handleEndNow() {
    if (voting) return;
    setVoting(true);
    try {
      await voteEndNow(room.code, myName, !myEndNowVote);
    } finally {
      setVoting(false);
    }
  }

  // Standings sorted by current cumulative score (best at top).
  const standings = [...room.playerOrder].sort(
    (a, b) =>
      (room.cumulativeScores[b] ?? 0) - (room.cumulativeScores[a] ?? 0),
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Scores menu"
        className="ml-1 w-7 h-7 rounded-full bg-navy-800/80 border border-gold-700/60 flex items-center justify-center text-xs text-gold-200 active:scale-95 transition"
      >
        ☰
      </button>

      {open && (
        <>
          {/* tap-out backdrop */}
          <div className="fixed inset-0 z-[100] bg-black/40" />
          <div
            ref={sheetRef}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] w-[min(92vw,360px)] card-gold p-3 space-y-3 shadow-2xl"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-navy-200">
                Scores · Round {room.currentRound}/{room.totalRounds}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-navy-300 text-sm px-2"
              >
                ✕
              </button>
            </div>

            <ul className="divide-y divide-gold-700/20">
              {standings.map((name, i) => {
                const score = room.cumulativeScores[name] ?? 0;
                const bid = room.bids[name];
                const won = room.tricksWon[name] ?? 0;
                const isMe = name === myName;
                const c = playerColor(name, room.playerOrder);
                return (
                  <li
                    key={name}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-navy-300 text-xs w-4 text-right">
                        {i + 1}.
                      </span>
                      <span
                        className={`text-sm truncate ${
                          isMe ? 'font-bold text-gold-100' : c.text
                        }`}
                      >
                        {name}
                        {isMe ? ' (you)' : ''}
                      </span>
                      {bid !== undefined && (
                        <span className="text-[11px] tabular-nums text-navy-300">
                          {won}/{bid}
                        </span>
                      )}
                    </span>
                    <span
                      className={`tabular-nums font-bold ${
                        score > 0
                          ? 'text-emerald-300'
                          : score < 0
                            ? 'text-rose-300'
                            : 'text-navy-200'
                      }`}
                    >
                      {score}
                    </span>
                  </li>
                );
              })}
            </ul>

            {showEndNow && (
              <div className="border-t border-gold-700/30 pt-3">
                <button
                  type="button"
                  onClick={handleEndNow}
                  disabled={voting}
                  className={`w-full rounded-md py-2 text-sm font-semibold border transition tabular-nums ${
                    myEndNowVote
                      ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
                      : 'bg-navy-900 border-gold-600/60 text-gold-200 active:scale-[0.98]'
                  }`}
                >
                  {myEndNowVote ? 'Cancel: end this round ' : 'End after this round '}
                  {endNowVotes.length}/{endNowThreshold}
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
