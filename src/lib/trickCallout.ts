import type { RoomSnapshot } from '../hooks/useRoom';
import type { Card, Suit } from './types';
import { getLeadInfo } from '../game/legalMoves';
import { winningPlayIndex } from '../game/trickWinner';

export type CalloutTone = 'gold' | 'fire' | 'wizard' | 'spade';

export type TrickCallout = { text: string; tone: CalloutTone };

export const SKIP_TEXT = 'SKIP, SKIP, SKIP';
export const BABY_TRUMP_TEXT = 'BABY TRUMP!';

/**
 * A 2 or 3 of trump that takes the lead of a trick led in another suit
 * (Jorge, 2026-10-10). Not when trump was led (that is just following
 * suit) or a Wizard is already down (nothing beats it). `plays` is the
 * trick up to and including the card at `index`.
 */
export function isBabyTrump(plays: { card: Card }[], index: number, trumpSuit: Suit | null): boolean {
  const c = plays[index]?.card;
  if (!trumpSuit || c?.kind !== 'standard' || c.suit !== trumpSuit || c.rank > 3) return false;
  const before = getLeadInfo(plays.slice(0, index));
  if (before.anyCardLegal || before.leadSuit === null || before.leadSuit === trumpSuit) return false;
  return winningPlayIndex(plays.slice(0, index + 1), trumpSuit) === index;
}

/**
 * The one extra line for the trick that just resolved, shown under the
 * "X won" banner on the felt (2026-10-06: these used to be a separate
 * center-screen overlay that landed on top of the banner). The banner
 * already names the winner, so the line never repeats the name.
 *
 * One line per trick, strongest first: a wizard killing a high trump, then
 * winning past your bid, then a baby trump that closed and won it, then a
 * run of wins in this round, then the ace of spades or a jester when it was
 * the card that closed the trick (mid-trick ones are called out the moment
 * they land, in CommentaryOverlay).
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

  // The closing card was a baby trump that took the trick.
  if (isBabyTrump(last.plays, last.plays.length - 1, room.trumpSuit)) {
    return { text: BABY_TRUMP_TEXT, tone: 'fire' };
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
  if (closer?.kind === 'jester') return { text: SKIP_TEXT, tone: 'gold' };
  return null;
}
