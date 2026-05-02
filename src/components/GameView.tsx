import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';
import { useMyHand } from '../hooks/useMyHand';
import { useWakeLock } from '../hooks/useWakeLock';
import { TrumpChooser } from './TrumpChooser';
import { HandDisplay } from './HandDisplay';
import { BiddingPanel } from './BiddingPanel';
import { RoundScoreboard } from './RoundScoreboard';
import { FinalScoreboard } from './FinalScoreboard';
import { DisconnectBanner } from './DisconnectBanner';
import { Reactions } from './Reactions';
import { GameMenu } from './GameMenu';
import { StatusRow } from './StatusRow';
import { Table } from './Table';
import { LastEventPanel } from './LastEventPanel';
import { playCard } from '../lib/gameFlow';
import { legalIndices } from '../game/legalMoves';
import { playerColor } from '../lib/playerColors';
import { sortHandWithIndex } from '../lib/sortHand';
import type { Card } from '../lib/types';

const LAST_TRICK_HOLD_MS = 3000;

type Props = {
  room: RoomSnapshot;
  players: PlayerSnapshot[];
  myName: string;
};

export function GameView({ room, players, myName }: Props) {
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
  // The trickHistory entry whose cards have already been "cleared" from
  // the trick area. We hold the resolved trick visible from the moment
  // the server resolves it until the win-banner timeout fires; setting
  // this key marks "we're done holding" without remounting the cards.
  const [trickClearedKey, setTrickClearedKey] = useState(0);
  // Cards that are actively animating out after the banner. Keeps the
  // same DOM nodes mounted (same player keys) for ~380ms while the
  // leave animation runs, then unmounts cleanly.
  const [leavingPlays, setLeavingPlays] = useState<
    Array<{ playerName: string; card: Card }> | null
  >(null);
  const lastTrickLenRef = useRef<number | null>(null);
  const lastClearedKeyRef = useRef(0);

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
        // Mid-round: clear the resolved cards once the banner is done so
        // the trick area is empty for the next play. Round-end is handled
        // separately — the showOpponents flag flips and the area unmounts.
        if (!isRoundEnd) setTrickClearedKey(len);
      }, duration);
      const tHold = isRoundEnd
        ? window.setTimeout(() => {
            setHoldingRoundEnd(false);
            setTrickClearedKey(len);
          }, LAST_TRICK_HOLD_MS)
        : null;
      lastTrickLenRef.current = len;
      return () => {
        window.clearTimeout(tBanner);
        if (tHold !== null) window.clearTimeout(tHold);
      };
    }
    lastTrickLenRef.current = len;
  }, [room.trickHistory.length, room.status]);

  // When trickClearedKey advances past what we've animated, kick off a
  // brief leave animation on the just-cleared trick's cards.
  useEffect(() => {
    if (trickClearedKey > lastClearedKeyRef.current && trickClearedKey > 0) {
      const last = room.trickHistory[trickClearedKey - 1];
      if (last) {
        setLeavingPlays(last.plays);
        const t = window.setTimeout(() => setLeavingPlays(null), 420);
        lastClearedKeyRef.current = trickClearedKey;
        return () => window.clearTimeout(t);
      }
    }
    lastClearedKeyRef.current = trickClearedKey;
  }, [trickClearedKey, room.trickHistory]);

  // If a new trick starts while leave is in flight, abort the leave so
  // the new cards take over immediately.
  useEffect(() => {
    if (room.trickInProgress.length > 0 && leavingPlays !== null) {
      setLeavingPlays(null);
    }
  }, [room.trickInProgress.length, leavingPlays]);

  // Sort the hand by suit + rank for display. Map back to the original
  // index when calling playCard, since the server still indexes into the
  // unsorted Firestore array.
  const sortedHand = hand ? sortHandWithIndex(hand) : null;
  const displayHand = sortedHand?.map((s) => s.card) ?? null;
  const rawLegal =
    room.status === 'playing' && hand
      ? legalIndices(hand, room.trickInProgress)
      : undefined;
  const legal = rawLegal && sortedHand
    ? sortedHand.map((s) => rawLegal[s.originalIndex])
    : rawLegal;

  async function handlePlay(displayIdx: number) {
    if (playing) return;
    if (!sortedHand) return;
    const originalIdx = sortedHand[displayIdx]?.originalIndex ?? displayIdx;
    setPlaying(true);
    setPlayError(null);
    try {
      await playCard(room.code, myName, originalIdx);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Failed to play card.');
    } finally {
      setPlaying(false);
    }
  }

  const winnerColor = winBanner
    ? playerColor(winBanner.winner, room.playerOrder)
    : null;

  // Hold the just-completed trick visible from resolve until the win-banner
  // timeout marks `trickClearedKey`. Using the latest trickHistory entry
  // directly (rather than waiting on winBanner state) bridges the one-render
  // gap that previously remounted every card and re-fired its play-in animation.
  const inActiveTrickPhase =
    room.status === 'playing' || room.status === 'scoring';
  const lastTrickLen = room.trickHistory.length;
  const lastTrickPlays = room.trickHistory[lastTrickLen - 1]?.plays;
  const heldTrick =
    inActiveTrickPhase &&
    room.trickInProgress.length === 0 &&
    lastTrickPlays &&
    trickClearedKey !== lastTrickLen
      ? lastTrickPlays
      : null;
  const displayedPlays =
    room.trickInProgress.length > 0
      ? room.trickInProgress
      : heldTrick ?? leavingPlays ?? [];
  const trickIsLeaving =
    room.trickInProgress.length === 0 &&
    heldTrick === null &&
    leavingPlays !== null;

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
        <span className="text-navy-100 whitespace-nowrap flex items-center gap-1.5">
          <Reactions room={room} myName={myName} />
          <span>
            Round{' '}
            <strong className="text-gold-100">
              {room.currentRound}/{room.totalRounds}
            </strong>
          </span>
        </span>
        {showBidSum && (
          <span
            className={`font-semibold tabular-nums ${bidSumTone}`}
            title={`Total bids ${totalBids} of ${cardsThisRound}`}
          >
            {bidSumLabel}
          </span>
        )}
        <span className="text-navy-100 whitespace-nowrap truncate flex items-center gap-1">
          <span>
            Dealer{' '}
            <strong className="text-gold-100">{dealerName}</strong>
            {isDealer ? ' (you)' : ''}
          </span>
          <GameMenu room={room} myName={myName} />
        </span>
      </div>

      {/* Two-column info section under the top bar.
            Left: votes / undo / reactions / last-round announcements.
            Right: sticky last significant game event. */}
      <div className="flex items-stretch gap-1.5">
        <div className="flex-1">
          <StatusRow room={room} myName={myName} />
        </div>
        <LastEventPanel room={room} myName={myName} />
      </div>

      <DisconnectBanner room={room} players={players} myName={myName} />

      {room.awaitingTrumpChoice && isDealer && (
        <TrumpChooser code={room.code} callerName={myName} />
      )}

      {showOpponents && (
        <Table
          room={room}
          players={players}
          myName={myName}
          trickPlays={displayedPlays}
          trickIsLeaving={trickIsLeaving}
          isMyTurn={isMyTurn}
        />
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

      {/* Action area between table and hand. Fixed min-height so the
          hand never shifts as the BiddingPanel or turn callout swap in
          and out. */}
      {(room.status === 'bidding' ||
        room.status === 'playing' ||
        room.status === 'dealing') && (
        <div className="min-h-[88px] flex flex-col justify-end gap-1">
          {room.status === 'bidding' && (
            <BiddingPanel room={room} myName={myName} />
          )}
          {(() => {
            const isPlayingTurn = room.status === 'playing' && isMyTurn;
            const isBiddingTurn =
              room.status === 'bidding' &&
              room.playerOrder[room.currentPlayerIndex] === myName &&
              myBid === undefined;
            const turnLabel = isPlayingTurn
              ? 'YOUR TURN — PLAY A CARD'
              : isBiddingTurn
                ? 'YOUR TURN — PLACE YOUR BID'
                : 'WAITING FOR YOUR TURN';
            const isMyActionTurn = isPlayingTurn || isBiddingTurn;

            return (
              <h3 className="text-center flex items-center justify-center gap-1.5">
                <span
                  className={`uppercase tracking-[0.2em] font-black ${
                    isMyActionTurn
                      ? 'text-gold-100 text-[13px] animate-pulse'
                      : 'text-navy-300 text-[11px]'
                  }`}
                >
                  {turnLabel}
                </span>
                {myBid !== undefined && (
                  <span className={`${myBidWonTone} font-bold normal-case tracking-normal text-[12px] tabular-nums`}>
                    · {myWon}/{myBid}
                  </span>
                )}
              </h3>
            );
          })()}
        </div>
      )}

      {(room.status === 'bidding' ||
        room.status === 'playing' ||
        room.status === 'dealing') && (
        <div>
          <HandDisplay
            hand={displayHand}
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
