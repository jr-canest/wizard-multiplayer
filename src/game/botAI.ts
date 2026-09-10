import type { BotDifficulty, Card, Suit } from '../lib/types';
import { buildDeck, shuffle } from './deck';
import { getLeadInfo, legalIndices } from './legalMoves';
import { winningPlayIndex } from './trickWinner';
import { calcRoundScore } from './scoring';

/**
 * Computer-player brains. Pure functions over plain data so the host's
 * driver (useBotDriver) and the headless simulator (scripts/bot-sim) run
 * the exact same logic.
 *
 *   easy   — a distracted player: rough bids with noise, plays a random
 *            legal card more often than not.
 *   medium — bids from hand strength, then plays to land the bid: chases
 *            tricks while short, sheds while on target.
 *   expert — medium plus card memory (everything played this round),
 *            seat awareness (last to act wins by the minimum), and bids
 *            that react to the table.
 */

type Play = { card: Card; playerName?: string };

/**
 * What the expert's simulations need to know about the table. Optional:
 * without it the expert falls back to its heuristics (kept for the
 * standalone helpers and tests).
 */
export type TableInfo = {
  playerOrder: string[];
  me: string;
  /** Bids known so far, by name. */
  bids: Record<string, number>;
  tricksWon: Record<string, number>;
  /** Suits each player has shown they're out of this round (from off-suit plays). */
  voids: Record<string, Suit[]>;
  /** Index of the dealer in playerOrder (bidding only). */
  dealerIndex: number;
};

export type BidContext = {
  hand: Card[];
  cardsThisRound: number;
  trumpSuit: Suit | null;
  playerCount: number;
  /** Bids already on the table this round, in bidding order. */
  bidsSoFar: number[];
  isDealer: boolean;
  /** Bids the rules allow right now (Canadian rule already applied). */
  legalBids: number[];
  trumpCard?: Card | null;
  table?: TableInfo;
};

export type PlayContext = {
  hand: Card[];
  trickInProgress: Play[];
  trumpSuit: Suit | null;
  trumpCard: Card | null;
  /** Cards from completed tricks this round, all players. */
  playedThisRound: Card[];
  myBid: number;
  myTricksWon: number;
  /** Players still to act after me in this trick. */
  playersAfterMe: number;
  table?: TableInfo;
};

const SUITS: Suit[] = ['H', 'D', 'C', 'S'];

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

// ─── Trump choice (dealer flipped a Wizard) ───

