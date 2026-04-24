import type { RoomSnapshot } from '../hooks/useRoom';

export function TrickStatus({ room, myName }: { room: RoomSnapshot; myName: string }) {
  const cardsThisRound = room.currentRound;
  const myBid = room.bids[myName];
  const myWon = room.tricksWon[myName] ?? 0;
  const currentName = room.playerOrder[room.currentPlayerIndex];
  const isMyTurn = currentName === myName;

  return (
    <div className="card-gold-subtle px-4 py-3 space-y-2">
      <div className="flex items-baseline justify-between text-sm">
        <span className="text-navy-200">
          Trick{' '}
          <strong className="text-gold-100">
            {room.currentTrick}/{cardsThisRound}
          </strong>
        </span>
        <span className="text-navy-200">
          You: bid <strong className="text-gold-100">{myBid ?? '—'}</strong> · won{' '}
          <strong className="text-gold-100">{myWon}</strong>
        </span>
      </div>
      <div className="flex items-baseline justify-between text-xs">
        <span className="text-navy-300">
          Bids by player:{' '}
          {room.playerOrder.map((n, i) => (
            <span key={n}>
              {i > 0 ? ' · ' : ''}
              <span className={n === myName ? 'text-gold-100' : 'text-navy-100'}>
                {n} {room.bids[n] ?? '?'}/{room.tricksWon[n] ?? 0}
              </span>
            </span>
          ))}
        </span>
      </div>
      <div className="text-xs text-navy-200 text-center">
        {isMyTurn ? (
          <span className="text-gold-200 font-semibold">Your turn.</span>
        ) : (
          <>
            Waiting for{' '}
            <strong className="text-gold-100">{currentName}</strong>…
          </>
        )}
      </div>
    </div>
  );
}
