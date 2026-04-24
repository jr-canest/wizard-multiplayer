import type { Card } from '../lib/types';
import { CardImage } from './CardImage';

type Play = { playerName: string; card: Card; playOrder: number };

type Props = {
  plays: Play[];
  myName: string;
};

export function TrickArea({ plays, myName }: Props) {
  if (plays.length === 0) {
    return (
      <div className="card-gold-subtle min-h-[160px] flex items-center justify-center">
        <span className="text-navy-300 text-sm">Trick area</span>
      </div>
    );
  }

  return (
    <div className="card-gold-subtle p-4 min-h-[160px]">
      <ul className="flex flex-wrap items-end justify-center gap-3">
        {plays.map((p) => (
          <li key={p.playOrder} className="flex flex-col items-center gap-1">
            <CardImage card={p.card} size="md" />
            <span
              className={`text-xs ${
                p.playerName === myName ? 'text-gold-100 font-bold' : 'text-navy-100'
              }`}
            >
              {p.playerName}
              {p.playerName === myName ? ' (you)' : ''}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
