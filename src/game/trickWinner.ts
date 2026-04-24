import type { Card, Suit } from '../lib/types';

type Play = { card: Card };

/**
 * Returns the index of the winning play within `plays`, in play order.
 *
 * Order of priority:
 *   1. First Wizard wins.
 *   2. Highest trump wins (if a trump suit is in effect).
 *   3. Highest card of the lead suit wins.
 *   4. All-jesters: the first Jester played wins.
 */
export function winningPlayIndex(
  plays: Play[],
  trumpSuit: Suit | null,
): number {
  for (let i = 0; i < plays.length; i++) {
    if (plays[i].card.kind === 'wizard') return i;
  }

  let leadSuit: Suit | null = null;
  for (const p of plays) {
    if (p.card.kind === 'standard') {
      leadSuit = p.card.suit;
      break;
    }
  }

  if (trumpSuit !== null) {
    let bestIdx = -1;
    let bestRank = -1;
    for (let i = 0; i < plays.length; i++) {
      const c = plays[i].card;
      if (c.kind === 'standard' && c.suit === trumpSuit && c.rank > bestRank) {
        bestRank = c.rank;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) return bestIdx;
  }

  if (leadSuit !== null) {
    let bestIdx = -1;
    let bestRank = -1;
    for (let i = 0; i < plays.length; i++) {
      const c = plays[i].card;
      if (c.kind === 'standard' && c.suit === leadSuit && c.rank > bestRank) {
        bestRank = c.rank;
        bestIdx = i;
      }
    }
    if (bestIdx >= 0) return bestIdx;
  }

  // All-jesters trick: first played wins.
  return 0;
}
