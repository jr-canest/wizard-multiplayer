import { useCallback, useMemo, useState } from 'react';
import { useChat } from './useChat';
import { chatWindowKey, sendChatMessage, type ChatMessage } from '../lib/chat';
import type { RoomSnapshot } from './useRoom';

/**
 * A room's chat lines plus send(), shared by the compact Chat box and the
 * in-game chat hub. `scope` picks the lines: 'window' = the current chat
 * window (lobby / this round / final), 'game' = everything since this
 * game's lobby.
 *
 * A sent line shows optimistically at once and is dropped as soon as the
 * server's copy is on screen: the server echoes the sender's own timestamp
 * as `cts`, and the ack (which always follows the echo on the same socket)
 * clears it as a belt-and-braces. send() resolves false when the send
 * failed, so the caller can put the text back in the field.
 */
export function useChatThread(room: RoomSnapshot, myName: string, scope: 'window' | 'game') {
  const live = useChat(room.code);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const windowKey = chatWindowKey(room);
  const gamePrefix = `${room.chatGen ?? 0}:`;

  const inScope = useCallback(
    (m: ChatMessage) => (scope === 'window' ? m.w === windowKey : m.w.startsWith(gamePrefix)),
    [scope, windowKey, gamePrefix],
  );

  const serverLines = useMemo(
    () => live.filter(inScope).sort((a, b) => a.ts - b.ts),
    [live, inScope],
  );

  // Derived in render rather than synced into state, so there is no
  // setState-in-effect to clean up. The `cts` match is exact; the text +
  // near-time test covers a server build that predates `cts`.
  const pending = optimistic.filter(
    (o) =>
      inScope(o) &&
      !serverLines.some(
        (m) =>
          m.player === o.player &&
          (m.cts === o.ts || (m.text === o.text && Math.abs(m.ts - o.ts) < 30_000)),
      ),
  );

  const send = useCallback(
    (text: string): Promise<boolean> => {
      const ts = Date.now();
      setOptimistic((prev) => [...prev, { player: myName, text, ts, w: windowKey }]);
      const drop = () => setOptimistic((prev) => prev.filter((o) => o.ts !== ts));
      return sendChatMessage(room.code, windowKey, myName, text, ts).then(
        () => {
          drop();
          return true;
        },
        () => {
          drop();
          return false;
        },
      );
    },
    [room.code, windowKey, myName],
  );

  return { lines: [...serverLines, ...pending], send };
}
