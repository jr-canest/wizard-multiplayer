import { useEffect, useRef, useState } from 'react';
import { postReaction } from '../lib/gameFlow';
import { playerColor } from '../lib/playerColors';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

const REACTIONS = ['ouch', 'brutal', 'no mercy', 'hahaha', 'impressive'];
const TTL_MS = 3200;

export function Reactions({ room, myName }: Props) {
  const [open, setOpen] = useState(false);
  const [sending, setSending] = useState(false);
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
        onClick={() => setOpen((v) => !v)}
        aria-label="Send a reaction"
        className="absolute top-1.5 right-1.5 z-30 w-8 h-8 rounded-full bg-navy-800/80 border border-gold-700/60 flex items-center justify-center text-base shadow active:scale-95 transition"
      >
        📣
      </button>

      {open && (
        <div
          ref={popoverRef}
          className="absolute top-10 right-1.5 z-40 card-gold p-1.5 flex flex-col gap-1 min-w-[120px] shadow-xl"
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
        </div>
      )}
    </>
  );
}

export function ReactionDisplay({ room, myName }: Props) {
  const r = room.lastReaction;
  const [now, setNow] = useState(() => Date.now());

  // Tick once when a fresh reaction arrives so the banner clears at TTL
  // even if no other room update lands. We re-arm with a single timeout
  // per reaction to avoid a constant interval.
  useEffect(() => {
    if (!r) return;
    const remaining = r.ts + TTL_MS - Date.now();
    if (remaining <= 0) return;
    const id = window.setTimeout(() => setNow(Date.now()), remaining + 30);
    return () => window.clearTimeout(id);
  }, [r?.ts]);

  if (!r) return null;
  if (now - r.ts > TTL_MS) return null;
  if (r.player === myName) {
    // Self-reactions still show, but with a softer "you said" framing.
  }

  const c = playerColor(r.player, room.playerOrder);

  return (
    <div
      key={`${r.player}-${r.ts}`}
      className="absolute left-1/2 top-2 z-30 -translate-x-1/2 pointer-events-none animate-reaction-pop"
    >
      <div className="card-gold-subtle px-3 py-1 bg-navy-900/85 backdrop-blur text-center whitespace-nowrap">
        <span className={`${c.text} font-bold text-sm`}>{r.player}</span>
        <span className="text-gold-100 text-sm">: {r.text}</span>
      </div>
    </div>
  );
}
