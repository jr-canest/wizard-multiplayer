import { useState } from 'react';
import {
  computeRoundDeltas,
  cumulativeScoresFromLog,
  openRoundVote,
} from '../lib/gameFlow';
import { Chat } from './Chat';
import { RoundVoteModal } from './RoundVoteModal';
import type { RoundVoteKind } from '../lib/types';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function RoundScoreboard({ room, myName }: Props) {
  const [opening, setOpening] = useState<RoundVoteKind | null>(null);
  const [error, setError] = useState<string | null>(null);

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

  // Every round-end decision is one shared yes/no vote in front of the
  // whole table (RoundVoteModal). The buttons here only OPEN one; the
  // modal carries the tally, the answers, and the countdown. A player
  // alone against computers skips the vote and the action just happens.
  const voteOpen = !!room.pendingVote;

  async function openVote(kind: RoundVoteKind) {
    if (opening || voteOpen) return;
    setOpening(kind);
    setError(null);
    try {
      await openRoundVote(room.code, myName, kind);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to open the vote.');
    } finally {
      setOpening(null);
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

  // End-game NOW vote: finishes immediately with current scores. Hidden
  // on the final round, where advancing already finishes the game.
  const showEndGame = !isFinalRound;

  return (
    <div className="space-y-2">
    <RoundVoteModal room={room} myName={myName} />
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
        onClick={() => openVote('nextRound')}
        disabled={opening !== null || voteOpen}
        className="w-full h-12 rounded-lg font-semibold border transition btn-gold active:scale-[0.99] disabled:opacity-60"
      >
        {opening === 'nextRound'
          ? 'Working…'
          : isFinalRound
            ? 'Finish game'
            : 'Next round'}
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
                onClick={() => openVote('lastRound')}
                disabled={opening !== null || voteOpen}
                className="rounded-lg py-2 text-[11px] font-semibold border transition leading-tight bg-[rgba(20,26,44,.8)] border-gold-300/25 text-navy-200 active:scale-[0.98] disabled:opacity-60"
              >
                {opening === 'lastRound' ? 'Working…' : 'Vote:'}
                <span className="block normal-case font-normal text-[10px] opacity-90">
                  next round is last
                </span>
              </button>
            ) : (
              <div />
            )}
            {showEndGame ? (
              <button
                type="button"
                onClick={() => openVote('endGame')}
                disabled={opening !== null || voteOpen}
                className="rounded-lg py-2 text-[11px] font-semibold border transition leading-tight bg-transparent border-[rgba(248,113,113,.3)] text-[rgba(252,165,165,.75)] active:scale-[0.98] disabled:opacity-60"
              >
                {opening === 'endGame' ? 'Working…' : 'Vote:'}
                <span className="block normal-case font-normal text-[10px] opacity-90">
                  end game now
                </span>
              </button>
            ) : (
              <div />
            )}
          </div>
          <p className="text-[11px] text-center text-navy-300">
            Every vote goes to the whole table. Majority decides.
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
