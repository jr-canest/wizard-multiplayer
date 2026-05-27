import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  runTransaction,
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
  // Names that have been merged into this player. Display-only; the
  // canonical doc carries all aggregate stats. Past game records still
  // show the original name as recorded.
  aliases?: string[];
  // If set, this doc has been merged into another. Its stats are zeroed
  // and the History view hides it. The canonical doc's id is stored here.
  mergedInto?: string;
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

export class MergePlayerError extends Error {
  code:
    | 'notFound'
    | 'sameDoc'
    | 'aliasAlreadyMerged'
    | 'canonicalIsMerged';
  constructor(code: MergePlayerError['code']) {
    super(code);
    this.code = code;
  }
}

/**
 * Fold the alias player's aggregate stats into the canonical player and
 * mark the alias doc with `mergedInto: canonicalId`. Past `games` docs
 * keep their recorded name — the History view aggregates by player doc,
 * so collapsing the alias doc is enough to dedupe.
 *
 * Transactional — concurrent reads of either doc see one consistent
 * before/after state.
 */
export async function mergePlayerInto(
  canonicalId: string,
  aliasId: string,
): Promise<void> {
  if (canonicalId === aliasId) throw new MergePlayerError('sameDoc');
  const canonRef = doc(db, 'players', canonicalId);
  const aliasRef = doc(db, 'players', aliasId);

  await runTransaction(db, async (tx) => {
    const [canonSnap, aliasSnap] = await Promise.all([
      tx.get(canonRef),
      tx.get(aliasRef),
    ]);
    if (!canonSnap.exists() || !aliasSnap.exists()) {
      throw new MergePlayerError('notFound');
    }
    const c = canonSnap.data() as Omit<PlayerDoc, 'id'>;
    const a = aliasSnap.data() as Omit<PlayerDoc, 'id'>;
    if (c.mergedInto) throw new MergePlayerError('canonicalIsMerged');
    if (a.mergedInto) throw new MergePlayerError('aliasAlreadyMerged');

    const sumGp = (c.gamesPlayed ?? 0) + (a.gamesPlayed ?? 0);
    const sumWins = (c.wins ?? 0) + (a.wins ?? 0);
    const sumScore = (c.totalScore ?? 0) + (a.totalScore ?? 0);
    const sumShame =
      (c.totalShamePoints ?? 0) + (a.totalShamePoints ?? 0);
    const mergedBest =
      a.bestScore === undefined || a.bestScore === null
        ? (c.bestScore ?? null)
        : c.bestScore === undefined || c.bestScore === null
          ? a.bestScore
          : Math.max(c.bestScore, a.bestScore);
    const mergedWorst =
      a.worstScore === undefined || a.worstScore === null
        ? (c.worstScore ?? null)
        : c.worstScore === undefined || c.worstScore === null
          ? a.worstScore
          : Math.min(c.worstScore, a.worstScore);
    const aliasName = a.name ?? '';
    const nextAliases = Array.from(
      new Set([...(c.aliases ?? []), ...(a.aliases ?? []), aliasName]),
    ).filter(Boolean);

    tx.update(canonRef, {
      gamesPlayed: sumGp,
      wins: sumWins,
      totalScore: sumScore,
      totalShamePoints: sumShame,
      bestScore: mergedBest,
      worstScore: mergedWorst,
      aliases: nextAliases,
    });
    tx.update(aliasRef, {
      mergedInto: canonicalId,
      gamesPlayed: 0,
      wins: 0,
      totalScore: 0,
      totalShamePoints: 0,
      bestScore: null,
      worstScore: null,
    });
  });
}

export type IdentityEditResult =
  | { ok: true }
  | { ok: false; reason: 'wrongPin' | 'nameTaken' | 'invalidName' | 'notFound' };

async function verifyPin(
  playerId: string,
  pin: string,
): Promise<
  | { ok: true; data: Omit<PlayerDoc, 'id'> }
  | { ok: false; reason: 'wrongPin' | 'notFound' }
