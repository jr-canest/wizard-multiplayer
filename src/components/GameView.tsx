import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';
import { useMyHand } from '../hooks/useMyHand';
import { useWakeLock } from '../hooks/useWakeLock';
import { TrumpChooser } from './TrumpChooser';
import { HandDisplay } from './HandDisplay';
import { BidModal } from './BidModal';
import { RoundScoreboard } from './RoundScoreboard';
import { FinalScoreboard } from './FinalScoreboard';
import { DisconnectBanner } from './DisconnectBanner';
import { Reactions } from './Reactions';
import { UndoStripBar } from './OverlayBanner';
import { GameMenu } from './GameMenu';
import { Table } from './Table';
import { DealAnimation } from './DealAnimation';
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
  // Optimistic render of the local player's just-played card so it shows
  // up in the trick area immediately on drop instead of waiting for the
  // Firestore round-trip. Cleared once the server's trickInProgress (or
  // the next trickHistory entry) reflects the play.
  const [optimisticPlay, setOptimisticPlay] = useState<Card | null>(null);
  const [dealingActive, setDealingActive] = useState(false);
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
      // setState-in-effect is the right shape here — these are visual
      // states that fire exactly when a new trick lands in the log.
      setWinBanner({ winner: last.winner, key: len });
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
            // Round-end: skip the trick-leave animation. The Table is
            // about to unmount via holdingRoundEnd → false, so the
            // collect-to-winner animation would just flash mid-way as
            // the area disappears. Bumping lastClearedKeyRef ahead of
            // setTrickClearedKey makes the leavingPlays effect's gate
            // (`trickClearedKey > lastClearedKeyRef.current`) short-
            // circuit to false. trickClearedKey is still advanced so
            // future mid-round leaves animate the right trick.
            lastClearedKeyRef.current = len;
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
    // Depend on length, not the array itself — trickHistory is append-
    // only so length change is the only thing that matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.trickHistory.length, room.status]);

  // When trickClearedKey advances past what we've animated, kick off a
  // brief leave animation on the just-cleared trick's cards.
  useEffect(() => {
    if (trickClearedKey > lastClearedKeyRef.current && trickClearedKey > 0) {
      const last = room.trickHistory[trickClearedKey - 1];
      if (last) {
        // Kick off the leave animation in sync with the cleared-key
        // advance — this is the trigger, not derivable in render.
        // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // eslint-disable-next-line react-hooks/set-state-in-effect
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
    if (!sortedHand || !displayHand) return;
    const originalIdx = sortedHand[displayIdx]?.originalIndex ?? displayIdx;
    const card = displayHand[displayIdx];
    setOptimisticPlay(card);
    setPlaying(true);
    setPlayError(null);
    try {
      await playCard(room.code, myName, originalIdx);
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Failed to play card.');
      setOptimisticPlay(null);
    } finally {
      setPlaying(false);
    }
  }

  // Drop the optimistic ghost as soon as the server's view shows my play
  // (either still in-flight or already moved into trickHistory).
  useEffect(() => {
    if (!optimisticPlay) return;
    const inFlight = room.trickInProgress.some((p) => p.playerName === myName);
    const lastTrickHasMe = room.trickHistory[room.trickHistory.length - 1]?.plays.some(
      (p) => p.playerName === myName,
    );
    if (inFlight || lastTrickHasMe) {
      // Drop the optimistic ghost once the server confirms — syncing
      // local visual state with the external (Firestore) snapshot.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptimisticPlay(null);
    }
  }, [room.trickInProgress, room.trickHistory, myName, optimisticPlay]);

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
  const lastTrick = room.trickHistory[lastTrickLen - 1];
  // Only hold a trick that belongs to the current round. On refresh
  // trickClearedKey resets to 0, which would otherwise cause the last
  // trick of a previous round to be re-rendered on the table.
  const lastTrickIsCurrentRound =
    !!lastTrick && lastTrick.round === room.currentRound;
  const heldTrick =
    inActiveTrickPhase &&
    room.trickInProgress.length === 0 &&
    lastTrickIsCurrentRound &&
    trickClearedKey !== lastTrickLen
      ? lastTrick.plays
      : null;
  const baseDisplayedPlays =
    room.trickInProgress.length > 0
      ? room.trickInProgress
      : heldTrick ?? leavingPlays ?? [];
  // Append the optimistic local play when the server hasn't reflected it
  // yet so the card lands in its trick slot the instant the user drops.
  const myAlreadyShown = baseDisplayedPlays.some(
    (p) => p.playerName === myName,
  );
  const displayedPlays =
    optimisticPlay && !myAlreadyShown
      ? [
          ...baseDisplayedPlays,
          {
            playerName: myName,
            card: optimisticPlay,
            playOrder: baseDisplayedPlays.length,
          },
        ]
      : baseDisplayedPlays;
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

  // My bid/won values — used by the action strip's big right-side line.
  const myBid = room.bids[myName];
  const myWon = room.tricksWon[myName] ?? 0;

  return (
    <div className="w-full max-w-md space-y-2">
      {(() => {
        const isLastRoundNow =
          room.currentRound > 0 &&
          room.currentRound >= room.totalRounds &&
          (room.status === 'bidding' ||
            room.status === 'playing' ||
            room.status === 'dealing');
        const nextIsLast =
          !isLastRoundNow && room.currentRound + 1 === room.totalRounds;
        return (
      <div className="card-gold-subtle px-3 py-1.5 flex items-center justify-between text-[12px] gap-2">
        <span className="text-navy-100 whitespace-nowrap flex items-center gap-1.5">
          {/* Reactions are only useful during active gameplay — the
              round-end + final scoreboards have a chat box instead. */}
          {room.status !== 'scoring' && room.status !== 'finished' && (
            <Reactions room={room} myName={myName} />
          )}
          <span className="flex flex-col leading-none gap-0.5">
            <span>
              Round{' '}
              <strong className="text-gold-100">
                {room.currentRound}/{room.totalRounds}
              </strong>
            </span>
            {isLastRoundNow && (
              <span className="text-[9px] text-rose-300 leading-none uppercase tracking-wider">
                last round
              </span>
            )}
            {nextIsLast && (
              <span className="text-[9px] text-amber-300 leading-none">
                next is last
              </span>
            )}
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
        );
      })()}

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
          hideTrump={dealingActive}
          isLastRoundNoTrump={
            !room.trumpCard &&
            room.currentRound > 0 &&
            room.currentRound >= room.totalRounds
          }
          centerBanner={
            winBanner && winnerColor ? (
              <div
                key={winBanner.key}
                className="card-gold px-5 py-2.5 shadow-2xl text-center bg-navy-900/95 backdrop-blur animate-trick-banner pointer-events-auto"
              >
                <p className="text-xl font-black leading-tight">
                  {winBanner.winner === myName ? (
                    <span className="text-gold-100">You won!</span>
                  ) : (
                    <>
                      <span className={winnerColor.text}>
                        {winBanner.winner}
                      </span>
                      <span className="text-gold-100"> won</span>
                    </>
                  )}
                </p>
              </div>
            ) : null
          }
        />
      )}

      {/* Bid number picker modal — only while it's my turn to bid. */}
      {room.status === 'bidding' &&
        room.playerOrder[room.currentPlayerIndex] === myName &&
        myBid === undefined && (
          <BidModal room={room} myName={myName} />
        )}

      <DealAnimation
        room={room}
        myName={myName}
        onActiveChange={setDealingActive}
      />

      {room.status === 'scoring' && !holdingRoundEnd && (
        <RoundScoreboard room={room} myName={myName} />
      )}

      {room.status === 'finished' && (
        <FinalScoreboard room={room} myName={myName} />
      )}


      {/* Compact title strip above the user's hand. Main info area:
          turn callout on top + sticky last-event subtitle below. Same
          height across phases so the hand never shifts. The undo CTA
          slots in on the left side of this strip when active so it
          stays in the player's focus zone without shifting layout. */}
      {(room.status === 'bidding' ||
        room.status === 'playing' ||
        room.status === 'dealing') && (() => {
          const currentName = room.playerOrder[room.currentPlayerIndex];
          const isPlayingTurn = room.status === 'playing' && isMyTurn;
          const isBiddingTurn =
            room.status === 'bidding' &&
            currentName === myName &&
            myBid === undefined;
          let primary: React.ReactNode = null;
          let frame = '';
          if (isPlayingTurn) {
            primary = (
              <span className="uppercase tracking-[0.2em] font-black text-gold-100 text-[13px] animate-pulse">
                YOUR TURN
              </span>
            );
            frame = 'ring-2 ring-gold-300 shadow-[0_0_14px_rgba(254,205,70,0.4)]';
          } else if (isBiddingTurn) {
            // BidModal is up — no need for a redundant "place your bid"
            // line in the strip. Leave primary empty; subtitle still shows.
          } else if (
            room.status === 'bidding' &&
            myBid !== undefined &&
            currentName !== myName
          ) {
            primary = (
              <span className="text-navy-100 text-[12px]">
                Your bid: <strong className="text-gold-100">{myBid}</strong>
                {' · '}
                Waiting for{' '}
                <strong className="text-gold-200">{currentName}</strong>…
              </span>
            );
          } else if (
            (room.status === 'bidding' || room.status === 'playing') &&
            currentName !== myName
          ) {
            primary = (
              <span className="text-navy-200 text-[12px]">
                Waiting for{' '}
                <strong className="text-gold-200">{currentName}</strong>…
              </span>
            );
          } else {
            primary = (
              <span className="uppercase tracking-[0.2em] font-black text-navy-300 text-[11px]">
                WAITING
              </span>
            );
          }
          // Sticky last event — only this round's most recent trickWin.
          // Round summaries are dropped (the round scoreboard already
          // covers that and this strip should stay focused on now).
          const lastEvent: React.ReactNode = (() => {
            for (let i = room.log.length - 1; i >= 0; i--) {
              const e = room.log[i];
              if (e.t === 'trickWin' && e.round === room.currentRound) {
                return (
                  <>
                    <span className="text-gold-300">♛</span>{' '}
                    last trick:{' '}
                    <strong className="text-gold-200">
                      {e.winner === myName ? 'you' : e.winner}
                    </strong>
                  </>
                );
              }
              // Stop at the first roundScore — older trick wins are
              // from previous rounds and we don't surface those.
              if (e.t === 'roundScore') return null;
            }
            return null;
          })();
          // My own big won/bid line — same visual treatment as the
          // opponent tiles' middle row (text-[18px] tabular, color-coded).
          let myBigLine: React.ReactNode = null;
          let myBigTone = 'text-navy-400';
          if (myBid === undefined) {
            myBigLine = '—';
          } else if (room.status === 'bidding') {
            myBigLine = myBid;
            myBigTone = 'text-gold-100';
          } else {
            myBigLine = `${myWon}/${myBid}`;
            myBigTone =
              myWon > myBid
                ? 'text-rose-300'
                : myWon === myBid
                  ? 'text-emerald-300'
                  : 'text-sky-300';
          }
          // Undo slots in on the left when there's a pending action the
          // viewer can request/vote on. When active, it suppresses the
          // centered primary/lastEvent so the strip doesn't fight itself.
          const showUndoInStrip =
            (room.status === 'bidding' || room.status === 'playing') &&
            !!room.pendingUndo &&
            (room.pendingUndo.actor === myName || !!room.pendingUndo.requested);
          return (
            <div
              data-action-strip
              className={`relative card-gold-subtle px-3 py-1 min-h-[48px] flex items-stretch transition-shadow ${frame}`}
            >
              {/* Left-side undo. Lives inside the strip (no layout push)
                  and overrides the centered primary so the player isn't
                  reading two competing CTAs at once. */}
              {showUndoInStrip && (
                <div className="relative z-10 flex items-center pr-2 max-w-[75%]">
                  <UndoStripBar room={room} myName={myName} />
                </div>
              )}
              {/* Center column is absolutely positioned so the right-side
                  bid badge can't shift it off-axis. Hidden while the undo
                  occupies the strip. */}
              {!showUndoInStrip && (
                <div className="absolute inset-0 px-3 flex flex-col items-center justify-center gap-0.5 pointer-events-none">
                  {primary && (
                    <div className="flex items-center justify-center">
                      {primary}
                    </div>
                  )}
                  {lastEvent && (
                    <div className="text-[10px] text-navy-300 leading-tight">
                      {lastEvent}
                    </div>
                  )}
                </div>
              )}
              {/* Spacer + right-side big won/bid (mirror to keep balance). */}
              <div className="flex-1" />
              <div
                className={`relative shrink-0 flex items-center justify-end pl-2 ml-2 border-l border-gold-700/40 ${myBigTone} font-black tabular-nums text-[18px] leading-none`}
                title={
                  myBid === undefined
                    ? 'Waiting to bid'
                    : room.status === 'bidding'
                      ? `Your bid: ${myBid}`
                      : `Won ${myWon}/${myBid}`
                }
              >
                {myBigLine}
              </div>
            </div>
          );
        })()}

      {(room.status === 'bidding' ||
        room.status === 'playing' ||
        room.status === 'dealing') && (
        <div
          data-player={myName}
          className={
            dealingActive
              ? 'opacity-0 pointer-events-none'
              : 'opacity-100 transition-opacity duration-300'
          }
        >
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
