import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../hooks/useRoom';
import type { Card, Suit } from '../lib/types';
import {
  BABY_TRUMP_TEXT,
  isBabyTrump,
  SKIP_TEXT,
  type CalloutTone,
} from '../lib/trickCallout';

type Tone = CalloutTone;

export type Announcement = {
  id: number;
  // One line only (Jorge, 2026-09-22): the card shows for 1.5 s and a
  // subtitle never got read, so whatever matters goes in the title.
  title: string;
  tone: Tone;
  priority: number;
  bornAt: number;
  /** Re-checked right before display — lets stale "your turn" prompts
   * (turn already passed while another announcement was showing) drop
   * silently instead of flashing wrong info. */
  stillValid?: (room: RoomSnapshot) => boolean;
};

const SHOW_MS = 1500;
const GAP_MS = 250;
// Announcements that waited too long behind others are dropped — a streak
// callout 5 seconds after the trick reads as noise, not commentary.
const MAX_AGE_MS = 4000;

const SUIT_GLYPH: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME: Record<Suit, string> = { H: 'HEARTS', D: 'DIAMONDS', C: 'CLUBS', S: 'SPADES' };

export const TONE_STYLE: Record<Tone, { text: string; border: string; glow: string }> =
  {
    gold: {
      text: 'text-gold-100',
      border: 'border-gold-400/70',
      glow: '0 0 18px rgba(254,205,70,0.75), 0 2px 4px rgba(0,0,0,0.9)',
    },
    fire: {
      text: 'text-amber-300',
      border: 'border-amber-400/60',
      glow: '0 0 18px rgba(251,191,36,0.75), 0 2px 4px rgba(0,0,0,0.9)',
    },
    wizard: {
      text: 'text-violet-300',
      border: 'border-violet-400/60',
      glow: '0 0 18px rgba(196,181,253,0.75), 0 2px 4px rgba(0,0,0,0.9)',
    },
    spade: {
      text: 'text-navy-50',
      border: 'border-navy-100/50',
      glow: '0 0 18px rgba(232,236,244,0.7), 0 2px 4px rgba(0,0,0,0.9)',
    },
  };

/**
 * Transient commentary: "YOUR TURN" / "YOUR BID", the trump call, the
 * ace of spades, "SKIP, SKIP, SKIP" on a jester and "BABY TRUMP!" on a
 * 2 or 3 of trump that takes the lead (the last two since 2026-10-10). Everything is derived client-side from the room snapshot,
 * no server writes. One announcement at a time, highest priority first;
 * anything that queues up too long is dropped so the table never turns
 * into a ticker. The trick-resolve lines (streaks, overshoots, wizard
 * kills) live under the win banner instead (src/lib/trickCallout.ts).
 *
 * Returns the announcement on screen now; GameView renders it with
 * CommentaryCard in the felt's center slot, stacked with the win banner,
 * so the two share one spot instead of overlapping (2026-10-06).
 */