> {
  const snap = await getDoc(doc(db, 'players', playerId));
  if (!snap.exists()) return { ok: false, reason: 'notFound' };
  const data = snap.data() as Omit<PlayerDoc, 'id'>;
  if (!data.pinHash || !data.pinSalt) return { ok: false, reason: 'wrongPin' };
  const candidate = await hashPin(pin, data.pinSalt);
  if (candidate !== data.pinHash) return { ok: false, reason: 'wrongPin' };
  return { ok: true, data };
}

/**
 * Rename a player after verifying their PIN. Updates `name` + `nameLower`
 * on the player doc. Refuses if another non-merged player already owns
 * the same `nameLower`. Past `games` docs keep the previously recorded
 * name; the stats walker matches names + aliases case-insensitively so
 * old games still attribute correctly as long as the old name is added
 * to `aliases`.
 */
export async function renamePlayer(
  playerId: string,
  newName: string,
  pin: string,
): Promise<IdentityEditResult> {
  const trimmed = newName.trim();
  if (!isValidPlayerName(trimmed)) return { ok: false, reason: 'invalidName' };
  const verify = await verifyPin(playerId, pin);
  if (!verify.ok) return { ok: false, reason: verify.reason };

  const nameLower = trimmed.toLowerCase();
  // No-op if the name isn't actually changing.
  if (nameLower === verify.data.nameLower) {
    if (trimmed !== verify.data.name) {
      await updateDoc(doc(db, 'players', playerId), { name: trimmed });
    }
    return { ok: true };
  }

  const existing = await findPlayerByName(trimmed);
  if (existing && existing.id !== playerId && !existing.mergedInto) {
    return { ok: false, reason: 'nameTaken' };
  }
  await updateDoc(doc(db, 'players', playerId), {
    name: trimmed,
    nameLower,
  });
  return { ok: true };
}

/**
 * Replace a player's manual `aliases[]` after verifying their PIN. Each
 * alias is trimmed; empties are dropped; duplicates collapsed (case-
 * insensitive). Aliases drive the stats walker's name-matching so games
 * recorded under prior names roll into this player's profile.
 */
export async function setAliases(
  playerId: string,
  aliases: string[],
  pin: string,
): Promise<IdentityEditResult> {
  const verify = await verifyPin(playerId, pin);
  if (!verify.ok) return { ok: false, reason: verify.reason };
  const seen = new Set<string>();
  const cleaned: string[] = [];
  for (const raw of aliases) {
    const t = raw.trim();
    if (!t || !isValidPlayerName(t)) continue;
    const key = t.toLowerCase();
    if (key === verify.data.nameLower) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    cleaned.push(t);
  }
  await updateDoc(doc(db, 'players', playerId), { aliases: cleaned });
  return { ok: true };
}

/**
 * Reverse a prior merge: clears `mergedInto` on the alias doc. Stats
 * are NOT split back — the original per-doc breakdown is gone after a
 * merge. The alias re-appears in the History list with zeroed stats
 * until its next game.
 */
export async function unmergePlayer(aliasId: string): Promise<void> {
  const aliasRef = doc(db, 'players', aliasId);
  const aliasSnap = await getDoc(aliasRef);
  if (!aliasSnap.exists()) throw new MergePlayerError('notFound');
  const a = aliasSnap.data() as Omit<PlayerDoc, 'id'>;
  if (!a.mergedInto) return;
  const canonRef = doc(db, 'players', a.mergedInto);
  const canonSnap = await getDoc(canonRef);
  await updateDoc(aliasRef, { mergedInto: null });
  if (canonSnap.exists()) {
    const c = canonSnap.data() as Omit<PlayerDoc, 'id'>;
    const nextAliases = (c.aliases ?? []).filter((n) => n !== a.name);
    await updateDoc(canonRef, { aliases: nextAliases });
  }
}
