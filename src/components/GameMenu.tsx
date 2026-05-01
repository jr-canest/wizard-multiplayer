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
  const [view, setView] = useState<'menu' | 'scores'>('menu');
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

  // Reset to menu view whenever the sheet opens.
  useEffect(() => {
    if (open) setView('menu');
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
        aria-label="Game menu"
        className="ml-1 w-7 h-7 rounded-full bg-navy-800/80 border border-gold-700/60 flex items-center justify-center text-xs text-gold-200 active:scale-95 transition"
      >
        ☰
      </button>

      {open && (
        <>
          {/* tap-out backdrop, also catches first tap on the dimmed area */}
          <div className="fixed inset-0 z-[100] bg-black/40" />
          <div
            ref={sheetRef}
            className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-[110] w-[min(92vw,360px)] card-gold p-3 space-y-2 shadow-2xl"
          >
            {view === 'menu' ? (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs uppercase tracking-wider text-navy-200">
                    Menu
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-navy-300 text-sm px-2"
                  >
                    ✕
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => setView('scores')}
                  className="w-full text-left rounded-lg py-2.5 px-3 bg-navy-800 border border-gold-700/60 text-gold-100 active:scale-[0.98] transition"
                >
                  View scores
                </button>

                {showEndNow && (
                  <div className="rounded-lg bg-navy-800/60 border border-gold-700/40 p-2.5 space-y-1.5">
                    <button
                      type="button"
                      onClick={handleEndNow}
                      disabled={voting}
                      className={`w-full rounded-md py-2 text-sm font-semibold border transition ${
                        myEndNowVote
                          ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
                          : 'bg-navy-900 border-gold-600/60 text-gold-200 active:scale-[0.98]'
                      }`}
                    >
                      {myEndNowVote
                        ? 'Cancel: end after this round'
                        : 'Vote: end after this round'}
                    </button>
                    <p className="text-[11px] text-center text-navy-300 tabular-nums">
                      {endNowVotes.length}/{endNowThreshold} votes — majority
                      makes the current round the last.
                    </p>
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="flex items-center justify-between">
                  <button
                    type="button"
                    onClick={() => setView('menu')}
                    className="text-xs text-navy-200 underline-offset-2 underline"
                  >
                    ← Menu
                  </button>
                  <span className="text-xs uppercase tracking-wider text-navy-200">
                    Scores
                  </span>
                  <button
                    type="button"
                    onClick={() => setOpen(false)}
                    className="text-navy-300 text-sm px-2"
                  >
                    ✕
                  </button>
                </div>

                <div className="text-[11px] text-navy-300 text-center">
                  Round {room.currentRound}/{room.totalRounds}
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
              </>
            )}
          </div>
        </>
      )}
    </>
  );
}
