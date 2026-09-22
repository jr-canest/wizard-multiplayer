/**
 * Rooms live on the game server now. Creating one is an HTTP call; joining
 * is what the socket does when it connects; everything in the lobby is a
 * message. Names, seat checks and the computer-player pool are the
 * engine's, re-exported so components keep their imports.
 */
import { GAME_SERVER_URL } from './server';
import { connectionFor, ActionError } from './socket';
import { readToken } from './session';
import type { BotDifficulty } from './types';

export {
  MIN_PLAYERS,
  MAX_PLAYERS,
  BOT_NAME_PREFIX,
  BOT_NAME_POOL,
  isBotName,
  isBot,
  botDifficultyOf,
} from '../game/engine';

export const BOT_DIFFICULTY_LABEL: Record<BotDifficulty, string> = {
  easy: 'Easy',
  medium: 'Medium',
  expert: 'Expert',
};

export type RoomErrorCode =
  | 'codeCollision'
  | 'roomNotFound'
  | 'roomFull'
  | 'gameStarted'
  | 'nameTaken'
  | 'notHost'
  | 'notLobby'
  | 'unauthorized'
  | 'failed';

export class RoomError extends Error {
  code: RoomErrorCode;
  constructor(code: RoomErrorCode) {
    super(code);
    this.code = code;
  }
}

/** Name + PIN → seat token from the game server (it re-checks the PIN). */
export async function fetchSeatToken(name: string, pin: string): Promise<string> {
  const res = await fetch(`${GAME_SERVER_URL}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, pin }),
  });
  if (!res.ok) throw new Error(res.status === 401 ? 'That PIN doesn’t match the name on file.' : 'Could not reach the game server.');
  const data = (await res.json()) as { token: string };
  return data.token;
}

export async function createRoom(
  _hostName: string,
  _hostAuthUid: string,
  canadianRule: boolean,
  options: { withBots?: boolean } = {},
): Promise<string> {
  const token = readToken();
  if (!token) throw new RoomError('unauthorized');
  const res = await fetch(`${GAME_SERVER_URL}/rooms`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ canadianRule, withBots: !!options.withBots }),
  });
  if (res.status === 401) throw new RoomError('unauthorized');
  if (!res.ok) throw new RoomError('failed');
  const data = (await res.json()) as { code: string };
  return data.code;
}

async function act<T = void>(code: string, action: string, ...args: unknown[]): Promise<T> {
  try {
    return await connectionFor(code).act<T>(action, ...args);
  } catch (err) {
    throw new RoomError(err instanceof ActionError ? (err.code as RoomErrorCode) : 'failed');
  }
}

export async function addBot(code: string, _host: string, _uid: string, difficulty: BotDifficulty): Promise<string> {
  return act<string>(code, 'addBot', difficulty);
}

export async function removeBot(code: string, _host: string, botName: string): Promise<void> {
  await act(code, 'removeBot', botName);
}

export async function leaveRoom(code: string, _playerName: string): Promise<void> {
  await act(code, 'leave');
}
