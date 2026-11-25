import { useEffect, useMemo, useState } from 'react';
import { fetchFullLog } from '../lib/gameFlow';
import { shortName } from '../lib/shortName';
import { ChevronDownIcon, SuitIcon } from './Icons';
import type { RoomSnapshot } from '../hooks/useRoom';
import type { Card, LogEntry, Suit } from '../lib/types';

const SUIT_TONE: Record<Suit, string> = { H: 'text-rose-300', D: 'text-sky-300', C: 'text-emerald-300', S: 'text-navy-100' };
const SUIT_NAME: Record<Suit, string> = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };

function CardText({ card }: { card: Card }) {
  if (card.kind === 'wizard') return <span className="font-bold text-sky-200">Wiz</span>;
  if (card.kind === 'jester') return <span className="font-bold text-amber-300">Jest</span>;
  const rank = card.rank > 10 ? ['J', 'Q', 'K', 'A'][card.rank - 11] : String(card.rank);
  return <span className={`font-bold tabular-nums ${SUIT_TONE[card.suit]}`}>{rank}<SuitIcon suit={card.suit} /></span>;
}

const ROW_LABEL = 'py-1 text-left text-[9px] font-bold uppercase tracking-[0.1em] text-navy-300';

type Trick = { n: number; plays: Array<{ player: string; card: Card }>; winner?: string };
type RoundView = {
  round: number;
  dealer?: string;
  trump?: { card: Card | null; suit: Suit | null };
  bids: Array<{ player: string; bid: number }>;
  tricks: Trick[];
  scores?: Record<string, number>;
  shames: Array<{ player: string; by: string }>;
};

/** Group the flat log into rounds (bids, tricks, result, shame points). */
function roundsFromLog(log: LogEntry[]): RoundView[] {
  const byRound = new Map<number, RoundView>();
  const get = (round: number) => {
    let v = byRound.get(round);
    if (!v) { v = { round, bids: [], tricks: [], shames: [] }; byRound.set(round, v); }
    return v;
  };
  const trick = (v: RoundView, n: number) => {
    let t = v.tricks.find((x) => x.n === n);
    if (!t) { t = { n, plays: [] }; v.tricks.push(t); }
    return t;
  };
  for (const e of log) {
    if (e.t === 'gameOver') continue;
    const v = get(e.round);
    if (e.t === 'deal') v.dealer = e.dealer;
    else if (e.t === 'trump') v.trump = { card: e.card, suit: e.chosenSuit };
    else if (e.t === 'bid') {
      // An undone bid is cut from the log, but be safe: the last one counts.
      v.bids = [...v.bids.filter((b) => b.player !== e.player), { player: e.player, bid: e.bid }];
    } else if (e.t === 'play') trick(v, e.trick).plays.push({ player: e.player, card: e.card });
    else if (e.t === 'trickWin') trick(v, e.trick).winner = e.winner;
    else if (e.t === 'roundScore') v.scores = e.scores;
    else if (e.t === 'shame') v.shames.push({ player: e.player, by: e.by });
  }
  return [...byRound.values()].sort((a, b) => b.round - a.round);
}

/**
 * The game log in the menu (2026-11-25): every round, newest first, each
 * a list of its hands (who took each one and with which card, then every
 * card in play order; Jorge: the log is each hand, not a round summary)
 * over a small bid / won / points table. A tap on a round folds its hands. The room only
 * carries the current round, so the whole log is asked from the server
 * when this opens and again whenever something new is logged.
 */
