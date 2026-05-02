import { colorForViewer } from '../lib/playerColors';
import { isConnected } from '../lib/presence';
import type { Suit } from '../lib/types';
import type { RoomSnapshot, PlayerSnapshot } from '../hooks/useRoom';

const SUIT_GLYPH: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_TONE: Record<Suit, string> = {
  H: 'text-rose-300',
  D: 'text-sky-300',
  C: 'text-emerald-300',
  S: 'text-navy-50',
};

type Props = {
  room: RoomSnapshot;
  myName: string;
  playerName: string;
  playerMeta: PlayerSnapshot | undefined;
};

/**
 * Narrow vertical tile: name on top, big tabular won/bid in the middle
 * (color-coded blue/green/red for under/exact/over once playing has
 * started), short status word at the bottom. Sized to fit 3 down each
 * side column even with 10-player games.
 */
export function OpponentTile({
  room,
  myName,
  playerName,
  playerMeta,
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

  // Whoever's up next after the active player.
  const nextIdx = isActive ? (room.currentPlayerIndex + 1) % N : -1;
  const isNext =
    !isActive &&
    activeName !== null &&
    seatIdx === nextIdx &&
    nextIdx !== myIdx;

  const bid = room.bids[playerName];
  const won = room.tricksWon[playerName] ?? 0;
  const color = colorForViewer(playerName, myName, room.playerOrder);
  const offline = playerMeta ? !isConnected(playerMeta) : false;

  const acted =
    !isActive &&
    ((isBidding && bid !== undefined) ||
      (isPlaying &&
        room.trickInProgress.some((p) => p.playerName === playerName)));

  // Card the player just played in the current trick.
  const inTrick = room.trickInProgress.find(
    (p) => p.playerName === playerName,
  );
  const playedChip = (() => {
    if (!inTrick) return null;
    const c = inTrick.card;
    if (c.kind === 'wizard') return { text: 'W', tone: 'text-sky-200' } as const;
    if (c.kind === 'jester')
      return { text: 'J', tone: 'text-amber-300' } as const;
    const rankStr =
      c.rank > 10 ? ['J', 'Q', 'K', 'A'][c.rank - 11] : String(c.rank);
    return {
      text: `${rankStr}${SUIT_GLYPH[c.suit]}`,
      tone: SUIT_TONE[c.suit],
    } as const;
  })();

  // Status word at the bottom of the tile.
  let label = '';
  if (isActive) label = isBidding ? 'Bidding' : 'Playing';
  else if (isNext) label = 'Next';
  else if (acted && isPlaying) label = '✓ Played';
  else if (acted && isBidding) label = 'Bid in';
  else if (isBidding || isPlaying) label = 'Waiting';

  // Big middle line: won/bid (with color) once play starts; just bid
  // during bidding; em-dash when nothing yet.
  let bigLine: React.ReactNode;
  let bigTone = 'text-navy-300';
  if (bid === undefined) {
    bigLine = '—';
    bigTone = 'text-navy-400';
  } else if (isBidding) {
    bigLine = bid;
    bigTone = 'text-gold-100';
  } else {
    bigLine = `${won}/${bid}`;
    bigTone =
      won > bid
        ? 'text-rose-300'
        : won === bid
          ? 'text-emerald-300'
          : 'text-sky-300';
  }

  return (
    <div
      data-player={playerName}
      className={`relative rounded-md py-1 px-1 border bg-navy-900/65 ${
        color.border
      } transition-opacity flex flex-col items-center justify-between min-h-[68px] ${
        isActive
          ? `ring-2 ${color.ring} ${color.glow} animate-[pulse_2s_ease-in-out_infinite]`
          : acted
            ? 'opacity-55'
            : ''
      }`}
    >
      <div
        className={`w-full text-[10px] font-semibold truncate text-center leading-tight ${color.text}`}
        title={playerName}
      >
        {playerName}
      </div>
      <div
        className={`text-[18px] font-black tabular-nums leading-none ${bigTone}`}
      >
        {bigLine}
      </div>
      <div className="text-[8px] uppercase tracking-wider text-navy-300 leading-none truncate w-full text-center">
        {label || ' '}
      </div>
      {isDealer && (
        <span
          className="absolute -top-1.5 -left-1.5 w-[16px] h-[16px] rounded-full bg-gold-300 text-navy-900 text-[10px] font-black flex items-center justify-center shadow-md leading-none ring-1 ring-gold-100"
          title="Dealer"
        >
          ♛
        </span>
      )}
      {playedChip && (
        <span
          className={`absolute -top-2 -right-1.5 bg-navy-900/90 ${playedChip.tone} text-[10px] font-bold rounded px-1 py-0.5 shadow-md ring-1 ring-gold-700/60 leading-none`}
          title="Played card"
        >
          {playedChip.text}
        </span>
      )}
      {offline && (
        <span
          className="absolute bottom-0.5 right-0.5 h-1.5 w-1.5 rounded-full bg-rose-400"
          title="Disconnected"
        />
      )}
    </div>
  );
}
