/**
 * Game actions, as messages to the room's game server. Same names and
 * signatures the components have always called; the rules themselves now
 * run in src/game/engine.ts on the server, and the answer comes back as an
 * ack that either resolves or throws the same FlowError codes as before.
 *
 * The Firestore-era implementation is kept as gameFlowFirestore.ts for
 * reference only; nothing imports it.
 */
import { connectionFor, ActionError } from './socket';
import type { RoomDoc, RoundVoteKind, Suit, Card } from './types';
export { violatesCanadianRule } from '../game/canadianRule';
export {
  computeRoundDeltas,
  cumulativeScoresFromLog,
  pruneRoundFromLog,
  roundArchiveOf,
} from '../game/engine';

export class FlowError extends Error {
  code: string;
  constructor(code: string) {
    super(code);
    this.code = code;
  }
}

async function act<T = void>(code: string, action: string, ...args: unknown[]): Promise<T> {
  try {
    return await connectionFor(code).act<T>(action, ...args);
  } catch (err) {
    throw new FlowError(err instanceof ActionError ? err.code : 'failed');
  }
}

export async function postReaction(code: string, _player: string, text: string): Promise<void> {
  await act(code, 'postReaction', text);
}

export async function setChosenTotalRounds(code: string, _caller: string, rounds: number | null): Promise<void> {
  await act(code, 'setChosenTotalRounds', rounds);
}

export async function startGame(code: string, _caller: string): Promise<void> {
  await act(code, 'startGame');
}

export async function chooseTrumpSuit(code: string, _caller: string, suit: Suit): Promise<void> {
  await act(code, 'chooseTrumpSuit', suit);
}

export async function placeBid(code: string, _caller: string, bid: number, _localRoom?: RoomDoc): Promise<void> {
  await act(code, 'placeBid', bid);
}

export type LocalPlayState = { room: RoomDoc; hand: Card[] };

export async function playCard(code: string, _caller: string, cardIndex: number, _local?: LocalPlayState): Promise<void> {
  await act(code, 'playCard', cardIndex);
}

export async function voteNextRound(code: string, _caller: string, voteYes: boolean): Promise<void> {
  await act(code, 'voteNextRound', voteYes);
}

export async function openRoundVote(code: string, _caller: string, kind: RoundVoteKind): Promise<void> {
  await act(code, 'openRoundVote', kind);
}

export async function castRoundVote(code: string, _caller: string, voteYes: boolean): Promise<void> {
  await act(code, 'castRoundVote', voteYes);
}

export async function cancelRoundVote(code: string, _caller: string): Promise<void> {
  await act(code, 'cancelRoundVote');
}

/** The server runs the vote clocks itself now; kept so callers need no change. */
export async function resolveExpiredRoundVote(_code: string): Promise<void> {}
export async function resolveExpiredUndo(_code: string): Promise<void> {}

export async function requestUndo(code: string, _caller: string): Promise<void> {
  await act(code, 'requestUndo');
}

export async function voteUndo(code: string, _caller: string, voteYes: boolean): Promise<void> {
  await act(code, 'voteUndo', voteYes);
}

export async function votePlayAgain(code: string, _caller: string, voteYes: boolean): Promise<void> {
  await act(code, 'votePlayAgain', voteYes);
}

export async function resetForNewGame(code: string, _caller: string): Promise<void> {
  await act(code, 'resetForNewGame');
}

export async function claimAiSummary(code: string): Promise<boolean> {
  return act<boolean>(code, 'claimAiSummary');
}

export async function setSharedAiSummary(code: string, summary: string): Promise<void> {
  await act(code, 'setSharedAiSummary', summary);
}

/** Exactly-once guard for writing the finished game into History. */
export async function claimHistory(code: string): Promise<{ go: boolean; existingId?: string | null }> {
  return act(code, 'claimHistory');
}

export async function markHistorySaved(code: string, gameId: string | null): Promise<void> {
  await act(code, 'markHistorySaved', gameId);
}
