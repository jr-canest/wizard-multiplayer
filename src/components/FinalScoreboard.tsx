import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { computeStandings, saveMultiplayerGame } from '../lib/history';
import { resetForNewGame } from '../lib/gameFlow';
import {
  fetchAISummary,
  isProduction,
} from '../lib/firebase';
import {
  buildAISummaryPayload,
  getFallbackSummary,
} from '../lib/gameSummary';
import { playSparkleSound } from '../lib/sounds';
import { setActiveRoomCode } from '../hooks/useActiveRoom';
import { doc, updateDoc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import type { RoomSnapshot } from '../hooks/useRoom';

type Props = {
  room: RoomSnapshot;
  myName: string;
};

const MEDAL: Record<number, string> = { 1: '🥇', 2: '🥈', 3: '🥉' };
const POSITIONS = ['1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th', '9th', '10th'];
const SPARKLE_EMOJIS = ['🪄', '⭐', '✨'];

function WhiteWipe() {
  return (
    <div className="fixed inset-0 z-[60] pointer-events-none">
      <style>{`
        @keyframes wm-wipe-in {
          0% { transform: translateY(-100%); }
          100% { transform: translateY(100%); }
        }
        .wm-white-wipe {
          position: absolute;
          inset: 0;
          background: linear-gradient(180deg,
            transparent 0%,
            rgba(255,255,255,0.3) 10%,
            rgba(255,255,255,0.95) 30%,
            white 50%,
            rgba(255,255,255,0.95) 70%,
            rgba(255,255,255,0.3) 90%,
            transparent 100%
          );
          animation: wm-wipe-in 1s cubic-bezier(0.25, 0.1, 0.25, 1) forwards;
        }
      `}</style>
      <div className="wm-white-wipe" />
    </div>
  );
}

function Sparkles() {
  const sparkles = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        left: 5 + Math.random() * 90,
        top: 5 + Math.random() * 85,
        delay: Math.random() * 2,
        duration: 0.6 + Math.random() * 0.8,
        size: 20 + Math.random() * 24,
        emoji: SPARKLE_EMOJIS[i % SPARKLE_EMOJIS.length],
      })),
    [],
  );

  return (
    <div className="fixed inset-0 pointer-events-none z-50 overflow-hidden">
      <style>{`
        @keyframes wm-sparkle-pop {
          0% { transform: scale(0); opacity: 0; }
          20% { transform: scale(1.3); opacity: 1; }
          50% { transform: scale(0.9); opacity: 0.9; }
          70% { transform: scale(1.1); opacity: 0.7; }
          100% { transform: scale(0); opacity: 0; }
        }
        .wm-sparkle {
          position: absolute;
          animation: wm-sparkle-pop var(--dur) ease-in-out var(--delay) both;
          animation-iteration-count: 2;
          line-height: 1;
        }
      `}</style>
      {sparkles.map((s) => (
        <div
          key={s.id}
          className="wm-sparkle"
          style={
            {
              left: `${s.left}%`,
              top: `${s.top}%`,
              fontSize: s.size,
              '--delay': `${s.delay}s`,
              '--dur': `${s.duration}s`,
            } as React.CSSProperties
          }
        >
          {s.emoji}
        </div>
      ))}
    </div>
  );
}

