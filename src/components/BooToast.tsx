import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { booPhrase } from '../lib/booPhrases';
import { playBooSound } from '../lib/sounds';
import type { RoomSnapshot } from '../hooks/useRoom';

const SHOW_MS = 1700;
const OUT_MS = 300;

/**
 * The moment a shame vote carries: the scorekeeper's "BOOOO, NAME!" in big
 * red letters on every phone, with the boo. Driven by new 'shame' entries
 * in the room log, so a phone that joins or reloads later stays quiet.
 * Never takes touches: the game goes on underneath.
 */
export function BooToast({ room }: { room: RoomSnapshot }) {
  const shames = room.log.filter((e) => e.t === 'shame');
  const count = shames.length;
  const seen = useRef<{ code: string; count: number } | null>(null);
  const [toast, setToast] = useState<{ text: string; key: number; leaving: boolean } | null>(null);

  useEffect(() => {
    const prev = seen.current;
    seen.current = { code: room.code, count };
    // First snapshot, another room, or a new game: nothing to announce.
    if (!prev || prev.code !== room.code || count <= prev.count) return;
    const last = shames[count - 1];
    if (!last || last.t !== 'shame') return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setToast({ text: booPhrase(last.player, count + last.round), key: Date.now(), leaving: false });
    playBooSound();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [count, room.code]);

  useEffect(() => {
    if (!toast || toast.leaving) return;
    const key = toast.key;
    const out = window.setTimeout(() => setToast((t) => (t && t.key === key ? { ...t, leaving: true } : t)), SHOW_MS);
    const done = window.setTimeout(() => setToast((t) => (t && t.key === key ? null : t)), SHOW_MS + OUT_MS);
    return () => { window.clearTimeout(out); window.clearTimeout(done); };
  }, [toast?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!toast) return null;
  return createPortal(
    <div className="fixed inset-0 z-[520] flex items-center justify-center pointer-events-none px-6" aria-live="assertive">
      <div className={`absolute inset-0 bg-black/70 ${toast.leaving ? 'boo-backdrop-out' : 'boo-backdrop-in'}`} />
      <div
        key={toast.key}
        className={`relative text-center text-red-400 font-black tracking-wide [overflow-wrap:anywhere] ${toast.leaving ? 'boo-text-out' : 'boo-text-in'}`}
        style={{ fontSize: 'clamp(2.25rem, 10vw, 4.5rem)', lineHeight: 1.05, textShadow: '0 0 24px rgba(255,50,50,.5), 0 4px 12px rgba(0,0,0,.9)' }}
      >
        {toast.text}
      </div>
    </div>,
    document.body,
  );
}
