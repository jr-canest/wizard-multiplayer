import type { Card, Suit } from '../lib/types';

type Play = { card: Card };

/**
 * Walk the trick-in-progress to figure out the lead suit (if any) and
 * whether subsequent plays are unconstrained because a Wizard has been played.
 */
export function getLeadInfo(plays: Play[]): {
  leadSuit: Suit | null;
  anyCardLegal: boolean;
} {
  for (const p of plays) {
    if (p.card.kind === 'wizard') {
      return { leadSuit: null, anyCardLegal: true };
    }
    if (p.card.kind === 'standard') {
      return { leadSuit: p.card.suit, anyCardLegal: false };
    }
    // jester: keep scanning
  }
  return { leadSuit: null, anyCardLegal: false };
}

export function isLegalPlay(hand: Card[], card: Card, plays: Play[]): boolean {
  if (card.kind !== 'standard') return true; // wizards/jesters always legal
  const { leadSuit, anyCardLegal } = getLeadInfo(plays);
  if (anyCardLegal) return true;
  if (leadSuit === null) return true;
  if (card.suit === leadSuit) return true;
  const hasLead = hand.some(
    (c) => c.kind === 'standard' && c.suit === leadSuit,
  );
  return !hasLead;
}

export function legalIndices(hand: Card[], plays: Play[]): boolean[] {
  return hand.map((card) => isLegalPlay(hand, card, plays));
}
