import { computeRoundDeltas, cumulativeScoresFromLog } from '../lib/gameFlow';
import { isBot } from '../lib/rooms';
import { rankByTotal, roundCommentary, type CommentaryLine, type CommentaryPlayer } from '../lib/roundCommentary';
import { REVEAL_LINE_MS, useRolledNumber, useStandingsReveal, type RevealStage } from '../lib/standingsReveal';
import { playQuip, playRevealMove, playRevealPoints, setRevealSoundGate } from '../lib/revealSounds';
import { soundEnabled } from '../lib/sounds';
import { CheckIcon, RingIcon } from './Icons';
import type { RoomSnapshot } from '../hooks/useRoom';

// The reveal's sounds obey the game menu's Sound switch.
setRevealSoundGate(soundEnabled);

const fmt = (n: number) => (n < 0 ? `−${Math.abs(n)}` : `${n}`);
const GRID = 'grid grid-cols-[minmax(0,1fr)_30px_34px_34px_52px] items-center';

/**
 * The round's results as a little show (Jorge, 2026-11-26): the rows start
 * in last round's order with last round's totals, this round's points land
 * and the totals roll, the rows slide to their new places (the climber
 * lifted and glowing, the faller shaken), then one cheer and one roast pop
 * in above. Plays once per round per phone; after that it is the settled
 * table. Mount with key = round. Kept in step with the scorekeeper's
 * RoundScoreboard (same shared lib + kit classes).
 */
export function RoundStandings({
  room,
  myName,
  nextVotes,
  isFinalRound,
  header,
  children,
}: {
  room: RoomSnapshot;
  myName: string;
  nextVotes: string[];
  isFinalRound: boolean;
  /** The results card's title row and whatever follows the rows (buttons). */
  header: React.ReactNode;
  children?: React.ReactNode;
}) {
  const deltas = computeRoundDeltas(room.playerOrder, room.bids, room.tricksWon);
  const base = cumulativeScoresFromLog(room.playerOrder, room.log);
  const total: Record<string, number> = {};
  for (const n of room.playerOrder) total[n] = (base[n] ?? 0) + (deltas[n] ?? 0);
  const seat = (n: string) => room.playerOrder.indexOf(n);
  const beforeOrder = [...room.playerOrder].sort((a, b) => (base[b] ?? 0) - (base[a] ?? 0) || seat(a) - seat(b));
  const afterOrder = [...room.playerOrder].sort((a, b) => total[b] - total[a] || seat(a) - seat(b));
  const rBefore = rankByTotal(base);
  const rAfter = rankByTotal(total);
  const firstRound = room.playerOrder.every((n) => (base[n] ?? 0) === 0);

  // Bids made / missed in a row, from the earlier rounds' scores (a made
  // bid is always positive points, a miss always negative).
  const past = room.log.filter((e) => e.t === 'roundScore' && e.round < room.currentRound);
  const players: CommentaryPlayer[] = room.playerOrder.map((name) => {
    const made = (room.bids[name] ?? 0) === (room.tricksWon[name] ?? 0);
    let streak = 1;
    for (let i = past.length - 1; i >= 0; i--) {
      const e = past[i];
      const d = e.t === 'roundScore' ? e.scores[name] : undefined;
      if (d === undefined || d > 0 !== made) break;
      streak++;
    }
    return {
      name, delta: deltas[name] ?? 0, total: total[name], bid: room.bids[name] ?? 0, won: room.tricksWon[name] ?? 0,
      madeStreak: made ? streak : 0, missStreak: made ? 0 : streak,
    };
  });
  const lines = roundCommentary(room.code, room.currentRound, players);

  const { stage, instant, order, listRef } = useStandingsReveal(
    `${room.code}:${room.chatGen ?? 0}:${room.currentRound}`,
    beforeOrder,
    afterOrder,
    (st, rowsMove) => {
      // One sound per line, in step with the lines' own stagger.
      if (st === 0) lines.forEach((l, i) => window.setTimeout(() => playQuip(l.tone), REVEAL_LINE_MS[i] ?? 0));
      if (st === 1) playRevealPoints();
      if (st === 2 && rowsMove) playRevealMove();
    },
  );
  const bestDelta = Math.max(...Object.values(deltas));
  const cheered = lines.find((l) => l.tone === 'up')?.player;
  const roasted = lines.find((l) => l.tone === 'down')?.player;

  return (
    <>
      {/* The commentary is its own box above the results (Jorge, 2026-11-26). */}
      <RoundCommentary lines={lines} animate={!instant} />
      <div className="card-gold p-4 space-y-4">
      {header}
      <div>
      <div className={`${GRID} pb-1.5`}>
        <span className="section-label">Player</span>
        <span className="section-label text-right">Bid</span>
        <span className="section-label text-right">Won</span>
        <span className="section-label text-right">Δ</span>
        <span className="section-label text-right">Total</span>
      </div>
      <div ref={listRef} className="relative -mx-1.5">
        {order.map((name) => {
          const isReal = !isBot(room, name);
          const hasVoted = nextVotes.includes(name);
          const delta = deltas[name] ?? 0;
          const move = firstRound ? 0 : rBefore[name] - rAfter[name];
          return (
            <StandingRow
              key={name}
              stage={stage}
              name={name}
              isMe={name === myName}
              bid={room.bids[name] ?? 0}
              won={room.tricksWon[name] ?? 0}
              delta={delta}
              before={base[name] ?? 0}
              after={total[name]}
              move={move}
              best={delta === bestDelta && delta > 0}
              cheered={name === cheered}
              roasted={name === roasted}
              marker={
                isReal ? (
                  <span
                    aria-label={hasVoted ? 'voted' : 'not voted'}
                    title={hasVoted ? `${name} voted to ${isFinalRound ? 'finish' : 'advance'}` : `${name} hasn't voted yet`}
                    className={`inline-flex w-4 mr-1 shrink-0 justify-center ${hasVoted ? 'text-emerald-300' : 'text-navy-400/60'}`}
                  >
                    {hasVoted ? <CheckIcon size={12} /> : <RingIcon size={9} />}
                  </span>
                ) : (
                  // Every row keeps the slot so names line up.
                  <span className="inline-block w-4 mr-1 shrink-0" />
                )
              }
            />
          );
        })}
      </div>
      </div>
      {children}
      </div>
    </>
  );
}

