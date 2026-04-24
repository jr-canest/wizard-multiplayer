import { useState } from 'react';
import type { Card } from '../lib/types';
import { CardImage } from './CardImage';

type Props = {
  hand: Card[] | null;
  legal?: boolean[];
  onPlay?: (index: number) => void;
  isMyTurn?: boolean;
};

type DragState = {
  index: number;
  pointerId: number;
  startX: number;
  startY: number;
  x: number;
  y: number;
  moved: boolean;
};

const CARD_W = 96; // w-24

export function HandDisplay({ hand, legal, onPlay, isMyTurn }: Props) {
  const [drag, setDrag] = useState<DragState | null>(null);

  if (!hand) {
    return (
      <div className="text-navy-200 text-sm text-center py-8">
        Waiting for cards…
      </div>
    );
  }
  if (hand.length === 0) {
    return (
      <div className="text-navy-200 text-sm text-center py-8">
        No cards left.
      </div>
    );
  }

  const count = hand.length;
  const maxFanDeg = Math.min(40, 6 * count);
  const centerIdx = (count - 1) / 2;
  const angleStep = count > 1 ? maxFanDeg / (count - 1) : 0;
  const spread = count <= 5 ? 0.65 : count <= 10 ? 0.5 : 0.35;

  function handlePointerDown(e: React.PointerEvent, i: number) {
    if (!onPlay) return;
    const ok = legal ? legal[i] : true;
    if (!ok) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setDrag({
      index: i,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      moved: false,
    });
  }

  function handlePointerMove(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const dx = e.clientX - drag.startX;
    const dy = e.clientY - drag.startY;
    const moved = drag.moved || dx * dx + dy * dy > 100;
    setDrag({ ...drag, x: e.clientX, y: e.clientY, moved });
  }

  function handlePointerUp(e: React.PointerEvent) {
    if (!drag || e.pointerId !== drag.pointerId) return;
    const { index, moved } = drag;

    let drop: Element | null | undefined = null;
    if (moved) {
      // Hide the dragged node briefly so elementFromPoint returns what's
      // underneath (the trick area) instead of the card itself.
      const node = e.currentTarget as HTMLElement;
      const prevVis = node.style.visibility;
      node.style.visibility = 'hidden';
      const el = document.elementFromPoint(e.clientX, e.clientY);
      drop = el?.closest('[data-drop="trick"]');
      node.style.visibility = prevVis;
    }

    setDrag(null);
    if (!onPlay) return;

    if (moved) {
      if (drop) onPlay(index);
    } else {
      onPlay(index);
    }
  }

  function handlePointerCancel() {
    setDrag(null);
  }

  return (
    <div className="relative h-[180px] select-none">
      <div className="absolute inset-x-0 bottom-0 h-[180px]">
        {hand.map((card, i) => {
          const cardLegal = legal ? legal[i] : true;
          const showGlow = cardLegal && !!isMyTurn;
          const angle = (i - centerIdx) * angleStep;
          const offset = (i - centerIdx) * CARD_W * spread;
          const isDragging = drag?.index === i && drag.moved;

          const cardKey = `${card.kind}-${i}-${
            card.kind === 'standard' ? `${card.suit}${card.rank}` : card.id
          }`;

          // Single DOM node across fan + drag states so pointer capture
          // stays attached and drops land correctly.
          const draggingStyle: React.CSSProperties | undefined =
            isDragging && drag
              ? {
                  position: 'fixed',
                  left: drag.x,
                  top: drag.y,
                  transform: 'translate(-50%, -55%) rotate(0deg)',
                  transformOrigin: 'center center',
                  transition: 'none',
                  zIndex: 1000,
                  touchAction: 'none',
                  willChange: 'transform, left, top',
                }
              : undefined;

          const fanStyle: React.CSSProperties = {
            position: 'absolute',
            left: '50%',
            bottom: 0,
            transform: `translateX(calc(-50% + ${offset}px)) rotate(${angle}deg)`,
            transformOrigin: 'bottom center',
            transition: 'transform 0.2s ease-out',
            zIndex: i,
            touchAction: 'none',
          };

          return (
            <div
              key={cardKey}
              onPointerDown={(e) => handlePointerDown(e, i)}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerCancel}
              className={[
                'rounded-md',
                cardLegal ? 'cursor-grab active:cursor-grabbing' : '',
                showGlow && !isDragging
                  ? 'ring-4 ring-gold-300 shadow-[0_0_20px_rgba(254,205,70,0.7)] animate-[pulse_2s_ease-in-out_infinite]'
                  : '',
                isDragging
                  ? 'ring-4 ring-gold-300 shadow-[0_0_30px_rgba(254,205,70,0.9)]'
                  : '',
              ].join(' ')}
              style={draggingStyle ?? fanStyle}
            >
              <CardImage card={card} size="lg" faded={!cardLegal} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
