import { useEffect, useRef, useState } from 'react';
import { playerColor } from '../lib/playerColors';
import { useChatThread } from '../hooks/useChatThread';
import { CHAT_MAX_LEN } from '../lib/chat';
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
 * messages of the current window plus an input. During play the header's
 * chat hub (GameChat) takes over; lines sent there during a round land in
 * that round's window, so the round-end box picks the conversation up.
 *
 * Lines ride the room socket (src/lib/chat.ts); sending and the optimistic
 * copy live in useChatThread. The input is never disabled, you can keep
 * typing while a message is in flight.
 */
export function Chat({ room, myName }: Props) {
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const { lines: allMessages, send } = useChatThread(room, myName, 'window');
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
    // Not awaited: the message is already on screen, and blocking the
    // form on the server ack is exactly what made sending feel slow. A
    // failed send puts the text back so it does not silently vanish.
    void send(v).then((ok) => {
      if (!ok) setText((cur) => (cur ? cur : v));
    });
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
      {/* Plain list, no frame: a boxed list read as the input and people
          tapped it instead of the field below. */}
      <div ref={listRef} className="space-y-1 px-0.5">
        {messages.length === 0 ? (
          <p className="text-[11px] text-navy-300 py-0.5">No messages yet</p>
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
      {/* 16px text: anything smaller makes iOS zoom the page on focus. */}
      <form onSubmit={handleSend} className="flex gap-1.5 items-stretch">
        <input
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          maxLength={CHAT_MAX_LEN}
          placeholder="Type a message…"
          aria-label="Chat message"
          className="flex-1 min-w-0 rounded-lg bg-[rgba(20,26,44,.9)] border border-gold-300/55 px-3 py-2 text-[16px] text-cream placeholder:text-navy-200 focus:outline-none focus:border-gold-300 focus:ring-2 focus:ring-gold-300/25"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="px-3.5 text-sm rounded-lg btn-gold disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
