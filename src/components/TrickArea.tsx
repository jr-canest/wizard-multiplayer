import { memo, useEffect, useRef, useState } from 'react';
import type { Card, Suit } from '../lib/types';
import { CardImage } from './CardImage';
import { colorForViewer, type PlayerColor } from '../lib/playerColors';
import { winningPlayIndex } from '../game/trickWinner';
import { playerSeatInfo, trickSlotForSide } from '../lib/seats';

type Play = { playerName: string; card: Card; playOrder?: number };

type Props = {
  plays: Play[];
  playerOrder: string[];
  trumpSuit: Suit | null;
  isMyTurn: boolean;
  myName: string;
  isLeaving?: boolean;
};

const FALLBACK_W = 240;
const FALLBACK_H = 320;

function noise(seed: number): number {
  const v = Math.sin(seed * 9301 + 49297) * 233280;
  return ((v - Math.floor(v)) - 0.5) * 2;
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
  /** Offsets toward the winner's seat — used as the trick-collect target
   * when isLeaving. Cards then translate to the winner before fading. */
  leaveDx?: number;
  leaveDy?: number;
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
  leaveDx = 0,
  leaveDy = 0,
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
      <div
        className={isLeaving ? 'animate-trick-leave' : ''}
        style={
          isLeaving
            ? ({
                ['--lx']: `${leaveDx}px`,
                ['--ly']: `${leaveDy}px`,
              } as React.CSSProperties)
            : undefined
        }
      >
      <div className="animate-play-in">
        <div
          className={`relative rounded-md ring-2 ${color.ring} ${color.glow} bg-navy-900`}
        >
          <CardImage card={card} size="md" />
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
  const [fanH, setFanH] = useState(FALLBACK_H);

  useEffect(() => {
    const el = fanRef.current;
    if (!el) return;
    const update = () => {
      const w = Math.round((el.clientWidth || FALLBACK_W) / 4) * 4;
      const h = Math.round((el.clientHeight || FALLBACK_H) / 4) * 4;
      setFanW((prev) => (prev === w ? prev : w));
      setFanH((prev) => (prev === h ? prev : h));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div
      ref={fanRef}
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
        <div className="relative h-full w-full">
          {(() => {
            // Winner's seat slot — used as the collect-target when the
            // trick is leaving (cards animate toward the winner).
            const winnerName =
              winnerIdx >= 0 ? plays[winnerIdx]?.playerName : null;
            const winnerSlot = (() => {
              if (!winnerName) return null;
              const ws = playerSeatInfo(winnerName, myName, playerOrder);
              return trickSlotForSide(
                ws.side,
                ws.index,
                ws.totalOnSide,
                fanW,
                fanH,
              );
            })();
            return plays.map((p, i) => {
              // Slot is determined by the player's seat (which side of
              // the table they sit on, viewer-rotated). Stacking still
              // uses play order so the most recent card sits on top.
              const seat = playerSeatInfo(p.playerName, myName, playerOrder);
              const base = trickSlotForSide(
                seat.side,
                seat.index,
                seat.totalOnSide,
                fanW,
                fanH,
              );
              const seedBase =
                p.playerName.charCodeAt(0) * 13 + p.playerName.length;
              const slot = {
                x: base.x + noise(seedBase) * 4,
                y: base.y + noise(seedBase * 2) * 4,
                rot: base.rot + noise(seedBase * 3) * 4,
              };
              const leaveDx = winnerSlot ? winnerSlot.x - slot.x : 0;
              const leaveDy = winnerSlot ? winnerSlot.y - slot.y : 0;
              return (
                <TrickCard
                  key={p.playerName}
                  card={p.card}
                  slotX={slot.x}
                  slotY={slot.y}
                  slotRot={slot.rot}
                  zIndex={100 + i}
                  color={colorForViewer(p.playerName, myName, playerOrder)}
                  isWinning={i === winnerIdx}
                  isLeaving={isLeaving}
                  leaveDx={leaveDx}
                  leaveDy={leaveDy}
                />
              );
            });
          })()}
        </div>
      )}
    </div>
  );
}
