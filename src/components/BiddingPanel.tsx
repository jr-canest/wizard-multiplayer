import { useState } from 'react';
import { placeBid, violatesCanadianRule } from '../lib/gameFlow';
import type { RoomSnapshot } from '../hooks/useRoom';
import { playerColor } from '../lib/playerColors';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function BiddingPanel({ room, myName }: Props) {
  const [submitting, setSubmitting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const cardsThisRound = room.currentRound;
  const playerCount = room.playerOrder.length;
  const currentName = room.playerOrder[room.currentPlayerIndex];
  const dealerName = room.playerOrder[room.dealerIndex];
  const isMyTurn = currentName === myName;
  const myBid = room.bids[myName];
  const alreadyBid = myBid !== undefined;

  // Sum of every bid that's been placed so far (including mine if I've
  // already bid). For the canadian-rule check we only need it pre-bid,
  // when it equals the sum of the other players' bids.
  const totalBidsSoFar = Object.values(room.bids).reduce((a, b) => a + b, 0);
  const isDealerBid = myName === dealerName;
  const allOthersBidIn =
    Object.keys(room.bids).length === playerCount - 1 && !alreadyBid;

  function isLocked(value: number): boolean {
    if (!isMyTurn || alreadyBid) return true;
    if (!isDealerBid || !allOthersBidIn) return false;
    return violatesCanadianRule({
      isDealerBid: true,
      canadianRule: room.canadianRule,
      currentRound: room.currentRound,
      cardsThisRound,
      // I haven't bid yet (alreadyBid is false above), so totalBidsSoFar
      // is the others' sum.
      otherBidsSum: totalBidsSoFar,
      bid: value,
    });
  }

  async function pick(value: number) {
    setSubmitting(value);
    setError(null);
    try {
      await placeBid(room.code, myName, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to place bid.');
    } finally {
      setSubmitting(null);
    }
  }

  // (Total bids over/under display now lives in the GameView top bar.
  // Outer frame is provided by the action area in GameView.)
  const currentColor = playerColor(currentName, room.playerOrder);

  return (
    <div className="flex flex-col gap-1.5">

      {alreadyBid && !isMyTurn ? (
        <p className="text-xs text-center text-navy-100">
          Your bid: <strong className="text-gold-100">{myBid}</strong>
          {' · '}
          Waiting for{' '}
          <strong className={currentColor.text}>{currentName}</strong>
          {dealerName === currentName ? ' (dealer)' : ''}…
        </p>
      ) : isMyTurn ? (
        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap gap-1.5 justify-center">
            {Array.from({ length: cardsThisRound + 1 }, (_, i) => {
              const locked = isLocked(i);
              const submittingThis = submitting === i;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked || submitting !== null}
                  onClick={() => pick(i)}
                  className={`min-w-[2.5rem] rounded-md py-1.5 px-2 text-base font-bold border ${
                    locked
                      ? 'bg-navy-900/40 border-navy-700 text-navy-500 line-through cursor-not-allowed'
                      : 'bg-navy-800 border-gold-600 text-gold-100 hover:bg-navy-700 active:scale-95 transition'
                  }`}
                >
                  {submittingThis ? '…' : i}
                </button>
              );
            })}
          </div>
          {isDealerBid &&
            allOthersBidIn &&
            room.canadianRule &&
            room.currentRound > 1 && (
              <p className="text-[10px] text-navy-200 text-center">
                Canadian rule: can’t bid the value that balances the round.
              </p>
            )}
        </div>
      ) : (
        <p className="text-xs text-center text-navy-100">
          Waiting for{' '}
          <strong className={currentColor.text}>{currentName}</strong>
          {dealerName === currentName ? ' (dealer)' : ''}…
        </p>
      )}

      {error && <p className="text-[11px] text-rose-300 text-center">{error}</p>}
    </div>
  );
}
