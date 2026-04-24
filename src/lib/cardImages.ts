import type { Card, Rank, Suit } from './types';

const RANK_TO_FILENAME: Record<Rank, string> = {
  2: '2',
  3: '3',
  4: '4',
  5: '5',
  6: '6',
  7: '7',
  8: '8',
  9: '9',
  10: '10',
  11: 'J',
  12: 'Q',
  13: 'K',
  14: 'A',
};

const SUIT_TO_FILENAME: Record<Suit, string> = {
  H: 'H',
  D: 'D',
  C: 'C',
  S: 'S',
};

const BASE = `${import.meta.env.BASE_URL}cards/`;

// All four wizards share one image; same for jesters. Distinguished only by
// internal `id` so the dealing logic can place 4 of each into the deck.
export function cardImageUrl(card: Card): string {
  if (card.kind === 'wizard') return `${BASE}Wizard.jpg`;
  if (card.kind === 'jester') return `${BASE}Jester.jpg`;
  return `${BASE}${RANK_TO_FILENAME[card.rank]}${SUIT_TO_FILENAME[card.suit]}.jpg`;
}

export function cardLabel(card: Card): string {
  if (card.kind === 'wizard') return 'Wizard';
  if (card.kind === 'jester') return 'Jester';
  const rankName =
    card.rank === 11
      ? 'J'
      : card.rank === 12
        ? 'Q'
        : card.rank === 13
          ? 'K'
          : card.rank === 14
            ? 'A'
            : String(card.rank);
  return `${rankName}${card.suit}`;
}
