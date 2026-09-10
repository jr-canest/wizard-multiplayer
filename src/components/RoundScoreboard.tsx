import { useState } from 'react';
import {
  computeRoundDeltas,
  cumulativeScoresFromLog,
  voteEndEarly,
  voteEndGame,
  voteNextRound,
} from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { Chat } from './Chat';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function RoundScoreboard({ room, myName }: Props) {
  const [advancing, setAdvancing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voting, setVoting] = useState(false);

  const deltas = computeRoundDeltas(
    room.playerOrder,
    room.bids,
    room.tricksWon,
  );
  // Authoritative cumulative comes from the log — older rooms can have
  // stale zeros in the doc (dealNextRound didn't persist between rounds).
  const baseCumulative = cumulativeScoresFromLog(
    room.playerOrder,
    room.log,
  );
  const sorted = [...room.playerOrder].sort(
    (a, b) =>
      (baseCumulative[b] ?? 0) +
      (deltas[b] ?? 0) -
      ((baseCumulative[a] ?? 0) + (deltas[a] ?? 0)),
  );
  const isFinalRound = room.currentRound >= room.totalRounds;

  const realPlayers = room.playerOrder.filter((n) => !isBot(room, n));
  // Mid-game advance is unanimous (no one skipped past a round); final-
  // round finish is majority so a hold-out can't trap the table.
  const threshold = isFinalRound
    ? Math.floor(realPlayers.length / 2) + 1
    : Math.max(1, realPlayers.length);
  // End-now / end-early use majority — kept separate so the wording is clear.
  const earlyThreshold = Math.floor(realPlayers.length / 2) + 1;
  const nextVotes = (room.nextRoundVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myNextVote = nextVotes.includes(myName);

  async function handleAdvance() {
    if (advancing) return;
    setAdvancing(true);
    setError(null);
    try {
      await voteNextRound(room.code, myName, !myNextVote);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to vote.');
    } finally {
      setAdvancing(false);
    }
  }

  const bestDelta = Math.max(...Object.values(deltas));

  // Next-up context (mirrors the scorekeeper's merged results screen):
  // the dealer rotates one seat left, cards = round number, and the
  // final round is played without trump (house rule).
  const nextRound = room.currentRound + 1;
  const nextDealer =
    room.playerOrder[(room.dealerIndex + 1) % room.playerOrder.length];
  const nextIsLast = !isFinalRound && nextRound >= room.totalRounds;

  // Show the end-early vote only when shrinking to "next round = last" would
  // actually save rounds (i.e. there are 2+ rounds remaining).
  const showEndEarly =
    !isFinalRound && room.totalRounds - room.currentRound >= 2;
  const earlyVotes = (room.endEarlyVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myEarlyVote = earlyVotes.includes(myName);

  // End-game NOW vote — finishes immediately with current scores.
  // Hide on the final round (advancing already finishes the game).
  const showEndGame = !isFinalRound;
  const endGameVotes = (room.endGameVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myEndGameVote = endGameVotes.includes(myName);

  async function handleEndGame() {
    if (voting) return;
    setVoting(true);
    try {
      await voteEndGame(room.code, myName, !myEndGameVote);
    } finally {
      setVoting(false);
    }
  }

  async function handleEndEarly() {
    if (voting) return;
    setVoting(true);
    try {
      await voteEndEarly(room.code, myName, !myEarlyVote);
    } finally {
      setVoting(false);
    }
  }

  return (
    <div className="space-y-2">
    <Chat room={room} myName={myName} />
    <div className="card-gold p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="section-label">Round {room.currentRound} results</span>
        <span className="font-bold text-[13px] text-navy-300 tabular-nums">
          {room.currentRound}/{room.totalRounds}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr>
            <th className="section-label text-left font-bold pb-1.5">Player</th>
            <th className="section-label text-right font-bold pb-1.5">Bid</th>
            <th className="section-label text-right font-bold pb-1.5">Won</th>
            <th className="section-label text-right font-bold pb-1.5">Δ</th>
            <th className="section-label text-right font-bold pb-1.5">Total</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((name) => {
            const bid = room.bids[name] ?? 0;
            const won = room.tricksWon[name] ?? 0;
            const delta = deltas[name] ?? 0;
            const total = (baseCumulative[name] ?? 0) + delta;
            const isMe = name === myName;
            const isWinner = delta === bestDelta && delta > 0;
            const isReal = !isBot(room, name);
            const hasVoted = nextVotes.includes(name);
            return (
              <tr
                key={name}
                className={
                  isWinner
                    ? 'bg-gold-300/[.07]'
                    : ''
                }
              >
                <td
                  className={`py-1.5 font-display font-semibold text-[17px] ${
                    isMe ? 'text-cream-bright font-bold' : 'text-cream'
                  }`}
                >
                  {isReal && (
                    <span
                      aria-label={hasVoted ? 'voted' : 'not voted'}
                      title={
                        hasVoted
                          ? `${name} voted to ${
                              isFinalRound ? 'finish' : 'advance'
                            }`
                          : `${name} hasn't voted yet`
                      }
                      className={`inline-block w-3 mr-1 text-center tabular-nums ${
                        hasVoted ? 'text-emerald-300' : 'text-navy-400/50'
                      }`}
                    >
                      {hasVoted ? '✓' : '·'}
                    </span>
                  )}
                  {name}
                  {isMe ? ' (you)' : ''}
                </td>
                <td className="text-right tabular-nums font-semibold text-[14px] text-cream">{bid}</td>
                <td
                  className={`text-right tabular-nums font-semibold text-[14px] ${
                    bid === won ? 'text-[#6ee7b7]' : 'text-[#fda4af]'
                  }`}
                >
                  {won}
                </td>
                <td
                  className={`text-right tabular-nums text-[10px] font-semibold ${
                    delta > 0
                      ? 'text-[#6ee7b7]'
                      : delta < 0
                        ? 'text-[#fda4af]'
                        : 'text-navy-200'
                  }`}
                >
                  {delta > 0 ? '+' : delta < 0 ? '−' : ''}
                  {Math.abs(delta)}
                </td>
                <td className="text-right tabular-nums font-bold text-[16px] text-gold-text">
                  {total < 0 ? `−${Math.abs(total)}` : total}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <button
        type="button"
        onClick={handleAdvance}
        disabled={advancing}
        className={`w-full h-12 rounded-lg font-semibold border transition tabular-nums ${
          myNextVote
            ? 'bg-[rgba(6,78,59,.3)] border-[rgba(16,185,129,.6)] text-emerald-100'
            : 'btn-gold active:scale-[0.99]'
        }`}
      >
        {advancing
          ? 'Working…'
          : myNextVote
            ? `✓ Voted · ${isFinalRound ? 'finish game' : 'next round'} ${nextVotes.length}/${threshold} (tap to cancel)`
            : `${isFinalRound ? 'Finish game' : 'Next round'} ${nextVotes.length}/${threshold}`}
      </button>

      {!isFinalRound && (
        <p className="text-[11px] text-center text-navy-300 -mt-2">
          Next up: round{' '}
          <strong className="font-bold text-navy-100 tabular-nums">{nextRound}</strong>
          {' · '}
          <span className="tabular-nums">{nextRound} card{nextRound !== 1 ? 's' : ''}</span>
          {' · '}
          dealer{' '}
          <strong className="font-display font-semibold text-[13px] text-cream">
            {nextDealer}
          </strong>
          {nextDealer === myName ? ' (you)' : ''}
          {nextIsLast && (
            <span className="text-amber-300"> · last round, no trump</span>
          )}
        </p>
      )}

      {(showEndEarly || showEndGame) && (
        <div className="border-t border-gold-700/30 pt-3 -mt-1 space-y-1.5">
          <div className="grid grid-cols-2 gap-1.5">
            {showEndEarly ? (
              <button
                type="button"
                onClick={handleEndEarly}
                disabled={voting}
                className={`rounded-lg py-2 text-[11px] font-semibold border transition tabular-nums leading-tight ${
                  myEarlyVote
                    ? 'bg-[rgba(6,78,59,.3)] border-[rgba(16,185,129,.6)] text-emerald-100'
                    : 'bg-[rgba(20,26,44,.8)] border-gold-300/25 text-navy-200 active:scale-[0.98]'
                }`}
              >
                {myEarlyVote ? '✓ Voted — ' : 'Vote: '}
                <span className="block normal-case font-normal text-[10px] opacity-90">
                  next round is last
                </span>
                <span className="tabular-nums">
                  {earlyVotes.length}/{earlyThreshold}
                </span>
              </button>
            ) : (
              <div />
            )}
            {showEndGame ? (
              <button
                type="button"
                onClick={handleEndGame}
                disabled={voting}
                className={`rounded-lg py-2 text-[11px] font-semibold border transition tabular-nums leading-tight ${
                  myEndGameVote
                    ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
                    : 'bg-transparent border-[rgba(248,113,113,.3)] text-[rgba(252,165,165,.75)] active:scale-[0.98]'
                }`}
              >
                {myEndGameVote ? '✓ Voted — ' : 'Vote: '}
                <span className="block normal-case font-normal text-[10px] opacity-90">
                  end game now
                </span>
                <span className="tabular-nums">
                  {endGameVotes.length}/{earlyThreshold}
                </span>
              </button>
            ) : (
              <div />
            )}
          </div>
          <p className="text-[11px] text-center text-navy-300">
            Both votes need a majority.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-300 text-center">{error}</p>
      )}
    </div>
    </div>
  );
}
