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
  return createPortal(
    <div
      className="fixed inset-0 z-[250] flex items-end justify-center px-3 pb-[28vh] pointer-events-none animate-bid-modal-in"
      aria-modal="true"
      role="dialog"
    >
      {/* Soft backdrop — does not capture clicks (cards underneath
          can't be played anyway during bidding). */}
      <div className="absolute inset-0 bg-navy-900/45 backdrop-blur-[1px]" />
      <div className="relative card-gold p-4 w-full max-w-[340px] pointer-events-auto shadow-2xl ring-2 ring-gold-300 shadow-[0_0_24px_rgba(254,205,70,0.5)]">
        <h3 className="text-center text-[12px] uppercase tracking-[0.2em] font-black text-gold-100 mb-3">
          Place your bid
        </h3>
        <BidButtonsBar room={room} myName={myName} />
      </div>
    </div>,
    document.body,
  );
}
