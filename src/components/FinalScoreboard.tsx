import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  computeStandings,
  roundBreakdownFromLog,
  saveMultiplayerGame,
} from '../lib/history';
import {
  claimAiSummary,
  setSharedAiSummary,
  votePlayAgain,
} from '../lib/gameFlow';
import { isTestGame } from '../lib/history';
import { isBot } from '../lib/rooms';
import { ScoreLineGraph } from './ScoreLineGraph';
import { RoundBreakdownTable } from './RoundBreakdownTable';
import { Chat } from './Chat';
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
  // Random positions/timings for the one-shot game-over sparkle layer.
  // Memoized with [] so the impure Math.random() calls only run once
  // on mount — re-randomizing on every render would make the
  // animation restart.
  const sparkles = useMemo(
    () =>
      Array.from({ length: 30 }, (_, i) => ({
        id: i,
        /* eslint-disable react-hooks/purity */
        left: 5 + Math.random() * 90,
        top: 5 + Math.random() * 85,
        delay: Math.random() * 2,
        duration: 0.6 + Math.random() * 0.8,
        size: 20 + Math.random() * 24,
        /* eslint-enable react-hooks/purity */
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
  // Won/bid per round per player, same table the scorekeeper shows at
  // the end of a game and the History detail shows afterwards. Derived
  // from the room log, so it is right even after undos.
  const breakdown = useMemo(() => roundBreakdownFromLog(room.log), [room.log]);
  const [savingState, setSavingState] = useState<
    'pending' | 'saving' | 'saved' | 'skipped' | 'error'
  >('pending');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [showWipe, setShowWipe] = useState(true);
  const [showSparkles, setShowSparkles] = useState(true);
  const [contentVisible, setContentVisible] = useState(false);

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

  // Persist to history exactly once per game. setSavingState fires
  // synchronously when the room snapshot says the write already
  // happened — same async-resolution pattern as DisconnectBanner.
  useEffect(() => {
    if (room.historyWritten) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
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

  // AI commentary. The recap lives on the room doc so every player sees
  // the same text. The first client to open the FinalScoreboard claims
  // the fetch via a Firestore transaction; everyone else waits for the
  // field to land via the room subscription.
  const fallbackSummary = useMemo(
    () => getFallbackSummary(room),
    // Compute once at mount; the room data is final once status === finished.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );
  const aiClaimAttempted = useRef(false);
  const [aiTimedOut, setAiTimedOut] = useState(false);
  const aiSummary = room.aiSummary ?? null;
  const aiClaimed = !!room.aiSummaryRequested;
  // Loading until the shared field lands (either we win the claim and
  // write it, or another client did). Only relevant in production.
  const aiLoading =
    isProduction() &&
    room.playerOrder.length >= 2 &&
    aiSummary === null;

  // Watchdog: if the shared summary hasn't landed after 15s (e.g. the
  // claiming device got suspended mid-fetch — hi, iPad), fall back to
  // the local deterministic recap so nobody is stuck on "Analyzing…"
  // forever. Once timed out, a late AI arrival is ignored on this
  // device — the table only ever sees ONE commentary, no swap.
  useEffect(() => {
    if (!aiLoading) return;
    const t = window.setTimeout(() => setAiTimedOut(true), 15000);
    return () => window.clearTimeout(t);
  }, [aiLoading]);

  useEffect(() => {
    if (aiClaimAttempted.current) return;
    if (aiSummary) return; // already shared
    if (aiClaimed) return; // someone else is fetching
    if (standings.length < 2) return;
    if (!isProduction()) return;
    aiClaimAttempted.current = true;
    claimAiSummary(room.code).then(async (won) => {
      if (!won) return;
      // Test/bot games: skip the AI call (saves quota) — write the
      // deterministic fallback directly.
      const skipAi = isTestGame(room);
      let s: string | null = null;
      if (!skipAi) {
        try {
          s = await fetchAISummary(buildAISummaryPayload(room));
        } catch {
          s = null;
        }
      }
      // Always share something — falls back to the deterministic recap
      // when the AI call fails / returns null. Otherwise everyone stays
      // stuck on "Generating recap…".
      const final = s ?? fallbackSummary;
      await setSharedAiSummary(room.code, final).catch(() => {});
      // Persist onto the games doc only when the AI summary actually
      // succeeded — fallbacks are cheap to recompute, no need to cache.
      if (s) {
        const persist = (retries = 5): void => {
          if (gameIdRef.current) {
            updateDoc(doc(db, 'games', gameIdRef.current), { summary: s })
              .catch(() => {});
          } else if (retries > 0) {
            window.setTimeout(() => persist(retries - 1), 400);
          }
        };
        persist();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aiSummary, aiClaimed]);

  // Single-commentary contract: show "Analyzing the game" until exactly
  // one text is ready — the shared AI recap, or the fallback if the
  // fetch failed/timed out. Never flash the fallback and swap it later.
  const stillAnalyzing = aiLoading && !aiTimedOut;
  const displayedSummary = aiTimedOut
    ? fallbackSummary
    : (aiSummary ?? (stillAnalyzing ? null : fallbackSummary));

  // Unanimous vote — every real player must opt in to start a new game.
  const realPlayers = room.playerOrder.filter((n) => !isBot(room, n));
  const playAgainVotes = (room.playAgainVotes ?? []).filter((n) =>
    realPlayers.includes(n),
  );
  const myPlayAgainVote = playAgainVotes.includes(myName);
  const playAgainThreshold = Math.max(1, realPlayers.length);

  async function handlePlayAgain() {
    setResetting(true);
    setResetError(null);
    try {
      await votePlayAgain(room.code, myName, !myPlayAgainVote);
    } catch (err) {
      setResetError(err instanceof Error ? err.message : 'Failed to vote.');
    } finally {
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
          <div className="eyebrow">Game over</div>
          <div className="font-display font-semibold text-[30px] leading-none text-cream-bright mt-2.5">
            {standings[0]?.name} wins!
          </div>
          <div className="ornament mt-3.5">
            <span className="diamond" />
          </div>
        </div>

        <ScoreLineGraph room={room} />

        {(stillAnalyzing || displayedSummary) && (
          <div
            className={`card-gold-subtle px-4 py-3.5 text-center relative ${
              stillAnalyzing ? 'wm-summary-shimmer' : ''
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
              @keyframes wm-summary-loading-dots {
                0%, 20% { opacity: 0.3; }
                50% { opacity: 1; }
                100% { opacity: 0.3; }
              }
              .wm-summary-shimmer {
                animation: wm-summary-shimmer-pulse 1.4s ease-in-out infinite;
              }
              .wm-summary-text {
                animation: wm-summary-fade-in 0.5s ease-out;
              }
              /* Player names (<b> tags from the AI) switch to sans + gold so
                 they pop out of the serif prose instead of blending in. */
              .wm-summary-text b {
                font-family: var(--font-sans, ui-sans-serif, system-ui, sans-serif);
                font-weight: 600;
                font-size: 0.82em;
                color: #e2c579;
                letter-spacing: 0.01em;
              }
              .wm-summary-dot {
                animation: wm-summary-loading-dots 1.4s ease-in-out infinite;
                display: inline-block;
              }
              .wm-summary-dot:nth-child(2) { animation-delay: 0.2s; }
              .wm-summary-dot:nth-child(3) { animation-delay: 0.4s; }
            `}</style>
            {stillAnalyzing ? (
              <p className="text-gold-100/70 text-sm italic">
                Analyzing the game
                <span className="wm-summary-dot">.</span>
                <span className="wm-summary-dot">.</span>
                <span className="wm-summary-dot">.</span>
              </p>
            ) : (
              <p
                key={displayedSummary}
                className="wm-summary-text font-display text-cream text-[17px] leading-[1.6]"
                dangerouslySetInnerHTML={{ __html: displayedSummary ?? '' }}
              />
            )}
          </div>
        )}

        <Chat room={room} myName={myName} />

        <ul className="space-y-1.5">
          {standings.map((s) => {
            const isMe = s.name === myName;
            const isFirst = s.rank === 1 && s.score > 0;
            const medal = MEDAL[s.rank] ?? POSITIONS[s.rank - 1] ?? `${s.rank}.`;
            return (
              <li
                key={s.name}
                className={`card-gold-subtle flex items-center justify-between px-3 py-2 ${
                  isFirst ? 'bg-gold-300/[.07]' : ''
                }`}
              >
                <span className="flex items-center gap-2">
                  <span
                    className={`text-sm w-7 text-center ${
                      isFirst ? 'text-gold-text' : 'text-navy-200'
                    }`}
                  >
                    {medal}
                  </span>
                  <span
                    className={`font-display font-semibold text-[17px] ${
                      isMe ? 'text-cream-bright' : 'text-cream'
                    }`}
                  >
                    {s.name}
                    {isMe ? ' (you)' : ''}
                  </span>
                </span>
                <span
                  className={`font-bold tabular-nums text-[22px] leading-none ${
                    s.score > 0
                      ? 'text-[#6ee7b7]'
                      : s.score < 0
                        ? 'text-[#fda4af]'
                        : 'text-cream'
                  }`}
                >
                  {s.score < 0 ? `−${Math.abs(s.score)}` : s.score}
                </span>
              </li>
            );
          })}
        </ul>

        {breakdown.length > 0 && (
          <RoundBreakdownTable
            breakdown={breakdown}
            playerOrder={room.playerOrder}
          />
        )}

        <p className="text-xs text-center text-navy-300">
          {savingState === 'saving' && 'Saving to history…'}
          {savingState === 'saved' && '✓ Saved to history.'}
          {savingState === 'skipped' && 'History saving skipped (localhost).'}
          {savingState === 'error' && '⚠ Could not save to history.'}
        </p>

        <button
          type="button"
          onClick={handlePlayAgain}
          disabled={resetting}
          className={`w-full h-12 rounded-lg font-bold border tabular-nums transition ${
            myPlayAgainVote
              ? 'bg-[rgba(6,78,59,.3)] border-[rgba(16,185,129,.6)] text-emerald-100'
              : 'btn-gold'
          }`}
        >
          {resetting
            ? 'Working…'
            : myPlayAgainVote
              ? `✓ Voted · play again ${playAgainVotes.length}/${playAgainThreshold}`
              : `Play again ${playAgainVotes.length}/${playAgainThreshold}`}
        </button>
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
