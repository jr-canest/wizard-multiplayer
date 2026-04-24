import type { Card } from '../lib/types';
import { CardImage } from './CardImage';

type Play = { playerName: string; card: Card; playOrder: number };

type Props = {
  plays: Play[];
  myName: string;
  isMyTurn: boolean;
};

export function TrickArea({ plays, myName, isMyTurn }: Props) {
  const dropGlow = isMyTurn
    ? 'border-gold-400 shadow-[inset_0_0_24px_rgba(254,205,70,0.25)]'
    : 'border-transparent';

  return (
    <div
      data-drop="trick"
      className={`card-gold-subtle flex-1 p-3 min-h-[140px] border-2 rounded-xl transition-shadow ${dropGlow}`}
    >
      {plays.length === 0 ? (
        <div className="h-full flex items-center justify-center">
          <span className="text-navy-300 text-xs text-center px-2">
            {isMyTurn ? 'Tap or drag a card here' : 'Trick area'}
          </span>
        </div>
      ) : (
        <ul className="flex flex-wrap items-end justify-center gap-2">
          {plays.map((p) => (
            <li key={p.playOrder} className="flex flex-col items-center gap-1">
              <CardImage card={p.card} size="sm" />
              <span
                className={`text-[10px] leading-tight ${
                  p.playerName === myName
                    ? 'text-gold-100 font-bold'
                    : 'text-navy-100'
                }`}
              >
                {p.playerName === myName ? 'you' : p.playerName}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
