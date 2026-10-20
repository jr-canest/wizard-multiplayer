// Engine check for leaveGame: a seat leaving mid-bid, mid-trick and at
// round end keeps the round playable for everyone else.
//   npx tsx scripts/leave-check_V01.ts
import * as E from '../src/game/engine';
import { isLegalPlay } from '../src/game/legalMoves';

let fails = 0;
const ok = (c: boolean, m: string) => { console.log(c ? '  ok ' : '  FAIL', m); if (!c) fails++; };

function game() {
  const s = E.createState({ hostName: 'A', canadianRule: false });
  for (const n of ['B', 'C', 'D']) E.join(s, n);
  E.startGame(s, 'A');
  if (s.room.awaitingTrumpChoice) E.chooseTrumpSuit(s, s.room.playerOrder[s.room.dealerIndex], 'H');
  return s;
}
const cur = (s: E.EngineState) => s.room.playerOrder[s.room.currentPlayerIndex];
function bidAll(s: E.EngineState) { while (s.room.status === 'bidding') E.placeBid(s, cur(s), 0); }
function playOne(s: E.EngineState) {
  const n = cur(s); const h = s.hands[n];
  const i = h.findIndex((c) => isLegalPlay(h, c, s.room.trickInProgress));
  E.playCard(s, n, i);
}
function playRoundOut(s: E.EngineState) {
  let guard = 200;
  while (s.room.status === 'playing' && guard--) playOne(s);
  return s.room.status;
}
function advanceTo(s: E.EngineState, round: number) {
  while (s.room.currentRound < round) {
    bidAll(s); playRoundOut(s);
    for (const n of s.room.playerOrder) E.voteNextRound(s, n, true);
    if (s.room.awaitingTrumpChoice) E.chooseTrumpSuit(s, s.room.playerOrder[s.room.dealerIndex], 'H');
  }
}

console.log('leave mid-bid (host + on the clock)');
{
  const s = game(); advanceTo(s, 3);
  const leaver = cur(s);
  const msg = E.leaveGame(s, leaver, Date.now());
  ok(!!msg?.sys, 'notice line in chat');
  ok(!s.room.playerOrder.includes(leaver), 'seat gone');
  ok(s.room.hostPlayerName !== leaver || leaver !== 'A', 'host moved if host left');
  ok(s.room.playerOrder.includes(s.room.hostPlayerName), 'host is seated');
  bidAll(s);
  ok(playRoundOut(s) === 'scoring', 'round plays out to scoring');
}

for (const k of [1, 2, 3]) {
  console.log(`leave mid-trick after ${k} play(s), leaver = next to play`);
  const s = game(); advanceTo(s, 4); bidAll(s);
  for (let i = 0; i < k; i++) playOne(s);
  const leaver = cur(s);
  const histBefore = s.room.trickHistory.length;
  const playedBefore = s.room.trickInProgress.map((p) => p.playerName);
  E.leaveGame(s, leaver, Date.now());
  if (k === 3) ok(s.room.trickHistory.length === histBefore + 1, 'trick closed without the leaver');
  else ok(s.room.trickInProgress.map((p) => p.playerName).join() === playedBefore.join(), 'others keep their played cards');
  const sizes = new Set(s.room.playerOrder.map((n) => s.hands[n].length));
  ok(sizes.size === 1 || s.room.trickInProgress.length > 0, 'hand sizes line up');
  ok(playRoundOut(s) === 'scoring', 'round plays out to scoring');
  const total = s.room.playerOrder.reduce((a, n) => a + (s.room.tricksWon[n] ?? 0), 0);
  ok(total === 4, `all 4 tricks awarded (${total})`);
}

console.log('leave mid-trick, leaver already played');
{
  const s = game(); advanceTo(s, 4); bidAll(s);
  const leaver = cur(s); playOne(s); playOne(s);
  E.leaveGame(s, leaver, Date.now());
  ok(!s.room.trickInProgress.some((p) => p.playerName === leaver), 'leaver card dropped from trick');
  ok(playRoundOut(s) === 'scoring', 'round plays out to scoring');
}

console.log('leave at round end with everyone else ready');
{
  const s = game(); advanceTo(s, 2); bidAll(s); playRoundOut(s);
  const [a, b, c, d] = s.room.playerOrder;
  E.voteNextRound(s, a, true); E.voteNextRound(s, b, true); E.voteNextRound(s, c, true);
  E.leaveGame(s, d, Date.now());
  ok(s.room.currentRound === 3, 'next round dealt once the holdout left');
}

console.log('down to one player');
{
  const s = game(); advanceTo(s, 2);
  for (const n of ['B', 'C', 'D']) E.leaveGame(s, n, Date.now());
  ok(s.room.status === 'finished', 'game ends');
}

console.log('reactions');
{
  const s = game();
  const m = E.sendChat(s, 'A', 'hi', 1000)!;
  E.reactChat(s, 'B', 'A', 1000, '😂'); E.reactChat(s, 'C', 'A', 1000, '😂');
  ok(Object.keys(m.r!).length === 2, 'two reactions');
  E.reactChat(s, 'B', 'A', 1000, '😂');
  ok(m.r!.B === undefined, 'same emoji again takes it off');
  E.reactChat(s, 'C', 'A', 1000, '❤️');
  ok(m.r!.C === '❤️', 'switching replaces');
  ok(E.reactChat(s, 'C', 'A', 1000, '💩') === null, 'unknown emoji refused');
}
console.log(fails ? `${fails} FAILED` : 'ALL CHECKS PASSED');
process.exit(fails ? 1 : 0);
