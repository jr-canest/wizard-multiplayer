/**
 * The Wizard room as a pure state machine. No Firestore, no timers, no
 * network: every rule from the old gameFlow / rooms / presence modules,
 * operating on one in-memory state and throwing EngineError codes the UI
 * already knows how to show. The Durable Object server (server/) drives it
 * and persists it; the client only ever sees `publicView()`.
 */
import { buildDeck, deal, shuffle, totalRoundsFor } from './deck';
import { getLeadInfo, isLegalPlay } from './legalMoves';
import { winningPlayIndex } from './trickWinner';
import { calcRoundScore } from './scoring';
import { violatesCanadianRule } from './canadianRule';
import { chooseBotBid, chooseBotCard, chooseBotTrump, inferVoids } from './botAI';
import {
  ROUND_VOTE_TTL_MS,
  UNDO_VOTE_TTL_MS,
  type BotDifficulty,
  type Card,
  type LogEntry,
  type PendingUndo,
  type PendingVote,
  type RoomDoc,
  type RoundArchive,
  type RoundVoteKind,
  type Suit,
  type UndoSnapshot,
} from '../lib/types';
import { generateRoomCode } from '../lib/codes';

export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;
export const CHAT_MAX_LEN = 200;

export type EngineErrorCode =
  // gameFlow's FlowError codes
  | 'notHost' | 'notLobby' | 'notEnoughPlayers' | 'notDealer' | 'notAwaiting'
  | 'notBidding' | 'notYourTurn' | 'invalidBid' | 'canadianRuleViolation'
  | 'notPlaying' | 'invalidCard' | 'illegalPlay' | 'notScoring' | 'notFinished'
  | 'undoVoteOpen'
  // rooms' RoomError codes
  | 'codeCollision' | 'roomNotFound' | 'roomFull' | 'gameStarted' | 'nameTaken'
  | 'notSeated';

export class EngineError extends Error {
  code: EngineErrorCode;
  constructor(code: EngineErrorCode) {
    super(code);
    this.code = code;
  }
}

export type ChatMessage = { player: string; text: string; ts: number; w: string };

/** Everything the server knows about one room. */
export type EngineState = {
  room: RoomDoc & { code: string };
  hands: Record<string, Card[]>;
  archives: Record<number, RoundArchive>;
  chat: ChatMessage[];
  /** voter -> target, the disconnect kick votes. */
  kickVotes: Record<string, string | null>;
  /** Names that hold a seat token, i.e. joined at least once. */
  seated: string[];
};

/** Presence the server knows and the engine needs for tallies. */
export type Presence = { connected: (name: string) => boolean };

// ─── names, bots ─────────────────────────────────────────────────────────

export const BOT_NAME_PREFIX = 'Bot-';
export function isBotName(name: string): boolean {
  return name.startsWith(BOT_NAME_PREFIX);
}
export const BOT_NAME_POOL = [
  'Merlin', 'Morgana', 'Gandalf', 'Radagast', 'Prospero', 'Circe',
  'Saruman', 'Medea', 'Elminster', 'Zatanna', 'Alatar', 'Rincewind',
] as const;

export function isBot(room: Pick<RoomDoc, 'bots'>, name: string): boolean {
  return Boolean(room.bots?.[name]) || isBotName(name);
}
export function botDifficultyOf(room: Pick<RoomDoc, 'bots'>, name: string): BotDifficulty | null {
  const d = room.bots?.[name];
  if (d) return d;
  return isBotName(name) ? 'medium' : null;
}
function nextBotName(taken: string[]): string {
  const lower = new Set(taken.map((n) => n.trim().toLowerCase()));
  for (const candidate of BOT_NAME_POOL) if (!lower.has(candidate.toLowerCase())) return candidate;
  let i = 2;
  while (lower.has(`wizard ${i}`)) i++;
  return `Wizard ${i}`;
}
function realPlayers(room: RoomDoc): string[] {
  return room.playerOrder.filter((n) => !isBot(room, n));
}
function majority(n: number): number {
  return Math.floor(n / 2) + 1;
}

// ─── log helpers (same as the Firestore-era ones) ────────────────────────

