import {
  collection,
  doc,
  getDoc,
  onSnapshot,
  runTransaction,
  serverTimestamp,
  setDoc,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import { generateRoomCode } from './codes';
import type { BotDifficulty, RoomDoc, RoomPlayerDoc } from './types';

const SCHEMA_VERSION = 1;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

// Legacy computer seats (pre-2026-09-09 test rooms) were named Bot-*.
export const BOT_NAME_PREFIX = 'Bot-';
export function isBotName(name: string): boolean {
  return name.startsWith(BOT_NAME_PREFIX);
}

/** Wizard-flavoured names for computer seats, used in order of availability. */
export const BOT_NAME_POOL = [
  'Merlin',
  'Morgana',
  'Gandalf',
  'Radagast',
  'Prospero',
  'Circe',
  'Saruman',
  'Medea',
  'Elminster',
  'Zatanna',
  'Alatar',
  'Rincewind',
] as const;

export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  expert: 'Expert',
};

/** True for a computer seat: either in the room's bots map or a legacy Bot-* name. */
export function isBot(room: Pick<RoomDoc, 'bots'>, name: string): boolean {
  return Boolean(room.bots?.[name]) || isBotName(name);
}

/** Difficulty of a computer seat (legacy Bot-* seats play medium). */
export function botDifficultyOf(
  room: Pick<RoomDoc, 'bots'>,
  name: string,
): BotDifficulty | null {
  const d = room.bots?.[name];
  if (d) return d;
  return isBotName(name) ? 'medium' : null;
}

function nextBotName(taken: string[]): string {
  const lower = new Set(taken.map((n) => n.trim().toLowerCase()));
  for (const candidate of BOT_NAME_POOL) {
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
  // Pool exhausted (10 seats max, 12 names — only if humans took the rest).
  let i = 2;
  while (lower.has(`wizard ${i}`)) i++;
  return `Wizard ${i}`;
}

export type RoomErrorCode =
  | 'codeCollision'
  | 'roomNotFound'
  | 'roomFull'
  | 'gameStarted'
  | 'nameTaken'
  | 'notHost'
  | 'notLobby';

export class RoomError extends Error {
  code: RoomErrorCode;
  constructor(code: RoomErrorCode) {
    super(code);
    this.code = code;
  }
}

export async function createRoom(
  hostName: string,
  hostAuthUid: string,
  canadianRule: boolean,
  options: { withBots?: boolean } = {},
): Promise<string> {
  const botNames: string[] = [];
  if (options.withBots) {
    while (botNames.length < 3) botNames.push(nextBotName([hostName, ...botNames]));
  }
  const bots: Record<string, BotDifficulty> = {};
  for (const n of botNames) bots[n] = 'medium';
  const playerOrder = [hostName, ...botNames];
  const cumulativeScores: Record<string, number> = {};
  for (const n of playerOrder) cumulativeScores[n] = 0;

  // Generate + collision-check; up to 5 attempts before bailing.
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = generateRoomCode();
    const ref = doc(db, 'rooms', code);
    const snap = await getDoc(ref);
    if (snap.exists()) continue;

    const room: RoomDoc = {
      status: 'lobby',
      hostPlayerName: hostName,
      canadianRule,
      createdAt: serverTimestamp(),
      schemaVersion: SCHEMA_VERSION,
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
    };

    const hostDoc: RoomPlayerDoc = {
      authUid: hostAuthUid,
      connected: true,
      lastHeartbeatAt: serverTimestamp(),
      voteKickAgainst: null,
    };

    await setDoc(ref, room);
    await setDoc(doc(db, 'rooms', code, 'players', hostName), hostDoc);
    for (const botName of botNames) {
      await setDoc(doc(db, 'rooms', code, 'players', botName), botPlayerDoc(hostAuthUid));
    }
    return code;
  }
  throw new RoomError('codeCollision');
}

function botPlayerDoc(hostAuthUid: string): RoomPlayerDoc {
  return {
    authUid: hostAuthUid,
    isBot: true,
    connected: true,
    lastHeartbeatAt: serverTimestamp(),
    voteKickAgainst: null,
  };
}

/**
 * Host adds a computer player to the lobby. Picks the next free name from
 * the wizard pool so it never collides with a human already seated.
 */
