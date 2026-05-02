import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Suit } from '../lib/types';
import { CardImage } from './CardImage';
import { colorForViewer, type PlayerColor } from '../lib/playerColors';
import { winningPlayIndex } from '../game/trickWinner';

type Play = { playerName: string; card: Card; playOrder?: number };

type Props = {
  plays: Play[];
  playerOrder: string[];
  trumpSuit: Suit | null;
  isMyTurn: boolean;
  myName: string;
  isLeaving?: boolean;
};

const CARD_W = 96;
const FALLBACK_W = 280;
const ROW_OFFSET = 44;

type Slot = { x: number; y: number; rot: number };

function noise(seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return ((v - Math.floor(v)) - 0.5) * 2;
}

function buildSlots(playerCount: number, fanW: number): Slot[] {
  const N = Math.max(1, playerCount);
  // Use the 2-row layout starting at 3 players so the local viewer always
  // sits at the bottom (matches Wizard's "you, the table" mental model).
  const useTwoRows = N >= 3;
  const topCount = useTwoRows ? Math.ceil(N / 2) : N;
  const bottomCount = useTwoRows ? N - topCount : 0;
  const maxStretch = Math.max(80, fanW - CARD_W - 8);

  function rowSlots(count: number, y: number, seedBase: number): Slot[] {
    if (count === 0) return [];
    const stepX =
      count <= 1
        ? 0
        : Math.max(56, Math.min(110, maxStretch / (count - 1)));
    const center = (count - 1) / 2;
    return Array.from({ length: count }, (_, i) => {
      // Stable per-slot seed (no round dependency) — keeps each player's
      // spot rock-stable across rounds with a tiny per-slot jitter for
      // visual variety.
      const seed = seedBase + i + 1;
      return {
        x: (i - center) * stepX + noise(seed) * 5,
        y: y + noise(seed * 2) * 6,
        rot: noise(seed * 3) * 8,
      };
    });
  }

  const topRow = rowSlots(topCount, useTwoRows ? -ROW_OFFSET : 0, 100);
  const bottomRow = rowSlots(bottomCount, ROW_OFFSET, 200);

  if (!useTwoRows) {
    // Single row (N <= 2): rightmost = slot 0 (me), going left clockwise.
    return [...topRow].reverse();
  }
  // Two rows: clockwise from bottom-right (me).
  //   bottom-row reversed (right-to-left): SE → ... → SW
  //   top-row in order (left-to-right):    NW → ... → NE
  // So slot 0 = SE (me), slot 1 = next clockwise (player to my left), etc.
  return [...bottomRow.reverse(), ...topRow];
}

type TrickCardProps = {
  card: Card;
  slotX: number;
  slotY: number;
  slotRot: number;
  zIndex: number;
  color: PlayerColor;
  isWinning: boolean;
  isLeaving?: boolean;
};

const TrickCard = memo(function TrickCard({
  card,
  slotX,
  slotY,
  slotRot,
  zIndex,
  color,
  isWinning,
  isLeaving,
}: TrickCardProps) {
  return (
    // 4 wrappers, each with one job — the play-in animation lives on a
    // dedicated div whose className never changes, so unrelated state
    // (winning highlight flipping) can't restart the entrance animation.
    //   outer: slot position + z-stacking
    //   leave: trick-leave animation when cleared (added via class swap)
    //   play:  play-in animation only
    //   inner: card visuals + winning pulse toggle
    <div
      className="absolute left-1/2 top-1/2"
      style={{
        transform: `translate(calc(-50% + ${slotX}px), calc(-50% + ${slotY}px)) rotate(${slotRot}deg)`,
        zIndex,
      }}
    >
      <div className={isLeaving ? 'animate-trick-leave' : ''}>
      <div className="animate-play-in">
        <div
          className={`relative rounded-md ring-2 ${color.ring} ${color.glow} bg-navy-900`}
        >
          <CardImage card={card} size="lg" />
          {isWinning && (
            <div className="absolute inset-0 rounded-md pointer-events-none animate-winning-inner z-[5]" />
          )}
          {isWinning && (
            <div
              className="absolute -top-3 -right-2 z-10 w-8 h-8 rounded-full bg-black/55 backdrop-blur-[2px] flex items-center justify-center animate-crown-pop pointer-events-none select-none"
              title="Winning card"
            >
              <span
                className="text-gold-300 text-2xl leading-none"
                style={{
                  textShadow:
                    '0 0 4px rgba(254,205,70,0.9), 0 1px 2px rgba(0,0,0,0.9)',
                }}
              >
                ♛
              </span>
            </div>
          )}
        </div>
      </div>
      </div>
    </div>
  );
});