const HEAVY_LOG_TYPES = new Set<LogEntry['t']>(['bid', 'play', 'trickWin']);
function isRoundEntry(e: LogEntry): e is Exclude<LogEntry, { t: 'gameOver' }> {
  return e.t !== 'gameOver';
}
export function pruneRoundFromLog(log: LogEntry[], round: number): LogEntry[] {
  return log.filter((e) => !(isRoundEntry(e) && e.round === round && HEAVY_LOG_TYPES.has(e.t)));
}
export function roundArchiveOf(room: Pick<RoomDoc, 'log' | 'trickHistory'>, round: number): RoundArchive {
  return {
    round,
    log: room.log.filter((e) => isRoundEntry(e) && e.round === round),
    tricks: room.trickHistory.filter((t) => t.round === round),
  };
}
export function cumulativeScoresFromLog(playerOrder: string[], log: LogEntry[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of playerOrder) out[name] = 0;
  for (const entry of log) {
    if (entry.t === 'roundScore') for (const name of playerOrder) out[name] = (out[name] ?? 0) + (entry.scores[name] ?? 0);
  }
  return out;
}
export function computeRoundDeltas(playerOrder: string[], bids: Record<string, number>, tricksWon: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = {};
  for (const name of playerOrder) out[name] = calcRoundScore(bids[name] ?? 0, tricksWon[name] ?? 0);
  return out;
}
/** The whole game log: archived rounds plus what is still on the room. */
export function fullLog(s: EngineState): LogEntry[] {
  const rounds = Object.keys(s.archives).map(Number);
  if (rounds.length === 0) return s.room.log;
  const last = Math.max(s.room.currentRound, ...rounds);
  const out: LogEntry[] = [];
  for (let r = 1; r <= last; r++) {
    const a = s.archives[r];
    out.push(...(a ? a.log : s.room.log.filter((e) => e.t !== 'gameOver' && e.round === r)));
  }
  for (const e of s.room.log) if (e.t === 'gameOver') out.push(e);
  return out;
}

export function chatWindowKey(room: RoomDoc): string {
  const gen = room.chatGen ?? 0;
  if (room.status === 'lobby') return `${gen}:lobby`;
  if (room.status === 'finished') return `${gen}:final`;
  return `${gen}:r${room.currentRound}`;
}

// ─── creation, seating ──────────────────────────────────────────────────

export function createState(args: { code?: string; hostName: string; canadianRule: boolean; withBots?: boolean }): EngineState {
  const botNames: string[] = [];
  if (args.withBots) while (botNames.length < 3) botNames.push(nextBotName([args.hostName, ...botNames]));
  const bots: Record<string, BotDifficulty> = {};
  for (const n of botNames) bots[n] = 'medium';
  const playerOrder = [args.hostName, ...botNames];
  const cumulativeScores: Record<string, number> = {};
  for (const n of playerOrder) cumulativeScores[n] = 0;
  const room: RoomDoc & { code: string } = {
    code: args.code ?? generateRoomCode(),
    status: 'lobby',
    hostPlayerName: args.hostName,
    canadianRule: args.canadianRule,
    createdAt: Date.now(),
    schemaVersion: 2,
    playerOrder,
    dealerIndex: 0,
    currentPlayerIndex: 0,
    currentRound: 0,
    currentTrick: 0,
    totalRounds: 0,
    trumpCard: null,
    trumpSuit: null,
    awaitingTrumpChoice: false,
    leadSuit: null,
    bids: {},
    tricksWon: {},
    cumulativeScores,
    trickInProgress: [],
    trickHistory: [],
    log: [],
    historyWritten: false,
    historyGameId: null,
    bots,
    chatGen: 0,
  };
  return { room, hands: {}, archives: {}, chat: [], kickVotes: {}, seated: [args.hostName] };
}

/** A human takes (or retakes) a seat. Same name = reconnect. */
export function join(s: EngineState, name: string): void {
  const r = s.room;
  if (isBot(r, name)) throw new EngineError('nameTaken');
  if (r.playerOrder.includes(name)) {
    if (!s.seated.includes(name)) s.seated.push(name);
    return;
  }
  if (r.status !== 'lobby') throw new EngineError('gameStarted');
  if (r.playerOrder.length >= MAX_PLAYERS) throw new EngineError('roomFull');
  r.playerOrder.push(name);
  r.cumulativeScores[name] = 0;
  s.seated.push(name);
}

export function leave(s: EngineState, name: string): void {
  const r = s.room;
  if (r.status !== 'lobby') return;
  r.playerOrder = r.playerOrder.filter((n) => n !== name);
  delete r.cumulativeScores[name];
  s.seated = s.seated.filter((n) => n !== name);
}

