import type { ReactNode } from 'react';
import { TrickArea } from './TrickArea';
import { OpponentTile } from './OpponentTile';
import { CardImage } from './CardImage';
import { OverlayBanner } from './OverlayBanner';
import { distributeSeats, viewerSlotIndex } from '../lib/seats';
import type { Suit, Card } from '../lib/types';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';

const SUIT_GLYPH: Record<Suit, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};
// Standard playing-card colors. On the dark navy table bg, "black"
// suits render as bright neutral so they read at a glance.
const SUIT_COLOR: Record<Suit, string> = {
  H: 'text-rose-400',
  D: 'text-rose-400',
  C: 'text-navy-50',
  S: 'text-navy-50',
};

type Props = {
  room: RoomSnapshot;
  players: PlayerSnapshot[];
  myName: string;
  trickPlays: Array<{ playerName: string; card: Card; playOrder?: number }>;
  trickIsLeaving: boolean;
  isMyTurn: boolean;
  /** An undo vote is open: the table is stopped, so no turn cues. */
  paused?: boolean;
  /** True while the two-row bid picker sits inline below the table —
   * the felt gives up height to pay for it. */
  shortFelt?: boolean;
  hideTrump?: boolean;
  /** When true the trump slot shows "LAST ROUND / NO TRUMP" instead of
   * the trump card. */
  isLastRoundNoTrump?: boolean;
  /** Optional content rendered absolutely-centered over the trick area
   * (used for the "X won" banner). */
  centerBanner?: ReactNode;
};

/**
 * Table-style layout. Opponents sit on three sides (top / left / right);
 * the trump card sits face-up in the center; played trick cards arc
 * around it. The local viewer is always at the bottom (outside the
 * table — their hand lives below this component).
 */
