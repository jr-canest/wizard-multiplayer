import { TrickArea } from './TrickArea';
import { OpponentTile } from './OpponentTile';
import { CardImage } from './CardImage';
import { distributeSeats, viewerSlotIndex } from '../lib/seats';
import type { Suit, Card } from '../lib/types';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';

const SUIT_GLYPH: Record<Suit, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};
const SUIT_COLOR: Record<Suit, string> = {
  H: 'text-rose-300',
  D: 'text-sky-300',
  C: 'text-emerald-300',
  S: 'text-navy-100',
};

type Props = {
  room: RoomSnapshot;
  players: PlayerSnapshot[];
  myName: string;
  trickPlays: Array<{ playerName: string; card: Card; playOrder?: number }>;
  trickIsLeaving: boolean;
  isMyTurn: boolean;
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
}: Props) {
  const opponents = room.playerOrder.filter((n) => n !== myName);
  const oppCount = opponents.length;
  const { left, top, right } = distributeSeats(oppCount);

  const playersByName = new Map(players.map((p) => [p.name, p]));

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
              <div key={name} className="w-[80px] shrink-0">
                <OpponentTile
                  room={room}
                  myName={myName}
                  playerName={name}
                  playerMeta={playersByName.get(name)}
                  compact
                />
              </div>
            ) : (
              <div key={`top-${i}`} className="w-[80px]" />
            ),
          )}
        </div>
      )}

      {/* Main row: left col | table | right col */}
      <div className="flex items-stretch gap-1">
        {/* Left column */}
        {leftCol.length > 0 && (
          <div className="flex flex-col justify-around gap-1 w-[80px] shrink-0">
            {leftCol.map((name, i) =>
              name ? (
                <OpponentTile
                  key={name}
                  room={room}
                  myName={myName}
                  playerName={name}
                  playerMeta={playersByName.get(name)}
                  compact
                />
              ) : (
                <div key={`left-${i}`} />
              ),
            )}
          </div>
        )}

        {/* Table center: trick area + trump in middle */}
        <div className="flex-1 relative card-gold-subtle border-2 border-gold-700/50 rounded-xl overflow-hidden p-2 min-h-[340px]">
          {/* Trump card centered behind the trick fan */}
          <TrumpCenter
            trumpCard={room.trumpCard}
            trumpSuit={room.trumpSuit}
            awaitingTrumpChoice={room.awaitingTrumpChoice}
          />
          {/* Trick fan (current Phase 1 — still arc layout) */}
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
        </div>

        {/* Right column */}
        {rightCol.length > 0 && (
          <div className="flex flex-col justify-around gap-1 w-[78px] shrink-0">
            {rightCol.map((name, i) =>
              name ? (
                <OpponentTile
                  key={name}
                  room={room}
                  myName={myName}
                  playerName={name}
                  playerMeta={playersByName.get(name)}
                  compact
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
}: {
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  awaitingTrumpChoice: boolean;
}) {
  const labelSuit =
    trumpSuit !== null ? (
      <span className={`${SUIT_COLOR[trumpSuit]} drop-shadow-[0_1px_2px_rgba(0,0,0,0.85)]`}>
        {SUIT_GLYPH[trumpSuit]}
      </span>
    ) : null;

  return (
    <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
      <div className="flex flex-col items-center gap-1">
        {trumpCard ? (
          <CardImage card={trumpCard} size="md" />
        ) : (
          <div className="w-16 h-[90px] rounded-md border border-dashed border-navy-300/60 flex items-center justify-center text-navy-300 text-[10px] bg-navy-900/40">
            —
          </div>
        )}
        <span className="text-[9px] uppercase tracking-[0.2em] font-bold text-gold-200 bg-navy-900/85 rounded px-1.5 py-0.5 flex items-center gap-1 leading-none">
          TRUMP
          {awaitingTrumpChoice ? (
            <span className="text-gold-300">…</span>
          ) : labelSuit ? (
            <span className="text-base leading-none">{labelSuit}</span>
          ) : (
            <span className="text-navy-200 normal-case tracking-normal">none</span>
          )}
        </span>
      </div>
    </div>
  );
}