export function addBot(s: EngineState, host: string, difficulty: BotDifficulty): string {
  const r = s.room;
  if (r.hostPlayerName !== host) throw new EngineError('notHost');
  if (r.status !== 'lobby') throw new EngineError('notLobby');
  if (r.playerOrder.length >= MAX_PLAYERS) throw new EngineError('roomFull');
  const name = nextBotName(r.playerOrder);
  r.playerOrder.push(name);
  r.cumulativeScores[name] = 0;
  r.bots = { ...(r.bots ?? {}), [name]: difficulty };
  return name;
}

export function removeBot(s: EngineState, host: string, botName: string): void {
  const r = s.room;
  if (r.hostPlayerName !== host) throw new EngineError('notHost');
  if (r.status !== 'lobby') throw new EngineError('notLobby');
  if (!isBot(r, botName)) return;
  r.playerOrder = r.playerOrder.filter((n) => n !== botName);
  delete r.cumulativeScores[botName];
  const bots = { ...(r.bots ?? {}) };
  delete bots[botName];
  r.bots = bots;
}

export function setChosenTotalRounds(s: EngineState, host: string, rounds: number | null): void {
  const r = s.room;
  if (r.hostPlayerName !== host || r.status !== 'lobby') return;
  r.chosenTotalRounds = rounds;
}

// ─── rounds ─────────────────────────────────────────────────────────────

export function startGame(s: EngineState, host: string): void {
  const r = s.room;
  if (r.hostPlayerName !== host) throw new EngineError('notHost');
  if (r.status !== 'lobby') throw new EngineError('notLobby');
  if (r.playerOrder.length < MIN_PLAYERS) throw new EngineError('notEnoughPlayers');
  const maxRounds = totalRoundsFor(r.playerOrder.length);
  const chosen = r.chosenTotalRounds;
  r.totalRounds = chosen && chosen > 0 ? Math.min(chosen, maxRounds) : maxRounds;
  r.currentRound = 0;
  r.dealerIndex = 0;
  dealNextRound(s);
}

function dealNextRound(s: EngineState): void {
  const r = s.room;
  const playerCount = r.playerOrder.length;
  const nextRound = r.currentRound + 1;
  const totalRounds = r.totalRounds || totalRoundsFor(playerCount);
  const dealerIndex = nextRound === 1 ? r.dealerIndex : (r.dealerIndex + 1) % playerCount;

  const { hands, trumpCard: dealtTrump } = deal(r.playerOrder, nextRound, shuffle(buildDeck()));
  // House rule: the declared final round always plays without trump.
  const trumpCard = nextRound >= totalRounds ? null : dealtTrump;
  let trumpSuit: Suit | null = null;
  let awaitingTrumpChoice = false;
  if (trumpCard) {
    if (trumpCard.kind === 'standard') trumpSuit = trumpCard.suit;
    else if (trumpCard.kind === 'wizard') awaitingTrumpChoice = true;
  }
  const tricksWon: Record<string, number> = {};
  for (const name of r.playerOrder) tricksWon[name] = 0;

  // The round just scored (if any) moves to its archive; the room keeps
  // only its light entries.
  const finished = r.currentRound;
  let log = r.log;
  if (finished >= 1) {
    s.archives[finished] = roundArchiveOf(r, finished);
    log = pruneRoundFromLog(log, finished);
  }
  const dealLog: LogEntry = { t: 'deal', round: nextRound, dealer: r.playerOrder[dealerIndex] };
  const trumpLog: LogEntry = { t: 'trump', round: nextRound, card: trumpCard, chosenSuit: trumpSuit };

  Object.assign(r, {
    status: awaitingTrumpChoice ? 'dealing' : 'bidding',
    currentRound: nextRound,
    currentTrick: 0,
    totalRounds,
    dealerIndex,
    currentPlayerIndex: (dealerIndex + 1) % playerCount,
    trumpCard,
    trumpSuit,
    awaitingTrumpChoice,
    leadSuit: null,
    bids: {},
    tricksWon,
    trickInProgress: [],
    trickHistory: [],
    log: [...log, dealLog, trumpLog],
    nextRoundVotes: [],
    pendingVote: null,
    pendingUndo: null,
  });
  s.hands = hands;
}

export function chooseTrumpSuit(s: EngineState, name: string, suit: Suit): void {
  const r = s.room;
  if (!r.awaitingTrumpChoice) throw new EngineError('notAwaiting');
  if (r.playerOrder[r.dealerIndex] !== name) throw new EngineError('notDealer');
  const last = r.log[r.log.length - 1];
  if (last && last.t === 'trump') r.log = [...r.log.slice(0, -1), { ...last, chosenSuit: suit }];
  r.trumpSuit = suit;
  r.awaitingTrumpChoice = false;
  r.status = 'bidding';
}

