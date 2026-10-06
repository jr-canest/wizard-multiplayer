import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { getUIZoom } from '../hooks/useUIScale';
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
  // The typed line lives out here, not in the hub, so a send that fails
  // after the hub closed can put it back for the next time chat opens.
  const [draft, setDraft] = useState('');
  const { lines, send } = useChatThread(room, myName, 'game');
  const inPlay = room.status !== 'scoring' && room.status !== 'finished';
  // iOS only raises the keyboard for a focus() made inside the tap itself,
  // and the hub's text box does not exist yet at that moment. So the tap
  // focuses this stand-in box, and the hub moves focus to its own box as
  // it mounts: focus passing between two text boxes keeps the keyboard up.
  const proxyRef = useRef<HTMLInputElement>(null);

  return (
    <>
      {inPlay && (
        <input
          ref={proxyRef}
          aria-hidden="true"
          tabIndex={-1}
          className="fixed bottom-0 left-0 w-px h-px opacity-0 pointer-events-none text-[16px]"
        />
      )}
      {inPlay && (
        <button
          type="button"
          onClick={() => {
            proxyRef.current?.focus({ preventScroll: true });
            setOpen(true);
          }}
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
        <ChatHub
          room={room}
          myName={myName}
          lines={lines}
          send={send}
          draft={draft}
          setDraft={setDraft}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

/**
 * The hub (2026-10-06): opens with the text box focused so the phone
 * keyboard comes straight up, and sits right on top of the keyboard (the
 * visual viewport's bottom edge) with the text box last, so the top of the
 * table stays visible above it. It takes at most ~60% of what the keyboard
 * leaves and never more than half the screen: the message list scrolls
 * inside it while the quick buttons and text box stay put. Sits under the vote modals (z-[500]) so a vote that opens mid-chat
 * is still in front. Quick buttons and typed lines (Enter or Send) both
 * send and close (Jorge, 2026-09-28): the line shows on the felt anyway.
 */
function ChatHub({
  room,
  myName,
  lines,
  send,
  draft,
  setDraft,
  onClose,
}: {
  room: RoomSnapshot;
  myName: string;
  lines: ChatMessage[];
  send: (text: string) => Promise<boolean>;
  draft: string;
  setDraft: React.Dispatch<React.SetStateAction<string>>;
  onClose: () => void;
}) {
  useBodyScrollLock();
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const view = useVisibleArea();

  // Take the focus from GameChat's stand-in box so the keyboard that tap
  // raised stays up, now typing here.
  useLayoutEffect(() => {
    inputRef.current?.focus({ preventScroll: true });
  }, []);

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
    const v = draft.trim();
    if (!v) return;
    setDraft('');
    // A failed send puts the line back in the box, unless something new
    // was typed there since.
    void send(v).then((ok) => {
      if (!ok) setDraft((cur) => (cur ? cur : v));
    });
    onClose();
  }

  function quick(phrase: string) {
    // All-rooms tally of the quick buttons (src/lib/reactions.ts). Not
    // awaited, and test games do not count.
    recordReactionUse(phrase, isTestGame(room));
    void send(phrase);
    onClose();
  }

  const quickRow = (
    <div className="shrink-0 mt-2 -mx-3 px-3 flex gap-1.5 overflow-x-auto overscroll-contain no-scrollbar">
      {REACTIONS.map((r) => (
        <button
          key={r}
          type="button"
          onClick={() => quick(r)}
          className="shrink-0 whitespace-nowrap rounded-full border border-gold-300/35 bg-navy-800/70 px-3 py-1.5 text-[13px] text-gold-100 active:scale-95 active:bg-navy-700 transition"
        >
          {r}
        </button>
      ))}
    </div>
  );

  return createPortal(
    <div className="fixed inset-0 z-[450]" role="dialog" aria-modal="true" aria-label="Chat">
      <div className="absolute inset-0 bg-[rgba(4,8,18,.4)]" onClick={onClose} />
      {/* Covers exactly the part of the screen the keyboard leaves visible,
          so the panel can sit on the keyboard with the table above it. */}
      <div
        className="absolute inset-x-0 flex flex-col justify-end pointer-events-none"
        style={{ top: view.top, height: view.height }}
      >
        <div
          className="relative mx-auto w-full max-w-md px-2 pointer-events-none"
          style={{ paddingBottom: view.keyboardUp ? 6 : 'max(8px, env(safe-area-inset-bottom))' }}
        >
          <div
            className="pointer-events-auto rounded-[14px] p-3 pb-2.5 animate-chat-hub-in flex flex-col"
            style={{
              // At most ~60% of what the keyboard leaves (and never past half
              // the whole screen), so a slice of the table stays in view.
              maxHeight: Math.min(view.height * 0.6, view.screenHalf),
              border: '1px solid rgba(212,168,67,.5)',
              background: 'linear-gradient(180deg,rgba(22,29,52,.98),rgba(10,15,31,.98))',
              boxShadow: '0 -10px 34px rgba(0,0,0,.6)',
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
                <p className="py-3 text-center text-[13px] text-navy-300">
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

            {/* Quick ones in one sideways-scrolling row, then the text box
                last, right on top of the keyboard. */}
            {quickRow}

            {/* 16px text: anything smaller makes iOS zoom the page on focus. */}
            <form onSubmit={submit} className="shrink-0 mt-2 flex gap-1.5 items-stretch">
              <input
                ref={inputRef}
                type="text"
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                maxLength={CHAT_MAX_LEN}
                placeholder="Type a message…"
                aria-label="Chat message"
                enterKeyHint="send"
                className="flex-1 min-w-0 rounded-lg bg-[rgba(20,26,44,.9)] border border-gold-300/55 px-3 py-2 text-[16px] text-cream placeholder:text-navy-200 focus:outline-none focus:border-gold-300 focus:ring-2 focus:ring-gold-300/25"
              />
              <button
                type="submit"
                disabled={!draft.trim()}
                className="px-3.5 text-sm rounded-lg btn-gold disabled:opacity-50"
              >
                Send
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The part of the screen not covered by the on-screen keyboard, in the
 * page's own (pre-zoom) pixels for a fixed-position box: iOS keeps the
 * layout viewport full height under the keyboard and shrinks or pans only
 * the visual viewport, so this follows window.visualViewport.
 */
function useVisibleArea() {
  const read = () => {
    const zoom = getUIZoom();
    const vv = window.visualViewport;
    const full = window.innerHeight;
    const height = vv ? vv.height : full;
    const top = vv ? vv.offsetTop : 0;
    return {
      top: top / zoom,
      height: height / zoom,
      screenHalf: full / 2 / zoom,
      keyboardUp: full - height > 120,
    };
  };
  const [area, setArea] = useState(read);
  useEffect(() => {
    const vv = window.visualViewport;
    const update = () => setArea(read());
    vv?.addEventListener('resize', update);
    vv?.addEventListener('scroll', update);
    window.addEventListener('resize', update);
    return () => {
      vv?.removeEventListener('resize', update);
      vv?.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
    };
  }, []);
  return area;
}
