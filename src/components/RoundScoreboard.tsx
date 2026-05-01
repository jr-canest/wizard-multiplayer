import { useState } from 'react';
import {
  computeRoundDeltas,
  voteEndEarly,
  voteNextRound,
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

  const realPlayers = room.playerOrder.filter((n) => !isBotName(n));
  const threshold = Math.floor(realPlayers.length / 2) + 1;
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

  // Show the end-early vote only when shrinking to "next round = last" would
  // actually save rounds (i.e. there are 2+ rounds remaining).
  const showEndEarly =
    !isFinalRound && room.totalRounds - room.currentRound >= 2;
  const earlyVotes = (room.endEarlyVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myEarlyVote = earlyVotes.includes(myName);

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

      <div className="space-y-1.5">
        <button
          type="button"
          onClick={handleAdvance}
          disabled={advancing}
          className={`w-full rounded-xl py-3 font-semibold border transition ${
            myNextVote
              ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
              : 'btn-gold border-gold-400 active:scale-[0.99]'
          }`}
        >
          {advancing
            ? 'Working…'
            : myNextVote
              ? `Cancel: ${isFinalRound ? 'finish game' : 'next round'}`
              : `Vote: ${isFinalRound ? 'finish game' : 'next round'}`}
        </button>
        <p className="text-[11px] text-center text-navy-300 tabular-nums">
          {nextVotes.length}/{threshold} votes — majority {isFinalRound ? 'finishes the game' : 'starts the next round'}.
        </p>
      </div>

      {showEndEarly && (
        <div className="border-t border-gold-700/30 pt-3 -mt-1 space-y-1.5">
          <button
            type="button"
            onClick={handleEndEarly}
            disabled={voting}
            className={`w-full rounded-lg py-2 text-sm font-semibold border transition ${
              myEarlyVote
                ? 'bg-rose-700/30 border-rose-500/60 text-rose-100'
                : 'bg-navy-800 border-gold-700/60 text-gold-200 active:scale-[0.98]'
            }`}
          >
            {myEarlyVote ? 'Cancel: end after next round' : 'Vote: end after next round'}
          </button>
          <p className="text-[11px] text-center text-navy-300 tabular-nums">
            {earlyVotes.length}/{threshold} votes — majority makes the next
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
