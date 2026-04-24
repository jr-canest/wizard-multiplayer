import { useState } from 'react';
import type { RoomSnapshot } from '../hooks/useRoom';
import { useMyHand } from '../hooks/useMyHand';
import { TrumpDisplay } from './TrumpDisplay';
import { TrumpChooser } from './TrumpChooser';
import { HandDisplay } from './HandDisplay';
import { BiddingPanel } from './BiddingPanel';
import { TrickArea } from './TrickArea';
import { TrickStatus } from './TrickStatus';
import { RoundScoreboard } from './RoundScoreboard';
import { FinalScoreboard } from './FinalScoreboard';
import { Opponents } from './Opponents';
import { YourTurnBanner } from './YourTurnBanner';
import { playCard } from '../lib/gameFlow';
import { legalIndices } from '../game/legalMoves';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function GameView({ room, myName }: Props) {
  const hand = useMyHand(room.code, myName);
  const dealerName = room.playerOrder[room.dealerIndex];
  const isDealer = dealerName === myName;
  const isMyTurn = room.playerOrder[room.currentPlayerIndex] === myName;
  const showOpponents =
    room.status === 'dealing' ||
    room.status === 'bidding' ||
    room.status === 'playing';

  const [playError, setPlayError] = useState<string | null>(null);
  const [playing, setPlaying] = useState(false);

  const legal =
    room.status === 'playing' && hand
      ? legalIndices(hand, room.trickInProgress)
      : undefined;

  async function handlePlay(idx: number) {
    if (playing) return;
    setPlaying(true);
    setPlayError(null);
    try {
      await playCard(room.code, myName, idx);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Failed to play card.');
    } finally {
      setPlaying(false);
    }
  }

  return (
    <div className="w-full max-w-md space-y-3">
      <div className="card-gold-subtle px-4 py-2 flex items-center justify-between text-sm">
        <span className="text-navy-100">
          Round{' '}
          <strong className="text-gold-100">
            {room.currentRound}/{room.totalRounds}
          </strong>
        </span>
        <span className="text-navy-100">
          Dealer{' '}
          <strong className="text-gold-100">{dealerName}</strong>
          {isDealer ? ' (you)' : ''}
        </span>
      </div>

      {showOpponents && <Opponents room={room} myName={myName} />}

      {room.awaitingTrumpChoice && isDealer && (
        <TrumpChooser code={room.code} callerName={myName} />
      )}

      {showOpponents && (
        <div className="flex items-stretch gap-2">
          <TrumpDisplay
            trumpCard={room.trumpCard}
            trumpSuit={room.trumpSuit}
            awaitingTrumpChoice={room.awaitingTrumpChoice}
            compact
          />
          <TrickArea
            plays={room.trickInProgress}
            myName={myName}
            isMyTurn={isMyTurn && room.status === 'playing'}
          />
        </div>
      )}

      {room.status === 'bidding' && (
        <BiddingPanel room={room} myName={myName} />
      )}

      {room.status === 'playing' && (
        <>
          <TrickStatus room={room} myName={myName} />
          {isMyTurn && <YourTurnBanner text="Your turn — pick a card" />}
        </>
      )}

      {room.status === 'scoring' && (
        <RoundScoreboard room={room} myName={myName} />
      )}

      {room.status === 'finished' && (
        <FinalScoreboard room={room} myName={myName} />
      )}

      {(room.status === 'bidding' ||
        room.status === 'playing' ||
        room.status === 'dealing') && (
        <div>
          <h3 className="text-xs uppercase tracking-wider text-navy-200 mb-1 text-center">
            Your hand ({hand?.length ?? 0})
          </h3>
          <HandDisplay
            hand={hand}
            legal={legal}
            isMyTurn={room.status === 'playing' && isMyTurn}
            onPlay={
              room.status === 'playing' && isMyTurn ? handlePlay : undefined
            }
          />
          {playError && (
            <p className="text-sm text-rose-300 text-center mt-1">
              {playError}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
