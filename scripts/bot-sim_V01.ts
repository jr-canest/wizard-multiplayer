/**
 * Headless Wizard simulator for the computer players.
 *
 *   npx tsx scripts/bot-sim_V01.ts [games=300] [seats=easy,medium,expert]
 *
 * Plays full games (round 1 → max rounds for the seat count) with the
 * same rules as gameFlow: trump flip (Wizard → dealer picks, Jester → no
 * trump), no trump on the final round, Canadian rule on, bidding from
 * dealer+1, trick winner leads. Prints average score and win rate per
 * seat so a change to botAI can be checked for "expert > medium > easy".
 */
import { buildDeck, deal, shuffle, totalRoundsFor } from '../src/game/deck';
import { legalIndices, getLeadInfo } from '../src/game/legalMoves';
import { winningPlayIndex } from '../src/game/trickWinner';
import { calcRoundScore } from '../src/game/scoring';
import { violatesCanadianRule } from '../src/game/canadianRule';
import { chooseBotBid, chooseBotCard, chooseBotTrump } from '../src/game/botAI';
import type { BotDifficulty, Card, Suit } from '../src/lib/types';

const games = parseInt(process.argv[2] ?? '300', 10);
const seats = (process.argv[3] ?? 'easy,medium,expert').split(',') as BotDifficulty[];
const canadianRule = true;

type Totals = { score: number; wins: number; exact: number; rounds: number; bidSum: number };
const totals: Totals[] = seats.map(() => ({ score: 0, wins: 0, exact: 0, rounds: 0, bidSum: 0 }));

function playGame(gameIdx: number): number[] {
  const n = seats.length;
  const names = seats.map((d, i) => `${d}-${i}`);
  const totalRounds = totalRoundsFor(n);
  const cumulative = names.map(() => 0);
  // Rotate the first dealer so no seat gets a positional edge over many games.
  let dealer = gameIdx % n;

  for (let round = 1; round <= totalRounds; round++) {
    if (round > 1) dealer = (dealer + 1) % n;
    const deck = shuffle(buildDeck());
    const { hands, trumpCard: flipped } = deal(names, round, deck);
    const trumpCard = round >= totalRounds ? null : flipped;
    let trumpSuit: Suit | null = null;
    if (trumpCard?.kind === 'standard') trumpSuit = trumpCard.suit;
    else if (trumpCard?.kind === 'wizard') {
      trumpSuit = chooseBotTrump(hands[names[dealer]], seats[dealer]);
    }

    // Bidding from dealer + 1.
    const bids: number[] = new Array(n).fill(-1);
    const bidsSoFar: number[] = [];
    for (let k = 1; k <= n; k++) {
      const i = (dealer + k) % n;
      const isDealer = i === dealer;
      const otherBidsSum = bidsSoFar.reduce((a, b) => a + b, 0);
      const legalBids: number[] = [];
      for (let b = 0; b <= round; b++) {
        if (!violatesCanadianRule({ isDealerBid: isDealer, canadianRule, currentRound: round, cardsThisRound: round, otherBidsSum, bid: b })) legalBids.push(b);
      }
      bids[i] = chooseBotBid(
        { hand: hands[names[i]], cardsThisRound: round, trumpSuit, playerCount: n, bidsSoFar: [...bidsSoFar], isDealer, legalBids },
        seats[i],
      );
      bidsSoFar.push(bids[i]);
    }

    // Tricks.
    const won: number[] = new Array(n).fill(0);
    const played: Card[] = [];
    let leader = (dealer + 1) % n;
    for (let trick = 1; trick <= round; trick++) {
      const plays: Array<{ playerName: string; card: Card }> = [];
      for (let k = 0; k < n; k++) {
        const i = (leader + k) % n;
        const hand = hands[names[i]];
        const idx = chooseBotCard(
          {
            hand,
            trickInProgress: plays,
            trumpSuit,
            trumpCard,
            playedThisRound: played,
            myBid: bids[i],
            myTricksWon: won[i],
            playersAfterMe: n - k - 1,
          },
          seats[i],
        );
        const legal = legalIndices(hand, plays);
        if (!legal[idx]) throw new Error(`illegal play by ${names[i]} r${round} t${trick}`);
        const card = hand[idx];
        hand.splice(idx, 1);
        plays.push({ playerName: names[i], card });
      }
      void getLeadInfo;
      const w = winningPlayIndex(plays, trumpSuit);
      const winner = names.indexOf(plays[w].playerName);
      won[winner]++;
      leader = winner;
      for (const p of plays) played.push(p.card);
    }

    for (let i = 0; i < n; i++) {
      cumulative[i] += calcRoundScore(bids[i], won[i]);
      totals[i].rounds++;
      totals[i].bidSum += bids[i];
      if (bids[i] === won[i]) totals[i].exact++;
    }
  }
  return cumulative;
}

const t0 = Date.now();
for (let g = 0; g < games; g++) {
  const final = playGame(g);
  const best = Math.max(...final);
  final.forEach((s, i) => {
    totals[i].score += s;
    if (s === best) totals[i].wins++;
  });
}
const ms = Date.now() - t0;

console.log(`\n${games} games · ${seats.length} seats · ${totalRoundsFor(seats.length)} rounds each · ${ms} ms\n`);
console.log('seat      avg score   win %   exact bids %   avg bid/round');
seats.forEach((d, i) => {
  const t = totals[i];
  console.log(
    `${d.padEnd(9)} ${(t.score / games).toFixed(1).padStart(9)}   ${((100 * t.wins) / games).toFixed(0).padStart(4)}%   ${((100 * t.exact) / t.rounds).toFixed(0).padStart(11)}%   ${(t.bidSum / t.rounds).toFixed(2).padStart(13)}`,
  );
});
