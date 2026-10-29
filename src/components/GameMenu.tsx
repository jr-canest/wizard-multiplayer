import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  computeRoundDeltas,
  cumulativeScoresFromLog,
} from '../lib/gameFlow';
import { playerColor , colorOrder } from '../lib/playerColors';
import { getUIZoom } from '../hooks/useUIScale';
import { useSoundEnabled } from '../hooks/useGameSounds';
import { playBidSound, setSoundEnabled } from '../lib/sounds';
import type { RoomSnapshot } from '../hooks/useRoom';
import { useNavigate } from 'react-router-dom';
import { leaveGame } from '../lib/rooms';
import { setActiveRoomCode } from '../hooks/useActiveRoom';
import { CloseIcon, MenuIcon } from './Icons';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

/**
 * The "burger menu" on the round header: running cumulative totals (with
 * the current round folded in if we're on the scoring screen), the Sound
 * switch and "Leave game" (2026-10-20), which asks first and then lets the
 * others play on. All voting lives on the round-end RoundScoreboard.
 */
export function GameMenu({ room, myName }: Props) {
  const [open, setOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [leaveError, setLeaveError] = useState(false);
  const navigate = useNavigate();
  const soundOn = useSoundEnabled();
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
        onClick={() => {
          setOpen((v) => !v);
          setConfirmLeave(false);
        }}
        aria-label="Scores"
        className="ml-1 w-7 h-7 shrink-0 rounded-full bg-[rgba(20,26,44,.8)] border border-gold-300/40 flex items-center justify-center text-cream active:scale-95 transition"
      >
        <MenuIcon size={13} />
      </button>

      {open && (
        <>
          {/* tap-out backdrop */}
          <div className="fixed inset-0 z-[270] bg-[rgba(4,8,18,.72)]" />
          <div
            ref={sheetRef}
            className="fixed z-[280] card-gold p-3 space-y-3 shadow-2xl"
            style={{
              // Solid: the kit's .card-gold is translucent, and the trick
              // cards showing through made the scores hard to read.
              background: 'linear-gradient(180deg,#1a2240,#0c1226)',
              ...(anchor
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
                  }),
            }}
          >
            <div className="flex items-center justify-between">
              <span className="section-label">
                Total scores
              </span>
              <span className="text-[11px] tabular-nums text-navy-300">
                Round {room.currentRound}/{room.totalRounds}
              </span>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close"
                className="-mr-1 w-7 h-7 flex items-center justify-center text-navy-300 hover:text-cream"
              >
                <CloseIcon />
              </button>
            </div>

            <ul className="divide-y divide-gold-700/20">
              {standings.map((name, i) => {
                const score = liveTotal(name);
                const bid = room.bids[name];
                const won = room.tricksWon[name] ?? 0;
                const isMe = name === myName;
                const c = playerColor(name, colorOrder(room));
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
                          isMe ? 'font-bold text-gold-text' : c.text
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

            {/* Sound on/off for this phone (the silent switch mutes it too). */}
            <button
              type="button"
              role="switch"
              aria-checked={soundOn}
              onClick={() => {
                setSoundEnabled(!soundOn);
                if (!soundOn) playBidSound(4);
              }}
              className="w-full flex items-center justify-between pt-2.5 border-t border-gold-700/20 text-sm text-cream"
            >
              <span>Sound</span>
              <span
                className={`relative w-10 h-6 rounded-full transition-colors ${
                  soundOn ? 'bg-gold-500' : 'bg-navy-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-cream shadow transition-transform ${
                    soundOn ? 'translate-x-4' : ''
                  }`}
                />
              </span>
            </button>

            {room.status !== 'finished' &&
              (confirmLeave ? (
                <div className="pt-2.5 border-t border-gold-700/20 space-y-2">
                  <p className="text-[13px] leading-snug text-cream whitespace-normal break-words">
                    Leave for good? You can't come back to this game. The others keep playing
                    without you, and it won't count in your History.
                  </p>
                  {leaveError && (
                    <p className="text-[12px] text-rose-300">Couldn't leave. Check your connection.</p>
                  )}
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setConfirmLeave(false)}
                      className="flex-1 btn-secondary py-2 text-sm"
                    >
                      Stay
                    </button>
                    <button
                      type="button"
                      disabled={leaving}
                      onClick={async () => {
                        setLeaving(true);
                        setLeaveError(false);
                        try {
                          await leaveGame(room.code);
                          setActiveRoomCode(null);
                          navigate('/');
                        } catch {
                          setLeaveError(true);
                          setLeaving(false);
                        }
                      }}
                      className="flex-1 btn-danger py-2 text-sm disabled:opacity-60"
                    >
                      {leaving ? 'Leaving…' : 'Leave game'}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setConfirmLeave(true)}
                  className="w-full text-left pt-2.5 border-t border-gold-700/20 text-sm text-rose-300"
                >
                  Leave game
                </button>
              ))}
          </div>
        </>
      )}
    </>
  );
}
