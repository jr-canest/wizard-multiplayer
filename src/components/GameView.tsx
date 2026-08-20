import { useEffect, useRef, useState } from 'react';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';
import { useMyHand } from '../hooks/useMyHand';
import { useWakeLock } from '../hooks/useWakeLock';
import { TrumpChooser } from './TrumpChooser';
import { HandDisplay } from './HandDisplay';
import { BidModal } from './BidModal';
import { BidButtonsBar } from './BidButtonsBar';
import { RoundScoreboard } from './RoundScoreboard';
import { FinalScoreboard } from './FinalScoreboard';
import { DisconnectBanner } from './DisconnectBanner';
import { Reactions } from './Reactions';
import { UndoStripBar } from './OverlayBanner';
import { CommentaryOverlay } from './CommentaryOverlay';
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
  // scoreboard takes over. Flips to true synchronously during render
  // (see prev-status block below) the moment status goes playing →
  // scoring, so the Table never unmounts for a frame; cleared after
  // LAST_TRICK_HOLD_MS by the trick-history effect.
  const [holdingRoundEnd, setHoldingRoundEnd] = useState(false);
  // Synchronous prev-status tracking. Using setState during render so
  // the round-end hold flips in the SAME render as the status change
  // — otherwise the Table would unmount for one frame and the cards
  // would all re-fire their play-in animation when it remounts.
  const [prevStatus, setPrevStatus] = useState(room.status);
  if (room.status !== prevStatus) {
    setPrevStatus(room.status);
    if (prevStatus === 'playing' && room.status === 'scoring') {
      setHoldingRoundEnd(true);
    } else if (room.status !== 'scoring') {
      setHoldingRoundEnd(false);
    }
  }

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
  // Firestore round-trip. histLen records trickHistory.length at play
  // time so the clear check can tell "the trick I played into resolved"
  // apart from "some earlier trick has my name in it" (every completed
  // trick contains every player, so a bare name check cleared the ghost
  // instantly and the optimistic play never actually showed).
  const [optimisticPlay, setOptimisticPlay] = useState<{
    card: Card;
    histLen: number;
  } | null>(null);
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

  // Returns false when the play didn't go through (double-tap while one is
  // in flight, or a server rejection) so HandDisplay can un-hide the card
  // immediately instead of waiting for its safety timeout.
  async function handlePlay(displayIdx: number): Promise<boolean> {
    if (playing) return false;
    if (!sortedHand || !displayHand) return false;
    const originalIdx = sortedHand[displayIdx]?.originalIndex ?? displayIdx;
    const card = displayHand[displayIdx];
    setOptimisticPlay({ card, histLen: room.trickHistory.length });
    // Playing into the win-banner window: the previous trick's hold is
    // being replaced by this new play, so drop the banner with it.
    setWinBanner(null);
    setPlaying(true);
    setPlayError(null);
    try {
      await playCard(room.code, myName, originalIdx);
      return true;
    } catch (err) {
      setPlayError(err instanceof Error ? err.message : 'Failed to play card.');
      setOptimisticPlay(null);
      return false;
    } finally {
      setPlaying(false);
    }
  }

  // Drop the optimistic ghost as soon as the server's view shows my play:
  // either it's in the in-progress trick, or my play completed the trick
  // and trickHistory grew past the length recorded at play time.
  useEffect(() => {
    if (!optimisticPlay) return;
    const inFlight = room.trickInProgress.some((p) => p.playerName === myName);
    const trickResolved = room.trickHistory.length > optimisticPlay.histLen;
    if (inFlight || trickResolved) {
      // Drop the optimistic ghost once the server confirms — syncing
      // local visual state with the external (Firestore) snapshot.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setOptimisticPlay(null);
    }
  }, [room.trickInProgress, room.trickHistory.length, myName, optimisticPlay]);

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
  // When I lead the next trick while the previous one is still held on
  // the table (win-banner window), the optimistic play must REPLACE the
  // held trick, not append to it — otherwise the held trick's copy of my
  // previous card makes `myAlreadyShown` true and the new card shows up
  // nowhere until the server round-trip completes (read as lag).
  const baseDisplayedPlays =
    room.trickInProgress.length > 0
      ? room.trickInProgress
      : optimisticPlay
        ? []
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
            card: optimisticPlay.card,
            playOrder: baseDisplayedPlays.length,
          },
        ]
      : baseDisplayedPlays;
  const trickIsLeaving =
    room.trickInProgress.length === 0 &&
    heldTrick === null &&
    optimisticPlay === null &&
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
      ? 'text-[#fda4af]'
      : diff === 0
        ? 'text-[#fcd34d]'
        : 'text-[#7dd3fc]';

  // My bid/won values — used by the action strip's big right-side line.
  const myBid = room.bids[myName];
  const myWon = room.tricksWon[myName] ?? 0;

  // Bid-picker density rule: with ≤6 values the picker floats over the
  // felt as an anchored overlay. With 7+ values it wraps to two rows,
  // so it takes its own place in the layout instead (anchoring a tall
  // panel at the felt's bottom edge would hide the side-column tiles)
  // and the felt shrinks to pay for it.
  const isMyBidTurn =
    room.status === 'bidding' &&
    room.playerOrder[room.currentPlayerIndex] === myName &&
    myBid === undefined;
  const bidValueCount = cardsThisRound + 1;
  const inlineBidPanel = isMyBidTurn && bidValueCount >= 7;

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
      <div
        className="rounded-lg px-3 py-1.5 flex items-center justify-between text-[12px] gap-2"
        style={{
          background: 'rgba(20,26,44,.55)',
          border: '1px solid rgba(212,168,67,.28)',
        }}
      >
        <span className="text-navy-200 whitespace-nowrap flex items-center gap-1.5">
          {/* Reactions are only useful during active gameplay — the
              round-end + final scoreboards have a chat box instead. */}
          {room.status !== 'scoring' && room.status !== 'finished' && (
            <Reactions room={room} myName={myName} />
          )}
          <span className="flex flex-col leading-none gap-0.5">
            <span>
              Round{' '}
              <strong className="font-bold text-[13px] text-cream tabular-nums">
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
            className={`text-[10px] font-bold uppercase tracking-[0.14em] ${bidSumTone}`}
            title={`Total bids ${totalBids} of ${cardsThisRound}`}
          >
            {bidSumLabel}
          </span>
        )}
        <span className="text-navy-200 whitespace-nowrap truncate flex items-center gap-1">
          <span>
            Dealer{' '}
            <strong className="font-display font-semibold text-[15px] text-cream">{dealerName}</strong>
            {isDealer ? ' (you)' : ''}
          </span>
          <GameMenu room={room} myName={myName} />
        </span>
      </div>
        );
      })()}

      <DisconnectBanner room={room} players={players} myName={myName} />

      {/* Big transient commentary titles (your turn, streaks, wizard
          kills, ace of spades). Fixed-centered, pointer-events-none. */}
      <CommentaryOverlay room={room} myName={myName} active={showOpponents} />

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
          shortFelt={inlineBidPanel}
          hideTrump={dealingActive}
          isLastRoundNoTrump={
            !room.trumpCard &&
            room.currentRound > 0 &&
            room.currentRound >= room.totalRounds
          }
          centerBanner={
            // pointer-events stay OFF: the winner leads the next trick
            // while this banner covers the drop zone, so it must never
            // swallow a card drop (elementFromPoint skips it).
            winBanner && winnerColor ? (
              <div
                key={winBanner.key}
                className="card-gold px-5 py-2.5 shadow-2xl text-center bg-navy-900/95 backdrop-blur animate-trick-banner"
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

      {/* Bid number picker — floats over the felt for ≤6 values; takes
          its own place in the layout (with a shortened felt) for 7+. */}
      {isMyBidTurn && !inlineBidPanel && <BidModal room={room} myName={myName} />}
      {isMyBidTurn && inlineBidPanel && (
        <div
          className="relative rounded-[10px] p-2.5 px-3 animate-bid-modal-in"
          style={{
            border: '1px solid #d4a843',
            background: 'linear-gradient(180deg,rgba(38,32,20,.92),rgba(10,16,32,.95))',
            boxShadow: '0 0 26px rgba(212,168,67,.35), 0 10px 24px rgba(0,0,0,.6)',
          }}
        >
          <div className="flex items-center gap-2 mb-2">
            <span className="flex-1 h-px bg-gradient-to-r from-transparent to-gold-300/45" />
            <h3 className="text-[10px] uppercase tracking-[0.24em] font-bold text-cream-bright leading-none">
              Place your bid
            </h3>
            <span className="flex-1 h-px bg-gradient-to-l from-transparent to-gold-300/45" />
          </div>
          <BidButtonsBar room={room} myName={myName} />
        </div>
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
              <span className="uppercase tracking-[0.22em] font-bold text-cream-bright text-[11px] animate-pulse">
                YOUR TURN
              </span>
            );
            frame = 'card-gold card-gold-active';
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
          let myBigTone = 'text-steel';
          if (myBid === undefined) {
            myBigLine = '—';
          } else if (room.status === 'bidding') {
            myBigLine = myBid;
            myBigTone = 'text-cream';
          } else {
            myBigLine = `${myWon}/${myBid}`;
            myBigTone =
              myWon > myBid
                ? 'text-[#fda4af]'
                : myWon === myBid
                  ? 'text-[#6ee7b7]'
                  : 'text-[#7dd3fc]';
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
              className={`relative px-3 py-1 min-h-[48px] flex items-stretch transition-shadow ${frame || 'card-gold-subtle'}`}
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
                className={`relative shrink-0 flex items-center justify-end pl-2.5 ml-2 border-l border-gold-300/25 ${myBigTone} font-bold tabular-nums text-[22px] leading-none`}
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