function StandingRow(p: {
  stage: RevealStage;
  name: string;
  isMe: boolean;
  bid: number;
  won: number;
  delta: number;
  before: number;
  after: number;
  /** Places gained (+) or lost (-) this round. */
  move: number;
  best: boolean;
  cheered: boolean;
  roasted: boolean;
  marker: React.ReactNode;
}) {
  const shown = useRolledNumber(p.before, p.after, p.stage >= 1);
  const settled = p.stage >= 3;
  return (
    <div
      data-row-id={p.name}
      className={`standing-row ${GRID} px-1.5 py-1.5 ${p.best && p.stage >= 1 ? 'rounded-md bg-gold-300/[.07]' : ''} ${
        settled && p.cheered ? 'standing-cheer' : ''
      } ${settled && p.roasted ? 'standing-roast' : ''}`}
    >
      <span className={`flex items-center min-w-0 font-display font-semibold text-[17px] ${p.isMe ? 'text-cream-bright font-bold' : 'text-cream'}`}>
        {p.marker}
        <span className="truncate">{p.name}{p.isMe ? ' (you)' : ''}</span>
        {p.stage >= 2 && p.move !== 0 && <MoveBadge move={p.move} />}
      </span>
      <span className="text-right tabular-nums font-semibold text-[14px] text-cream">{p.bid}</span>
      <span className={`text-right tabular-nums font-semibold text-[14px] ${p.bid === p.won ? 'text-[#6ee7b7]' : 'text-[#fda4af]'}`}>{p.won}</span>
      <span
        className={`text-right tabular-nums text-[10px] font-semibold ${p.stage >= 1 ? 'standing-delta-in' : 'opacity-0'} ${
          p.delta > 0 ? 'text-[#6ee7b7]' : p.delta < 0 ? 'text-[#fda4af]' : 'text-navy-200'
        }`}
      >
        {p.delta > 0 ? '+' : p.delta < 0 ? '−' : ''}
        {Math.abs(p.delta)}
      </span>
      <span className="text-right tabular-nums font-bold text-[16px] text-gold-text">{fmt(shown)}</span>
    </div>
  );
}

/** Places gained or lost: a small drawn arrow and the count. */
export function MoveBadge({ move }: { move: number }) {
  const up = move > 0;
  return (
    <span
      className={`standing-badge-in ml-1.5 shrink-0 inline-flex items-center gap-[2px] font-sans text-[10px] font-bold tabular-nums leading-none ${up ? 'text-[#6ee7b7]' : 'text-[#fda4af]'}`}
      aria-label={`${up ? 'up' : 'down'} ${Math.abs(move)}`}
    >
      <svg width="7" height="7" viewBox="0 0 8 8" fill="currentColor" aria-hidden="true">
        <path d={up ? 'M4 1l3.5 6h-7z' : 'M4 7L.5 1h7z'} />
      </svg>
      {Math.abs(move)}
    </span>
  );
}

/**
 * The cheer and the roast, in a box of their own. They are there from the
 * first frame (popping in on the first showing only): the commentary leads
 * and the table below then acts it out, so the box is never empty.
 */
export function RoundCommentary({ lines, animate }: { lines: CommentaryLine[]; animate: boolean }) {
  if (lines.length === 0) return null;
  return (
    <div
      className="round-quip-box card-gold px-3.5 py-3 space-y-1.5"
      aria-live="polite"
    >
      {lines.map((l, i) => (
        <p
          key={i}
          style={{ animationDelay: `${REVEAL_LINE_MS[i] ?? 0}ms` }}
          className={`round-quip min-h-[26px] whitespace-normal ${animate ? 'round-quip-in' : ''}`}
        >
          <span className="font-display font-semibold text-[17px] leading-tight text-cream-bright">
            {l.segs.map((s, j) =>
              s.name ? (
                <b key={j} className={`font-sans font-semibold text-[0.82em] ${l.tone === 'down' ? 'text-[#fda4af]' : 'text-[#e2c579]'}`}>{s.t}</b>
              ) : (
                // Numerals are never serif (kit rule): digits go sans.
                <span key={j}>
                  {s.t.split(/([+\u2212]?\d+)/).map((piece, k) =>
                    /\d/.test(piece) ? <span key={k} className="font-sans font-semibold text-[0.8em] tabular-nums">{piece}</span> : piece,
                  )}
                </span>
              ),
            )}
            {/* The emoji closes the sentence (Jorge: part of the line, not a bullet on the left). */}
            <span className="round-quip-emoji font-sans text-[1.05em] ml-1.5" aria-hidden="true">{l.emoji}</span>
          </span>
        </p>
      ))}
    </div>
  );
}