export function Table({
  room,
  players,
  myName,
  trickPlays,
  trickIsLeaving,
  isMyTurn,
  paused = false,
  shortFelt = false,
  hideTrump = false,
  isLastRoundNoTrump = false,
  centerBanner,
}: Props) {
  const opponents = room.playerOrder.filter((n) => n !== myName);
  const oppCount = opponents.length;
  const { left, top, right } = distributeSeats(oppCount);

  const playersByName = new Map(players.map((p) => [p.name, p]));

  // Felt edge carries the turn signal too, so the answer to "is it me?"
  // is readable from the middle of the screen where the cards are, not
  // only from the strip under the hand. Gold halo = mine, quiet steel
  // edge = someone else's, nothing at all between rounds.
  const inTurnPhase =
    !paused && (room.status === 'bidding' || room.status === 'playing');
  const activeName = inTurnPhase
    ? room.playerOrder[room.currentPlayerIndex]
    : null;
  const feltTurnClass =
    activeName === null
      ? ''
      : activeName === myName
        ? 'felt-turn-mine'
        : 'felt-turn-theirs';

  // Slot index → player. Slot 0 = me; slots 1..N-1 = others clockwise.
  // We populate sides from the seatPositions order:
  //   slots 1..left          → left column, bottom-up (so DOM top-to-bottom is reversed)
  //   slots left+1..left+top → top row, left-to-right
  //   slots left+top+1..N-1  → right column, top-to-bottom
  const slotPlayers: Array<string | null> = Array(room.playerOrder.length).fill(null);
  for (const name of opponents) {
    const slot = viewerSlotIndex(name, myName, room.playerOrder);
    slotPlayers[slot] = name;
  }

  const leftSlots = slotPlayers.slice(1, 1 + left);
  const topSlots = slotPlayers.slice(1 + left, 1 + left + top);
  const rightSlots = slotPlayers.slice(1 + left + top, 1 + left + top + right);

  // DOM order: left col rendered top-to-bottom, but clockwise fills
  // bottom-up, so reverse.
  const leftCol = [...leftSlots].reverse();
  const topRow = topSlots;
  const rightCol = rightSlots;

  return (
    <div className="space-y-1">
      {/* Top row of opponent tiles — centered, fixed-width like the side cols. */}
      {topRow.length > 0 && (
        <div className="flex justify-center gap-1">
          {topRow.map((name, i) =>
            name ? (
              <div key={name} className="w-[62px] shrink-0">
                <OpponentTile
                  room={room}
                  myName={myName}
                  playerName={name}
                  playerMeta={playersByName.get(name)}
                  paused={paused}
                />
              </div>
            ) : (
              <div key={`top-${i}`} className="w-[62px]" />
            ),
          )}
        </div>
      )}

      {/* Main row: left col | table | right col */}
      <div className="flex items-stretch gap-1">
        {/* Left column */}
        {leftCol.length > 0 && (
          <div className="flex flex-col justify-around gap-1 w-[62px] shrink-0">
            {leftCol.map((name, i) =>
              name ? (
                <OpponentTile
                  key={name}
                  room={room}
                  myName={myName}
                  playerName={name}
                  playerMeta={playersByName.get(name)}
                  paused={paused}
                />
              ) : (
                <div key={`left-${i}`} />
              ),
            )}
          </div>
        )}

        {/* Table center: trick area + trump in middle */}
        <div
          data-trick-area-frame
          className={`felt ${feltTurnClass} flex-1 relative overflow-hidden p-2 ${
            shortFelt ? 'min-h-[210px]' : 'min-h-[306px]'
          }`}
        >
          {/* Trump card centered behind the trick fan. Hidden during the
              deal animation so the deal can finish before revealing it. */}
          <TrumpCenter
            trumpCard={room.trumpCard}
            trumpSuit={room.trumpSuit}
            awaitingTrumpChoice={room.awaitingTrumpChoice}
            hidden={hideTrump}
            lastRoundNoTrump={isLastRoundNoTrump}
          />
          {/* Trick fan */}
          <div className="relative h-full w-full">
            <TrickArea
              plays={trickPlays}
              playerOrder={room.playerOrder}
              trumpSuit={room.trumpSuit}
              isMyTurn={isMyTurn && room.status === 'playing'}
              myName={myName}
              isLeaving={trickIsLeaving}
            />
          </div>
          {/* Transient announcements (reactions, undo, votes, last-round)
              docked at top-left of the trick area. */}
          <OverlayBanner room={room} myName={myName} />
          {/* Centered "X won" banner. */}
          {centerBanner && (
            <div className="absolute inset-0 z-[300] flex items-center justify-center pointer-events-none">
              {centerBanner}
            </div>
          )}
        </div>

        {/* Right column */}
        {rightCol.length > 0 && (
          <div className="flex flex-col justify-around gap-1 w-[62px] shrink-0">
            {rightCol.map((name, i) =>
              name ? (
                <OpponentTile
                  key={name}
                  room={room}
                  myName={myName}
                  playerName={name}
                  playerMeta={playersByName.get(name)}
                  paused={paused}
                />
              ) : (
                <div key={`right-${i}`} />
              ),
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function TrumpCenter({
  trumpCard,
  trumpSuit,
  awaitingTrumpChoice,
  hidden = false,
  lastRoundNoTrump = false,
}: {
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  awaitingTrumpChoice: boolean;
  hidden?: boolean;
  lastRoundNoTrump?: boolean;
}) {
  const labelSuit =
    trumpSuit !== null ? (
      <span className={`${SUIT_COLOR[trumpSuit]} drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]`}>
        {SUIT_GLYPH[trumpSuit]}
      </span>
    ) : null;

  return (
    <div
      className={
        'absolute inset-0 flex items-center justify-center pointer-events-none z-[200] ' +
        (hidden
          ? 'opacity-0'
          : 'opacity-100 transition-opacity duration-300')
      }
    >
      {/* Trump frame: ~30% smaller card (sm = 48×67) inside a gold-bordered
          panel that wraps the card AND the TRUMP label. Trick cards are
          positioned to never enter this frame; z-[200] keeps the trump
          on top of any trick card that does drift close. */}
      <div className="flex flex-col items-center gap-1 p-1 rounded-lg border border-gold-300/55 shadow-[0_0_20px_rgba(212,168,67,0.2)] bg-[rgba(7,20,17,0.55)]">
        {trumpCard ? (
          <CardImage
            card={trumpCard}
            size="sm"
            className="shadow-[0_0_0_1px_rgba(226,197,121,0.7)]"
          />
        ) : lastRoundNoTrump ? (
          // No-trump final round: card slot reads "LAST ROUND" — the
          // trump label below switches to "NO TRUMP".
          <div className="w-12 h-[67px] rounded-md border border-dashed border-rose-500/60 flex flex-col items-center justify-center text-rose-200 text-[9px] uppercase tracking-[0.1em] font-black leading-tight bg-navy-900/55 text-center">
            <span>LAST</span>
            <span>ROUND</span>
          </div>
        ) : (
          <div className="w-12 h-[67px] rounded-md border border-dashed border-gold-300/50 flex items-center justify-center text-navy-300 text-[10px] bg-navy-900/40">
            —
          </div>
        )}
        {/* Label width matches the card. Jester flip + last-round both
            mean no trump suit this round — the label reads NO TRUMP so
            it's obvious at a glance. */}
        {(() => {
          const isJesterFlip =
            trumpCard !== null && trumpCard.kind === 'jester';
          const noTrump = lastRoundNoTrump || isJesterFlip;
          if (noTrump) {
            return (
              <span className="w-12 text-[8px] uppercase tracking-[0.06em] font-black text-rose-200 leading-none text-center whitespace-nowrap">
                NO TRUMP
              </span>
            );
          }
          return (
            <span className="w-12 text-[8px] uppercase tracking-[0.1em] font-bold text-gold-text flex items-center justify-center gap-0.5 leading-none">
              <span>TRUMP</span>
              {awaitingTrumpChoice ? (
                <span className="text-gold-300">…</span>
              ) : labelSuit ? (
                <span className="text-[12px] leading-none">{labelSuit}</span>
              ) : null}
            </span>
          );
        })()}
      </div>
    </div>
  );
}
