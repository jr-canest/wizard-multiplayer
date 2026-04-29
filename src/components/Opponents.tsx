import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';
import type { Suit } from '../lib/types';
import { playerColor } from '../lib/playerColors';
import { isConnected } from '../lib/presence';

const SUIT_GLYPH: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };

type Props = {
  room: RoomSnapshot;
  players: PlayerSnapshot[];
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
 * Single bid/won indicator. During bidding it's just the bid (e.g. "3").
 * During play it becomes "won/bid" (e.g. "1/3"). Goes red if the player has
 * exceeded their bid (impossible to make), green when exactly making it.
 */
function bidWonChip(
  bid: number | undefined,
  won: number,
  isBidding: boolean,
) {
  if (bid === undefined) {
    return <span className="text-navy-400 tabular-nums">—</span>;
  }
  if (isBidding) {
    return (
      <span className="text-gold-100 font-bold tabular-nums">{bid}</span>
    );
  }
  const tone =
    won > bid
      ? 'text-rose-300'
      : won === bid
        ? 'text-emerald-300'
        : 'text-gold-100';
  return (
    <span className={`${tone} font-bold tabular-nums`}>
      {won}/{bid}
    </span>
  );
}

/** Tiny fan of face-down cards. Bounded so 10-card hands still look fine. */
function MiniFan({ count }: { count: number }) {
  const visible = Math.min(count, 5);
  return (
    <div className="relative h-6 w-10 shrink-0">
      {Array.from({ length: visible }, (_, i) => {
        const centerIdx = (visible - 1) / 2;
        const angle = (i - centerIdx) * 8;
        const offset = (i - centerIdx) * 3;
        return (
          <div
            key={i}
            className="absolute left-1/2 bottom-0 w-3.5 h-5 rounded-[2px] border border-gold-700 bg-gradient-to-br from-navy-500 to-navy-800 shadow-sm"
            style={{
              transform: `translateX(calc(-50% + ${offset}px)) rotate(${angle}deg)`,
              transformOrigin: 'bottom center',
              zIndex: i,
            }}
          />
        );
      })}
      {count > visible && (
        <span className="absolute -top-1 right-0 text-[9px] text-navy-200 bg-navy-900/80 rounded px-0.5">
          +{count - visible}
        </span>
      )}
    </div>
  );
}

export function Opponents({ room, players, myName }: Props) {
  const dealerName = room.playerOrder[room.dealerIndex];
  const playersByName = new Map(players.map((p) => [p.name, p]));
  const isBidding = room.status === 'bidding';
  const isPlaying = room.status === 'playing';
  const activeName =
    isBidding || isPlaying
      ? room.playerOrder[room.currentPlayerIndex]
      : null;

  const N = room.playerOrder.length;

  // First to act in the current phase, so we can number tiles in turn order.
  // - Bidding: left of dealer.
  // - Playing: leader of the current trick if anyone's played yet, otherwise
  //   whoever is up next.
  let startIdx: number | null = null;
  if (isBidding) {
    startIdx = (room.dealerIndex + 1) % N;
  } else if (isPlaying) {
    if (room.trickInProgress.length > 0) {
      startIdx = room.playerOrder.indexOf(room.trickInProgress[0].playerName);
    } else {
      startIdx = room.currentPlayerIndex;
    }
  }

  const opponents = room.playerOrder.filter((n) => n !== myName);
  if (opponents.length === 0) return null;

  // 3x3 grid at 9 opponents (10-player games), otherwise horizontal flow.
  const gridClass =
    opponents.length >= 7
      ? 'grid grid-cols-3 gap-1.5'
      : 'flex flex-wrap justify-center gap-1.5';

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
        const playerIdx = room.playerOrder.indexOf(name);
        const position =
          startIdx !== null ? ((playerIdx - startIdx + N) % N) + 1 : null;
        const playerMeta = playersByName.get(name);
        const offline = playerMeta ? !isConnected(playerMeta) : false;
        // Acted this phase: bid is in (during bidding) or card is on the
        // table (during playing). Active is never marked acted. Pending is
        // anyone in the rotation who hasn't gone yet and isn't current.
        const acted =
          !isActive &&
          ((isBidding && bid !== undefined) || (isPlaying && !!inTrick));
        const pending = !isActive && !acted && (isBidding || isPlaying);
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
            className={`relative rounded-lg px-1.5 py-1 flex-1 min-w-[88px] max-w-[140px] border bg-navy-900/40 ${color.border} transition-opacity ${
              isActive
                ? `ring-2 ${color.ring} ${color.glow} animate-[pulse_2s_ease-in-out_infinite]`
                : ''
            } ${pending ? 'opacity-45' : ''}`}
          >
            <div className="flex items-center justify-between gap-1 leading-tight">
              <span className="flex items-center gap-1 min-w-0">
                {position !== null && (
                  <span
                    className={`text-[9px] font-bold leading-none rounded-full w-3.5 h-3.5 inline-flex items-center justify-center shrink-0 ${
                      acted
                        ? 'bg-emerald-500/30 text-emerald-200'
                        : isActive
                          ? 'bg-gold-300 text-navy-900'
                          : 'bg-navy-700 text-navy-200'
                    }`}
                    title={`Turn order ${position}`}
                  >
                    {acted ? '✓' : position}
                  </span>
                )}
                <span className={`text-[12px] font-semibold truncate ${color.text}`}>
                  {name}
                </span>
              </span>
              <span className="flex items-center gap-1 shrink-0">
                {offline && (
                  <span
                    className="h-1.5 w-1.5 rounded-full bg-rose-400"
                    title="Disconnected"
                  />
                )}
                {isDealer && (
                  <span className="text-gold-300 text-[10px]" title="Dealer">
                    ♛
                  </span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1.5 mt-0.5">
              <MiniFan count={handSize} />
              <span className="flex-1 text-right text-[13px] leading-none">
                {bidWonChip(bid, won, isBidding)}
              </span>
            </div>
            {playedCardBrief && (
              <div className="absolute -top-1.5 -right-1 bg-gold-300 text-navy-900 text-[9px] font-bold rounded px-1 py-0.5 shadow">
                {playedCardBrief}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