export function FinalScoreboard({ room, myName }: Props) {
  const navigate = useNavigate();
  const standings = computeStandings(room);
  const [savingState, setSavingState] = useState<
    'pending' | 'saving' | 'saved' | 'skipped' | 'error'
  >('pending');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [showWipe, setShowWipe] = useState(true);
  const [showSparkles, setShowSparkles] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);

  const isHost = room.hostPlayerName === myName;
  const gameIdRef = useRef<string | null>(room.historyGameId ?? null);

  // Wipe + sparkles + sound on mount.
  useEffect(() => {
    playSparkleSound();
    const tContent = window.setTimeout(() => setContentVisible(true), 500);
    const tWipe = window.setTimeout(() => setShowWipe(false), 1100);
    const tSparkles = window.setTimeout(() => setShowSparkles(false), 3000);
    return () => {
      window.clearTimeout(tContent);
      window.clearTimeout(tWipe);
      window.clearTimeout(tSparkles);
    };
  }, []);

  // Persist to history exactly once per game.
  useEffect(() => {
    if (room.historyWritten) {
      setSavingState('saved');
      gameIdRef.current = room.historyGameId ?? null;
      return;
    }
    if (!isProduction()) {
      setSavingState('skipped');
      return;
    }
    setSavingState('saving');
    saveMultiplayerGame(room.code)
      .then((gid) => {
        gameIdRef.current = gid;
        setSavingState('saved');
      })
      .catch(() => setSavingState('error'));
  }, [room.code, room.historyWritten, room.historyGameId]);

  // AI commentary. Fallback shows immediately; AI replaces when it lands.
  const fallbackSummary = useMemo(
    () => getFallbackSummary(room),
    // Compute once at mount; the room data is final once status === finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const [aiSummary, setAiSummary] = useState<string | null>(null);
  const [aiLoading, setAiLoading] = useState(false);
  const aiFetchedRef = useRef(false);

  useEffect(() => {
    if (aiFetchedRef.current) return;
    if (standings.length < 2) return;
    if (!isProduction()) return;
    aiFetchedRef.current = true;
    setAiLoading(true);
    const payload = buildAISummaryPayload(room);
    fetchAISummary(payload)
      .then((s) => {
        if (!s) return;
        setAiSummary(s);
        // Persist onto the game doc so re-opens of finished games skip the
        // API. gameId may not be resolved yet — retry briefly.
        const persist = (retries = 5): void => {
          if (gameIdRef.current) {
            updateDoc(doc(db, 'games', gameIdRef.current), { summary: s })
              .catch(() => {});
          } else if (retries > 0) {
            window.setTimeout(() => persist(retries - 1), 400);
          }
        };
        persist();
      })
      .finally(() => setAiLoading(false));
    // Only on first mount of a finished room.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const summary = aiSummary || fallbackSummary;

  async function handlePlayAgain() {
    setResetting(true);
    setResetError(null);
    try {
      await resetForNewGame(room.code, myName);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to reset.');
      setResetting(false);
    }
  }

  return (
    <>
      {showWipe && <WhiteWipe />}
      {showSparkles && <Sparkles />}

      <div
        className={`card-gold p-4 space-y-4 transition-opacity duration-700 ${
          contentVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className="text-center">
          <div className="text-xs uppercase tracking-wider text-navy-200">
            Game over
          </div>
          <div className="text-2xl font-black text-gold-200 mt-1">
            {standings[0]?.name} wins!
          </div>
        </div>

        {summary && (
          <div
            className={`bg-navy-700/60 border border-gold-700/30 rounded-xl px-4 py-3 text-center relative ${
              aiLoading ? 'wm-summary-shimmer' : ''
            }`}
          >
            <style>{`
              @keyframes wm-summary-fade-in {
                from { opacity: 0; transform: translateY(4px); }
                to { opacity: 1; transform: translateY(0); }
              }
              @keyframes wm-summary-shimmer-pulse {
                0%, 100% { box-shadow: inset 0 0 0 1px rgba(254,205,70,0.0); }
                50% { box-shadow: inset 0 0 0 1px rgba(254,205,70,0.45); }
              }
              .wm-summary-shimmer {
                animation: wm-summary-shimmer-pulse 1.4s ease-in-out infinite;
              }
              .wm-summary-text {
                animation: wm-summary-fade-in 0.5s ease-out;
              }
            `}</style>
            <p
              key={summary}
              className="wm-summary-text text-gold-100 text-sm leading-relaxed"
              dangerouslySetInnerHTML={{ __html: summary }}
            />
          </div>
        )}

        <ul className="space-y-1.5">
          {standings.map((s) => {
            const isMe = s.name === myName;
            const isFirst = s.rank === 1 && s.score > 0;
            const medal = MEDAL[s.rank] ?? POSITIONS[s.rank - 1] ?? `${s.rank}.`;
            return (
              <li
                key={s.name}
                className={`flex items-center justify-between rounded-md px-3 py-2 ${
                  isFirst ? 'bg-gold-300/10' : 'bg-navy-800/60'
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`text-sm w-7 text-center ${
                      isFirst ? 'text-gold-200' : 'text-navy-200'
                    }`}
                  >
                    {medal}
                  </span>
                  <span
                    className={
                      isMe ? 'font-bold text-gold-100' : 'text-navy-50'
                    }
                  >
                    {s.name}
                    {isMe ? ' (you)' : ''}
                  </span>
                </span>
                <span
                  className={`font-bold tabular-nums text-lg ${
                    s.score > 0
                      ? 'text-emerald-300'
                      : s.score < 0
                        ? 'text-rose-300'
                        : 'text-navy-200'
                  }`}
                >
                  {s.score}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="text-xs text-center text-navy-300">
          {savingState === 'saving' && 'Saving to history…'}
          {savingState === 'saved' && '✓ Saved to history.'}
          {savingState === 'skipped' && 'History saving skipped (localhost).'}
          {savingState === 'error' && '⚠ Could not save to history.'}
        </p>

        {isHost && (
          <button
            type="button"
            onClick={handlePlayAgain}
            disabled={resetting}
            className="btn-gold w-full rounded-xl py-3"
          >
            {resetting ? 'Resetting…' : 'Play again'}
          </button>
        )}
        {resetError && (
          <p className="text-sm text-rose-300 text-center">{resetError}</p>
        )}

        <button
          type="button"
          onClick={() => {
            setActiveRoomCode(null);
            navigate('/');
          }}
          className="w-full text-sm text-navy-200 underline underline-offset-2 hover:text-gold-200"
        >
          Back to home
        </button>
      </div>
    </>
  );
}
