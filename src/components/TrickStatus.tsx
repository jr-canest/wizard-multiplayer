import type { RoomSnapshot } from '../hooks/useRoom';

export function TrickStatus({
  room,
  myName,
}: {
  room: RoomSnapshot;
  myName: string;
}) {
  const cardsThisRound = room.currentRound;
  const myBid = room.bids[myName];
  const myWon = room.tricksWon[myName] ?? 0;
  const currentName = room.playerOrder[room.currentPlayerIndex];
  const isMyTurn = currentName === myName;

  const totalBids = room.playerOrder.reduce(
    (a, n) => a + (room.bids[n] ?? 0),
    0,
  );
  const diff = totalBids - cardsThisRound;
  const sumLabel =
    diff > 0
      ? `Overbid ${diff}`
      : diff < 0
        ? `Underbid ${-diff}`
        : 'Exact';
  const sumTone =
    diff > 0
      ? 'text-rose-300'
      : diff === 0
        ? 'text-amber-300'
        : 'text-sky-300';

  return (
    <div className="card-gold-subtle px-3 py-2 space-y-1 text-xs">
      <div className="flex items-center justify-between">
        <span className="text-navy-200">
          Trick{' '}
          <strong className="text-gold-100">
            {room.currentTrick}/{cardsThisRound}
          </strong>
        </span>
        <span className={`font-semibold ${sumTone}`}>
          Bids {totalBids}/{cardsThisRound} · {sumLabel}
        </span>
      </div>
      <div className="flex items-center justify-between">
        <span className="text-navy-200">
          You: bid{' '}
          <strong
            className={
              myBid !== undefined && myWon === myBid
                ? 'text-emerald-300'
                : myBid !== undefined && myWon > myBid
                  ? 'text-rose-300'
                  : 'text-gold-100'
            }
          >
            {myBid ?? '—'}
          </strong>{' '}
          · won <strong className="text-gold-100">{myWon}</strong>
        </span>
        {!isMyTurn && (
          <span className="text-navy-300">
            waiting for{' '}
            <strong className="text-gold-100">{currentName}</strong>
          </span>
        )}
      </div>
    </div>
  );
}
