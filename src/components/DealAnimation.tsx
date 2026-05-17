import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { cardBackUrl } from '../lib/cardImages';
import { getUIZoom } from '../hooks/useUIScale';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
  /** Optional: notified true when the animation starts, false when it ends.
   * Lets the parent hide real cards/trump until the deal is "done". */
  onActiveChange?: (active: boolean) => void;
};

const SHUFFLE_MS = 500;
const DEAL_PER_CARD_MS = 70; // stagger between cards
const DEAL_FLIGHT_MS = 480; // single card travel time
const TOTAL_PADDING_MS = 250;

type Frame = {
  origin: { x: number; y: number };
  targets: Array<{ x: number; y: number; rot: number; delay: number }>;
};

function findPlayerEl(name: string): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector(
    `[data-player="${(window.CSS && CSS.escape ? CSS.escape(name) : name)}"]`,
  );
}

/**
 * Plays a quick shuffle + deal animation whenever a new round begins.
 * Cards are face-down (using cardBackUrl), originate at the dealer's
 * tile, briefly "shuffle" in place, then fly out to every other player
 * in a staggered burst. Pure visual flair — never blocks gameplay.
 */
export function DealAnimation({ room, myName, onActiveChange }: Props) {
  const [activeKey, setActiveKey] = useState(0);
  const [frame, setFrame] = useState<Frame | null>(null);
  const prevRoundRef = useRef(room.currentRound);
  const onActiveRef = useRef(onActiveChange);
  // Keep the ref in sync with the latest callback. Writing a ref during
  // render is intentional — the alternative (useEffect) would lag a
  // frame and the layout-effect below would read the stale value.
  // eslint-disable-next-line react-hooks/refs
  onActiveRef.current = onActiveChange;

  // Synchronous detection so we can hide the just-arrived cards BEFORE
  // the browser paints them. The DOM measurement still happens in a
  // requestAnimationFrame to give the new tiles a chance to lay out.
  useLayoutEffect(() => {
    const next = room.currentRound;
    if (next > prevRoundRef.current && next >= 1) {
      // Hide cards / trump immediately (parent listens via onActiveChange).
      onActiveRef.current?.(true);
      const raf = requestAnimationFrame(() => {
        const dealerName = room.playerOrder[room.dealerIndex];
        const dealerEl = findPlayerEl(dealerName);
        if (!dealerEl) return;
        // body { zoom } scales fixed children too — divide rect coords by
        // the zoom so the cards anchor where the player tiles actually
        // sit on screen (see BidModal note).
        const zoom = getUIZoom();
        const dr = dealerEl.getBoundingClientRect();
        const origin = {
          x: (dr.left + dr.width / 2) / zoom,
          y: (dr.top + dr.height / 2) / zoom,
        };
        const others = room.playerOrder
          .filter((n) => n !== dealerName)
          .map((n, i) => {
            const el = findPlayerEl(n);
            if (!el) return null;
            const r = el.getBoundingClientRect();
            return {
              x: (r.left + r.width / 2) / zoom - origin.x,
              y: (r.top + r.height / 2) / zoom - origin.y,
              rot: ((i % 5) - 2) * 4,
              delay: SHUFFLE_MS + i * DEAL_PER_CARD_MS,
            };
          })
          .filter((t): t is NonNullable<typeof t> => t !== null);
        if (others.length === 0) return;
        setFrame({ origin, targets: others });
        setActiveKey((k) => k + 1);
      });
      prevRoundRef.current = next;
      return () => cancelAnimationFrame(raf);
    }
    prevRoundRef.current = next;
  }, [room.currentRound, room.dealerIndex, room.playerOrder, myName]);

  // Auto-clear after total animation duration.
  useEffect(() => {
    if (!frame) return;
    const total =
      SHUFFLE_MS +
      DEAL_PER_CARD_MS * frame.targets.length +
      DEAL_FLIGHT_MS +
      TOTAL_PADDING_MS;
    const t = window.setTimeout(() => {
      setFrame(null);
      onActiveRef.current?.(false);
    }, total);
    return () => window.clearTimeout(t);
  }, [activeKey, frame]);

  if (!frame) return null;

  return createPortal(
    <div
      key={activeKey}
      className="fixed inset-0 pointer-events-none z-[400]"
      aria-hidden
    >
      {/* Shuffle stack at the dealer's spot. */}
      {Array.from({ length: 5 }).map((_, i) => (
        <img
          key={`s${i}`}
          src={cardBackUrl()}
          alt=""
          className="absolute select-none rounded-md shadow-md ring-1 ring-black/40"
          style={{
            width: 64,
            height: 90,
            left: frame.origin.x - 32,
            top: frame.origin.y - 45,
            animation: `deal-shuffle-${i % 5} ${SHUFFLE_MS}ms cubic-bezier(0.4, 0, 0.5, 1) 0ms forwards`,
            zIndex: 50 + i,
          }}
        />
      ))}
      {/* Cards flying out to each player. */}
      {frame.targets.map((t, i) => (
        <img
          key={`d${i}`}
          src={cardBackUrl()}
          alt=""
          className="absolute select-none rounded-md shadow-md ring-1 ring-black/40"
          style={
            {
              width: 64,
              height: 90,
              left: frame.origin.x - 32,
              top: frame.origin.y - 45,
              opacity: 0,
              ['--dx']: `${t.x}px`,
              ['--dy']: `${t.y}px`,
              ['--rot']: `${t.rot}deg`,
              animation: `deal-fly ${DEAL_FLIGHT_MS}ms cubic-bezier(0.45, 0.05, 0.55, 1) ${t.delay}ms forwards`,
              zIndex: 100 + i,
            } as React.CSSProperties
          }
        />
      ))}
    </div>,
    document.body,
  );
}
