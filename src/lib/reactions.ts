import {
  collection,
  doc,
  getDocs,
  increment,
  setDoc,
} from 'firebase/firestore';
import { db, isProduction } from './firebase';

/**
 * The quick buttons in the in-game chat hub (GameChat), in the order they
 * are shown. Since 2026-09-24 they are the five most used of the old 📣
 * list (90% of every reaction sent); anything else gets typed in the
 * chat. Single source of truth: the hub renders this, and the usage
 * readout on /me scores against it so a phrase nobody has ever tapped
 * still shows up (with 0) as the least-used one; the dropped phrases show
 * there as retired.
 */
export const REACTIONS = [
  'ouch',
  'why???',
  'take your time',
  'respect the game',
  'thanks!',
] as const;

export type ReactionText = (typeof REACTIONS)[number];

/** Doc id for a phrase: lowercase, punctuation stripped, spaces to "-". */
export function reactionKey(text: string): string {
  return (
    text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'unknown'
  );
}

function statsCollection() {
  return collection(db, 'reactionStats');
}

/**
 * Bump the all-rooms tally for a phrase. Deliberately fire-and-forget
 * and deliberately separate from postReaction's room write: a counter
 * that fails, or is slow, must never hold up the reaction itself.
 *
 * Skipped on localhost and in test games so a dev session does not
 * distort what the family actually says.
 */
export function recordReactionUse(text: string, skip = false): void {
  if (skip || !isProduction()) return;
  const key = reactionKey(text);
  setDoc(
    doc(statsCollection(), key),
    { text, count: increment(1), lastUsedAt: Date.now() },
    { merge: true },
  ).catch(() => {
    // Counters are nice to have, never worth surfacing an error for.
  });
}

export type ReactionTally = {
  key: string;
  text: string;
  count: number;
  lastUsedAt: number | null;
  /** True when the phrase is no longer in the picker. */
  retired: boolean;
};

/**
 * Every phrase with its all-time count, most used first, ties broken by
 * the picker's own order. Phrases never tapped come back with count 0,
 * which is the whole point: "least used" needs the zeroes.
 */
export async function fetchReactionTallies(): Promise<ReactionTally[]> {
  const snap = await getDocs(statsCollection());
  const counts = new Map<string, { count: number; lastUsedAt: number | null; text: string }>();
  for (const d of snap.docs) {
    const data = d.data() as {
      text?: string;
      count?: number;
      lastUsedAt?: number;
    };
    counts.set(d.id, {
      count: typeof data.count === 'number' ? data.count : 0,
      lastUsedAt: typeof data.lastUsedAt === 'number' ? data.lastUsedAt : null,
      text: data.text ?? d.id,
    });
  }

  const order = new Map(REACTIONS.map((t, i) => [reactionKey(t), i]));
  const live: ReactionTally[] = REACTIONS.map((text) => {
    const key = reactionKey(text);
    const hit = counts.get(key);
    counts.delete(key);
    return {
      key,
      text,
      count: hit?.count ?? 0,
      lastUsedAt: hit?.lastUsedAt ?? null,
      retired: false,
    };
  });
  // Anything left in the map is a phrase that has since left the picker.
  const retired: ReactionTally[] = [...counts.entries()].map(([key, v]) => ({
    key,
    text: v.text,
    count: v.count,
    lastUsedAt: v.lastUsedAt,
    retired: true,
  }));

  return [...live, ...retired].sort(
    (a, b) =>
      b.count - a.count ||
      (order.get(a.key) ?? 999) - (order.get(b.key) ?? 999) ||
      a.text.localeCompare(b.text),
  );
}
