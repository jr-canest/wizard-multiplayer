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

  const otherBidsSum = Object.values(room.bids).reduce((a, b) => a + b, 0);
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
      otherBidsSum,
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

  const totalSoFar = otherBidsSum + (alreadyBid ? myBid : 0);
  const diff = totalSoFar - cardsThisRound;
  const bidSumLabel =
    diff > 0 ? `Over ${diff}` : diff < 0 ? `Under ${-diff}` : 'Exact';
  const bidSumTone =
    diff > 0
      ? 'text-rose-300'
      : diff === 0
        ? 'text-amber-300'
        : 'text-sky-300';

  const currentColor = playerColor(currentName, room.playerOrder);
  const myTurnGlow =
    isMyTurn && !alreadyBid
      ? 'ring-4 ring-gold-300 shadow-[0_0_24px_rgba(254,205,70,0.7)] animate-[pulse_2s_ease-in-out_infinite]'
      : '';

  return (
    <div
      className={`card-gold-subtle flex-1 p-3 h-[360px] flex flex-col gap-2 ${myTurnGlow}`}
    >
      <div className="flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-wider text-navy-200">
          Total bids
        </span>
        <span className="tabular-nums">
          <strong className={bidSumTone}>{totalSoFar}</strong>
          <span className="text-navy-400"> / {cardsThisRound}</span>
          <span className={`ml-1.5 font-semibold ${bidSumTone}`}>
            · {bidSumLabel}
          </span>
        </span>
      </div>

      {alreadyBid && !isMyTurn ? (
        <div className="flex-1 flex flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm text-navy-100">
            Your bid: <strong className="text-gold-100">{myBid}</strong>
          </p>
          <p className="text-xs text-navy-200">
            Waiting for{' '}
            <strong className={currentColor.text}>{currentName}</strong>
            {dealerName === currentName ? ' (dealer)' : ''}…
          </p>
        </div>
      ) : isMyTurn ? (
        <div className="flex-1 flex flex-col">
          <p className="text-[11px] uppercase tracking-[0.2em] text-gold-200 font-black mb-1.5 text-center">
            Your turn to bid
          </p>
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
              <p className="text-[10px] text-navy-200 mt-1.5 text-center">
                Canadian rule: can’t bid the value that balances the round.
              </p>
            )}
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-center px-2">
          <p className="text-sm text-navy-100">
            Waiting for{' '}
            <strong className={currentColor.text}>{currentName}</strong>
            {dealerName === currentName ? ' (dealer)' : ''}…
          </p>
        </div>
      )}

      {error && <p className="text-[11px] text-rose-300 text-center">{error}</p>}
    </div>
  );
}
