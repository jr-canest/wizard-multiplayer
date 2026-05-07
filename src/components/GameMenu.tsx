import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeRoundDeltas,
  cumulativeScoresFromLog,
} from '../lib/gameFlow';
import { playerColor } from '../lib/playerColors';
import { getUIZoom } from '../hooks/useUIScale';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * The "burger menu" on the round header. A scores-only sheet — running
 * cumulative totals (with the current round folded in if we're on the
 * scoring screen). All voting lives on the round-end RoundScoreboard.
 */
export function GameMenu({ room, myName }: Props) {
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<{
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const sheetRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Anchor to the trick-area frame so the sheet width matches the table
  // column. Re-measure when opened + on resize.
  useLayoutEffect(() => {
    if (!open) return;
    function update() {
      const el = document.querySelector<HTMLElement>(
        '[data-trick-area-frame]',
      );
      if (!el) return;
      const r = el.getBoundingClientRect();
      // Compensate body { zoom } on fixed coords (see BidModal).
      const zoom = getUIZoom();
      setAnchor({
        left: r.left / zoom,
        top: r.top / zoom,
        width: r.width / zoom,
      });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handleDown(e: PointerEvent) {
      const t = e.target as Node | null;
      if (!t) return;
      if (sheetRef.current?.contains(t)) return;
      if (buttonRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('pointerdown', handleDown);
    return () => document.removeEventListener('pointerdown', handleDown);
  }, [open]);

  // During scoring, fold this round's deltas in so the totals match
  // what RoundScoreboard projects. Outside scoring, the log is the
  // authoritative running total.
  const isScoring = room.status === 'scoring';
  const baseCumulative = cumulativeScoresFromLog(room.playerOrder, room.log);
  const liveDeltas = isScoring
    ? computeRoundDeltas(room.playerOrder, room.bids, room.tricksWon)
    : null;
  function liveTotal(name: string): number {
    return (baseCumulative[name] ?? 0) + (liveDeltas?.[name] ?? 0);
  }

  const standings = [...room.playerOrder].sort(
    (a, b) => liveTotal(b) - liveTotal(a),
  );

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="Scores"
        className="ml-1 w-7 h-7 rounded-full bg-navy-800/80 border border-gold-700/60 flex items-center justify-center text-xs text-gold-200 active:scale-95 transition"
      >
        ☰
      </button>

      {open && (
        <>
          {/* tap-out backdrop */}
          <div className="fixed inset-0 z-[270] bg-black/40" />
          <div
            ref={sheetRef}
            className="fixed z-[280] card-gold p-3 space-y-3 shadow-2xl"
            style={
              anchor
                ? {
                    left: anchor.left,
                    top: Math.max(8, anchor.top - 4),
                    width: anchor.width,
                  }
                : {
                    left: '50%',
                    top: '8vh',
                    transform: 'translateX(-50%)',
                    width: 'min(92vw, 360px)',
                  }
            }
          >
            <div className="flex items-center justify-between">
              <span className="text-xs uppercase tracking-wider text-gold-200">
                Total scores
              </span>
              <span className="text-[11px] tabular-nums text-navy-300">
                Round {room.currentRound}/{room.totalRounds}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-navy-300 text-sm px-2"
              >
                ✕
              </button>
            </div>

            <ul className="divide-y divide-gold-700/20">
              {standings.map((name, i) => {
                const score = liveTotal(name);
                const bid = room.bids[name];
                const won = room.tricksWon[name] ?? 0;
                const isMe = name === myName;
                const c = playerColor(name, room.playerOrder);
                return (
                  <li
                    key={name}
                    className="flex items-center justify-between py-1.5"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="text-navy-300 text-xs w-4 text-right">
                        {i + 1}.
                      </span>
                      <span
                        className={`text-sm truncate ${
                          isMe ? 'font-bold text-gold-100' : c.text
                        }`}
                      >
                        {name}
                        {isMe ? ' (you)' : ''}
                      </span>
                      {bid !== undefined && (
                        <span className="text-[11px] tabular-nums text-navy-300">
                          {won}/{bid}
                        </span>
                      )}
                    </span>
                    <span
                      className={`tabular-nums font-bold text-lg ${
                        score > 0
                          ? 'text-emerald-300'
                          : score < 0
                            ? 'text-rose-300'
                            : 'text-navy-200'
                      }`}
                    >
                      {score}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        </>
      )}
    </>
  );
}
