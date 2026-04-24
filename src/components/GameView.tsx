import type { RoomSnapshot } from '../hooks/useRoom';
import { useMyHand } from '../hooks/useMyHand';
import { TrumpDisplay } from './TrumpDisplay';
import { TrumpChooser } from './TrumpChooser';
import { HandDisplay } from './HandDisplay';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

export function GameView({ room, myName }: Props) {
  const hand = useMyHand(room.code, myName);
  const dealerName = room.playerOrder[room.dealerIndex];
  const isDealer = dealerName === myName;

  return (
    <div className="w-full max-w-md space-y-4">
      <div className="card-gold-subtle px-4 py-2 flex items-center justify-between text-sm">
        <span className="text-navy-100">
          Round{' '}
          <strong className="text-gold-100">
            {room.currentRound}/{room.totalRounds}
          </strong>
        </span>
        <span className="text-navy-100">
          Dealer{' '}
          <strong className="text-gold-100">{dealerName}</strong>
          {isDealer ? ' (you)' : ''}
        </span>
      </div>

      <TrumpDisplay
        trumpCard={room.trumpCard}
        trumpSuit={room.trumpSuit}
        awaitingTrumpChoice={room.awaitingTrumpChoice}
      />

      {room.awaitingTrumpChoice && isDealer && (
        <TrumpChooser code={room.code} callerName={myName} />
      )}

      <div>
        <h3 className="text-xs uppercase tracking-wider text-navy-200 mb-2">
          Your hand ({hand?.length ?? 0})
        </h3>
        <HandDisplay hand={hand} />
      </div>

      <p className="text-navy-200 text-sm text-center">
        Bidding wires up next (step 6).
      </p>
    </div>
  );
}
