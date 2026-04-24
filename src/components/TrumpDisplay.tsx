import type { Card, Suit } from '../lib/types';
import { CardImage } from './CardImage';

const SUIT_GLYPH: Record<Suit, string> = {
  H: '♥',
  D: '♦',
  C: '♣',
  S: '♠',
};

const SUIT_COLOR: Record<Suit, string> = {
  H: 'text-rose-300',
  D: 'text-sky-300',
  C: 'text-emerald-300',
  S: 'text-navy-100',
};

const SUIT_NAME: Record<Suit, string> = {
  H: 'Hearts',
  D: 'Diamonds',
  C: 'Clubs',
  S: 'Spades',
};

type Props = {
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  awaitingTrumpChoice: boolean;
};

export function TrumpDisplay({ trumpCard, trumpSuit, awaitingTrumpChoice }: Props) {
  return (
    <div className="card-gold-subtle flex items-center gap-3 p-3">
      <div className="text-xs uppercase tracking-wider text-navy-200 w-12">
        Trump
      </div>
      {trumpCard ? (
        <CardImage card={trumpCard} size="sm" />
      ) : (
        <div className="w-12 h-[67px] rounded-md border border-dashed border-navy-400 flex items-center justify-center text-navy-300 text-xs">
          none
        </div>
      )}
      <div className="ml-2">
        {awaitingTrumpChoice ? (
          <span className="text-gold-200 text-sm font-semibold">
            Dealer is choosing…
          </span>
        ) : trumpSuit ? (
          <span className={`text-2xl ${SUIT_COLOR[trumpSuit]}`}>
            {SUIT_GLYPH[trumpSuit]}{' '}
            <span className="text-sm align-middle text-navy-100">
              {SUIT_NAME[trumpSuit]}
            </span>
          </span>
        ) : (
          <span className="text-navy-100 text-sm">No trump</span>
        )}
      </div>
    </div>
  );
}
