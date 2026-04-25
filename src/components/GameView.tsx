import { useEffect, useRef, useState } from 'react';
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
import { playCard } from '../lib/gameFlow';
import { legalIndices } from '../game/legalMoves';
import { playerColor } from '../lib/playerColors';

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
  const [winBanner, setWinBanner] = useState<{
    winner: string;
    key: number;
  } | null>(null);
  const lastTrickLenRef = useRef<number | null>(null);

  useEffect(() => {
    const len = room.trickHistory.length;
    if (lastTrickLenRef.current === null) {
      lastTrickLenRef.current = len;
      return;
    }
    if (len > lastTrickLenRef.current && room.status === 'playing') {
      const last = room.trickHistory[len - 1];
      setWinBanner({ winner: last.winner, key: len });
      const t = window.setTimeout(() => {
        setWinBanner((b) => (b?.key === len ? null : b));
      }, 2000);
      lastTrickLenRef.current = len;
      return () => window.clearTimeout(t);
    }
    lastTrickLenRef.current = len;
  }, [room.trickHistory.length, room.status]);

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

  const winnerColor = winBanner
    ? playerColor(winBanner.winner, room.playerOrder)
    : null;

  // Hold the just-completed trick visible while the winner banner is up,
  // so the user can see the cards along with the result.
  const heldTrick =
    winBanner && room.trickInProgress.length === 0
      ? room.trickHistory[winBanner.key - 1]?.plays ?? null
      : null;
  const displayedPlays =
    room.trickInProgress.length > 0
      ? room.trickInProgress
      : heldTrick ?? [];

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
          />
          {room.status === 'bidding' ? (
            <BiddingPanel room={room} myName={myName} />
          ) : (
            <TrickArea
              plays={displayedPlays}
              playerOrder={room.playerOrder}
              trumpSuit={room.trumpSuit}
              isMyTurn={isMyTurn && room.status === 'playing'}
            />
          )}
        </div>
      )}

      {room.status === 'playing' && (
        <TrickStatus room={room} myName={myName} />
      )}

      {room.status === 'scoring' && (
        <RoundScoreboard room={room} myName={myName} />
      )}

      {room.status === 'finished' && (
        <FinalScoreboard room={room} myName={myName} />
      )}

      {winBanner && winnerColor && (
        <div
          key={winBanner.key}
          className="fixed left-1/2 top-1/3 z-[300] pointer-events-none animate-trick-banner"
        >
          <div className="card-gold px-6 py-3 shadow-2xl text-center bg-navy-900/90 backdrop-blur">
            <p className="text-2xl font-black leading-tight">
              {winBanner.winner === myName ? (
                <span className="text-gold-100">You won!</span>
              ) : (
                <>
                  <span className={winnerColor.text}>{winBanner.winner}</span>
                  <span className="text-gold-100"> won</span>
                </>
              )}
            </p>
          </div>
        </div>
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
