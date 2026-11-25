import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { TILE_REACTIONS } from '../game/engine';
import { connectionFor, type Cheer } from '../lib/socket';
import { openShameVote } from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { shortName } from '../lib/shortName';
import { getUIZoom } from '../hooks/useUIScale';
import type { RoomSnapshot } from '../hooks/useRoom';

const SHAME = '💀';

/**
 * The little picker that opens when you tap a player's tile mid-game
 * (Jorge, 2026-11-25): clap, shock, and the skull, which opens the shame
 * vote on that player. Docked under the tile (above it near the bottom of
 * the screen), kept on screen, closed by any outside touch. Computers get
 * the two reactions only.
 */
export function TileReactionPicker({
  room,
  target,
  anchor,
  onClose,
}: {
  room: RoomSnapshot;
  target: string;
  anchor: HTMLElement;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const canShame =
    !isBot(room, target) && room.status !== 'finished' && room.status !== 'lobby' &&
    !room.pendingShame && !room.pendingVote && !room.pendingUndo?.requested;

  useLayoutEffect(() => {
    const zoom = getUIZoom();
    const r = anchor.getBoundingClientRect();
    const w = (ref.current?.offsetWidth ?? 120);
    const h = (ref.current?.offsetHeight ?? 40);
    const vw = window.innerWidth / zoom;
    const vh = window.innerHeight / zoom;
    const left = Math.min(Math.max(6, (r.left + r.width / 2) / zoom - w / 2), vw - w - 6);
    const below = r.bottom / zoom + 6;
    const top = below + h > vh - 6 ? r.top / zoom - h - 6 : below;
    setPos({ left, top });
  }, [anchor, canShame]);

  useEffect(() => {
    function down(e: PointerEvent) {
      if (ref.current?.contains(e.target as Node)) return;
      onClose();
    }
    // Next tick: the tap that opened it must not close it.
    const id = window.setTimeout(() => document.addEventListener('pointerdown', down), 0);
    return () => { window.clearTimeout(id); document.removeEventListener('pointerdown', down); };
  }, [onClose]);

  const btn = 'w-9 h-9 rounded-full text-[20px] leading-none flex items-center justify-center active:scale-90 transition';
  return createPortal(
    <div
      ref={ref}
      role="menu"
      aria-label={`React to ${target}`}
      className="fixed z-[460] inline-flex items-center gap-0.5 rounded-full border border-gold-300/60 bg-navy-900 px-1 py-0.5 shadow-xl animate-overlay-banner-inline"
      style={{ left: pos?.left ?? -9999, top: pos?.top ?? -9999 }}
    >
      {TILE_REACTIONS.map((e) => (
        <button
          key={e}
          type="button"
          aria-label={`Send ${e} to ${target}`}
          className={btn}
          onClick={() => { connectionFor(room.code).cheer(target, e); onClose(); }}
        >
          {e}
        </button>
      ))}
      {canShame && (
        <>
          <span className="w-px h-5 bg-gold-700/40 mx-0.5" aria-hidden="true" />
          <button
            type="button"
            aria-label={`Shame vote on ${target}`}
            className={btn}
            onClick={() => { void openShameVote(room.code, target).catch(() => {}); onClose(); }}
          >
            {SHAME}
          </button>
        </>
      )}
    </div>,
    document.body,
  );
}

/**
 * The reactions landing on one player: each emoji pops, drifts up and
 * fades, with the sender's name under it. Sits over the tile (or, for
 * your own, at the bottom of the felt) and never takes touches.
 */
export function CheerBurst({
  cheers,
  playerOrder,
  myName,
  big = false,
}: {
  cheers: Cheer[];
  playerOrder: string[];
  myName: string;
  big?: boolean;
}) {
  if (cheers.length === 0) return null;
  return (
    <span className="absolute inset-0 z-[40] pointer-events-none flex items-center justify-center" aria-live="polite">
      {cheers.map((c, i) => (
        <span
          key={c.id}
          className="absolute flex flex-col items-center tile-cheer"
          style={{ marginLeft: (i - (cheers.length - 1) / 2) * (big ? 46 : 20) }}
        >
          <span className={`${big ? 'text-[40px]' : 'text-[28px]'} leading-none drop-shadow-[0_2px_6px_rgba(0,0,0,.8)]`}>{c.emoji}</span>
          <span className="mt-0.5 px-1 rounded-full bg-navy-900/90 text-[8px] font-bold uppercase tracking-[0.1em] text-navy-100 whitespace-nowrap leading-[13px]">
            {c.from === myName ? 'you' : shortName(c.from, playerOrder, 8)}
          </span>
        </span>
      ))}
    </span>
  );
}
