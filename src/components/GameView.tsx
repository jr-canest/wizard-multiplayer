import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../hooks/useRoom';
import { useMyHand } from '../hooks/useMyHand';
import { useWakeLock } from '../hooks/useWakeLock';
import { TrumpDisplay } from './TrumpDisplay';
import { TrumpChooser } from './TrumpChooser';
import { HandDisplay } from './HandDisplay';
import { BiddingPanel } from './BiddingPanel';
import { TrickArea } from './TrickArea';
import { RoundScoreboard } from './RoundScoreboard';
import { FinalScoreboard } from './FinalScoreboard';
import { Opponents } from './Opponents';
import { playCard } from '../lib/gameFlow';
import { legalIndices } from '../game/legalMoves';
import { playerColor } from '../lib/playerColors';

const LAST_TRICK_HOLD_MS = 3000;

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function GameView({ room, myName }: Props) {
  const hand = useMyHand(room.code, myName);
  const dealerName = room.playerOrder[room.dealerIndex];
  const isDealer = dealerName === myName;
  const isMyTurn = room.playerOrder[room.currentPlayerIndex] === myName;

  // Hold the round-ending trick on screen for a beat before the round
  // scoreboard takes over. Set when status flips to 'scoring' with a fresh
  // last trick; cleared after LAST_TRICK_HOLD_MS.
  const [holdingRoundEnd, setHoldingRoundEnd] = useState(false);

  const showOpponents =
    room.status === 'dealing' ||
    room.status === 'bidding' ||
    room.status === 'playing' ||
    holdingRoundEnd;

  useWakeLock(room.status !== 'finished');

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
    if (
      len > lastTrickLenRef.current &&
      (room.status === 'playing' || room.status === 'scoring')
    ) {
      const last = room.trickHistory[len - 1];
      const isRoundEnd = room.status === 'scoring';
      const duration = isRoundEnd ? LAST_TRICK_HOLD_MS : 2000;
      setWinBanner({ winner: last.winner, key: len });
      if (isRoundEnd) setHoldingRoundEnd(true);
      const tBanner = window.setTimeout(() => {
        setWinBanner((b) => (b?.key === len ? null : b));
      }, duration);
      const tHold = isRoundEnd
        ? window.setTimeout(
            () => setHoldingRoundEnd(false),
            LAST_TRICK_HOLD_MS,
          )
        : null;
      lastTrickLenRef.current = len;
      return () => {
        window.clearTimeout(tBanner);
        if (tHold !== null) window.clearTimeout(tHold);
      };
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

  // Bid sum status — shown in the top header during bidding/playing/hold.
  const cardsThisRound = room.currentRound;
  const totalBids = room.playerOrder.reduce(
    (a, n) => a + (room.bids[n] ?? 0),
    0,
  );
  const anyBids = Object.keys(room.bids).length > 0;
  const showBidSum =
    anyBids &&
    (room.status === 'bidding' ||
      room.status === 'playing' ||
      holdingRoundEnd);
  const diff = totalBids - cardsThisRound;
  const bidSumLabel =
    diff > 0 ? `Over ${diff}` : diff < 0 ? `Under ${-diff}` : 'Exact';
  const bidSumTone =
    diff > 0
      ? 'text-rose-300'
      : diff === 0
        ? 'text-amber-300'
        : 'text-sky-300';

  // My bid/won chip for the hand label. Goes red if busted, green if exact.
  const myBid = room.bids[myName];
  const myWon = room.tricksWon[myName] ?? 0;
  const myBidWonTone =
    myBid === undefined
      ? 'text-navy-300'
      : myWon > myBid
        ? 'text-rose-300'
        : myWon === myBid
          ? 'text-emerald-300'
          : 'text-gold-200';

  return (
    <div className="w-full max-w-md space-y-2">
      <div className="card-gold-subtle px-3 py-1.5 flex items-center justify-between text-[12px] gap-2">
        <span className="text-navy-100 whitespace-nowrap">
          Round{' '}
          <strong className="text-gold-100">
            {room.currentRound}/{room.totalRounds}
          </strong>
        </span>
        {showBidSum && (
          <span
            className={`font-semibold tabular-nums ${bidSumTone}`}
            title={`Total bids ${totalBids} of ${cardsThisRound}`}
          >
            {bidSumLabel}
          </span>
        )}
        <span className="text-navy-100 whitespace-nowrap truncate">
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
              rotationSeed={room.currentRound}
            />
          )}
        </div>
      )}

      {room.status === 'scoring' && !holdingRoundEnd && (
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
          <h3 className="text-[10px] uppercase tracking-wider text-navy-300 mb-0.5 text-center flex items-center justify-center gap-1.5">
            <span>Your hand ({hand?.length ?? 0})</span>
            {myBid !== undefined && (
              <span className={`${myBidWonTone} font-bold normal-case tracking-normal text-[12px] tabular-nums`}>
                · {myWon}/{myBid}
              </span>
            )}
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
