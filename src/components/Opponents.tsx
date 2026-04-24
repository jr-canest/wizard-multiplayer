import type { RoomSnapshot } from '../hooks/useRoom';
import type { Suit } from '../lib/types';

const SUIT_GLYPH: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };

type Props = {
  room: RoomSnapshot;
  myName: string;
};

function estimateHandSize(room: RoomSnapshot, name: string): number {
  if (room.status === 'bidding') return room.currentRound;
  if (room.status === 'scoring' || room.status === 'finished') return 0;
  if (room.status !== 'playing' && room.status !== 'dealing') return 0;
  const completedThisRound = room.trickHistory.filter(
    (t) => t.round === room.currentRound,
  ).length;
  const playedInCurrent = room.trickInProgress.some(
    (p) => p.playerName === name,
  );
  return Math.max(
    0,
    room.currentRound - completedThisRound - (playedInCurrent ? 1 : 0),
  );
}

/** Tiny fan of face-down cards. Bounded so 10-card hands still look fine. */
function MiniFan({ count }: { count: number }) {
  const visible = Math.min(count, 6);
  return (
    <div className="relative h-8 w-14">
      {Array.from({ length: visible }, (_, i) => {
        const centerIdx = (visible - 1) / 2;
        const angle = (i - centerIdx) * 8;
        const offset = (i - centerIdx) * 4;
        return (
          <div
            key={i}
            className="absolute left-1/2 bottom-0 w-5 h-7 rounded-[3px] border border-gold-700 bg-gradient-to-br from-navy-500 to-navy-800 shadow-sm"
            style={{
              transform: `translateX(calc(-50% + ${offset}px)) rotate(${angle}deg)`,
              transformOrigin: 'bottom center',
              zIndex: i,
            }}
          />
        );
      })}
      {count > visible && (
        <span className="absolute -top-1 right-0 text-[10px] text-navy-200 bg-navy-900/80 rounded px-1">
          +{count - visible}
        </span>
      )}
    </div>
  );
}

export function Opponents({ room, myName }: Props) {
  const dealerName = room.playerOrder[room.dealerIndex];
  const activeName =
    room.status === 'bidding' || room.status === 'playing'
      ? room.playerOrder[room.currentPlayerIndex]
      : null;

  const opponents = room.playerOrder.filter((n) => n !== myName);
  if (opponents.length === 0) return null;

  // 3x3 grid at 9 opponents (10-player games), otherwise horizontal flow.
  const gridClass =
    opponents.length >= 7
      ? 'grid grid-cols-3 gap-2'
      : 'flex flex-wrap justify-center gap-2';

  return (
    <div className={gridClass}>
      {opponents.map((name) => {
        const isActive = name === activeName;
        const isDealer = name === dealerName;
        const bid = room.bids[name];
        const won = room.tricksWon[name] ?? 0;
        const handSize = estimateHandSize(room, name);
        const inTrick = room.trickInProgress.find(
          (p) => p.playerName === name,
        );
        const playedCardBrief = inTrick
          ? inTrick.card.kind === 'wizard'
            ? 'W'
            : inTrick.card.kind === 'jester'
              ? 'J'
              : `${inTrick.card.rank > 10 ? ['J','Q','K','A'][inTrick.card.rank - 11] : inTrick.card.rank}${SUIT_GLYPH[inTrick.card.suit]}`
          : null;

        return (
          <div
            key={name}
            className={`relative card-gold-subtle px-2 py-2 flex-1 min-w-[110px] max-w-[180px] ${
              isActive
                ? 'border-gold-400 shadow-[0_0_12px_rgba(254,205,70,0.5)] animate-[pulse_2s_ease-in-out_infinite]'
                : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className="text-sm font-semibold text-gold-100 truncate">
                {name}
              </span>
              {isDealer && (
                <span className="text-gold-300 text-xs" title="Dealer">
                  ♛
                </span>
              )}
            </div>
            <div className="flex items-end gap-2">
              <MiniFan count={handSize} />
              <div className="flex-1 text-right text-[11px] leading-tight">
                <div className="text-navy-200">
                  bid <span className="text-gold-100 font-bold">
                    {bid ?? '—'}
                  </span>
                </div>
                <div className="text-navy-200">
                  won <span className="text-gold-100 font-bold">{won}</span>
                </div>
              </div>
            </div>
            {playedCardBrief && (
              <div className="absolute -top-2 -right-1 bg-gold-300 text-navy-900 text-[10px] font-bold rounded px-1 py-0.5 shadow">
                {playedCardBrief}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
