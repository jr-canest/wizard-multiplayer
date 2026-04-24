import type { Card } from '../lib/types';
import { CardImage } from './CardImage';

type Props = {
  hand: Card[] | null;
  legal?: boolean[];
  onPlay?: (index: number) => void;
};

export function HandDisplay({ hand, legal, onPlay }: Props) {
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
        No cards left.
      </div>
    );
  }

  return (
    <div className="flex justify-center items-end gap-2 flex-wrap py-3">
      {hand.map((card, i) => {
        const cardLegal = legal ? legal[i] : true;
        const cardKey = `${card.kind}-${i}-${
          card.kind === 'standard' ? `${card.suit}${card.rank}` : card.id
        }`;
        return (
          <CardImage
            key={cardKey}
            card={card}
            size="lg"
            faded={!cardLegal}
            onClick={cardLegal && onPlay ? () => onPlay(i) : undefined}
          />
        );
      })}
    </div>
  );
}