export function chooseBotTrump(hand: Card[], difficulty: BotDifficulty): Suit {
  if (difficulty === 'easy') return pickRandom(SUITS);
  let best: Suit = SUITS[0];
  let bestScore = -1;
  for (const s of SUITS) {
    let score = 0;
    for (const c of hand) {
      if (c.kind === 'standard' && c.suit === s) score += 1 + c.rank / 20;
    }
    if (score > bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best;
}

// ─── Bidding ───

/** More players at the table = more competition for every plain trick. */
function playerCountFactor(n: number): number {
  if (n <= 3) return 1;
  if (n === 4) return 0.9;
  if (n === 5) return 0.8;
  return 0.7;
}

function trumpValue(rank: number): number {
  if (rank >= 14) return 0.95;
  if (rank === 13) return 0.85;
  if (rank === 12) return 0.75;
  if (rank === 11) return 0.65;
  if (rank === 10) return 0.55;
  if (rank === 9) return 0.45;
  return 0.35;
}

function plainValue(rank: number, noTrumpRound: boolean): number {
  if (noTrumpRound) {
    if (rank >= 14) return 0.8;
    if (rank === 13) return 0.6;
    if (rank === 12) return 0.4;
    if (rank === 11) return 0.25;
    if (rank === 10) return 0.15;
    return 0.05;
  }
  if (rank >= 14) return 0.55;
  if (rank === 13) return 0.35;
  if (rank === 12) return 0.2;
  if (rank === 11) return 0.12;
  if (rank === 10) return 0.08;
  return 0.04;
}

/** Expected tricks from a hand. `expert` adds trump-length and void bonuses. */
export function estimateTricks(
  hand: Card[],
  trumpSuit: Suit | null,
  playerCount: number,
  expert: boolean,
): number {
  const f = playerCountFactor(playerCount);
  const suitCounts: Record<Suit, number> = { H: 0, D: 0, C: 0, S: 0 };
  let total = 0;
  let trumps = 0;
  for (const c of hand) {
    if (c.kind === 'wizard') {
      total += 1;
    } else if (c.kind === 'standard') {
      suitCounts[c.suit]++;
      if (trumpSuit && c.suit === trumpSuit) {
        trumps++;
        // Trumps care less about the head count than plain cards do.
        total += trumpValue(c.rank) * (0.5 + 0.5 * f);
      } else {
        total += plainValue(c.rank, trumpSuit === null) * f;
      }
    }
  }
  if (expert) {
    const cards = hand.length;
    // A long trump suit keeps winning after the others run out — but only
    // once rounds are long enough for that to play out.
    if (trumps >= 4 && cards >= 8) total += 0.1 * (trumps - 3);
    // A void suit with spare trumps is a ruffing chance. Small: short
    // hands are void in something most of the time, and the trump's own
    // value is already counted above.
    if (trumpSuit && trumps >= 3 && cards >= 7) {
      const voids = SUITS.filter(
        (s) => s !== trumpSuit && suitCounts[s] === 0,
      ).length;
      total += 0.08 * voids;
    }
  }
  return total;
}

function nearestLegal(
  bid: number,
  legalBids: number[],
  tie: 'down' | 'random',
): number {
  if (legalBids.includes(bid)) return bid;
  let best = legalBids[0];
  let bestD = Infinity;
  for (const b of legalBids) {
    const d = Math.abs(b - bid);
    if (d < bestD || (d === bestD && tie === 'down' && b < best)) {
      best = b;
      bestD = d;
    }
  }
  if (tie === 'random') {
    const ties = legalBids.filter((b) => Math.abs(b - bid) === bestD);
    return pickRandom(ties);
  }
  return best;
}

export function chooseBotBid(ctx: BidContext, difficulty: BotDifficulty): number {
  const { legalBids } = ctx;
  if (legalBids.length === 0) return 0;
  if (legalBids.length === 1) return legalBids[0];
  if (difficulty === 'expert' && ctx.table) return chooseBidBySimulation(ctx, ctx.table);

  if (difficulty === 'easy') {
    const est = estimateTricks(ctx.hand, ctx.trumpSuit, ctx.playerCount, false);
    const wobble = (Math.random() * 2 - 1) * 1.2;
    const bid = clamp(Math.round(est + wobble), 0, ctx.cardsThisRound);
    return nearestLegal(bid, legalBids, 'random');
  }

  const expert = difficulty === 'expert';
  let est = estimateTricks(ctx.hand, ctx.trumpSuit, ctx.playerCount, expert);

  if (expert && ctx.bidsSoFar.length > 0) {
    // Table pressure: if the bids already down (plus a fair share for
    // everyone still to bid) overshoot the tricks available, the others
    // will fight for every trick — bid shy. If they undershoot, they'll
    // be shedding, so tricks come cheap.
    const othersSum = ctx.bidsSoFar.reduce((a, b) => a + b, 0);
    const stillToBid = ctx.playerCount - ctx.bidsSoFar.length - 1;
    const projected =
      othersSum + stillToBid * (ctx.cardsThisRound / ctx.playerCount);
    const pressure = projected / Math.max(1, ctx.cardsThisRound);
    if (pressure > 1.15) est -= 0.25;
    else if (pressure < 0.8) est += 0.2;
  }

  const raw = Math.round(est);
  const bid = clamp(raw, 0, ctx.cardsThisRound);
  return nearestLegal(bid, legalBids, 'down');
}

// ─── Card play ───

function cardKey(c: Card): string {
  return c.kind === 'standard' ? `${c.suit}${c.rank}` : `${c.kind}${c.id}`;
}

function wouldWinNow(card: Card, plays: Play[], trump: Suit | null): boolean {
  return winningPlayIndex([...plays, { card }], trump) === plays.length;
}

/** Ordering strength within the current trick (higher = stronger). */
function power(card: Card, trump: Suit | null, leadSuit: Suit | null): number {
  if (card.kind === 'wizard') return 100;
  if (card.kind === 'jester') return -1;
  if (trump && card.suit === trump) return 50 + card.rank;
  if (leadSuit && card.suit === leadSuit) return 20 + card.rank;
  return card.rank;
}

/** What it costs to throw a card away (lower = happier to dump it). */
function dumpCost(card: Card, trump: Suit | null): number {
  if (card.kind === 'jester') return -1;
  if (card.kind === 'wizard') return 100;
  if (trump && card.suit === trump) return 50 + card.rank;
  return card.rank;
}

function unseenCards(ctx: PlayContext): Card[] {
  const seen = new Set<string>();
  for (const c of ctx.hand) seen.add(cardKey(c));
  for (const c of ctx.playedThisRound) seen.add(cardKey(c));
  for (const p of ctx.trickInProgress) seen.add(cardKey(p.card));
  if (ctx.trumpCard) seen.add(cardKey(ctx.trumpCard));
  return buildDeck().filter((c) => !seen.has(cardKey(c)));
}

/**
 * Probability that nobody still to act can beat `card` once it's played
 * on top of `plays`, estimated from the cards not yet seen this round.
 */
export function holdProbability(
  card: Card,
  plays: Play[],
  ctx: PlayContext,
  unseen: Card[],
): number {
  if (!wouldWinNow(card, plays, ctx.trumpSuit)) return 0;
  if (card.kind === 'wizard') return 1;
  if (card.kind === 'jester') return 0.02;
  const k = ctx.playersAfterMe;
  if (k === 0) return 1;
  const U = unseen.length;
  if (U === 0) return 1;
  const h = ctx.hand.length; // cards each remaining player still holds
  const trump = ctx.trumpSuit;
  const leadSuit = getLeadInfo(plays).leadSuit ?? card.suit;

  let wizards = 0;
  let higherSame = 0;
  let higherTrump = 0;
  let trumpsAll = 0;
  let leadCount = 0;
  for (const u of unseen) {
    if (u.kind === 'wizard') {
      wizards++;
    } else if (u.kind === 'standard') {
      if (u.suit === leadSuit) leadCount++;
      if (u.suit === card.suit && u.rank > card.rank) higherSame++;
      if (trump && u.suit === trump) {
        trumpsAll++;
        if (card.suit === trump && u.rank > card.rank) higherTrump++;
      }
    }
  }

  // Chance a given player is void in the lead suit (and so free to trump).
  const pVoid = Math.pow(Math.max(0, 1 - leadCount / U), h);
  let beaters = wizards;
  if (trump && card.suit === trump) {
    // Winning with a trump: only a higher trump beats me — directly when
    // trump was led, otherwise only from someone void in the lead suit.
    beaters += leadSuit === trump ? higherTrump : higherTrump * pVoid;
  } else {
    // Winning with a plain lead-suit card: higher lead cards beat me, and
    // any trump does if its holder is void in the lead suit.
    beaters += higherSame;
    if (trump) beaters += trumpsAll * pVoid;
  }
  const pNoBeaterOnePlayer = Math.pow(Math.max(0, 1 - beaters / U), h);
  return Math.pow(pNoBeaterOnePlayer, k);
}

/** Returns the index (into ctx.hand) of the card to play. */
export function chooseBotCard(ctx: PlayContext, difficulty: BotDifficulty): number {
  const { hand, trickInProgress: plays, trumpSuit } = ctx;
  const legal: number[] = [];
  legalIndices(hand, plays).forEach((ok, i) => {
    if (ok) legal.push(i);
  });
  if (legal.length === 0) return 0;
  if (legal.length === 1) return legal[0];
  if (difficulty === 'easy' && Math.random() < 0.6) return pickRandom(legal);
  if (difficulty === 'expert' && ctx.table) {
    return chooseCardBySimulation(ctx, ctx.table, legal);
  }

  const expert = difficulty === 'expert';
  const need = ctx.myBid - ctx.myTricksWon;
  const cardsLeft = hand.length;
  const slack = cardsLeft - need;
  const leadSuit = getLeadInfo(plays).leadSuit;
  const leading = plays.length === 0;

  const pw = (i: number) => power(hand[i], trumpSuit, leadSuit);
  const cost = (i: number) => dumpCost(hand[i], trumpSuit);
  const lowestBy = (arr: number[], f: (i: number) => number) =>
    arr.reduce((a, b) => (f(b) < f(a) ? b : a));
  const highestBy = (arr: number[], f: (i: number) => number) =>
    arr.reduce((a, b) => (f(b) > f(a) ? b : a));
  const dump = (arr: number[]) => lowestBy(arr, cost);

  const unseen = expert ? unseenCards(ctx) : [];
  const hold = (i: number) => holdProbability(hand[i], plays, ctx, unseen);
  const isWizard = (i: number) => hand[i].kind === 'wizard';

  if (leading) {
    if (need > 0) {
      if (expert) {
        // Must win everything left: lead the surest card.
        if (need >= cardsLeft) return highestBy(legal, (i) => hold(i) * 1000 + pw(i));
        // Cheapest lead that's still likely to hold, saving Wizards.
        const strong = legal.filter((i) => !isWizard(i) && hold(i) >= 0.6);
        if (strong.length) return lowestBy(strong, pw);
        // Otherwise lead the best non-Wizard shot (others are often
        // shedding, so it wins more than the estimate says).
        const nonWiz = legal.filter((i) => !isWizard(i));
        const pool = nonWiz.length ? nonWiz : legal;
        return highestBy(pool, (i) => hold(i) * 1000 + pw(i));
      }
      if (need >= cardsLeft) return highestBy(legal, pw);
      const nonWiz = legal.filter((i) => !isWizard(i));
      return nonWiz.length ? highestBy(nonWiz, pw) : highestBy(legal, pw);
    }
    // Don't want it: lead the card least likely to win.
    return expert ? lowestBy(legal, (i) => hold(i) * 1000 + cost(i)) : dump(legal);
  }

  const winners = legal.filter((i) => wouldWinNow(hand[i], plays, trumpSuit));
  const losers = legal.filter((i) => !winners.includes(i));

  if (need > 0) {
    if (winners.length === 0) return dump(losers);
    // Last to act: take it as cheaply as possible.
    if (ctx.playersAfterMe === 0) return lowestBy(winners, pw);
    if (!expert) {
      if (need >= cardsLeft) return highestBy(winners, pw);
      const nonWiz = winners.filter((i) => !isWizard(i));
      return nonWiz.length ? highestBy(nonWiz, pw) : highestBy(winners, pw);
    }
    // Expert: cheapest winner that is likely enough to hold, where "enough"
    // relaxes as the slack runs out.
    const threshold = slack >= 3 ? 0.5 : slack === 2 ? 0.35 : slack === 1 ? 0.2 : 0;
    const good = winners.filter((i) => hold(i) >= threshold);
    if (good.length) {
      const nonWiz = good.filter((i) => !isWizard(i));
      return nonWiz.length && slack >= 1 ? lowestBy(nonWiz, pw) : lowestBy(good, pw);
    }
    const bestShot = highestBy(winners, (i) => hold(i) * 1000 + pw(i));
    // Near-hopeless and plenty of slack: keep the card for a better trick.
    if (slack >= 2 && hold(bestShot) < 0.12 && losers.length) return dump(losers);
    return bestShot;
  }

  // On (or over) the bid: avoid this trick. A card that doesn't win now can
  // never win this trick, so shed the most dangerous one we can.
  if (losers.length) return highestBy(losers, cost);
  return lowestBy(winners, pw);
}

// ─── Expert: simulation ───
//
// Flat Monte Carlo over determinized deals. For every candidate (card or
// bid) the unseen cards are dealt to the other seats — honouring suits a
// player has shown they're void in — the round is played out with the
// medium policy for everyone, and the candidate with the best average
// round score wins. Medium plays each sampled world deterministically, so
// the noise comes only from the deals.

/** Roughly how many playout decisions one choice may spend. */
const PLAY_BUDGET = 14000;
const BID_BUDGET = 14000;
const MIN_SAMPLES = 6;
const MAX_SAMPLES = 40;

function samplesFor(budget: number, candidates: number, cardsLeft: number, seats: number): number {
  const perSample = Math.max(1, candidates * cardsLeft * seats);
  return Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.floor(budget / perSample)));
}

