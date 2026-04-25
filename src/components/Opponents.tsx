import type { RoomSnapshot } from '../hooks/useRoom';
import type { Suit } from '../lib/types';
import { playerColor } from '../lib/playerColors';

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

/**
 * Color the bid/won pair by per-player state so a glance tells you who is
 * over (rose), exactly making it (amber), or still under (sky). Tones match
 * the global bid-total indicator at the top of the bidding panel.
 */
function bidWonTone(bid: number | undefined, won: number) {
  if (bid === undefined) {
    return (
      <>
        <div className="text-navy-300">
          bid <span className="text-navy-100 font-bold tabular-nums">—</span>
        </div>
        <div className="text-navy-300">
          won{' '}
          <span className="text-navy-100 font-bold tabular-nums">{won}</span>
        </div>
      </>
    );
  }
  const tone =
    won > bid
      ? { label: 'text-rose-300', value: 'text-rose-100' }
      : won === bid
        ? { label: 'text-amber-300', value: 'text-amber-100' }
        : { label: 'text-sky-300', value: 'text-sky-100' };
  return (
    <>
      <div className={tone.label}>
        bid{' '}
        <span className={`${tone.value} font-bold tabular-nums`}>{bid}</span>
      </div>
      <div className={tone.label}>
        won{' '}
        <span className={`${tone.value} font-bold tabular-nums`}>{won}</span>
      </div>
    </>
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
        const color = playerColor(name, room.playerOrder);
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
            className={`relative rounded-xl px-2 py-2 flex-1 min-w-[110px] max-w-[180px] border-2 bg-navy-900/40 ${color.border} ${
              isActive
                ? `ring-2 ${color.ring} ${color.glow} animate-[pulse_2s_ease-in-out_infinite]`
                : ''
            }`}
          >
            <div className="flex items-center justify-between mb-1">
              <span className={`text-sm font-semibold truncate ${color.text}`}>
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
              <div className="flex-1 text-right text-[11px] leading-tight space-y-0.5">
                {bidWonTone(bid, won)}
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