export function useCommentary(room: RoomSnapshot, myName: string): Announcement | null {
  const [current, setCurrent] = useState<Announcement | null>(null);
  const queueRef = useRef<Announcement[]>([]);
  // Deadline (epoch ms) until which the slot is occupied. A timestamp
  // instead of a boolean so the pump self-heals: if the clearing timers
  // ever die (dev HMR re-runs the cleanup effect; any future refactor),
  // the next enqueue past the deadline recovers instead of the queue
  // being stuck "busy" forever.
  const busyUntilRef = useRef(0);
  const idRef = useRef(1);
  const timersRef = useRef<number[]>([]);
  // Fresh room for stillValid closures without effect-dep churn. Synced
  // in an effect (before the detection effects below, which read it).
  const roomRef = useRef(room);
  useEffect(() => {
    roomRef.current = room;
  });

  // Ref indirection so the gap timeout can re-enter pump without the
  // callback referencing itself before declaration.
  const pumpRef = useRef<() => void>(() => {});
  const pump = useCallback(() => {
    if (Date.now() < busyUntilRef.current) return;
    const q = queueRef.current;
    while (q.length > 0) {
      const a = q.shift()!;
      if (Date.now() - a.bornAt > MAX_AGE_MS) continue;
      if (a.stillValid && !a.stillValid(roomRef.current)) continue;
      busyUntilRef.current = Date.now() + SHOW_MS + GAP_MS;
      setCurrent(a);
      const tShow = window.setTimeout(() => setCurrent(null), SHOW_MS);
      const tGap = window.setTimeout(
        () => pumpRef.current(),
        SHOW_MS + GAP_MS,
      );
      timersRef.current.push(tShow, tGap);
      return;
    }
  }, []);
  useEffect(() => {
    pumpRef.current = pump;
  }, [pump]);

  const enqueue = useCallback(
    (a: Omit<Announcement, 'id' | 'bornAt'>) => {
      // Keep the waiting line tiny: a new announcement evicts anything
      // lower-priority that hasn't shown yet ("without showing too many").
      queueRef.current = queueRef.current.filter(
        (q) => q.priority > a.priority,
      );
      queueRef.current.push({ ...a, id: idRef.current++, bornAt: Date.now() });
      queueRef.current.sort(
        (x, y) => y.priority - x.priority || x.bornAt - y.bornAt,
      );
      pump();
    },
    [pump],
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, []);

  // ---- YOUR TURN -------------------------------------------------------
  const currentName = room.playerOrder[room.currentPlayerIndex];
  const myBid = room.bids[myName];
  const isMyPlayTurn = room.status === 'playing' && currentName === myName;
  const isMyBidTurn =
    room.status === 'bidding' && currentName === myName && myBid === undefined;
  const wasMyTurnRef = useRef(false);

  useEffect(() => {
    const mine = isMyPlayTurn || isMyBidTurn;
    const was = wasMyTurnRef.current;
    wasMyTurnRef.current = mine;
    if (!mine || was) return;
    // Leading because I just won the trick: the "You won!" banner (and the
    // action strip) already cover it — a third callout is noise.
    const r = roomRef.current;
    if (isMyPlayTurn && r.trickInProgress.length === 0) {
      const last = r.trickHistory[r.trickHistory.length - 1];
      if (last && last.round === r.currentRound && last.winner === myName) {
        return;
      }
    }
    enqueue({
      title: isMyBidTurn ? 'YOUR BID' : 'YOUR TURN',
      tone: 'gold',
      priority: 1,
      stillValid: (rr) => {
        const cn = rr.playerOrder[rr.currentPlayerIndex];
        if (cn !== myName) return false;
        if (rr.status === 'playing') return true;
        return rr.status === 'bidding' && rr.bids[myName] === undefined;
      },
    });
  }, [isMyPlayTurn, isMyBidTurn, myName, enqueue]);

  // ---- TRUMP CHOSEN (a Wizard was flipped, the dealer picked the suit) --
  // Fires on the snapshot where trumpSuit goes from null to a suit within
  // the same round, so a choice made before this phone loaded is not news.
  const prevTrumpRef = useRef<{ round: number; suit: Suit | null }>({ round: 0, suit: null });
  const trumpKind = room.trumpCard?.kind;
  const curRound = room.currentRound;
  const curSuit = room.trumpSuit;
  useEffect(() => {
    const prev = prevTrumpRef.current;
    const cur = { round: curRound, suit: curSuit };
    prevTrumpRef.current = cur;
    if (trumpKind !== 'wizard') return;
    if (cur.round !== prev.round || prev.suit !== null || cur.suit === null) return;
    enqueue({
      title: `TRUMP IS ${SUIT_GLYPH[cur.suit]} ${SUIT_NAME[cur.suit]}`,
      tone: 'wizard',
      priority: 2,
    });
  }, [curRound, curSuit, trumpKind, enqueue]);

  // ---- THE ACE OF SPADES, JESTERS, BABY TRUMP (the moment they land) ----
  const prevLogLenRef = useRef<number | null>(null);
  useEffect(() => {
    const len = room.log.length;
    const prev = prevLogLenRef.current;
    prevLogLenRef.current = len;
    if (prev === null || len <= prev) return;
    // The ace that closed a trick is called out under the win banner
    // instead (src/lib/trickCallout.ts).
    if (room.trickInProgress.length === 0) return;
    for (let i = prev; i < len; i++) {
      const e = room.log[i];
      if (e.t !== 'play') continue;
      if (e.card.kind === 'jester') {
        // Only while its trick is still open (Jorge, 2026-10-10): once the
        // trick resolves, the win banner owns the felt and a leftover skip
        // just clutters it.
        const { round, trick } = e;
        enqueue({
          title: SKIP_TEXT,
          tone: 'gold',
          priority: 2,
          stillValid: (rr) =>
            rr.currentRound === round &&
            rr.currentTrick === trick &&
            rr.trickInProgress.length > 0,
        });
        continue;
      }
      if (e.card.kind !== 'standard') continue;
      if (e.card.suit === 'S' && e.card.rank === 14) {
        enqueue({
          title: 'THE ACE OF SPADES',
          tone: 'spade',
          priority: 3,
        });
        continue;
      }
      // The trick so far, read from this round's log, up to this card.
      const trick: { card: Card }[] = [];
      for (let j = 0; j <= i; j++) {
        const x = room.log[j];
        if (x.t === 'play' && x.round === e.round && x.trick === e.trick) trick.push(x);
      }
      if (isBabyTrump(trick, trick.length - 1, room.trumpSuit)) {
        enqueue({ title: BABY_TRUMP_TEXT, tone: 'fire', priority: 3 });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.log.length, myName, enqueue]);

  // A turn prompt leaves as soon as the turn is over (you played inside
  // its 1.5 s), so it never lingers under the next win banner.
  if (current?.stillValid && !current.stillValid(room)) return null;
  return current;
}

/** One announcement, styled to sit in the felt's center column. */
export function CommentaryCard({ a }: { a: Announcement }) {
  const style = TONE_STYLE[a.tone];
  return (
    <div
      key={a.id}
      className={`animate-commentary-pop text-center rounded-2xl border ${style.border} bg-navy-900/90 backdrop-blur-sm px-5 py-2 shadow-2xl`}
      aria-live="polite"
    >
      <p
        className={`${style.text} font-black uppercase tracking-[0.12em] text-[20px] leading-tight whitespace-nowrap`}
        style={{ textShadow: style.glow }}
      >
        {a.title}
      </p>
    </div>
  );
}