export function placeBid(s: EngineState, name: string, bid: number): void {
  const r = s.room;
  if (r.status !== 'bidding') throw new EngineError('notBidding');
  if (r.pendingUndo?.requested) throw new EngineError('undoVoteOpen');
  if (r.playerOrder[r.currentPlayerIndex] !== name) throw new EngineError('notYourTurn');
  const cardsThisRound = r.currentRound;
  if (!Number.isInteger(bid) || bid < 0 || bid > cardsThisRound) throw new EngineError('invalidBid');
  const dealerName = r.playerOrder[r.dealerIndex];
  const otherBidsSum = Object.values(r.bids).reduce((a, b) => a + b, 0);
  if (violatesCanadianRule({ isDealerBid: name === dealerName, canadianRule: r.canadianRule, currentRound: r.currentRound, cardsThisRound, otherBidsSum, bid })) {
    throw new EngineError('canadianRuleViolation');
  }
  const snapshot: UndoSnapshot = {
    bids: r.bids, currentPlayerIndex: r.currentPlayerIndex, trickInProgress: r.trickInProgress, leadSuit: r.leadSuit,
    status: r.status, tricksWon: r.tricksWon, trickHistoryLen: r.trickHistory.length, currentTrick: r.currentTrick, logLen: r.log.length,
  };
  const pendingUndo: PendingUndo = { kind: 'bid', actor: name, requested: false, votes: [], bidValue: bid, snapshot };
  const nextBids = { ...r.bids, [name]: bid };
  const allIn = Object.keys(nextBids).length === r.playerOrder.length;
  r.bids = nextBids;
  r.log = [...r.log, { t: 'bid', round: r.currentRound, player: name, bid }];
  r.pendingUndo = pendingUndo;
  if (allIn) {
    r.status = 'playing';
    r.currentTrick = 1;
    r.currentPlayerIndex = (r.dealerIndex + 1) % r.playerOrder.length;
    r.leadSuit = null;
    r.trickInProgress = [];
  } else {
    r.currentPlayerIndex = (r.currentPlayerIndex + 1) % r.playerOrder.length;
  }
}

export function playCard(s: EngineState, name: string, cardIndex: number): void {
  const r = s.room;
  if (r.status !== 'playing') throw new EngineError('notPlaying');
  if (r.pendingUndo?.requested) throw new EngineError('undoVoteOpen');
  if (r.playerOrder[r.currentPlayerIndex] !== name) throw new EngineError('notYourTurn');
  const hand = s.hands[name] ?? [];
  if (cardIndex < 0 || cardIndex >= hand.length) throw new EngineError('invalidCard');
  const card = hand[cardIndex];
  if (!isLegalPlay(hand, card, r.trickInProgress)) throw new EngineError('illegalPlay');

  const snapshot: UndoSnapshot = {
    bids: r.bids, currentPlayerIndex: r.currentPlayerIndex, trickInProgress: r.trickInProgress, leadSuit: r.leadSuit,
    status: r.status, tricksWon: r.tricksWon, trickHistoryLen: r.trickHistory.length, currentTrick: r.currentTrick, logLen: r.log.length,
    handCards: hand,
  };
  const pendingUndo: PendingUndo = { kind: 'play', actor: name, requested: false, votes: [], card, snapshot };

  const newHand = hand.slice();
  newHand.splice(cardIndex, 1);
  s.hands[name] = newHand;
  const newTrick = [...r.trickInProgress, { playerName: name, card, playOrder: r.trickInProgress.length }];
  const playLog: LogEntry = { t: 'play', round: r.currentRound, trick: r.currentTrick, player: name, card };
  r.pendingUndo = pendingUndo;

  if (newTrick.length < r.playerOrder.length) {
    r.trickInProgress = newTrick;
    r.leadSuit = getLeadInfo(newTrick).leadSuit;
    r.currentPlayerIndex = (r.currentPlayerIndex + 1) % r.playerOrder.length;
    r.log = [...r.log, playLog];
    return;
  }
  // Trick complete.
  const winnerIdx = winningPlayIndex(newTrick, r.trumpSuit);
  const winner = newTrick[winnerIdx].playerName;
  r.tricksWon = { ...r.tricksWon, [winner]: (r.tricksWon[winner] ?? 0) + 1 };
  r.trickHistory = [...r.trickHistory, { round: r.currentRound, trickNum: r.currentTrick, plays: newTrick.map((p) => ({ playerName: p.playerName, card: p.card })), winner }];
  const roundComplete = r.currentTrick >= r.currentRound;
  r.trickInProgress = [];
  r.leadSuit = null;
  r.log = [...r.log, playLog, { t: 'trickWin', round: r.currentRound, trick: r.currentTrick, winner }];
  r.currentPlayerIndex = r.playerOrder.indexOf(winner);
  if (roundComplete) r.status = 'scoring';
  else r.currentTrick += 1;
}

