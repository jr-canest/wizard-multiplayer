export type Suit = 'H' | 'D' | 'C' | 'S';
export type Rank = 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 | 14;

export type StandardCard = { kind: 'standard'; suit: Suit; rank: Rank };
export type WizardCard = { kind: 'wizard'; id: number };
export type JesterCard = { kind: 'jester'; id: number };
export type Card = StandardCard | WizardCard | JesterCard;

/** Strength of a computer player seated in a room. */
export type BotDifficulty = 'easy' | 'medium' | 'expert';

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
  // Computer players seated in this room, keyed by seat name. Every
  // "real player" check (votes, presence, the history guard) reads this
  // map; the host's device drives their moves (useBotDriver).
  bots?: Record<string, BotDifficulty>;
  // Player names who've tapped "next round" on the score page (or
  // "finish game" on the final round). Unanimous mid-game, majority on
  // the final round. A quiet tally on purpose, not a pop-up.
  nextRoundVotes?: string[];
  // LEGACY (pre 2026-09-18) tally for "next round is last". Replaced by
  // `pendingVote`; still cleared at the same points so a client on an
  // older build does not see stale votes. Nothing reads it.
  endEarlyVotes?: string[];
  // The one pop-up vote that can be open at a time: make the next round
  // the last, or end the game now. Opening one puts a yes/no modal in
  // front of every real player (RoundVoteModal).
  pendingVote?: PendingVote | null;
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
  // LEGACY freeform chat. Superseded 2026-09-17 by the rooms/{code}/chat
  // subcollection (see src/lib/chat.ts): keeping chat on this document
  // meant every message re-pushed the whole room doc to every phone.
  // Still READ so a client that has not picked up the new build yet can
  // be seen; nothing writes to it any more.
  chat?: Array<{ player: string; text: string; ts: number }>;
  // Chat-window generation, bumped on resetForNewGame so a second game's
  // lobby chat starts clean instead of reopening the first game's.
  chatGen?: number;
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
  currentTrick: number;
  // `log` and `trickHistory` only ever GROW between the snapshot and the
  // undo, so the snapshot stores their lengths and the undo truncates.
  // Copying the arrays doubled the room document on every play (each
  // phone downloads the whole doc per move — read as lag late in games).
  logLen?: number;
  trickHistoryLen?: number;
  // Legacy shape (pre 2026-09-09): full copies. Still honoured on restore.
  trickHistory?: Array<{
    round: number;
    trickNum: number;
    plays: Array<{ playerName: string; card: Card }>;
    winner: string;
  }>;
  log?: LogEntry[];
  // Only set for 'play' kind — the actor's hand BEFORE the play.
  handCards?: Card[];
};

export type PendingUndo = {
  kind: 'bid' | 'play';
  actor: string;
  // True once the actor has tapped their "Undo" button. Until then no one
  // else sees a vote prompt. Once true the game is PAUSED: placeBid and
  // playCard refuse, and the bot driver holds off, until the vote lands.
  requested: boolean;
  // Approvals, seeded with the actor (asking counts as approving).
  votes: string[];
  // Explicit rejections. Once enough players have said no that approval
  // can no longer reach the threshold, the request is denied and play
  // resumes immediately instead of waiting out the clock.
  noVotes?: string[];
  // Epoch ms the vote opened. The modal counts down from it, and any
  // client may clear an expired vote, so one sleeping phone can never
  // freeze the table.
  requestedAt?: number;
  // What is on the table, purely for the vote modal's wording.
  bidValue?: number;
  card?: Card;
  snapshot: UndoSnapshot;
};

/** How long a requested undo vote stays open before any client clears it. */
export const UNDO_VOTE_TTL_MS = 45_000;

export type RoundVoteKind = 'lastRound' | 'endGame';

/**
 * A round-end vote in flight. One at a time. `yes` is seeded with the
 * opener (asking is a yes); a majority of real players carries it, and
 * enough `no` votes to put that majority out of reach dismisses it.
 */
export type PendingVote = {
  kind: RoundVoteKind;
  by: string;
  at: number;
  yes: string[];
  no: string[];
};

/** How long a round-end vote stays open before any client clears it. */
export const ROUND_VOTE_TTL_MS = 60_000;

export type RoomPlayerDoc = {
  authUid: string;
  // Set on computer seats so presence never counts them as offline.
  isBot?: boolean;
  connected: boolean;
  lastHeartbeatAt: unknown;
  voteKickAgainst: string | null;
};

export type HandDoc = {
  cards: Card[];
};
