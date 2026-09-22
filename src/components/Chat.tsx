import { useEffect, useMemo, useRef, useState } from 'react';
import { playerColor } from '../lib/playerColors';
import { useChat } from '../hooks/useChat';
import {
  CHAT_MAX_LEN,
  chatWindowKey,
  sendChatMessage,
  type ChatMessage,
} from '../lib/chat';
import type { RoomSnapshot } from '../hooks/useRoom';

const VISIBLE_CHAT_COUNT = 4;
// Opacity by distance from newest: 0 = newest, last entry = oldest visible.
const FADE_BY_DISTANCE = [1, 0.8, 0.62, 0.45];

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * Compact chat used in the lobby, round-end scoreboard, and final
 * scoreboard. Renders the {@link VISIBLE_CHAT_COUNT} most recent
 * messages plus an input.
 *
 * Lines ride the room socket (src/lib/chat.ts): the server keeps them and
 * pushes each new one to every phone, the sender included. A sent message
 * renders optimistically the instant it is sent and is dropped as soon as
 * the server's copy is on screen: the server echoes the sender's own
 * timestamp as `cts`, and the ack (which always follows the echo on the
 * same socket) clears it as a belt-and-braces. The input is never
 * disabled, you can keep typing while a message is in flight.
 */
export function Chat({ room, myName }: Props) {
  const [text, setText] = useState('');
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const liveMessages = useChat(room.code);
  const windowKey = chatWindowKey(room);

  // Messages for the current chat window (lobby / this round-end / final).
  const serverMessages = useMemo(
    () => liveMessages.filter((m) => m.w === windowKey).sort((a, b) => a.ts - b.ts),
    [liveMessages, windowKey],
  );

  // Drop optimistic copies the server has echoed back. Derived in render
  // rather than synced into state, so there is no setState-in-effect to
  // clean up. The server echoes our send-time stamp as `cts`, so the
  // match is exact; the text + near-time test covers a server build that
  // predates `cts`.
  const visibleOptimistic = optimistic.filter(
    (o) =>
      o.w === windowKey &&
      !serverMessages.some(
        (m) =>
          m.player === o.player &&
          (m.cts === o.ts || (m.text === o.text && Math.abs(m.ts - o.ts) < 30_000)),
      ),
  );
  const allMessages: ChatMessage[] = [...serverMessages, ...visibleOptimistic];
  const messages = allMessages.slice(-VISIBLE_CHAT_COUNT);

  // Stick to the bottom whenever a new message arrives.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    const ts = Date.now();
    const draft: ChatMessage = { player: myName, text: v, ts, w: windowKey };
    setOptimistic((prev) => [...prev, draft]);
    // Not awaited: the message is already on screen, and blocking the
    // form on the server ack is exactly what made sending feel slow.
    sendChatMessage(room.code, windowKey, myName, v, ts).then(
      // Acked: the server's copy arrived on this socket before the ack,
      // so the optimistic one is redundant from here on.
      () => setOptimistic((prev) => prev.filter((o) => o.ts !== ts)),
      () => {
        // Drop the optimistic copy and restore the input so the send does
        // not silently vanish on a flaky network.
        setOptimistic((prev) => prev.filter((o) => o.ts !== ts));
        setText((cur) => (cur ? cur : v));
      },
    );
  }

  return (
    <div className="card-gold p-3 space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-xs uppercase tracking-wider text-navy-200">
          Chat
        </span>
        {allMessages.length > VISIBLE_CHAT_COUNT && (
          <span className="text-[10px] text-navy-300 tabular-nums">
            showing {VISIBLE_CHAT_COUNT}/{allMessages.length}
          </span>
        )}
      </div>
      <div
        ref={listRef}
        className="space-y-1 rounded-md bg-navy-900/40 border border-gold-700/20 px-2 py-1.5"
      >
        {messages.length === 0 ? (
          <p className="text-[11px] text-navy-300 italic py-1">waiting…</p>
        ) : (
          messages.map((m, i) => {
            const c = playerColor(m.player, room.playerOrder);
            const isMe = m.player === myName;
            const distanceFromNewest = messages.length - 1 - i;
            const opacity =
              FADE_BY_DISTANCE[distanceFromNewest] ??
              FADE_BY_DISTANCE[FADE_BY_DISTANCE.length - 1];
            return (
              <div
                key={`${m.player}-${m.ts}-${i}`}
                className="text-[12px] leading-snug break-words transition-opacity duration-300"
                style={{ opacity }}
              >
                <span
                  className={`${isMe ? 'text-gold-text' : c.text} font-bold`}
                >
                  {m.player}
                </span>
                <span className="text-navy-50">: {m.text}</span>
              </div>
            );
          })
        )}
      </div>
      <form onSubmit={handleSend} className="flex gap-1.5">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LEN}
          placeholder="Say something…"
          aria-label="Chat message"
          className="flex-1 rounded-lg bg-[rgba(20,26,44,.8)] border border-gold-300/25 px-2.5 py-1.5 text-sm text-cream placeholder:text-navy-300 focus:outline-none focus:border-gold-300"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="px-3 py-1.5 text-sm rounded-md btn-gold disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