/** Fold the scored round in and deal the next, or finish on the last. */
function scoreAndAdvance(s: EngineState): void {
  const r = s.room;
  if (r.status !== 'scoring') return;
  const deltas = computeRoundDeltas(r.playerOrder, r.bids, r.tricksWon);
  const cumulative = cumulativeScoresFromLog(r.playerOrder, r.log);
  for (const name of r.playerOrder) cumulative[name] = (cumulative[name] ?? 0) + (deltas[name] ?? 0);
  const scoreLog: LogEntry = { t: 'roundScore', round: r.currentRound, scores: deltas };
  r.log = [...r.log, scoreLog];
  r.cumulativeScores = cumulative;
  if (r.currentRound >= r.totalRounds) {
    finish(s, cumulative);
    return;
  }
  dealNextRound(s);
}

/** Finish now with the just-scored round folded in (end-game vote). */
function finishGameNow(s: EngineState): void {
  const r = s.room;
  const deltas = computeRoundDeltas(r.playerOrder, r.bids, r.tricksWon);
  const final = cumulativeScoresFromLog(r.playerOrder, r.log);
  for (const name of r.playerOrder) final[name] = (final[name] ?? 0) + (deltas[name] ?? 0);
  r.log = [...r.log, { t: 'roundScore', round: r.currentRound, scores: deltas }];
  r.cumulativeScores = final;
  finish(s, final);
}

function finish(s: EngineState, final: Record<string, number>): void {
  const r = s.room;
  s.archives[r.currentRound] = roundArchiveOf(r, r.currentRound);
  r.log = [...pruneRoundFromLog(r.log, r.currentRound), { t: 'gameOver', finalScores: final }];
  r.trickHistory = [];
  r.status = 'finished';
  r.pendingUndo = null;
  r.pendingVote = null;
  r.nextRoundVotes = [];
  s.hands = {};
}

// ─── round-end votes ────────────────────────────────────────────────────

export function voteNextRound(s: EngineState, name: string, yes: boolean): void {
  const r = s.room;
  if (r.status !== 'scoring') return;
  const votes = new Set(r.nextRoundVotes ?? []);
  if (yes) votes.add(name); else votes.delete(name);
  const real = realPlayers(r);
  const realVotes = [...votes].filter((n) => real.includes(n));
  const threshold = r.currentRound >= r.totalRounds ? majority(real.length) : real.length;
  if (real.length > 0 && realVotes.length >= threshold) {
    r.nextRoundVotes = [];
    scoreAndAdvance(s);
  } else {
    r.nextRoundVotes = [...votes];
  }
}

function applyRoundVote(s: EngineState, kind: RoundVoteKind): void {
  const r = s.room;
  if (kind === 'lastRound') r.totalRounds = r.currentRound + 1;
  else if (kind === 'endGame') finishGameNow(s);
}

export function openRoundVote(s: EngineState, name: string, kind: RoundVoteKind, now: number): void {
  const r = s.room;
  if (r.status !== 'scoring' || r.pendingVote) return;
  const real = realPlayers(r);
  if (!real.includes(name)) return;
  if (majority(real.length) <= 1) {
    r.pendingVote = null;
    applyRoundVote(s, kind);
    return;
  }
  const vote: PendingVote = { kind, by: name, at: now, yes: [name], no: [] };
  r.pendingVote = vote;
}

export function castRoundVote(s: EngineState, name: string, yes: boolean): void {
  const r = s.room;
  const pv = r.pendingVote;
  if (!pv || r.status !== 'scoring' || name === pv.by) return;
  const real = realPlayers(r);
  if (!real.includes(name)) return;
  const y = new Set(pv.yes.filter((n) => real.includes(n)));
  const n = new Set(pv.no.filter((x) => real.includes(x)));
  if (yes) { y.add(name); n.delete(name); } else { n.add(name); y.delete(name); }
  const threshold = majority(real.length);
  if (y.size >= threshold) {
    r.pendingVote = null;
    applyRoundVote(s, pv.kind);
    return;
  }
  if (real.length - n.size < threshold) { r.pendingVote = null; return; }
  r.pendingVote = { ...pv, yes: [...y], no: [...n] };
}

