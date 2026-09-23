import { useCallback, useEffect, useRef, useState } from 'react';
import type { RoomSnapshot } from '../hooks/useRoom';
import type { Suit } from '../lib/types';

type Tone = 'gold' | 'fire' | 'wizard' | 'spade';

type Announcement = {
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
  stillValid?: () => boolean;
};

const SHOW_MS = 1500;
const GAP_MS = 250;
// Announcements that waited too long behind others are dropped — a streak
// callout 5 seconds after the trick reads as noise, not commentary.
const MAX_AGE_MS = 4000;

const SUIT_GLYPH: Record<Suit, string> = { H: '♥', D: '♦', C: '♣', S: '♠' };
const SUIT_NAME: Record<Suit, string> = { H: 'HEARTS', D: 'DIAMONDS', C: 'CLUBS', S: 'SPADES' };

const TONE_STYLE: Record<Tone, { text: string; border: string; glow: string }> =
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

type Props = {
  room: RoomSnapshot;
  myName: string;
  /** Only render while the table is on screen (bidding/playing/round-end
   * hold). Detection keeps running regardless so refs stay in sync. */
  active: boolean;
};

/**
 * Big transient center-screen commentary: "YOUR TURN", win streaks,
 * wizard-kills-trump, ace of spades. Everything is derived client-side
 * from the room snapshot — no server writes. One announcement at a time,
 * highest priority first; anything that queues up too long is dropped so
 * the table never turns into a ticker.
 */
export function CommentaryOverlay({ room, myName, active }: Props) {
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
      if (a.stillValid && !a.stillValid()) continue;
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
      stillValid: () => {
        const rr = roomRef.current;
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

  // ---- Trick-resolve events: wizard kill + win streaks ------------------
  const prevTrickLenRef = useRef<number | null>(null);
  useEffect(() => {
    const hist = room.trickHistory;
    const len = hist.length;
    const prev = prevTrickLenRef.current;
    prevTrickLenRef.current = len;
    // First snapshot (or an undo shrinking history): just sync, no replay.
    if (prev === null || len <= prev) return;
    const last = hist[len - 1];
    if (!last || last.round !== room.currentRound) return;

    // Wizard kill: a wizard took a trick containing a high trump (J+).
    const winnerPlay = last.plays.find((p) => p.playerName === last.winner);
    if (winnerPlay?.card.kind === 'wizard' && room.trumpSuit) {
      const trump = room.trumpSuit;
      let victimRank = 0;
      for (const p of last.plays) {
        if (
          p.card.kind === 'standard' &&
          p.card.suit === trump &&
          p.card.rank >= 11 &&
          p.card.rank > victimRank
        ) {
          victimRank = p.card.rank;
        }
      }
      if (victimRank > 0) {
        enqueue({
          title: 'WIZARD KILL!',
          tone: 'wizard',
          priority: 4,
        });
        return; // one callout per trick — the kill outranks the streak
      }
    }

    // Win streak: same winner on consecutive tricks of this round.
    let streak = 0;
    for (let i = len - 1; i >= 0; i--) {
      const e = hist[i];
      if (e.round === last.round && e.winner === last.winner) streak++;
      else break;
    }

    // Overshooting the bid. The streak callout alone missed the funniest
    // case: a player who is winning tricks they did NOT ask for. Wins
    // past the bid get their own line, with the count and the bid in it,
    // and it replaces the streak callout rather than queueing behind it.
    const winnerBid = room.bids[last.winner];
    const winnerWon = room.tricksWon[last.winner] ?? 0;
    if (winnerBid !== undefined && winnerWon > winnerBid) {
      const isMe = last.winner === myName;
      const name = last.winner.toUpperCase();
      const over = winnerWon - winnerBid;
      const title =
        over === 1
          ? isMe
            ? 'ONE TOO MANY'
            : `${name}: ONE TOO MANY`
          : over === 2
            ? isMe
              ? "YOU CAN'T STOP WINNING"
              : `${name} CAN'T STOP WINNING`
            : isMe
              ? 'MAKE IT STOP'
              : `SOMEONE STOP ${name}`;
      enqueue({ title, tone: 'fire', priority: 3 });
      return;
    }

    if (streak >= 2) {
      const isMe = last.winner === myName;
      const name = last.winner.toUpperCase();
      const title =
        streak === 2
          ? isMe
            ? 'YOU WIN 2 IN A ROW'
            : `${name} WINS 2 IN A ROW`
          : streak === 3
            ? isMe
              ? "YOU'RE ON FIRE"
              : `${name} IS ON FIRE`
            : streak === 4
              ? isMe
                ? "YOU'RE UNSTOPPABLE"
                : `${name} IS UNSTOPPABLE`
              : isMe
                ? 'YOU OWN THIS ROUND'
                : `${name} OWNS THIS ROUND`;
      enqueue({
        title,
        tone: 'fire',
        priority: 2,
      });
    }
    // Length-keyed like GameView's trick effect — trickHistory is
    // append-only so the length is the change signal.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.trickHistory.length, room.currentRound, room.trumpSuit, myName, enqueue]);

  // ---- THE ACE OF SPADES (fires the moment it's played) -----------------
  const prevLogLenRef = useRef<number | null>(null);
  useEffect(() => {
    const len = room.log.length;
    const prev = prevLogLenRef.current;
    prevLogLenRef.current = len;
    if (prev === null || len <= prev) return;
    for (let i = prev; i < len; i++) {
      const e = room.log[i];
      if (
        e.t === 'play' &&
        e.card.kind === 'standard' &&
        e.card.suit === 'S' &&
        e.card.rank === 14
      ) {
        enqueue({
          title: 'THE ACE OF SPADES',
          tone: 'spade',
          priority: 3,
        });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [room.log.length, myName, enqueue]);

  if (!active || !current) return null;

  const style = TONE_STYLE[current.tone];
  return (
    <div className="fixed inset-0 z-[400] pointer-events-none flex items-center justify-center px-4 pb-[18vh]">
      <div
        key={current.id}
        className={`animate-commentary-pop max-w-full text-center rounded-2xl border ${style.border} bg-navy-900/80 backdrop-blur-sm px-6 py-3 shadow-2xl`}
        aria-live="polite"
      >
        <p
          className={`${style.text} font-black uppercase tracking-[0.15em] text-[26px] leading-tight`}
          style={{ textShadow: style.glow }}
        >
          {current.title}
        </p>
      </div>
    </div>
  );
}
