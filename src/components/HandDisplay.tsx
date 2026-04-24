import type { Card } from '../lib/types';
import { CardImage } from './CardImage';

type Props = {
  hand: Card[] | null;
};

export function HandDisplay({ hand }: Props) {
  if (!hand) {
    return (
      <div className="text-navy-200 text-sm text-center py-8">
        Waiting for cards…
      </div>
    );
  }
  if (hand.length === 0) {
    return (
      <div className="text-navy-200 text-sm text-center py-8">
        No cards.
      </div>
    );
  }

  return (
    <div className="flex justify-center items-end gap-2 flex-wrap py-3">
      {hand.map((card, i) => (
        <CardImage
          key={`${card.kind}-${i}-${
            card.kind === 'standard' ? `${card.suit}${card.rank}` : card.id
          }`}
          card={card}
          size="lg"
        />
      ))}
    </div>
  );
}