export function cancelRoundVote(s: EngineState, name: string): void {
  if (s.room.pendingVote?.by === name) s.room.pendingVote = null;
}

/** Returns true if something expired (caller should broadcast). */
export function expireVotes(s: EngineState, now: number): boolean {
  const r = s.room;
  let changed = false;
  if (r.pendingVote && now - r.pendingVote.at >= ROUND_VOTE_TTL_MS) { r.pendingVote = null; changed = true; }
  if (r.pendingUndo?.requested && now - (r.pendingUndo.requestedAt ?? 0) >= UNDO_VOTE_TTL_MS) { r.pendingUndo = null; changed = true; }
  return changed;
}

/** When the next expiry is due, or null. */
export function nextExpiry(s: EngineState): number | null {
  const r = s.room;
  const due: number[] = [];
  if (r.pendingVote) due.push(r.pendingVote.at + ROUND_VOTE_TTL_MS);
  if (r.pendingUndo?.requested) due.push((r.pendingUndo.requestedAt ?? 0) + UNDO_VOTE_TTL_MS);
  return due.length ? Math.min(...due) : null;
}

// ─── undo ───────────────────────────────────────────────────────────────

function undoRestore(s: EngineState, pu: PendingUndo): void {
  const r = s.room;
  const snap = pu.snapshot;
  Object.assign(r, {
    bids: snap.bids,
    currentPlayerIndex: snap.currentPlayerIndex,
    trickInProgress: snap.trickInProgress,
    leadSuit: snap.leadSuit,
    status: snap.status,
    tricksWon: snap.tricksWon,
    trickHistory: snap.trickHistory ?? r.trickHistory.slice(0, snap.trickHistoryLen ?? r.trickHistory.length),
    currentTrick: snap.currentTrick,
    log: snap.log ?? r.log.slice(0, snap.logLen ?? r.log.length),
    pendingUndo: null,
  });
  if (pu.kind === 'play' && snap.handCards) s.hands[pu.actor] = snap.handCards;
}

export function requestUndo(s: EngineState, name: string, now: number): void {
  const r = s.room;
  const pu = r.pendingUndo;
  if (!pu || pu.actor !== name) return;
  if (pu.requested) { r.pendingUndo = { ...pu, requested: false, votes: [], noVotes: [] }; return; }
  const real = realPlayers(r);
  if (majority(real.length) <= 1) { undoRestore(s, pu); return; }
  r.pendingUndo = { ...pu, requested: true, votes: [name], noVotes: [], requestedAt: now };
}

export function voteUndo(s: EngineState, name: string, yes: boolean): void {
  const r = s.room;
  const pu = r.pendingUndo;
  if (!pu || !pu.requested || name === pu.actor) return;
  const real = realPlayers(r);
  if (!real.includes(name)) return;
  const y = new Set(pu.votes.filter((n) => real.includes(n)));
  const n = new Set((pu.noVotes ?? []).filter((x) => real.includes(x)));
  if (yes) { y.add(name); n.delete(name); } else { n.add(name); y.delete(name); }
  const threshold = majority(real.length);
  if (y.size >= threshold) { undoRestore(s, pu); return; }
  if (real.length - n.size < threshold) { r.pendingUndo = null; return; }
  r.pendingUndo = { ...pu, votes: [...y], noVotes: [...n] };
}

// ─── finished: play again, recap, history ───────────────────────────────

function resetForNewGame(s: EngineState): void {
  const r = s.room;
  const cumulativeScores: Record<string, number> = {};
  for (const name of r.playerOrder) cumulativeScores[name] = 0;
  Object.assign(r, {
    status: 'lobby', currentRound: 0, currentTrick: 0, totalRounds: 0, dealerIndex: 0, currentPlayerIndex: 0,
    trumpCard: null, trumpSuit: null, awaitingTrumpChoice: false, leadSuit: null, bids: {}, tricksWon: {}, cumulativeScores,
    trickInProgress: [], trickHistory: [], log: [], historyWritten: false, historyGameId: null, aiSummary: null,
    aiSummaryRequested: false, playAgainVotes: [], nextRoundVotes: [], pendingVote: null, pendingUndo: null,
    chatGen: (r.chatGen ?? 0) + 1,
  });
  s.hands = {};
  s.archives = {};
  s.kickVotes = {};
}

