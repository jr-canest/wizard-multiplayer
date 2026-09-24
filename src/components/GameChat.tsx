import { Fragment, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useChatThread } from '../hooks/useChatThread';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { CHAT_MAX_LEN, type ChatMessage } from '../lib/chat';
import { playerColor } from '../lib/playerColors';
import { REACTIONS, recordReactionUse } from '../lib/reactions';
import { isTestGame } from '../lib/history';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/** "Lobby" / "Round 3" / "Game over" for a chat window key. */
function windowLabel(w: string): string {
  const part = w.slice(w.indexOf(':') + 1);
  if (part === 'lobby') return 'Lobby';
  if (part === 'final') return 'Game over';
  return `Round ${part.slice(1)}`;
}

/**
 * In-game chat (2026-09-24, replaced the 📣 reaction list): a chat button
 * in the header strip opening a hub over the table with the whole game's
 * chat, a text box and the quick reactions as one-tap buttons. New lines
 * show on the felt (OverlayBanner), which is how the table reads them
 * mid-trick, so the button carries no unread count (Jorge: a count for
 * lines you already read on the table is confusing).
 *
 * The button only shows while cards are out; the round-end and final
 * screens have their own chat box. The component stays mounted through
 * the round end so a hub left open (and a half-typed line) survives it.
 */
export function GameChat({ room, myName }: Props) {
  const [open, setOpen] = useState(false);
  const { lines, send } = useChatThread(room, myName, 'game');
  const inPlay = room.status !== 'scoring' && room.status !== 'finished';

  return (
    <>
      {inPlay && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Chat"
          className="w-7 h-7 shrink-0 rounded-full bg-navy-800/80 border border-gold-700/60 flex items-center justify-center text-gold-200 active:scale-95 transition"
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M3 2.75h10a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5H7.25L4.5 13.5v-2.25H3a1.5 1.5 0 0 1-1.5-1.5v-5.5A1.5 1.5 0 0 1 3 2.75z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}
      {open && (
        <ChatHub room={room} myName={myName} lines={lines} send={send} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

/**
 * The hub: drops from the top of the screen so the text box stays above
 * the phone keyboard, and never takes more than half the screen: the
 * message list scrolls inside it while the text box and quick buttons stay
 * put. Sits under the vote modals (z-[500]) so a vote that opens mid-chat
 * is still in front. Quick buttons send and close; typed lines keep the
 * hub open.
 */
function ChatHub({
  room,
  myName,
  lines,
  send,
  onClose,
}: {
  room: RoomSnapshot;
  myName: string;
  lines: ChatMessage[];
  send: (text: string) => Promise<boolean>;
  onClose: () => void;
}) {
  useBodyScrollLock();
  const [text, setText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  // Open at the newest line and follow new ones.
  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lines.length]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const v = text.trim();
    if (!v) return;
    setText('');
    void send(v).then((ok) => {
      if (!ok) setText((cur) => (cur ? cur : v));
    });
  }

  function quick(phrase: string) {
    // All-rooms tally of the quick buttons (src/lib/reactions.ts). Not
    // awaited, and test games do not count.
    recordReactionUse(phrase, isTestGame(room));
    void send(phrase);
    onClose();
  }

  return createPortal(
    <div className="fixed inset-0 z-[450]" role="dialog" aria-modal="true" aria-label="Chat">
      <div className="absolute inset-0 bg-[rgba(4,8,18,.6)]" onClick={onClose} />
      <div
        className="relative mx-auto w-full max-w-md px-2 pointer-events-none"
        style={{ paddingTop: 'max(8px, env(safe-area-inset-top))' }}
      >
        <div
          className="pointer-events-auto rounded-[14px] p-3 animate-chat-hub-in flex flex-col"
          style={{
            // The bottom edge stops at half the smallest viewport (Safari's
            // toolbars showing): half, in pre-zoom pixels because body
            // carries the UI zoom, minus the gap above the panel.
            maxHeight: 'calc(50svh / var(--ui-zoom, 1) - max(8px, env(safe-area-inset-top)))',
            border: '1px solid rgba(212,168,67,.5)',
            background: 'linear-gradient(180deg,rgba(22,29,52,.98),rgba(10,15,31,.98))',
            boxShadow: '0 18px 40px rgba(0,0,0,.65)',
          }}
        >
          <div className="shrink-0 flex items-center justify-between -mt-1 mb-1">
            <span className="text-[10px] uppercase tracking-[0.24em] font-bold text-cream-bright">
              Chat
            </span>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close chat"
              className="-mr-1.5 w-8 h-8 flex items-center justify-center text-navy-200 active:text-cream"
            >
              <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true">
                <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div ref={listRef} className="min-h-0 overflow-y-auto overscroll-contain px-0.5 space-y-1">
            {lines.length === 0 ? (
              <p className="py-5 text-center text-[13px] text-navy-300">
                No messages yet. Say something, or tap a quick one.
              </p>
            ) : (
              lines.map((m, i) => {
                const c = playerColor(m.player, room.playerOrder);
                const isMe = m.player === myName;
                const newWindow = i === 0 || lines[i - 1].w !== m.w;
                return (
                  <Fragment key={`${m.player}-${m.ts}-${i}`}>
                    {newWindow && (
                      <div className="flex items-center gap-2 pt-1.5 first:pt-0">
                        <span className="h-px flex-1 bg-gold-300/15" />
                        <span className="text-[10px] uppercase tracking-[0.14em] font-semibold text-navy-300">
                          {windowLabel(m.w)}
                        </span>
                        <span className="h-px flex-1 bg-gold-300/15" />
                      </div>
                    )}
                    <p className="text-[14px] leading-snug break-words">
                      <span className={`${isMe ? 'text-gold-text' : c.text} font-bold`}>{m.player}</span>
                      <span className="text-navy-50">: {m.text}</span>
                    </p>
                  </Fragment>
                );
              })
            )}
          </div>

          {/* 16px text: anything smaller makes iOS zoom the page on focus. */}
          <form onSubmit={submit} className="shrink-0 mt-2.5 flex gap-1.5 items-stretch">
            <input
              type="text"
              value={text}
              onChange={(e) => setText(e.target.value)}
              maxLength={CHAT_MAX_LEN}
              placeholder="Type a message…"
              aria-label="Chat message"
              enterKeyHint="send"
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

          <div className="shrink-0 mt-2.5 flex flex-wrap justify-center gap-1.5">
            {REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                onClick={() => quick(r)}
                className="rounded-full border border-gold-300/35 bg-navy-800/70 px-3 py-1.5 text-[13px] text-gold-100 active:scale-95 active:bg-navy-700 transition"
              >
                {r}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