export function TrickArea({
  plays,
  playerOrder,
  trumpSuit,
  isMyTurn,
  myName,
  isLeaving = false,
}: Props) {
  const dropGlow = isMyTurn
    ? 'border-gold-400 shadow-[inset_0_0_24px_rgba(254,205,70,0.25)]'
    : 'border-transparent';

  const winnerIdx = plays.length > 0 ? winningPlayIndex(plays, trumpSuit) : -1;

  const fanRef = useRef<HTMLDivElement>(null);
  const [fanW, setFanW] = useState(FALLBACK_W);

  useEffect(() => {
    const el = fanRef.current;
    if (!el) return;
    const update = () => {
      // Round to a stable bucket so subpixel resize jitter doesn't trigger
      // re-layout of every existing card.
      const next = Math.round((el.clientWidth || FALLBACK_W) / 4) * 4;
      setFanW((prev) => (prev === next ? prev : next));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const slots = useMemo(
    () => buildSlots(playerOrder.length, fanW),
    [playerOrder.length, fanW],
  );

  // Slot index per player. Slot 0 is the viewer (bottom-right in 2-row
  // layouts), and remaining slots fill clockwise around the table —
  // matching Wizard's turn order (player to your left plays first).
  // playerOrder is the canonical clockwise seating, so player k clockwise
  // from me sits at slot k.
  const myIdx = playerOrder.indexOf(myName);
  function viewerSlotIndex(playerName: string): number {
    const seatIdx = playerOrder.indexOf(playerName);
    if (seatIdx < 0) return 0;
    if (myIdx < 0) return seatIdx;
    const N = playerOrder.length;
    return (seatIdx - myIdx + N) % N;
  }

  return (
    <div
      data-drop="trick"
      className={`absolute inset-0 transition-shadow ${dropGlow}`}
    >
      {plays.length === 0 ? (
        <div className="h-full flex items-end justify-center pb-2">
          <span className="text-navy-300 text-[11px] text-center px-2">
            {isMyTurn ? 'Tap or drag a card here' : ''}
          </span>
        </div>
      ) : (
        <div ref={fanRef} className="relative h-full w-full">
          {plays.map((p, i) => {
            // Slot is determined by the player's seat (viewer-rotated),
            // NOT by play order. Stacking still uses play order so the
            // most recently played card sits on top.
            const slot =
              slots[viewerSlotIndex(p.playerName)] ?? { x: 0, y: 0, rot: 0 };
            return (
              <TrickCard
                // Stable per-player key — survives the source flip from
                // trickInProgress (has playOrder) to held trickHistory
                // entry (no playOrder), which previously remounted every
                // card and re-fired the play-in animation on all of them.
                key={p.playerName}
                card={p.card}
                slotX={slot.x}
                slotY={slot.y}
                slotRot={slot.rot}
                // Pure play-order stacking: 1st played at the bottom of the
                // pile, last on top. Winning is signalled by ring + badge.
                zIndex={100 + i}
                color={colorForViewer(p.playerName, myName, playerOrder)}
                isWinning={i === winnerIdx}
                isLeaving={isLeaving}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
