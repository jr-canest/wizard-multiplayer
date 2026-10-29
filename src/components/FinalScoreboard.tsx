import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  computeStandings,
  roundBreakdownFromLog,
  saveMultiplayerGame,
} from '../lib/history';
import { useFullLog } from '../hooks/useFullLog';
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
import { CROWN_LANDS_MS, CountUp, CrownTitle, GoldWash, STANDINGS_START_MS, STANDINGS_STEP_MS } from './GameOverCrown';
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
export function FinalScoreboard({ room, myName }: Props) {
  const navigate = useNavigate();
  const standings = computeStandings(room);
  // Won/bid per round per player, same table the scorekeeper shows at
  // the end of a game and the History detail shows afterwards. Derived
  // from the WHOLE log (archived rounds included), so it is right even
  // after undos and after the round archives took the bulk off the doc.
  const { log: fullLog } = useFullLog(room);
  const breakdown = useMemo(() => roundBreakdownFromLog(fullLog), [fullLog]);
  const [savingState, setSavingState] = useState<
    'pending' | 'saving' | 'saved' | 'skipped' | 'error'
  >('pending');
  const [resetting, setResetting] = useState(false);
  const [resetError, setResetError] = useState<string | null>(null);

  const [contentVisible, setContentVisible] = useState(false);
  // The standings count up when they are actually on screen: on a phone
  // they sit below the replay, recap and chat, and a count nobody sees is
  // wasted. null = not seen yet; then the base delay for the last place.
  const standingsRef = useRef<HTMLUListElement>(null);
  const [standingsBase, setStandingsBase] = useState<number | null>(null);
  const mountedAtRef = useRef(0);
  useEffect(() => {
    mountedAtRef.current = Date.now();
    const el = standingsRef.current;
    if (!el || typeof IntersectionObserver === 'undefined') { setStandingsBase(0); return; }
    const io = new IntersectionObserver((entries) => {
      if (!entries.some((e) => e.isIntersecting)) return;
      io.disconnect();
      setStandingsBase(Math.max(0, STANDINGS_START_MS - (Date.now() - mountedAtRef.current)));
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const gameIdRef = useRef<string | null>(room.historyGameId ?? null);
  // The save effect is keyed on the write flags only; it reads the latest
  // snapshot through this ref so it does not re-run on every update.
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });

  // The crown moment (GameOverCrown.tsx): content fades in under the gold
  // wash, the sparkle sound lands with the crown.
  useEffect(() => {
    const tContent = window.setTimeout(() => setContentVisible(true), 150);
    const tSound = window.setTimeout(() => playSparkleSound(), CROWN_LANDS_MS - 60);
    return () => {
      window.clearTimeout(tContent);
      window.clearTimeout(tSound);
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
    saveMultiplayerGame(roomRef.current)
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

  // Watchdog: if the shared summary hasn't landed after 20s (e.g. the
  // claiming device got suspended mid-fetch — hi, iPad), fall back to
  // the local deterministic recap so nobody is stuck on "Analyzing…"
  // forever. Once timed out, a late AI arrival is ignored on this
  // device: the table only ever sees ONE commentary, no swap. A warm
  // recap takes 3 to 9 s; 20 s (was 15) leaves room for an "end game
  // now" that lands while the pre-warm ping's instance is still booting.
  useEffect(() => {
    if (!aiLoading) return;
    const t = window.setTimeout(() => setAiTimedOut(true), 20000);
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
      <GoldWash />

      <div
        className={`card-gold p-4 space-y-4 transition-opacity duration-500 ${
          contentVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <CrownTitle
          title={standings[0]?.name === myName ? 'You win!' : `${standings[0]?.name} wins!`}
          iWon={standings[0]?.name === myName}
        />

        {/* Wide screens: replay, recap and the round table on the left;
            standings, Play again and chat on the right, so the whole
            result fits one screen. Phones keep one column in the old order
            (the column wrappers are `contents` there; order-* sets it). */}
        <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)] lg:gap-5 lg:items-start">
        <div className="contents lg:flex lg:flex-col lg:gap-4">
        <div className="order-1 lg:order-none">
          <ScoreLineGraph room={room} />
        </div>

        {(stillAnalyzing || displayedSummary) && (
          <div
            className={`order-2 lg:order-none card-gold-subtle px-4 py-3.5 text-center relative ${
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

        {breakdown.length > 0 && (
          <div className="order-5 lg:order-none">
            <RoundBreakdownTable
              breakdown={breakdown}
              playerOrder={room.playerOrder}
            />
          </div>
        )}
        </div>

        <div className="contents lg:flex lg:flex-col lg:gap-4">
        <ul ref={standingsRef} className="order-4 lg:order-none space-y-1.5">
          {standings.map((s, idx) => {
            const isMe = s.name === myName;
            // Last place lands first, the winner last (with a glow).
            const enterAt = (standingsBase ?? 0) + (standings.length - 1 - idx) * STANDINGS_STEP_MS;
            const seen = standingsBase !== null;
            const isFirst = s.rank === 1 && s.score > 0;
            const medal = MEDAL[s.rank] ?? POSITIONS[s.rank - 1] ?? `${s.rank}.`;
            return (
              <li
                key={s.name}
                style={{ animationDelay: isFirst ? `${enterAt}ms, ${enterAt + 300}ms` : `${enterAt}ms` }}
                className={`card-gold-subtle flex items-center justify-between px-3 py-2 ${
                  !seen ? 'opacity-0' : isFirst ? 'wm-row-glow bg-gold-300/[.07]' : 'wm-row-in'
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
                  {seen ? (
                    <CountUp
                      value={s.score}
                      delay={enterAt}
                      format={(n) => (n < 0 ? `−${Math.abs(n)}` : String(n))}
                    />
                  ) : (
                    0
                  )}
                </span>
              </li>
            );
          })}
        </ul>

        <p className="order-6 lg:order-none text-xs text-center text-navy-300">
          {savingState === 'saving' && 'Saving to history…'}
          {savingState === 'saved' && '✓ Saved to history.'}
          {savingState === 'skipped' && 'History saving skipped (localhost).'}
          {savingState === 'error' && '⚠ Could not save to history.'}
        </p>

        <button
          type="button"
          onClick={handlePlayAgain}
          disabled={resetting}
          className={`order-7 lg:order-none w-full h-12 rounded-lg font-bold border tabular-nums transition ${
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
          <p className="order-8 lg:order-none text-sm text-rose-300 text-center">{resetError}</p>
        )}

        <button
          type="button"
          onClick={() => {
            setActiveRoomCode(null);
            navigate('/');
          }}
          className="order-9 lg:order-none w-full text-sm text-navy-200 underline underline-offset-2 hover:text-gold-200"
        >
          Back to home
        </button>

        <div className="order-3 lg:order-none">
          <Chat room={room} myName={myName} />
        </div>
        </div>
        </div>
      </div>
    </>
  );
}
