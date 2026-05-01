import type { Card, Suit } from './types';

const SUIT_ORDER: Record<Suit, number> = { S: 0, H: 1, D: 2, C: 3 };

function sortKey(c: Card): number {
  // Wizards first, jesters last; standards in suit then rank-desc.
  if (c.kind === 'wizard') return -10_000 + c.id;
  if (c.kind === 'jester') return 10_000 + c.id;
  return SUIT_ORDER[c.suit] * 100 + (14 - c.rank);
}

/**
 * Returns the hand sorted by suit + value, paired with each card's original
 * index in the underlying Firestore array. The original index is needed
 * because playCard takes an index into the unsorted hand.
 */
export function sortHandWithIndex(
  hand: Card[],
): Array<{ card: Card; originalIndex: number }> {
  return hand
    .map((card, originalIndex) => ({ card, originalIndex }))
    .sort((a, b) => sortKey(a.card) - sortKey(b.card));
}
