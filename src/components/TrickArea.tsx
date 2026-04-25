import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Card, Suit } from '../lib/types';
import { CardImage } from './CardImage';
import { playerColor, type PlayerColor } from '../lib/playerColors';
import { winningPlayIndex } from '../game/trickWinner';

type Play = { playerName: string; card: Card; playOrder?: number };

type Props = {
  plays: Play[];
  playerOrder: string[];
  trumpSuit: Suit | null;
  isMyTurn: boolean;
};

const CARD_W = 96;
const CARD_H = 135;
const FALLBACK_W = 280;
const ROW_OFFSET = 58;

type Slot = { x: number; y: number; rot: number };

function noise(seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return ((v - Math.floor(v)) - 0.5) * 2;
}

function buildSlots(playerCount: number, fanW: number): Slot[] {
  const N = Math.max(1, playerCount);
  const useTwoRows = N >= 4;
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
      const seed = seedBase + i + 1;
      return {
        x: (i - center) * stepX + noise(seed) * 4,
        y: y + noise(seed * 2) * 5,
        rot: noise(seed * 3) * 4,
      };
    });
  }

  return [
    ...rowSlots(topCount, useTwoRows ? -ROW_OFFSET : 0, 100),
    ...rowSlots(bottomCount, ROW_OFFSET, 200),
  ];
}

type TrickCardProps = {
  card: Card;
  slotX: number;
  slotY: number;
  slotRot: number;
  zIndex: number;
  color: PlayerColor;
  isWinning: boolean;
};

const TrickCard = memo(function TrickCard({
  card,
  slotX,
  slotY,
  slotRot,
  zIndex,
  color,
  isWinning,
}: TrickCardProps) {
  return (
    // 3 wrappers, each with one job — the play-in animation lives on a
    // dedicated middle div whose className never changes, so unrelated state
    // (winning highlight flipping) can't restart the entrance animation.
    //   outer: slot position + z-stacking
    //   middle: play-in animation only
    //   inner: card visuals + winning pulse toggle
    <div
      className="absolute left-1/2 top-1/2"
      style={{
        transform: `translate(calc(-50% + ${slotX}px), calc(-50% + ${slotY}px)) rotate(${slotRot}deg)`,
        zIndex,
      }}
    >
      <div className="animate-play-in">
        <div
          className={`rounded-md ring-4 ${color.ring} ${color.glow} bg-navy-900 ${
            isWinning ? 'animate-winning' : ''
          }`}
        >
          <CardImage card={card} size="lg" />
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

  const winnerSlot = winnerIdx >= 0 ? slots[winnerIdx] : null;

  return (
    <div
      data-drop="trick"
      className={`card-gold-subtle flex-1 p-3 h-[360px] border-2 rounded-xl transition-shadow overflow-hidden ${dropGlow}`}
    >
      {plays.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <span className="text-navy-300 text-xs text-center px-2">
            {isMyTurn ? 'Tap or drag a card here' : 'Trick area'}
          </span>
        </div>
      ) : (
        <div ref={fanRef} className="relative h-full w-full">
          {plays.map((p, i) => {
            const slot = slots[i] ?? { x: 0, y: 0, rot: 0 };
            return (
              <TrickCard
                key={p.playOrder ?? `${p.playerName}-${i}`}
                card={p.card}
                slotX={slot.x}
                slotY={slot.y}
                slotRot={slot.rot}
                // Pure play-order stacking: 1st played at the bottom of the
                // pile, last on top. Winning is signalled by ring + badge.
                zIndex={100 + i}
                color={playerColor(p.playerName, playerOrder)}
                isWinning={i === winnerIdx}
              />
            );
          })}

          {winnerSlot && (
            <div
              className="absolute left-1/2 top-1/2 z-[300] pointer-events-none"
              style={{
                transform: `translate(calc(-50% + ${winnerSlot.x}px), calc(-50% + ${winnerSlot.y - CARD_H / 2 - 16}px))`,
              }}
            >
              <span className="bg-gold-300 text-navy-900 text-[10px] font-black uppercase tracking-[0.15em] rounded px-2 py-0.5 shadow-lg whitespace-nowrap">
                Winning
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