export function votePlayAgain(s: EngineState, name: string, yes: boolean): void {
  const r = s.room;
  if (r.status !== 'finished') return;
  const votes = new Set(r.playAgainVotes ?? []);
  if (yes) votes.add(name); else votes.delete(name);
  const real = realPlayers(r);
  const realVotes = [...votes].filter((n) => real.includes(n));
  if (real.length > 0 && realVotes.length >= real.length) { r.playAgainVotes = []; resetForNewGame(s); }
  else r.playAgainVotes = [...votes];
}

export function hostReset(s: EngineState, host: string): void {
  const r = s.room;
  if (r.status !== 'finished') throw new EngineError('notFinished');
  if (r.hostPlayerName !== host) throw new EngineError('notHost');
  resetForNewGame(s);
}

export function claimAiSummary(s: EngineState): boolean {
  const r = s.room;
  if (r.status !== 'finished' || r.aiSummary || r.aiSummaryRequested) return false;
  r.aiSummaryRequested = true;
  return true;
}
export function setAiSummary(s: EngineState, text: string): void {
  s.room.aiSummary = text;
}

export type HistoryClaim = { go: boolean; existingId?: string | null };
export function claimHistory(s: EngineState): HistoryClaim {
  const r = s.room;
  if (r.status !== 'finished') return { go: false };
  if (r.historyWritten) return { go: false, existingId: r.historyGameId };
  r.historyWritten = true;
  return { go: true };
}
export function markHistorySaved(s: EngineState, gameId: string | null): void {
  s.room.historyGameId = gameId;
}

// ─── chat, reactions ────────────────────────────────────────────────────

export function sendChat(s: EngineState, name: string, text: string, now: number): ChatMessage | null {
  const trimmed = text.trim().slice(0, CHAT_MAX_LEN);
  if (!trimmed) return null;
  const msg: ChatMessage = { player: name, text: trimmed, ts: now, w: chatWindowKey(s.room) };
  s.chat.push(msg);
  if (s.chat.length > 200) s.chat.splice(0, s.chat.length - 200);
  return msg;
}

export function postReaction(s: EngineState, name: string, text: string, now: number): void {
  s.room.lastReaction = { player: name, text, ts: now };
}

// ─── kicks (a disconnected player) ──────────────────────────────────────

export function setVoteKick(s: EngineState, voter: string, target: string | null): void {
  if (!s.room.playerOrder.includes(voter) || isBot(s.room, voter)) return;
  s.kickVotes[voter] = target;
}

/** Eligible = connected real players other than the target; majority kicks. */
export function kickTally(s: EngineState, target: string, presence: Presence): { votes: number; needed: number; voters: string[] } {
  const eligible = realPlayers(s.room).filter((n) => n !== target && presence.connected(n));
  const voters = eligible.filter((n) => s.kickVotes[n] === target);
  return { votes: voters.length, needed: majority(eligible.length), voters };
}

export function executeKick(s: EngineState, target: string): void {
  const r = s.room;
  if (!r.playerOrder.includes(target)) return;
  const oldOrder = r.playerOrder;
  const newOrder = oldOrder.filter((n) => n !== target);
  if (newOrder.length < 2) { r.status = 'finished'; r.playerOrder = newOrder; return; }
  const oldDealer = oldOrder[r.dealerIndex];
  const oldCurrent = oldOrder[r.currentPlayerIndex];
  let dealerIndex = newOrder.indexOf(oldDealer);
  if (dealerIndex === -1) dealerIndex = r.dealerIndex % newOrder.length;
  let currentPlayerIndex = newOrder.indexOf(oldCurrent);
  if (currentPlayerIndex === -1) currentPlayerIndex = (dealerIndex + 1) % newOrder.length;
  const bids = { ...r.bids }; delete bids[target];
  const tricksWon = { ...r.tricksWon }; delete tricksWon[target];
  const cumulativeScores = { ...r.cumulativeScores }; delete cumulativeScores[target];
  Object.assign(r, { playerOrder: newOrder, dealerIndex, currentPlayerIndex, bids, tricksWon, cumulativeScores });
  if (r.status === 'playing' && r.trickInProgress.length > 0) {
    const oldLeader = r.trickInProgress[0]?.playerName;
    const leaderIdx = oldLeader ? newOrder.indexOf(oldLeader) : -1;
    r.trickInProgress = [];
    r.leadSuit = null;
    r.currentPlayerIndex = leaderIdx >= 0 ? leaderIdx : (dealerIndex + 1) % newOrder.length;
  }
  if (r.status === 'bidding') {
    const allIn = newOrder.every((n) => bids[n] !== undefined);
    if (allIn) {
      Object.assign(r, { status: 'playing', currentTrick: 1, currentPlayerIndex: (dealerIndex + 1) % newOrder.length, leadSuit: null, trickInProgress: [] });
    } else {
      let idx = currentPlayerIndex;
      for (let i = 0; i < newOrder.length; i++) { if (bids[newOrder[idx]] === undefined) break; idx = (idx + 1) % newOrder.length; }
      r.currentPlayerIndex = idx;
    }
  }
  delete s.hands[target];
  s.seated = s.seated.filter((n) => n !== target);
  for (const k of Object.keys(s.kickVotes)) s.kickVotes[k] = null;
  delete s.kickVotes[target];
}