/**
 * Suits each player has shown they're out of, from every off-suit play in
 * the given tricks (a player who didn't follow the lead suit had none).
 */
export function inferVoids(
  tricks: Array<{ plays: Array<{ playerName: string; card: Card }> }>,
): Record<string, Suit[]> {
  const voids: Record<string, Set<Suit>> = {};
  for (const t of tricks) {
    for (let k = 1; k < t.plays.length; k++) {
      const { leadSuit, anyCardLegal } = getLeadInfo(t.plays.slice(0, k));
      if (!leadSuit || anyCardLegal) continue;
      const play = t.plays[k];
      if (play.card.kind === 'standard' && play.card.suit !== leadSuit) {
        (voids[play.playerName] ??= new Set()).add(leadSuit);
      }
    }
  }
  const out: Record<string, Suit[]> = {};
  for (const [name, set] of Object.entries(voids)) out[name] = [...set];
  return out;
}

type Need = { name: string; count: number; voids: Set<Suit> };

/** Deal `pool` (already shuffled) to the seats, respecting known voids when possible. */
function dealUnseen(pool: Card[], needs: Need[]): Record<string, Card[]> {
  const out: Record<string, Card[]> = {};
  let remaining = pool;
  // Most-constrained seats first so their allowed cards aren't used up.
  const ordered = [...needs].sort((a, b) => b.voids.size - a.voids.size);
  for (const need of ordered) {
    let allowed = need.voids.size
      ? remaining.filter((c) => c.kind !== 'standard' || !need.voids.has(c.suit))
      : remaining;
    if (allowed.length < need.count) allowed = remaining;
    const taken = allowed.slice(0, need.count);
    const takenSet = new Set(taken);
    remaining = remaining.filter((c) => !takenSet.has(c));
    out[need.name] = taken;
  }
  return out;
}

