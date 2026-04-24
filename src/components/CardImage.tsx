import type { Card } from '../lib/types';
import { cardImageUrl, cardLabel } from '../lib/cardImages';

type Props = {
  card: Card;
  size?: 'sm' | 'md' | 'lg';
  faded?: boolean;
  className?: string;
  onClick?: () => void;
};

const SIZE_CLASSES: Record<NonNullable<Props['size']>, string> = {
  sm: 'w-12 h-[67px]',
  md: 'w-16 h-[90px]',
  lg: 'w-24 h-[135px]',
};

export function CardImage({
  card,
  size = 'md',
  faded = false,
  className = '',
  onClick,
}: Props) {
  return (
    <img
      src={cardImageUrl(card)}
      alt={cardLabel(card)}
      onClick={onClick}
      className={`select-none rounded-md shadow-md ring-1 ring-black/30 ${
        SIZE_CLASSES[size]
      } ${faded ? 'opacity-40 pointer-events-none' : ''} ${
        onClick ? 'cursor-pointer active:scale-95 transition-transform' : ''
      } ${className}`}
      draggable={false}
    />
  );
}

export function CardBack({
  size = 'md',
  className = '',
}: {
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  return (
    <div
      className={`rounded-md ring-1 ring-black/40 bg-gradient-to-br from-navy-600 to-navy-800 border border-gold-700 ${
        SIZE_CLASSES[size]
      } ${className}`}
    />
  );
}