// ─── computer players ───────────────────────────────────────────────────

export type BotIntent = { name: string; kind: 'trump' | 'bid' | 'play'; leadingNewTrick: boolean };

/** What the next computer move is, if a computer is on the clock. */
export function pendingBot(s: EngineState): BotIntent | null {
  const r = s.room;
  if (r.pendingUndo?.requested) return null;
  const dealer = r.playerOrder[r.dealerIndex];
  const current = r.playerOrder[r.currentPlayerIndex];
  if (r.awaitingTrumpChoice && isBot(r, dealer)) return { name: dealer, kind: 'trump', leadingNewTrick: false };
  if (r.status === 'bidding' && isBot(r, current)) return { name: current, kind: 'bid', leadingNewTrick: false };
  if (r.status === 'playing' && isBot(r, current)) {
    return { name: current, kind: 'play', leadingNewTrick: r.trickInProgress.length === 0 && r.currentTrick > 1 };
  }
  return null;
}

export function botAct(s: EngineState, intent: BotIntent): void {
  const r = s.room;
  const difficulty = botDifficultyOf(r, intent.name) ?? 'medium';
  const hand = s.hands[intent.name] ?? [];
  if (intent.kind === 'trump') { chooseTrumpSuit(s, intent.name, chooseBotTrump(hand, difficulty)); return; }
  if (intent.kind === 'bid') {
    const dealerName = r.playerOrder[r.dealerIndex];
    const isDealerBid = intent.name === dealerName;
    const otherBidsSum = Object.values(r.bids).reduce((a, b) => a + b, 0);
    const legalBids: number[] = [];
    for (let i = 0; i <= r.currentRound; i++) {
      if (!violatesCanadianRule({ isDealerBid, canadianRule: r.canadianRule, currentRound: r.currentRound, cardsThisRound: r.currentRound, otherBidsSum, bid: i })) legalBids.push(i);
    }
    const bidsSoFar: number[] = [];
    const n = r.playerOrder.length;
    for (let k = 1; k <= n; k++) {
      const nm = r.playerOrder[(r.dealerIndex + k) % n];
      if (nm === intent.name) break;
      if (r.bids[nm] !== undefined) bidsSoFar.push(r.bids[nm]);
    }
    const bid = chooseBotBid({
      hand, cardsThisRound: r.currentRound, trumpSuit: r.trumpSuit, playerCount: n, bidsSoFar, isDealer: isDealerBid, legalBids, trumpCard: r.trumpCard,
      table: { playerOrder: r.playerOrder, me: intent.name, bids: r.bids, tricksWon: {}, voids: {}, dealerIndex: r.dealerIndex },
    }, difficulty);
    placeBid(s, intent.name, bid);
    return;
  }
  if (!hand.length) return;
  const roundTricks = r.trickHistory.filter((t) => t.round === r.currentRound);
  const playedThisRound: Card[] = [];
  for (const t of roundTricks) for (const p of t.plays) playedThisRound.push(p.card);
  const idx = chooseBotCard({
    hand, trickInProgress: r.trickInProgress, trumpSuit: r.trumpSuit, trumpCard: r.trumpCard, playedThisRound,
    myBid: r.bids[intent.name] ?? 0, myTricksWon: r.tricksWon[intent.name] ?? 0,
    playersAfterMe: r.playerOrder.length - r.trickInProgress.length - 1,
    table: { playerOrder: r.playerOrder, me: intent.name, bids: r.bids, tricksWon: r.tricksWon, voids: inferVoids([...roundTricks, { plays: r.trickInProgress }]), dealerIndex: r.dealerIndex },
  }, difficulty);
  playCard(s, intent.name, idx);
}

// ─── what a client sees ─────────────────────────────────────────────────

/** The room as the client should see it: full log once the game is over. */
export function publicRoom(s: EngineState): RoomDoc & { code: string } {
  const r = s.room;
  return r.status === 'finished' ? { ...r, log: fullLog(s) } : r;
}
