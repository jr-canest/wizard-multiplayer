import { useState } from 'react';
import { placeBid, violatesCanadianRule } from '../lib/gameFlow';
import { bidGridLayout } from '../lib/bidLayout';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * The bid number-picker bar. Renders inside the trick area while it's
 * the local viewer's turn to bid (no trick cards on the table yet to
 * collide with). Standalone, no surrounding card-gold frame.
 */
export function BidButtonsBar({ room, myName }: Props) {
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cardsThisRound = room.currentRound;
  const playerCount = room.playerOrder.length;
  const dealerName = room.playerOrder[room.dealerIndex];
  const myBid = room.bids[myName];
  const alreadyBid = myBid !== undefined;
  const totalBidsSoFar = Object.values(room.bids).reduce((a, b) => a + b, 0);
  const isDealerBid = myName === dealerName;
  const allOthersBidIn =
    Object.keys(room.bids).length === playerCount - 1 && !alreadyBid;

  function isLocked(value: number): boolean {
    if (alreadyBid) return true;
    if (!isDealerBid || !allOthersBidIn) return false;
    return violatesCanadianRule({
      isDealerBid: true,
      canadianRule: room.canadianRule,
      currentRound: room.currentRound,
      cardsThisRound,
      otherBidsSum: totalBidsSoFar,
      bid: value,
    });
  }

  async function pick(value: number) {
    setSubmitting(value);
    setError(null);
    try {
      await placeBid(room.code, myName, value, room);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid.');
    } finally {
      setSubmitting(null);
    }
  }

  const showCanadianNote =
    isDealerBid &&
    allOthersBidIn &&
    room.canadianRule &&
    room.currentRound > 1;

  const valueCount = cardsThisRound + 1;
  const { cols, rows } = bidGridLayout(valueCount);
  const multiRow = rows > 1;
  // Tighter gutter once the row is wide, so the chips keep their width.
  const gap = cols > 6 ? 5 : 8;
  // Wrapping flex rather than a grid: a partial last row then CENTRES
  // itself under the full ones instead of hanging off the left edge.
  const basis = `calc((100% - ${(cols - 1) * gap}px) / ${cols})`;

  return (
    <div className="flex flex-col gap-1">
      <div
        className="flex flex-wrap justify-center"
        style={{ gap: `${gap}px` }}
      >
        {Array.from({ length: valueCount }, (_, i) => {
          const locked = isLocked(i);
          const submittingThis = submitting === i;
          return (
            <button
              key={i}
              type="button"
              disabled={locked || submitting !== null}
              onClick={() => pick(i)}
              style={{ flex: `0 0 ${basis}` }}
              className={`${multiRow ? 'h-[42px]' : 'h-[46px]'} chip ${
                locked ? 'chip-locked cursor-not-allowed' : 'active:scale-95 transition'
              }`}
            >
              {submittingThis ? '…' : i}
            </button>
          );
        })}
      </div>
      {showCanadianNote && (
        <p className="text-[10px] text-navy-200 text-center">
          Canadian rule: can’t bid the value that balances the round.
        </p>
      )}
      {error && (
        <p className="text-[10px] text-rose-300 text-center">{error}</p>
      )}
    </div>
  );
}
