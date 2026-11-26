import { useState } from 'react';
import {
  openRoundVote,
  voteNextRound,
} from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { Chat } from './Chat';
import { RoundVoteModal } from './RoundVoteModal';
import type { RoundVoteKind } from '../lib/types';
import type { RoomSnapshot } from '../hooks/useRoom';
import { RoundStandings } from './RoundStandings';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function RoundScoreboard({ room, myName }: Props) {
  const [advancing, setAdvancing] = useState(false);
  const [opening, setOpening] = useState<RoundVoteKind | null>(null);
  const [error, setError] = useState<string | null>(null);

  const isFinalRound = room.currentRound >= room.totalRounds;

  const realPlayers = room.playerOrder.filter((n) => !isBot(room, n));
  // "Next round" is a quiet ready-tally, not a pop-up (Jorge, 2026-09-18):
  // mid-game advance is unanimous (no one skipped past a round); final-
  // round finish is majority so a hold-out can't trap the table.
  const threshold = isFinalRound
    ? Math.floor(realPlayers.length / 2) + 1
    : Math.max(1, realPlayers.length);
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

  // The two decisions that change the game ("next round is last", "end
  // game now") are one shared yes/no vote in front of the whole table
  // (RoundVoteModal). The buttons here only OPEN one; the modal carries
  // the tally, the answers, and the countdown. A player alone against
  // computers skips the vote and the action just happens.
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
    <div className="space-y-2 animate-view-in">
    <RoundVoteModal room={room} myName={myName} />
    <Chat room={room} myName={myName} />
    <div className="card-gold p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="section-label">Round {room.currentRound} results</span>
        <span className="font-bold text-[13px] text-navy-300 tabular-nums">
          {room.currentRound}/{room.totalRounds}
        </span>
      </div>

      <RoundStandings key={room.currentRound} room={room} myName={myName} nextVotes={nextVotes} isFinalRound={isFinalRound} />

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
          {/* One button when only one vote is on offer (the round before
              the last has no "next is last"): full width, not a half-empty row. */}
          <div className={`grid gap-1.5 ${showEndEarly && showEndGame ? 'grid-cols-2' : 'grid-cols-1'}`}>
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
            ) : null}
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
            ) : null}
          </div>
          <p className="text-[11px] text-center text-navy-300">
            {showEndEarly && showEndGame ? 'Either one asks' : 'It asks'} the whole table. Majority decides.
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
