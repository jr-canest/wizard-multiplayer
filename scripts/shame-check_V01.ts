// Engine check for the shame-point vote: majority of everyone but the
// target, the target has no say, the point survives an undo and reaches
// the full log, and a vote in flight never blocks play.
//   npx tsx scripts/shame-check_V01.ts
import * as E from '../src/game/engine';
import { isLegalPlay } from '../src/game/legalMoves';
import { SHAME_VOTE_TTL_MS } from '../src/lib/types';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(c ? '  ok ' : '  FAIL', m); if (!c) fails++; };
const cur = (s: E.EngineState) => s.room.playerOrder[s.room.currentPlayerIndex];
function game(humans: string[], bots = 0) {
  const s = E.createState({ hostName: humans[0], canadianRule: false });
  for (const n of humans.slice(1)) E.join(s, n);
  for (let i = 0; i < bots; i++) E.addBot(s, humans[0], 'easy');
  E.startGame(s, humans[0]);
  if (s.room.awaitingTrumpChoice) E.chooseTrumpSuit(s, s.room.playerOrder[s.room.dealerIndex], 'H');
  return s;
}
function playOne(s: E.EngineState) {
  const n = cur(s); const h = s.hands[n];
  E.playCard(s, n, h.findIndex((c) => isLegalPlay(h, c, s.room.trickInProgress)));
}
const now = 1_000_000;

console.log('four people: vote opens, target has no say, majority of the other three');
{
  const s = game(['A', 'B', 'C', 'D']);
  ok(E.openShameVote(s, 'A', 'A', now) === null && !s.room.pendingShame, 'cannot shame yourself');
  E.openShameVote(s, 'A', 'B', now);
  ok(s.room.pendingShame?.target === 'B' && s.room.pendingShame.yes.join() === 'A', 'vote open, opener counted');
  E.placeBid(s, cur(s), 0);
  ok(Object.keys(s.room.bids).length === 1, 'bidding goes on during the vote');
  E.castShameVote(s, 'B', false, now);
  ok(!!s.room.pendingShame && s.room.pendingShame.no.length === 0, 'the target cannot vote');
  E.openShameVote(s, 'C', 'D', now);
  ok(s.room.pendingShame?.target === 'B', 'one vote at a time');
  const msg = E.castShameVote(s, 'C', true, now);
  ok(!!msg?.sys && msg.player === 'B', 'second yes of three carries it, notice line returned');
  ok(!s.room.pendingShame, 'vote closed');
  ok(E.shameCounts(s.room.log).B === 1, 'one shame point for B in the log');
}

console.log('rejected, cancelled, expired');
{
  const s = game(['A', 'B', 'C', 'D']);
  E.openShameVote(s, 'A', 'B', now);
  E.castShameVote(s, 'C', false, now);
  ok(!!s.room.pendingShame, 'one no of three: still open');
  E.castShameVote(s, 'D', false, now);
  ok(!s.room.pendingShame && !E.shameCounts(s.room.log).B, 'two no votes drop it, no point');
  E.openShameVote(s, 'A', 'B', now);
  E.cancelShameVote(s, 'C');
  ok(!!s.room.pendingShame, 'only the opener can cancel');
  E.cancelShameVote(s, 'A');
  ok(!s.room.pendingShame, 'opener cancelled');
  E.openShameVote(s, 'A', 'B', now);
  ok(E.nextExpiry(s) === now + SHAME_VOTE_TTL_MS, 'expiry scheduled');
  ok(E.expireVotes(s, now + SHAME_VOTE_TTL_MS) && !s.room.pendingShame, 'expires by itself');
}

console.log('two people + a computer: lands at once; computers cannot be shamed');
{
  const s = game(['A', 'B'], 1);
  const bot = s.room.playerOrder.find((n) => E.isBot(s.room, n))!;
  ok(E.openShameVote(s, 'A', bot, now) === null && !E.shameCounts(s.room.log)[bot], 'no shame for a computer');
  const msg = E.openShameVote(s, 'A', 'B', now);
  ok(!!msg && E.shameCounts(s.room.log).B === 1 && !s.room.pendingShame, 'A alone decides');
}

console.log('the point survives an undo and the round archive');
{
  const s = game(['A', 'B', 'C']);
  const bidder = cur(s);
  E.placeBid(s, bidder, 0);
  const other = s.room.playerOrder.find((n) => n !== bidder)!;
  const third = s.room.playerOrder.find((n) => n !== bidder && n !== other)!;
  E.openShameVote(s, other, bidder, now);
  E.castShameVote(s, third, true, now);
  ok(E.shameCounts(s.room.log)[bidder] === 1, 'shamed after the bid');
  E.requestUndo(s, bidder, now);
  E.voteUndo(s, other, true);
  ok(s.room.bids[bidder] === undefined, 'bid undone');
  ok(E.shameCounts(s.room.log)[bidder] === 1, 'shame point still there');
  while (s.room.status === 'bidding') E.placeBid(s, cur(s), 0);
  while (s.room.status === 'playing') playOne(s);
  for (const n of s.room.playerOrder) E.voteNextRound(s, n, true);
  ok(s.room.currentRound === 2, 'round 2 dealt');
  ok(E.shameCounts(s.room.log)[bidder] === 1, 'still counted on the room in round 2');
  ok(E.fullLog(s).filter((e) => e.t === 'shame').length === 1, 'exactly once in the full log');
}

console.log('final round waits for an open vote; leaving closes it');
{
  const s = game(['A', 'B', 'C', 'D']);
  s.room.totalRounds = 1;
  while (s.room.status === 'bidding') E.placeBid(s, cur(s), 0);
  while (s.room.status === 'playing') playOne(s);
  E.openShameVote(s, 'A', 'B', now);
  ok(!E.finalRoundAwaitingFinish(s), 'game over held back while the vote is open');
  E.castShameVote(s, 'C', true, now);
  ok(E.finalRoundAwaitingFinish(s) && E.finishFinalRound(s), 'finishes once it lands');
  ok(E.shameCounts(E.publicRoom(s).log).B === 1, 'point is in the finished log (History reads it)');
  ok(E.openShameVote(s, 'A', 'B', now) === null && E.shameCounts(E.publicRoom(s).log).B === 1, 'no shaming after game over');
  const t = game(['A', 'B', 'C', 'D']);
  E.openShameVote(t, 'A', 'B', now);
  E.leaveGame(t, 'B', now);
  ok(!t.room.pendingShame, 'target left: vote gone');
}

console.log(fails ? `\n${fails} FAILED` : '\nALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