export async function addBot(
  code: string,
  hostName: string,
  hostAuthUid: string,
  difficulty: BotDifficulty,
): Promise<string> {
  const roomRef = doc(db, 'rooms', code);
  let botName = '';
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) throw new RoomError('roomNotFound');
    const room = snap.data() as RoomDoc;
    if (room.hostPlayerName !== hostName) throw new RoomError('notHost');
    if (room.status !== 'lobby') throw new RoomError('notLobby');
    if (room.playerOrder.length >= MAX_PLAYERS) throw new RoomError('roomFull');

    botName = nextBotName(room.playerOrder);
    tx.update(roomRef, {
      playerOrder: [...room.playerOrder, botName],
      cumulativeScores: { ...room.cumulativeScores, [botName]: 0 },
      bots: { ...(room.bots ?? {}), [botName]: difficulty },
    });
    tx.set(doc(db, 'rooms', code, 'players', botName), botPlayerDoc(hostAuthUid));
  });
  return botName;
}

/** Host removes a computer player from the lobby. */
export async function removeBot(
  code: string,
  hostName: string,
  botName: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) throw new RoomError('roomNotFound');
    const room = snap.data() as RoomDoc;
    if (room.hostPlayerName !== hostName) throw new RoomError('notHost');
    if (room.status !== 'lobby') throw new RoomError('notLobby');
    if (!isBot(room, botName)) return;

    const nextScores = { ...room.cumulativeScores };
    delete nextScores[botName];
    const nextBots = { ...(room.bots ?? {}) };
    delete nextBots[botName];
    tx.update(roomRef, {
      playerOrder: room.playerOrder.filter((n) => n !== botName),
      cumulativeScores: nextScores,
      bots: nextBots,
    });
    tx.delete(doc(db, 'rooms', code, 'players', botName));
  });
}

export async function joinRoom(
  code: string,
  playerName: string,
  authUid: string,
): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  const playerRef = doc(db, 'rooms', code, 'players', playerName);

  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) throw new RoomError('roomNotFound');
    const room = snap.data() as RoomDoc;

    // A human picking a computer's name would otherwise silently take
    // over that seat (same-name join = reconnect).
    if (isBot(room, playerName)) throw new RoomError('nameTaken');

    const alreadyIn = room.playerOrder.includes(playerName);

    if (!alreadyIn) {
      if (room.status !== 'lobby') throw new RoomError('gameStarted');
      if (room.playerOrder.length >= MAX_PLAYERS) throw new RoomError('roomFull');
      tx.update(roomRef, {
        playerOrder: [...room.playerOrder, playerName],
        cumulativeScores: { ...room.cumulativeScores, [playerName]: 0 },
      });
    }

    const playerDoc: RoomPlayerDoc = {
      authUid,
      connected: true,
      lastHeartbeatAt: serverTimestamp(),
      voteKickAgainst: null,
    };
    tx.set(playerRef, playerDoc);
  });
}

export async function leaveRoom(code: string, playerName: string): Promise<void> {
  const roomRef = doc(db, 'rooms', code);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(roomRef);
    if (!snap.exists()) return;
    const room = snap.data() as RoomDoc;

    // Only allow leaving from the lobby for now. Mid-game leaves go through
    // the disconnect/vote-kick flow (step 10).
    if (room.status !== 'lobby') return;

    const nextOrder = room.playerOrder.filter((n) => n !== playerName);
    const nextScores = { ...room.cumulativeScores };
    delete nextScores[playerName];

    tx.update(roomRef, {
      playerOrder: nextOrder,
      cumulativeScores: nextScores,
    });
  });
}

export function subscribeRoom(
  code: string,
  cb: (room: (RoomDoc & { code: string }) | null) => void,
): Unsubscribe {
  const ref = doc(db, 'rooms', code);
  return onSnapshot(ref, (snap) => {
    if (!snap.exists()) {
      cb(null);
      return;
    }
    cb({ code, ...(snap.data() as RoomDoc) });
  });
}

export function subscribeRoomPlayers(
  code: string,
  cb: (players: Array<RoomPlayerDoc & { name: string }>) => void,
): Unsubscribe {
  const ref = collection(db, 'rooms', code, 'players');
  return onSnapshot(ref, (snap) => {
    cb(
      snap.docs.map((d) => ({
        name: d.id,
        ...(d.data() as RoomPlayerDoc),
      })),
    );
  });
}
