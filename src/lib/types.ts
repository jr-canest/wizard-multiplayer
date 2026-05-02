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
  // Player names who've voted that the next round should be the last
  // (used during 'scoring' phase). Cleared once totalRounds is shrunk.
  endEarlyVotes?: string[];
  // Player names who've voted to advance to the next round (used during
  // 'scoring'). Cleared once threshold triggers scoreAndAdvance.
  nextRoundVotes?: string[];
  // Player names who've voted to start a new game (used during
  // 'finished'). Cleared on resetForNewGame.
  playAgainVotes?: string[];
  // Player names who've voted to end the game NOW (immediately finish
  // with current cumulative scores, regardless of how many rounds are
  // left). Cleared once the threshold triggers the finish.
  endGameVotes?: string[];
  // Most recent reaction broadcast by any player. Clients show it briefly
  // based on `ts` (epoch ms, client-set — no clock-skew sensitivity since
  // it's a soft TTL, not a correctness check).
  lastReaction?: { player: string; text: string; ts: number } | null;
  // Host-chosen cap on rounds. null = play the maximum allowed by the
  // deck for this player count. Clamped at startGame.
  chosenTotalRounds?: number | null;
  // Shared AI recap (or fallback) for the finished game. The first client
  // to claim writes it; everyone else reads it via subscription so the
  // recap is identical across viewers.
  aiSummary?: string | null;
  // Set by the first client to claim the AI fetch so others wait instead
  // of duplicating the request. Cleared on resetForNewGame.
  aiSummaryRequested?: boolean;
  // The most recent undoable action: a snapshot of the state right BEFORE
  // the last bid/play, plus voting state. Cleared when the next action
  // happens (overwritten with that action's snapshot) or when the round
  // is scored and the state is replaced wholesale.
  pendingUndo?: PendingUndo | null;
};

export type UndoSnapshot = {
  bids: Record<string, number>;
  currentPlayerIndex: number;
  trickInProgress: Array<{ playerName: string; card: Card; playOrder: number }>;
  leadSuit: Suit | null;
  status: RoomStatus;
  tricksWon: Record<string, number>;
  trickHistory: Array<{
    round: number;
    trickNum: number;
    plays: Array<{ playerName: string; card: Card }>;
    winner: string;
  }>;
  currentTrick: number;
  log: LogEntry[];
  // Only set for 'play' kind — the actor's hand BEFORE the play.
  handCards?: Card[];
};

export type PendingUndo = {
  kind: 'bid' | 'play';
  actor: string;
  // True once the actor has tapped their "Undo" button. Until then no one
  // else sees a vote prompt.
  requested: boolean;
  votes: string[];
  snapshot: UndoSnapshot;
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
