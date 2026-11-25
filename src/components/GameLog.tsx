import { useEffect, useMemo, useState } from 'react';
import { fetchFullLog } from '../lib/gameFlow';
import { shortName } from '../lib/shortName';
import { ChevronDownIcon } from './Icons';
import type { RoomSnapshot } from '../hooks/useRoom';
import type { Card, LogEntry, Suit } from '../lib/types';

// U+FE0E asks for the text glyph: iPhones otherwise draw suits as emoji.
const SUIT_GLYPH: Record<Suit, string> = { H: '♥︎', D: '♦︎', C: '♣︎', S: '♠︎' };
const SUIT_TONE: Record<Suit, string> = { H: 'text-rose-300', D: 'text-sky-300', C: 'text-emerald-300', S: 'text-navy-100' };
const SUIT_NAME: Record<Suit, string> = { H: 'Hearts', D: 'Diamonds', C: 'Clubs', S: 'Spades' };

function CardText({ card }: { card: Card }) {
  if (card.kind === 'wizard') return <span className="font-bold text-sky-200">Wiz</span>;
  if (card.kind === 'jester') return <span className="font-bold text-amber-300">Jest</span>;
  const rank = card.rank > 10 ? ['J', 'Q', 'K', 'A'][card.rank - 11] : String(card.rank);
  return <span className={`font-bold tabular-nums ${SUIT_TONE[card.suit]}`}>{rank}{SUIT_GLYPH[card.suit]}</span>;
}

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
 * The game log in the menu (2026-11-25): every round, newest first. The
 * round being played is open; finished rounds are one line (who made
 * their bid) and open on a tap to show each trick's cards. The room only
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
        const current = v.round === room.currentRound && room.status !== 'finished';
        const isOpen = open[v.round] ?? current;
        const won: Record<string, number> = {};
        for (const t of v.tricks) if (t.winner) won[t.winner] = (won[t.winner] ?? 0) + 1;
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
                    <span className={`font-bold ${SUIT_TONE[v.trump.suit]}`} aria-label={`Trump ${SUIT_NAME[v.trump.suit]}`}>{SUIT_GLYPH[v.trump.suit]}</span>
                  ) : 'NT'
                )}
                {v.trump && v.dealer ? ' · ' : ''}
                {v.dealer ? `Dealer ${name(v.dealer)}` : ''}
              </span>
              <ChevronDownIcon size={11} className={`shrink-0 text-navy-300 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {/* One line per round: bid, tricks won, and the points once scored. */}
            {v.bids.length > 0 && (
              <p className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] leading-snug">
                {v.bids.map((b) => {
                  const delta = v.scores?.[b.player];
                  return (
                    <span key={b.player} className="whitespace-nowrap">
                      <span className="text-cream">{name(b.player)}</span>{' '}
                      <span className="tabular-nums font-semibold text-navy-200">
                        {v.scores || v.tricks.length > 0 ? `${won[b.player] ?? 0}/${b.bid}` : `bid ${b.bid}`}
                      </span>
                      {delta !== undefined && (
                        <span className={`tabular-nums font-bold ${delta > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                          {' '}{delta > 0 ? `+${delta}` : delta}
                        </span>
                      )}
                    </span>
                  );
                })}
              </p>
            )}

            {v.shames.map((sh, i) => (
              <p key={i} className="mt-1 text-[12px] leading-snug text-rose-300">
                <span className="shame-chip mr-1.5">shame</span>
                {name(sh.player)}, called by {name(sh.by).toLowerCase() === 'you' ? 'you' : name(sh.by)}
              </p>
            ))}

            {isOpen && v.tricks.length > 0 && (
              <ol className="mt-1.5 space-y-1">
                {v.tricks.map((t) => (
                  <li key={t.n} className="flex gap-2 text-[12px] leading-snug">
                    <span className="w-4 shrink-0 text-right tabular-nums text-navy-400">{t.n}</span>
                    <span className="flex flex-wrap gap-x-2.5 gap-y-0.5">
                      {t.plays.map((p, i) => (
                        <span key={i} className="whitespace-nowrap">
                          <span className={p.player === t.winner ? 'font-semibold text-gold-text' : 'text-navy-200'}>
                            {name(p.player)}
                          </span>{' '}
                          <CardText card={p.card} />
                        </span>
                      ))}
                    </span>
                  </li>
                ))}
              </ol>
            )}
            {isOpen && v.tricks.length === 0 && v.bids.length === 0 && (
              <p className="mt-1 text-[12px] text-navy-300">No bids yet.</p>
            )}
          </section>
        );
      })}
      <p className="text-[11px] text-navy-400 pt-1">
        {failed && !log ? 'Earlier rounds could not load. ' : ''}Gold name = took the trick.
      </p>
    </div>
  );
}