export function GameLog({ room, myName }: { room: RoomSnapshot; myName: string }) {
  const [log, setLog] = useState<LogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const stamp = `${room.log.length}:${room.currentRound}:${room.status}`;

  useEffect(() => {
    let live = true;
    fetchFullLog(room.code)
      .then((l) => { if (live) { setLog(l); setFailed(false); } })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [room.code, stamp]);

  // Until the answer lands, what the room already has (the current round).
  const rounds = useMemo(() => roundsFromLog(log ?? room.log), [log, room.log]);
  const name = (n: string) => (n === myName ? 'You' : shortName(n, room.playerOrder, 10));

  if (rounds.length === 0) return <p className="text-[13px] text-navy-300 py-2">Nothing yet.</p>;

  return (
    <div className="space-y-2">
      {rounds.map((v) => {
        const isOpen = open[v.round] ?? true;
        const won: Record<string, number> = {};
        for (const t of v.tricks) if (t.winner) won[t.winner] = (won[t.winner] ?? 0) + 1;
        // The round still being played (not yet at its results).
        const live = v.round === room.currentRound && (room.status === 'bidding' || room.status === 'playing' || room.status === 'dealing');
        const lastDone = Math.max(0, ...v.tricks.filter((t) => t.winner).map((t) => t.n));
        const bidOf: Record<string, number> = {};
        for (const b of v.bids) bidOf[b.player] = b.bid;
        // Columns: bid order (the seat after the dealer first), plus anyone
        // who only shows up in a trick.
        const cols = v.bids.map((b) => b.player);
        for (const t of v.tricks) for (const p of t.plays) if (!cols.includes(p.player)) cols.push(p.player);
        return (
          <section key={v.round} className="border-t border-gold-700/20 pt-2 first:border-t-0 first:pt-0">
            <button
              type="button"
              onClick={() => setOpen((o) => ({ ...o, [v.round]: !isOpen }))}
              className="w-full flex items-center justify-between gap-2 text-left"
            >
              <span className="section-label whitespace-nowrap">Round {v.round}</span>
              <span className="min-w-0 flex-1 truncate text-[11px] text-navy-300">
                {v.trump && (
                  v.trump.suit ? (
                    <span className={`font-bold ${SUIT_TONE[v.trump.suit]}`} aria-label={`Trump ${SUIT_NAME[v.trump.suit]}`}><SuitIcon suit={v.trump.suit} /></span>
                  ) : 'No trump'
                )}
                {v.trump && v.dealer ? ' · ' : ''}
                {v.dealer ? `Dealer ${name(v.dealer)}` : ''}
              </span>
              <ChevronDownIcon size={11} className={`shrink-0 text-navy-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* The round's totals: one column per player (in bid order),
                rows for the bid, tricks won and the points. */}
            {/* Every hand of the round, newest first: who took it and with
                which card, then what each player put down, in play order. */}
            {isOpen && v.tricks.length > 0 && (
              <ol className="mt-1.5 divide-y divide-gold-700/10">
                {[...v.tricks].reverse().map((t) => {
                  const winning = t.plays.find((p) => p.player === t.winner);
                  // While a round is being played, only the hand in play
                  // and the last finished one show their cards (like
                  // turning the last trick back over at a real table).
                  // Older hands of the round keep the winner and get their
                  // cards back once the round is scored, so the log is not
                  // a card counter (my call, Jorge left it to me 2026-11-25).
                  if (live && t.winner && t.n < lastDone) {
                    return (
                      <li key={t.n} className="flex gap-2 py-1.5 whitespace-normal">
                        <span className="w-[42px] shrink-0 pt-px text-[9px] font-bold uppercase tracking-[0.1em] text-navy-300 leading-[18px]">
                          Hand {t.n}
                        </span>
                        <span className="min-w-0 flex-1 text-[13px] leading-[18px]">
                          <span className="font-semibold text-gold-text">{name(t.winner)}</span>
                          <span className="text-navy-200"> won</span>
                          <span className="block mt-0.5 text-[11px] text-navy-400">Cards show when the round ends</span>
                        </span>
                      </li>
                    );
                  }
                  return (
                    <li key={t.n} className="flex gap-2 py-1.5 whitespace-normal">
                      <span className="w-[42px] shrink-0 pt-px text-[9px] font-bold uppercase tracking-[0.1em] text-navy-300 leading-[18px]">
                        Hand {t.n}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-[18px]">
                          {t.winner && winning ? (
                            <>
                              <span className="font-semibold text-gold-text">{name(t.winner)}</span>
                              <span className="text-navy-200"> won with </span>
                              <CardText card={winning.card} />
                            </>
                          ) : (
                            <span className="text-navy-200">In play</span>
                          )}
                        </span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[11px] leading-snug">
                          {t.plays.map((p, i) => (
                            <span key={i} className="whitespace-nowrap">
                              <span className={p.player === t.winner ? 'text-gold-text' : 'text-navy-300'}>
                                {i === 0 ? 'led ' : ''}{name(p.player)}
                              </span>{' '}
                              <CardText card={p.card} />
                            </span>
                          ))}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}

            {cols.length > 0 && (
              <div className="mt-1.5 overflow-x-auto">
                <table className="w-full table-fixed text-[12px] tabular-nums" style={{ minWidth: 30 + cols.length * 46 }}>
                  <colgroup>
                    <col style={{ width: 30 }} />
                    {cols.map((n) => <col key={n} />)}
                  </colgroup>
                  <thead>
                    <tr>
                      <th />
                      {cols.map((n) => (
                        <th key={n} className="px-0.5 pb-1 text-center font-semibold text-[11px] text-cream">
                          <span className="block truncate">{name(n)}</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-gold-700/15">
                      <td className={ROW_LABEL}>Bid</td>
                      {cols.map((n) => (
                        <td key={n} className="py-1 text-center font-semibold text-navy-100">{bidOf[n] ?? '·'}</td>
                      ))}
                    </tr>
                    {(v.tricks.length > 0 || v.scores) && (
                      <tr className="border-t border-gold-700/15">
                        <td className={ROW_LABEL}>Won</td>
                        {cols.map((n) => {
                          const w = won[n] ?? 0;
                          const done = !!v.scores;
                          const tone = bidOf[n] === undefined ? 'text-navy-100' : w === bidOf[n] ? (done ? 'text-emerald-300' : 'text-navy-100') : w > bidOf[n] ? 'text-rose-300' : done ? 'text-rose-300' : 'text-sky-300';
                          return <td key={n} className={`py-1 text-center font-semibold ${tone}`}>{w}</td>;
                        })}
                      </tr>
                    )}
                    {v.scores && (
                      <tr className="border-t border-gold-700/15">
                        <td className={ROW_LABEL}>Pts</td>
                        {cols.map((n) => {
                          const d = v.scores?.[n];
                          return (
                            <td key={n} className={`py-1 text-center font-bold ${d === undefined ? 'text-navy-400' : d > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                              {d === undefined ? '·' : d > 0 ? `+${d}` : d}
                            </td>
                          );
                        })}
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {cols.length === 0 && <p className="mt-1 text-[12px] text-navy-300">No bids yet.</p>}

            {v.shames.map((sh, i) => (
              <p key={i} className="mt-1.5 text-[12px] leading-snug text-rose-300">
                <span className="shame-chip mr-1.5">shame</span>
                {name(sh.player)}, called by {name(sh.by) === 'You' ? 'you' : name(sh.by)}
              </p>
            ))}
          </section>
        );
      })}
      <p className="text-[11px] leading-snug text-navy-400 pt-1 whitespace-normal">
        {failed && !log ? 'Earlier rounds could not load. ' : ''}Each hand lists the cards in the order they were played. Tap a round to fold it.
      </p>
    </div>
  );
}
