import { colorForViewer } from '../lib/playerColors';
import { isConnected } from '../lib/presence';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
  playerName: string;
  playerMeta: PlayerSnapshot | undefined;
  /** Compact = side columns; comfortable = top row. */
  compact?: boolean;
};

function estimateHandSize(room: RoomSnapshot, name: string): number {
  if (room.status === 'bidding') return room.currentRound;
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

function MiniFan({ count }: { count: number }) {
  const visible = Math.min(count, 4);
  return (
    <div className="relative h-5 w-7 shrink-0">
      {Array.from({ length: visible }, (_, i) => {
        const center = (visible - 1) / 2;
        const angle = (i - center) * 8;
        const offset = (i - center) * 2.5;
        return (
          <div
            key={i}
            className="absolute left-1/2 bottom-0 w-2.5 h-4 rounded-[2px] border border-gold-700/80 bg-gradient-to-br from-navy-500 to-navy-800 shadow-sm"
            style={{
              transform: `translateX(calc(-50% + ${offset}px)) rotate(${angle}deg)`,
              transformOrigin: 'bottom center',
              zIndex: i,
            }}
          />
        );
      })}
    </div>
  );
}

export function OpponentTile({
  room,
  myName,
  playerName,
  playerMeta,
  compact = false,
}: Props) {
  const dealerName = room.playerOrder[room.dealerIndex];
  const isDealer = playerName === dealerName;
  const isBidding = room.status === 'bidding';
  const isPlaying = room.status === 'playing';
  const activeName =
    isBidding || isPlaying
      ? room.playerOrder[room.currentPlayerIndex]
      : null;
  const isActive = playerName === activeName;
  const N = room.playerOrder.length;
  const myIdx = room.playerOrder.indexOf(myName);
  const seatIdx = room.playerOrder.indexOf(playerName);

  // Whoever's up next after the active player (only meaningful during
  // bidding or playing, and not when active player is me about to act).
  const nextIdx = isActive ? (room.currentPlayerIndex + 1) % N : -1;
  const isNext =
    !isActive &&
    activeName !== null &&
    seatIdx === nextIdx &&
    nextIdx !== myIdx;

  const bid = room.bids[playerName];
  const won = room.tricksWon[playerName] ?? 0;
  const handSize = estimateHandSize(room, playerName);
  const color = colorForViewer(playerName, myName, room.playerOrder);
  const offline = playerMeta ? !isConnected(playerMeta) : false;

  const acted =
    !isActive &&
    ((isBidding && bid !== undefined) ||
      (isPlaying && room.trickInProgress.some((p) => p.playerName === playerName)));

  // Status label above the tile (kept short to fit narrow tiles).
  let label: string | null = null;
  if (isActive) {
    label = isBidding ? 'Bidding' : 'Playing';
  } else if (isNext) {
    label = 'Next';
  } else if (acted && isBidding && bid !== undefined) {
    label = `Bid ${bid}`;
  } else if (isBidding || isPlaying) {
    label = 'Waiting';
  }

  const wonBidNode =
    bid === undefined ? (
      <span className="text-navy-400 tabular-nums">—</span>
    ) : isBidding ? (
      <span className="text-gold-100 font-bold tabular-nums">{bid}</span>
    ) : (
      <span
        className={`font-bold tabular-nums ${
          won > bid
            ? 'text-rose-300'
            : won === bid
              ? 'text-emerald-300'
              : 'text-gold-100'
        }`}
      >
        {won}/{bid}
      </span>
    );

  const padding = compact ? 'px-1.5 py-1' : 'px-2 py-1';
  const nameSize = compact ? 'text-[11px]' : 'text-[12px]';
  const handSizeText = compact ? 'text-[10px]' : 'text-[11px]';

  return (
    <div className="flex flex-col items-stretch min-w-0">
      {label && (
        <span
          className={`text-[9px] uppercase tracking-wider text-center leading-none mb-0.5 truncate ${
            isActive ? 'text-gold-200 font-bold' : 'text-navy-300'
          }`}
        >
          {label}
        </span>
      )}
      <div
        className={`relative rounded-md ${padding} border bg-navy-900/60 ${
          color.border
        } ${
          isActive
            ? `ring-2 ${color.ring} ${color.glow} animate-[pulse_2s_ease-in-out_infinite]`
            : acted
              ? ''
              : 'opacity-70'
        }`}
      >
        <div className="flex items-center justify-between gap-1 leading-tight">
          <span className={`font-semibold truncate ${color.text} ${nameSize}`}>
            {playerName}
          </span>
          <span className="shrink-0">{wonBidNode}</span>
        </div>
        <div className="flex items-center gap-1 mt-0.5">
          <MiniFan count={handSize} />
          <span className={`text-navy-200 tabular-nums ${handSizeText}`}>
            +{handSize}
          </span>
        </div>
        {isDealer && (
          <span
            className="absolute -top-1.5 -left-1.5 w-[18px] h-[18px] rounded-full bg-gold-300 text-navy-900 text-[11px] font-black flex items-center justify-center shadow-md leading-none ring-1 ring-gold-100"
            title="Dealer"
          >
            ♛
          </span>
        )}
        {offline && (
          <span
            className="absolute -top-1 -right-1 h-2 w-2 rounded-full bg-rose-400"
            title="Disconnected"
          />
        )}
      </div>
    </div>
  );
}
