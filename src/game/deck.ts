import type { Card, Rank, Suit } from '../lib/types';

const SUITS: Suit[] = ['H', 'D', 'C', 'S'];
const RANKS: Rank[] = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function buildDeck(): Card[] {
  const cards: Card[] = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      cards.push({ kind: 'standard', suit, rank });
    }
  }
  for (let id = 1; id <= 4; id++) cards.push({ kind: 'wizard', id });
  for (let id = 1; id <= 4; id++) cards.push({ kind: 'jester', id });
  return cards;
}

export function shuffle<T>(deck: T[]): T[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export type Deal = {
  hands: Record<string, Card[]>;
  trumpCard: Card | null;
};

/**
 * Deal `cardsPerPlayer` cards to each name in `playerOrder`, then flip the
 * top of the remaining deck as the trump card (null if deck exhausted).
 */
export function deal(
  playerOrder: string[],
  cardsPerPlayer: number,
  deck: Card[],
): Deal {
  const working = deck.slice();
  const hands: Record<string, Card[]> = {};
  for (const name of playerOrder) hands[name] = [];

  for (let i = 0; i < cardsPerPlayer; i++) {
    for (const name of playerOrder) {
      const card = working.pop();
      if (!card) throw new Error('Deck exhausted mid-deal');
      hands[name].push(card);
    }
  }

  const trumpCard = working.length > 0 ? (working.pop() ?? null) : null;
  return { hands, trumpCard };
}

export function totalRoundsFor(playerCount: number): number {
  return Math.floor(60 / playerCount);
}
