import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { postReaction } from '../lib/gameFlow';
import { playerColor } from '../lib/playerColors';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

const REACTIONS = [
  'ouch',
  'take your time',
  'no mercy',
  'hahaha',
  'impressive',
  'respect the game',
];
const TTL_MS = 3200;

export function Reactions({ room, myName }: Props) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [anchor, setAnchor] = useState<{
    top: number;
    left: number;
  } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (popoverRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', handleDown);
    return () => document.removeEventListener('pointerdown', handleDown);
  }, [open]);

  // When opening, capture the button's viewport position so we can render
  // the popover in a portal anchored above it. This escapes any
  // overflow:hidden ancestors and guarantees it sits on top of everything.
  function toggleOpen() {
    setOpen((prev) => {
      const next = !prev;
      if (next && buttonRef.current) {
        const rect = buttonRef.current.getBoundingClientRect();
        setAnchor({
          top: rect.bottom + 6,
          left: rect.left,
        });
      }
      return next;
    });
  }

  async function pick(text: string) {
    if (sending) return;
    setSending(true);
    setOpen(false);
    try {
      await postReaction(room.code, myName, text);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label="Send a reaction"
        className="w-7 h-7 rounded-full bg-navy-800/80 border border-gold-700/60 flex items-center justify-center text-sm active:scale-95 transition"
      >
        📣
      </button>

      {open && anchor &&
        createPortal(
          <div
            ref={popoverRef}
            style={{
              position: 'fixed',
              top: anchor.top,
              left: anchor.left,
              zIndex: 9999,
            }}
            className="card-gold p-1.5 flex flex-col gap-1 min-w-[140px] shadow-2xl"
          >
            {REACTIONS.map((r) => (
              <button
                key={r}
                type="button"
                disabled={sending}
                onClick={() => pick(r)}
                className="text-left px-3 py-1.5 rounded-md text-sm text-gold-100 bg-navy-800/60 hover:bg-navy-700 active:scale-[0.98] transition"
              >
                {r}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}

/**
 * Whether `room.lastReaction` is still within the TTL window. Used by
 * StatusRow to slot the reaction banner into the row.
 */
export function useActiveReaction(
  room: RoomSnapshot,
): { player: string; text: string; ts: number } | null {
  const r = room.lastReaction;
  const [, setTick] = useState(0);

  useEffect(() => {
    if (!r) return;
    const remaining = r.ts + TTL_MS - Date.now();
    if (remaining <= 0) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), remaining + 30);
    return () => window.clearTimeout(id);
  }, [r?.ts]);

  if (!r) return null;
  if (Date.now() - r.ts > TTL_MS) return null;
  return r;
}

export function ReactionInline({
  room,
}: {
  room: RoomSnapshot;
}) {
  const r = useActiveReaction(room);
  if (!r) return null;
  const c = playerColor(r.player, room.playerOrder);
  return (
    <div
      key={`${r.player}-${r.ts}`}
      className="flex-1 rounded-md bg-navy-900/70 border border-gold-700/50 px-3 py-1 flex items-center justify-center gap-1 animate-reaction-inline whitespace-nowrap"
    >
      <span className={`${c.text} font-bold text-sm`}>{r.player}</span>
      <span className="text-gold-100 text-sm">: {r.text}</span>
    </div>
  );
}
