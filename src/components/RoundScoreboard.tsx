import { useState } from 'react';
import {
  computeRoundDeltas,
  scoreAndAdvance,
  voteEndEarly,
} from '../lib/gameFlow';
import { isBotName } from '../lib/rooms';
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
  const sorted = [...room.playerOrder].sort(
    (a, b) =>
      (room.cumulativeScores[b] ?? 0) +
      (deltas[b] ?? 0) -
      ((room.cumulativeScores[a] ?? 0) + (deltas[a] ?? 0)),
  );
  const isFinalRound = room.currentRound >= room.totalRounds;

  async function handleAdvance() {
    setAdvancing(true);
    setError(null);
    try {
      await scoreAndAdvance(room.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance.');
      setAdvancing(false);
    }
  }

  const bestDelta = Math.max(...Object.values(deltas));

  // Show the end-early vote only when shrinking to "next round = last" would
  // actually save rounds (i.e. there are 2+ rounds remaining).
  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const showEndEarly =
    !isFinalRound && room.totalRounds - room.currentRound >= 2;
  const votes = room.endEarlyVotes ?? [];
  const realVotes = votes.filter((n) => realPlayers.includes(n));
  const myVote = realVotes.includes(myName);
  const threshold = Math.floor(realPlayers.length / 2) + 1;

  async function handleEndEarly() {
    if (voting) return;
    setVoting(true);
    try {
      await voteEndEarly(room.code, myName, !myVote);
    } finally {
      setVoting(false);
    }
  }

  return (
    <div className="card-gold p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-navy-200">
          Round {room.currentRound} results
        </span>
        <span className="text-xs text-navy-300">
          {room.currentRound}/{room.totalRounds}
        </span>
      </div>

      <table className="w-full text-sm">
        <thead>
          <tr className="text-xs text-navy-300 uppercase tracking-wider">
            <th className="text-left font-normal pb-1">Player</th>
            <th className="text-right font-normal pb-1">Bid</th>
            <th className="text-right font-normal pb-1">Won</th>
            <th className="text-right font-normal pb-1">Δ</th>
            <th className="text-right font-normal pb-1">Total</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((name) => {
            const bid = room.bids[name] ?? 0;
            const won = room.tricksWon[name] ?? 0;
            const delta = deltas[name] ?? 0;
            const total = (room.cumulativeScores[name] ?? 0) + delta;
            const isMe = name === myName;
            const isWinner = delta === bestDelta && delta > 0;
            return (
              <tr
                key={name}
                className={
                  isWinner
                    ? 'bg-gold-900/30'
                    : ''
                }
              >
                <td
                  className={`py-1.5 ${
                    isMe ? 'text-gold-100 font-bold' : 'text-navy-50'
                  }`}
                >
                  {name}
                  {isMe ? ' (you)' : ''}
                </td>
                <td className="text-right tabular-nums text-navy-100">{bid}</td>
                <td
                  className={`text-right tabular-nums ${
                    bid === won ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {won}
                </td>
                <td
                  className={`text-right tabular-nums font-bold ${
                    delta > 0
                      ? 'text-emerald-300'
                      : delta < 0
                        ? 'text-rose-300'
                        : 'text-navy-100'
                  }`}
                >
                  {delta > 0 ? '+' : ''}
                  {delta}
                </td>
                <td className="text-right tabular-nums text-gold-100 font-bold">
                  {total}
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
        className="btn-gold w-full rounded-xl py-3"
      >
        {advancing
          ? 'Working…'
          : isFinalRound
            ? 'Finish game'
            : 'Next round'}
      </button>

      {showEndEarly && (
        <div className="border-t border-gold-700/30 pt-3 -mt-1 space-y-1.5">
          <button
            type="button"
            onClick={handleEndEarly}
            disabled={voting}
            className={`w-full rounded-lg py-2 text-sm font-semibold border transition ${
              myVote
                ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
                : 'bg-navy-800 border-gold-700/60 text-gold-200 active:scale-[0.98]'
            }`}
          >
            {myVote ? 'Cancel: end after next round' : 'Vote: end after next round'}
          </button>
          <p className="text-[11px] text-center text-navy-300 tabular-nums">
            {realVotes.length}/{threshold} votes — majority makes the next
            round the last.
          </p>
        </div>
      )}

      {error && (
        <p className="text-sm text-rose-300 text-center">{error}</p>
      )}
    </div>
  );
}
