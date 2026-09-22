/**
 * Who is at the table right now. The server knows exactly which sockets are
 * open, so "connected" is a fact, not a heartbeat guess; the kick clock
 * runs off the last moment the server heard from a player.
 */
import { connectionFor } from './socket';
import type { PlayerSnapshot } from './socket';

export const KICK_GRACE_MS = 60_000;

export function isConnected(p: PlayerSnapshot, _now = Date.now()): boolean {
  return p.isBot === true || p.connected;
}

/** Ms until vote-kick becomes available; negative once it is. */
export function graceRemainingMs(p: PlayerSnapshot, now = Date.now()): number {
  if (isConnected(p)) return KICK_GRACE_MS;
  return KICK_GRACE_MS - (now - p.lastSeen);
}

export type VoteTally = { votes: number; needed: number; voters: string[] };

/** Eligible voters = connected real players other than the target. */
export function tallyVotes(players: PlayerSnapshot[], target: string, _now = Date.now()): VoteTally {
  const eligible = players.filter((p) => p.name !== target && !p.isBot && p.connected);
  const voters = eligible.filter((p) => p.voteKickAgainst === target).map((p) => p.name);
  return { votes: voters.length, needed: Math.floor(eligible.length / 2) + 1, voters };
}

export async function setVoteKick(code: string, _voter: string, target: string | null): Promise<void> {
  await connectionFor(code).act('setVoteKick', target);
}

/** The server kicks the moment a majority is reached; nothing to do here. */
export async function executeKick(_code: string, _target: string): Promise<void> {}
