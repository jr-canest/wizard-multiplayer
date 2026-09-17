import {
  addDoc,
  collection,
  limit,
  onSnapshot,
  orderBy,
  query,
  type Unsubscribe,
} from 'firebase/firestore';
import { db } from './firebase';
import type { RoomDoc } from './types';

export const CHAT_MAX_LEN = 200;

/**
 * How many messages the live query holds. Only the last few are shown,
 * but a slightly bigger window means a late joiner still sees context
 * and the client-side window filter has something to work with.
 */
const CHAT_QUERY_LIMIT = 60;

export type ChatMessage = {
  player: string;
  text: string;
  ts: number;
  /** Which chat window this belongs to, see {@link chatWindowKey}. */
  w?: string;
};

/**
 * Chat lives in `rooms/{code}/chat`, NOT on the room document.
 *
 * It used to be a `chat: []` array on the room doc, appended with
 * arrayUnion. That put every message on the hottest, fattest document
 * in the app: writes to a single doc are serialised, so a message could
 * queue behind the gameplay writes, and every listener re-downloads the
 * WHOLE room doc on each change. Mid-game that doc is 25 to 60 KB, so a
 * one-line message cost every phone a full room download. Both effects
 * read as "chat is delayed". As its own subcollection each message is a
 * ~80 byte doc on its own write path, so it lands as fast as Firestore
 * can push it.
 */
function chatCollection(code: string) {
  return collection(db, 'rooms', code, 'chat');
}

/**
 * Chat is per-window: the lobby, each round-end scoreboard, and the
 * final scoreboard each get a fresh conversation. The key is derived
 * from the room snapshot, so no extra write is needed to "clear" chat,
 * the window simply moves on. `chatGen` bumps on Play Again so a second
 * game's lobby does not reopen the first game's lobby chat.
 */
export function chatWindowKey(room: RoomDoc): string {
  const gen = room.chatGen ?? 0;
  if (room.status === 'lobby') return `${gen}:lobby`;
  if (room.status === 'finished') return `${gen}:final`;
  return `${gen}:r${room.currentRound}`;
}

export function subscribeChat(
  code: string,
  cb: (messages: ChatMessage[]) => void,
): Unsubscribe {
  const q = query(
    chatCollection(code),
    orderBy('ts', 'desc'),
    limit(CHAT_QUERY_LIMIT),
  );
  return onSnapshot(
    q,
    (snap) => {
      const msgs = snap.docs
        .map((d) => d.data() as ChatMessage)
        .filter((m) => typeof m?.ts === 'number' && typeof m?.text === 'string');
      // Queried newest-first so the limit keeps the RECENT ones; flip
      // back to oldest-first for display.
      msgs.reverse();
      cb(msgs);
    },
    () => {
      // A dropped listener should not blank the box: keep whatever is
      // already on screen and let the SDK reconnect on its own.
    },
  );
}

/**
 * Append a message. Fire-and-forget from the caller's point of view:
 * Firestore's local echo puts it on screen immediately, the promise
 * only settles when the server acks.
 */
export async function sendChatMessage(
  code: string,
  windowKey: string,
  player: string,
  text: string,
  ts: number = Date.now(),
): Promise<void> {
  const trimmed = text.trim().slice(0, CHAT_MAX_LEN);
  if (!trimmed) return;
  await addDoc(chatCollection(code), {
    player,
    text: trimmed,
    ts,
    w: windowKey,
  });
}
