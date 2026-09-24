import { useEffect, useState } from 'react';
import { requestUndo } from '../lib/gameFlow';
import { playerColor } from '../lib/playerColors';
import { chatWindowKey } from '../lib/chat';
import { useChat } from '../hooks/useChat';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

// Each line lingers long enough to be read and glanced at. The felt shows
// the newest two, so a busy table pushes the older one out early.
const TTL_MS = 7000;
const MAX_SHOWN = 2;
// Covers the .felt-msg-out fold in index.css.
const EXIT_MS = 340;

type FeltLine = { key: string; player: string; text: string; ts: number };
type FeltItem = FeltLine & { leaving: boolean };

/**
 * This round's newest lines under TTL_MS old, newest last, at most
 * MAX_SHOWN: chat lines (typed or quick buttons in the chat hub) plus a
 * reaction from a phone still on the old 📣 build (`room.lastReaction`).
 */
function useLiveLines(room: RoomSnapshot): FeltLine[] {
  const chat = useChat(room.code);
  const windowKey = chatWindowKey(room);
  const lines: FeltLine[] = [];
  for (const m of chat) {
    if (m.w === windowKey) lines.push({ key: `c-${m.player}-${m.ts}`, player: m.player, text: m.text, ts: m.ts });
  }
  const r = room.lastReaction;
  if (r) lines.push({ key: `r-${r.player}-${r.ts}`, player: r.player, text: r.text, ts: r.ts });

  // Date.now() is intentionally read during render: the timer below forces
  // a re-render exactly when the oldest shown line runs out.
  // eslint-disable-next-line react-hooks/purity
  const now = Date.now();
  const live = lines
    .filter((l) => now - l.ts <= TTL_MS)
    .sort((a, b) => a.ts - b.ts)
    .slice(-MAX_SHOWN);

  const nextExpiry = live.length > 0 ? live[0].ts + TTL_MS : null;
  const [, setTick] = useState(0);
  useEffect(() => {
    if (nextExpiry == null) return;
    const id = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, nextExpiry - Date.now()) + 30);
    return () => window.clearTimeout(id);
  }, [nextExpiry]);

  return live;
}

/**
 * Keeps a line that just left (ran out, or pushed out by a newer one) on
 * screen for its exit animation. State is adjusted during render when the
 * live set changes (React's pattern for deriving from a prop change), and
 * a timer drops the leavers once the fold has played.
 */
function useFeltItems(live: FeltLine[]): FeltItem[] {
  const liveSig = live.map((l) => l.key).join('|');
  const [items, setItems] = useState<FeltItem[]>(() => live.map((l) => ({ ...l, leaving: false })));
  const [sig, setSig] = useState(liveSig);
  if (sig !== liveSig) {
    setSig(liveSig);
    const liveKeys = new Set(live.map((l) => l.key));
    const known = new Set(items.map((i) => i.key));
    setItems([
      ...items.map((i) => (liveKeys.has(i.key) ? i : { ...i, leaving: true })),
      ...live.filter((l) => !known.has(l.key)).map((l) => ({ ...l, leaving: false })),
    ]);
  }

  const leavingSig = items.filter((i) => i.leaving).map((i) => i.key).join('|');
  useEffect(() => {
    if (!leavingSig) return;
    const id = window.setTimeout(() => setItems((prev) => prev.filter((i) => !i.leaving)), EXIT_MS);
    return () => window.clearTimeout(id);
  }, [leavingSig]);

  return items;
}

/**
 * Chat on the felt: the newest two lines stacked at the top of the trick
 * area, newest at the bottom, two text lines each (the chat hub has the
 * rest). A new line fades up into the bottom slot and pushes the older one
 * up; a line that leaves fades and folds so the one below glides up. The
 * undo affordance lives in the action strip above the user's hand
 * (UndoStripBar) so it sits inside the player's natural focus zone.
 */
export function OverlayBanner({ room }: Props) {
  const items = useFeltItems(useLiveLines(room));

  if (items.length === 0) return null;

  return (
    <div
      className="absolute top-1.5 left-1.5 right-1.5 z-[180] pointer-events-none flex flex-col items-start"
      aria-live="polite"
    >
      {/* No pointer-events: this sits over the trick drop zone, and a
          message popping up mid-drag must not swallow the card drop. */}
      {items.map((it) => {
        const c = playerColor(it.player, room.playerOrder);
        return (
          <div key={it.key} className={`felt-msg${it.leaving ? ' felt-msg-out' : ''}`}>
            <div>
              <div className="animate-felt-msg-in mb-1 backdrop-blur rounded-md border border-gold-500/70 bg-navy-900/85 px-2 py-1 shadow-lg">
                <p className="text-sm leading-snug line-clamp-2 break-words">
                  <span className={`${c.text} font-bold`}>{it.player}</span>
                  <span className="text-gold-100">: {it.text}</span>
                </p>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/**
 * The actor's own "was that a mistake?" prompt, shown in the action strip
 * above their hand. Tapping Undo opens the table-wide vote, which is a
 * center-screen modal (UndoVoteModal), not this strip: once a vote is
 * open the game is paused and every player needs to see it, so there is
 * nothing left for this bar to show.
 */
export function UndoStripBar({ room, myName }: Props) {
  const [busy, setBusy] = useState(false);
  const pu = room.pendingUndo;
  if (!pu) return null;
  if (room.status !== 'bidding' && room.status !== 'playing') return null;
  if (pu.actor !== myName || pu.requested) return null;

  const actionWord = pu.kind === 'bid' ? 'bid' : 'play';

  async function onRequest() {
    if (busy) return;
    setBusy(true);
    try {
      await requestUndo(room.code, myName);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      key={`u-${pu.actor}-mine`}
      className="rounded-md border border-rose-600/70 bg-rose-900/35 text-rose-100 px-2 py-1 text-[11px] leading-tight animate-overlay-banner-inline"
      aria-live="polite"
    >
      <button
        type="button"
        onClick={onRequest}
        disabled={busy}
        title={`Undo your last ${actionWord}`}
        className="w-full flex items-center justify-center gap-1.5 text-[11px] font-bold text-gold-200 active:text-gold-100 disabled:opacity-60"
      >
        <span aria-hidden="true">↶</span>
        <span>Undo last move</span>
      </button>
    </div>
  );
}
