import { useEffect, useRef, useState } from 'react';
import { sendChat } from '../lib/gameFlow';
import { playerColor } from '../lib/playerColors';
import type { RoomSnapshot } from '../hooks/useRoom';

const VISIBLE_CHAT_COUNT = 3;
// Opacity by distance from newest: 0 = newest, last entry = oldest visible.
const FADE_BY_DISTANCE = [1, 0.75, 0.5];

type Props = {
  room: RoomSnapshot;
  myName: string;
};

type ChatMessage = { player: string; text: string; ts: number };
type DisplayMessage = ChatMessage & { pending?: boolean };

/**
 * Compact chat used in the lobby, round-end scoreboard, and final
 * scoreboard. Renders the {@link VISIBLE_CHAT_COUNT} most recent
 * messages plus an input. Doc-backed via room.chat — see sendChat.
 * Locally-sent messages render optimistically (greyed out) the instant
 * they're sent, then snap to full opacity once the server echoes them
 * back through room.chat.
 */
export function Chat({ room, myName }: Props) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [optimistic, setOptimistic] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement>(null);
  const serverMessages = room.chat ?? [];

  // Drop optimistic messages once the server's chat array contains a
  // matching {player,text,ts}. arrayUnion preserves ts so equality holds.
  useEffect(() => {
    if (optimistic.length === 0) return;
    setOptimistic((prev) =>
      prev.filter(
        (o) =>
          !serverMessages.some(
            (m) => m.player === o.player && m.text === o.text && m.ts === o.ts,
          ),
      ),
    );
  }, [serverMessages, optimistic.length]);

  const allMessages: DisplayMessage[] = [
    ...serverMessages.map((m) => ({ ...m, pending: false })),
    ...optimistic.map((m) => ({ ...m, pending: true })),
  ];
  const messages = allMessages.slice(-VISIBLE_CHAT_COUNT);

  // Stick to the bottom whenever a new message arrives.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v || sending) return;
    setSending(true);
    setText('');
    const ts = Date.now();
    const draft: ChatMessage = { player: myName, text: v, ts };
    setOptimistic((prev) => [...prev, draft]);
    try {
      await sendChat(room.code, myName, v);
    } catch {
      // Drop the optimistic copy and restore the input so the send
      // doesn't silently vanish on a flaky network.
      setOptimistic((prev) => prev.filter((o) => o.ts !== ts));
      setText(v);
    } finally {
      setSending(false);
    }
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
            const baseOpacity =
              FADE_BY_DISTANCE[distanceFromNewest] ??
              FADE_BY_DISTANCE[FADE_BY_DISTANCE.length - 1];
            // Pending (optimistic) messages render greyed out, then snap
            // to baseOpacity the instant the server echoes them back.
            const opacity = m.pending ? baseOpacity * 0.4 : baseOpacity;
            return (
              <div
                key={`${m.ts}-${i}`}
                className="text-[12px] leading-snug break-words transition-opacity duration-300"
                style={{ opacity }}
              >
                <span
                  className={`${isMe ? 'text-gold-100' : c.text} font-bold`}
                >
                  {m.player}
                </span>
                <span className="text-navy-50">: {m.text}</span>
                {m.pending && (
                  <span
                    className="text-[10px] text-navy-300 ml-1 italic"
                    aria-label="sending"
                  >
                    sending…
                  </span>
                )}
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
          maxLength={200}
          placeholder="Say something…"
          aria-label="Chat message"
          className="flex-1 rounded-md bg-navy-800 border border-gold-700/60 px-2.5 py-1.5 text-sm text-navy-50 placeholder:text-navy-300 focus:outline-none focus:border-gold-400"
          disabled={sending}
        />
        <button
          type="submit"
          disabled={sending || !text.trim()}
          className="px-3 py-1.5 text-sm rounded-md btn-gold disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </div>
  );
}
