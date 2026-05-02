import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BidButtonsBar } from './BidButtonsBar';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * Bid number picker modal. Shown only while it's the local viewer's
 * turn to bid; auto-closes when the bid is placed (state moves on,
 * caller stops rendering the component).
 *
 * Centered as a portal, anchored toward the lower portion of the
 * viewport so the user's hand stays visible but the modal dominates.
 * Soft backdrop dims the rest of the table without blocking it.
 */
export function BidModal({ room, myName }: Props) {
  // Anchor the modal to the trick area's bottom edge so it slots into
  // the empty space between the trump card (centered above) and the
  // user's hand (below the table). Re-measures on resize.
  const [anchor, setAnchor] = useState<{
    bottom: number;
    centerX: number;
  } | null>(null);

  useLayoutEffect(() => {
    function update() {
      const el = document.querySelector<HTMLElement>(
        '[data-trick-area-frame]',
      );
      if (!el) return;
      const r = el.getBoundingClientRect();
      setAnchor({
        bottom: window.innerHeight - r.bottom + 12,
        centerX: r.left + r.width / 2,
      });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, []);

  if (!anchor) {
    // Fall back to bottom-anchored modal until the trick area is found.
    return null;
  }

  return createPortal(
    <div
      className="fixed z-[250] pointer-events-none animate-bid-modal-in -translate-x-1/2"
      style={{
        bottom: anchor.bottom,
        left: anchor.centerX,
      }}
      aria-modal="true"
      role="dialog"
    >
      <div className="relative card-gold p-3 w-[88vw] max-w-[340px] pointer-events-auto shadow-2xl ring-2 ring-gold-300 shadow-[0_0_24px_rgba(254,205,70,0.5)] bg-navy-900/85 backdrop-blur">
        <h3 className="text-center text-[11px] uppercase tracking-[0.2em] font-black text-gold-100 mb-2">
          Place your bid
        </h3>
        <BidButtonsBar room={room} myName={myName} />
      </div>
    </div>,
    document.body,
  );
}
