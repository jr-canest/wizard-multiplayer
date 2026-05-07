import { useLayoutEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { BidButtonsBar } from './BidButtonsBar';
import { getUIZoom } from '../hooks/useUIScale';
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
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    function update() {
      // Prefer the action strip's bottom edge + width so the modal sits
      // flush with it (same horizontal extent + bottom). Fall back to
      // the trick area frame until the strip is mounted.
      const strip = document.querySelector<HTMLElement>(
        '[data-action-strip]',
      );
      const trick = document.querySelector<HTMLElement>(
        '[data-trick-area-frame]',
      );
      const el = strip ?? trick;
      if (!el) return;
      const r = el.getBoundingClientRect();
      // body { zoom } scales fixed children too — divide viewport coords
      // by the zoom so the modal lines up with the strip visually.
      const zoom = getUIZoom();
      setAnchor({
        bottom: (window.innerHeight - r.bottom) / zoom,
        left: r.left / zoom,
        width: r.width / zoom,
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
      className="fixed z-[250] pointer-events-none animate-bid-modal-in"
      style={{
        bottom: anchor.bottom,
        left: anchor.left,
        width: anchor.width,
      }}
      aria-modal="true"
      role="dialog"
    >
      <div className="relative card-gold p-3 w-full pointer-events-auto shadow-2xl ring-2 ring-gold-300 shadow-[0_0_24px_rgba(254,205,70,0.5)] bg-navy-900/85 backdrop-blur">
        <h3 className="text-center text-[11px] uppercase tracking-[0.2em] font-black text-gold-100 mb-2">
          Place your bid
        </h3>
        <BidButtonsBar room={room} myName={myName} />
      </div>
    </div>,
    document.body,
  );
}