type SimState = {
  hands: Record<string, Card[]>;
  tricksWon: Record<string, number>;
  bids: Record<string, number>;
  trick: Array<{ playerName: string; card: Card }>;
  nextIdx: number;
};

/** Play the rest of the round out with the medium policy for every seat. */
function playoutRound(
  order: string[],
  state: SimState,
  trumpSuit: Suit | null,
  trumpCard: Card | null,
): void {
  const n = order.length;
  for (;;) {
    while (state.trick.length < n) {
      const name = order[state.nextIdx];
      const hand = state.hands[name];
      if (!hand || hand.length === 0) return;
      const idx = chooseBotCard(
        {
          hand,
          trickInProgress: state.trick,
          trumpSuit,
          trumpCard,
          playedThisRound: [],
          myBid: state.bids[name] ?? 0,
          myTricksWon: state.tricksWon[name] ?? 0,
          playersAfterMe: n - state.trick.length - 1,
        },
        'medium',
      );
      const card = hand[idx];
      hand.splice(idx, 1);
      state.trick.push({ playerName: name, card });
      state.nextIdx = (state.nextIdx + 1) % n;
    }
    const w = winningPlayIndex(state.trick, trumpSuit);
    const winner = state.trick[w].playerName;
    state.tricksWon[winner] = (state.tricksWon[winner] ?? 0) + 1;
    state.trick = [];
    state.nextIdx = order.indexOf(winner);
    if (state.hands[winner].length === 0) return;
  }
}

