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

type Props = {
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  awaitingTrumpChoice: boolean;
};

export function TrumpDisplay({
  trumpCard,
  trumpSuit,
  awaitingTrumpChoice,
}: Props) {
  return (
    <div className="card-gold-subtle flex flex-col items-center justify-center gap-2 p-2 w-[80px] shrink-0">
      <div className="text-[9px] uppercase tracking-wider text-navy-200">
        Trump
      </div>
      {trumpCard ? (
        <CardImage card={trumpCard} size="md" />
      ) : (
        <div className="w-16 h-[90px] rounded-md border border-dashed border-navy-400 flex items-center justify-center text-navy-300 text-[10px]">
          none
        </div>
      )}
      <div className="text-center">
        {awaitingTrumpChoice ? (
          <span className="text-[10px] text-gold-300 font-semibold">
            choosing…
          </span>
        ) : trumpSuit ? (
          <span className={`text-xl leading-none ${SUIT_COLOR[trumpSuit]}`}>
            {SUIT_GLYPH[trumpSuit]}
          </span>
        ) : (
          <span className="text-[10px] text-navy-100">no trump</span>
        )}
      </div>
    </div>
  );
}
