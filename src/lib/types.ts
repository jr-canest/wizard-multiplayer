export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type StandardCard = { kind: 'standard'; suit: Suit; rank: Rank };
export type WizardCard = { kind: 'wizard'; id: number };
export type JesterCard = { kind: 'jester'; id: number };
export type Card = StandardCard | WizardCard | JesterCard;

export type RoomStatus =
  | 'lobby'
  | 'dealing'
  | 'bidding'
  | 'playing'
  | 'scoring'
  | 'finished';

export type LogEntry =
  | { t: 'deal'; round: number; dealer: string }
  | { t: 'trump'; round: number; card: Card | null; chosenSuit: Suit | null }
  | { t: 'bid'; round: number; player: string; bid: number }
  | { t: 'play'; round: number; trick: number; player: string; card: Card }
  | { t: 'trickWin'; round: number; trick: number; winner: string }
  | { t: 'roundScore'; round: number; scores: Record<string, number> }
  | { t: 'gameOver'; finalScores: Record<string, number> };

export type RoomDoc = {
  status: RoomStatus;
  hostPlayerName: string;
  canadianRule: boolean;
  createdAt: unknown;
  schemaVersion: number;
  playerOrder: string[];
  dealerIndex: number;
  currentPlayerIndex: number;
  currentRound: number;
  currentTrick: number;
  totalRounds: number;
  trumpCard: Card | null;
  trumpSuit: Suit | null;
  awaitingTrumpChoice: boolean;
  leadSuit: Suit | null;
  bids: Record<string, number>;
  tricksWon: Record<string, number>;
  cumulativeScores: Record<string, number>;
  trickInProgress: Array<{ playerName: string; card: Card; playOrder: number }>;
  trickHistory: Array<{
    round: number;
    trickNum: number;
    plays: Array<{ playerName: string; card: Card }>;
    winner: string;
  }>;
  log: LogEntry[];
  historyWritten: boolean;
  historyGameId: string | null;
};

export type RoomPlayerDoc = {
  authUid: string;
  connected: boolean;
  lastHeartbeatAt: unknown;
  voteKickAgainst: string | null;
};

export type HandDoc = {
  cards: Card[];
};
