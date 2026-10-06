import type { RoomSnapshot } from '../hooks/useRoom';

export type CalloutTone = 'gold' | 'fire' | 'wizard' | 'spade';

export type TrickCallout = { text: string; tone: CalloutTone };

/**
 * The one extra line for the trick that just resolved, shown under the
 * "X won" banner on the felt (2026-10-06: these used to be a separate
 * center-screen overlay that landed on top of the banner). The banner
 * already names the winner, so the line never repeats the name.
 *
 * One line per trick, strongest first: a wizard killing a high trump, then
 * winning past your bid, then a run of wins in this round, then the ace of
 * spades when it was the card that closed the trick.
 */
export function trickCallout(room: RoomSnapshot, myName: string): TrickCallout | null {
  const hist = room.trickHistory;
  const last = hist[hist.length - 1];
  if (!last || last.round !== room.currentRound) return null;
  const isMe = last.winner === myName;

  // Wizard kill: a wizard took a trick holding a high trump (J+).
  const winnerPlay = last.plays.find((p) => p.playerName === last.winner);
  if (winnerPlay?.card.kind === 'wizard' && room.trumpSuit) {
    const trump = room.trumpSuit;
    const killed = last.plays.some(
      (p) => p.card.kind === 'standard' && p.card.suit === trump && p.card.rank >= 11,
    );
    if (killed) return { text: 'WIZARD KILL!', tone: 'wizard' };
  }

  // Winning tricks nobody asked for.
  const bid = room.bids[last.winner];
  const won = room.tricksWon[last.winner] ?? 0;
  if (bid !== undefined && won > bid) {
    const over = won - bid;
    const text =
      over === 1
        ? 'ONE TOO MANY'
        : over === 2
          ? "CAN'T STOP WINNING"
          : isMe
            ? 'MAKE IT STOP'
            : 'SOMEONE STOP THEM';
    return { text, tone: 'fire' };
  }

  // Same winner on consecutive tricks of this round.
  let streak = 0;
  for (let i = hist.length - 1; i >= 0; i--) {
    const e = hist[i];
    if (e.round === last.round && e.winner === last.winner) streak++;
    else break;
  }
  if (streak >= 2) {
    const text =
      streak === 2
        ? '2 IN A ROW'
        : streak === 3
          ? 'ON FIRE'
          : streak === 4
            ? 'UNSTOPPABLE'
            : isMe
              ? 'YOU OWN THIS ROUND'
              : 'OWNS THIS ROUND';
    return { text, tone: 'fire' };
  }

  const closer = last.plays[last.plays.length - 1]?.card;
  if (closer?.kind === 'standard' && closer.suit === 'S' && closer.rank === 14) {
    return { text: 'THE ACE OF SPADES', tone: 'spade' };
  }
  return null;
}
