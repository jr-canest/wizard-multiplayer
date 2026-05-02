import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeRoundDeltas,
  cumulativeScoresFromLog,
  voteEndGame,
  voteEndNow,
  voteNextRound,
} from '../lib/gameFlow';
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
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
    bottom: number;
  } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Match the trick-area frame's horizontal extent so the sheet sits
  // centered on the table column. Re-measure when opened + on resize.
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const el = document.querySelector<HTMLElement>(
        '[data-trick-area-frame]',
      );
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchor({
        left: r.left,
        top: r.top,
        width: r.width,
        bottom: window.innerHeight - r.bottom,
      });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

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
  // Majority for the end-now (mid-game) vote.
  const majorityThreshold = Math.floor(realPlayers.length / 2) + 1;
  // Unanimous for the next-round advance vote.
  const unanimousThreshold = Math.max(1, realPlayers.length);

  const canVoteEndNow =
    room.status === 'bidding' || room.status === 'playing';
  // No point voting if the next round is already the final.
  const nextIsAlreadyLast = room.currentRound + 1 >= room.totalRounds;
  const showEndNow = canVoteEndNow && !nextIsAlreadyLast;
  const endNowVotes = (room.endNowVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myEndNowVote = endNowVotes.includes(myName);

  // End-game-NOW vote — finishes immediately with current scores.
  // Available during bidding/playing/scoring (anywhere except lobby/finished).
  const canVoteEndGame =
    room.status === 'bidding' ||
    room.status === 'playing' ||
    room.status === 'scoring';
  const endGameVotes = (room.endGameVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myEndGameVote = endGameVotes.includes(myName);

  // Next-round vote (during scoring). Mirrors the RoundScoreboard's vote
  // control so the user can confirm/cast from either place.
  const showNextRoundVote = room.status === 'scoring';
  const isFinalRound = room.currentRound >= room.totalRounds;
  const nextRoundVotes = (room.nextRoundVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myNextRoundVote = nextRoundVotes.includes(myName);

  async function handleEndNow() {
    if (voting) return;
    setVoting(true);
    try {
      await voteEndNow(room.code, myName, !myEndNowVote);
    } finally {
      setVoting(false);
    }
  }

  async function handleNextRound() {
    if (voting) return;
    setVoting(true);
    try {
      await voteNextRound(room.code, myName, !myNextRoundVote);
    } finally {
      setVoting(false);
    }
  }

  async function handleEndGame() {
    if (voting) return;
    setVoting(true);
    try {
      await voteEndGame(room.code, myName, !myEndGameVote);
    } finally {
      setVoting(false);
    }
  }

  // Compute totals from the log (authoritative) rather than the doc's
  // cumulativeScores, which can lag in older rooms (a bug where
  // dealNextRound didn't persist it between rounds left some games with
  // stale zeros). During scoring, fold in the current round's deltas
  // since the round hasn't been logged yet.
  const isScoring = room.status === 'scoring';
  const baseCumulative = cumulativeScoresFromLog(room.playerOrder, room.log);
  const liveDeltas = isScoring
    ? computeRoundDeltas(room.playerOrder, room.bids, room.tricksWon)
    : null;
  function liveTotal(name: string): number {
    return (baseCumulative[name] ?? 0) + (liveDeltas?.[name] ?? 0);
  }

  // Standings sorted by live (post-this-round-if-scoring) score.
  const standings = [...room.playerOrder].sort(
    (a, b) => liveTotal(b) - liveTotal(a),
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
          <div className="fixed inset-0 z-[270] bg-black/40" />
          <div
            ref={sheetRef}
            className="fixed z-[280] card-gold p-3 space-y-3 shadow-2xl"
            style={
              anchor
                ? {
                    left: anchor.left,
                    top: Math.max(8, anchor.top - 4),
                    width: anchor.width,
                  }
                : {
                    // Fallback before anchor measurement
                    left: '50%',
                    top: '8vh',
                    transform: 'translateX(-50%)',
                    width: 'min(92vw, 360px)',
                  }
            }
          >
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-gold-200">
                Total scores
              </span>
              <span className="text-[11px] tabular-nums text-navy-300">
                Round {room.currentRound}/{room.totalRounds}
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
                const score = liveTotal(name);
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
                      className={`tabular-nums font-bold text-lg ${
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

            {showNextRoundVote && (
              <div className="border-t border-gold-700/30 pt-3">
                <button
                  type="button"
                  onClick={handleNextRound}
                  disabled={voting}
                  className={`w-full rounded-md py-2 text-sm font-semibold border transition tabular-nums ${
                    myNextRoundVote
                      ? 'bg-emerald-700/30 border-emerald-500/60 text-emerald-100'
                      : 'bg-navy-900 border-gold-600/60 text-gold-200 active:scale-[0.98]'
                  }`}
                >
                  {myNextRoundVote
                    ? `✓ Voted · ${isFinalRound ? 'finish game' : 'next round'} ${nextRoundVotes.length}/${unanimousThreshold}`
                    : `${isFinalRound ? 'Finish game' : 'Next round'} ${nextRoundVotes.length}/${unanimousThreshold}`}
                </button>
              </div>
            )}

            {(showEndNow || canVoteEndGame) && (
              <div className="border-t border-gold-700/30 pt-3">
                <div className="grid grid-cols-2 gap-1.5">
                  {showEndNow ? (
                    <button
                      type="button"
                      onClick={handleEndNow}
                      disabled={voting}
                      className={`rounded-md py-2 text-[11px] font-semibold border transition tabular-nums leading-tight ${
                        myEndNowVote
                          ? 'bg-emerald-700/30 border-emerald-500/60 text-emerald-100'
                          : 'bg-navy-900 border-gold-600/60 text-gold-200 active:scale-[0.98]'
                      }`}
                    >
                      {myEndNowVote ? '✓ Voted — ' : 'Vote: '}
                      <span className="block normal-case font-normal text-[10px] opacity-90">
                        next round is last
                      </span>
                      <span className="tabular-nums">
                        {endNowVotes.length}/{majorityThreshold}
                      </span>
                    </button>
                  ) : (
                    <div />
                  )}
                  {canVoteEndGame ? (
                    <button
                      type="button"
                      onClick={handleEndGame}
                      disabled={voting}
                      className={`rounded-md py-2 text-[11px] font-semibold border transition tabular-nums leading-tight ${
                        myEndGameVote
                          ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
                          : 'bg-navy-900 border-rose-700/60 text-rose-200 active:scale-[0.98]'
                      }`}
                    >
                      {myEndGameVote ? '✓ Voted — ' : 'Vote: '}
                      <span className="block normal-case font-normal text-[10px] opacity-90">
                        end game now
                      </span>
                      <span className="tabular-nums">
                        {endGameVotes.length}/{majorityThreshold}
                      </span>
                    </button>
                  ) : (
                    <div />
                  )}
                </div>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}
