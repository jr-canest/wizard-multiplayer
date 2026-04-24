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
import type { RoomDoc, RoomPlayerDoc } from './types';

const SCHEMA_VERSION = 1;
export const MIN_PLAYERS = 3;
export const MAX_PLAYERS = 10;

export type RoomErrorCode =
  | 'codeCollision'
  | 'roomNotFound'
  | 'roomFull'
  | 'gameStarted';

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
): Promise<string> {
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
      playerOrder: [hostName],
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
      cumulativeScores: { [hostName]: 0 },
      trickInProgress: [],
      trickHistory: [],
      log: [],
      historyWritten: false,
      historyGameId: null,
    };

    const playerDoc: RoomPlayerDoc = {
      authUid: hostAuthUid,
      connected: true,
      lastHeartbeatAt: serverTimestamp(),
      voteKickAgainst: null,
    };

    await setDoc(ref, room);
    await setDoc(doc(db, 'rooms', code, 'players', hostName), playerDoc);
    return code;
  }
  throw new RoomError('codeCollision');
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
