import { useState } from 'react';
import { placeBid, violatesCanadianRule } from '../lib/gameFlow';
import type { RoomSnapshot } from '../hooks/useRoom';

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
  const totalTone =
    totalSoFar > cardsThisRound
      ? 'text-rose-300'
      : totalSoFar === cardsThisRound
        ? 'text-amber-300'
        : 'text-sky-300';

  return (
    <div className="card-gold p-4 space-y-4">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-navy-200">
          Bidding
        </span>
        <span className="text-sm">
          <span className={totalTone}>{totalSoFar}</span>
          <span className="text-navy-200"> / {cardsThisRound}</span>
        </span>
      </div>

      <ul className="space-y-1.5">
        {room.playerOrder.map((name) => {
          const bid = room.bids[name];
          const isCurrent = name === currentName && bid === undefined;
          const isMe = name === myName;
          return (
            <li
              key={name}
              className={`flex items-center justify-between rounded-md px-3 py-2 ${
                isCurrent
                  ? 'bg-gold-900/40 border border-gold-600'
                  : 'bg-navy-800/60'
              }`}
            >
              <span className="flex items-center gap-2">
                <span
                  className={
                    isMe ? 'font-bold text-gold-100' : 'text-navy-50'
                  }
                >
                  {name}
                  {isMe ? ' (you)' : ''}
                </span>
                {name === dealerName && (
                  <span className="text-gold-300 text-sm" title="Dealer">
                    ♛
                  </span>
                )}
              </span>
              <span className="text-sm tabular-nums">
                {bid !== undefined ? (
                  <span className="text-gold-100 font-bold">{bid}</span>
                ) : isCurrent ? (
                  <span className="text-gold-300">…</span>
                ) : (
                  <span className="text-navy-300">—</span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      {alreadyBid ? (
        <p className="text-sm text-navy-100 text-center">
          Your bid: <strong className="text-gold-100">{myBid}</strong>. Waiting for
          others…
        </p>
      ) : isMyTurn ? (
        <div>
          <p className="text-sm text-gold-200 mb-2">Your bid:</p>
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: cardsThisRound + 1 }, (_, i) => {
              const locked = isLocked(i);
              const submittingThis = submitting === i;
              return (
                <button
                  key={i}
                  type="button"
                  disabled={locked || submitting !== null}
                  onClick={() => pick(i)}
                  className={`min-w-[3rem] rounded-md py-2 px-3 text-lg font-bold border ${
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
          {isDealerBid && allOthersBidIn && room.canadianRule && room.currentRound > 1 && (
            <p className="text-xs text-navy-200 mt-2">
              Canadian rule: you can’t bid the value that balances the round.
            </p>
          )}
        </div>
      ) : (
        <p className="text-sm text-navy-100 text-center">
          Waiting for{' '}
          <strong className="text-gold-100">{currentName}</strong>…
        </p>
      )}

      {error && (
        <p className="text-sm text-rose-300 text-center">{error}</p>
      )}
    </div>
  );
}