function chooseCardBySimulation(ctx: PlayContext, table: TableInfo, legal: number[]): number {
  const order = table.playerOrder;
  const n = order.length;
  const me = table.me;
  const myIdx = order.indexOf(me);
  if (myIdx < 0) return legal[0];
  const unseen = unseenCards(ctx);
  const alreadyPlayed = new Set(ctx.trickInProgress.map((p) => p.playerName));
  const needs: Need[] = order
    .filter((name) => name !== me)
    .map((name) => ({
      name,
      count: Math.max(0, ctx.hand.length - (alreadyPlayed.has(name) ? 1 : 0)),
      voids: new Set(table.voids[name] ?? []),
    }));
  const samples = samplesFor(PLAY_BUDGET, legal.length, ctx.hand.length, n);
  const trick = ctx.trickInProgress.map((p) => ({
    playerName: p.playerName ?? '?',
    card: p.card,
  }));

  let bestIdx = legal[0];
  let bestAvg = -Infinity;
  for (const i of legal) {
    let total = 0;
    for (let s = 0; s < samples; s++) {
      const dealt = dealUnseen(shuffle(unseen), needs);
      const hands: Record<string, Card[]> = { ...dealt, [me]: ctx.hand.filter((_, k) => k !== i) };
      const state: SimState = {
        hands,
        tricksWon: { ...table.tricksWon },
        bids: table.bids,
        trick: [...trick, { playerName: me, card: ctx.hand[i] }],
        nextIdx: (myIdx + 1) % n,
      };
      playoutRound(order, state, ctx.trumpSuit, ctx.trumpCard);
      total += calcRoundScore(ctx.myBid, state.tricksWon[me] ?? 0);
    }
    const avg = total / samples;
    if (avg > bestAvg + 1e-9) {
      bestAvg = avg;
      bestIdx = i;
    }
  }
  return bestIdx;
}

