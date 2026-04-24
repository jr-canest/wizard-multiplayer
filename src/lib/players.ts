import {
  collection,
  doc,
  addDoc,
  getDocs,
  query,
  where,
  limit,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore';
import { db } from './firebase';
import { generateSalt, hashPin } from './crypto';

// Stored on each player doc in the shared `players` collection.
// Existing scorekeeper players won't have these fields until their first
// multiplayer join — that's the `pinSet` path in claimOrAuthPlayer.
export type PlayerDoc = {
  id: string;
  name: string;
  nameLower: string;
  gamesPlayed?: number;
  wins?: number;
  totalScore?: number;
  bestScore?: number | null;
  worstScore?: number | null;
  totalShamePoints?: number;
  pinHash?: string;
  pinSalt?: string;
  pinSetAt?: unknown;
};

export type AuthResult =
  | { ok: true; player: PlayerDoc; status: 'created' | 'matched' | 'pinSet' }
  | { ok: false; reason: 'wrongPin' };

export function isValidPlayerName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed.length >= 1 && trimmed.length <= 20;
}

export function isValidPin(pin: string): boolean {
  return /^\d{4}$/.test(pin);
}

async function findPlayerByName(name: string): Promise<PlayerDoc | null> {
  const nameLower = name.trim().toLowerCase();
  const q = query(
    collection(db, 'players'),
    where('nameLower', '==', nameLower),
    limit(1),
  );
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const docSnap = snap.docs[0];
  return { id: docSnap.id, ...(docSnap.data() as Omit<PlayerDoc, 'id'>) };
}

/**
 * Claim a player name with a PIN, or authenticate against an existing claim.
 *
 * - If the name is unused: create the player with PIN.
 * - If the name exists with a PIN: PIN must match.
 * - If the name exists without a PIN (scorekeeper-only player): set the PIN.
 */
export async function claimOrAuthPlayer(
  name: string,
  pin: string,
): Promise<AuthResult> {
  const trimmedName = name.trim();
  const existing = await findPlayerByName(trimmedName);

  if (existing && existing.pinHash && existing.pinSalt) {
    const candidate = await hashPin(pin, existing.pinSalt);
    if (candidate !== existing.pinHash) {
      return { ok: false, reason: 'wrongPin' };
    }
    return { ok: true, player: existing, status: 'matched' };
  }

  const salt = generateSalt();
  const pinHash = await hashPin(pin, salt);

  if (existing) {
    await updateDoc(doc(db, 'players', existing.id), {
      pinHash,
      pinSalt: salt,
      pinSetAt: serverTimestamp(),
    });
    return {
      ok: true,
      player: { ...existing, pinHash, pinSalt: salt },
      status: 'pinSet',
    };
  }

  const nameLower = trimmedName.toLowerCase();
  const newDoc = {
    name: trimmedName,
    nameLower,
    gamesPlayed: 0,
    wins: 0,
    totalScore: 0,
    bestScore: null,
    worstScore: null,
    totalShamePoints: 0,
    pinHash,
    pinSalt: salt,
    pinSetAt: serverTimestamp(),
    createdAt: serverTimestamp(),
  };
  const ref = await addDoc(collection(db, 'players'), newDoc);
  return {
    ok: true,
    player: { id: ref.id, ...newDoc, pinSetAt: undefined },
    status: 'created',
  };
}