function chooseBidBySimulation(ctx: BidContext, table: TableInfo): number {
  const order = table.playerOrder;
  const n = order.length;
  const me = table.me;
  if (!order.includes(me)) return ctx.legalBids[0];
  const seen = new Set<string>(ctx.hand.map(cardKey));
  if (ctx.trumpCard) seen.add(cardKey(ctx.trumpCard));
  const unseen = buildDeck().filter((c) => !seen.has(cardKey(c)));
  const needs: Need[] = order
    .filter((name) => name !== me)
    .map((name) => ({ name, count: ctx.hand.length, voids: new Set<Suit>() }));
  const samples = samplesFor(BID_BUDGET, ctx.legalBids.length, ctx.hand.length, n);
  const leader = (table.dealerIndex + 1) % n;

  let bestBid = ctx.legalBids[0];
  let bestAvg = -Infinity;
  for (const b of ctx.legalBids) {
    let total = 0;
    for (let s = 0; s < samples; s++) {
      const dealt = dealUnseen(shuffle(unseen), needs);
      const bids: Record<string, number> = { ...table.bids, [me]: b };
      for (const name of order) {
        if (name === me || bids[name] !== undefined) continue;
        // Seats that haven't bid yet: assume they bid what medium would.
        bids[name] = Math.max(
          0,
          Math.min(ctx.cardsThisRound, Math.round(estimateTricks(dealt[name], ctx.trumpSuit, n, false))),
        );
      }
      const state: SimState = {
        hands: { ...dealt, [me]: ctx.hand.slice() },
        tricksWon: {},
        bids,
        trick: [],
        nextIdx: leader,
      };
      playoutRound(order, state, ctx.trumpSuit, ctx.trumpCard ?? null);
      total += calcRoundScore(b, state.tricksWon[me] ?? 0);
    }
    const avg = total / samples;
    if (avg > bestAvg + 1e-9) {
      bestAvg = avg;
      bestBid = b;
    }
  }
  return bestBid;
}
